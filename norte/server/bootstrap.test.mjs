import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';
import { buildApp } from './app.mjs';
import { PostgresDataStore } from './postgres-store.mjs';

const password = 'Isolated initial account test passphrase';
async function fixture(t, { token = '', production = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-bootstrap-'));
  const storeFile = join(directory, 'state.json');
  let app;
  async function start(nextToken = token, nextProduction = production) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = nextProduction ? 'production' : 'test';
    try {
      app = await buildApp({ storeFile, databaseUrl: '', serveStatic: false, logger: false, demoAccount: false,
        bootstrapToken: nextToken, ai: { apiKey: '' }, systemAi: { apiKey: '' },
        platform: { encryptionKey: 'isolated-bootstrap-test-key-not-a-real-credential' } });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
  }
  await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  let serial = 1;
  const register = (name, bootstrapToken) => app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${serial++}`,
    payload: { name, nickname: name.toLowerCase(), email: `${name.toLowerCase()}@example.test`, password,
      ...(bootstrapToken === undefined ? {} : { bootstrapToken }) } });
  return { get app() { return app; }, register, storeFile,
    session: async () => (await app.inject({ method: 'GET', url: '/api/auth/session' })).json(),
    async restart(nextToken = token, nextProduction = production) { await app.close(); await start(nextToken, nextProduction); } };
}

test('production fails closed before the first owner when setup token is missing or too short', async t => {
  for (const token of ['', 'too-short']) {
    const f = await fixture(t, { token });
    assert.equal((await f.session()).bootstrapRequired, true);
    const denied = await f.register('Visitor', token);
    assert.equal(denied.statusCode, 503);
    assert.equal(denied.json().error, 'BOOTSTRAP_UNAVAILABLE');
    assert.equal(f.app.missionStore.read().users.length, 0);
    assert.equal(f.app.missionStore.read().sessions.length, 0);
    assert.equal((await f.app.inject('/api/health')).statusCode, 200, 'existing service stays available');
  }
});

test('missing and wrong setup codes cannot claim owner or expose the configured code', async t => {
  const token = randomBytes(32).toString('hex'), f = await fixture(t, { token });
  for (const submitted of [undefined, 'incorrect-but-long-enough-code-for-this-fixture', 'x']) {
    const denied = await f.register('Visitor', submitted);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error, 'BOOTSTRAP_INVALID');
    assert.ok(!denied.body.includes(token));
    assert.ok(!JSON.stringify(await f.session()).includes(token));
  }
  assert.equal(f.app.missionStore.read().users.length, 0);
});

test('valid setup code creates one owner, is not persisted, and cannot be reused', async t => {
  const token = randomBytes(32).toString('hex'), f = await fixture(t, { token });
  const owner = await f.register('Owner', token);
  assert.equal(owner.statusCode, 201, owner.body);
  assert.equal(owner.json().user.accessRole, 'owner_admin');
  assert.match(owner.headers['set-cookie'], /__Host-norte_session=/u);
  assert.match(owner.headers['set-cookie'], /; Secure/u);
  assert.match(owner.headers['set-cookie'], /; HttpOnly/u);
  assert.equal((await f.session()).bootstrapRequired, false);
  assert.equal((await f.session()).hasOwner, true);
  assert.ok(f.app.missionStore.read().authBootstrap.completedAt);
  assert.ok(!owner.body.includes(token));
  assert.ok(!(await readFile(f.storeFile, 'utf8')).includes(token));
  const replay = await f.register('Replay', token);
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error, 'BOOTSTRAP_COMPLETE');
  const member = await f.register('Member');
  assert.equal(member.statusCode, 201, member.body);
  assert.equal(member.json().user.accessRole, 'member');
  assert.equal(f.app.missionStore.read().users.filter(user => user.accessRole === 'owner_admin').length, 1);
});

test('concurrent setup requests consume the code atomically', async t => {
  const token = randomBytes(32).toString('hex'), f = await fixture(t, { token });
  const results = await Promise.all([f.register('FirstCandidate', token), f.register('SecondCandidate', token)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
  assert.equal(f.app.missionStore.read().users.length, 1);
  assert.equal(f.app.missionStore.read().users[0].accessRole, 'owner_admin');
});

test('restart without the consumed secret preserves login and ordinary registration', async t => {
  const token = randomBytes(32).toString('hex'), f = await fixture(t, { token });
  assert.equal((await f.register('Owner', token)).statusCode, 201);
  await f.restart('');
  assert.equal((await f.session()).bootstrapRequired, false);
  const login = await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@example.test', password } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().user.accessRole, 'owner_admin');
  assert.equal((await f.register('Member')).json().user.accessRole, 'member');
});

test('Postgres normalization preserves consumed bootstrap metadata across a new store instance', async t => {
  const pool = createMemoryPostgresPool(), token = randomBytes(32).toString('hex');
  let app;
  const start = async bootstrapToken => {
    const store = await new PostgresDataStore('postgresql://isolated-test', { pool }).init();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      app = await buildApp({ store, databaseUrl: 'postgresql://isolated-test', serveStatic: false, logger: false, demoAccount: false,
        bootstrapToken, ai: { apiKey: '' }, systemAi: { apiKey: '' },
        platform: { encryptionKey: 'isolated-bootstrap-test-key-not-a-real-credential' } });
    } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
  };
  await start(token);
  t.after(async () => app.close());
  const register = (name, bootstrapToken) => app.inject({ method: 'POST', url: '/api/auth/register',
    payload: { name, email: `${name.toLowerCase()}@example.test`, password, ...(bootstrapToken ? { bootstrapToken } : {}) } });
  assert.equal((await register('Owner', token)).statusCode, 201);
  const completedAt = app.missionStore.read().authBootstrap.completedAt;
  await app.missionStore.update(data => { data.users[0].accessRole = 'member'; data.users[0].active = false; });
  await app.close();
  await start('');
  assert.equal(app.missionStore.read().authBootstrap.completedAt, completedAt);
  assert.equal((await app.inject('/api/auth/session')).json().bootstrapRequired, false);
  assert.equal((await register('Replay', token)).statusCode, 409);
  assert.equal((await register('Member')).json().user.accessRole, 'member');
});

test('an existing legacy owner needs no new setup secret after upgrading to production', async t => {
  const f = await fixture(t, { production: false });
  assert.equal((await f.register('ExistingOwner')).json().user.accessRole, 'owner_admin');
  await f.app.missionStore.update(data => { delete data.authBootstrap; });
  await f.restart('', true);
  assert.equal((await f.session()).bootstrapRequired, false);
  assert.equal((await f.register('NewMember')).json().user.accessRole, 'member');
  assert.equal(f.app.missionStore.read().users.find(user => user.nickname === 'existingowner').accessRole, 'owner_admin');
});

test('removing or deactivating the initial owner does not reopen setup', async t => {
  const token = randomBytes(32).toString('hex'), f = await fixture(t, { token });
  assert.equal((await f.register('Owner', token)).statusCode, 201);
  await f.app.missionStore.update(data => { data.users[0].active = false; data.users[0].accessRole = 'member'; });
  await f.restart();
  assert.equal((await f.session()).hasOwner, false);
  assert.equal((await f.session()).bootstrapRequired, false);
  assert.equal((await f.register('Replay', token)).statusCode, 409);
  assert.equal((await f.register('NewMember')).json().user.accessRole, 'member');
});

test('development keeps the existing first-account experience without a setup code', async t => {
  const f = await fixture(t, { production: false });
  assert.equal((await f.session()).bootstrapRequired, false);
  assert.equal((await f.register('Developer')).json().user.accessRole, 'owner_admin');
  assert.equal((await f.register('Colleague')).json().user.accessRole, 'member');
});
