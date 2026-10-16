import pg from "pg";
import { createInitialData, normalizeStoredData } from "./data-store.mjs";
import { decodePostgresState, encodePostgresState, isEncodedPostgresState } from "./postgres-state-codec.mjs";

const { Pool } = pg;
const STATE_ID = "primary";

function clone(value) {
  return structuredClone(value);
}

// pg already removes failed idle clients from the pool. The error event still
// needs a listener: otherwise a temporary database restart terminates Node.
function handleIdleConnectionError() {}

async function transaction(pool, work) {
  const client = await pool.connect();
  let connectionError = null;
  let discard = false;
  let fail;
  const disconnected = new Promise((_, reject) => { fail = reject; });
  const onError = error => {
    connectionError ??= error;
    discard = true;
    fail(connectionError);
  };
  client.on?.("error", onError);
  // A mutator may be waiting on filesystem/network work between SQL queries.
  // Reject it on disconnect too, then prevent its continuation from issuing SQL
  // or publishing its draft. Never retry a transaction or an uncertain COMMIT.
  const wait = action => Promise.race([
    Promise.resolve().then(() => {
      if (connectionError) throw connectionError;
      return action();
    }),
    disconnected
  ]);
  const query = (...args) => wait(() => client.query(...args));
  try {
    await query("BEGIN");
    const result = await work({ query, wait });
    await query("COMMIT");
    return result;
  } catch (error) {
    // An unusable socket cannot roll back. If rollback itself fails, also
    // destroy the client; it must never re-enter the pool with an open txn.
    if (!connectionError) {
      try { await query("ROLLBACK"); }
      catch { discard = true; }
    }
    throw error;
  } finally {
    // release first restores pg-pool's idle error listener, avoiding a gap.
    client.release(discard);
    client.removeListener?.("error", onError);
  }
}

export class PostgresDataStore {
  constructor(connectionString, options = {}) {
    // Enable writes only after every deployed reader supports this codec.
    // Once a row is encoded, compatible instances preserve that format.
    this.compressState = options.compressState ?? process.env.NORTE_POSTGRES_COMPRESSION === "1";
    this.compactStrings = options.compactStrings ?? process.env.NORTE_POSTGRES_STRING_REFS === "1";
    this.pool = options.pool ?? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "norte"
    });
    // Several store wrappers can share an injected pool in tests/tools.
    if (!this.pool.listeners?.("error").includes(handleIdleConnectionError)) {
      this.pool.on?.("error", handleIdleConnectionError);
    }
    this.data = null;
    this.revision = null;
    this.updatedAtToken = null;
    this.queue = Promise.resolve();
    this.pendingRefresh = null;
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS norte_state (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revision BIGINT NOT NULL DEFAULT 0
      )
    `);
    await this.pool.query("ALTER TABLE norte_state ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0");
    await this.pool.query(
      "INSERT INTO norte_state (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING",
      [STATE_ID, JSON.stringify(createInitialData())]
    );
    // Normalize under the same lock used for ordinary writes; simultaneous
    // starts cannot overwrite a registration or upload with an old snapshot.
    const snapshot = await transaction(this.pool, async ({ query, wait }) => {
      const result = await query("SELECT data, revision::text AS revision, updated_at::text AS updated_at_token FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
      const encoded = isEncodedPostgresState(result.rows[0].data);
      const decoded = await wait(() => decodePostgresState(result.rows[0].data));
      const previousSchema = decoded.schemaVersion;
      const data = normalizeStoredData(decoded, { copy: !encoded });
      let { revision, updated_at_token: updatedAtToken } = result.rows[0];
      if (previousSchema !== data.schemaVersion) {
        const persisted = await wait(() => encodePostgresState(data, { compress: this.compressState || encoded, compactStrings: this.compactStrings || (encoded && result.rows[0].data.version === 2) }));
        const updated = await query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW(), revision = revision + 1 WHERE id = $1 RETURNING revision::text AS revision, updated_at::text AS updated_at_token", [STATE_ID, JSON.stringify(persisted)]);
        revision = updated.rows[0].revision;
        updatedAtToken = updated.rows[0].updated_at_token;
      }
      return { data, revision, updatedAtToken };
    });
    Object.assign(this, snapshot);
    return this;
  }

  refresh() {
    // Only requests queued before SELECT starts may share its snapshot. A later
    // caller needs a new check: another instance could have revoked its access
    // after this SELECT's snapshot, while its response is still in flight.
    if (this.pendingRefresh) return this.pendingRefresh;
    const operation = this.queue.then(async () => {
      if (this.pendingRefresh === operation) this.pendingRefresh = null;
      // Check every burst against the database (no stale TTL for sessions/ACL).
      // Unchanged snapshots stay in PostgreSQL instead of repeatedly sending,
      // parsing and cloning every user's documents on the small web instance.
      // The timestamp also catches older instances during a rolling deploy,
      // which update data/updated_at but do not yet increment revision.
      const result = await this.pool.query("SELECT revision::text AS revision, updated_at::text AS updated_at_token, CASE WHEN revision = $2::bigint AND updated_at::text = $3 THEN NULL ELSE data END AS data FROM norte_state WHERE id = $1", [STATE_ID, this.revision, this.updatedAtToken]);
      const row = result.rows[0];
      if (!row) throw new Error("Norte state was not found.");
      if (row.data !== null) this.data = normalizeStoredData(await decodePostgresState(row.data), { copy: !isEncodedPostgresState(row.data) });
      this.revision = row.revision;
      this.updatedAtToken = row.updated_at_token;
    });
    this.pendingRefresh = operation;
    const clear = () => { if (this.pendingRefresh === operation) this.pendingRefresh = null; };
    operation.then(clear, clear);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  read(select = value => value) {
    if (!this.data) throw new Error("Data store was not initialized.");
    return clone(select(this.data));
  }

  update(mutator) {
    this.pendingRefresh = null;
    const operation = this.queue.then(async () => {
      const snapshot = await transaction(this.pool, async ({ query, wait }) => {
        const current = await query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
        const encoded = isEncodedPostgresState(current.rows[0].data);
        const decoded = await wait(() => decodePostgresState(current.rows[0].data));
        const draft = normalizeStoredData(decoded, { copy: !encoded });
        const result = await wait(() => mutator(draft));
        draft.updatedAt = new Date().toISOString();
        const persisted = await wait(() => encodePostgresState(draft, { compress: this.compressState || encoded, compactStrings: this.compactStrings || (encoded && current.rows[0].data.version === 2) }));
        const updated = await query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW(), revision = revision + 1 WHERE id = $1 RETURNING revision::text AS revision, updated_at::text AS updated_at_token", [STATE_ID, JSON.stringify(persisted)]);
        return { data: draft, revision: updated.rows[0].revision, updatedAtToken: updated.rows[0].updated_at_token, result };
      });
      this.data = snapshot.data;
      this.revision = snapshot.revision;
      this.updatedAtToken = snapshot.updatedAtToken;
      return clone(snapshot.result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async health() {
    await this.pool.query("SELECT 1");
  }

  async close() {
    await this.pool.end();
  }
}
