import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { planMeetingRetirement, applyMeetingRetirement } from './meeting-retirement.mjs';

const localUrl = process.env.NORTE_POSTGRES_TEST_URL;
if (localUrl) {
  const url = new URL(localUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'retirement tests require local PostgreSQL');
  assert.equal(url.pathname, '/norte_test');
}
const options = { skip: !localUrl, timeout: 15000 };
const removed = ['retired-meeting', 'another-retired-meeting'];
const removedUsers = ['9007199254740993', '12'];
const bridge = scope => `bridge.${createHash('sha256').update(scope).digest('hex').slice(0, 25)}`;
const users = [
  ['1', 'native-person'], ['2', bridge('meeting:retained-meeting')],
  ['3', bridge('meeting:orphan-not-in-node-state')], ['4', bridge('user:retired-meeting')],
  ['5', bridge('project:retired-meeting')],
  ...removed.map((id, index) => [removedUsers[index], bridge(`meeting:${id}`)])
];
const legacyTables = ['ai_events', 'ai_proposals', 'ai_evaluations', 'ai_aliases'];
const childTables = ['norte_sessions', 'norte_records', 'ai_jobs', 'ai_usage', 'ai_block_memory',
  'ai_block_requests', 'ai_block_uses', 'ai_block_feedback', 'ai_block_evaluations', 'ai_meeting_learning', ...legacyTables];
const tables = ['norte_users', ...childTables];
const globals = ['ai_budget', 'ai_minutes_budget', 'reference_entries'];

async function fixture(t) {
  const schema = `meeting_retirement_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: localUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = new pg.Client({ connectionString: localUrl, options: `-c search_path=${schema}` });
  await client.connect();
  t.after(async () => {
    await client.query('ROLLBACK');
    await client.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  const queries = [];
  const query = async (sql, values) => { queries.push(sql); return client.query(sql, values); };
  await query('BEGIN');
  await query(`CREATE TABLE norte_users (
    id BIGINT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', created_at BIGINT NOT NULL DEFAULT 1
  )`);
  for (const table of childTables) {
    await query(`CREATE TABLE ${table} (
      id TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES norte_users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1
    )`);
  }
  await query(`CREATE TABLE ai_budget (day TEXT PRIMARY KEY, calls INTEGER, reserved_usd DOUBLE PRECISION);
    CREATE TABLE ai_minutes_budget (day TEXT PRIMARY KEY, calls INTEGER);
    CREATE TABLE reference_entries (id TEXT PRIMARY KEY, content TEXT);
    CREATE TABLE retirement_test_backups (id TEXT PRIMARY KEY, payload JSONB NOT NULL)`);
  for (const [id, username] of users) {
    await query('INSERT INTO norte_users (id, username, password_hash) VALUES ($1, $2, $3)', [id, username, `test-only-hash-${id}`]);
    for (const table of childTables) {
      await query(`INSERT INTO ${table} (id, user_id, payload, version) VALUES ($1, $2, $3, $4)`,
        [`record-${id}`, id, JSON.stringify({ source: `Original preserved for ${id}`, corrected: 'ação, 3,3 V\nsegunda linha' }), '9007199254740995']);
    }
  }
  await query("INSERT INTO ai_budget VALUES ('2026-10-24', 9, 1.25); INSERT INTO ai_minutes_budget VALUES ('2026-10-24', 3); INSERT INTO reference_entries VALUES ('official-reference', 'Preserved source')");
  await query('COMMIT');
  const rows = async (table, filter = '', values) => (await query(`SELECT row_to_json(t)::text AS value FROM ${table} t ${filter} ORDER BY row_to_json(t)::text`, values)).rows.map(row => row.value);
  const snapshot = async (names = [...tables, ...globals, 'retirement_test_backups']) => {
    const data = {};
    for (const name of names) data[name] = await rows(name);
    return data;
  };
  return { query, queries, rows, snapshot, schema };
}

test('meeting retirement rejects implicit or invalid IDs before querying storage', async () => {
  const query = async () => assert.fail('invalid configuration must not access storage');
  for (const ids of [undefined, null, 'all', [null], [''], ['*'], ['meeting:old'], ['old;DELETE FROM norte_users']]) {
    await assert.rejects(planMeetingRetirement(query, ids), { code: 'RETIREMENT_CONFIG_INVALID' });
  }
});

test('meeting retirement requires both reviewed fingerprint and backup before querying storage', async () => {
  const query = async () => assert.fail('unreviewed retirement must not access storage');
  for (const config of [undefined, {}, { expectedFingerprint: 'a'.repeat(64) }, { backup: async () => {} },
    { expectedFingerprint: 'unreviewed', backup: async () => {} }]) {
    await assert.rejects(applyMeetingRetirement(query, removed, config), { code: 'RETIREMENT_CONFIG_INVALID' });
  }
});

test('PostgreSQL retirement plan selects only exact removed meeting namespaces and preserves bigint rows', options, async t => {
  const f = await fixture(t), before = await f.snapshot();
  const plan = await planMeetingRetirement(f.query, removed);
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual([...plan.meetingIds].sort(), [...removed].sort());
  assert.deepEqual([...plan.userIds].sort(), [...removedUsers].sort());
  assert.equal(plan.payload.format, 'norte.meeting-retirement.v1');
  assert.deepEqual(Object.keys(plan.payload.tables).sort(), [...tables].sort());
  for (const table of tables) {
    const key = table === 'norte_users' ? 'id' : 'user_id';
    const expected = await f.rows(table, `WHERE ${key} = ANY($1::bigint[])`, [removedUsers]);
    assert.deepEqual([...plan.payload.tables[table]].sort(), expected, table);
    assert.equal(plan.counts[table], removedUsers.length, table);
    assert.ok(plan.payload.tables[table].every(row => typeof row === 'string'));
  }
  assert.ok(plan.payload.tables.norte_users.some(row => row.includes('9007199254740993')));
  assert.ok(plan.payload.tables.norte_records.some(row => row.includes('9007199254740995')));
  for (const table of legacyTables) assert.equal(plan.payload.tables[table].length, removedUsers.length, `${table} is backed up before retirement`);
  assert.deepEqual(await f.snapshot(), before, 'planning must not alter original rows');
  const repeated = await planMeetingRetirement(f.query, [...removed].reverse());
  assert.equal(repeated.fingerprint, plan.fingerprint, 'input ordering does not change the reviewed plan');
});

test('PostgreSQL retirement backs up before deleting and preserves native, retained, orphan and global data', options, async t => {
  const f = await fixture(t), before = await f.snapshot();
  const plan = await planMeetingRetirement(f.query, removed);
  await f.query('BEGIN');
  let backedUp = false;
  const result = await applyMeetingRetirement(f.query, removed, {
    expectedFingerprint: plan.fingerprint,
    backup: async current => {
      assert.deepEqual(await f.snapshot(), before, 'backup receives the complete original rows before deletion');
      assert.deepEqual(current.payload, plan.payload);
      await f.query('INSERT INTO retirement_test_backups VALUES ($1, $2::jsonb)', ['confirmed', JSON.stringify(current.payload)]);
      backedUp = true;
    }
  });
  assert.equal(backedUp, true);
  await f.query('COMMIT');
  assert.deepEqual(result, { fingerprint: plan.fingerprint, meetingIds: plan.meetingIds, userIds: plan.userIds, counts: plan.counts });
  for (const table of tables) {
    const key = table === 'norte_users' ? 'id' : 'user_id';
    assert.deepEqual(await f.rows(table, `WHERE ${key} = ANY($1::bigint[])`, [removedUsers]), []);
    assert.equal((await f.rows(table)).length, users.length - removedUsers.length);
    assert.deepEqual(await f.rows(table), before[table].filter(row => !plan.payload.tables[table].includes(row)), table);
  }
  for (const table of globals) assert.deepEqual(await f.rows(table), before[table]);
  for (const table of legacyTables) {
    assert.deepEqual((await f.query(`SELECT user_id::text FROM ${table} ORDER BY user_id`)).rows.map(row => row.user_id), ['1', '2', '3', '4', '5'],
      `${table} preserves native, retained, orphan, user and project namespaces`);
  }
  const backup = (await f.query('SELECT payload FROM retirement_test_backups WHERE id = $1', ['confirmed'])).rows[0].payload;
  assert.deepEqual(backup, plan.payload, 'committed backup keeps the unparsed row JSON, including large integer literals');
});

test('PostgreSQL retirement refuses a changed reviewed fingerprint before backup or deletion', options, async t => {
  const f = await fixture(t), plan = await planMeetingRetirement(f.query, removed);
  await f.query('UPDATE ai_block_memory SET payload = $1 WHERE user_id = $2', ['Human correction after review', removedUsers[0]]);
  const changed = await f.snapshot();
  await f.query('BEGIN');
  let backedUp = false;
  await assert.rejects(applyMeetingRetirement(f.query, removed, {
    expectedFingerprint: plan.fingerprint, backup: async () => { backedUp = true; }
  }), { code: 'RETIREMENT_FINGERPRINT_MISMATCH' });
  await f.query('ROLLBACK');
  assert.equal(backedUp, false);
  assert.deepEqual(await f.snapshot(), changed);
});

test('PostgreSQL retirement does not delete when durable backup fails', options, async t => {
  const f = await fixture(t), before = await f.snapshot(), plan = await planMeetingRetirement(f.query, removed);
  await f.query('BEGIN');
  const startedAt = f.queries.length;
  await assert.rejects(applyMeetingRetirement(f.query, removed, {
    expectedFingerprint: plan.fingerprint, backup: async () => { throw new Error('Backup unavailable'); }
  }), /Backup unavailable/u);
  assert.equal(f.queries.slice(startedAt).some(sql => /^\s*DELETE\b/iu.test(sql)), false);
  await f.query('ROLLBACK');
  assert.deepEqual(await f.snapshot(), before);
});

test('PostgreSQL retirement prevents worker writes from changing the snapshot during backup', options, async t => {
  const f = await fixture(t), plan = await planMeetingRetirement(f.query, removed);
  const worker = new pg.Client({ connectionString: localUrl, options: `-c search_path=${f.schema} -c lock_timeout=100ms` });
  await worker.connect();
  t.after(() => worker.end());
  await f.query('BEGIN');
  await applyMeetingRetirement(f.query, removed, {
    expectedFingerprint: plan.fingerprint,
    backup: async current => {
      await assert.rejects(worker.query('UPDATE ai_block_memory SET payload = $1 WHERE user_id = $2', ['Concurrent write', removedUsers[0]]), { code: '55P03' });
      await f.query('INSERT INTO retirement_test_backups VALUES ($1, $2::jsonb)', ['locked', JSON.stringify(current.payload)]);
    }
  });
  await f.query('COMMIT');
  assert.equal((await worker.query('UPDATE ai_block_memory SET payload = $1 WHERE user_id = $2', ['No resurrected record', removedUsers[0]])).rowCount, 0);
});

test('PostgreSQL caller rollback restores deleted records and rolls back its backup after a later failure', options, async t => {
  const f = await fixture(t), before = await f.snapshot(), plan = await planMeetingRetirement(f.query, removed);
  await assert.rejects(async () => {
    await f.query('BEGIN');
    try {
      await applyMeetingRetirement(f.query, removed, {
        expectedFingerprint: plan.fingerprint,
        backup: async current => f.query('INSERT INTO retirement_test_backups VALUES ($1, $2::jsonb)', ['rolled-back', JSON.stringify(current.payload)])
      });
      assert.equal((await f.rows('norte_users')).length, users.length - removedUsers.length, 'deletion occurred inside the caller transaction');
      assert.equal((await f.rows('retirement_test_backups')).length, 1);
      throw new Error('Later Node state write failed');
    } catch (error) { await f.query('ROLLBACK'); throw error; }
  }, /Later Node state write failed/u);
  assert.deepEqual(await f.snapshot(), before, 'both domains can share one atomic transaction');
});

test('PostgreSQL retirement blocks an unknown cascading dependency instead of losing unbacked rows', options, async t => {
  const f = await fixture(t), plan = await planMeetingRetirement(f.query, removed);
  await f.query('CREATE TABLE future_meeting_data (id TEXT PRIMARY KEY, user_id BIGINT REFERENCES norte_users(id) ON DELETE CASCADE, content TEXT)');
  await f.query('INSERT INTO future_meeting_data VALUES ($1, $2, $3)', ['unknown-row', removedUsers[0], 'Must survive']);
  const before = await f.snapshot([...tables, ...globals, 'retirement_test_backups', 'future_meeting_data']);
  await f.query('BEGIN');
  let backedUp = false;
  await assert.rejects(applyMeetingRetirement(f.query, removed, {
    expectedFingerprint: plan.fingerprint, backup: async () => { backedUp = true; }
  }), error => {
    assert.equal(error.code, 'RETIREMENT_UNKNOWN_FOREIGN_KEY');
    assert.deepEqual(error.retirementDetails, { unknownReferences: [{
      table: 'future_meeting_data', schema: f.schema, column: 'user_id',
      referencedTable: 'norte_users', referencedColumn: 'id', columnCount: 1
    }] });
    const diagnostic = JSON.stringify(error);
    assert.doesNotMatch(diagnostic, /Must survive|unknown-row|9007199254740993|test-only-hash|Original preserved|"payload"/u);
    return true;
  });
  await f.query('ROLLBACK');
  assert.equal(backedUp, false, 'an unreviewed dependency blocks the operation before backup and deletion');
  assert.deepEqual(await f.snapshot(Object.keys(before)), before);
});
