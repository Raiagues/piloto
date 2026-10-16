import assert from "node:assert/strict";
import test from "node:test";
import { newDb } from "pg-mem";
import { buildApp } from "./app.mjs";
import { PostgresDataStore } from "./postgres-store.mjs";

test("the PostgreSQL adapter persists accounts, sessions and workspace data", async (t) => {
  const database = newDb();
  const adapter = database.adapters.createPg();
  const pool = new adapter.Pool();
  const store = await new PostgresDataStore("postgresql://test", { pool }).init();
  const app = await buildApp({ store, databaseUrl: "postgresql://test", logger: false, ai: { apiKey: "" } });
  t.after(async () => app.close());

  const registration = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      name: "Capitã Norte",
      email: "capita@norte.example",
      password: "uma frase longa para o postgres",
      institution: "Universidade de Exemplo",
      primaryArea: "systems"
    }
  });
  assert.equal(registration.statusCode, 201);
  const cookie = registration.headers["set-cookie"].split(";")[0];
  const project = { schemaVersion: 2, id: "mission-postgres", name: "Postgres project", board: { nodes: [], links: [] } };
  const saved = await app.inject({
    method: "PUT",
    url: "/api/workspace/project",
    headers: { cookie, "x-csrf-token": registration.json().csrfToken },
    payload: project
  });
  assert.equal(saved.statusCode, 200);

  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.deepEqual(health.json(), { status: "ok", version: "1.0.0", revision: /^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT || "") ? process.env.RENDER_GIT_COMMIT : null, pid: process.pid, supervisorPid: process.ppid, storage: "postgresql", engineering: { configured: false, model: "gemini-3.5-flash-lite" } });
  const row = await pool.query("SELECT data FROM norte_state WHERE id = $1", ["primary"]);
  assert.equal(row.rows[0].data.users.length, 1);
  assert.equal(row.rows[0].data.sessions.length, 1);
  assert.equal(row.rows[0].data.workspace.project.document.id, project.id);
  assert.match(row.rows[0].data.users[0].passwordHash, /^\$argon2id\$/u);
});
