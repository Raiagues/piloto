import pg from "pg";
import { createInitialData, normalizeStoredData } from "./data-store.mjs";

const { Pool } = pg;
const STATE_ID = "primary";

function clone(value) {
  return structuredClone(value);
}

export class PostgresDataStore {
  constructor(connectionString, options = {}) {
    this.pool = options.pool ?? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "norte"
    });
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT data, revision::text AS revision, updated_at::text AS updated_at_token FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
      this.data = normalizeStoredData(result.rows[0].data);
      this.revision = result.rows[0].revision;
      this.updatedAtToken = result.rows[0].updated_at_token;
      if (result.rows[0].data.schemaVersion !== this.data.schemaVersion) {
        const updated = await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW(), revision = revision + 1 WHERE id = $1 RETURNING revision::text AS revision, updated_at::text AS updated_at_token", [STATE_ID, JSON.stringify(this.data)]);
        this.revision = updated.rows[0].revision;
        this.updatedAtToken = updated.rows[0].updated_at_token;
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
      if (row.data !== null) this.data = normalizeStoredData(row.data);
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
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
        const draft = normalizeStoredData(current.rows[0].data);
        const result = await mutator(draft);
        draft.updatedAt = new Date().toISOString();
        const updated = await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW(), revision = revision + 1 WHERE id = $1 RETURNING revision::text AS revision, updated_at::text AS updated_at_token", [STATE_ID, JSON.stringify(draft)]);
        await client.query("COMMIT");
        this.data = draft;
        this.revision = updated.rows[0].revision;
        this.updatedAtToken = updated.rows[0].updated_at_token;
        return clone(result);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
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
