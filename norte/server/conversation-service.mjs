import { randomUUID, createHash } from 'node:crypto';
import { platformError as fail } from './platform-security.mjs';
import { sameDemoScope } from './demo-account.mjs';
import { sectorRole, isProjectAdmin } from '../shared/project-organization.mjs';

const now = () => new Date().toISOString();
const text = (v, max = 4000, min = 0) => { if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw fail(400, 'INVALID_FIELDS', 'Confira o texto informado.'); return v.trim(); };
export function groupAccess(data, actor, scope, canAccessProject) {
  const current = data.users.find(user => user.id === actor.id && user.active);
  if (!current) return false;
  const team = data.teams.find(item => item.id === scope.teamId);
  if (!team || !team.memberIds.includes(current.memberId) || !sameDemoScope(current, team)) return false;
  if (!scope.projectId) return !scope.sectorId;
  const record = data.workspace.projects?.[scope.projectId];
  if (!record || record.document.context?.teamId !== team.id || !canAccessProject(data, current, record)) return false;
  if (!scope.sectorId) return true;
  return !!record.document.context.sectors?.some(sector => sector.id === scope.sectorId) && (isProjectAdmin(record.document, current, record.createdBy) || (['manager', 'member', 'viewer'].includes(sectorRole(record.document, current, scope.sectorId)) && !!record.document.context.assignments?.some(a => a.memberId === current.memberId && (a.sectorId === scope.sectorId || a.sectorRoles?.some(r => r.sectorId === scope.sectorId && ['manager', 'member', 'viewer'].includes(r.role))))));
}
export function helpAnswer(question, language = 'pt') {
  const q = question.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(), en = language === 'en';
  const topics = [
    [/reun|meeting|audio|microfone/, en ? 'Open Meetings, choose your team or sector, then create a room. Use Join audio for the call and the transcript to type or import a conversation. Participants must have access to that team/sector.' : 'Abra Reuniões, escolha a equipe ou setor e crie a sala. Entre no áudio para conversar. Na transcrição você pode escrever ou importar uma conversa. Os participantes precisam ter acesso à equipe/setor.', '#/meetings'],
    [/doc|arquivo|pasta|memoria|upload|pdf/, en ? 'In Project memory → Documents, select a folder and add a file. Open a document to preview it; use Move to change its folder. Your sector role controls editing. In Knowledge, review the source before applying a correction.' : 'Em Memória do projeto → Documentos, selecione a pasta e adicione o arquivo. Clique no documento para ler; use Mover para reorganizar. Seu cargo controla a edição. Na aba Conhecimento, confira a fonte antes de corrigir.', '#/study-setup'],
    [/ideia|hypoth|hipot|explor/, en ? 'Open Test ideas, choose a session and describe one change, for example “reduce the EPS supply from 3.3 V to 3.0 V”. Review the interpretation and impact before applying anything.' : 'Abra Testar ideias, escolha uma sessão e descreva uma mudança, por exemplo: “reduzir a alimentação do EPS de 3,3 V para 3,0 V”. Confira a interpretação e o impacto antes de aplicar qualquer mudança.', '#/ideas'],
    [/requis|norma|standard|verific|teste|revis/, en ? 'Open a requirement to see its sources, review comments and history. Propose a change and choose an independent reviewer. In Verification, link the requirement to an acceptance criterion and record evidence. Analysis suggestions do not approve requirements automatically.' : 'Abra um requisito para ver fontes, comentários e histórico. Proponha uma mudança e escolha um revisor independente. Em Verificação, associe o requisito a um critério de aceitação e registre a evidência. Sugestões de análise não aprovam requisitos automaticamente.', '#/requirements'],
    [/equipe|cargo|setor|permiss|team/, en ? 'Open Teams and select your team. The captain manages project roles; sector managers delegate access within their own sector. Team and sector chats inherit current membership.' : 'Abra Equipes e selecione sua equipe. O capitão organiza os cargos do projeto; gerentes delegam acesso no próprio setor. Os chats de equipe e setor acompanham as permissões atuais.', '#/teams'],
    [/cronog|prazo|gantt|schedule/, en ? 'In Schedule choose a lifecycle reference and inspect the review milestones. Each review groups its deliverables; open an item to adjust dates, ownership and evidence.' : 'Em Cronograma escolha a referência do ciclo de vida e veja os marcos de revisão. Cada revisão reúne seus documentos; abra um item para ajustar datas, responsáveis e evidências.', '#/schedule']
  ];
  const found = topics.find(([re]) => re.test(q));
  return { body: found?.[1] || (en ? 'I can guide you through documents, meetings, ideas, requirements, schedules and team access. Tell me what you want to do. To report a problem or request a change, choose Administration.' : 'Posso orientar sobre documentos, reuniões, ideias, requisitos, cronograma e acessos da equipe. Conte o que você quer fazer. Para relatar um problema ou pedir uma mudança, escolha Administração.'), link: found?.[2] || '#/', source: 'platform_guide' };
}
function imageAttachment(input) {
  if (!input) return null;
  const value = text(input.dataUrl, 1_500_000, 20);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw fail(400, 'INVALID_IMAGE', 'Envie uma captura ou desenho PNG.');
  const buffer = Buffer.from(value.slice(22), 'base64');
  if (buffer.length < 33 || buffer.length > 1_000_000 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.toString('ascii', 12, 16) !== 'IHDR' || !buffer.readUInt32BE(16) || !buffer.readUInt32BE(20) || buffer.readUInt32BE(16) > 2400 || buffer.readUInt32BE(20) > 2400) throw fail(400, 'INVALID_IMAGE', 'Imagem inválida ou maior que 2400 pixels / 1 MB.');
  return { id: randomUUID(), data: buffer.toString('base64'), mimeType: 'image/png', name: text(input.name || 'captura.png', 120), digest: createHash('sha256').update(buffer).digest('hex') };
}
export function registerConversationRoutes(app, { store, state, readState, requireAuth, requireCsrf, canAccessProject, userView, privileged }) {
  const admin = actor => actor.active && actor.accessRole === 'owner_admin' && !actor.isDemoAccount;
  function forActor(data, actor, id, request) {
    actor = data.users.find(user => user.id === actor.id && user.active);
    const all = readState(data).conversations, c = Object.hasOwn(all, id) ? all[id] : null;
    let allowed = !!actor && !!c;
    if (allowed && c.kind === 'administration') { allowed = c.createdBy === actor.id || admin(actor); if (allowed && admin(actor) && c.createdBy !== actor.id) privileged(request, data); }
    else if (allowed && ['team', 'sector'].includes(c.kind)) allowed = groupAccess(data, actor, c, canAccessProject);
    else if (allowed) allowed = c.participantIds.includes(actor.id) && (!c.projectId || canAccessProject(data, actor, data.workspace.projects[c.projectId]));
    if (!allowed) throw fail(404, 'CONVERSATION_NOT_FOUND', 'Conversa indisponível.');
    return c;
  }
  const publicMessage = (c, message) => ({ ...message, key: undefined, attachment: message.attachment ? { id: message.attachment.id, name: message.attachment.name, url: `/api/platform/conversations/${c.id}/attachments/${message.attachment.id}` } : undefined });
  function view(data, actor, c) {
    const participants = ['team', 'sector'].includes(c.kind) ? data.users.filter(u => groupAccess(data, u, c, canAccessProject)) : c.kind === 'administration' ? data.users.filter(u => u.id === c.createdBy || admin(u)) : data.users.filter(u => c.participantIds.includes(u.id));
    return { id: c.id, projectId: c.projectId, teamId: c.teamId, sectorId: c.sectorId, title: c.title || '', kind: c.kind, participants: participants.map(u => userView(data, u)), updatedAt: c.updatedAt, unread: c.messages.filter(m => m.senderId !== actor.id && m.sequence > (c.readThrough?.[actor.id] || 0)).length, lastMessage: c.messages.at(-1)?.body.slice(0, 120) || '' };
  }
  app.get('/api/platform/conversation-scopes', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), actor = request.auth.user;
    const scopes = [];
    for (const team of data.teams.filter(t => groupAccess(data, actor, { teamId: t.id }, canAccessProject))) {
      scopes.push({ kind: 'team', teamId: team.id, title: team.name });
      for (const [projectId, record] of Object.entries(data.workspace.projects)) {
        if (record.document.context?.teamId !== team.id) continue;
        for (const sector of record.document.context.sectors || []) {
          if (groupAccess(data, actor, { teamId: team.id, projectId, sectorId: sector.id }, canAccessProject)) scopes.push({ kind: 'sector', teamId: team.id, projectId, sectorId: sector.id, title: `${team.name} / ${record.document.name} / ${sector.name}` });
        }
      }
    }
    return { scopes, tutorialUrl: process.env.NORTE_CHAT_TUTORIAL_URL?.startsWith('https://') ? process.env.NORTE_CHAT_TUTORIAL_URL : null };
  });
  app.get('/api/platform/conversations', { preHandler: [requireAuth] }, async request => {
    const data = store.read();
    return { conversations: Object.values(readState(data).conversations).filter(c => { try { forActor(data, request.auth.user, c.id, request); return true; } catch { return false; } }).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(c => view(data, request.auth.user, c)) };
  });
  app.post('/api/platform/conversations', { preHandler: [requireAuth, requireCsrf], bodyLimit: 2000, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async request => store.update(data => {
    const actor = data.users.find(u => u.id === request.auth.user.id && u.active), b = request.body || {}, platform = state(data);
    if (!actor) throw fail(401, 'AUTH_REQUIRED', 'Entre novamente.');
    let kind = b.kind || 'direct', participantIds = [actor.id], projectId = null, teamId = null, sectorId = null, title = '', identity;
    if (['team', 'sector'].includes(kind)) {
      teamId = text(b.teamId, 100, 1); projectId = b.projectId ? text(b.projectId, 100, 1) : null; sectorId = kind === 'sector' ? text(b.sectorId, 100, 1) : null;
      if (!groupAccess(data, actor, { teamId, projectId, sectorId }, canAccessProject)) throw fail(404, 'GROUP_NOT_FOUND', 'Grupo indisponível.');
      title = kind === 'team' ? data.teams.find(t => t.id === teamId).name : data.workspace.projects[projectId].document.context.sectors.find(s => s.id === sectorId).name;
      identity = `${kind}:${teamId}:${projectId || ''}:${sectorId || ''}`;
    } else if (kind === 'administration' || kind === 'help') {
      title = kind === 'help' ? 'Ajuda Norte' : 'Administração Norte'; identity = `${kind}:${actor.id}`;
    } else {
      const recipientId = text(b.recipientId, 100, 1), recipient = data.users.find(u => u.id === recipientId && u.active);
      projectId = b.projectId ? text(b.projectId, 100, 1) : null;
      if (!recipient || recipient.id === actor.id || !sameDemoScope(actor, recipient)) throw fail(404, 'PERSON_NOT_FOUND', 'Pessoa indisponível.');
      if (projectId && ![actor, recipient].every(u => canAccessProject(data, u, data.workspace.projects[projectId]))) throw fail(404, 'PROJECT_NOT_FOUND', 'Projeto indisponível para os participantes.');
      participantIds = [actor.id, recipient.id].sort(); kind = projectId ? 'project' : [actor, recipient].some(admin) ? 'support' : 'direct';
      identity = `${projectId || ''}:${participantIds.join(':')}`;
    }
    let c = Object.values(platform.conversations).find(c => c.identity === identity || (['direct','project','support'].includes(kind) && ['direct','project','support'].includes(c.kind) && c.projectId === projectId && JSON.stringify(c.participantIds) === JSON.stringify(participantIds)));
    if (!c) { c = { id: randomUUID(), identity, kind, title, participantIds, projectId, teamId, sectorId, createdBy: actor.id, messages: [], readThrough: {}, createdAt: now(), updatedAt: now() }; platform.conversations[c.id] = c; }
    return { conversation: view(data, actor, c) };
  }));
  app.get('/api/platform/conversations/:id', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), c = forActor(data, request.auth.user, request.params.id, request), before = Number(request.query.before) || Infinity, after = Math.max(0, Number(request.query.after) || 0);
    const eligible = c.messages.filter(m => m.sequence > after && m.sequence < before), messages = eligible.slice(-100);
    return { conversation: view(data, request.auth.user, c), messages: messages.map(m => publicMessage(c,m)), hasOlder: eligible.length > 100 };
  });
  app.get('/api/platform/conversations/:id/attachments/:attachmentId', { preHandler: [requireAuth] }, async (request, reply) => {
    const c = forActor(store.read(), request.auth.user, request.params.id, request), attachment = c.messages.find(m => m.attachment?.id === request.params.attachmentId)?.attachment;
    if (!attachment) throw fail(404, 'NOT_FOUND', 'Imagem indisponível.');
    return reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'none'; sandbox").type('image/png').send(Buffer.from(attachment.data,'base64'));
  });
  app.post('/api/platform/conversations/:id/messages', { preHandler: [requireAuth, requireCsrf], bodyLimit: 1_550_000, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async request => store.update(data => {
    const actor = request.auth.user, c = forActor(data, actor, request.params.id, request), body = text(request.body?.body || '', 4000), key = text(request.body?.key, 100, 8), attachment = imageAttachment(request.body?.attachment);
    if (!body && !attachment) throw fail(400, 'EMPTY_MESSAGE', 'Escreva uma mensagem ou adicione uma imagem.');
    if (['direct','project','support'].includes(c.kind)) {
      if (c.participantIds.some(id => !data.users.some(u => u.id === id && u.active))) throw fail(409,'CONVERSATION_INACTIVE','Um participante não está mais disponível.');
      if (c.projectId && !c.participantIds.every(id => canAccessProject(data, data.users.find(u => u.id === id), data.workspace.projects[c.projectId]))) throw fail(403,'PROJECT_ACCESS_CHANGED','O acesso de um participante ao projeto mudou.');
    }
    const previous = c.messages.find(m => m.senderId === actor.id && m.key === key);
    if (previous) { if (previous.body !== body || previous.attachment?.digest !== attachment?.digest) throw fail(409,'IDEMPOTENCY_CONFLICT','Este envio já contém outra mensagem.'); return { message: publicMessage(c,previous) }; }
    if (attachment && (c.messages.filter(m => m.attachment).length >= 100 || c.messages.reduce((n,m) => n+(m.attachment?.data.length || 0),0)+attachment.data.length > 15_000_000)) throw fail(413,'ATTACHMENT_QUOTA','Esta conversa atingiu o limite de imagens. Envie uma mensagem de texto.');
    const message = { id: randomUUID(), sequence: (c.messages.at(-1)?.sequence || 0)+1, senderId: actor.id, body, key, createdAt: now(), ...(attachment ? { attachment } : {}) };
    c.messages.push(message); c.updatedAt = message.createdAt;
    if (c.kind === 'help') { const answer = helpAnswer(body,request.body?.language); c.messages.push({ id: randomUUID(), sequence: message.sequence+1, senderId: 'norte-guide', ...answer, createdAt: now() }); }
    return { message: publicMessage(c,message) };
  }));
  app.post('/api/platform/conversations/:id/read', { preHandler: [requireAuth, requireCsrf], bodyLimit: 500 }, async request => store.update(data => {
    const c = forActor(data, request.auth.user, request.params.id, request), through = request.body?.through;
    if (!Number.isSafeInteger(through) || through < 0) throw fail(400,'INVALID_FIELDS','Marcador inválido.');
    c.readThrough ||= {}; c.readThrough[request.auth.user.id] = Math.max(c.readThrough[request.auth.user.id] || 0,Math.min(through,c.messages.at(-1)?.sequence || 0)); return { ok:true };
  }));
}
