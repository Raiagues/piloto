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
    this.queue = Promise.resolve();
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS norte_state (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      "INSERT INTO norte_state (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING",
      [STATE_ID, JSON.stringify(createInitialData())]
    );
    // Normalize under the same lock used for ordinary writes; simultaneous
    // starts cannot overwrite a registration or upload with an old snapshot.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
      this.data = normalizeStoredData(result.rows[0].data);
      if (result.rows[0].data.schemaVersion !== this.data.schemaVersion) await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW() WHERE id = $1", [STATE_ID, JSON.stringify(this.data)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return this;
  }

  refresh() {
    const operation = this.queue.then(async () => {
      const result = await this.pool.query("SELECT data FROM norte_state WHERE id = $1", [STATE_ID]);
      this.data = normalizeStoredData(result.rows[0].data);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  read() {
    if (!this.data) throw new Error("Data store was not initialized.");
    return clone(this.data);
  }

  update(mutator) {
    const operation = this.queue.then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", [STATE_ID]);
        const draft = normalizeStoredData(current.rows[0].data);
        const result = await mutator(draft);
        draft.updatedAt = new Date().toISOString();
        await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW() WHERE id = $1", [STATE_ID, JSON.stringify(draft)]);
        await client.query("COMMIT");
        this.data = draft;
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
