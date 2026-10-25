import { registerPrivacy } from './privacy.mjs';
import { isRealAccount } from './workspace-access.mjs';
import { timingSafeEqual } from 'node:crypto';
import { administrator, registerPlatformSecurity } from './platform-security.mjs';
import { sameDemoScope } from './account-scope.mjs';
import { registerTelemetry } from './platform-telemetry.mjs';
import { registerConversationRoutes } from './conversation-service.mjs';

const state = data => (data.platform ||= { conversations: {} });
const readState = data => data.platform || { conversations: {} };
export function registerPlatformRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, presence, getSessionUser, production, ...options }) {
  registerPrivacy(app);
  const { privileged } = registerPlatformSecurity(app, { store, requireAuth, requireCsrf, ...options });
  const geoSecret = process.env.NORTE_GEO_HEADER_SECRET;
  const trustedLocation = options.trustedLocation || (geoSecret?.length >= 32 ? request => {
    const supplied = request.headers['x-norte-geo-token'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(geoSecret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(geoSecret))) return null;
    return { country: request.headers['x-norte-country'], region: request.headers['x-norte-region'] };
  } : undefined);
  registerTelemetry(app, { store, requireAuth, requireCsrf, privileged, getSessionUser, production, trustedLocation });
  const userView = (data, user, admin = false) => ({ id: user.id, memberId: user.memberId, name: user.name, nickname: user.nickname, institution: user.institution || '', ...presence(data, user), ...(admin ? { email: user.email, active: user.active, demoAccount: Boolean(user.isDemoAccount), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt } : {}) });
  const peopleFor = (data, actor) => data.users.filter(user => isRealAccount(user) && sameDemoScope(actor, user));
  app.get('/api/platform/people', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), q = String(request.query.q || '').slice(0, 100).toLocaleLowerCase(), offset = Math.max(0, Math.min(100000, Number(request.query.offset) || 0));
    const users = peopleFor(data, request.auth.user).filter(user => `${user.name} ${user.nickname}`.toLocaleLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    return { users: users.slice(offset, offset + 100).map(user => userView(data, user)), total: users.length };
  });
  app.get('/api/platform/admin/people', { preHandler: [requireAuth] }, async request => {
    privileged(request); const data = store.read(), q = String(request.query.q || '').slice(0, 100).toLocaleLowerCase();
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(request.query.offset) || 0)));
    const users = data.users.filter(user => isRealAccount(user) && `${user.name} ${user.email} ${user.nickname}`.toLocaleLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { users: users.slice(offset, offset + 100).map(user => userView(data, user, true)), matched: users.length, offset, total: data.users.filter(isRealAccount).length, online: data.users.filter(user => isRealAccount(user) && presence(data, user).presence === 'online').length };
  });
  app.get('/api/platform/admin/technical', { preHandler: [requireAuth] }, async request => {
    privileged(request);
    const metrics = store.read().engineeringMetrics || { llmCalls:0, providerFailures:0, reportedInputTokens:0, reportedOutputTokens:0 };
    return { metrics };
  });
  registerConversationRoutes(app, { store, state, readState, requireAuth, requireCsrf, canAccessProject, userView, privileged });
  return { privileged, administrator };
}
