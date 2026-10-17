import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import argon2 from 'argon2';
import { configureAdminAccount } from './admin-account.mjs';
import { JsonDataStore } from './data-store.mjs';

const setup = { login: 'Private-Admin-Login', password: '87654321', operationId: 'setup-fixture-v1' };
const persistedHash = await argon2.hash('previous-password-fixture', { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-admin-account-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new JsonDataStore(join(directory, 'state.json')).init();
}
function account(data, id = 'existing-owner', patch = {}) {
  const user = {
    id, memberId: `member-${id}`, name: 'Existing person', nickname: id.replaceAll('-', '_'),
    login: `login-${id}`, passwordHash: persistedHash, accessRole: 'owner_admin', active: true,
    createdAt: '2025-01-01T00:00:00.000Z', mfa: { enabled: true }, ...patch
  };
  data.users.push(user);
  data.members.push({ id: user.memberId, accountId: user.id, displayName: user.name, accountStatus: 'active' });
  return user;
}
async function unchanged(store, options, code) {
  const before = store.read();
  await assert.rejects(configureAdminAccount(store, options), error => error.code === code && !error.message.includes(options.login));
  assert.deepEqual(store.read(), before);
}

test('absent private configuration is a read-only no-op', async t => {
  const store = await fixture(t), before = store.read();
  store.update = () => { throw new Error('No write allowed'); };
  assert.deepEqual(await configureAdminAccount(store), { status: 'not-configured' });
  assert.deepEqual(await configureAdminAccount(store, {}), { status: 'not-configured' });
  assert.deepEqual(store.read(), before);
});

test('first administrator is isolated and stores only a hash and non-secret operation metadata', async t => {
  const store = await fixture(t), before = store.read();
  const result = await configureAdminAccount(store, setup), data = store.read();
  assert.equal(result.status, 'applied'); assert.equal(result.created, true);
  const user = data.users.find(item => item.id === result.userId);
  assert.equal(user.login, setup.login); assert.equal(user.accessRole, 'owner_admin');
  assert.notEqual(user.nickname, setup.login); assert.match(user.passwordHash, /^\$argon2id\$/);
  assert.equal(await argon2.verify(user.passwordHash, setup.password), true);
  assert(data.members.some(member => member.id === user.memberId && member.accountId === user.id));
  assert.deepEqual(data.teams, before.teams); assert.deepEqual(data.workspace, before.workspace);
  assert.deepEqual(data.artifacts, before.artifacts); assert(data.authBootstrap.completedAt);
  assert.equal(JSON.stringify(data).includes(setup.password), false);
  assert.equal(JSON.stringify(data.adminAccountOperations).includes(setup.login), false);
  assert.deepEqual(data.adminAccountOperations[0], {
    operationId: setup.operationId, userId: user.id, appliedAt: data.adminAccountOperations[0].appliedAt,
    action: 'admin.created', passwordUpdated: true
  });
});

test('applied operation never reapplies or resets a changed credential after restart', async t => {
  const store = await fixture(t); const result = await configureAdminAccount(store, setup);
  await store.update(data => Object.assign(data.users[0], { login: 'renamed-after-setup', passwordHash: persistedHash }));
  const restarted = await new JsonDataStore(store.filePath).init(), before = restarted.read();
  assert.deepEqual(await configureAdminAccount(restarted, setup), { status: 'already-applied', userId: result.userId });
  assert.deepEqual(restarted.read(), before);
});

test('renaming the unique active owner preserves password, sessions, MFA, profile and project ownership', async t => {
  const store = await fixture(t);
  await store.update(data => {
    account(data); account(data, 'ordinary', { accessRole: 'member' });
    data.sessions = [{ id: 'owner-session', userId: 'existing-owner' }, { id: 'member-session', userId: 'ordinary' }];
    data.authBootstrap = { completedAt: '2025-01-01T00:00:00.000Z' };
  });
  const before = store.read();
  await configureAdminAccount(store, { ...setup, password: undefined });
  const after = store.read(), user = after.users[0];
  assert.deepEqual(user, { ...before.users[0], login: setup.login, updatedAt: user.updatedAt });
  assert.deepEqual(after.sessions, before.sessions); assert.deepEqual(after.members, before.members);
  assert.deepEqual(after.teams, before.teams); assert.deepEqual(after.workspace, before.workspace);
  assert.deepEqual(after.users[1], before.users[1]); assert.deepEqual(after.authBootstrap, before.authBootstrap);
  assert.equal(after.adminAccountOperations[0].action, 'admin.updated');
  assert.equal(after.adminAccountOperations[0].passwordUpdated, false);
});

test('an explicitly requested password update revokes only the target sessions and runs once', async t => {
  const store = await fixture(t);
  await store.update(data => {
    account(data); account(data, 'ordinary', { accessRole: 'member' });
    data.sessions = [{ id: 'owner-session', userId: 'existing-owner' }, { id: 'member-session', userId: 'ordinary' }];
  });
  await configureAdminAccount(store, setup);
  const after = store.read();
  assert.equal(await argon2.verify(after.users[0].passwordHash, setup.password), true);
  assert.deepEqual(after.sessions, [{ id: 'member-session', userId: 'ordinary' }]);
  await configureAdminAccount(store, setup);
  assert.deepEqual(store.read(), after);
});

for (const field of ['login', 'nickname']) test(`login namespace collision with another account's ${field} does not promote or modify it`, async t => {
  const store = await fixture(t);
  await store.update(data => account(data, 'ordinary', { accessRole: 'member', [field]: setup.login.toLowerCase(), active: false }));
  await unchanged(store, setup, 'ADMIN_ACCOUNT_LOGIN_CONFLICT');
});

test('an ordinary account using the requested login cannot become administrator implicitly', async t => {
  const store = await fixture(t);
  await store.update(data => account(data, 'ordinary', { accessRole: 'member', login: setup.login }));
  await unchanged(store, setup, 'ADMIN_ACCOUNT_LOGIN_CONFLICT');
});

test('an explicit target can be promoted without resetting its password, MFA or member data', async t => {
  const store = await fixture(t);
  await store.update(data => {
    account(data, 'ordinary', { accessRole: 'member' });
    data.authBootstrap = { completedAt: '2025-01-01T00:00:00.000Z' };
  });
  const before = store.read();
  await configureAdminAccount(store, { ...setup, password: undefined, targetUserId: 'ordinary' });
  const after = store.read();
  assert.deepEqual(after.users[0], { ...before.users[0], login: setup.login, accessRole: 'owner_admin', updatedAt: after.users[0].updatedAt });
  assert.deepEqual(after.members, before.members); assert.deepEqual(after.workspace, before.workspace);
  assert.equal(after.adminAccountOperations[0].action, 'admin.promoted');
});

for (const patch of [{ active: false }, { isDemoAccount: true }, { demoSandboxId: 'test-sandbox' }, { deletedAt: '2025-01-01' }]) {
  test(`an explicit target must be a live real account (${Object.keys(patch)[0]})`, async t => {
    const store = await fixture(t);
    await store.update(data => account(data, 'ordinary', { accessRole: 'member', ...patch }));
    await unchanged(store, { ...setup, password: undefined, targetUserId: 'ordinary' }, 'ADMIN_ACCOUNT_TARGET_UNAVAILABLE');
  });
}

test('an explicit target never replaces another administrator', async t => {
  const store = await fixture(t);
  await store.update(data => { account(data); account(data, 'ordinary', { accessRole: 'member' }); });
  await unchanged(store, { ...setup, targetUserId: 'ordinary' }, 'ADMIN_ACCOUNT_AMBIGUOUS');
});

test('inactive, deleted or multiple real owners fail closed', async t => {
  for (const mode of ['inactive', 'deleted', 'multiple']) {
    const store = await fixture(t);
    await store.update(data => {
      account(data, 'existing-owner', mode === 'inactive' ? { active: false } : mode === 'deleted' ? { deletedAt: '2025-01-01' } : {});
      if (mode === 'multiple') account(data, 'another-owner');
    });
    await unchanged(store, setup, mode === 'multiple' ? 'ADMIN_ACCOUNT_AMBIGUOUS' : 'ADMIN_ACCOUNT_INACTIVE');
  }
});

test('consumed bootstrap does not reopen after the owner was deleted or demoted', async t => {
  const store = await fixture(t);
  await store.update(data => { data.authBootstrap = { completedAt: '2025-01-01T00:00:00.000Z' }; });
  await unchanged(store, setup, 'ADMIN_ACCOUNT_BOOTSTRAP_CLOSED');
});

test('creating an owner always requires an explicit valid password', async t => {
  const store = await fixture(t);
  await unchanged(store, { ...setup, password: undefined }, 'ADMIN_ACCOUNT_PASSWORD_REQUIRED');
  for (const password of ['', '123', '        ', 'x'.repeat(129), 'ﬀ'.repeat(65)]) {
    await unchanged(store, { ...setup, password }, 'ADMIN_ACCOUNT_INVALID_PASSWORD');
  }
});

test('passwords use the same Unicode NFKC normalization as sign-in', async t => {
  const store = await fixture(t), password = 'ｐａｓｓｗｏｒｄ１２３';
  await configureAdminAccount(store, { ...setup, password });
  const hash = store.read().users[0].passwordHash;
  assert.equal(await argon2.verify(hash, password.normalize('NFKC')), true);
  assert.equal(await argon2.verify(hash, password), false);
});

test('create-only setup never changes an existing administrator or promotes an explicit target', async t => {
  const store = await fixture(t);
  await store.update(data => account(data));
  await unchanged(store, { ...setup, createOnly: true }, 'ADMIN_ACCOUNT_ALREADY_EXISTS');
  await store.update(data => { data.users[0].accessRole = 'member'; });
  await unchanged(store, { ...setup, createOnly: true, targetUserId: 'existing-owner' }, 'ADMIN_ACCOUNT_ALREADY_EXISTS');
});

test('create-only setup is idempotent after creating its administrator', async t => {
  const store = await fixture(t), options = { ...setup, createOnly: true };
  await configureAdminAccount(store, options);
  const before = store.read();
  assert.equal((await configureAdminAccount(store, options)).status, 'already-applied');
  assert.deepEqual(store.read(), before);
});

test('a collision introduced while password hashing is rejected atomically', async t => {
  const store = await fixture(t), update = store.update.bind(store);
  let concurrent;
  store.update = async mutator => {
    await update(data => account(data, 'ordinary', { accessRole: 'member', nickname: setup.login.toLowerCase() }));
    concurrent = store.read();
    return update(mutator);
  };
  await assert.rejects(configureAdminAccount(store, setup), { code: 'ADMIN_ACCOUNT_LOGIN_CONFLICT' });
  assert.deepEqual(store.read(), concurrent);
});

test('an owner inserted concurrently is never renamed by a bootstrap creation', async t => {
  const store = await fixture(t), update = store.update.bind(store);
  let concurrent;
  store.update = async mutator => {
    await update(data => account(data)); concurrent = store.read();
    return update(mutator);
  };
  await assert.rejects(configureAdminAccount(store, setup), { code: 'ADMIN_ACCOUNT_STATE_CHANGED' });
  assert.deepEqual(store.read(), concurrent);
});

test('concurrent credential changes are never overwritten by a stale administrative operation', async t => {
  const store = await fixture(t); await store.update(data => account(data));
  const update = store.update.bind(store); let concurrent;
  store.update = async mutator => {
    await update(data => { data.users[0].login = 'changed-concurrently'; }); concurrent = store.read();
    return update(mutator);
  };
  await assert.rejects(configureAdminAccount(store, setup), { code: 'ADMIN_ACCOUNT_STATE_CHANGED' });
  assert.deepEqual(store.read(), concurrent);
});

test('concurrent application of one operation creates exactly one account and journal entry', async t => {
  const store = await fixture(t);
  const results = await Promise.all([configureAdminAccount(store, setup), configureAdminAccount(store, setup)]);
  assert.deepEqual(results.map(item => item.status).sort(), ['already-applied', 'applied']);
  assert.equal(store.read().users.length, 1); assert.equal(store.read().members.length, 1);
  assert.equal(store.read().adminAccountOperations.length, 1);
});

test('failed persistence is atomic and its error never leaks configuration values', async t => {
  const store = await fixture(t), before = store.read();
  store.persist = () => { throw new Error(`database write failed: ${setup.login} ${setup.password}`); };
  await assert.rejects(configureAdminAccount(store, setup), error => {
    assert.equal(error.code, 'ADMIN_ACCOUNT_CONFIG_FAILED');
    assert.equal(error.message.includes(setup.login), false); assert.equal(error.message.includes(setup.password), false);
    assert.equal(error.cause, undefined); return true;
  });
  assert.deepEqual(store.read(), before);
});
