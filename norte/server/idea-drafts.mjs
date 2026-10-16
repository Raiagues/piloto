import { createHash, randomUUID } from 'node:crypto';
import { describeEngineeringSystemViolation, matchesSchema, entitySchema, relationSchema } from '../shared/engineering-schema.mjs';
import { technicalHierarchyError } from '../shared/technical-hierarchy.mjs';
import { isProjectAdmin } from '../shared/project-organization.mjs';
import { canReviewAccount } from './reviewer-eligibility.mjs';
import { projectBaselineIsCurrent } from './project-retrieval.mjs';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const hash = value => createHash('sha256').update(JSON.stringify(value || null)).digest('hex');
const now = () => new Date().toISOString();
const semantic = value => JSON.stringify(value, (key, field) => ['source', 'evidenceRefs', 'confidence'].includes(key) ? undefined : field);
export const ideaDraftSummary = draft => draft ? { revision: draft.revision, status: draft.status, contentHash: draft.contentHash, updatedAt: draft.updatedAt, reviewers: draft.reviewers, changedEntities: draft.patch.entities.length + draft.patch.removedEntities.length, changedRelations: draft.patch.relations.length + draft.patch.removedRelations.length } : null;

// Only proposed nodes and links cross this boundary. Source documents, requirements,
// evidence and baseline metadata are always copied from the authorized server model.
export function buildIdeaPatch(baseline, input) {
  if (!Array.isArray(input.entities) || !Array.isArray(input.relations) || input.entities.length > 1000 || input.relations.length > 3000 || input.entities.some(e => !matchesSchema(e, entitySchema)) || input.relations.some(e => !matchesSchema(e, relationSchema))) throw fail(400, 'INVALID_DRAFT', 'Confira os elementos e as conexões do rascunho.');
  const patch = { entities: [], relations: [], removedEntities: [], removedRelations: [] };
  for (const kind of ['entities', 'relations']) {
    const previous = new Map(baseline[kind].map(item => [item.id, item]));
    if (new Set(input[kind].map(item => item.id)).size !== input[kind].length) throw fail(400, 'INVALID_DRAFT', 'Cada elemento precisa de um identificador único.');
    for (const item of input[kind]) if (semantic(previous.get(item.id)) !== semantic(item)) {
      // User edits are proposals, never newly documented evidence.
      const next = { ...item, source: 'user', evidenceRefs: [], confidence: 1 };
      if (kind === 'entities') next.properties = item.properties.map(p => {
        const old = previous.get(item.id)?.properties.find(v => v.key === p.key);
        return old && semantic(old) === semantic(p) ? structuredClone(old) : { ...p, source: 'user', evidenceRefs: [] };
      });
      patch[kind].push(next);
    }
    patch[kind === 'entities' ? 'removedEntities' : 'removedRelations'] = [...previous.keys()].filter(id => !input[kind].some(item => item.id === id));
  }
  return patch;
}
export function applyIdeaPatch(baseline, patch) {
  const model = JSON.parse(JSON.stringify(baseline));
  for (const kind of ['entities', 'relations']) {
    const removed = patch[kind === 'entities' ? 'removedEntities' : 'removedRelations'];
    model[kind] = [...model[kind].filter(item => !removed.includes(item.id)).map(item => patch[kind].find(next => next.id === item.id) || item), ...patch[kind].filter(item => !model[kind].some(old => old.id === item.id))];
  }
  const touched = new Set(patch.entities.map(e => e.id));
  for (const relation of [...patch.relations, ...baseline.relations.filter(r => patch.removedRelations.includes(r.id))]) if (relation.kind === 'contains') { touched.add(relation.from); touched.add(relation.to); }
  for (const entity of model.entities) if (touched.has(entity.parentId)) touched.add(entity.id);
  const violation = describeEngineeringSystemViolation(model) || technicalHierarchyError(model, touched);
  if (violation) throw fail(400, 'INVALID_DRAFT', 'A mudança deixa referências ou hierarquia inválidas. Confira os vínculos antes de salvar.');
  const parents = new Map(model.entities.map(e => [e.id, e.parentId || model.relations.find(r => r.kind === 'contains' && r.to === e.id)?.from]));
  for (const id of touched) {
    const visited = new Set(); let cursor = id;
    while (cursor) { if (visited.has(cursor)) throw fail(400, 'INVALID_DRAFT', 'A hierarquia não pode conter um ciclo. Confira as conexões de composição.'); visited.add(cursor); cursor = parents.get(cursor); }
  }
  return model;
}

export function registerIdeaDraftRoutes(app, { store, requireAuth, requireCsrf, projectFor, sessionFor, intelligence }) {
  const context = (data, request) => {
    const actor = data.users.find(u => u.id === request.auth.user.id && u.active);
    if (!actor) throw fail(401, 'AUTH_REQUIRED', 'Entre novamente.');
    const session = sessionFor(data, actor, request.params.id), record = projectFor(data, actor, session.projectId), idea = session.ideas.find(i => i.id === request.params.ideaId);
    if (!idea) throw fail(404, 'IDEA_NOT_FOUND', 'Ideia indisponível.');
    const model = intelligence.analysisContext(session.projectId, actor.id, data).model;
    if (!model || !record.document.engineeringSystem) throw fail(409, 'MODEL_REQUIRED', 'Crie a arquitetura para explorar uma cópia.');
    return { actor, session, record, idea, model };
  };
  const editable = c => { if (c.actor.accessRole === 'advisor' || ![c.idea.createdBy, c.session.createdBy].includes(c.actor.id)) throw fail(403, 'FORBIDDEN', 'Somente o autor ou responsável pela sessão pode editar este rascunho.'); };
  const baseline = (data, c, b) => {
    if (!projectBaselineIsCurrent(c.record.document)) throw fail(409, 'SYSTEM_MEMORY_STALE', 'Revise a arquitetura após a mudança dos documentos.');
    if (b.baselineHash !== hash(c.record.document.engineeringSystem) || b.deliveryRevision !== (data.workspace.delivery?.[c.session.projectId]?.revision || 0)) throw fail(409, 'BASELINE_CHANGED', 'O projeto ou os requisitos mudaram. Abra uma nova cópia para avaliar o contexto atual.');
  };
  const visible = (c, patch) => {
    const full = c.record.document.engineeringSystem;
    for (const kind of ['entities', 'relations']) {
      const ids = [...patch[kind].map(v => v.id), ...patch[kind === 'entities' ? 'removedEntities' : 'removedRelations']];
      if (ids.some(id => full[kind].some(v => v.id === id) && !c.model[kind].some(v => v.id === id))) throw fail(403, 'DRAFT_SCOPE', 'Esta mudança inclui elementos fora do seu acesso atual.');
    }
    // Replacing a node whose properties were filtered could silently remove hidden
    // data. Require access to its complete property set for editing or reviewing.
    for (const id of [...patch.entities.map(e => e.id), ...patch.removedEntities]) {
      const original = full.entities.find(e => e.id === id), allowed = c.model.entities.find(e => e.id === id);
      if (original && allowed && original.properties.some(p => !allowed.properties.some(v => v.key === p.key))) throw fail(403, 'DRAFT_SCOPE', 'Este elemento contém parâmetros fora do seu acesso. Peça a um responsável com acesso completo para editar e revisar.');
    }
  };
  const eligible = (data, c, id) => {
    const user = data.users.find(u => u.id === id && canReviewAccount(u));
    if (!user || id === c.idea.draft?.createdBy || id === c.idea.createdBy || c.idea.draft?.editors?.includes(id)) return false;
    try { sessionFor(data, user, c.session.id); const model = intelligence.analysisContext(c.session.projectId, id, data).model; visible({ ...c, model }, c.idea.draft.patch); return true; } catch { return false; }
  };
  const view = (data, c) => {
    const d = c.idea.draft;
    if (!d) return { draft: null, model: c.model, baselineHash: hash(c.record.document.engineeringSystem), deliveryRevision: data.workspace.delivery?.[c.session.projectId]?.revision || 0 };
    visible(c, d.patch);
    const stale = d.status !== 'merged' && (d.baselineHash !== hash(c.record.document.engineeringSystem) || d.deliveryRevision !== (data.workspace.delivery?.[c.session.projectId]?.revision || 0) || d.ideaHash !== hash(c.idea.text) || !projectBaselineIsCurrent(c.record.document));
    const decisions = Object.fromEntries(Object.entries(d.decisions).filter(([id]) => eligible(data, c, id)));
    return { draft: { ...d, analysis: undefined, patch: undefined, history: undefined, decisions, status: d.status === 'approved' && !d.reviewers.every(id => decisions[id]?.decision === 'approve') ? 'in_review' : d.status, stale }, model: stale ? null : d.status === 'merged' ? c.model : applyIdeaPatch(c.model, d.patch), ...(d.analysis && !stale && d.status !== 'merged' ? { analysis: d.analysis, analysisBaseline: c.model } : {}), baselineHash: hash(c.record.document.engineeringSystem), deliveryRevision: data.workspace.delivery?.[c.session.projectId]?.revision || 0 };
  };
  const url = '/api/idea-sessions/:id/ideas/:ideaId/draft';
  app.get(url, { preHandler: [requireAuth] }, async request => { const data = store.read(); return view(data, context(data, request)); });
  app.put(url, { preHandler: [requireAuth, requireCsrf], bodyLimit: 2000000 }, async request => store.update(data => {
    const c = context(data, request), b = request.body || {}, old = c.idea.draft; editable(c); baseline(data, c, b);
    if (b.expectedRevision !== (old?.revision || 0) || b.ideaRevision !== c.idea.revision) throw fail(409, 'DRAFT_CHANGED', 'Outra pessoa alterou a ideia ou o rascunho. Recarregue antes de salvar.');
    if (old?.status === 'merged') throw fail(409, 'DRAFT_CLOSED', 'Esta ideia já foi incorporada. Crie outra para uma nova mudança.');
    const patch = buildIdeaPatch(c.model, b), positions = b.positions || {};
    visible(c, patch); applyIdeaPatch(c.model, patch); applyIdeaPatch(c.record.document.engineeringSystem, patch);
    if (Object.keys(positions).length > 1000 || Object.values(positions).some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000)) throw fail(400, 'INVALID_POSITIONS', 'Posições inválidas.');
    const cached = typeof b.analysisDigest === 'string' ? data.workspace.ideaAnalysisCache?.[b.analysisDigest] : null;
    if (b.analysisDigest && (!cached || cached.actorId !== c.actor.id || cached.sessionId !== c.session.id || cached.ideaId !== c.idea.id || cached.ideaText !== c.idea.text || cached.baselineHash !== b.baselineHash || cached.deliveryRevision !== b.deliveryRevision)) throw fail(409, 'ANALYSIS_CONTEXT_CHANGED', 'A avaliação não corresponde a esta versão da ideia.');
    const analysis = cached?.result.change ? { change: cached.result.change, summary: String(cached.result.summary || '').slice(0, 2000), consentDigest: b.analysisDigest } : null;
    c.idea.draft = { revision: (old?.revision || 0) + 1, ideaRevision: c.idea.revision, ideaHash: hash(c.idea.text), baselineHash: b.baselineHash, deliveryRevision: b.deliveryRevision, patch, positions, contentHash: hash(patch), analysis, editors: [...new Set([...(old?.editors || []), c.actor.id])], createdBy: old?.createdBy || c.actor.id, createdAt: old?.createdAt || now(), updatedAt: now(), status: old?.reviewers?.length ? 'changes_requested' : 'draft', reviewers: old?.reviewers || [], decisions: {}, history: [...(old?.history || []), ...(old ? [{ revision: old.revision, contentHash: old.contentHash, status: old.status, decisions: old.decisions, at: old.updatedAt }] : [])].slice(-50) };
    c.session.updatedAt = now(); return view(data, c);
  }));
  app.post(url + '/actions', { preHandler: [requireAuth, requireCsrf], bodyLimit: 5000 }, async request => store.update(data => {
    const c = context(data, request), b = request.body || {}, d = c.idea.draft;
    if (!d || b.expectedRevision !== d.revision || b.contentHash !== d.contentHash) throw fail(409, 'DRAFT_CHANGED', 'A versão mudou. Confira o rascunho atualizado.');
    if (d.status === 'merged') throw fail(409, 'DRAFT_CLOSED', 'A mudança já foi incorporada.');
    baseline(data, c, d); visible(c, d.patch);
    if (d.ideaHash !== hash(c.idea.text)) throw fail(409, 'IDEA_CHANGED', 'A hipótese mudou. Salve e revise o rascunho novamente.');
    if (b.action === 'request_review') {
      editable(c);
      if (!d.patch.entities.length && !d.patch.relations.length && !d.patch.removedEntities.length && !d.patch.removedRelations.length) throw fail(400, 'EMPTY_DRAFT', 'Edite o mapa antes de criar uma proposta.');
      if (!Array.isArray(b.reviewers) || !b.reviewers.length || b.reviewers.length > 10 || b.reviewers.some(id => typeof id !== 'string' || !eligible(data, c, id) || id === c.actor.id)) throw fail(400, 'INVALID_REVIEWER', 'Escolha revisores independentes com acesso à sessão e aos elementos. Perfis de exemplo não podem aprovar.');
      d.reviewers = [...new Set(b.reviewers)]; d.decisions = {}; d.status = 'in_review';
    } else if (b.action === 'review') {
      if (!d.reviewers.includes(c.actor.id) || !eligible(data, c, c.actor.id)) throw fail(403, 'REVIEWER_REQUIRED', 'Somente o revisor independente atribuído pode decidir.');
      if (!['approve', 'request_changes'].includes(b.decision)) throw fail(400, 'INVALID_DECISION', 'Escolha aprovar ou solicitar ajustes.');
      d.decisions[c.actor.id] = { decision: b.decision, contentHash: d.contentHash, at: now() };
      d.status = d.reviewers.some(id => d.decisions[id]?.decision === 'request_changes') ? 'changes_requested' : d.reviewers.every(id => eligible(data, c, id) && d.decisions[id]?.decision === 'approve') ? 'approved' : 'in_review';
    } else if (b.action === 'merge') {
      if (!isProjectAdmin(c.record.document, c.actor, c.record.createdBy)) throw fail(403, 'FORBIDDEN', 'Somente a liderança pode incorporar a proposta.');
      if (d.status !== 'approved' || !d.reviewers.length || !d.reviewers.every(id => eligible(data, c, id) && d.decisions[id]?.decision === 'approve' && d.decisions[id]?.contentHash === d.contentHash)) throw fail(409, 'REVIEW_REQUIRED', 'Conclua as revisões independentes desta versão.');
      const previous = structuredClone(c.record.document), model = applyIdeaPatch(previous.engineeringSystem, d.patch), evidenceId = `idea-${c.idea.id}-${d.revision}`;
      model.evidence.push({ id: evidenceId, artifactId: 'user', artifactLabel: 'Proposta de engenharia revisada', locator: c.idea.id, excerpt: c.idea.text.slice(0, 600), kind: 'user' });
      for (const kind of ['entities', 'relations']) for (const item of model[kind]) if (d.patch[kind].some(p => p.id === item.id)) { item.evidenceRefs = [...new Set([...item.evidenceRefs, evidenceId])]; if (kind === 'entities') for (const property of item.properties) if (property.source === 'user' && !property.evidenceRefs.length) property.evidenceRefs = [evidenceId]; }
      c.record.engineeringHistory ||= []; c.record.engineeringHistory.push({ id: randomUUID(), reason: 'idea_draft', archivedAt: now(), archivedBy: c.actor.id, engineeringSystem: previous.engineeringSystem, extractionReport: structuredClone(c.record.extractionReport || null), ideaId: c.idea.id });
      model.revision = (model.revision || 0) + 1; model.generatedAt = now(); c.record.document.engineeringSystem = model; c.record.revision = (c.record.revision || 0) + 1; c.record.updatedAt = now(); c.record.updatedBy = c.actor.id;
      const delivery = data.workspace.delivery?.[c.session.projectId]; if (delivery) delivery.revision++;
      intelligence.captureMapCorrections?.(data, previous, c.record.document, c.actor.id);
      d.status = 'merged'; d.mergedAt = now(); d.mergedBy = c.actor.id;
      c.model = intelligence.analysisContext(c.session.projectId, c.actor.id, data).model;
    } else throw fail(400, 'INVALID_ACTION', 'Ação indisponível.');
    d.revision++; d.updatedAt = c.session.updatedAt = now();
    return { ...view(data, c), ...(b.action === 'merge' ? { merged: true } : {}) };
  }));
}
