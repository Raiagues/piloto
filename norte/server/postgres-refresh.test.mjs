import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { createInitialData } from './data-store.mjs';
import { createValidationProject } from './test-support/project.mjs';
import { buildApp } from './app.mjs';

// The same regression suite runs against pg-mem and an explicitly supplied
// disposable local PostgreSQL database. It never accepts a hosted database.
const localUrl = process.env.NORTE_POSTGRES_TEST_URL;
if (localUrl) {
  const url = new URL(localUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/norte_test');
}
async function fixture(t, { legacy = false } = {}) {
  let pool, dispose;
  if (localUrl) {
    const schema = `refresh_${randomUUID().replaceAll('-', '')}`;
    const admin = new pg.Pool({ connectionString: localUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: localUrl, options: `-c search_path=${schema}`, max: 4 });
    dispose = async () => { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); };
  } else {
    pool = createMemoryPostgresPool();
  }
  // pg-mem cannot backfill defaults for old rows on ADD COLUMN. The real
  // PostgreSQL run is responsible for this migration compatibility case.
  if (legacy && localUrl) {
    await pool.query('CREATE TABLE norte_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await pool.query('INSERT INTO norte_state(id, data) VALUES ($1, $2::jsonb)', ['primary', JSON.stringify(createInitialData())]);
  }
  const store = await new PostgresDataStore('postgresql://test', { pool }).init();
  t.after(async () => { await store.queue; await pool.end(); await dispose?.(); });
  return { store, pool };
}

test('unchanged PostgreSQL bursts share one revision check without retransferring documents', async t => {
  const { store, pool } = await fixture(t, { legacy: true });
  const query = pool.query.bind(pool), transferred = [];
  pool.query = async (...args) => {
    const result = await query(...args);
    if (String(args[0]).includes('CASE WHEN')) transferred.push(result.rows[0].data);
    return result;
  };
  const cached = store.data;
  await Promise.all(Array.from({ length: 30 }, () => store.refresh()));
  assert.deepEqual(transferred, [null]);
  assert.equal(store.data, cached, 'unchanged state is neither parsed nor normalized again');
  await store.refresh();
  assert.deepEqual(transferred, [null, null], 'later requests still check PostgreSQL; there is no ACL TTL');
  const selected = store.read(data => ({ teams: data.teams }));
  selected.teams.push({ id: 'caller mutation' });
  assert.equal(store.read(data => data.teams.length), 0);
  store.data.expensiveUnrelatedDocument = { get body() { throw new Error('unrelated document was cloned'); } };
  assert.equal(store.read(data => data.users.length), 0, 'small reads do not walk unrelated documents');
  delete store.data.expensiveUnrelatedDocument;
});

test('refresh sharing never crosses a queued write, and rejected writes do not poison the queue', async t => {
  const { store, pool } = await fixture(t);
  const query = pool.query.bind(pool);
  let release, started, refreshes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { started = resolve; });
  pool.query = async (...args) => {
    if (String(args[0]).includes('CASE WHEN') && ++refreshes === 1) { started(); await gate; }
    return query(...args);
  };
  const first = store.refresh(); await held;
  const write = store.update(data => { data.workspace.marker = 'new value'; });
  const second = store.refresh(), shared = store.refresh();
  assert.notEqual(first, second); assert.equal(shared, second);
  release(); await Promise.all([first, write, second]);
  assert.equal(refreshes, 2);
  assert.equal(store.read(data => data.workspace.marker), 'new value');
  await assert.rejects(store.update(data => { data.workspace.marker = 'must roll back'; throw new Error('rejected'); }), /rejected/);
  await store.refresh();
  assert.equal(store.read(data => data.workspace.marker), 'new value');
});

test('external writes invalidate the snapshot, including legacy updates during rolling deployment', async t => {
  const { store, pool } = await fixture(t);
  const other = await new PostgresDataStore('postgresql://test', { pool }).init();
  await other.update(data => { data.workspace.marker = 'second instance'; });
  await store.refresh();
  assert.equal(store.read(data => data.workspace.marker), 'second instance');
  const beforeRevision = store.revision;
  const legacy = store.read(); legacy.workspace.marker = 'legacy instance';
  await pool.query('UPDATE norte_state SET data = $2::jsonb, updated_at = $3::timestamptz WHERE id = $1', ['primary', JSON.stringify(legacy), '2030-02-03T04:05:06.123456Z']);
  await store.refresh();
  assert.equal(store.revision, beforeRevision, 'legacy writer does not know the new revision column');
  assert.equal(store.read(data => data.workspace.marker), 'legacy instance');
});

test('requests arriving after an in-flight SELECT get a fresh snapshot following external revocation', async t => {
  const { store, pool } = await fixture(t);
  const other = await new PostgresDataStore('postgresql://test', { pool }).init();
  await other.update(data => { data.users.push({ id: 'actor', name: 'Actor', nickname: 'actor', active: true }); });
  const query = pool.query.bind(pool);
  let release, selected, checks = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const held = new Promise(resolve => { selected = resolve; });
  pool.query = async (...args) => {
    const result = await query(...args);
    if (String(args[0]).includes('CASE WHEN') && ++checks === 1) { selected(); await gate; }
    return result;
  };
  const first = store.refresh();
  await held; // The old SELECT snapshot has already been evaluated.
  await other.update(data => { data.users.find(user => user.id === 'actor').active = false; });
  const afterRevocation = store.refresh();
  try { assert.notEqual(afterRevocation, first, 'a new request must not adopt an already-started SQL snapshot'); }
  finally { release(); }
  await Promise.all([first, afterRevocation]);
  assert.equal(checks, 2);
  assert.equal(store.read(data => data.users.find(user => user.id === 'actor').active), false);
});

test('project/team listing sees cross-instance membership and session revocation immediately', async t => {
  const { store, pool } = await fixture(t);
  // fixture owns the shared pool; app shutdown only drains its other resources.
  store.close = async () => {};
  const app = await buildApp({ store, logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Local Reviewer', email: 'reviewer@example.test', password: 'isolated postgres permission test' } });
  assert.equal(registered.statusCode, 201, registered.body);
  const cookie = registered.headers['set-cookie'].split(';')[0], user = registered.json().user;
  const headers = { cookie };
  const other = await new PostgresDataStore('postgresql://test', { pool }).init();
  const project = createValidationProject(); project.context.teamId = 'shared-team';
  const projectId = project.id;
  await other.update(data => { data.teams.push({ id: 'shared-team', name: 'Shared', createdBy: 'another-owner', captainMemberId: 'another-member', memberIds: [user.memberId], artifactIds: [], joinRequests: [] }); data.workspace.projects[projectId] = { document: project, revision: 1, createdBy: 'another-owner' }; });
  let projects = await app.inject({ method: 'GET', url: '/api/projects', headers });
  assert.equal(projects.statusCode, 200, projects.body);
  assert(projects.json().projects.some(project => project.id === projectId));
  const teamBefore = await app.inject({ method: 'GET', url: '/api/teams', headers });
  assert.equal(teamBefore.json().teams[0].membership, 'member');
  await other.update(data => { data.teams[0].memberIds = []; });
  [projects] = await Promise.all(['/api/projects', '/api/teams', '/api/team/members'].map(url => app.inject({ method: 'GET', url, headers })));
  assert.deepEqual(projects.json().projects, []);
  const denied = await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers });
  assert.equal(denied.statusCode, 403);
  await other.update(data => { data.users.find(item => item.id === user.id).active = false; });
  const revoked = await app.inject({ method: 'GET', url: '/api/projects', headers });
  assert.equal(revoked.statusCode, 401);
});

test('health remains independent of a blocked refresh/write queue and still detects database failures', async t => {
  const { store } = await fixture(t);
  store.close = async () => {};
  const app = await buildApp({ store, logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  let release, entered, refreshes = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const blocked = new Promise(resolve => { entered = resolve; });
  const refresh = store.refresh.bind(store);
  store.refresh = async () => { refreshes++; entered(); await gate; return refresh(); };
  const listing = app.inject({ method: 'GET', url: '/api/projects' });
  await blocked;
  try {
    const health = await Promise.race([
      app.inject({ method: 'GET', url: '/api/health?probe=1' }),
      new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('health was blocked by the state queue')), 1500); timeout.unref(); })
    ]);
    assert.equal(health.statusCode, 200, health.body);
    assert.equal(refreshes, 1, 'health must not enqueue a full-state refresh');
    store.health = async () => { throw new Error('database unavailable'); };
    assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 500);
  } finally { release(); await listing; }
});
