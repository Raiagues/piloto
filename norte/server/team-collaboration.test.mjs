import { URLSearchParams } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';
import { buildApp } from './app.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { normalizeStoredData } from './data-store.mjs';
import { createValidationProject } from './test-support/project.mjs';

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
  async function registerLogin(name, login) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${app.missionStore.read().users.length + 1}`, payload: { name, login, password: '12345678' } });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().user.email, '');
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
  return { app, outbox, register, registerLogin, request, owner, captain, member, outsider, team, invite, accept, verify };
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

for (const pg of [false, true]) test(`login-only accounts receive separate in-app invitations without SMTP (${pg ? 'PostgreSQL' : 'JSON'})`, async t => {
  const f = await fixture(t, pg, false), { app, request, captain, team } = f;
  const first = await f.registerLogin('First colleague', 'first-colleague');
  const second = await f.registerLogin('Second colleague', 'second-colleague');
  const outsider = await f.registerLogin('Unrelated colleague', 'unrelated-colleague');
  const lookup = await request(captain, 'GET', `/directory/nickname/@${second.login.toUpperCase()}`);
  assert.equal(lookup.statusCode, 200, lookup.body);
  assert.equal(lookup.json().user.id, second.id);
  assert.doesNotMatch(lookup.body, /email|password|accessRole|memberId/);
  const firstInvite = await f.invite(first);
  const secondResponse = await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: second.login });
  assert.equal(secondResponse.statusCode, 201, secondResponse.body);
  const secondInvite = secondResponse.json().invitation;
  assert.notEqual(firstInvite.id, secondInvite.id);
  assert.equal(firstInvite.delivery, 'in_app');
  assert.equal(secondInvite.delivery, 'in_app');
  assert.equal((await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: first.nickname })).statusCode, 409);
  assert.deepEqual((await request(first, 'GET', '/invitations')).json().invitations.map(i => i.id), [firstInvite.id]);
  assert.deepEqual((await request(second, 'GET', '/invitations')).json().invitations.map(i => i.id), [secondInvite.id]);
  assert.deepEqual((await request(outsider, 'GET', '/invitations')).json().invitations, []);
  for (const actor of [second, outsider]) {
    assert.equal((await request(actor, 'POST', `/invitations/${firstInvite.id}/respond`, { decision: 'accept' })).statusCode, 404);
  }
  // An old incomplete invitation must not match every account without email.
  await app.missionStore.update(data => {
    data.invitations.push({ ...data.invitations.find(i => i.id === firstInvite.id), id: 'orphaned-empty-email', recipientUserId: null, recipientMemberId: null, email: '' });
  });
  for (const actor of [first, second, outsider]) {
    assert.ok(!(await request(actor, 'GET', '/invitations')).json().invitations.some(i => i.id === 'orphaned-empty-email'));
    assert.equal((await request(actor, 'POST', '/invitations/orphaned-empty-email/respond', { decision: 'accept' })).statusCode, 404);
  }
  await app.missionStore.update(data => { data.invitations.find(i => i.id === firstInvite.id).recipientUserId = null; });
  assert.equal((await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: first.nickname })).statusCode, 409, 'member identity also prevents duplicates');
  await f.accept(first, firstInvite);
  await f.accept(second, secondInvite);
  assert.deepEqual(app.missionStore.read().teams.find(t => t.id === team.id).memberIds.sort(), [captain.memberId, first.memberId, second.memberId].sort());
  const ownTeam = await request(first, 'POST', '/teams', { name: 'Equipe sem email' });
  assert.equal(ownTeam.statusCode, 201, ownTeam.body);
  const ownInvite = await request(first, 'POST', `/teams/${ownTeam.json().team.id}/invitations`, { nickname: second.nickname });
  assert.equal(ownInvite.statusCode, 201, ownInvite.body);
  await f.accept(second, ownInvite.json().invitation);
  const verification = await request(first, 'POST', '/auth/email-verification');
  assert.equal(verification.statusCode, 400, verification.body);
  assert.equal(verification.json().error, 'EMAIL_REQUIRED');
  assert.equal(f.outbox.length, 0);
  assert.equal(app.missionStore.read().emailVerifications.length, 0);
  await app.missionStore.update(data => { data.users.find(u => u.id === outsider.id).login = first.login; });
  assert.equal((await request(captain, 'GET', `/directory/nickname/${first.login}`)).statusCode, 404, 'ambiguous imported identities never select an arbitrary account');
  assert.equal((await request(captain, 'POST', `/teams/${team.id}/invitations`, { nickname: first.login })).statusCode, 404);
});

test('accounts without email cannot request or confirm mailbox proof, even with SMTP configured', async t => {
  const f = await fixture(t), { request, app } = f;
  const actor = await f.registerLogin('No mailbox', 'no-mailbox');
  for (const [path, payload] of [['/auth/email-verification'], ['/auth/email-verification/confirm', { token: 'incomplete-record' }]]) {
    const response = await request(actor, 'POST', path, payload);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().error, 'EMAIL_REQUIRED');
  }
  assert.equal(f.outbox.length, 0);
  assert.equal(app.missionStore.read().emailVerifications.length, 0);
  assert.equal(app.missionStore.read().users.find(u => u.id === actor.id).emailVerifiedAt, null);
});

test('email invitations require mailbox proof, exact account, expiry and explicit consent', async t => {
  const f = await fixture(t), { request, captain, outsider, team } = f;
  await f.verify(captain);
  const invited = await request(captain, 'POST', `/teams/${team.id}/invitations`, { email: 'newcomer@example.test' });
  assert.equal(invited.statusCode, 201, invited.body); const invitation = invited.json().invitation;
  const mail = f.outbox.at(-1); assert.equal(mail.to, 'newcomer@example.test'); assert.match(mail.text, /Equipe de teste/);
  const parameters = new URLSearchParams(mail.text.match(/https:\/\/\S+/)[0].split('#/invitations?')[1]);
  const token = parameters.get('token'); assert.ok(token);
  assert.equal(parameters.get('email'), 'newcomer@example.test', 'the real invitation link carries the mailbox required by registration');
  assert.doesNotMatch(JSON.stringify(f.app.missionStore.read()), new RegExp(token));
  assert.doesNotMatch(invited.body, /tokenHash|token=/);
  const registration = await f.app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: '127.0.0.99', payload: { name: 'Newcomer', login: 'newcomer-login', email: parameters.get('email'), password: '12345678' } });
  assert.equal(registration.statusCode, 201, registration.body);
  const newcomer = { ...registration.json().user, headers: { cookie: registration.headers['set-cookie'].split(';')[0], 'x-csrf-token': registration.json().csrfToken } };
  assert.equal(newcomer.email, parameters.get('email'));
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
