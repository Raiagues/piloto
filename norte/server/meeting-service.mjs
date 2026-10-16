import { withPreparedExampleSummaries } from '../scripts/meeting-example-summaries.mjs';
/** Shared meetings. Accounts, consent and project access remain authoritative here. */
import { randomUUID } from 'node:crypto';
import { sameDemoScope } from './demo-account.mjs';
import { normalizeNickname } from './team-identity.mjs';
import { registerMeetingAudio } from './meeting-audio.mjs';

export const meetingError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const fail = (status, code, message) => { throw meetingError(status, code, message); };
const timestamp = () => new Date().toISOString();
const activeUser = (data, id) => data.users.find(user => user.id === id && user.active);
const shape = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const identifier = text(160);
const rate = { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: request => request.auth?.user.id || request.ip } };

export function createMeetingAccess({ canAccessProject }) {
  function scopeEligible(data, user, meeting) {
    if (!meeting.scope || meeting.scope === 'private') return true;
    const team = data.teams.find(item => item.id === meeting.teamId && sameDemoScope(user, item));
    if (!team?.memberIds.includes(user.memberId)) return false;
    if (meeting.scope === 'team') return true;
    const record = data.workspace.projects?.[meeting.projectId], project = record?.document;
    if (!project || project.context?.teamId !== team.id || !canAccessProject(data, user, record) || !project.context.sectors?.some(sector => sector.id === meeting.sectorId)) return false;
    return record.createdBy === user.id || project.context.assignments?.some(assignment => assignment.memberId === user.memberId && (assignment.roleId === 'captain' || assignment.sectorId === meeting.sectorId || assignment.sectorRoles?.some(item => item.sectorId === meeting.sectorId)));
  }
  function accessible(data, user, meeting) {
    if (!meeting || !user || !sameDemoScope(user, meeting) || !activeUser(data, user.id)) return false;
    if (!scopeEligible(data, user, meeting) || meeting.blockedParticipantIds?.includes(user.id)) return false;
    if (meeting.ownerId !== user.id && !meeting.participantIds.includes(user.id) && (!meeting.scope || meeting.scope === 'private')) return false;
    if (meeting.memoryMode === 'project') {
      const project = data.workspace.projects?.[meeting.projectId];
      if (!project || !canAccessProject(data, user, project)) return false;
    }
    return true;
  }
  function requireMeeting(data, user, id, host = false) {
    const meeting = data.meetings?.[id];
    if (!accessible(data, user, meeting)) fail(404, 'MEETING_NOT_FOUND', 'Esta reunião não está disponível para sua conta.');
    if (host && meeting.ownerId !== user.id) fail(403, 'HOST_REQUIRED', 'Somente quem conduz a reunião pode alterar o registro. Envie uma contribuição.');
    return meeting;
  }
  function publicMeeting(data, meeting, user) {
    const participants = [...new Set([meeting.ownerId, ...meeting.participantIds])].map(id => {
      const person = activeUser(data, id);
      if (!person || !accessible(data, person, meeting)) return null;
      const lastSeenAt = meeting.presence?.[id] || null;
      const member = data.members?.find(item => item.id === person.memberId);
      return { userId: id, name: person.name, nickname: person.nickname, avatarUrl: member?.avatarUrl || null, role: id === meeting.ownerId ? 'host' : 'participant', lastSeenAt, online: Boolean(lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 90_000) };
    }).filter(Boolean);
    return { id: meeting.id, title: meeting.title, example: meeting.example === 'curated_mock_v1', copiedFromExample: Boolean(meeting.copiedFromExample), projectName: data.workspace.projects?.[meeting.projectId]?.document?.name || null, ownerId: meeting.ownerId, hostUserId: meeting.ownerId, projectId: meeting.projectId, scope: meeting.scope || 'private', teamId: meeting.teamId || null, sectorId: meeting.sectorId || null, teamName: data.teams.find(team => team.id === meeting.teamId)?.name || null, sectorName: data.workspace.projects?.[meeting.projectId]?.document?.context?.sectors?.find(sector => sector.id === meeting.sectorId)?.name || null, memoryMode: meeting.memoryMode, memoryRevision: meeting.memoryRevision, roomKind: meeting.roomKind, status: meeting.status, revision: meeting.revision, createdAt: meeting.createdAt, updatedAt: meeting.updatedAt, participants, myRole: meeting.ownerId === user.id ? 'host' : 'participant' };
  }
  return { accessible, requireMeeting, publicMeeting, scopeEligible };
}

export function registerMeetings(app, { store, requireAuth, requireCsrf, canAccessProject, retrieveContext }) {
  const access = createMeetingAccess({ canAccessProject });
  const { accessible, requireMeeting, publicMeeting, scopeEligible } = access;
  const audio = registerMeetingAudio(app, { store, requireAuth, requireCsrf, access });
  const read = [requireAuth], write = [requireAuth, requireCsrf];
  const params = shape({ id: identifier }, ['id']);
  const publicInvite = (data, item) => ({ id: item.id, meetingId: item.meetingId, title: data.meetings[item.meetingId]?.title || 'Reunião', status: item.status === 'pending' && Date.parse(item.expiresAt) <= Date.now() ? 'expired' : item.status, createdAt: item.createdAt, expiresAt: item.expiresAt, from: activeUser(data, item.createdBy)?.name || 'Participante', recipientNickname: activeUser(data, item.recipientUserId)?.nickname || '' });
  app.get('/api/meeting-scopes', { preHandler: read }, async request => {
    const data = store.read(), user = request.auth.user;
    return { teams: data.teams.filter(team => sameDemoScope(user, team) && team.memberIds.includes(user.memberId)).map(team => ({ id: team.id, name: team.name, projects: Object.values(data.workspace.projects || {}).filter(record => record.document?.context?.teamId === team.id && canAccessProject(data, user, record)).map(record => ({ id: record.document.id, name: record.document.name, sectors: (record.document.context.sectors || []).filter(sector => scopeEligible(data, user, { scope: 'sector', teamId: team.id, projectId: record.document.id, sectorId: sector.id })).map(sector => ({ id: sector.id, name: sector.name })) })) })) };
  });
  app.get('/api/meetings', { preHandler: read }, async request => {
    const data = store.read();
    return { meetings: Object.values(data.meetings || {}).filter(meeting => accessible(data, request.auth.user, meeting) && (!request.query.projectId || meeting.projectId === request.query.projectId) && (!request.query.teamId || meeting.teamId === request.query.teamId) && (!request.query.sectorId || meeting.sectorId === request.query.sectorId) && (!request.query.scope || (meeting.scope || 'private') === request.query.scope)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(meeting => publicMeeting(data, meeting, request.auth.user)) };
  });
  app.post('/api/meetings', { preHandler: write, config: { rateLimit: { max: 30, timeWindow: '1 hour' } }, schema: { body: shape({ title: text(160), projectId: { anyOf: [identifier, { type: 'null' }] }, teamId: { anyOf: [identifier, { type: 'null' }] }, sectorId: { anyOf: [identifier, { type: 'null' }] }, scope: { enum: ['private', 'team', 'sector'] }, memoryMode: { enum: ['none', 'project'] }, roomKind: { enum: ['meeting', 'plain', 'beam'] } }, ['title', 'memoryMode']) } }, async (request, reply) => {
    const result = await store.update(data => {
      const user = activeUser(data, request.auth.user.id);
      if (!user) fail(401, 'AUTH_REQUIRED', 'Entre novamente para continuar.');
      const projectId = request.body.projectId || null;
      if (request.body.memoryMode === 'project' && !projectId) fail(400, 'PROJECT_REQUIRED', 'Selecione o projeto para usar sua memória.');
      const project = projectId && data.workspace.projects?.[projectId];
      if (projectId && (!project || !canAccessProject(data, user, project))) fail(404, 'PROJECT_NOT_FOUND', 'Projeto não disponível para sua conta.');
      const scope = request.body.scope || 'private', teamId = scope === 'private' ? null : request.body.teamId || project?.document?.context?.teamId || null, sectorId = scope === 'sector' ? request.body.sectorId || null : null;
      if (scope !== 'private' && (!teamId || !scopeEligible(data, user, { scope, teamId, projectId, sectorId }))) fail(403, 'MEETING_SCOPE_FORBIDDEN', 'Escolha uma equipe e um setor dos quais você participa.');
      if (teamId && project && project.document?.context?.teamId !== teamId) fail(400, 'MEETING_SCOPE_MISMATCH', 'O projeto precisa pertencer à equipe escolhida.');
      const now = timestamp(), id = randomUUID();
      const meeting = { id, title: request.body.title.trim(), ownerId: user.id, participantIds: [], projectId, scope, teamId, sectorId, memoryMode: request.body.memoryMode, memoryRevision: request.body.memoryMode === 'project' ? project.document.memoryRevision || 0 : null, roomKind: request.body.roomKind === 'beam' ? 'beam' : 'meeting', status: 'draft', revision: 1, createdAt: now, updatedAt: now, presence: { [user.id]: now }, contributions: [], nextSequence: 1, ...(user.demoSandboxId ? { demoSandboxId: user.demoSandboxId } : {}) };
      if (!meeting.title) fail(400, 'TITLE_REQUIRED', 'Informe o título da reunião.');
      data.meetings[id] = meeting;
      return publicMeeting(data, meeting, user);
    });
    reply.code(201); return { meeting: result };
  });
  // Examples stay immutable. Edits belong to an account-owned private copy.
  app.post('/api/meetings/:id/copy', { preHandler: write, config: { rateLimit: { max: 20, timeWindow: '1 hour' } }, schema: { params, body: shape({}) } }, async (request, reply) => {
    const result = await store.update(data => {
      const source = requireMeeting(data, request.auth.user, request.params.id);
      if (source.example !== 'curated_mock_v1' || !source.exampleSnapshot) fail(409, 'EXAMPLE_REQUIRED', 'Somente exemplos possuem este atalho de cópia.');
      const user = activeUser(data, request.auth.user.id), now = timestamp(), id = randomUUID();
      const snapshot = withPreparedExampleSummaries(source.exampleSnapshot);
      snapshot.id = id; snapshot.title = ('Cópia · ' + source.title).slice(0, 160); snapshot.batch ||= {}; snapshot.batch.batch_id = id;
      snapshot.integrated_norte = true; snapshot.project_memory_mode = 'none';
      const copy = { id, title: snapshot.title, ownerId: user.id, participantIds: [], projectId: source.projectId, scope: 'private', teamId: source.teamId || null, sectorId: source.sectorId || null, memoryMode: 'none', memoryRevision: null, roomKind: source.roomKind, status: snapshot.status || 'done', revision: 1, runVersion: 0, createdAt: now, updatedAt: now, presence: { [user.id]: now }, contributions: [], nextSequence: 1, copiedFromExample: source.id, initialSnapshot: snapshot, ...(user.demoSandboxId ? { demoSandboxId: user.demoSandboxId } : {}) };
      data.meetings[id] = copy;
      return publicMeeting(data, copy, user);
    });
    reply.code(201); return { meeting: result };
  });
  app.get('/api/meetings/:id', { preHandler: read, schema: { params } }, async request => {
    const data = store.read(), meeting = requireMeeting(data, request.auth.user, request.params.id);
    return { meeting: publicMeeting(data, meeting, request.auth.user), user: { id: request.auth.user.id, name: request.auth.user.name, nickname: request.auth.user.nickname, role: 'user' }, csrfToken: request.auth.session.csrfToken };
  });
  app.post('/api/meetings/:id/join', { preHandler: write, config: rate, schema: { params, body: shape({}) } }, async request => store.update(data => {
    const meeting = requireMeeting(data, request.auth.user, request.params.id);
    if (meeting.ownerId !== request.auth.user.id && !meeting.participantIds.includes(request.auth.user.id)) {
      if (meeting.participantIds.length >= 100) fail(409, 'PARTICIPANT_LIMIT', 'A reunião atingiu o limite de participantes.');
      meeting.participantIds.push(request.auth.user.id); meeting.revision++;
    }
    meeting.presence[request.auth.user.id] = timestamp();
    return { meeting: publicMeeting(data, meeting, request.auth.user) };
  }));
  app.patch('/api/meetings/:id', { preHandler: write, schema: { params, body: shape({ expectedRevision: { type: 'integer', minimum: 1 }, title: text(160), status: { enum: ['draft', 'running', 'completed', 'interrupted', 'ended'] } }, ['expectedRevision']) } }, async request => store.update(data => {
    const meeting = requireMeeting(data, request.auth.user, request.params.id, true);
    if (meeting.example) fail(403, 'READONLY_EXAMPLE', 'Este exemplo fictício é somente leitura. Crie uma reunião para usar sua própria transcrição.');
    if (meeting.revision !== request.body.expectedRevision) fail(409, 'MEETING_CHANGED', 'A reunião mudou em outra aba. Atualize antes de salvar.');
    if (request.body.title !== undefined) { if (!request.body.title.trim()) fail(400, 'TITLE_REQUIRED', 'Informe o título.'); meeting.title = request.body.title.trim(); }
    if (request.body.status !== undefined) meeting.status = request.body.status;
    meeting.revision++; meeting.updatedAt = timestamp();
    return { meeting: publicMeeting(data, meeting, request.auth.user) };
  }));
  app.post('/api/meetings/:id/presence', { preHandler: write, config: rate, schema: { params, body: shape({}) } }, async request => store.update(data => {
    const meeting = requireMeeting(data, request.auth.user, request.params.id);
    meeting.presence[request.auth.user.id] = timestamp();
    return { participants: publicMeeting(data, meeting, request.auth.user).participants };
  }));
  app.get('/api/meetings/:id/invitations', { preHandler: read, schema: { params } }, async request => {
    const data = store.read(); requireMeeting(data, request.auth.user, request.params.id, true);
    return { invitations: data.meetingInvitations.filter(item => item.meetingId === request.params.id).map(item => publicInvite(data, item)) };
  });
  app.post('/api/meetings/:id/invitations', { preHandler: write, config: { rateLimit: { max: 30, timeWindow: '1 hour' } }, schema: { params, body: shape({ nickname: text(31) }, ['nickname']) } }, async (request, reply) => {
    const result = await store.update(data => {
      const meeting = requireMeeting(data, request.auth.user, request.params.id, true);
      const recipient = data.users.find(user => user.active && user.nickname === normalizeNickname(request.body.nickname) && sameDemoScope(request.auth.user, user));
      if (!recipient) fail(404, 'USER_NOT_FOUND', 'Conta não encontrada.');
      if (!scopeEligible(data, recipient, meeting) || meeting.blockedParticipantIds?.includes(recipient.id)) fail(403, 'MEETING_SCOPE_FORBIDDEN', 'Essa pessoa precisa participar da equipe ou do setor desta reunião.');
      if (recipient.id === meeting.ownerId || meeting.participantIds.includes(recipient.id)) fail(409, 'ALREADY_PARTICIPANT', 'Essa pessoa já participa da reunião.');
      if (meeting.memoryMode === 'project' && !canAccessProject(data, recipient, data.workspace.projects[meeting.projectId])) fail(403, 'PROJECT_ACCESS_REQUIRED', 'Convide essa pessoa para a equipe do projeto antes de compartilhar a reunião com memória.');
      if (meeting.participantIds.length >= 100) fail(409, 'PARTICIPANT_LIMIT', 'A reunião atingiu o limite de participantes.');
      if (data.meetingInvitations.some(item => item.meetingId === meeting.id && item.recipientUserId === recipient.id && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now())) fail(409, 'INVITATION_EXISTS', 'Já há um convite pendente para essa pessoa.');
      const item = { id: randomUUID(), meetingId: meeting.id, createdBy: request.auth.user.id, recipientUserId: recipient.id, status: 'pending', createdAt: timestamp(), expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
      data.meetingInvitations.push(item); return publicInvite(data, item);
    });
    reply.code(201); return { invitation: result };
  });
  app.get('/api/meeting-invitations', { preHandler: read }, async request => {
    const data = store.read();
    return { invitations: data.meetingInvitations.filter(item => item.recipientUserId === request.auth.user.id && item.status === 'pending' && Date.parse(item.expiresAt) > Date.now()).map(item => publicInvite(data, item)) };
  });
  app.post('/api/meeting-invitations/:id/respond', { preHandler: write, schema: { params, body: shape({ decision: { enum: ['accept', 'decline'] } }, ['decision']) } }, async request => store.update(data => {
    const invite = data.meetingInvitations.find(item => item.id === request.params.id && item.recipientUserId === request.auth.user.id);
    if (!invite) fail(404, 'INVITATION_NOT_FOUND', 'Convite não disponível para sua conta.');
    if (invite.status !== 'pending' || Date.parse(invite.expiresAt) <= Date.now()) fail(409, 'INVITATION_CLOSED', 'O convite já foi encerrado ou expirou.');
    const meeting = data.meetings[invite.meetingId], user = activeUser(data, request.auth.user.id), owner = meeting && activeUser(data, meeting.ownerId);
    if (!user || !owner || !sameDemoScope(user, meeting) || !accessible(data, owner, meeting)) fail(404, 'MEETING_NOT_FOUND', 'A reunião não está mais disponível.');
    if (request.body.decision === 'accept') {
      if (!scopeEligible(data, user, meeting) || meeting.blockedParticipantIds?.includes(user.id)) fail(403, 'MEETING_SCOPE_FORBIDDEN', 'Sua participação na equipe ou no setor desta reunião mudou.');
      if (meeting.memoryMode === 'project' && !canAccessProject(data, user, data.workspace.projects[meeting.projectId])) fail(403, 'PROJECT_ACCESS_REQUIRED', 'É necessário acesso ao projeto antes de entrar nesta reunião.');
      if (meeting.participantIds.length >= 100) fail(409, 'PARTICIPANT_LIMIT', 'A reunião atingiu o limite de participantes.');
      meeting.participantIds = [...new Set([...meeting.participantIds, user.id])];
      meeting.revision++; meeting.updatedAt = timestamp(); invite.status = 'accepted';
    } else invite.status = 'declined';
    invite.respondedAt = timestamp(); return { invitation: publicInvite(data, invite) };
  }));
  app.delete('/api/meetings/:id/participants/:userId', { preHandler: write }, async (request, reply) => {
    await store.update(data => {
      const meeting = requireMeeting(data, request.auth.user, request.params.id, true);
      if (request.params.userId === meeting.ownerId) fail(409, 'HOST_REQUIRED', 'A reunião precisa manter sua pessoa responsável.');
      meeting.participantIds = meeting.participantIds.filter(id => id !== request.params.userId);
      if (meeting.scope && meeting.scope !== 'private') meeting.blockedParticipantIds = [...new Set([...(meeting.blockedParticipantIds || []), request.params.userId])];
      delete meeting.presence[request.params.userId];
      for (const item of data.meetingInvitations) if (item.meetingId === meeting.id && item.recipientUserId === request.params.userId && item.status === 'pending') item.status = 'cancelled';
      meeting.revision++; meeting.updatedAt = timestamp();
    }); reply.code(204).send();
  });
  app.get('/api/meetings/:id/contributions', { preHandler: read, schema: { params } }, async request => {
    const data = store.read(), meeting = requireMeeting(data, request.auth.user, request.params.id);
    const after = Number(request.query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0) fail(400, 'INVALID_CURSOR', 'Posição de leitura inválida.');
    const contributions = meeting.contributions.filter(row => row.sequence > after).slice(0, 200);
    return { contributions, cursor: contributions.at(-1)?.sequence || after };
  });
  app.post('/api/meetings/:id/contributions', { preHandler: write, config: rate, schema: { params, body: shape({ text: text(10000), clientId: text(160), kind: { enum: ['text', 'speech'] }, audioSessionId: text(160) }, ['text', 'clientId']) } }, async (request, reply) => {
    const result = await store.update(data => {
      const meeting = requireMeeting(data, request.auth.user, request.params.id);
      if (['completed', 'ended', 'finished', 'done', 'interrupted', 'stopped'].includes(meeting.status)) fail(409, 'MEETING_ENDED', 'Esta reunião já foi encerrada.');
      if (request.body.kind === 'speech') audio.assertCanSpeak(data, request.auth.user, meeting, request.body.audioSessionId);
      const previous = meeting.contributions.find(row => row.userId === request.auth.user.id && row.clientId === request.body.clientId);
      if (previous) return previous;
      if (!request.body.text.trim()) fail(400, 'EMPTY_CONTRIBUTION', 'Escreva sua contribuição.');
      if (meeting.contributions.length >= 10000) fail(409, 'CONTRIBUTION_LIMIT', 'Encerre esta reunião e crie outra para continuar.');
      const row = { id: randomUUID(), sequence: meeting.nextSequence++, userId: request.auth.user.id, name: request.auth.user.name, clientId: request.body.clientId, kind: request.body.kind || 'text', text: request.body.text.trim(), createdAt: timestamp() };
      meeting.contributions.push(row); meeting.presence[request.auth.user.id] = row.createdAt;
      return row;
    }); reply.code(201); return { contribution: result };
  });
  app.post('/api/meetings/:id/context', { preHandler: write, config: rate, schema: { params, body: shape({ query: text(8000) }, ['query']) } }, async request => {
    const data = store.read(), meeting = requireMeeting(data, request.auth.user, request.params.id);
    if (meeting.memoryMode !== 'project') return { enabled: false, items: [], message: 'Esta reunião foi iniciada sem memória de projeto.' };
    if (!retrieveContext) return { enabled: true, available: false, items: [], message: 'A consulta à memória ainda não está disponível.' };
    const result = await retrieveContext({ data, meeting, project: data.workspace.projects[meeting.projectId].document, user: request.auth.user, query: request.body.query });
    await store.refresh?.(); requireMeeting(store.read(), request.auth.user, request.params.id);
    return result;
  });
  return access;
}
