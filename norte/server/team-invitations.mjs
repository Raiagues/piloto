import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { canManageTeam, invitationStatus, normalizeNickname, validNickname } from './team-identity.mjs';
import { createMailer } from './email.mjs';
import { sameDemoScope } from './demo-account.mjs';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const hash = value => createHash('sha256').update(value).digest('hex');
const freshToken = () => randomBytes(32).toString('base64url');
const body = properties => ({ type: 'object', additionalProperties: false, properties });
const text = maxLength => ({ type: 'string', maxLength, minLength: 1 });
const isRecipient = (invite, user) => invite.recipientUserId ? invite.recipientUserId === user.id : invite.email === user.email;
function publicInvitation(data, invite) {
  const user = data.users.find(u => u.id === invite.recipientUserId);
  return { id: invite.id, teamId: invite.teamId, teamName: data.teams.find(t => t.id === invite.teamId)?.name || 'Equipe', nickname: user?.nickname || null, displayName: user?.name || null, email: invite.email, status: invitationStatus(invite), channel: invite.channel, createdAt: invite.createdAt, expiresAt: invite.expiresAt, delivery: invite.delivery };
}
export function registerInvitations(app, { store, requireAuth, requireCsrf, mailer: suppliedMailer }) {
  const mailer = suppliedMailer || createMailer();
  const write = [requireAuth, requireCsrf];
  const manager = (data, user, teamId) => {
    const team = data.teams.find(t => t.id === teamId);
    if (!canManageTeam(data, user, team)) throw fail(403, 'FORBIDDEN', 'Somente a administração desta equipe pode enviar convites.');
    return team;
  };
  const rate = { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: request => request.auth?.user.id || request.ip } };
  app.get('/api/directory/nickname/:nickname', { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => {
    const nickname = normalizeNickname(request.params.nickname);
    if (!validNickname(nickname)) throw fail(400, 'INVALID_NICKNAME', 'Use o identificador completo, com 3 a 30 letras, números ou sublinhado.');
    const user = store.read().users.find(u => u.active && u.nickname === nickname && sameDemoScope(request.auth.user, u));
    if (!user) throw fail(404, 'USER_NOT_FOUND', 'Nenhuma pessoa encontrada com esse identificador.');
    return { user: { id: user.id, nickname: user.nickname, displayName: user.name, institution: user.institution, avatarUrl: user.avatarUrl || '' } };
  });
  app.get('/api/invitations', { preHandler: [requireAuth] }, async request => {
    const data = store.read();
    return { invitations: data.invitations.filter(i => isRecipient(i, request.auth.user) && invitationStatus(i) === 'pending').map(i => publicInvitation(data, i)), emailConfigured: mailer.configured };
  });
  app.get('/api/teams/:id/invitations', { preHandler: [requireAuth] }, async request => {
    const data = store.read(); manager(data, request.auth.user, request.params.id);
    return { invitations: data.invitations.filter(i => i.teamId === request.params.id).slice(-100).reverse().map(i => publicInvitation(data, i)), emailConfigured: mailer.configured };
  });
  app.post('/api/teams/:id/invitations', { preHandler: write, config: rate, schema: { body: body({ nickname: text(31), email: text(254) }) } }, async (request, reply) => {
    if (Boolean(request.body.nickname) === Boolean(request.body.email)) throw fail(400, 'INVALID_RECIPIENT', 'Informe um nickname ou um email.');
    const email = request.body.email?.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'INVALID_EMAIL', 'Informe um email válido.');
    if (email && !mailer.configured) throw fail(503, 'EMAIL_UNAVAILABLE', 'O envio de emails ainda não foi configurado. Convide uma conta existente pelo nickname.');
    if (email && !request.auth.user.emailVerifiedAt) throw fail(403, 'EMAIL_NOT_VERIFIED', 'Verifique seu email em Convites antes de enviar convites por email.');
    const token = freshToken();
    const invitation = await store.update(data => {
      const team = manager(data, request.auth.user, request.params.id);
      const recipient = email ? data.users.find(u => u.active && u.email === email && sameDemoScope(request.auth.user, u)) : data.users.find(u => u.active && u.nickname === normalizeNickname(request.body.nickname) && sameDemoScope(request.auth.user, u));
      if (!email && !recipient) throw fail(404, 'USER_NOT_FOUND', 'Pessoa não encontrada.');
      if (recipient && team.memberIds.includes(recipient.memberId)) throw fail(409, 'ALREADY_MEMBER', 'Essa pessoa já pertence à equipe.');
      const recipientEmail = email || recipient.email;
      if (data.invitations.some(i => i.teamId === team.id && i.email === recipientEmail && invitationStatus(i) === 'pending')) throw fail(409, 'INVITATION_EXISTS', 'Já existe um convite pendente para essa pessoa.');
      const item = { id: randomUUID(), teamId: team.id, createdBy: request.auth.user.id, recipientUserId: recipient?.id || null, email: recipientEmail, channel: email ? 'email' : 'nickname', tokenHash: hash(token), status: 'pending', delivery: email ? 'sending' : 'in_app', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
      data.invitations.push(item);
      return item;
    });
    if (email) {
      try {
        const team = store.read().teams.find(t => t.id === invitation.teamId);
        const url = new URL(mailer.publicUrl);
        url.hash = `/invitations?invite=${invitation.id}&token=${token}`;
        await mailer.send({ to: email, subject: `Convite para ${team.name} no Norte`, text: `A equipe ${team.name} convidou você para participar no Norte.\n\nEntre ou crie uma conta com este email, verifique o endereço e escolha aceitar ou recusar:\n${url.href}\n\nO convite expira em 7 dias e é exclusivo para este endereço. Abrir o link não adiciona você à equipe. Se não esperava o convite, ignore esta mensagem.` });
        await store.update(data => { data.invitations.find(i => i.id === invitation.id).delivery = 'sent'; });
      } catch {
        await store.update(data => { const i = data.invitations.find(i => i.id === invitation.id); i.status = 'failed'; i.delivery = 'failed'; delete i.tokenHash; });
        throw fail(502, 'EMAIL_DELIVERY_FAILED', 'O email não pôde ser enviado. O convite foi invalidado; tente novamente.');
      }
    }
    reply.code(201);
    return { invitation: publicInvitation(store.read(), store.read().invitations.find(i => i.id === invitation.id)) };
  });
  app.post('/api/invitations/:id/respond', { preHandler: write, config: rate, schema: { body: { ...body({ decision: { enum: ['accept', 'decline'] }, token: text(100) }), required: ['decision'] } } }, async request => store.update(data => {
    const user = data.users.find(u => u.id === request.auth.user.id && u.active);
    const invite = data.invitations.find(i => i.id === request.params.id);
    if (!invite || !user || !isRecipient(invite, user)) throw fail(404, 'INVITATION_NOT_FOUND', 'Use a conta correspondente ao destinatário do convite.');
    if (invitationStatus(invite) !== 'pending') throw fail(409, 'INVITATION_CLOSED', 'Este convite expirou ou já foi encerrado.');
    if (request.body.token && hash(request.body.token) !== invite.tokenHash) throw fail(400, 'INVITATION_INVALID', 'O link de convite não é válido.');
    if (request.body.decision === 'accept') {
      if (invite.channel === 'email' && invite.delivery !== 'sent') throw fail(409, 'DELIVERY_PENDING', 'Aguarde a confirmação de envio do email.');
      if (user.pendingLegacyMemberId && !user.emailVerifiedAt) throw fail(403, 'EMAIL_NOT_VERIFIED', 'Verifique seu email para recuperar o perfil existente antes de aceitar.');
      if (invite.channel === 'email' && (!user.emailVerifiedAt || user.email !== invite.email)) throw fail(403, 'EMAIL_NOT_VERIFIED', 'Verifique o email convidado antes de aceitar.');
      const team = data.teams.find(t => t.id === invite.teamId);
      if (!team) throw fail(404, 'TEAM_NOT_FOUND', 'Equipe não encontrada.');
      team.memberIds = [...new Set([...team.memberIds, user.memberId])];
      team.updatedAt = new Date().toISOString();
      invite.status = 'accepted';
    } else invite.status = 'declined';
    invite.respondedAt = new Date().toISOString();
    delete invite.tokenHash;
    return { invitation: publicInvitation(data, invite) };
  }));
  app.delete('/api/teams/:id/invitations/:invitationId', { preHandler: write }, async (request, reply) => {
    await store.update(data => {
      manager(data, request.auth.user, request.params.id);
      const invite = data.invitations.find(i => i.id === request.params.invitationId && i.teamId === request.params.id);
      if (!invite) throw fail(404, 'INVITATION_NOT_FOUND', 'Convite não encontrado.');
      if (invitationStatus(invite) !== 'pending') throw fail(409, 'INVITATION_CLOSED', 'Este convite já foi encerrado.');
      invite.status = 'cancelled'; invite.respondedAt = new Date().toISOString(); delete invite.tokenHash;
    });
    reply.code(204).send();
  });
  app.post('/api/auth/email-verification', { preHandler: write, config: { rateLimit: { max: 3, timeWindow: '15 minutes', keyGenerator: request => request.auth?.user.id || request.ip } } }, async request => {
    if (!mailer.configured) throw fail(503, 'EMAIL_UNAVAILABLE', 'O envio de emails ainda não foi configurado.');
    const user = request.auth.user;
    if (user.emailVerifiedAt) return { verified: true };
    const token = freshToken(), tokenHash = hash(token);
    await store.update(data => {
      data.emailVerifications = data.emailVerifications.filter(v => v.userId !== user.id && Date.parse(v.expiresAt) > Date.now());
      data.emailVerifications.push({ userId: user.id, email: user.email, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    });
    const url = new URL(mailer.publicUrl); url.hash = `/invitations?verification=${token}`;
    try { await mailer.send({ to: user.email, subject: 'Verifique seu email no Norte', text: `Confirme seu email no Norte entrando na mesma conta e abrindo:\n${url.href}\n\nEste link expira em 30 minutos. A confirmação não aceita convites automaticamente. Se não solicitou, ignore esta mensagem.` }); }
    catch {
      await store.update(data => { data.emailVerifications = data.emailVerifications.filter(v => v.tokenHash !== tokenHash); });
      throw fail(502, 'EMAIL_DELIVERY_FAILED', 'Não foi possível enviar a verificação. Tente novamente.');
    }
    return { sent: true };
  });
  app.post('/api/auth/email-verification/confirm', { preHandler: write, config: rate, schema: { body: { ...body({ token: text(100) }), required: ['token'] } } }, async request => store.update(data => {
    const user = data.users.find(u => u.id === request.auth.user.id);
    const verification = data.emailVerifications.find(v => v.userId === user.id && v.email === user.email && v.tokenHash === hash(request.body.token) && Date.parse(v.expiresAt) > Date.now());
    if (!verification) throw fail(400, 'VERIFICATION_INVALID', 'Verificação inválida ou expirada. Entre na conta que solicitou este email.');
    user.emailVerifiedAt = new Date().toISOString();
    if (user.pendingLegacyMemberId) {
      const member = data.members.find(m => m.id === user.pendingLegacyMemberId && !m.accountId);
      if (!member) throw fail(409, 'PROFILE_ALREADY_CLAIMED', 'Este perfil já foi associado a outra conta.');
      member.accountId = user.id; member.accountStatus = 'active'; member.displayName = user.name; member.updatedAt = user.emailVerifiedAt;
      delete user.pendingLegacyMemberId;
    }
    data.emailVerifications = data.emailVerifications.filter(v => v.userId !== user.id);
    // Legacy invitations remain archived, without granting membership. Reuse an
    // unclaimed profile only after mailbox proof and explicit invitation acceptance.
    return { verified: true };
  }));
}
