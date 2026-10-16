import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { newDb } from "pg-mem";
import { createInitialData, normalizeStoredData, JsonDataStore, VALIDATION_PROJECT_ID, VALIDATION_TEAM_ID } from "./data-store.mjs";
import { assertResetEnvironment, resetJsonFile, resetPostgres, resetValidationData } from "../scripts/reset-validation-data.mjs";

const allowed = { NODE_ENV: "test", NORTE_ALLOW_DESTRUCTIVE_RESET: "1" };

function legacyState() {
  const state = createInitialData();
  state.schemaVersion = 7;
  state.users = [{ id: "owner", accessRole: "owner_admin", passwordHash: "preserve-account-hash" }];
  state.sessions = [{ id: "existing-session", userId: "owner" }];
  state.members = [{ id: "real-member", accountId: "owner" }, { id: "aurora-lucas", accountId: null }];
  state.teams = [{ id: "team-aurora", name: "Equipe Aurora", memberIds: ["real-member", "aurora-lucas"], artifactIds: ["old-upload"], joinRequests: [] }];
  state.artifacts = [{ id: "old-upload", scope: "team", ownerId: "team-aurora" }, { id: "personal-source", scope: "project", ownerId: null, createdBy: "owner" }];
  state.workspace = {
    project: { document: { schemaVersion: 2, id: "old-project", name: "Payload Sentinel", context: { teamId: "team-aurora" }, board: { nodes: [], links: [] } }, revision: 3 },
    projects: {}, labs: { "old-project": { board: { nodes: [{ id: 1, text: "old idea" }] } } }
  };
  return state;
}

test("fresh data has one neutral team and an independent project with no seeded documents or baseline", () => {
  const state = createInitialData();
  assert.equal(state.teams.length, 1);
  assert.equal(state.teams[0].id, VALIDATION_TEAM_ID);
  assert.deepEqual(Object.keys(state.workspace.projects), [VALIDATION_PROJECT_ID]);
  const project = state.workspace.project.document;
  assert.equal(project.context.teamId, VALIDATION_TEAM_ID);
  assert.deepEqual(project.phaseProgress, { highestUnlockedStep: 0 });
  assert.equal(project.engineeringSystem, undefined);
  assert.equal(state.users.length, 0);
  assert.equal(state.members.length, 0);
  // Startup invents no engineering documents: the real sources are imported by
  // the explicit, guarded seed command, never fabricated by the application.
  assert.equal(state.artifacts.length, 0);
  assert.equal(project.name, "Quetzal-1");
  assert.equal(project.context.programId, null);
  assert.equal(project.context.referenceProgram, "independent");
  assert.deepEqual(project.context.projectArtifactIds, []);
  assert.doesNotMatch(JSON.stringify(state), /Aurora|Payload Sentinel|OBSAT/iu);
});

test("normalization upgrades the schema without deleting existing data or injecting demo seeds", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "norte-normalize-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "legacy.json");
  const original = legacyState();
  await writeFile(file, JSON.stringify(original));
  const store = await new JsonDataStore(file).init();
  const state = store.read();
  assert.equal(state.schemaVersion, 10);
  assert.deepEqual(state.users, original.users.map(user => ({ ...user, nickname: user.nickname || "pessoa", emailVerifiedAt: user.emailVerifiedAt || null })));
  assert.deepEqual(state.members, original.members);
  assert.equal(state.teams[0].id, "team-aurora");
  assert.equal(state.workspace.project.document.id, "old-project");
  assert.equal(state.workspace.labs["old-project"].board.nodes.length, 1);
  assert.equal(state.artifacts.length, 2);
  assert.equal(normalizeStoredData({ ...original, schemaVersion: 1 }).members.length, 2);
});

test("reset requires an explicit guard and positively identified development/test environment", () => {
  assert.throws(() => assertResetEnvironment({ NODE_ENV: "test" }), /ALLOW_DESTRUCTIVE/);
  assert.throws(() => assertResetEnvironment({ ...allowed, NODE_ENV: "production" }), /NODE_ENV/);
  assert.throws(() => assertResetEnvironment({ ...allowed, NODE_ENV: undefined }), /NODE_ENV/);
  assert.throws(() => assertResetEnvironment({ ...allowed, RENDER: "true" }), /hosted/);
  assert.throws(() => assertResetEnvironment(allowed, "postgresql://example.neon.tech/norte_test"), /loopback/);
  assert.throws(() => assertResetEnvironment(allowed, "postgresql://localhost/norte_production"), /dev\/test/);
  assert.throws(() => assertResetEnvironment(allowed, "postgresql://localhost/norte_test_production"), /dev\/test/);
  assert.throws(() => assertResetEnvironment(allowed, "postgresql://localhost/contest"), /dev\/test/);
  assert.doesNotThrow(() => assertResetEnvironment(allowed, "postgresql://127.0.0.1/norte_test"));
});

test("explicit reset preserves accounts and sessions, removes old workspace data and records a reset marker", () => {
  const original = legacyState();
  const state = resetValidationData(original);
  assert.deepEqual(state.users, original.users.map(user => ({ ...user, nickname: user.nickname || "pessoa", emailVerifiedAt: user.emailVerifiedAt || null })));
  assert.deepEqual(state.sessions, original.sessions);
  assert.deepEqual(state.members, [original.members[0]]);
  assert.equal(state.teams.length, 1);
  assert.deepEqual(state.teams[0].memberIds, ["real-member"]);
  assert.deepEqual(Object.keys(state.workspace.projects), [VALIDATION_PROJECT_ID]);
  assert.deepEqual(state.workspace.labs, {});
  assert.deepEqual(state.artifacts.map((artifact) => artifact.id), ["personal-source"]);
  assert.equal(typeof state.workspace.validationResetId, "string");
  assert.equal(original.teams[0].id, "team-aurora");
});

test("JSON reset creates a private complete backup before replacing the local state", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "norte-reset-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "state.json");
  const original = legacyState();
  await writeFile(file, JSON.stringify(original));
  await assert.rejects(resetJsonFile(file, {}), /ALLOW_DESTRUCTIVE/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), original);
  const result = await resetJsonFile(file, allowed);
  assert.deepEqual(JSON.parse(await readFile(result.backupPath, "utf8")), original);
  assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(result.teams, 1);
  assert.equal(result.projects, 1);
  assert.equal(result.labs, 0);
  assert.equal(result.accountsPreserved, 1);
});

test("PostgreSQL reset uses the same guarded state operation and backs up existing account data", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "norte-pg-reset-"));
  const db = newDb();
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  t.after(async () => { await pool.end(); await rm(dir, { recursive: true, force: true }); });
  await pool.query("CREATE TABLE norte_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())");
  const original = legacyState();
  await pool.query("INSERT INTO norte_state (id, data) VALUES ($1, $2)", ["primary", JSON.stringify(original)]);
  const result = await resetPostgres("postgresql://localhost/norte_test", allowed, { pool, backupDirectory: dir });
  const saved = (await pool.query("SELECT data FROM norte_state WHERE id = $1", ["primary"])).rows[0].data;
  assert.deepEqual(saved.users, original.users.map(user => ({ ...user, nickname: user.nickname || "pessoa", emailVerifiedAt: user.emailVerifiedAt || null })));
  assert.deepEqual(saved.sessions, original.sessions);
  assert.equal(saved.teams[0].id, VALIDATION_TEAM_ID);
  assert.deepEqual(saved.workspace.labs, {});
  assert.deepEqual(JSON.parse(await readFile(result.backupPath, "utf8")), original);
});
