import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createInitialData } from './data-store.mjs';
import { createDemoSandbox } from './demo-account.mjs';
import { seedPublicQuetzalModel, preparePublicQuetzalDemo } from './quetzal-public-demo.mjs';
import { validateEngineeringSystem } from '../shared/engineering-schema.mjs';
import { technicalHierarchyError } from '../shared/technical-hierarchy.mjs';
import { projectKnowledgeItems } from '../shared/project-knowledge.mjs';
function fixture() { const data = createInitialData(), actor = createDemoSandbox(data, undefined, { profile: 'validation' }), projectId = `${actor.demoSandboxId}-quetzal-1`; return { data, actor, projectId }; }
test('public fixture exports engineering/public citations only, and corrects the I2C address owner', () => {
  const fixture = JSON.parse(readFileSync(new URL('../data/quetzal-public-model-v1.json', import.meta.url), 'utf8'));
  assert.equal(fixture.sources.length, 17); assert.equal(fixture.model.entities.length, 87);
  assert(!JSON.stringify(fixture).includes('demo-f41'));
  for (const key of ['users','sessions','passwordHash','memberId','actorId','createdBy','correctedBy','email']) assert(!JSON.stringify(fixture).includes(`"${key}"`));
  assert.equal(fixture.model.corrections, undefined); assert.equal(fixture.model.scenarios, undefined);
  assert(validateEngineeringSystem(fixture.model)); assert.equal(technicalHierarchyError(fixture.model), null);
  assert.equal(fixture.model.entities.find(e => e.name === 'Main I2C Bus').properties.some(p => p.key === 'slave_address'), false);
  assert.equal(fixture.model.entities.find(e => e.name === 'EPS Microcontroller').properties.find(p => p.key === 'slave_address').value, '0x99');
  assert(fixture.model.requirements.every(r => r.status === 'unreviewed'));
});
test('composed validation demo is complete, source-scoped, idempotent and preserves unrelated projects', () => {
  const { data, actor, projectId } = fixture(), before = structuredClone(data);
  const result = preparePublicQuetzalDemo(data, { projectId, actorId: actor.id }); assert(result.changed);
  const record = data.workspace.projects[projectId], model = record.document.engineeringSystem;
  assert.equal(model.entities.length, 87); assert.equal(model.generatedFromRevision, record.document.memoryRevision);
  assert.equal(record.document.context.sectors.length, 5);
  assert.equal(data.users.filter(u => u.demoSandboxId === actor.demoSandboxId).length, 8);
  const sources = data.artifacts.filter(a => a.ownerId === projectId), sourceIds = new Set(sources.map(a => a.id));
  assert.equal(sources.length, 17); assert(model.evidence.every(e => sourceIds.has(e.artifactId)));
  assert(record.extractionReport.omissions.every(i => sourceIds.has(i.artifactId)));
  assert(record.extractionReport.documents.every(d => sourceIds.has(d.artifactId)));
  const review = projectKnowledgeItems(record.document, record.extractionReport); assert(review.slice(0,5).every(i => i.kind === 'architecture'));
  assert(review.flatMap(i => i.artifactIds).every(id => sourceIds.has(id)));
  assert(data.workspace.delivery[projectId].tests.length > 0); assert(data.workspace.delivery[projectId].tests.every(t => t.runs.length === 0));
  const meetings = Object.values(data.meetings).filter(m => m.projectId === projectId); assert.equal(meetings.length, 2); assert(meetings.every(m => m.example === 'curated_mock_v1' && m.demoSandboxId === actor.demoSandboxId));
  for (const a of before.artifacts) { const updated = data.artifacts.find(next => next.id === a.id); assert.equal(updated.url, a.url); assert.equal(updated.documentText, a.documentText); }
  for (const [id, project] of Object.entries(before.workspace.projects)) if (id !== projectId) assert.deepEqual(data.workspace.projects[id], project);
  for (const user of before.users) assert.deepEqual(data.users.find(u => u.id === user.id), user);
  assert.deepEqual(data.sessions, before.sessions); assert.deepEqual(data.invitations, before.invitations);
  const prepared = structuredClone(data); assert.equal(preparePublicQuetzalDemo(data, { projectId, actorId: actor.id }).changed, false); assert.deepEqual(data, prepared);
});
test('two demos remap every source independently, prevent cross-sandbox use and preserve edited/existing maps', () => {
  const { data, actor, projectId } = fixture(); const other = createDemoSandbox(data, undefined, { profile: 'validation' }), otherId = `${other.demoSandboxId}-quetzal-1`;
  const before = structuredClone(data); assert.throws(() => seedPublicQuetzalModel(data, { projectId, actorId: other.id }), /SCOPE/); assert.deepEqual(data, before);
  preparePublicQuetzalDemo(data, { projectId, actorId: actor.id }); preparePublicQuetzalDemo(data, { projectId: otherId, actorId: other.id });
  const firstIds = new Set(data.workspace.projects[projectId].document.engineeringSystem.evidence.map(e => e.artifactId));
  assert(data.workspace.projects[otherId].document.engineeringSystem.evidence.every(e => !firstIds.has(e.artifactId) && e.artifactId.startsWith(otherId)));
  const model = data.workspace.projects[projectId].document.engineeringSystem; model.name = 'Reviewed by this visitor';
  assert.equal(seedPublicQuetzalModel(data, { projectId, actorId: actor.id }).changed, false); assert.equal(model.name, 'Reviewed by this visitor');
  const ordinary = structuredClone(before); delete ordinary.workspace.projects[projectId].demoSandboxId; assert.throws(() => seedPublicQuetzalModel(ordinary, { projectId, actorId: actor.id }), /SCOPE/);
  const existing = structuredClone(before); existing.workspace.projects[projectId].revision = 2; const unchanged = structuredClone(existing);
  assert.equal(preparePublicQuetzalDemo(existing, { projectId, actorId: actor.id }).changed, false); assert.deepEqual(existing, unchanged);
});
test('changed public source fails atomically before creating people, plans or maps', () => {
  const { data, actor, projectId } = fixture(); data.artifacts.find(a => a.ownerId === projectId).documentText += '\nChanged locally';
  const before = structuredClone(data); assert.throws(() => preparePublicQuetzalDemo(data, { projectId, actorId: actor.id }), { statusCode: 503, code: 'VALIDATION_DOCUMENTS_MISSING' }); assert.deepEqual(data, before);
});
