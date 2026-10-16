import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createInitialData } from './data-store.mjs';
import { createDemoSandbox } from './demo-account.mjs';
import { seedPublicQuetzalModel } from './quetzal-public-demo.mjs';
import { prepareExistingQuetzalDemo } from '../scripts/prepare-existing-quetzal-demo.mjs';
const hash = model => createHash('sha256').update(JSON.stringify(model)).digest('hex');
function fixture() { const data = createInitialData(), actor = createDemoSandbox(data, undefined, { profile: 'validation' }), projectId = `${actor.demoSandboxId}-quetzal-1`; seedPublicQuetzalModel(data, { projectId, actorId: actor.id }); const model = data.workspace.projects[projectId].document.engineeringSystem; data.workspace.projects[projectId].document.memoryRevision += 3; return { data, actorId: actor.id, projectId, expectedModelSha256: hash(model) }; }
test('existing demo continuity preserves exact technical baseline and originals, archives history and is idempotent', () => {
  const { data, ...options } = fixture(), before = structuredClone(data), old = before.workspace.projects[options.projectId];
  const result = prepareExistingQuetzalDemo(data, options), record = result.data.workspace.projects[options.projectId];
  assert.deepEqual(data, before); assert.equal(record.document.engineeringSystem.generatedFromRevision, record.document.memoryRevision);
  for (const key of ['entities','relations','requirements','evidence','corrections']) assert.deepEqual(record.document.engineeringSystem[key], old.document.engineeringSystem[key]);
  assert.deepEqual(record.engineeringHistory.at(-1).engineeringSystem, old.document.engineeringSystem);
  for (const source of before.artifacts) { const next = result.data.artifacts.find(a => a.id === source.id); assert.equal(next.documentText, source.documentText); assert.equal(next.url, source.url); }
  assert.equal(result.audit.preserved.technicalFacts, true);
  assert.deepEqual(prepareExistingQuetzalDemo(result.data, options).data, result.data);
});
test('existing demo proposal refuses changed map or changed source without any mutations', () => {
  const { data, ...options } = fixture(); const changed = structuredClone(data); changed.workspace.projects[options.projectId].document.engineeringSystem.name = 'Different reviewed model';
  assert.throws(() => prepareExistingQuetzalDemo(changed, options), /changed since/);
  data.artifacts.find(a => a.ownerId === options.projectId).documentText += '\nA new engineering revision';
  const before = structuredClone(data); assert.throws(() => prepareExistingQuetzalDemo(data, options), /Source.*changed/); assert.deepEqual(data, before);
});
