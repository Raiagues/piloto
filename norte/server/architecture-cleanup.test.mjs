import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const checksum = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const original = { schemaVersion: 1, id: "model", name: "Satellite", generatedAt: "2026-10-15T00:00:00Z", generatedFromRevision: 0, entities: [{ id: "root", name: "Satellite", kind: "system", description: "", properties: [], evidenceRefs: [], source: "user", confidence: 1 }], relations: [], requirements: [], evidence: [], artifactSources: [] };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "architecture-cleanup-")); t.after(() => rm(directory, { recursive: true, force: true }));
  const proposalDirectory = join(directory, "proposal"), path = join(directory, "state.json"); await mkdir(proposalDirectory);
  const proposed = { ...original, revision: 1, entities: [...original.entities, { ...original.entities[0], id: "avionics", name: "Avionics", kind: "subsystem", parentId: "root" }] };
  const data = { users: [{ id: "owner", accessRole: "member" }], workspace: { project: null, projects: { target: { document: { id: "target", creatorId: "owner", engineeringSystem: original, context: { assignments: [] } }, revision: 3 } } }, artifacts: [{ id: "preserved-doc", content: "unaltered" }] };
  for (const [file, value] of [[path, data], [join(proposalDirectory, "proposed.json"), proposed], [join(proposalDirectory, "report.json"), { projectId: "target", sourceSha256: checksum(original), proposedSha256: checksum(proposed), applied: false }]]) await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  const run = args => spawnSync(process.execPath, [resolve("scripts/apply-architecture-cleanup.mjs"), ...args], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", NORTE_CLEANUP_SOURCE: path, NORTE_CLEANUP_OUTPUT: proposalDirectory } });
  return { directory, path, proposed, data, run };
}
test("offline architecture maintenance archives the exact baseline and applies only an authorized unchanged proposal", async t => {
  const { path, data, proposed, run } = await fixture(t); const response = run(["--server-stopped", "--actor-project-owner"]); assert.equal(response.status, 0, response.stderr);
  const saved = JSON.parse(await readFile(path, "utf8")), result = JSON.parse(response.stdout);
  assert.deepEqual(saved.workspace.projects.target.document.engineeringSystem, proposed); assert.equal(saved.workspace.projects.target.revision, 4); assert.equal(saved.workspace.projects.target.updatedBy, "owner"); assert.deepEqual(saved.artifacts, data.artifacts);
  assert.deepEqual(JSON.parse(await readFile(join(result.auditDirectory, "store-before.json"), "utf8")), data);
  const audit = JSON.parse(await readFile(join(result.auditDirectory, "audit.json"), "utf8")); assert.equal(audit.actorId, "owner"); assert.equal(audit.applied, true);
  assert.notEqual(run(["--server-stopped", "--actor-project-owner"]).status, 0, "reapplying a stale proposal is refused");
});
test("maintenance refuses a live supervisor or an unauthorized actor without changing the store", async t => {
  const { directory, path, run } = await fixture(t); const before = await readFile(path, "utf8");
  assert.notEqual(run(["--server-stopped", "--actor=stranger"]).status, 0); assert.notEqual(run(["--actor-project-owner"]).status, 0);
  await writeFile(join(directory, "server.pid"), JSON.stringify({ pid: process.pid })); assert.notEqual(run(["--server-stopped", "--actor-project-owner"]).status, 0); assert.equal(await readFile(path, "utf8"), before);
});
test("maintenance refuses a modified proposal checksum without changing the store", async t => {
  const { directory, path, proposed, run } = await fixture(t), before = await readFile(path, "utf8");
  await writeFile(join(directory, "proposal", "proposed.json"), JSON.stringify({ ...proposed, name: "Unreviewed change" })); assert.notEqual(run(["--server-stopped", "--actor-project-owner"]).status, 0); assert.equal(await readFile(path, "utf8"), before);
});
