import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import pg from 'pg';
import { createInitialData } from './data-store.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { buildApp } from './app.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class ControlledPool extends EventEmitter {
  constructor() {
    super();
    this.data = createInitialData();
    this.commands = [];
    this.releases = [];
    this.commitFailure = false;
    this.rollbackFailure = false;
  }
  async connect() {
    const client = new EventEmitter();
    let draft;
    client.query = async (sql, values) => {
      this.commands.push(sql);
      if (sql.startsWith('SELECT data')) return { rows: [{ data: structuredClone(this.data), revision: '0', updated_at_token: 'initial' }] };
      if (sql.startsWith('UPDATE norte_state')) {
        draft = JSON.parse(values[1]);
        return { rows: [{ revision: '1', updated_at_token: 'updated' }] };
      }
      if (sql === 'COMMIT') {
        if (draft) this.data = draft;
        if (this.commitFailure) {
          const error = new Error('COMMIT acknowledgement lost');
          client.emit('error', error);
          throw error;
        }
      }
      if (sql === 'ROLLBACK' && this.rollbackFailure) throw new Error('rollback unavailable');
      return { rows: [] };
    };
    client.release = discard => { this.releases.push(discard); };
    this.client = client;
    return client;
  }
  async query() { return { rows: [] }; }
}

test('idle pool errors do not terminate the process or add duplicate shared-pool handlers', () => {
  const pool = new ControlledPool();
  new PostgresDataStore('unused', { pool });
  new PostgresDataStore('unused', { pool });
  assert.equal(pool.listenerCount('error'), 1);
  assert.doesNotThrow(() => pool.emit('error', new Error('idle connection lost')));
});

test('a disconnected checked-out client rejects before its mutator completes and cannot write later', async () => {
  const pool = new ControlledPool();
  const store = await new PostgresDataStore('unused', { pool }).init();
  pool.commands.length = 0; pool.releases.length = 0;
  const started = deferred(), release = deferred();
  let calls = 0;
  const operation = store.update(async data => {
    calls++; started.resolve(); await release.promise;
    data.workspace.marker = 'late draft';
  });
  const rejected = assert.rejects(operation, /connection lost/);
  await started.promise;
  pool.client.emit('error', new Error('connection lost'));
  await rejected;
  assert.deepEqual(pool.releases, [true]);
  release.resolve(); await delay(0);
  assert.deepEqual(pool.commands, ['BEGIN', 'SELECT data FROM norte_state WHERE id = $1 FOR UPDATE']);
  assert.equal(store.read(data => data.workspace.marker), undefined);
  assert.equal(calls, 1);
  await store.update(data => { data.workspace.marker = 'next write'; });
  assert.equal(store.read(data => data.workspace.marker), 'next write');
});

test('a lost COMMIT acknowledgement never retries the mutator or publishes an uncertain cache', async () => {
  const pool = new ControlledPool();
  const store = await new PostgresDataStore('unused', { pool }).init();
  const before = store.data;
  pool.commitFailure = true;
  pool.commands.length = 0; pool.releases.length = 0;
  let calls = 0;
  await assert.rejects(store.update(data => { calls++; data.workspace.marker = 'committed remotely'; }), /COMMIT acknowledgement lost/);
  assert.equal(calls, 1);
  assert.equal(pool.commands.filter(sql => sql === 'COMMIT').length, 1);
  assert.equal(pool.data.workspace.marker, 'committed remotely', 'the write may have committed despite the missing acknowledgement');
  assert.equal(store.data, before, 'cache waits for a later database refresh');
  assert.deepEqual(pool.releases, [true]);
});

test('failed startup does not publish a snapshot and failed rollback preserves the original error', async () => {
  const pool = new ControlledPool();
  pool.commitFailure = true;
  const store = new PostgresDataStore('unused', { pool });
  await assert.rejects(store.init(), /COMMIT acknowledgement lost/);
  assert.equal(store.data, null);
  pool.commitFailure = false;
  await store.init();
  pool.rollbackFailure = true;
  await assert.rejects(store.update(() => { throw new Error('original domain error'); }), /original domain error/);
  assert.equal(pool.releases.at(-1), true);
});

// Opt-in only: termination is restricted to connections in a disposable local
// database. Never point this suite at a deployed service or a shared database.
const localUrl = process.env.NORTE_POSTGRES_TEST_URL;
if (localUrl) {
  const url = new URL(localUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/norte_test');
}
async function realFixture(t) {
  const schema = `connections_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: localUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: localUrl, options: `-c search_path=${schema}`, max: 1, connectionTimeoutMillis: 2000 });
  const store = await new PostgresDataStore(localUrl, { pool }).init();
  t.after(async () => {
    await store.queue;
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  return { store, pool, admin };
}

test('real PostgreSQL: terminate a checked-out connection between queries, then reconnect', { skip: !localUrl, timeout: 15000 }, async t => {
  const { store, pool, admin } = await realFixture(t);
  const pid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const started = deferred(), release = deferred();
  let calls = 0;
  const operation = store.update(async data => {
    calls++; started.resolve(); await release.promise;
    data.workspace.marker = 'must not commit';
  });
  const rejected = assert.rejects(operation, /terminat|connection/i);
  await started.promise;
  try {
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await rejected;
    await store.health();
    await store.refresh();
    assert.equal(store.read(data => data.workspace.marker), undefined);
    const nextPid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.notEqual(nextPid, pid);
  } finally { release.resolve(); }
  await delay(0);
  await store.update(data => { data.workspace.marker = 'reconnected'; });
  await store.refresh();
  assert.equal(store.read(data => data.workspace.marker), 'reconnected');
  assert.equal(calls, 1);
});

test('real PostgreSQL: terminate an idle connection, then health and refresh use a new one', { skip: !localUrl, timeout: 15000 }, async t => {
  const { store, pool, admin } = await realFixture(t);
  await store.update(data => { data.workspace.marker = 'preserved'; });
  const pid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const failed = new Promise(resolve => pool.once('error', resolve));
  await admin.query('SELECT pg_terminate_backend($1)', [pid]);
  await failed;
  await store.health();
  await store.refresh();
  assert.equal(store.read(data => data.workspace.marker), 'preserved');
  const nextPid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  assert.notEqual(nextPid, pid);
});


test('real PostgreSQL: a disconnected registration returns a sanitized failure and later requests recover', { skip: !localUrl, timeout: 15000 }, async t => {
  const { store, pool, admin } = await realFixture(t);
  store.close = async () => {}; // realFixture owns the shared pool.
  const app = await buildApp({ store, logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  const pid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const started = deferred(), release = deferred();
  const update = store.update.bind(store);
  store.update = mutator => {
    store.update = update;
    return update(async data => {
      started.resolve(); await release.promise;
      return mutator(data);
    });
  };
  const registration = { method: 'POST', url: '/api/auth/register', payload: { name: 'Recovery Test', email: 'recovery@example.test', password: 'isolated database interruption test' } };
  const response = app.inject(registration).then(value => value);
  await Promise.race([started.promise, response.then(value => { throw new Error(`Registration did not enter its transaction (${value.statusCode})`); })]);
  try {
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    const failed = await response;
    assert.equal(failed.statusCode, 500);
    assert.equal(failed.json().message, 'The server could not complete this request.');
    assert(!failed.body.includes('terminating connection'));
    assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    assert.equal(store.read(data => data.users.length), 0);
  } finally { release.resolve(); store.update = update; }
  await delay(0);
  const retry = await app.inject(registration);
  assert.equal(retry.statusCode, 201, retry.body);
  await store.refresh();
  assert.equal(store.read(data => data.users.length), 1, 'only the later explicit request creates an account');
});
