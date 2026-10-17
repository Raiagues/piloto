import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from './app.mjs';
import { normalizeStoredData } from './data-store.mjs';
import { findLoginUser } from './login-identity.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';

const password = '12345678';
function auth(response) {
  return { cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().csrfToken };
}
async function fixture(t, { postgres = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-login-'));
  const storeFile = join(directory, 'state.json');
  const pool = postgres ? createMemoryPostgresPool() : null;
  let app, serial = 1;
  async function start() {
    const store = pool ? await new PostgresDataStore('postgresql://isolated-test', { pool }).init() : undefined;
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      app = await buildApp({ store, storeFile, databaseUrl: pool ? 'postgresql://isolated-test' : '', serveStatic: false,
        logger: false, demoAccount: false, bootstrapToken: '', ai: { apiKey: '' }, systemAi: { apiKey: '' },
        platform: { encryptionKey: 'isolated-login-test-key-not-a-real-credential' } });
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  }
  await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, storeFile,
    register: fields => app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${serial++}`,
      payload: { name: 'Pessoa de teste', password, ...fields } }),
    login: fields => app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `127.0.0.${serial++}`, payload: { password, ...fields } }),
    restart: async () => { await app.close(); await start(); } };
}

for (const postgres of [false, true]) test(`login-only accounts persist without synthetic email (${postgres ? 'Postgres' : 'JSON'})`, async t => {
  const f = await fixture(t, { postgres });
  const first = await f.register({ login: 'Marina-Costa' });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().user.login, 'Marina-Costa');
  assert.equal(first.json().user.email, '');
  assert.equal(first.json().user.accessRole, 'member');
  const second = await f.register({ login: 'joao_123', email: '' });
  assert.equal(second.statusCode, 201, second.body);
  assert.notEqual(second.json().user.memberId, first.json().user.memberId);
  assert.notEqual(second.json().user.nickname, first.json().user.nickname);
  const stored = f.app.missionStore.read().users.find(user => user.id === first.json().user.id);
  const originalHash = stored.passwordHash;
  assert.match(originalHash, /^\$argon2id\$/u);
  assert.equal(stored.login, 'Marina-Costa');
  assert.equal(stored.email, '');
  if (!postgres) assert.ok(!(await readFile(f.storeFile, 'utf8')).includes(`"password": "${password}"`));
  await f.restart();
  const signedIn = await f.login({ login: '  MARINA-costa  ' });
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.equal(signedIn.json().user.id, first.json().user.id);
  assert.equal(f.app.missionStore.read().users.find(user => user.id === first.json().user.id).passwordHash, originalHash);
  assert.equal((await f.login({ login: 'joao_123' })).statusCode, 200);
  const session = await f.app.inject({ url: '/api/auth/session', headers: auth(signedIn) });
  assert.equal(session.json().user.login, 'Marina-Costa');
  assert.equal((await f.app.inject({ url: '/api/platform/admin/people', headers: auth(signedIn) })).statusCode, 403);
});

test('blank email never claims a seeded advisor, team or legacy identity', async t => {
  const f = await fixture(t);
  await f.app.missionStore.update(data => {
    data.members.push({ id: 'legacy-blank-advisor', displayName: 'Legacy advisor', email: '', missionRole: 'advisor', accountId: null });
    data.members.push({ id: 'legacy-missing-advisor', displayName: 'Legacy missing email', missionRole: 'advisor', accountId: null });
  });
  const before = structuredClone(f.app.missionStore.read());
  const result = await f.register({ login: 'new-member' });
  assert.equal(result.statusCode, 201, result.body);
  const user = f.app.missionStore.read().users.find(item => item.id === result.json().user.id);
  assert.equal(user.accessRole, 'member');
  assert.equal(user.pendingLegacyMemberId, undefined);
  assert.ok(!['legacy-blank-advisor', 'legacy-missing-advisor'].includes(user.memberId));
  assert.deepEqual(f.app.missionStore.read().teams, before.teams);
  assert.deepEqual(f.app.missionStore.read().workspace.projects, before.workspace.projects);
  assert.equal((await f.app.inject({ url: '/api/profile', headers: auth(result) })).statusCode, 200);
});

test('existing email and nickname sign-in remain compatible without changing account identifiers', async t => {
  const f = await fixture(t);
  const result = await f.register({ name: 'Legacy User', nickname: 'legacy_user', email: 'legacy@example.test' });
  assert.equal(result.statusCode, 201, result.body);
  await f.app.missionStore.update(data => { delete data.users.find(user => user.id === result.json().user.id).login; });
  await f.restart();
  for (const fields of [{ email: 'LEGACY@example.test' }, { login: 'legacy@example.test' }, { login: 'LEGACY_USER' }]) {
    const signedIn = await f.login(fields);
    assert.equal(signedIn.statusCode, 200, signedIn.body);
    assert.equal(signedIn.json().user.id, result.json().user.id);
    assert.equal(signedIn.json().user.login, 'legacy_user');
  }
  const rename = await f.app.inject({ method: 'PATCH', url: '/api/profile', headers: auth(result), payload: { nickname: 'legacy_renamed' } });
  assert.equal(rename.statusCode, 200, rename.body);
  assert.equal(rename.json().user.login, 'legacy_user');
  assert.equal((await f.login({ login: 'legacy_user' })).json().user.id, result.json().user.id);
  const duplicateEmail = await f.register({ login: 'different-login', email: 'LEGACY@example.test' });
  assert.equal(duplicateEmail.statusCode, 409);
  assert.equal(duplicateEmail.json().error, 'EMAIL_EXISTS');
});

test('logins and nicknames reserve one case-insensitive namespace, including profile changes', async t => {
  const f = await fixture(t);
  const first = await f.register({ name: 'Marina Costa', login: 'private_name', nickname: 'public_name' });
  assert.equal(first.statusCode, 201, first.body);
  for (const login of ['PRIVATE_NAME', 'PUBLIC_NAME']) {
    const collision = await f.register({ login });
    assert.equal(collision.statusCode, 409, collision.body);
    assert.equal(collision.json().error, 'LOGIN_EXISTS');
  }
  const nicknameCollision = await f.register({ login: 'fresh-login', nickname: 'private_name' });
  assert.equal(nicknameCollision.statusCode, 409);
  assert.equal(nicknameCollision.json().error, 'NICKNAME_EXISTS');
  const second = await f.register({ name: 'Private_Name', login: 'second-login' });
  assert.equal(second.statusCode, 201, second.body);
  assert.notEqual(second.json().user.nickname, 'private_name');
  const conflictingEdit = await f.app.inject({ method: 'PATCH', url: '/api/profile', headers: auth(second), payload: { nickname: 'PRIVATE_NAME' } });
  assert.equal(conflictingEdit.statusCode, 409);
  const successfulEdit = await f.app.inject({ method: 'PATCH', url: '/api/profile', headers: auth(first), payload: { nickname: 'changed_public_name' } });
  assert.equal(successfulEdit.statusCode, 200, successfulEdit.body);
  assert.equal(successfulEdit.json().user.login, 'private_name');
  assert.equal((await f.login({ login: 'private_name' })).json().user.id, first.json().user.id);
});

test('concurrent registrations cannot claim the same login', async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.register({ login: 'same-login' }), f.register({ login: 'SAME-LOGIN' })]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
  assert.equal(f.app.missionStore.read().users.length, 1);
});

test('invalid identifiers and passwords are rejected, with generic authentication failures', async t => {
  const f = await fixture(t);
  for (const login of ['ab', 'name@example.test', '@nickname', 'name with space', 'a'.repeat(31)]) {
    assert.equal((await f.register({ login })).statusCode, 400);
  }
  assert.equal((await f.register({})).statusCode, 400);
  for (const invalidPassword of ['1234567', '        ', 'x'.repeat(129)]) {
    assert.equal((await f.register({ login: 'invalid-password', password: invalidPassword })).statusCode, 400);
  }
  assert.equal((await f.register({ login: 'invalid-email', email: 'invalid' })).statusCode, 400);
  const good = await f.register({ login: 'good-login' });
  assert.equal(good.statusCode, 201, good.body);
  const incorrect = await f.login({ login: 'good-login', password: '00000000' });
  const missing = await f.login({ login: 'unknown-user' });
  assert.equal(incorrect.statusCode, 401);
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(incorrect.json(), missing.json());
  assert.equal((await f.login({ login: 'good-login', email: 'ambiguous@example.test' })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'PATCH', url: '/api/profile', headers: { cookie: auth(good).cookie }, payload: { nickname: 'new_name' } })).statusCode, 403);
  await f.app.missionStore.update(data => { data.users[0].active = false; });
  assert.equal((await f.login({ login: 'good-login' })).statusCode, 401);
  assert.equal((await f.register({ login: 'GOOD-LOGIN' })).statusCode, 409, 'inactive identities remain reserved');
});

test('email-free member profiles remain editable without collisions or allowing email replacement', async t => {
  const f = await fixture(t);
  const first = await f.register({ login: 'first-profile' });
  const second = await f.register({ login: 'second-profile' });
  assert.equal(second.statusCode, 201, second.body);
  const result = await f.app.inject({ method: 'PATCH', url: `/api/team/members/${first.json().user.memberId}`,
    headers: auth(first), payload: { displayName: 'New display name', email: '' } });
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().member.email, '');
  const replacement = await f.app.inject({ method: 'PATCH', url: `/api/team/members/${first.json().user.memberId}`,
    headers: auth(first), payload: { email: 'unverified@example.test' } });
  assert.equal(replacement.statusCode, 409);
  assert.equal(replacement.json().error, 'ACCOUNT_EMAIL_LOCKED');
});

test('legacy normalization reserves logins when generating nicknames and ambiguity fails closed', async t => {
  const f = await fixture(t);
  await f.register({ name: 'Existing', login: 'newperson' });
  const raw = structuredClone(f.app.missionStore.read());
  raw.users.unshift({ id: 'missing-nickname', name: 'New Person', active: true });
  const normalized = normalizeStoredData(raw);
  assert.notEqual(normalized.users[0].nickname, 'newperson');
  assert.equal(normalized.users[1].login, 'newperson');
  const duplicate = [{ id: 'first', active: true, login: 'collision' }, { id: 'second', active: true, nickname: 'COLLISION' }];
  assert.equal(findLoginUser(duplicate, 'collision'), null);
  assert.equal(findLoginUser([{ id: 'empty', active: true, email: '' }], ''), null);
});

test('authentication retains its rate limit for login identifiers', async t => {
  const f = await fixture(t);
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = await f.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.1.1.1', payload: { login: 'unknown-user', password } });
    assert.equal(result.statusCode, 401);
  }
  const limited = await f.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '127.1.1.1', payload: { login: 'unknown-user', password } });
  assert.equal(limited.statusCode, 429);
});
