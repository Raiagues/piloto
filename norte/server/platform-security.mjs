import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const platformError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
export function base32(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode32(text) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of text.replace(/=+$/u, '').toUpperCase()) { const index = alphabet.indexOf(char); if (index < 0) throw new Error('Invalid authenticator key'); value = (value << 5) | index; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
// RFC 4226 dynamic truncation; RFC 6238 uses a 30-second moving counter.
export function totp(secret, counter, digits = 6) {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', decode32(secret)).update(bytes).digest(), offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
export function validCounter(secret, code, now = Date.now(), lastCounter = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/u.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1]) if (counter > lastCounter && counter >= 0 && timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))) return counter;
  return null;
}
export function administrator(request) {
  if (request.auth?.user?.accessRole !== 'owner_admin' || request.auth.user.isDemoAccount) throw platformError(403, 'ADMIN_REQUIRED', 'Acesso exclusivo da administração.');
}
export function registerPlatformSecurity(app, { store, requireAuth, requireCsrf, encryptionKey = process.env.NORTE_ADMIN_ENCRYPTION_KEY || process.env.NORTE_MEETING_BRIDGE_SECRET }) {
  const key = encryptionKey?.length >= 32 ? createHash('sha256').update('norte/admin/mfa/v1:' + encryptionKey).digest() : null;
  const protect = (secret, userId) => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(userId));
    return { iv: iv.toString('base64'), ciphertext: Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  };
  const reveal = (record, userId) => {
    if (!key) throw platformError(503, 'ADMIN_KEY_UNAVAILABLE', 'Configure a chave persistente da administração no servidor.');
    try { const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64')); decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(Buffer.from(record.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8'); }
    catch { throw platformError(503, 'ADMIN_KEY_UNAVAILABLE', 'Não foi possível abrir o autenticador. Confira a chave persistente do servidor.'); }
  };
  const currentAdministrator = (request, data = store.read()) => {
    const user = data.users.find(item => item.id === request.auth.user.id), session = data.sessions.find(item => item.id === request.auth.session.id && item.userId === user?.id && item.expiresAt > Date.now());
    if (!user?.active || !session) throw platformError(401, 'AUTH_REQUIRED', 'Entre novamente.');
    administrator({ auth: { user } });
    return { user, session };
  };
  const privileged = (request, data = store.read()) => {
    const { user, session } = currentAdministrator(request, data);
    if (!user.adminMfa || !(session.adminElevatedUntil > Date.now())) throw platformError(403, 'ADMIN_MFA_REQUIRED', 'Confirme o código do autenticador para abrir os controles administrativos.');
  };
  app.get('/api/platform/admin/security', { preHandler: [requireAuth] }, async request => { administrator(request); const user = store.read().users.find(item => item.id === request.auth.user.id); return { configured: Boolean(key), enrolled: Boolean(user.adminMfa), elevatedUntil: request.auth.session.adminElevatedUntil || 0 }; });
  app.post('/api/platform/admin/security/enroll', { preHandler: [requireAuth, requireCsrf], bodyLimit: 1000, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    administrator(request); reply.header('Cache-Control', 'no-store');
    if (!key) throw platformError(503, 'ADMIN_KEY_UNAVAILABLE', 'Configure a chave persistente da administração no servidor.');
    const user = store.read().users.find(item => item.id === request.auth.user.id);
    if (user.adminMfa) throw platformError(409, 'MFA_ALREADY_ENROLLED', 'O autenticador já está configurado.');
    if (typeof request.body?.password !== 'string' || request.body.password.length > 128 || !await argon2.verify(user.passwordHash, request.body.password).catch(() => false)) throw platformError(403, 'REAUTH_REQUIRED', 'Confirme sua senha atual.');
    const secret = base32(randomBytes(20));
    await store.update(data => { const { user: actor } = currentAdministrator(request, data); if (actor.adminMfa) throw platformError(409, 'MFA_ALREADY_ENROLLED', 'O autenticador já está configurado.'); actor.pendingAdminMfa = { encrypted: protect(secret, user.id), expiresAt: Date.now() + 600000, sessionId: request.auth.session.id }; });
    return { secret, uri: `otpauth://totp/Norte:${encodeURIComponent(user.login || user.email || user.nickname)}?secret=${secret}&issuer=Norte&algorithm=SHA1&digits=6&period=30` };
  });
  app.post('/api/platform/admin/security/verify', { preHandler: [requireAuth, requireCsrf], bodyLimit: 1000, config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async request => {
    administrator(request);
    return store.update(data => {
      const { user, session } = currentAdministrator(request, data), pending = user.pendingAdminMfa;
      const factor = user.adminMfa || (pending?.expiresAt > Date.now() && pending.sessionId === request.auth.session.id ? pending : null);
      if (!factor) throw platformError(403, 'MFA_ENROLL_REQUIRED', 'Configure o autenticador primeiro.');
      const counter = validCounter(reveal(factor.encrypted, user.id), request.body?.code, Date.now(), factor.lastCounter ?? -1);
      if (counter === null) throw platformError(403, 'MFA_INVALID', 'Código inválido, expirado ou já utilizado.');
      user.adminMfa = { encrypted: factor.encrypted, lastCounter: counter }; delete user.pendingAdminMfa;
      session.adminElevatedUntil = Date.now() + 600000;
      data.platformAudit ||= []; data.platformAudit.push({ actorId: user.id, event: 'admin_mfa_verified', at: new Date().toISOString() }); data.platformAudit = data.platformAudit.slice(-2000);
      return { elevatedUntil: session.adminElevatedUntil };
    });
  });
  return { privileged };
}
