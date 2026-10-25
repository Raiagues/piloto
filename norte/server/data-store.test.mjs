import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createInitialData, normalizeStoredData, JsonDataStore } from "./data-store.mjs";


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

test("fresh installation has no invented accounts, teams, projects, or engineering data", () => {
  const state = createInitialData();
  for (const key of ['users', 'members', 'teams', 'artifacts', 'sessions']) assert.deepEqual(state[key], []);
  assert.deepEqual(state.workspace, { projects: {}, delivery: {} });
  assert.deepEqual(state.meetings, {});
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

test("JSON writes serialize, roll back failures and preserve private permissions after restart", async t => {
  const dir = await mkdtemp(join(tmpdir(), 'norte-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json'), store = await new JsonDataStore(file).init();
  await Promise.all(Array.from({ length: 10 }, () => store.update(data => { data.counter = (data.counter || 0) + 1; })));
  await assert.rejects(store.update(data => { data.counter = 100; throw new Error('failed transaction'); }), /failed transaction/);
  const restarted = await new JsonDataStore(file).init();
  assert.equal(restarted.read().counter, 10);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).counter, 10);
  const copy = restarted.read(); copy.counter = 0;
  assert.equal(restarted.read().counter, 10);
});
