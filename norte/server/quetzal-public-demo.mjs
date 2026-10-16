/** Portable, public-data-only demo. No live-store access, provider calls or credentials. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateEngineeringSystem } from '../shared/engineering-schema.mjs';
import { technicalHierarchyError } from '../shared/technical-hierarchy.mjs';
import { seedQuetzalWorkspace } from '../scripts/seed-quetzal-workspace.mjs';
import { seedMeetingExamples } from '../scripts/seed-meeting-examples.mjs';
import { seedDeliveryDemo } from './delivery-demo.mjs';
import { VALIDATION_DOCUMENTS_MISSING_MESSAGE } from './validation-documents.mjs';
const fixture = JSON.parse(readFileSync(new URL('../data/quetzal-public-model-v1.json', import.meta.url), 'utf8'));
if (!validateEngineeringSystem(fixture.model) || technicalHierarchyError(fixture.model)) throw new Error('PUBLIC_QUETZAL_MODEL_INVALID');
function target(data, projectId, actorId) {
  const record = Object.hasOwn(data.workspace?.projects || {}, projectId) && data.workspace.projects[projectId];
  const actor = data.users?.find(u => u.id === actorId && u.active), team = data.teams?.find(t => t.id === record?.document.context.teamId);
  const sandbox = record?.demoSandboxId;
  if (!record || !actor || !sandbox || !actor.demoSandboxOwner || !actor.isDemoAccount || actor.demoSandboxId !== sandbox || record.document.demoSandboxId !== sandbox || team?.demoSandboxId !== sandbox || record.createdBy !== actorId || team.captainMemberId !== actor.memberId || !team.memberIds.includes(actor.memberId)) throw new Error('PUBLIC_QUETZAL_DEMO_SCOPE');
  return record;
}
function sourceMapping(data, projectId) {
  const mapping = new Map();
  for (const source of fixture.sources) {
    const matches = data.artifacts.filter(a => a.scope === 'project' && a.ownerId === projectId && (a.provenance?.sourceId === source.sourceId || a.fileName === `${source.sourceId}.txt`));
    if (matches.length !== 1 || typeof matches[0].documentText !== 'string' || createHash('sha256').update(matches[0].documentText).digest('hex') !== source.sha256) throw Object.assign(new Error(VALIDATION_DOCUMENTS_MISSING_MESSAGE), { statusCode: 503, code: 'VALIDATION_DOCUMENTS_MISSING' });
    mapping.set(source.sourceId, matches[0].id);
  }
  return mapping;
}
/** Mutates only caller-owned data; refuses to replace any existing map. */
export function seedPublicQuetzalModel(data, { projectId, actorId } = {}) {
  const record = target(data, projectId, actorId);
  if (record.publicQuetzalModelFixture || record.document.engineeringSystem) return { changed: false, reason: 'existing_model_preserved' };
  const mapping = sourceMapping(data, projectId), model = structuredClone(fixture.model), report = structuredClone(fixture.extractionReport);
  for (const evidence of model.evidence) evidence.artifactId = mapping.get(evidence.artifactId);
  for (const source of model.artifactSources) source.artifactId = mapping.get(source.artifactId);
  for (const doc of report.documents) doc.artifactId = mapping.get(doc.artifactId);
  for (const omission of report.omissions) omission.artifactId = mapping.get(omission.artifactId);
  report.reviewNotes = fixture.audit.pending.map((note, index) => ({ id: `public-architecture-${index + 1}`, title: note.title, reason: note.reason, artifactIds: note.sourceIds.map(id => mapping.get(id)), entityId: note.entityIds[0] || null }));
  report.fixtureLabel = fixture.description;
  model.id = `${projectId}-public-model`;
  model.generatedFromRevision = record.document.memoryRevision;
  if (!validateEngineeringSystem(model) || technicalHierarchyError(model)) throw new Error('PUBLIC_QUETZAL_MODEL_REMAP_INVALID');
  const knownArtifacts = new Set(mapping.values());
  if (model.evidence.some(e => !knownArtifacts.has(e.artifactId))) throw new Error('PUBLIC_QUETZAL_EVIDENCE_OUTSIDE_PROJECT');
  record.document.engineeringSystem = model;
  record.document.systemGeneratedFromRevision = model.generatedFromRevision;
  record.document.phaseProgress = { ...record.document.phaseProgress, highestUnlockedStep: Math.max(1, record.document.phaseProgress?.highestUnlockedStep || 0) };
  record.document.context.summary ||= { scope: '', nextSteps: '' };
  record.document.context.summary.scope = `${fixture.description}. ${record.document.context.summary.scope}`.trim();
  record.extractionReport = report;
  record.publicQuetzalModelFixture = { version: fixture.version, description: fixture.description, sources: structuredClone(fixture.sources), corrections: structuredClone(fixture.audit.corrections), pending: structuredClone(fixture.audit.pending), safeguards: structuredClone(fixture.audit.safeguards) };
  record.revision = (record.revision || 0) + 1;
  return { changed: true, entities: model.entities.length, documents: mapping.size, pendingReview: true, providerCalls: 0 };
}
/** Compose only a newly-created validation sandbox. Existing work is never replaced.
 * Build on a clone; on error nothing in data is modified. Call inside store.update. */
export function preparePublicQuetzalDemo(data, { projectId, actorId } = {}) {
  const record = target(data, projectId, actorId);
  if (record.publicQuetzalDemoFixture?.version === 1) return { changed: false, alreadyPrepared: true };
  if (record.document.engineeringSystem || record.quetzalWorkspaceFixture || record.extractionReport || record.engineeringHistory?.length || record.revision !== 1) return { changed: false, reason: 'existing_workspace_preserved' };
  sourceMapping(data, projectId);
  const workspace = seedQuetzalWorkspace(data, { projectId, actorId });
  let candidate = workspace.data;
  const model = seedPublicQuetzalModel(candidate, { projectId, actorId });
  const delivery = seedDeliveryDemo(candidate, projectId, actorId);
  const meetings = seedMeetingExamples(candidate, { projectId, actorId }); candidate = meetings.data;
  candidate.workspace.projects[projectId].publicQuetzalDemoFixture = { version: 1, publicSources: true, illustrativePeopleAndPlanning: true };
  Object.assign(data, candidate);
  return { changed: true, workspace: workspace.audit, model, delivery, meetings: meetings.audit };
}
