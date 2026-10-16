import { createHash } from 'node:crypto';
import { projectKnowledgeItems } from '../shared/project-knowledge.mjs';
import { isProjectAdmin } from '../shared/project-organization.mjs';
import { requireArtifactEditor } from './project-organization.mjs';
const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const revision = record => { const model = record.document.engineeringSystem; return createHash('sha256').update(JSON.stringify([record.document.memoryRevision, model ? [model.id, model.revision, model.entities, model.relations, model.requirements, model.evidence] : null, record.extractionReport || null])).digest('hex').slice(0, 24); };
export function registerMemoryCollaborationRoutes(app, { store, requireAuth, requireCsrf, visibleArtifacts, canAccessProject, now = Date.now }) {
  function actor(data, request) { const user = data.users.find(u => u.id === request.auth.user.id && u.active), session = data.sessions.find(s => s.id === request.auth.session.id && s.userId === user?.id && s.expiresAt > now()); if (!user || !session) throw fail(401, 'SESSION_EXPIRED', 'Sua sessão expirou.'); return user; }
  function source(data, user, id) { const artifact = visibleArtifacts(data, user).find(a => a.id === id); if (!artifact) throw fail(404, 'ARTIFACT_NOT_FOUND', 'Documento indisponível.'); return artifact; }
  function viewers(data, request, artifact) {
    const current = now(); return [...new Map((data.documentPresence || []).filter(entry => entry.artifactId === artifact.id && current - entry.seenAt < 60000 && data.sessions.some(s => s.id === entry.sessionId && s.expiresAt > current)).sort((a, b) => Number(a.mode === 'editing') - Number(b.mode === 'editing')).flatMap(entry => {
      const user = data.users.find(u => u.id === entry.userId && u.active); if (!user || !visibleArtifacts(data, user).some(a => a.id === artifact.id)) return [];
      let mode = entry.mode; if (mode === 'editing') { try { requireArtifactEditor(data, user, artifact); } catch { mode = 'viewing'; } }
      return [[user.id, { id: user.id, name: user.name, mode, self: user.id === request.auth.user.id }]];
    })).values()];
  }
  app.get('/api/artifacts/:id/viewers', { preHandler: [requireAuth] }, async request => { const data = store.read(), user = actor(data, request), artifact = source(data, user, request.params.id); return { viewers: viewers(data, request, artifact) }; });
  app.post('/api/artifacts/:id/viewers', { preHandler: [requireAuth, requireCsrf], schema: { body: { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { enum: ['viewing', 'editing', 'leave'] }, clientId: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_-]+$' } } } } }, async request => store.update(data => {
    const user = actor(data, request), artifact = source(data, user, request.params.id), mode = request.body.mode;
    if (mode === 'editing') { if (artifact.scope !== 'project') throw fail(403, 'FORBIDDEN', 'Edição restrita.'); requireArtifactEditor(data, user, artifact); }
    const current = now(), clientId = request.body.clientId || 'legacy'; data.documentPresence = (data.documentPresence || []).filter(entry => current - entry.seenAt < 60000 && !(entry.sessionId === request.auth.session.id && entry.artifactId === artifact.id && (entry.clientId || 'legacy') === clientId));
    if (mode !== 'leave') { if (data.documentPresence.length >= 5000) data.documentPresence.shift(); data.documentPresence.push({ artifactId: artifact.id, sessionId: request.auth.session.id, userId: user.id, clientId, mode, seenAt: current }); }
    return { viewers: viewers(data, request, artifact) };
  }));
  function project(data, user, id) { const record = Object.hasOwn(data.workspace.projects || {}, id) && data.workspace.projects[id]; if (!record || !canAccessProject(data, user, record)) throw fail(404, 'PROJECT_NOT_FOUND', 'Projeto indisponível.'); return record; }
  function knowledge(data, user, record) {
    const allowed = new Set(visibleArtifacts(data, user).map(a => a.id)), version = revision(record);
    const items = projectKnowledgeItems(record.document, record.extractionReport || {}).map(item => ({ ...item, artifactIds: item.artifactIds.filter(id => allowed.has(id)), review: record.knowledgeReviews?.[`${version}:${item.id}`] || null, canReview: isProjectAdmin(record.document, user, record.createdBy) || item.artifactIds.some(id => { try { requireArtifactEditor(data, user, source(data, user, id)); return true; } catch { return false; } }) }));
    return { sourceRevision: version, items, fixtureLabel: record.extractionReport?.fixtureLabel || null, documentCount: record.extractionReport?.documents?.length || 0, completedAt: record.extractionReport?.completedAt || null };
  }
  app.get('/api/projects/:id/knowledge', { preHandler: [requireAuth] }, async request => { const data = store.read(), user = actor(data, request); return knowledge(data, user, project(data, user, request.params.id)); });
  app.post('/api/projects/:id/knowledge/review', { preHandler: [requireAuth, requireCsrf], bodyLimit: 12000, schema: { body: { type: 'object', additionalProperties: false, required: ['itemId', 'sourceRevision', 'expectedRevision', 'status', 'note'], properties: { itemId: { type: 'string', minLength: 1, maxLength: 500 }, sourceRevision: { type: 'string', maxLength: 40 }, expectedRevision: { type: 'integer', minimum: 0 }, status: { enum: ['open', 'needs_source', 'reviewed', 'discarded'] }, note: { type: 'string', minLength: 3, maxLength: 2000 } } } } }, async request => store.update(data => {
    const user = actor(data, request), record = project(data, user, request.params.id), snapshot = knowledge(data, user, record), input = request.body;
    if (input.note.trim().length < 3) throw fail(400, 'INVALID_NOTE', 'Descreva brevemente o que foi conferido.');
    if (input.sourceRevision !== snapshot.sourceRevision) throw fail(409, 'KNOWLEDGE_CHANGED', 'As fontes mudaram. Reabra a revisão atual antes de salvar.');
    const item = snapshot.items.find(item => item.id === input.itemId); if (!item) throw fail(404, 'ITEM_NOT_FOUND', 'Pendência não encontrada.'); if (!item.canReview || user.accessRole === 'advisor') throw fail(403, 'FORBIDDEN', 'Somente os responsáveis por esta fonte podem registrar a decisão.');
    if ((item.review?.revision || 0) !== input.expectedRevision) throw fail(409, 'REVIEW_CHANGED', 'Outra pessoa revisou este ponto. Atualize antes de salvar.');
    record.knowledgeReviews ||= {}; const key = `${snapshot.sourceRevision}:${item.id}`;
    const entry = { revision: input.expectedRevision + 1, status: input.status, note: input.note.trim(), actorId: user.id, actorName: user.name, updatedAt: new Date(now()).toISOString() };
    const previous = record.knowledgeReviews[key]; record.knowledgeReviewHistory = [...(record.knowledgeReviewHistory || []), ...(previous ? [{ itemId: item.id, sourceRevision: snapshot.sourceRevision, ...previous }] : [])].slice(-500);
    record.knowledgeReviews[key] = entry; return { review: entry };
  }));
}
