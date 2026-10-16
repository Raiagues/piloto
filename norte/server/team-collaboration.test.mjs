import { URLSearchParams } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';
import { buildApp } from './app.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { createInitialData, createValidationProject, normalizeStoredData } from './data-store.mjs';
import { projectOrganization, teamOrganization } from '../shared/organization-tree.mjs';
import { recordActivity } from './team-activity.mjs';
import { assertPreviewEnvironment, seedTeamPreview } from '../scripts/seed-team-preview.mjs';

async function fixture(t, pg = false, configured = true) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-teams-'));
  const outbox = [];
  const store = pg && await new PostgresDataStore('postgres://test', { pool: createMemoryPostgresPool() }).init();
  const app = await buildApp({ ...(store ? { store } : { storeFile: join(directory, 'state.json') }), logger: false, mailer: { configured, publicUrl: 'https://norte.example.test/norte/', async send(message) { outbox.push(message); } } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function register(name, email = `${name}@example.test`, nickname = name.toLowerCase()) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${outbox.length + app.missionStore.read().users.length + 1}`, payload: { name, email, nickname, password: 'long test passphrase for collaboration' } });
    assert.equal(r.statusCode, 201, r.body);
    return { ...r.json().user, headers: { cookie: r.headers['set-cookie'].split(';')[0], 'x-csrf-token': r.json().csrfToken } };
  }
  const request = (actor, method, path, payload) => app.inject({ method, url: `/api${path}`, headers: actor.headers, ...(payload ? { payload } : {}) });
  const owner = await register('Owner'), captain = await register('Captain'), member = await register('Member'), outsider = await register('Outsider');
  const teamResponse = await request(captain, 'POST', '/teams', { name: 'Equipe de teste' });
  assert.equal(teamResponse.statusCode, 201, teamResponse.body); const team = teamResponse.json().team;
  async function invite(actor = member, author = captain) {
    const r = await request(author, 'POST', `/teams/${team.id}/invitations`, { nickname: actor.nickname }); assert.equal(r.statusCode, 201, r.body); return r.json().invitation;
  }
  async function accept(actor, invitation) { const r = await request(actor, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' }); assert.equal(r.statusCode, 200, r.body); }
  async function verify(actor) {
    const r = await request(actor, 'POST', '/auth/email-verification'); assert.equal(r.statusCode, 200, r.body);
    const token = new URLSearchParams(outbox.at(-1).text.match(/https:\/\/\S+/)[0].split('#/invitations?')[1]).get('verification');
    assert.ok(token);
    const confirmed = await request(actor, 'POST', '/auth/email-verification/confirm', { token }); assert.equal(confirmed.statusCode, 200, confirmed.body);
    return token;
  }
  return { app, outbox, register, request, owner, captain, member, outsider, team, invite, accept, verify };
}
for (const pg of [false, true]) test(`nickname invitations need recipient consent and serialize duplicates (${pg ? 'PostgreSQL' : 'JSON'})`, async t => {
  const f = await fixture(t, pg), { request, team, captain, member, outsider } = f;
  const search = await request(captain, 'GET', `/directory/nickname/@${member.nickname.toUpperCase()}`);
  assert.equal(search.statusCode, 200); assert.equal(search.json().user.id, member.id);
  assert.doesNotMatch(search.body, /email|lastSeenAt|password|accessRole|memberId/);
  const collision = await f.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Collision', nickname: 'MEMBER', email: 'unique@example.test', password: 'long passphrase for a duplicate nickname' } });
  assert.equal(collision.statusCode, 409);
  assert.equal((await request(member, 'PATCH', '/profile', { nickname: 'CaPtAiN' })).statusCode, 409);
  const invites = await Promise.all([1, 2].map(() => request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: member.nickname })));
  assert.deepEqual(invites.map(r => r.statusCode).sort(), [201, 409]);
  const invitation = invites.find(r => r.statusCode === 201).json().invitation;
  assert.ok(!f.app.missionStore.read().teams.find(t => t.id === team.id).memberIds.includes(member.memberId));
  assert.equal((await request(member, 'GET', '/invitations')).json().invitations.length, 1);
  assert.equal((await request(outsider, 'GET', '/invitations')).json().invitations.length, 0);
  assert.equal((await request(outsider, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' })).statusCode, 404);
  assert.equal((await request(member, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept', token: 'forged' })).statusCode, 400);
  await f.accept(member, invitation);
  assert.equal((await request(member, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' })).statusCode, 409);
  assert.equal((await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: member.nickname })).statusCode, 409);
  assert.ok(!f.app.missionStore.read().invitations.find(i => i.id === invitation.id).tokenHash);
  assert.equal(f.outbox.length, 0);
});

test('email invitations require mailbox proof, exact account, expiry and explicit consent', async t => {
  const f = await fixture(t), { request, captain, outsider, team } = f;
  await f.verify(captain);
  const invited = await request(captain, 'POST', `/teams/${team.id}/invitations`, { email: 'newcomer@example.test' });
  assert.equal(invited.statusCode, 201, invited.body); const invitation = invited.json().invitation;
  const mail = f.outbox.at(-1); assert.equal(mail.to, 'newcomer@example.test'); assert.match(mail.text, /Equipe de teste/);
  const token = new URLSearchParams(mail.text.match(/https:\/\/\S+/)[0].split('#/invitations?')[1]).get('token'); assert.ok(token);
  assert.doesNotMatch(JSON.stringify(f.app.missionStore.read()), new RegExp(token));
  assert.doesNotMatch(invited.body, /tokenHash|token=/);
  const newcomer = await f.register('Newcomer');
  assert.ok(!f.app.missionStore.read().teams.find(t => t.id === team.id).memberIds.includes(newcomer.memberId));
  assert.equal((await request(newcomer, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept', token })).statusCode, 403);
  assert.equal((await request(outsider, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept', token })).statusCode, 404);
  const verificationToken = await f.verify(newcomer);
  assert.equal((await request(outsider, 'POST', '/auth/email-verification/confirm', { token: verificationToken })).statusCode, 400);
  assert.equal((await request(newcomer, 'POST', '/auth/email-verification/confirm', { token: verificationToken })).statusCode, 400);
  assert.ok(!f.app.missionStore.read().teams.find(t => t.id === team.id).memberIds.includes(newcomer.memberId), 'verification alone never accepts');
  assert.equal((await request(newcomer, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept', token })).statusCode, 200);
  assert.equal((await request(newcomer, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept', token })).statusCode, 409);
});

test('decline, cancel, expiration, missing SMTP and closed legacy routes never add members', async t => {
  const f = await fixture(t, false, false), { request, captain, member, outsider, team } = f;
  assert.equal((await request(captain, 'POST', `/teams/${team.id}/invitations`, { email: 'nobody@example.test' })).statusCode, 503);
  for (const path of [`/teams/${team.id}/join-requests`, `/teams/${team.id}/members`, '/team/members', `/team/members/${member.memberId}/invitation`]) {
    assert.equal((await request(captain, 'POST', path, { email: member.email, memberId: member.memberId })).statusCode, 410);
  }
  const declined = await f.invite(); assert.equal((await request(member, 'POST', `/invitations/${declined.id}/respond`, { decision: 'decline' })).statusCode, 200);
  const cancelled = await f.invite();
  assert.equal((await request(outsider, 'DELETE', `/teams/${team.id}/invitations/${cancelled.id}`)).statusCode, 403);
  assert.equal((await request(captain, 'DELETE', `/teams/${team.id}/invitations/${cancelled.id}`)).statusCode, 204);
  assert.equal((await request(member, 'POST', `/invitations/${cancelled.id}/respond`, { decision: 'accept' })).statusCode, 409);
  const expired = await f.invite();
  await f.app.missionStore.update(data => { data.invitations.find(i => i.id === expired.id).expiresAt = new Date(Date.now() - 1).toISOString(); });
  assert.equal((await request(member, 'POST', `/invitations/${expired.id}/respond`, { decision: 'accept' })).statusCode, 409);
  assert.deepEqual(f.app.missionStore.read().teams.find(t => t.id === team.id).memberIds, [captain.memberId]);
});

test('project leaders cannot administer the parent team or edit another project; removal revokes access', async t => {
  const f = await fixture(t), { request, captain, member, outsider, team } = f;
  await f.accept(member, await f.invite());
  const p = { ...createValidationProject(), id: 'first-project', name: 'First project' };
  p.context = { ...p.context, teamId: team.id, sectors: [{ id: 'avionics', name: 'Aviônica' }], assignments: [{ memberId: member.memberId, roleId: 'captain', sectorId: '' }] };
  const first = await request(captain, 'POST', '/projects', p); assert.equal(first.statusCode, 201, first.body);
  const second = await request(captain, 'POST', '/projects', { ...p, id: 'second-project', context: { ...p.context, assignments: [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }] } });
  assert.equal((await request(member, 'POST', `/teams/${team.id}/invitations`, { nickname: outsider.nickname })).statusCode, 403);
  assert.equal((await request(member, 'PATCH', `/teams/${team.id}`, { captainMemberId: member.memberId })).statusCode, 403);
  assert.equal((await request(member, 'PUT', '/projects/second-project', { ...second.json().project, name: 'Takeover' })).statusCode, 403);
  assert.equal((await request(member, 'PUT', '/projects/first-project', { ...first.json().project, name: 'My responsibility' })).statusCode, 200);
  assert.equal((await request(captain, 'DELETE', `/teams/${team.id}/members/${member.memberId}`)).statusCode, 204);
  assert.equal((await request(member, 'GET', '/projects/first-project')).statusCode, 403);
  assert.equal((await request(member, 'DELETE', '/projects/first-project')).statusCode, 403);
});

test('visits and activity return only scoped aggregates and cap repeat views', async t => {
  const f = await fixture(t), { request, captain, member, outsider, team } = f;
  await f.accept(member, await f.invite());
  const p = { ...createValidationProject(), id: 'activity-project', name: 'Activity project' }; p.context.teamId = team.id; p.context.assignments = [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }];
  const r = await request(captain, 'POST', '/projects', p); assert.equal(r.statusCode, 201, r.body);
  for (const actor of [captain, member, outsider, outsider]) assert.equal((await request(actor, 'POST', `/teams/${team.id}/visit`)).statusCode, 200);
  assert.equal((await request(outsider, 'POST', `/projects/${p.id}/visit`)).statusCode, 403);
  for (const actor of [member, member]) assert.equal((await request(actor, 'POST', `/projects/${p.id}/visit`)).statusCode, 200);
  const artifact = await request(captain, 'POST', '/artifacts', { scope: 'project', ownerId: p.id, kind: 'document', label: 'Test notes', documentText: 'Team notes' }); assert.equal(artifact.statusCode, 201);
  assert.equal((await request(captain, 'PATCH', `/artifacts/${artifact.json().artifact.id}`, { documentText: 'Updated notes', expectedRevision: 0 })).statusCode, 200);
  assert.equal((await request(outsider, 'GET', `/teams/${team.id}/insights`)).statusCode, 403);
  assert.equal((await request(member, 'GET', `/teams/${team.id}/insights`)).statusCode, 403);
  const insights = (await request(captain, 'GET', `/teams/${team.id}/insights`)).json();
  assert.equal(insights.visits.total, 1); assert.equal(insights.visits.unique, 1); assert.equal(insights.visits.days.length, 30);
  assert.equal(insights.members.find(m => m.memberId === member.memberId).accesses, 1);
  assert.equal(insights.members.find(m => m.memberId === captain.memberId).artifactCreated, 1);
  assert.equal(insights.members.find(m => m.memberId === captain.memberId).artifactEdited, 1);
  assert.doesNotMatch(JSON.stringify(insights.visits), /userId|email|secret|visitors|token|ipAddress/);
  assert.doesNotMatch(JSON.stringify(f.app.missionStore.read().teamStats), new RegExp(outsider.id));
  await f.app.missionStore.update(data => { recordActivity(data, member.id, p.id, 'access', Date.now() + 32 * 86400_000); });
  assert.equal(f.app.missionStore.read().activity.length, 1, 'bounded retention');
});

test('public project summaries are opt-in and contain no private hierarchy or artifacts', async t => {
  const f = await fixture(t), { request, captain, outsider, team } = f;
  const p = { ...createValidationProject(), id: 'public-project', name: 'Public title' }; p.context.teamId = team.id; p.context.publicSummary = true; p.context.assignments = [{ memberId: captain.memberId, roleId: 'captain', sectorId: '' }];
  assert.equal((await request(captain, 'POST', '/projects', p)).statusCode, 201);
  const response = await request(outsider, 'GET', `/teams/${team.id}/projects`);
  assert.equal(response.json().projects[0].name, p.name); assert.doesNotMatch(response.body, /email|assignments|sectors|teamArtifactIds|captainMemberId/);
  assert.equal((await request(outsider, 'GET', `/projects/${p.id}`)).statusCode, 403);
});

test('legacy invitations and artifacts survive migration without giving unverified registrations access', async t => {
  const f = await fixture(t), { request, captain, team } = f;
  await f.app.missionStore.update(data => {
    data.members.push({ id: 'legacy-profile', displayName: 'Legacy person', email: 'legacy@example.test', accountId: null, accountStatus: 'invited' });
    data.teams.find(t => t.id === team.id).memberIds.push('legacy-profile');
    data.teams.find(t => t.id === team.id).joinRequests.push('old-request');
    Object.assign(data, normalizeStoredData({ ...data, schemaVersion: 9 }));
  });
  const legacy = await f.register('Legacy');
  const current = f.app.missionStore.read();
  assert.equal(current.members.filter(m => m.email === 'legacy@example.test').length, 1);
  assert.equal(current.members.find(m => m.id === 'legacy-profile').accountId, null);
  assert.ok(current.teams.find(t => t.id === team.id).legacyInvitedMemberIds.includes('legacy-profile'));
  assert.deepEqual(current.teams.find(t => t.id === team.id).joinRequests, ['old-request']);
  assert.equal((await request(legacy, 'GET', '/team/members')).statusCode, 403);
  await f.verify(legacy);
  const after = f.app.missionStore.read(); assert.equal(after.members.find(m => m.id === 'legacy-profile').accountId, legacy.id);
  assert.ok(!after.teams.find(t => t.id === team.id).memberIds.includes(legacy.memberId));
  assert.deepEqual((await request(captain, 'GET', '/teams')).json().teams.find(t => t.id === team.id).joinRequests, []);
  await f.accept(legacy, await f.invite(legacy));
});

test('controlled sample preserves existing users, is idempotent, uses test addresses and one deterministic hierarchy', async () => {
  assert.throws(() => assertPreviewEnvironment({ NODE_ENV: 'production', NORTE_ALLOW_TEAM_PREVIEW: '1' }));
  assert.throws(() => assertPreviewEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgres://remote', NORTE_ALLOW_TEAM_PREVIEW: '1' }));
  assertPreviewEnvironment({ NODE_ENV: 'test', NORTE_ALLOW_TEAM_PREVIEW: '1' });
  const data = createInitialData(); data.environment = 'team-preview-test'; data.users.push({ id: 'sample-owner', memberId: 'sample-member', active: true, email: 'sample@example.test', name: 'Sample', nickname: 'sample', emailVerifiedAt: null }); data.members.push({ id: 'sample-member', accountId: 'sample-owner', displayName: 'Sample' });
  await assert.rejects(seedTeamPreview(data, 'missing@example.test'));
  const seeded = await seedTeamPreview(data, 'sample@example.test');
  assert.deepEqual(seeded.users[0], data.users[0]);
  assert.ok(seeded.users.slice(1).every(u => u.isTestAccount && u.email.endsWith('@example.test')));
  assert.deepEqual(await seedTeamPreview(seeded, 'sample@example.test'), seeded);
  const team = seeded.teams.find(t => t.testFixture), projects = Object.values(seeded.workspace.projects).filter(p => p.document.testFixture).map(r => r.document);
  assert.equal(projects.length, 3); assert.equal(seeded.artifacts.length, 9);
  const tree = teamOrganization(team, seeded.members, projects.map(p => ({ id: p.id, name: p.name, organization: projectOrganization(p, seeded.members) })));
  assert.equal(tree.children[0].name, 'Sample'); assert.equal(tree.children[0].children.length, 3);
  assert.equal(tree.children[0].children[1].children[0].name, 'Luna · TESTE');
  const sectors = tree.children[0].children[0].children[0].children;
  assert.equal(sectors[0].name, 'Aviônica'); assert.ok(sectors[0].children[0].name.includes('Luna'));
  assert.doesNotMatch(JSON.stringify(tree), /subsystem|component|artifact|Documentação/);
  assert.equal(data.users.length, 1, 'source unchanged');
});

test('changing a project team cannot carry members from another team; standalone projects cannot add unrelated profiles', async t => {
  const f = await fixture(t), { request, captain, member, team } = f;
  await f.accept(member, await f.invite());
  const p = { ...createValidationProject(), id: 'transfer-project', name: 'Transfer project' };
  p.context = { ...p.context, teamId: team.id, assignments: [{ memberId: member.memberId, roleId: 'member', sectorId: '' }] };
  const created = await request(captain, 'POST', '/projects', p); assert.equal(created.statusCode, 201);
  const other = (await request(captain, 'POST', '/teams', { name: 'Other team' })).json().team;
  assert.equal((await request(captain, 'PUT', `/projects/${p.id}`, { ...created.json().project, context: { ...p.context, teamId: other.id } })).statusCode, 400);
  assert.equal((await request(captain, 'POST', '/projects', { ...p, id: 'no-team-members', context: { ...p.context, teamId: null } })).statusCode, 400);
});

test('SMTP failure invalidates pending invitations and email verification expires without acceptance', async t => {
  const f = await fixture(t), { request, captain, member, team } = f;
  const verification = await request(member, 'POST', '/auth/email-verification'); assert.equal(verification.statusCode, 200);
  const token = new URLSearchParams(f.outbox.at(-1).text.match(/https:\/\/\S+/)[0].split('#/invitations?')[1]).get('verification');
  await f.app.missionStore.update(data => { data.emailVerifications.find(v => v.userId === member.id).expiresAt = new Date(Date.now() - 1).toISOString(); });
  assert.equal((await request(member, 'POST', '/auth/email-verification/confirm', { token })).statusCode, 400);
  await f.verify(captain);
  const failure = await buildApp({ store: f.app.missionStore, logger: false, mailer: { configured: true, publicUrl: 'https://norte.example.test', send: async () => { throw new Error('Provider error with a secret that must not escape'); } } });
  const response = await failure.inject({ method: 'POST', url: `/api/teams/${team.id}/invitations`, headers: captain.headers, payload: { email: 'delivery@example.test' } });
  assert.equal(response.statusCode, 502); assert.doesNotMatch(response.body, /secret|Provider/);
  const invite = f.app.missionStore.read().invitations.find(i => i.email === 'delivery@example.test');
  assert.equal(invite.status, 'failed'); assert.equal(invite.tokenHash, undefined);
  await failure.close();
});
