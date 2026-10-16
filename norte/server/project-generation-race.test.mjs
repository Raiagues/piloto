import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { createEngineeringValidationModel } from '../examples/engineering-validation.mjs';

test('an older tab cannot replace a regenerated map through project or legacy autosave', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'norte-generation-race-'));
  const app = await buildApp({ logger: false, storeFile: join(directory, 'state.json'), demoAccount: false });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const registration = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Review owner', nickname: 'review_owner', email: 'review@example.test', password: 'generation validation passphrase' } });
  assert.equal(registration.statusCode, 201, registration.body);
  const headers = { cookie: [registration.headers['set-cookie']].flat().map(value => value.split(';')[0]).join('; '), 'x-csrf-token': registration.json().csrfToken };
  const initial = createValidationProject();
  initial.id = 'generation-race'; initial.context.teamId = null;
  initial.engineeringSystem = createEngineeringValidationModel();
  initial.engineeringSystem.generatedAt = '2026-10-15T12:00:00.000Z';
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: initial });
  assert.equal(created.statusCode, 201, created.body);
  const stale = created.json().project;
  // Represent an already applied, reviewed second generation. Provider output
  // is deliberately absent: this test exercises the later browser save race.
  await app.missionStore.update(data => {
    const record = data.workspace.projects[initial.id];
    record.document.engineeringSystem.generatedAt = '2026-10-15T13:00:00.000Z';
    record.document.engineeringSystem.entities[0].name = 'Current reviewed system';
    record.revision += 1;
  });
  const current = structuredClone(app.missionStore.read().workspace.projects[initial.id].document.engineeringSystem);
  for (const url of ['/api/projects/' + initial.id, '/api/workspace/project']) {
    const result = await app.inject({ method: 'PUT', url, headers, payload: { ...stale, navigation: { lastRoute: 'setup' } } });
    assert.equal(result.statusCode, 409, result.body);
    assert.equal(result.json().error, 'SYSTEM_BASELINE_CHANGED');
    assert.deepEqual(app.missionStore.read().workspace.projects[initial.id].document.engineeringSystem, current);
  }
  const withoutMap = structuredClone(stale); delete withoutMap.engineeringSystem;
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/' + initial.id, headers, payload: withoutMap });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual(saved.json().project.engineeringSystem, current, 'an old pre-generation snapshot preserves the current map');
  const edit = saved.json().project;
  edit.engineeringSystem.entities[0].name = 'Explicit edit of current generation';
  const edited = await app.inject({ method: 'PUT', url: '/api/projects/' + initial.id, headers, payload: edit });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().project.engineeringSystem.entities[0].name, 'Explicit edit of current generation');
});
