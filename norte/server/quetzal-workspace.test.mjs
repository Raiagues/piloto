import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialData } from './data-store.mjs';
import { createDemoSandbox } from './demo-account.mjs';
import { seedQuetzalWorkspace, QUETZAL_WORKSPACE_DOCUMENT_IDS } from '../scripts/seed-quetzal-workspace.mjs';
import { canEditSector, folderSector, organizationError } from '../shared/project-organization.mjs';
const documents = QUETZAL_WORKSPACE_DOCUMENT_IDS.map(id => ({ id, title: id, fileName: `${id}.txt`, text: 'Isolated fixture bytes; never engineering evidence.', provenance: { role: 'project_context' } }));
function fixture() { const data = createInitialData(), actor = createDemoSandbox(data, undefined, { profile: 'validation', documents }), projectId = `${actor.demoSandboxId}-quetzal-1`; return { data, actor, projectId }; }
test('Quetzal organization is opt-in, idempotent and preserves 17 sources, architecture and other accounts', () => {
  const { data, actor, projectId } = fixture(); const original = structuredClone(data);
  data.workspace.projects[projectId].document.engineeringSystem = { entities: [{ id: 'preserved', kind: 'subsystem', name: 'Existing reviewed object' }], relations: [], requirements: [] };
  const model = structuredClone(data.workspace.projects[projectId].document.engineeringSystem);
  const result = seedQuetzalWorkspace(data, { projectId, actorId: actor.id });
  assert.equal(result.audit.moves.length, 17); assert.equal(result.audit.fictionalPeople.length, 7); assert.equal(result.audit.preserved.originalBytes, true);
  assert.equal(data.users.length, original.users.length, 'input clone never mutates caller');
  assert.deepEqual(result.data.workspace.projects[projectId].document.engineeringSystem, model);
  for (const artifact of data.artifacts) { const next = result.data.artifacts.find(a => a.id === artifact.id); assert.equal(next.url, artifact.url); assert.equal(next.documentText, artifact.documentText); }
  for (const user of original.users) assert.deepEqual(result.data.users.find(u => u.id === user.id), user);
  for (const [id, record] of Object.entries(original.workspace.projects)) if (id !== projectId) assert.deepEqual(result.data.workspace.projects[id], record);
  const project = result.data.workspace.projects[projectId].document;
  assert.equal(organizationError(project), null); assert.equal(project.context.sectors.length, 5);
  const epsFile = result.data.artifacts.find(a => a.id.endsWith('ti-ina260-datasheet')), adcsFile = result.data.artifacts.find(a => a.id.endsWith('quetzal-adcs-hardware'));
  const manager = result.data.users.find(u => u.name === 'Bruno · EXEMPLO'), member = result.data.users.find(u => u.name === 'Felipe · EXEMPLO');
  for (const user of [manager, member]) { assert.equal(canEditSector(project, user, folderSector(project, epsFile.folderId)), true); assert.equal(canEditSector(project, user, folderSector(project, adcsFile.folderId)), false); assert.equal(user.demoSandboxId, actor.demoSandboxId); assert.equal(user.passwordHash, 'demo-account-without-password'); }
  assert.equal(result.data.sessions.length, data.sessions.length); assert.equal(result.data.invitations.length, data.invitations.length);
  const repeated = seedQuetzalWorkspace(result.data, { projectId, actorId: actor.id });
  assert.deepEqual(repeated.data, result.data); assert.equal(repeated.audit.changed, false);
});
test('Quetzal seed rejects different sandboxes, missing documents and ordinary live projects', () => {
  const { data, actor, projectId } = fixture(), other = createDemoSandbox(data, undefined, { profile: 'validation', documents });
  assert.throws(() => seedQuetzalWorkspace(data, { projectId, actorId: other.id }), /administrar/);
  const incomplete = structuredClone(data); incomplete.artifacts = incomplete.artifacts.filter(a => !a.id.endsWith('quetzal-adcs-software'));
  assert.throws(() => seedQuetzalWorkspace(incomplete, { projectId, actorId: actor.id }), /17 documentos/);
  const record = data.workspace.projects[projectId]; delete record.demoSandboxId; delete record.document.demoSandboxId;
  assert.throws(() => seedQuetzalWorkspace(data, { projectId, actorId: actor.id }), /cópia local/);
});
