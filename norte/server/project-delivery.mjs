import { draftDeliveryDocument, deliveryPdf } from './delivery-documents.mjs';
import { canReviewAccount, isFictionalProfile } from './reviewer-eligibility.mjs';
import { inspectRequirement } from '../shared/requirement-quality.mjs';
import { LIFE_DURATIONS, LIFE_PHASES, lifecycleRanges, lifecycleMilestones, reviewDocuments, shiftDate } from '../shared/delivery-lifecycle.mjs';
import { createRequirementAnalyzer } from './requirement-analysis.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { DELIVERY_STANDARDS, DELIVERY_STANDARD_GROUPS } from '../shared/delivery-standards.mjs';
import { canEditSector, isProjectAdmin } from '../shared/project-organization.mjs';

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();
const list = (value, field, max = 100) => {
  if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string' || !id || id.length > 200)) throw fail(400, 'INVALID_DELIVERY', `Lista inválida: ${field}.`);
  return [...new Set(value)];
};
const text = (value, field, max = 4000, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw fail(400, 'INVALID_DELIVERY', `Preencha ${field} corretamente.`);
  return value.trim();
};
const date = value => {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw fail(400, 'INVALID_DATE', 'Informe uma data válida.');
  return value;
};
const methods = ['unspecified', 'test', 'analysis', 'inspection', 'demonstration', 'simulation'];
const statuses = ['planned', 'in_progress', 'blocked', 'done'];
const empty = () => ({ revision: 0, requirements: [], tests: [], tasks: [], standards: [], history: [], proposals: [], documents: [], analyses: {} });
const baseline = record => record.document.engineeringSystem?.requirements || [];
export const deliveryBaselineHash = record => hash({ requirements: baseline(record), evidence: record.document.engineeringSystem?.evidence || [], entities: record.document.engineeringSystem?.entities || [], relations: record.document.engineeringSystem?.relations || [] });
const content = r => ({ id: r.id, title: r.title, statement: r.statement, sectorId: r.sectorId || '', method: r.method || 'unspecified', entityIds: r.entityIds || [], sourceRefs: r.sourceRefs || [], artifactIds: r.artifactIds || [], parentIds: r.parentIds || [], rationale: r.rationale || '', acceptanceCriteria: r.acceptanceCriteria || '', condition: r.condition || '', ownerId: r.ownerId || '', level: r.level || 'system', criticality: r.criticality || 'normal' });
const contentHash = r => hash(content(r));
const evidenceHash = (record, refs) => hash((record.document.engineeringSystem?.evidence || []).filter(e => refs.includes(e.id)));
const requirementSourceHash = (record, r) => hash([projected(r), r.properties || [], r.relatedPropertyRefs || [], r.relatedRelationIds || [], evidenceHash(record, [...(r.sourceRefs || []), ...(r.properties || []).flatMap(p => p.evidenceRefs || [])])]);
const projected = r => ({ id: r.id, title: r.title, statement: r.statement, sectorId: '', method: 'unspecified', entityIds: r.relatedEntityIds || [], sourceRefs: r.sourceRefs || [], artifactIds: [], parentIds: [], source: 'architecture' });
function requirementsOf(record, state, data) {
  const signatures = new Map(baseline(record).map(r => [r.id, requirementSourceHash(record, r)]));
  const source = baseline(record).map(projected), overlays = new Map(state.requirements.map(r => [r.id, r]));
  const rows = source.map(r => {
    const edit = overlays.get(r.id); overlays.delete(r.id);
    if (!edit) return { ...r, version: 1, status: 'draft', reviewers: [], decisions: [], comments: [], archived: false, contentHash: hash([contentHash(r), signatures.get(r.id), evidenceHash(record, r.sourceRefs || [])]), sourceChanged: false, authorId: record.createdBy };
    const sourceChanged = edit.sourceHash !== signatures.get(r.id);
    // Keep a user's correction, but invalidate review when the imported baseline changes.
    return { ...edit, sourceChanged, sourceStatement: r.statement, contentHash: hash([contentHash(edit), signatures.get(r.id), evidenceHash(record, edit.sourceRefs || [])]) };
  });
  for (const edit of overlays.values()) rows.push({ ...edit, sourceChanged: edit.source === 'architecture', contentHash: hash([contentHash(edit), 'manual', evidenceHash(record, edit.sourceRefs || [])]) });
  return rows.map(r => {
    const decisions = (r.decisions || []).filter(d => d.contentHash === r.contentHash && r.reviewers.includes(d.userId) && (!data || canReviewAccount(data.users.find(user => user.id === d.userId))));
    const status = r.archived ? 'archived' : !r.reviewHash || r.reviewHash !== r.contentHash ? 'draft' : decisions.some(d => d.decision === 'request_changes') ? 'changes_requested' : r.reviewers.length && r.reviewers.every(id => decisions.some(d => d.userId === id && d.decision === 'approve')) ? 'approved' : 'in_review';
    return { ...r, status, decisions };
  });
}
/** A read-only projection for retrieval and scenarios. Never mutates the extracted baseline.
 * Human wording is not documentary proof, and obsolete numeric constraints are discarded. */
export function effectiveEngineeringRequirements(data, record, { allowedArtifactIds } = {}) {
  const state = data.workspace.delivery?.[record.document.id];
  if (!state) return structuredClone(baseline(record));
  const originals = new Map(baseline(record).map(r => [r.id, r]));
  const allowed = allowedArtifactIds && new Set(allowedArtifactIds);
  return requirementsOf(record, state, data).filter(r => !r.archived && (!allowed || (r.artifactIds || []).every(id => allowed.has(id)))).map(r => {
    const original = originals.get(r.id), overlay = state.requirements.find(row => row.id === r.id);
    if (!overlay) return structuredClone(original);
    const changed = !original || r.sourceChanged || r.statement !== original.statement || hash(r.sourceRefs) !== hash(original.sourceRefs || []) || hash(r.entityIds) !== hash(original.relatedEntityIds || []);
    const human = r.source === 'manual' || changed || r.title !== original?.title;
    const result = { ...(original ? structuredClone(original) : {}), id: r.id, title: r.title, statement: r.statement,
      subsystemTags: original?.subsystemTags || [], reviewTags: [...new Set([...(human ? ['human_revision'] : []), ...(changed ? ['numeric_constraints_need_review'] : []), ...(original?.reviewTags || [])])].slice(0, 20),
      status: r.status === 'approved' ? 'accepted' : r.status === 'in_review' || r.status === 'changes_requested' ? 'review' : 'unreviewed',
      sourceRefs: r.sourceRefs || [], relatedEntityIds: r.entityIds || [], relatedRelationIds: changed ? [] : original?.relatedRelationIds || [],
      relatedPropertyRefs: changed ? [] : original?.relatedPropertyRefs || [], properties: changed ? [] : original?.properties || [],
      ...(human ? { classificationSource: 'user' } : {}) };
    if (changed) { delete result.originalStatement; delete result.originalSourceRefs; }
    return result;
  });
}
function graphAcyclic(rows, field) {
  const byId = new Map(rows.map(row => [row.id, row])), visiting = new Set(), done = new Set();
  function visit(id) {
    if (visiting.has(id)) throw fail(400, 'DEPENDENCY_CYCLE', 'As dependências não podem formar um ciclo.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.[field] || []) { if (!byId.has(dependency)) throw fail(400, 'INVALID_LINK', 'Dependência não encontrada.'); visit(dependency); }
    visiting.delete(id); done.add(id);
  }
  for (const row of rows) visit(row.id);
}
const configurationHash = record => hash({entities:record.document.engineeringSystem?.entities||[],relations:record.document.engineeringSystem?.relations||[]});
function testStatus(test, requirements, record) {
  if (test.archived) return 'archived';
  const run = test.runs.at(-1);
  if (!run) return 'planned';
  if (run.configurationHash !== configurationHash(record) || run.planHash !== hash(testPlan(test)) || test.requirementIds.some(id => !requirements.some(r => r.id === id && !r.archived && run.requirementHashes[id] === r.contentHash))) return 'stale';
  return run.outcome;
}
const reviewNeedsRevalidation = (task, requirements, tests) => task?.kind === 'review' && task.status === 'done' && ((task.requirementIds || []).some(id => !requirements.some(r => r.id === id && !r.archived && r.status === 'approved')) || (task.testIds || []).some(id => !tests.some(t => t.id === id && !t.archived && t.status === 'passed')));
const effectiveTaskStatus = (task, requirements, tests) => reviewNeedsRevalidation(task, requirements, tests) ? 'blocked' : task?.status;
const testPlan = t => ({ title: t.title, method: t.method, procedure: t.procedure, acceptanceCriteria: t.acceptanceCriteria, requirementIds: t.requirementIds, entityIds: t.entityIds, ownerId: t.ownerId, sectorId: t.sectorId, conditions:t.conditions||'', configuration:t.configuration||'', level:t.level||'system', reviewTaskIds:t.reviewTaskIds||[] });
function visibleMembers(data, record, access) {
  return data.users.filter(user => user.active !== false && !user.disabled && access(data, user, record)).map(user => ({ id: user.id, memberId: user.memberId, name: user.name, nickname: user.nickname, canReview: canReviewAccount(user), isFictionalProfile: isFictionalProfile(user) }));
}
function view(data, record, state, actor, access) {
  const requirements = requirementsOf(record, state, data), project = record.document;
  const tests = state.tests.map(test => ({ ...test, status: testStatus(test, requirements, record), canEdit: canEditSector(project, actor, test.sectorId, record.createdBy) }));
  const today = now().slice(0, 10);
  const taskView = task => ({ ...task, status:effectiveTaskStatus(task,requirements,tests), reviewNeedsRevalidation:reviewNeedsRevalidation(task,requirements,tests), documentOptions: reviewDocuments(task.lifecycleProfile || state.lifecycle?.profile || 'custom',task.reviewCode || ''), overdue: !task.archived && effectiveTaskStatus(task,requirements,tests) !== 'done' && task.dueDate && task.dueDate < today, blockedBy: task.dependencyIds.filter(id => state.tasks.some(t => t.id === id && effectiveTaskStatus(t,requirements,tests) !== 'done' && !t.archived)), dateConflicts: task.dependencyIds.filter(id => state.tasks.some(t => t.id === id && t.dueDate && task.startDate && t.dueDate > task.startDate)), canEdit: canEditSector(project, actor, task.sectorId, record.createdBy) });
  return {
    proposals: (state.proposals || []).map(p => ({...p, status: p.status === 'approved' && !p.reviewers.every(id => canReviewAccount(data.users.find(u => u.id === id))) ? 'open' : p.status, decisions: p.decisions.filter(d => canReviewAccount(data.users.find(u => u.id === d.userId))), stale: requirements.find(r=>r.id===p.requirementId)?.contentHash !== p.baseHash, canReview: canReviewAccount(actor) && p.reviewers.includes(actor.id) && p.authorId !== actor.id, canMerge: canEditSector(project, actor, requirements.find(r=>r.id===p.requirementId)?.sectorId, record.createdBy)})), documents: state.documents || [], lifecycle: state.lifecycle || null, lifecycleRanges: state.lifecycle ? lifecycleRanges(state.lifecycle) : [],
    standardsConfigured: Boolean(state.standardsConfigured || state.standards.length),
    standardsProposals: (state.standardsProposals || []).map(p=>({...p, stale:p.baseHash!==hash(state.standards), canReview:p.reviewers.includes(actor.id)&&p.authorId!==actor.id&&canReviewAccount(actor), status:['merged','cancelled'].includes(p.status)?p.status:p.reviewers.every(id=>visibleMembers(data,record,access).some(m=>m.id===id&&m.canReview)&&p.decisions.some(d=>d.userId===id&&d.decision==='approve'))?'approved':p.decisions.some(d=>d.decision==='request_changes')?'changes_requested':'open'})),
    revision: state.revision, baselineHash: deliveryBaselineHash(record), standards: state.standards, standardOptions: DELIVERY_STANDARDS, standardGroups: DELIVERY_STANDARD_GROUPS,
    requirements: requirements.map(r => ({ ...r, analysis: {...inspectRequirement(r,state.standards), ...(state.analyses?.[r.id]?.contentHash === r.contentHash && state.analyses[r.id].standardsHash === hash(state.standards) ? state.analyses[r.id] : {})}, canEdit: canEditSector(project, actor, r.sectorId, record.createdBy), canReview: canReviewAccount(actor) && r.status === 'in_review' && r.reviewers.includes(actor.id) && r.authorId !== actor.id, verificationStatus: tests.some(t => !t.archived && t.requirementIds.includes(r.id)) ? tests.filter(t => !t.archived && t.requirementIds.includes(r.id)).every(t => t.status === 'passed') ? 'passed' : 'pending' : 'unplanned' })),
    tests, tasks: state.tasks.filter(task => !task.lifecycleProfile || (task.lifecycleProfile === state.lifecycle?.profile && !task.excluded)).map(taskView),
    // Preserve manual dates when previewing another profile or re-enabling a review.
    lifecycleTasks: state.tasks.filter(task => task.lifecycleProfile).map(taskView),
    members: visibleMembers(data, record, access), sectors: project.context.sectors || [],
    entities: (project.engineeringSystem?.entities || []).map(e => ({ id: e.id, name: e.name })),
    evidence: (project.engineeringSystem?.evidence || []).map(e => ({ id: e.id, artifactId: e.artifactId, artifactLabel: e.artifactLabel, locator: e.locator, excerpt: e.excerpt })),
    artifacts: data.artifacts.filter(a => (a.scope === 'project' && a.ownerId === project.id) || (a.scope === 'team' && a.ownerId === project.context.teamId && project.context.teamArtifactIds.includes(a.id))).map(a => ({ id: a.id, label: a.label || a.name || a.id })),
    history: state.history, permissions: { manage: isProjectAdmin(project, actor, record.createdBy), editableSectorIds: (project.context.sectors || []).filter(s => canEditSector(project, actor, s.id, record.createdBy)).map(s => s.id) }
  };
}
export function registerDeliveryRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, analysisOptions = {}, intelligence }) {
  const analyzeRequirement = createRequirementAnalyzer(analysisOptions, intelligence), analysisInFlight = new Set();
  function recordFor(data, request) {
    const actor=data.users.find(u=>u.id===request.auth.user.id&&u.active);if(!actor)throw fail(401,'AUTH_REQUIRED','Entre novamente.');
    const record = data.workspace.projects?.[request.params.id];
    if (!record || !canAccessProject(data, actor, record)) throw fail(404, 'PROJECT_NOT_FOUND', 'Projeto não disponível.');
    return record;
  }
  app.get('/api/projects/:id/delivery', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), record = recordFor(data, request);
    return view(data, record, data.workspace.delivery?.[record.document.id] || empty(), request.auth.user, canAccessProject);
  });
  app.get('/api/projects/:id/delivery/documents/:documentId/export', {preHandler:[requireAuth]}, async (request,reply)=>{
    const data=store.read(),record=recordFor(data,request),document=data.workspace.delivery?.[record.document.id]?.documents?.find(d=>d.id===request.params.documentId);
    if(!document)throw fail(404,'DOCUMENT_NOT_FOUND','Documento indisponível.');
    reply.header('Cache-Control','no-store');
    if(request.query.format==='pdf')return reply.type('application/pdf').header('Content-Disposition',`attachment; filename="${document.id}.pdf"`).send(await deliveryPdf(document));
    return reply.type('text/markdown; charset=utf-8').header('Content-Disposition',`attachment; filename="${document.id}.md"`).send(document.body);
  });
  app.post('/api/projects/:id/delivery/requirements/:requirementId/analyze',{preHandler:[requireAuth,requireCsrf],bodyLimit:1000,config:{rateLimit:{max:6,timeWindow:'1 minute'}}},async request=>{
    const data=store.read(),record=recordFor(data,request),state=data.workspace.delivery?.[record.document.id]||empty();
    const requirement=requirementsOf(record,state).find(r=>r.id===request.params.requirementId&&!r.archived);
    if(!requirement)throw fail(404,'REQUIREMENT_NOT_FOUND','Requisito indisponível.');
    if(!canEditSector(record.document,request.auth.user,requirement.sectorId,record.createdBy)&&!requirement.reviewers.includes(request.auth.user.id))throw fail(403,'FORBIDDEN','A análise é reservada aos editores e revisores atribuídos.');
    const fingerprint=hash([requirement.contentHash,state.standards]),key=`${record.document.id}:${requirement.id}`;
    if(state.analyses?.[requirement.id]?.fingerprint===fingerprint)return {analysis:state.analyses[requirement.id],cached:true};
    if(analysisInFlight.has(key))throw fail(409,'ANALYSIS_RUNNING','Esta análise já está em andamento.');analysisInFlight.add(key);
    try {
      await store.update(data=>{const current=recordFor(data,request),s=data.workspace.delivery?.[current.document.id]||empty(),actor=data.users.find(u=>u.id===request.auth.user.id),r=requirementsOf(current,s).find(r=>r.id===requirement.id&&!r.archived);if(!r||hash([r.contentHash,s.standards])!==fingerprint)throw fail(409,'ANALYSIS_STALE','O requisito mudou antes da análise. Atualize a ficha.');if(!canEditSector(current.document,actor,r.sectorId,current.createdBy)&&!r.reviewers.includes(actor.id))throw fail(403,'FORBIDDEN','A permissão mudou antes da análise.');const today=now().slice(0,10);if(s.analysisBudget?.date!==today)s.analysisBudget={date:today,count:0};if(s.analysisBudget.count>=20)throw fail(429,'ANALYSIS_LIMIT','Limite diário de 20 análises assistidas deste projeto atingido.');s.analysisBudget.count++;data.workspace.delivery||={};data.workspace.delivery[current.document.id]=s;});
      const analysis=await analyzeRequirement({requirement,standards:state.standards,projectId:record.document.id,corrections:(state.proposals||[]).filter(p=>p.status==='merged').slice(-5).map(p=>({before:p.before,after:p.statement,reason:p.reason}))});
      return await store.update(data=>{const current=recordFor(data,request),s=data.workspace.delivery[current.document.id],r=requirementsOf(current,s).find(r=>r.id===requirement.id&&!r.archived);if(!r||hash([r.contentHash,s.standards])!==fingerprint||deliveryBaselineHash(current)!==deliveryBaselineHash(record))throw fail(409,'ANALYSIS_STALE','O requisito ou suas fontes mudaram durante a análise. Nenhuma sugestão foi aplicada.');if(!canEditSector(current.document,data.users.find(u=>u.id===request.auth.user.id),r.sectorId,current.createdBy)&&!r.reviewers.includes(request.auth.user.id))throw fail(403,'FORBIDDEN','A permissão mudou durante a análise.');s.analyses||={};s.analyses[r.id]={...analysis,contentHash:r.contentHash,standardsHash:hash(s.standards),fingerprint,createdAt:now(),disclaimer:'Sugestões de IA, sem declaração de conformidade. Confira os trechos e a aplicabilidade com os revisores.'};return {analysis:s.analyses[r.id],cached:false};});
    } finally {analysisInFlight.delete(key);}
  });
  app.post('/api/projects/:id/delivery/actions', { preHandler: [requireAuth, requireCsrf], bodyLimit: 128 * 1024, config: { rateLimit: { max: 90, timeWindow: '1 minute' } } }, async request => store.update(data => {
    const record = recordFor(data, request), project = record.document, actor = data.users.find(u => u.id === request.auth.user.id);
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_DELIVERY', 'Ação inválida.');
    const state = data.workspace.delivery?.[project.id] || empty();
    state.proposals ||= []; state.documents ||= []; state.analyses ||= {}; state.standardsProposals ||= [];
    if (body.expectedRevision !== state.revision || body.expectedBaselineHash !== deliveryBaselineHash(record)) throw fail(409, 'DELIVERY_CHANGED', 'O projeto mudou em outra aba. Atualize antes de salvar.');
    const members = visibleMembers(data, record, canAccessProject), memberIds = new Set(members.map(m => m.id)), reviewerIds = new Set(members.filter(m => m.canReview).map(m => m.id));
    const current = view(data, record, state, actor, canAccessProject), action = text(body.action, 'ação', 80, true), item = body.item || {};
    const references = (ids, choices, field) => { const parsed = list(ids || [], field); if (parsed.some(id => !choices.some(v => v.id === id))) throw fail(400, 'INVALID_LINK', `Referência inválida: ${field}.`); return parsed; };
    const member = value => { const id = text(value || '', 'responsável', 200); if (id && !memberIds.has(id)) throw fail(400, 'INVALID_MEMBER', 'Selecione um participante deste projeto.'); return id; };
    const editor = sectorId => { if (sectorId && !project.context.sectors.some(s => s.id === sectorId)) throw fail(400, 'INVALID_SECTOR', 'Setor inexistente.'); if (!canEditSector(project, actor, sectorId, record.createdBy)) throw fail(403, 'FORBIDDEN', 'Você não pode editar os registros deste setor.'); };
    const admin = () => { if (!isProjectAdmin(project, actor, record.createdBy)) throw fail(403, 'FORBIDDEN', 'Apenas a liderança do projeto pode configurar esta opção.'); };
    const timestamp = now(), actorName = actor.name;
    let eventId = body.id || '', before = null, after = null;
    if (action === 'standards.set') {
      admin(); const selected=references(body.standards, DELIVERY_STANDARDS, 'normas');
      if((state.standardsConfigured||state.standards.length)&&hash(selected)!==hash(state.standards))throw fail(409,'STANDARDS_REVIEW_REQUIRED','Proponha esta mudança normativa para revisão independente.');
      before=state.standards;state.standards=selected;state.standardsConfigured=true;after=selected;
    } else if(action==='standards.propose') {
      admin();const selected=references(body.standards,DELIVERY_STANDARDS,'normas'),reviewers=list(body.reviewers,'revisores');
      if(!reviewers.length||reviewers.includes(actor.id)||reviewers.some(id=>!reviewerIds.has(id)))throw fail(400,'INVALID_REVIEWERS','Escolha revisores independentes deste projeto.');
      if(hash(selected)===hash(state.standards))throw fail(400,'NO_CHANGE','Selecione a alteração da base normativa.');
      const proposal={id:`STD-${randomUUID().slice(0,8).toUpperCase()}`,before:[...state.standards],standards:selected,baseHash:hash(state.standards),reason:text(body.reason,'justificativa',2000,true),authorId:actor.id,authorName:actorName,reviewers,decisions:[],status:'open',createdAt:timestamp};
      state.standardsProposals.push(proposal);eventId=proposal.id;after=proposal;
    } else if(['standards.review','standards.merge','standards.cancel'].includes(action)) {
      const proposal=state.standardsProposals.find(p=>p.id===body.id);if(!proposal)throw fail(404,'PROPOSAL_NOT_FOUND','Proposta não encontrada.');
      if(['merged','cancelled'].includes(proposal.status))throw fail(409,'PROPOSAL_CLOSED','Proposta encerrada.');
      if(action==='standards.cancel'){admin();proposal.status='cancelled';}
      else {
        if(proposal.baseHash!==hash(state.standards))throw fail(409,'PROPOSAL_STALE','A base normativa mudou; crie uma proposta sobre a versão atual.');
        if(action==='standards.review') {
          if(actor.id===proposal.authorId||!proposal.reviewers.includes(actor.id)||!reviewerIds.has(actor.id))throw fail(403,'FORBIDDEN','Apenas revisores independentes atribuídos podem revisar.');
          if(!['approve','request_changes'].includes(body.decision))throw fail(400,'INVALID_REVIEW','Decisão inválida.');
          const comment=text(body.comment||'','comentário',2000,body.decision==='request_changes');
          proposal.decisions=proposal.decisions.filter(d=>d.userId!==actor.id).concat({userId:actor.id,authorName:actorName,decision:body.decision,comment,createdAt:timestamp});
        } else {
          admin();if(!proposal.reviewers.every(id=>reviewerIds.has(id)&&proposal.decisions.some(d=>d.userId===id&&d.decision==='approve')))throw fail(409,'REVIEW_PENDING','Todos os revisores atribuídos precisam aprovar.');
          before=[...state.standards];state.standards=[...proposal.standards];state.standardsConfigured=true;proposal.status='merged';proposal.mergedAt=timestamp;
          for(const requirement of state.requirements){requirement.reviewHash=null;requirement.decisions=[];}
          after=state.standards;
        }
      }
      eventId=proposal.id;
    } else if (action === 'requirement.save') {
      const old = body.id ? current.requirements.find(r => r.id === body.id) : null;
      if (body.id && !old) throw fail(404, 'REQUIREMENT_NOT_FOUND', 'Requisito não encontrado.');
      if (old?.archived) throw fail(409, 'ARCHIVED', 'Restaure o requisito antes de editar.');
      if (old) editor(old.sectorId);
      const sectorId = text(item.sectorId || '', 'setor', 100); editor(sectorId);
      const method = item.method || 'unspecified'; if (!methods.includes(method)) throw fail(400, 'INVALID_METHOD', 'Método inválido.');
      eventId = old?.id || `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
      const source = baseline(record).find(r => r.id === eventId);
      const updated = { ...(state.requirements.find(r => r.id === eventId) || {}), id: eventId, title: text(item.title, 'título', 160, true), statement: text(item.statement, 'enunciado', 1200, true), sectorId, method,
        entityIds: references(item.entityIds, current.entities, 'elementos'), sourceRefs: references(item.sourceRefs, current.evidence, 'fontes'), artifactIds: references(item.artifactIds, current.artifacts, 'documentos'), parentIds: references(item.parentIds, current.requirements.filter(r => !r.archived), 'requisitos de origem'),
        version: (old?.version || 0) + 1, source: old?.source || 'manual', sourceHash: source ? requirementSourceHash(record, source) : null,
        rationale: text(item.rationale || '', 'justificativa', 4000), acceptanceCriteria: text(item.acceptanceCriteria || '', 'critério de aceitação', 4000), condition: text(item.condition || '', 'condição', 2000), ownerId: member(item.ownerId), level: ['system','subsystem','component'].includes(item.level) ? item.level : 'system', criticality: ['normal','high','safety'].includes(item.criticality) ? item.criticality : 'normal',
        authorId: actor.id, authorName: actorName, updatedAt: timestamp, reviewers: old?.reviewers || [], decisions: [], comments: old?.comments || [], archived: false, reviewHash: null };
      before = old ? content(old) : null; after = content(updated);
      state.requirements = state.requirements.filter(r => r.id !== eventId).concat(updated);
      graphAcyclic(requirementsOf(record, state).filter(r => !r.archived), 'parentIds');
    } else if (action.startsWith('requirement.')) {
      const old = current.requirements.find(r => r.id === body.id); if (!old) throw fail(404, 'REQUIREMENT_NOT_FOUND', 'Requisito não encontrado.');
      let target = state.requirements.find(r => r.id === body.id);
      if (!target) { target = { ...old, sourceHash: requirementSourceHash(record, baseline(record).find(r => r.id === old.id)), authorId: record.createdBy, authorName: '', comments: [], decisions: [] }; state.requirements.push(target); }
      if (action === 'requirement.comment') {
        const comment = text(body.comment, 'comentário', 4000, true);
        target.comments.push({ id: randomUUID(), userId: actor.id, authorName: actorName, text: comment, createdAt: timestamp, version: old.version });
      } else if (action === 'requirement.review') {
        if (!canReviewAccount(actor) || old.status !== 'in_review' || !old.reviewers.includes(actor.id) || old.authorId === actor.id) throw fail(403, 'REVIEW_FORBIDDEN', 'A revisão exige um revisor atribuído diferente do autor da versão.');
        if (!['approve', 'request_changes'].includes(body.decision)) throw fail(400, 'INVALID_DECISION', 'Decisão inválida.');
        const comment = text(body.comment || '', 'comentário', 4000, body.decision === 'request_changes');
        after = { decision: body.decision, comment, version: old.version };
        target.decisions = (target.decisions || []).filter(d => d.userId !== actor.id).concat({ userId: actor.id, authorName: actorName, decision: body.decision, comment, contentHash: old.contentHash, createdAt: timestamp });
      } else {
        editor(old.sectorId);
        if (action === 'requirement.request_review') {
          const reviewers = list(body.reviewers, 'revisores', 30);
          if (!reviewers.length || reviewers.some(id => !reviewerIds.has(id) || id === target.authorId)) throw fail(400, 'INVALID_REVIEWERS', 'Escolha revisores do projeto diferentes do autor. Perfis fictícios não podem revisar.');
          if (old.archived) throw fail(409, 'ARCHIVED', 'Restaure o requisito antes de revisar.');
          after = { reviewers, version: old.version };
          target.reviewers = reviewers; target.decisions = []; target.reviewHash = requirementsOf(record, state).find(r => r.id === old.id).contentHash;
        } else if (action === 'requirement.archive' || action === 'requirement.restore') {
          if (action === 'requirement.archive' && current.requirements.some(r => !r.archived && r.parentIds.includes(old.id))) throw fail(409, 'REQUIREMENT_IN_USE', 'Remova os vínculos dos requisitos dependentes antes de arquivar.');
          target.archived = action === 'requirement.archive'; target.reviewHash = null; after = { archived: target.archived };
          graphAcyclic(requirementsOf(record, state).filter(r => !r.archived), 'parentIds');
        } else throw fail(400, 'INVALID_ACTION', 'Ação desconhecida.');
      }
      target.updatedAt = timestamp;
    } else if (action.startsWith('proposal.')) {
      const proposal = body.id ? state.proposals.find(p=>p.id===body.id) : null;
      const requirement = current.requirements.find(r=>r.id===(proposal?.requirementId || item.requirementId));
      if (!requirement || requirement.archived) throw fail(404,'REQUIREMENT_NOT_FOUND','Requisito indisponível.');
      if (action === 'proposal.save') {
        if(!requirement.reviewers.includes(actor.id)) editor(requirement.sectorId);
        if (body.id && !proposal) throw fail(404,'PROPOSAL_NOT_FOUND','Proposta indisponível.');
        if (proposal && (proposal.authorId !== actor.id || !['open','changes_requested','approved'].includes(proposal.status))) throw fail(403,'PROPOSAL_FORBIDDEN','Somente o autor pode editar uma proposta aberta.');
        const reviewers = references(item.reviewers, members, 'revisores');
        if (!reviewers.length || reviewers.includes(actor.id) || reviewers.some(id => !reviewerIds.has(id))) throw fail(400,'INVALID_REVIEWERS','Selecione revisores diferentes do autor. Perfis fictícios não podem revisar.');
        before=proposal?{statement:proposal.statement,reason:proposal.reason,reviewers:proposal.reviewers,version:proposal.version}:null;
        const updated={id:proposal?.id||`PR-${randomUUID().slice(0,8).toUpperCase()}`,requirementId:requirement.id,baseHash:requirement.contentHash,baseVersion:requirement.version,before:requirement.statement,statement:text(item.statement,'novo enunciado',1200,true),reason:text(item.reason,'motivo da proposta',4000,true),authorId:actor.id,authorName:actorName,reviewers,decisions:[],comments:proposal?.comments||[],version:(proposal?.version||0)+1,status:'open',createdAt:proposal?.createdAt||timestamp,updatedAt:timestamp};
        state.proposals=state.proposals.filter(p=>p.id!==updated.id).concat(updated);eventId=updated.id;after={requirementId:requirement.id,statement:updated.statement,reason:updated.reason,reviewers:updated.reviewers,version:updated.version};
      } else {
        if (!proposal) throw fail(404,'PROPOSAL_NOT_FOUND','Proposta indisponível.');
        eventId=proposal.id;
        if (action === 'proposal.comment') proposal.comments.push({id:randomUUID(),authorName:actorName,userId:actor.id,text:text(body.comment,'comentário',4000,true),createdAt:timestamp,version:proposal.version});
        else if (action === 'proposal.review') {
          if (!canReviewAccount(actor) || proposal.authorId===actor.id || !proposal.reviewers.includes(actor.id) || !['open','changes_requested','approved'].includes(proposal.status)) throw fail(403,'REVIEW_FORBIDDEN','Parecer reservado a um revisor atribuído.');
          if (proposal.baseHash!==requirement.contentHash) throw fail(409,'PROPOSAL_STALE','O requisito mudou. O autor deve atualizar a proposta antes da revisão.');
          if (!['approve','request_changes'].includes(body.decision)) throw fail(400,'INVALID_DECISION','Parecer inválido.');
          const comment=text(body.comment||'','parecer',4000,body.decision==='request_changes');after={decision:body.decision,comment,version:proposal.version};
          proposal.decisions=proposal.decisions.filter(d=>d.userId!==actor.id).concat({userId:actor.id,authorName:actorName,decision:body.decision,comment,version:proposal.version,createdAt:timestamp});
          proposal.status=proposal.decisions.some(d=>d.decision==='request_changes')?'changes_requested':proposal.reviewers.every(id=>proposal.decisions.some(d=>d.userId===id&&d.decision==='approve'))?'approved':'open';
        } else if (action === 'proposal.merge') {
          editor(requirement.sectorId);
          if(proposal.baseHash!==requirement.contentHash) throw fail(409,'PROPOSAL_STALE','O requisito mudou. Atualize a proposta e solicite novos pareceres.');
          if(proposal.status!=='approved' || !proposal.reviewers.every(id=>reviewerIds.has(id)&&proposal.decisions.some(d=>d.userId===id&&d.decision==='approve'&&d.version===proposal.version))) throw fail(409,'REVIEW_REQUIRED','Todos os revisores atuais precisam aprovar esta versão.');
          const source=baseline(record).find(r=>r.id===requirement.id), updated={...requirement,statement:proposal.statement,version:requirement.version+1,authorId:proposal.authorId,authorName:proposal.authorName,sourceHash:source?requirementSourceHash(record,source):null,reviewers:proposal.reviewers,decisions:[],reviewHash:null,updatedAt:timestamp};
          state.requirements=state.requirements.filter(r=>r.id!==requirement.id).concat(updated);
          const next=requirementsOf(record,state).find(r=>r.id===requirement.id);updated.reviewHash=next.contentHash;updated.decisions=proposal.decisions.map(d=>({...d,contentHash:next.contentHash}));
          proposal.status='merged';proposal.mergedAt=timestamp;proposal.mergedBy=actor.id;before=content(requirement);after=content(updated);
        } else if(action==='proposal.close') { if(proposal.authorId!==actor.id) editor(requirement.sectorId);if(proposal.status==='merged') throw fail(409,'PROPOSAL_CLOSED','A proposta já foi integrada.');proposal.status='closed'; }
        else throw fail(400,'INVALID_ACTION','Ação desconhecida.');
        proposal.updatedAt=timestamp;
      }
    } else if (action === 'test.save') {
      const old = body.id ? state.tests.find(t => t.id === body.id) : null;
      if (body.id && !old) throw fail(404, 'TEST_NOT_FOUND', 'Verificação não encontrada.');
      if (old) editor(old.sectorId);
      const sectorId = text(item.sectorId || '', 'setor', 100); editor(sectorId);
      if (!methods.includes(item.method) || item.method === 'unspecified') throw fail(400, 'INVALID_METHOD', 'Selecione um método de verificação.');
      const requirementIds = references(item.requirementIds, current.requirements.filter(r => !r.archived), 'requisitos');
      if (!requirementIds.length) throw fail(400, 'REQUIREMENT_REQUIRED', 'Associe pelo menos um requisito.');
      for (const id of requirementIds) editor(current.requirements.find(r => r.id === id).sectorId);
      eventId = old?.id || `VER-${randomUUID().slice(0, 8).toUpperCase()}`;
      const updated = { id: eventId, title: text(item.title, 'título', 200, true), method: item.method, procedure: text(item.procedure || '', 'procedimento', 10000), acceptanceCriteria: text(item.acceptanceCriteria || '', 'critério de aceitação', 8000), requirementIds, entityIds: references(item.entityIds, current.entities, 'elementos'), sectorId, ownerId: member(item.ownerId), conditions:text(item.conditions||'', 'condições do ensaio',4000), configuration:text(item.configuration||'', 'configuração',4000), level:['system','subsystem','component'].includes(item.level)?item.level:'system', reviewTaskIds:references(item.reviewTaskIds,current.tasks.filter(t=>!t.archived),'revisões'), runs: old?.runs || [], archived: old?.archived || false, version: (old?.version || 0) + 1, updatedAt: timestamp };
      state.tests = state.tests.filter(t => t.id !== eventId).concat(updated); before = old && testPlan(old); after = testPlan(updated);
    } else if (action === 'test.result' || action === 'test.archive' || action === 'test.restore') {
      const target = state.tests.find(t => t.id === body.id); if (!target) throw fail(404, 'TEST_NOT_FOUND', 'Verificação não encontrada.'); editor(target.sectorId);
      if (action !== 'test.result') target.archived = action === 'test.archive';
      else {
        if (target.archived) throw fail(409, 'ARCHIVED', 'Restaure a verificação antes de registrar um resultado.');
        if (!['passed', 'failed', 'inconclusive'].includes(item.outcome)) throw fail(400, 'INVALID_RESULT', 'Resultado inválido.');
        for (const id of target.requirementIds) { const requirement = current.requirements.find(r => r.id === id); if (requirement) editor(requirement.sectorId); }
        const result = text(item.result, 'resultado observado', 10000, true), artifactIds = references(item.artifactIds, current.artifacts, 'evidências');
        const evidenceUrl = text(item.evidenceUrl || '', 'link da evidência', 2000);
        if (evidenceUrl) { try { const u = new URL(evidenceUrl); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(); } catch { throw fail(400, 'INVALID_EVIDENCE_URL', 'Use um link HTTPS válido para a evidência.'); } }
        if (!target.procedure || !target.acceptanceCriteria || (!artifactIds.length && !evidenceUrl)) throw fail(400, 'EVIDENCE_REQUIRED', 'Registre procedimento, critério de aceitação e uma evidência antes de concluir.');
        if (target.requirementIds.some(id => !current.requirements.some(r => r.id === id && !r.archived))) throw fail(409, 'REQUIREMENT_ARCHIVED', 'Atualize os vínculos: há um requisito arquivado ou removido.');
        target.runs.push({ id: randomUUID(), outcome: item.outcome, result, artifactIds, evidenceUrl, userId: actor.id, authorName: actorName, createdAt: timestamp, planHash: hash(testPlan(target)), configurationHash:configurationHash(record), requirementHashes: Object.fromEntries(target.requirementIds.map(id => [id, current.requirements.find(r => r.id === id).contentHash])) });
      }
    } else if (action === 'task.save') {
      const old = body.id ? state.tasks.find(t => t.id === body.id) : null;
      if (body.id && !old) throw fail(404, 'TASK_NOT_FOUND', 'Atividade não encontrada.');
      if (old) editor(old.sectorId);
      const sectorId = text(item.sectorId || '', 'setor', 100); editor(sectorId);
      eventId = old?.id || `TASK-${randomUUID().slice(0, 8).toUpperCase()}`;
      const status = item.status || 'planned'; if (!statuses.includes(status)) throw fail(400, 'INVALID_STATUS', 'Situação inválida.');
      const startDate = date(item.startDate || ''), dueDate = date(item.dueDate || ''); if (startDate && dueDate && startDate > dueDate) throw fail(400, 'INVALID_DATE_RANGE', 'O prazo deve ser posterior ao início.');
      const dependencyIds = references(item.dependencyIds, state.tasks.filter(t => !t.archived), 'dependências');
      if (status === 'done' && dependencyIds.some(id => effectiveTaskStatus(state.tasks.find(t => t.id === id),current.requirements,current.tests) !== 'done')) throw fail(409, 'DEPENDENCIES_OPEN', 'Conclua as dependências antes desta atividade.');
      const prepDays = Number(item.prepDays ?? 0), closeDays = Number(item.closeDays ?? 0);
      if (![prepDays, closeDays].every(n => Number.isInteger(n) && n >= 0 && n <= 365)) throw fail(400, 'INVALID_DURATION', 'Use um período de 0 a 365 dias.');
      const phaseId=text(item.phaseId||'', 'fase',100);if(phaseId&&!current.lifecycleRanges.some(p=>p.id===phaseId))throw fail(400,'INVALID_PHASE','Fase não encontrada.');
      const updated = { ...(old || {}), phaseId, id: eventId, title: text(item.title, 'título', 200, true), description: text(item.description || '', 'descrição', 8000), phase: text(item.phase || '', 'fase', 100), kind: item.kind === 'review' ? 'review' : 'task', startDate, dueDate, prepDays, closeDays, status, sectorId, ownerId: member(item.ownerId), dependencyIds, requirementIds: references(item.requirementIds, current.requirements.filter(r => !r.archived), 'requisitos'), testIds: references(item.testIds, state.tests.filter(t => !t.archived), 'verificações'), inputArtifactIds: references(item.inputArtifactIds, current.artifacts, 'entradas'), outputArtifactIds: references(item.outputArtifactIds, current.artifacts, 'saídas'), archived: old?.archived || false, updatedAt: timestamp, manual: true };
      if(updated.kind==='review'&&updated.status==='done'&&(updated.requirementIds.some(id=>current.requirements.find(r=>r.id===id)?.status!=='approved')||updated.testIds.some(id=>current.tests.find(t=>t.id===id)?.status!=='passed'))) throw fail(409,'REVIEW_EVIDENCE_PENDING','Para concluir esta revisão, aprove as versões dos requisitos vinculados e registre evidência atual de atendimento nas verificações vinculadas.');
      state.tasks = state.tasks.filter(t => t.id !== eventId).concat(updated); graphAcyclic(state.tasks.filter(t => !t.archived), 'dependencyIds'); before = old; after = updated;
    } else if(action==='task.reschedule') {
      const target=state.tasks.find(t=>t.id===body.id);if(!target||target.archived)throw fail(404,'TASK_NOT_FOUND','Atividade não disponível.');editor(target.sectorId);
      const dueDate=date(body.dueDate);if(!dueDate)throw fail(400,'INVALID_DATE','Informe a nova data.');
      const previous=target.dueDate||target.startDate||dueDate,delta=Math.round((Date.parse(dueDate)-Date.parse(previous))/86400000);before={startDate:target.startDate,dueDate:target.dueDate};
      target.startDate=target.startDate?shiftDate(target.startDate,delta):dueDate;target.dueDate=dueDate;target.manual=true;target.updatedAt=timestamp;after={startDate:target.startDate,dueDate};
    } else if (action === 'task.archive'  || action === 'task.restore') {
      const target = state.tasks.find(t => t.id === body.id); if (!target) throw fail(404, 'TASK_NOT_FOUND', 'Atividade não encontrada.'); editor(target.sectorId);
      if (action === 'task.archive' && state.tasks.some(t => !t.archived && t.dependencyIds.includes(target.id))) throw fail(409, 'TASK_IN_USE', 'Remova as dependências antes de arquivar.');
      target.archived = action === 'task.archive'; graphAcyclic(state.tasks.filter(t => !t.archived), 'dependencyIds');
    } else if(action==='lifecycle.configure') {
      admin();const profile=body.profile;
      if(!Object.hasOwn(LIFE_PHASES,profile)) throw fail(400,'INVALID_PROFILE','Perfil inválido.');
      const startDate=date(body.startDate), durations=body.durations||LIFE_DURATIONS[profile];
      if(!startDate || !Array.isArray(durations) || durations.length!==LIFE_PHASES[profile].length || durations.some(v=>!Number.isInteger(v)||v<1||v>520)) throw fail(400,'INVALID_DURATION','Informe início e duração de cada fase entre 1 e 520 semanas.');
      const lifecycle={profile,startDate,durations,updatedAt:timestamp,version:(state.lifecycle?.version||0)+1};
      if(body.phases!==undefined){
        if(body.expectedLifecycleVersion!==(state.lifecycle?.version||0))throw fail(409,'LIFECYCLE_CHANGED','As fases mudaram durante a edição. Feche a configuração e abra a versão atual.');
        if(!Array.isArray(body.phases)||body.phases.length>30)throw fail(400,'INVALID_PHASES','Use até 30 fases.');
        lifecycle.phases=body.phases.map(p=>{if(!p||typeof p!=='object'||Array.isArray(p))throw fail(400,'INVALID_PHASE','Fase inválida.');const start=date(p.start),end=date(p.end);if(!start||!end||end<start)throw fail(400,'INVALID_PHASE_DATES','O fim de cada fase deve ser igual ou posterior ao início.');return {id:text(p.id,'identificador da fase',100,true),code:text(p.code,'código da fase',30,true),name:text(p.name,'nome da fase',100,true),start,end,...(p.templateCode?{templateCode:text(p.templateCode,'referência da fase',30)}:{})};});
        if(new Set(lifecycle.phases.map(p=>p.id)).size!==lifecycle.phases.length||new Set(lifecycle.phases.filter(p=>p.templateCode).map(p=>p.templateCode)).size!==lifecycle.phases.filter(p=>p.templateCode).length)throw fail(400,'DUPLICATE_PHASE','Cada fase deve ter um identificador e uma referência únicos.');
        if(lifecycle.phases.some(p=>p.templateCode&&!LIFE_PHASES[profile].some(([code])=>code===p.templateCode)))throw fail(400,'INVALID_PHASE','Referência de fase inválida para este modelo.');
      }
      const previousRanges=state.lifecycle?lifecycleRanges(state.lifecycle):[];
      for(const task of state.tasks.filter(t=>t.lifecycleProfile===profile&&!Object.hasOwn(t,'phaseId'))){task.phaseId=previousRanges[task.phaseIndex]?.id||'';}
      const definitions=lifecycleMilestones(lifecycle),ranges=lifecycleRanges(lifecycle),phaseIds=new Set(ranges.map(p=>p.id));
      const selected=body.selectedReviews===undefined?definitions.filter(r=>r.active).map(r=>r.id):references(body.selectedReviews,definitions,'revisões');
      lifecycle.selectedReviews=selected;before=state.lifecycle||null;state.lifecycle=lifecycle;
      for(const task of state.tasks.filter(t=>!t.lifecycleProfile||t.lifecycleProfile===profile)){
        if(task.phaseId&&!phaseIds.has(task.phaseId)){task.phaseId='';task.phase='';task.manual=true;}
        else if(task.phaseId){task.phase=ranges.find(p=>p.id===task.phaseId).name;}
      }
      for(const definition of definitions) {
        const old=state.tasks.find(t=>t.lifecycleProfile===profile&&t.reviewCode===definition.id);
        if(old){old.excluded=!selected.includes(definition.id);old.phaseId=definition.phaseId;old.phase=definition.phaseName;if(!old.manual){old.startDate=definition.date;old.dueDate=definition.date;}continue;}
        state.tasks.push({id:`TASK-${randomUUID().slice(0,8).toUpperCase()}`,reviewCode:definition.id,lifecycleProfile:profile,lane:definition.lane,phaseIndex:definition.phase,phaseId:definition.phaseId,excluded:!selected.includes(definition.id),title:`${definition.id} · ${definition.title}`,phase:definition.phaseName,description:definition.focus,kind:'review',startDate:definition.date,dueDate:definition.date,prepDays:10,closeDays:7,status:'planned',sectorId:'',ownerId:'',dependencyIds:[],requirementIds:[],testIds:[],inputArtifactIds:[],outputArtifactIds:[],archived:false,updatedAt:timestamp,manual:false});
      }
      after=lifecycle;
    } else if(action==='document.prepare') {
      const task=current.tasks.find(t=>t.id===body.taskId);if(!task)throw fail(404,'TASK_NOT_FOUND','Revisão indisponível.');editor(task.sectorId);
      const definitions=reviewDocuments(task.lifecycleProfile||state.lifecycle?.profile||'custom',task.reviewCode||'');
      const definition=definitions.find(d=>d.id===body.templateId);if(!definition)throw fail(400,'INVALID_DOCUMENT','Documento não pertence ao pacote desta revisão.');
      const existing=state.documents.find(d=>d.taskId===task.id&&d.templateId===definition.id);if(existing)throw fail(409,'DOCUMENT_EXISTS','O rascunho já está preparado; abra sua versão atual.');
      const document={id:`DOC-${randomUUID().slice(0,8).toUpperCase()}`,taskId:task.id,templateId:definition.id,title:definition.title,flow:definition.flow,reference:definition.reference,body:draftDeliveryDocument(definition,project,current.requirements,current.tests,task),status:'draft',version:1,authorId:actor.id,authorName:actorName,createdAt:timestamp,updatedAt:timestamp,sourceRevision:state.revision};
      state.documents.push(document);eventId=document.id;after={title:document.title,version:1};
    } else if(action==='document.save') {
      const document=state.documents.find(d=>d.id===body.id),task=state.tasks.find(t=>t.id===document?.taskId);if(!document||!task)throw fail(404,'DOCUMENT_NOT_FOUND','Documento indisponível.');editor(task.sectorId);
      if(item.version!==document.version)throw fail(409,'DOCUMENT_CHANGED','O documento mudou; abra a versão atual.');
      before={body:document.body,version:document.version};document.body=text(item.body,'conteúdo do documento',150000,true);document.version++;document.status='draft';document.updatedAt=timestamp;eventId=document.id;after={body:document.body,version:document.version};
    } else if (action === 'schedule.template') {
      admin(); const start = date(body.startDate); if (!start) throw fail(400, 'INVALID_DATE', 'Selecione a data inicial.');
      if (!['nasa', 'ecss', 'custom'].includes(body.profile)) throw fail(400, 'INVALID_PROFILE', 'Perfil inválido.');
      if (state.tasks.some(t => !t.archived)) throw fail(409, 'SCHEDULE_EXISTS', 'O cronograma já tem atividades. Edite os marcos existentes ou arquive-os antes de aplicar outro modelo.');
      const definitions = body.profile === 'custom' ? [['KICKOFF', 'Abertura do projeto', 'Concepção', 0], ['DELIVERY', 'Entrega do projeto', 'Entrega', 90]] : [['MCR', 'Revisão do conceito', 'Concepção', 0], ['SRR', 'Revisão dos requisitos', 'Definição', 21], ['PDR', 'Revisão preliminar do projeto', 'Projeto preliminar', 45], ['CDR', 'Revisão crítica do projeto', 'Projeto detalhado', 75], ['TRR', 'Prontidão para testes', 'Integração e testes', 105], [body.profile === 'ecss' ? 'QR' : 'SAR', body.profile === 'ecss' ? 'Revisão de qualificação' : 'Aceitação do sistema', 'Verificação', 135], ['ORR', 'Prontidão operacional', 'Operações', 150]];
      const created = definitions.map(([code, title, phase, offset]) => { const dueDate = new Date(Date.parse(start) + offset * 86400000).toISOString().slice(0, 10); return { id: `TASK-${randomUUID().slice(0, 8).toUpperCase()}`, title: `${code} · ${title}`, phase, description: 'Modelo de planejamento adaptável. Revise critérios, entregas e datas com a equipe; esta seleção não declara conformidade normativa.', kind: 'review', startDate: dueDate, dueDate, prepDays: 7, closeDays: 7, status: 'planned', sectorId: '', ownerId: '', dependencyIds: [], requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [], archived: false, updatedAt: timestamp, manual: false }; });
      created.forEach((task, index) => { if (index) task.dependencyIds = [created[index - 1].id]; }); state.tasks.push(...created);
    } else throw fail(400, 'INVALID_ACTION', 'Ação desconhecida.');
    if (state.standardsProposals.length > 3000 || state.proposals.length > 3000 || state.documents.length > 3000 || state.requirements.length > 3000 || state.tests.length > 3000 || state.tasks.length > 3000) throw fail(400, 'DELIVERY_LIMIT', 'Limite de registros atingido.');
    state.revision++;
    state.history.push({ id: randomUUID(), revision: state.revision, action, subjectId: eventId, actorId: actor.id, actorName, createdAt: timestamp, ...(action.startsWith('proposal.')?{requirementId:state.proposals.find(p=>p.id===eventId)?.requirementId}:{}), before, after });
    data.workspace.delivery ||= {}; data.workspace.delivery[project.id] = state;
    return view(data, record, state, actor, canAccessProject);
  }));
}
