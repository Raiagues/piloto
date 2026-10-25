import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { PostgresDataStore } from './postgres-store.mjs';
import { decodePostgresState, encodePostgresState, isEncodedPostgresState } from './postgres-state-codec.mjs';
import { createInitialData } from './data-store.mjs';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';

const localUrl = process.env.NORTE_POSTGRES_TEST_URL;
if (localUrl) {
  const url = new URL(localUrl);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/norte_test');
}
async function fixture(t) {
  let pool, admin, schema;
  if (localUrl) {
    schema = `codec_${randomUUID().replaceAll('-', '')}`;
    admin = new pg.Pool({ connectionString: localUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: localUrl, options: `-c search_path=${schema}`, max: 3 });
  } else pool = createMemoryPostgresPool();
  t.after(async () => {
    await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  });
  const row = async () => (await pool.query('SELECT data, revision::text AS revision FROM norte_state WHERE id = $1', ['primary'])).rows[0];
  return { pool, row };
}

test('reader-first rollout preserves documents, sessions and compressed writes across mixed settings', async t => {
  const { pool, row } = await fixture(t);
  const reader = await new PostgresDataStore('unused', { pool, compressState: false }).init();
  const text = 'Fonte preservada: alimentação 3,3 V; ação e evidência.\n'.repeat(200);
  const artifact = { id: 'preserved-file', ownerId: 'validation-project', scope: 'project', url: `data:text/plain;base64,${Buffer.from(text).toString('base64')}`, documentText: text };
  await reader.update(data => {
    data.artifacts.push(artifact);
    data.sessions.push({ id: 'test-session', tokenHash: 'fixture-hash', csrfToken: 'fixture-csrf' });
    data.workspace.extension = { keep: 'unknown future field' };
  });
  const original = reader.read();
  assert.equal(isEncodedPostgresState((await row()).data), false);
  const writer = await new PostgresDataStore('unused', { pool, compressState: true }).init();
  assert.equal(isEncodedPostgresState((await row()).data), false, 'startup does not migrate before a confirmed transaction');
  await writer.update(data => { data.workspace.marker = 'first encoded write'; });
  assert.equal(isEncodedPostgresState((await row()).data), true);
  await reader.refresh();
  assert.deepEqual(reader.read(data => data.artifacts), original.artifacts);
  assert.deepEqual(reader.read(data => data.sessions), original.sessions);
  assert.deepEqual(reader.read(data => data.workspace.extension), original.workspace.extension);
  await reader.update(data => { data.workspace.marker = 'compatible older instance'; });
  const persisted = await row();
  assert.equal(isEncodedPostgresState(persisted.data), true, 'an instance with writes disabled still preserves an already compressed row');
  const restarted = await new PostgresDataStore('unused', { pool, compressState: false }).init();
  assert.equal(restarted.read(data => data.workspace.marker), 'compatible older instance');
  assert.deepEqual(restarted.read(data => data.artifacts), original.artifacts);
  const exposed = restarted.read(data => data.artifacts); exposed[0].documentText = 'caller mutation';
  assert.equal(restarted.read(data => data.artifacts[0].documentText), text);
});

test('compressed snapshots preserve rollback and refuse corrupt storage without replacing the cache', async t => {
  const { pool, row } = await fixture(t);
  const store = await new PostgresDataStore('unused', { pool, compressState: true }).init();
  await store.update(data => { data.workspace.marker = 'committed'; });
  const before = await row(), cached = store.data;
  await assert.rejects(store.update(data => { data.workspace.marker = 'rejected'; throw new Error('reject draft'); }), /reject draft/);
  assert.deepEqual(await row(), before);
  assert.equal(store.data, cached);
  const corrupt = { ...before.data, sha256: '0'.repeat(64) };
  await pool.query('UPDATE norte_state SET data = $2::jsonb, revision = revision + 1 WHERE id = $1', ['primary', JSON.stringify(corrupt)]);
  await assert.rejects(store.refresh(), /integrity/);
  assert.equal(store.data, cached, 'invalid bytes cannot publish a partial snapshot');
  await assert.rejects(store.update(data => { data.workspace.marker = 'unsafe'; }), /integrity/);
  assert.deepEqual((await row()).data, corrupt, 'corruption never triggers an automatic empty-state replacement');
  await pool.query('UPDATE norte_state SET data = $2::jsonb, revision = revision + 1 WHERE id = $1', ['primary', JSON.stringify(before.data)]);
  await store.refresh();
  assert.equal(store.read(data => data.workspace.marker), 'committed');
});

test('compressed historical schemas still revoke legacy unaccepted memberships during normalization', async t => {
  const { pool, row } = await fixture(t);
  await new PostgresDataStore('unused', { pool, compressState: false }).init();
  const legacy = createInitialData(); legacy.schemaVersion = 9;
  legacy.members.push({ id: 'unaccepted-invite', accountId: null, accountStatus: 'invited' });
  legacy.teams.push({ id: 'legacy-team', name: 'Preserved', memberIds: ['unaccepted-invite'] });
  const payload = await encodePostgresState(legacy, { compress: true });
  await pool.query('UPDATE norte_state SET data = $2::jsonb, revision = revision + 1 WHERE id = $1', ['primary', JSON.stringify(payload)]);
  const store = await new PostgresDataStore('unused', { pool, compressState: false }).init();
  assert.deepEqual(store.read(data => data.teams[0].memberIds), []);
  assert.deepEqual(store.read(data => data.teams[0].legacyInvitedMemberIds), ['unaccepted-invite']);
  const migrated = await decodePostgresState((await row()).data);
  assert.equal(migrated.schemaVersion, 10);
  assert.deepEqual(migrated.teams[0].memberIds, []);
});

test('string references activate only on request and remain readable without the writer flag', async t => {
  const { pool, row } = await fixture(t);
  const compatible = await new PostgresDataStore('unused', { pool, compressState: true, compactStrings: false }).init();
  const text = 'Documento público repetido, com conteúdo e acentuação preservados.\n'.repeat(4000);
  await compatible.update(data => {
    data.artifacts.push({ id: 'first-copy', documentText: text, metadata: { title: 'First' } }, { id: 'second-copy', documentText: text, metadata: { title: 'Second' } });
  });
  const v1 = (await row()).data;
  assert.equal(v1.version, 1, 'deploying a compatible reader does not enable the new writer');
  const compact = await new PostgresDataStore('unused', { pool, compressState: true, compactStrings: true }).init();
  assert.equal((await row()).data.version, 1, 'startup alone does not migrate the row');
  await compact.update(data => { data.workspace.marker = 'compact enabled'; });
  const v2 = (await row()).data;
  assert.equal(v2.version, 2);
  assert(v2.payload.length < v1.payload.length);
  await compatible.refresh();
  assert.deepEqual(compatible.read(data => data.artifacts), compact.read(data => data.artifacts));
  await compatible.update(data => { data.artifacts[0].metadata.title = 'Edited first'; });
  assert.equal((await row()).data.version, 2, 'compatible instances preserve references even with their flag disabled');
  const restarted = await new PostgresDataStore('unused', { pool, compressState: false, compactStrings: false }).init();
  assert.equal(restarted.read(data => data.artifacts[0].metadata.title), 'Edited first');
  assert.equal(restarted.read(data => data.artifacts[1].metadata.title), 'Second');
  assert.equal(restarted.read(data => data.artifacts[0].documentText), text);
  assert.equal(restarted.read(data => data.artifacts[1].documentText), text);
  assert.equal((await row()).data.version, 2);
});
