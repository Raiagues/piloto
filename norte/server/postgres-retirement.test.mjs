import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createInitialData } from './data-store.mjs';
import { encodePostgresState, decodePostgresState } from './postgres-state-codec.mjs';
import { retirementConfig, runPostgresRetirement } from './postgres-retirement.mjs';

const localUrl = process.env.NORTE_POSTGRES_TEST_URL;
if (localUrl) {
  const url = new URL(localUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/norte_test');
}
const config = { mode: 'plan', id: 'retire-fixture', keepProject: 'keep', removeProjectIds: ['old'] };
test('maintenance is explicit and cannot select its retained project', () => {
  assert.throws(() => retirementConfig({}), /Invalid/);
  assert.throws(() => retirementConfig({ ...config, mode: 'apply' }), /Invalid/);
  assert.throws(() => retirementConfig({ ...config, removeProjectIds: ['keep'] }), /Invalid/);
  assert.deepEqual(retirementConfig(JSON.stringify(config)), config);
});

async function fixture(t) {
  const schema = `retire_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: localUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: localUrl, options: `-c search_path=${schema}` });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const data = createInitialData();
  data.users = [{ id: 'real', memberId: 'real-member', active: true, passwordHash: 'preserve-real-account' }, { id: 'demo', memberId: 'demo-member', isDemoAccount: true }];
  data.members = [{ id: 'real-member', accountId: 'real' }, { id: 'demo-member', accountId: 'demo' }];
  data.teams = [{ id: 'team-keep', memberIds: ['real-member'] }, { id: 'team-old', memberIds: ['demo-member'], isDemoAccount: true }];
  data.workspace.projects = Object.fromEntries(['keep', 'old'].map(id => [id, { revision: 2, document: { id, context: { teamId: `team-${id}` } } }]));
  data.workspace.delivery = { keep: { requirements: [{ id: 'requirement', text: 'preserved source' }] }, old: { requirements: [] } };
  data.artifacts = [{ id: 'keep-file', projectId: 'keep', ownerId: 'keep', documentText: 'original source' }, { id: 'old-file', projectId: 'old', ownerId: 'old', documentText: 'retired original' }];
  data.meetings = { 'old-meeting': { id: 'old-meeting', ownerId: 'demo', projectId: 'old' }, 'private-meeting': { id: 'private-meeting', ownerId: 'real', transcript: 'preserved' } };
  const encoded = await encodePostgresState(data, { compress: true, compactStrings: true });
  await pool.query('CREATE TABLE norte_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, revision BIGINT NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())');
  await pool.query('INSERT INTO norte_state (id,data,revision) VALUES ($1,$2::jsonb,7)', ['primary', JSON.stringify(encoded)]);
  await pool.query('CREATE TABLE norte_users (id BIGINT PRIMARY KEY, username TEXT NOT NULL UNIQUE)');
  await pool.query('CREATE TABLE norte_records (user_id BIGINT REFERENCES norte_users(id) ON DELETE CASCADE, key TEXT, value TEXT, version BIGINT, PRIMARY KEY(user_id,key))');
  const bridge = id => `bridge.${createHash('sha256').update(`meeting:${id}`).digest('hex').slice(0, 25)}`;
  await pool.query('INSERT INTO norte_users VALUES (1,$1),(2,$2),(3,$3)', [bridge('old-meeting'), bridge('private-meeting'), 'native-real-account']);
  await pool.query("INSERT INTO norte_records VALUES (1,'record','retired',1),(2,'record','retained bridge',2),(3,'record','retained native',3)");
  return { pool, data, encoded, run: value => runPostgresRetirement('unused', value, { pool }) };
}

test('reviewed PostgreSQL retirement backs up exact state and preserves real ACL and native records', { skip: !localUrl }, async t => {
  const { pool, data, encoded, run } = await fixture(t);
  const planned = await run(config);
  assert.equal(planned.status, 'planned');
  assert.equal((await pool.query("SELECT to_regclass('norte_retirement_backups') AS backup")).rows[0].backup, null, 'plan has no persistent writes');
  const request = { ...config, mode: 'apply', expectedFingerprint: planned.fingerprint };
  assert.equal((await run(request)).status, 'applied');
  const backup = (await pool.query('SELECT * FROM norte_retirement_backups')).rows[0];
  assert.deepEqual(backup.node_state, encoded, 'backup is the original encoded row');
  assert.deepEqual(await decodePostgresState(backup.node_state), data);
  const current = await decodePostgresState((await pool.query('SELECT data FROM norte_state')).rows[0].data);
  assert.deepEqual(current.users, [data.users[0]]);
  assert.deepEqual(current.teams, [data.teams[0]]);
  assert.deepEqual(current.workspace.projects.keep, data.workspace.projects.keep);
  assert.deepEqual(current.meetings['private-meeting'], data.meetings['private-meeting']);
  assert.deepEqual((await pool.query('SELECT username FROM norte_users ORDER BY id')).rows.map(row => row.username).length, 2);
  assert.deepEqual((await pool.query('SELECT value FROM norte_records ORDER BY user_id')).rows.map(row => row.value), ['retained bridge', 'retained native']);
  assert.equal((await run(request)).status, 'already-applied');
  assert.equal((await pool.query('SELECT COUNT(*) FROM norte_retirement_backups')).rows[0].count, '1');
});

test('changed source or a failed final write rolls back backup, worker removals and state together', { skip: !localUrl }, async t => {
  const { pool, encoded, run } = await fixture(t);
  const planned = await run(config);
  await assert.rejects(run({ ...config, mode: 'apply', expectedFingerprint: '0'.repeat(64) }), { code: 'RETIREMENT_FINGERPRINT_MISMATCH' });
  await pool.query(`CREATE FUNCTION reject_state_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture write rejected'; END $$`);
  await pool.query('CREATE TRIGGER reject_update BEFORE UPDATE ON norte_state FOR EACH ROW EXECUTE FUNCTION reject_state_update()');
  await assert.rejects(run({ ...config, mode: 'apply', expectedFingerprint: planned.fingerprint }), /fixture write rejected/);
  assert.deepEqual((await pool.query('SELECT data FROM norte_state')).rows[0].data, encoded);
  assert.equal((await pool.query('SELECT COUNT(*) FROM norte_users')).rows[0].count, '3');
  assert.equal((await pool.query('SELECT COUNT(*) FROM norte_records')).rows[0].count, '3');
  assert.equal((await pool.query("SELECT to_regclass('norte_retirement_backups') AS backup")).rows[0].backup, null);
});
