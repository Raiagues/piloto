import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { canReviewAccount, isFictionalProfile } from './reviewer-eligibility.mjs';

test('only marked or exactly recognized legacy examples are fictional; the demo visitor remains eligible', () => {
  const visitor = { id: 'demo-f123-owner', email: 'visitor@demo.norte.invalid', active: true, isDemoAccount: true, passwordHash: 'demo-account-without-password' };
  assert.equal(isFictionalProfile(visitor), false);
  assert.equal(canReviewAccount(visitor), true);
  assert.equal(canReviewAccount({ ...visitor, id: 'demo-f123-q-ana-user' }), false);
  assert.equal(canReviewAccount({ ...visitor, id: 'demo-f123-q-ana-user', email: 'actual@example.test' }), true);
  assert.equal(canReviewAccount({ id: 'normal', name: 'EXEMPLO', active: true }), true, 'display names are not identity markers');
  assert.equal(canReviewAccount({ id: 'any-fixture', active: true, isFictionalProfile: true }), false);
  assert.equal(canReviewAccount({ ...visitor, active: false }), false);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'norte-review-eligibility-'));
  const app = await buildApp({ storeFile: join(dir, 'state.json'), logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const register = async name => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, email: `${name}@example.test`, password: 'isolated reviewer test passphrase' } });
    assert.equal(r.statusCode, 201, r.body);
    return { ...r.json().user, headers: { cookie: [r.headers['set-cookie']].flat().map(v => v.split(';')[0]).join('; '), 'x-csrf-token': r.json().csrfToken } };
  };
  const captain = await register('Captain'), reviewer = await register('Reviewer');
  const request = (actor, method, route, payload) => app.inject({ method, url: '/api' + route, headers: actor.headers, ...(payload === undefined ? {} : { payload }) });
  const team = (await request(captain, 'POST', '/teams', { name: 'Isolated reviewer team' })).json().team;
  const examples = [
    { id: 'new-example-user', memberId: 'new-example-member', name: 'New example', email: 'new@demo.norte.invalid', isFictionalProfile: true },
    { id: 'demo-f123-q-bruno-user', memberId: 'legacy-example-member', name: 'Legacy example', email: 'legacy@demo.norte.invalid' }
  ];
  await app.missionStore.update(data => {
    const storedTeam = data.teams.find(t => t.id === team.id); storedTeam.memberIds.push(reviewer.memberId);
    for (const example of examples) {
      data.users.push({ ...example, active: true, accessRole: 'member', passwordHash: 'demo-account-without-password' });
      data.members.push({ id: example.memberId, accountId: example.id, displayName: example.name, accountStatus: 'active' });
      storedTeam.memberIds.push(example.memberId);
    }
  });
  const p = createValidationProject(); p.id = 'reviewer-project'; p.name = 'Review fixture'; p.context.teamId = team.id;
  p.context.assignments = [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }, ...[reviewer, ...examples].map(person => ({ memberId: person.memberId, roleId: 'member', sectorId: '' }))];
  p.engineeringSystem = { schemaVersion: 1, id: 'review-model', name: 'Review fixture', generatedAt: new Date().toISOString(), generatedFromRevision: 0, revision: 1, entities: [{ id: 'eps', name: 'EPS', kind: 'system', description: 'Manual test source', properties: [{ key: 'voltage', name: 'Voltage', value: 3.3, unit: 'V', source: 'user', evidenceRefs: [] }], source: 'user', evidenceRefs: [], confidence: 1 }], relations: [], requirements: [], evidence: [], artifactSources: [] };
  const created = await request(captain, 'POST', '/projects', p); assert.equal(created.statusCode, 201, created.body);
  await app.missionStore.update(data => { const project = data.workspace.projects[p.id].document; project.engineeringSystem.generatedFromRevision = project.memoryRevision || 0; });
  const base = `/projects/${p.id}`;
  const delivery = async () => (await request(captain, 'GET', `${base}/delivery`)).json();
  const action = async (name, payload, actor = captain) => {
    const state = await delivery(); return request(actor, 'POST', `${base}/delivery/actions`, { action: name, expectedRevision: state.revision, expectedBaselineHash: state.baselineHash, ...payload });
  };
  const configuration = async reviewers => {
    const current = (await request(captain, 'GET', `${base}/configuration-changes`)).json();
    return request(captain, 'POST', `${base}/configuration-changes`, { basis: 'manual', key: randomUUID(), baselineHash: current.baselineHash, deliveryRevision: current.deliveryRevision, reviewers,
      change: { id: randomUUID(), targetEntityId: 'eps', kind: 'parameter', oldValues: [], newValues: [{ key: 'voltage', name: 'Voltage', value: 3, unit: 'V', source: 'user', evidenceRefs: [] }], description: 'Manual voltage change', createdAt: new Date().toISOString() } });
  };
  const saved = await action('requirement.save', { item: { title: 'Power allocation', statement: 'The EPS shall supply 3.3 V.', entityIds: ['eps'], ownerId: examples[0].id } });
  assert.equal(saved.statusCode, 200, saved.body);
  return { app, captain, reviewer, examples, request, base, delivery, action, configuration, requirement: saved.json().requirements[0] };
}

test('examples stay available as owners but cannot be selected for configuration, requirement, or proposal review', async t => {
  const f = await fixture(t), delivery = await f.delivery(), configuration = (await f.request(f.captain, 'GET', f.base + '/configuration-changes')).json();
  for (const result of [delivery, configuration]) {
    assert.equal(result.members.length, 4);
    assert.equal(result.members.find(m => m.id === f.reviewer.id).canReview, true);
    for (const example of f.examples) {
      assert.equal(result.members.find(m => m.id === example.id).canReview, false);
      assert.equal(result.members.find(m => m.id === example.id).isFictionalProfile, true);
    }
  }
  assert.equal(delivery.requirements[0].ownerId, f.examples[0].id, 'illustrative responsibility is preserved');
  for (const example of f.examples) {
    assert.equal((await f.configuration([example.id])).statusCode, 400);
    const review = await f.action('requirement.request_review', { id: f.requirement.id, reviewers: [example.id] });
    assert.equal(review.statusCode, 400); assert.equal(review.json().error, 'INVALID_REVIEWERS');
    const proposal = await f.action('proposal.save', { item: { requirementId: f.requirement.id, statement: 'The EPS shall supply 3 V.', reason: 'Review voltage trade.', reviewers: [example.id] } });
    assert.equal(proposal.statusCode, 400); assert.equal(proposal.json().error, 'INVALID_REVIEWERS');
  }
  assert.equal((await f.delivery()).requirements[0].status, 'draft');
  assert.equal((await f.configuration([f.reviewer.id])).statusCode, 200);
  assert.equal((await f.action('requirement.request_review', { id: f.requirement.id, reviewers: [f.reviewer.id] })).statusCode, 200);
  const approved = await f.action('requirement.review', { id: f.requirement.id, decision: 'approve' }, f.reviewer);
  assert.equal(approved.statusCode, 200); assert.equal(approved.json().requirements[0].status, 'approved');
});

test('legacy assignments cannot approve or merge after the reviewer is identified as fictional', async t => {
  const f = await fixture(t);
  await f.action('requirement.request_review', { id: f.requirement.id, reviewers: [f.reviewer.id] });
  await f.action('requirement.review', { id: f.requirement.id, decision: 'approve' }, f.reviewer);
  let response = await f.action('proposal.save', { item: { requirementId: f.requirement.id, statement: 'The EPS shall supply 3 V.', reason: 'Review voltage trade.', reviewers: [f.reviewer.id] } });
  const proposalId = response.json().proposals[0].id;
  response = await f.action('proposal.review', { id: proposalId, decision: 'approve' }, f.reviewer); assert.equal(response.statusCode, 200, response.body);
  const change = (await f.configuration([f.reviewer.id])).json().changes[0], changeRoute = `${f.base}/configuration-changes/${change.id}/actions`;
  response = await f.request(f.reviewer, 'POST', changeRoute, { action: 'review', decision: 'approve', expectedRevision: 1 }); assert.equal(response.statusCode, 200, response.body);
  // Isolated legacy fixture only: mark an existing reviewer's row, without
  // creating a fictional login or approving on behalf of any example person.
  await f.app.missionStore.update(data => { data.users.find(u => u.id === f.reviewer.id).isFictionalProfile = true; });
  const current = await f.delivery();
  assert.equal(current.requirements[0].status, 'in_review'); assert.equal(current.requirements[0].decisions.length, 0);
  assert.equal(current.proposals[0].status, 'open'); assert.equal(current.proposals[0].decisions.length, 0);
  assert.equal((await f.action('requirement.review', { id: f.requirement.id, decision: 'approve' }, f.reviewer)).statusCode, 403);
  assert.equal((await f.action('proposal.review', { id: proposalId, decision: 'approve' }, f.reviewer)).statusCode, 403);
  assert.equal((await f.action('proposal.merge', { id: proposalId })).statusCode, 409);
  const projected = (await f.request(f.captain, 'GET', f.base + '/configuration-changes')).json();
  assert.equal(projected.changes[0].status, 'in_review'); assert.deepEqual(projected.changes[0].decisions, {});
  assert.equal((await f.request(f.reviewer, 'POST', changeRoute, { action: 'review', decision: 'approve', expectedRevision: 2 })).statusCode, 403);
  assert.equal((await f.request(f.captain, 'POST', changeRoute, { action: 'merge', expectedRevision: 2 })).statusCode, 409);
});
