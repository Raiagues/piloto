import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { organizationError } from '../shared/project-organization.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'norte-memory-'));
  const app = await buildApp({ storeFile: join(dir, 'state.json'), logger: false });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const accounts = [];
  for (const name of ['Captain', 'Editor', 'Reader', 'Outsider']) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, email: `${name}@example.test`, password: 'only an isolated test passphrase' } });
    assert.equal(response.statusCode, 201, response.body);
    accounts.push({ ...response.json().user, headers: { cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().csrfToken } });
  }
  const [captain, editor, reader, outsider] = accounts;
  const request = (actor, method, path, payload) => app.inject({ method, url: `/api${path}`, headers: actor?.headers || {}, ...(payload ? { payload } : {}) });
  const team = (await request(captain, 'POST', '/teams', { name: 'Memory team' })).json().team;
  for (const user of [editor, reader]) {
    const invite = await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: user.nickname });
    assert.equal((await request(user, 'POST', `/invitations/${invite.json().invitation.id}/respond`, { decision: 'accept' })).statusCode, 200);
  }
  const project = { ...createValidationProject(), id: 'memory-project', name: 'Memory project' };
  project.context = { ...project.context, teamId: team.id, teamName: team.name, sectors: [{ id: 'eps', name: 'EPS' }, { id: 'adcs', name: 'ADCS' }], folders: [{ id: 'components', name: 'Components', parentId: 'eps' }], assignments: [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }, { memberId: editor.memberId, roleId: 'member', sectorId: 'eps' }, { memberId: reader.memberId, roleId: 'advisor', sectorId: '' }] };
  assert.equal((await request(captain, 'POST', '/projects', project)).statusCode, 201);
  const artifacts = [];
  for (const folderId of ['components', 'adcs']) {
    const response = await request(captain, 'POST', '/artifacts', { kind: 'document', label: `${folderId} reference`, scope: 'project', ownerId: project.id, folderId, documentText: 'Verified original source text.' });
    assert.equal(response.statusCode, 201, response.body); artifacts.push(response.json().artifact);
  }
  await app.missionStore.update(data => { data.workspace.projects[project.id].extractionReport = { completedAt: '2026-10-15T12:00:00Z', documents: artifacts.map(a => ({ artifactId: a.id, label: a.label, complete: true })), omissions: artifacts.map(a => ({ chunkId: a.id, artifactId: a.id, kind: 'property', id: 'power', name: 'Power', reason: 'Two revisions require comparison.' })) }; });
  return { app, request, captain, editor, reader, outsider, project, artifacts };
}

test('artifact edits and moves use atomic revision comparison and both source/destination grants', async t => {
  const { app, request, captain, editor, reader, outsider, artifacts: [a, b] } = await fixture(t);
  assert.equal((await request(captain, 'PATCH', `/artifacts/${a.id}`, { label: 'Missing revision' })).statusCode, 409);
  assert.equal((await request(editor, 'PATCH', `/artifacts/${a.id}`, { folderId: 'adcs', expectedRevision: 0 })).statusCode, 403);
  assert.equal((await request(editor, 'PATCH', `/artifacts/${b.id}`, { folderId: 'components', expectedRevision: 0 })).statusCode, 403);
  assert.equal((await request(reader, 'PATCH', `/artifacts/${a.id}`, { label: 'Forbidden', expectedRevision: 0 })).statusCode, 403);
  assert.equal((await request(outsider, 'PATCH', `/artifacts/${a.id}`, { label: 'Forbidden', expectedRevision: 0 })).statusCode, 403);
  const responses = await Promise.all(['First', 'Second'].map(label => request(editor, 'PATCH', `/artifacts/${a.id}`, { label, expectedRevision: 0 })));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  const winner = responses.find(r => r.statusCode === 200).json().artifact;
  assert.equal(winner.revision, 1);
  assert.equal((await request(captain, 'PATCH', `/artifacts/${a.id}`, { folderId: 'adcs', expectedRevision: 0 })).statusCode, 409);
  const persisted = app.missionStore.read().artifacts.find(x => x.id === a.id);
  assert.equal(persisted.label, winner.label); assert.equal(persisted.folderId, 'components'); assert.equal(persisted.documentText, 'Verified original source text.');
  assert.equal((await request(captain, 'PATCH', `/artifacts/${a.id}`, { folderId: 'adcs', expectedRevision: 1 })).statusCode, 200);
  assert.equal((await request(editor, 'PATCH', `/artifacts/${a.id}`, { label: 'Lost access', expectedRevision: 2 })).statusCode, 403);
});

test('document presence is scoped, expires, and removes revoked or logged-out sessions', async t => {
  const { app, request, captain, editor, reader, outsider, project, artifacts: [a, b] } = await fixture(t);
  assert.equal((await request(null, 'GET', `/artifacts/${a.id}/viewers`)).statusCode, 401);
  assert.equal((await request(outsider, 'GET', `/artifacts/${a.id}/viewers`)).statusCode, 404);
  assert.equal((await request(editor, 'POST', `/artifacts/${b.id}/viewers`, { mode: 'editing' })).statusCode, 403);
  assert.equal((await request(reader, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'editing' })).statusCode, 403);
  assert.equal((await request(reader, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'viewing' })).statusCode, 200);
  assert.equal((await request(editor, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'editing' })).statusCode, 200);
  let viewers = (await request(captain, 'GET', `/artifacts/${a.id}/viewers`)).json().viewers;
  assert.equal(viewers.length, 2); assert.equal(viewers.find(x => x.id === editor.id).mode, 'editing');
  assert.doesNotMatch(JSON.stringify(viewers), /email|session|password|token/);
  // Separate browser tabs never remove each other's presence; each person appears once.
  await request(editor, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'viewing', clientId: 'other-tab' });
  await request(editor, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'leave' });
  viewers = (await request(captain, 'GET', `/artifacts/${a.id}/viewers`)).json().viewers;
  assert.equal(viewers.filter(x => x.id === editor.id).length, 1);
  assert.equal(viewers.find(x => x.id === editor.id).mode, 'viewing');
  await request(editor, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'editing', clientId: 'other-tab' });
  await app.missionStore.update(data => { data.documentPresence.find(x => x.userId === reader.id).seenAt = Date.now() - 61_000; });
  assert.equal((await request(captain, 'GET', `/artifacts/${a.id}/viewers`)).json().viewers.length, 1);
  await request(editor, 'POST', '/auth/logout');
  assert.equal((await request(captain, 'GET', `/artifacts/${a.id}/viewers`)).json().viewers.length, 0);
  await request(reader, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'viewing' });
  await app.missionStore.update(data => { const team = data.teams.find(x => x.id === data.workspace.projects[project.id].document.context.teamId); team.memberIds = team.memberIds.filter(id => id !== reader.memberId); });
  assert.equal((await request(captain, 'GET', `/artifacts/${a.id}/viewers`)).json().viewers.length, 0);
  assert.equal((await request(reader, 'POST', `/artifacts/${a.id}/viewers`, { mode: 'viewing' })).statusCode, 404);
});

test('knowledge decisions preserve sources, enforce ACL, and detect competing reviews or changed extraction', async t => {
  const { app, request, captain, editor, reader, outsider, project } = await fixture(t);
  assert.equal((await request(outsider, 'GET', `/projects/${project.id}/knowledge`)).statusCode, 404);
  const snapshot = (await request(editor, 'GET', `/projects/${project.id}/knowledge`)).json();
  assert.equal(snapshot.items.length, 2); assert.equal(snapshot.items[0].canReview, true); assert.equal(snapshot.items[1].canReview, false);
  const input = { itemId: snapshot.items[0].id, sourceRevision: snapshot.sourceRevision, expectedRevision: 0, status: 'needs_source', note: 'Confirm the hardware revision in the original source.' };
  assert.equal((await request(reader, 'POST', `/projects/${project.id}/knowledge/review`, input)).statusCode, 403);
  assert.equal((await request(editor, 'POST', `/projects/${project.id}/knowledge/review`, { ...input, itemId: snapshot.items[1].id })).statusCode, 403);
  const original = structuredClone(app.missionStore.read().workspace.projects[project.id].document);
  const responses = await Promise.all([editor, captain].map(actor => request(actor, 'POST', `/projects/${project.id}/knowledge/review`, input)));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.deepEqual(app.missionStore.read().workspace.projects[project.id].document, original, 'review never invents or silently changes a map fact');
  assert.equal((await request(editor, 'POST', `/projects/${project.id}/knowledge/review`, { ...input, expectedRevision: 1, status: 'reviewed', note: 'Revision checked in the document.' })).statusCode, 200);
  const reviewed = (await request(captain, 'GET', `/projects/${project.id}/knowledge`)).json().items[0].review;
  assert.equal(reviewed.revision, 2); assert.equal(reviewed.actorId, editor.id);
  assert.equal(app.missionStore.read().workspace.projects[project.id].knowledgeReviewHistory.length, 1);
  await app.missionStore.update(data => { data.workspace.projects[project.id].document.memoryRevision += 1; });
  assert.equal((await request(editor, 'POST', `/projects/${project.id}/knowledge/review`, { ...input, expectedRevision: 2 })).statusCode, 409);
  assert.equal((await request(captain, 'GET', `/projects/${project.id}/knowledge`)).json().items[0].review, null, 'new sources require a new review');
  await app.missionStore.update(data => { const p = data.workspace.projects[project.id].document; p.engineeringSystem = { schemaVersion: 1, id: 'manual-review-model', name: 'Manual baseline', generatedAt: '2026-10-16T12:00:00Z', generatedFromRevision: p.memoryRevision, entities: [{ id: 'system', name: 'System', kind: 'system', description: '', properties: [], source: 'user', evidenceRefs: [], confidence: 1 }], relations: [], requirements: [], evidence: [], artifactSources: [] }; });
  const current = (await request(editor, 'GET', `/projects/${project.id}/knowledge`)).json();
  await app.missionStore.update(data => { data.workspace.projects[project.id].document.engineeringSystem.entities[0].description = 'Updated technical fact'; });
  assert.equal((await request(editor, 'POST', `/projects/${project.id}/knowledge/review`, { ...input, sourceRevision: current.sourceRevision })).statusCode, 409, 'technical edits invalidate an open review even without a client revision counter');
});

test('project summary accepts bounded prose and rejects unexpected fields', () => {
  const project = createValidationProject(); project.context.summary = { scope: 'Public documents', nextSteps: 'Check revisions' };
  assert.equal(organizationError(project), null); project.context.summary.admin = true;
  assert.match(organizationError(project), /summary/); delete project.context.summary.admin; project.context.summary.scope = 'x'.repeat(5001);
  assert.match(organizationError(project), /summary/);
});
