import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from './app.mjs';
import { normalizeStoredData } from './data-store.mjs';

const configuration = {
  login: 'Startup-Admin-Fixture', password: 'ｆｉｘｔｕｒｅ１２３',
  operationId: 'startup-admin-fixture-v1', createOnly: true
};
const cookie = response => response.headers['set-cookie'].split(';')[0];
async function fixture(t, initial = configuration) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-admin-startup-'));
  const storeFile = join(directory, 'state.json');
  let app, serial = 1;
  async function start(adminAccount = initial) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      app = await buildApp({ storeFile, databaseUrl: '', serveStatic: false, logger: false,
        demoAccount: false, bootstrapToken: '', adminAccount,
        ai: { apiKey: '' }, systemAi: { apiKey: '' },
        platform: { encryptionKey: 'isolated-admin-startup-test-key-not-a-real-credential' } });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
  }
  await start();
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, storeFile,
    login: (password = configuration.password, login = configuration.login) => app.inject({ method: 'POST', url: '/api/auth/login',
      remoteAddress: `127.0.0.${serial++}`, payload: { login, password } }),
    register: (login = 'ordinary-startup-user') => app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: `127.0.0.${serial++}`,
      payload: { name: 'Ordinary account', login, password: '12345678' } }),
    restart: async config => { await app.close(); await start(config); }
  };
}

test('private startup configuration creates an isolated administrator accessible through ordinary username sign-in', async t => {
  const f = await fixture(t);
  const state = f.app.missionStore.read(), owner = state.users[0];
  assert.equal(state.users.length, 1); assert.equal(owner.accessRole, 'owner_admin');
  assert.equal(state.teams.some(team => team.memberIds.includes(owner.memberId)), false);
  assert.equal(Object.values(state.workspace.projects).some(record => record.createdBy === owner.id), false);
  const login = await f.login(configuration.password.normalize('NFKC'), configuration.login.toLowerCase());
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().user.id, owner.id); assert.equal(login.json().user.accessRole, 'owner_admin');
  assert.match(login.headers['set-cookie'], /Secure/);
  const admin = await f.app.inject({ url: '/api/platform/admin/people', headers: { cookie: cookie(login) } });
  assert.equal(admin.statusCode, 403, admin.body);
  assert.equal(admin.json().error, 'ADMIN_MFA_REQUIRED', 'private setup never bypasses production MFA for sensitive admin controls');
  const fullWidthLogin = await f.login();
  assert.equal(fullWidthLogin.statusCode, 200, fullWidthLogin.body);
  const publicRegistration = await f.register();
  assert.equal(publicRegistration.statusCode, 201, publicRegistration.body);
  assert.equal(publicRegistration.json().user.accessRole, 'member');
  const denied = await f.app.inject({ url: '/api/platform/admin/people', headers: { cookie: cookie(publicRegistration) } });
  assert.equal(denied.statusCode, 403);
  const persisted = await readFile(f.storeFile, 'utf8');
  assert.equal(persisted.includes(configuration.password), false);
  assert.equal(persisted.includes(configuration.password.normalize('NFKC')), false);
  assert.equal(publicRegistration.body.includes(configuration.login), false);
});

test('startup retries preserve the password hash and never replay a completed password operation', async t => {
  const f = await fixture(t), before = f.app.missionStore.read();
  await f.restart({ ...configuration, password: 'another-fixture-password' });
  const after = f.app.missionStore.read();
  assert.equal(after.users[0].passwordHash, before.users[0].passwordHash);
  assert.deepEqual(after.adminAccountOperations, before.adminAccountOperations);
  assert.equal((await f.login()).statusCode, 200);
  assert.equal((await f.login('another-fixture-password')).statusCode, 401);
});

test('invalid private configuration does not interrupt public signup or expose deployment details', async t => {
  const f = await fixture(t, { ...configuration, password: 'short' });
  assert.equal(f.app.missionStore.read().users.length, 0);
  for (const url of ['/api/health', '/api/auth/session']) {
    const response = await f.app.inject({ url });
    assert.equal(response.statusCode, 200, response.body);
    for (const privateValue of [configuration.login, configuration.operationId, 'adminAccount', 'ADMIN_ACCOUNT_', 'NORTE_ADMIN_']) {
      assert.equal(response.body.includes(privateValue), false);
    }
  }
  const registration = await f.register();
  assert.equal(registration.statusCode, 201, registration.body);
  assert.equal(registration.json().user.accessRole, 'member');
  assert.equal(f.app.missionStore.read().adminAccountOperations, undefined);
});

test('a new create-only operation leaves an existing administrator and credentials untouched while the service stays healthy', async t => {
  const f = await fixture(t), before = f.app.missionStore.read();
  await f.restart({ ...configuration, login: 'Replacement-Fixture', password: 'replacement-fixture-password', operationId: 'startup-admin-fixture-v2' });
  assert.deepEqual(f.app.missionStore.read(), normalizeStoredData(before));
  assert.equal((await f.app.inject('/api/health')).statusCode, 200);
  assert.equal((await f.login()).statusCode, 200);
  assert.equal((await f.login('replacement-fixture-password', 'Replacement-Fixture')).statusCode, 401);
});
