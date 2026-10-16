import assert from "node:assert/strict";
import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { technicalHierarchyError } from "../shared/technical-hierarchy.mjs";
import { isProjectAdmin } from "../shared/project-organization.mjs";

// Explicit offline maintenance only. The proposal generator never applies changes.
assert(process.argv.includes("--server-stopped"), "Stop the Norte server first and pass --server-stopped.");
assert(!process.env.DATABASE_URL, "This command is for the offline JSON store only, not PostgreSQL.");
const path = resolve(process.env.NORTE_CLEANUP_SOURCE || "../.runtime/norte-data.json");
const proposalDirectory = resolve(process.env.NORTE_CLEANUP_OUTPUT || "../.runtime/validation/quetzal-architecture-cleanup");
const pidPath = resolve(dirname(path), "server.pid");
try {
  const pidRecord = JSON.parse(await readFile(pidPath, "utf8")), pid = typeof pidRecord === "number" ? pidRecord : pidRecord.pid;
  let alive = true; try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
  assert(!alive, "The Norte supervisor is still running. Stop it before applying this proposal.");
} catch (error) { if (error.code !== "ENOENT") throw error; }
const hash = value => createHash("sha256").update(value).digest("hex");
const originalBytes = await readFile(path), data = JSON.parse(originalBytes);
const report = JSON.parse(await readFile(resolve(proposalDirectory, "report.json"), "utf8"));
const proposed = JSON.parse(await readFile(resolve(proposalDirectory, "proposed.json"), "utf8"));
const record = data.workspace.projects[report.projectId];
assert(record, "Project not found"); assert.equal(hash(JSON.stringify(record.document.engineeringSystem)), report.sourceSha256, "Baseline changed since proposal; regenerate and review again.");
assert.equal(hash(JSON.stringify(proposed)), report.proposedSha256, "Proposal checksum does not match its reviewed report");
assert(validateEngineeringSystem(proposed), "Invalid model"); assert.equal(technicalHierarchyError(proposed), null);
const actorId = process.argv.find(argument => argument.startsWith("--actor="))?.slice(8) || (process.argv.includes("--actor-project-owner") ? record.document.creatorId || record.createdBy : null);
const actor = data.users.find(user => user.id === actorId);
assert(actor && isProjectAdmin(record.document, actor, record.createdBy || record.document.creatorId), "Provide --actor=<authorized-user-id> or --actor-project-owner.");
const timestamp = new Date().toISOString(), backupDirectory = resolve(proposalDirectory, `applied-${timestamp.replace(/[:.]/gu, "-")}`);
await mkdir(backupDirectory, { recursive: false, mode: 0o700 });
const backup = await open(resolve(backupDirectory, "store-before.json"), "wx", 0o600); await backup.writeFile(originalBytes); await backup.sync(); await backup.close();
const audit = { ...report, applied: true, actorId, appliedAt: timestamp, previousRecordRevision: record.revision, appliedRecordRevision: record.revision + 1, storeBeforeSha256: hash(originalBytes) };
record.engineeringHistory ||= [];
record.engineeringHistory.push({ id: randomUUID(), archivedAt: timestamp, archivedBy: actorId, reason: 'architecture_cleanup', engineeringSystem: structuredClone(record.document.engineeringSystem), extractionReport: structuredClone(record.extractionReport || null) });
record.document.engineeringSystem = proposed; record.document.updatedAt = timestamp; record.updatedAt = timestamp; record.updatedBy = actorId; record.revision++;
if (data.workspace.project?.document?.id === report.projectId) data.workspace.project = structuredClone(record);
data.updatedAt = timestamp;
const auditFile = await open(resolve(backupDirectory, "audit.json"), "wx", 0o600); await auditFile.writeFile(JSON.stringify({ ...audit, applied: false, state: "prepared" }, null, 2)); await auditFile.sync(); await auditFile.close();
const tempPath = `${path}.cleanup-${randomUUID()}.tmp`, lockPath = `${path}.cleanup.lock`;
let lock;
try {
  lock = await open(lockPath, "wx", 0o600);
  assert.equal(hash(await readFile(path)), hash(originalBytes), "Datastore changed while preparing the archive. No changes applied.");
  const temp = await open(tempPath, "wx", 0o600); await temp.writeFile(JSON.stringify(data, null, 2)); await temp.sync(); await temp.close();
  await rename(tempPath, path); const directoryHandle = await open(dirname(path), "r"); await directoryHandle.sync(); await directoryHandle.close();
  const committedAudit = await open(resolve(backupDirectory, "audit.json"), "w", 0o600); await committedAudit.writeFile(JSON.stringify({ ...audit, state: "committed" }, null, 2)); await committedAudit.sync(); await committedAudit.close();
} finally { await unlink(tempPath).catch(() => {}); if (lock) { await lock.close(); await unlink(lockPath); } }
console.log(JSON.stringify({ applied: true, projectId: report.projectId, entities: proposed.entities.length, revision: record.revision, auditDirectory: backupDirectory }));
