/** Import the real Quetzal-1 engineering documents into the validation project.
 *
 * This command replaces whatever the validation project currently holds with
 * the official sources listed in examples/quetzal1/source-manifest.mjs, stores
 * their actual bytes, and returns the project to a state where the engineering
 * system must be generated from them. It never writes engineering content: no
 * entities, no properties, no relations, no benchmark answers.
 *
 * It is deliberately a one-off command, never part of application startup, and
 * refuses to run without an explicit guard.
 *
 *   NORTE_ALLOW_QUETZAL_SEED=1 node scripts/seed-quetzal-validation.mjs --file var/mission-dev-data.json
 *   NODE_ENV=production NORTE_ALLOW_QUETZAL_SEED=1 node scripts/seed-quetzal-validation.mjs --database
 */
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createInitialData, normalizeStoredData, VALIDATION_PROJECT_ID, VALIDATION_TEAM_ID, VALIDATION_TEAM_NAME } from "../server/data-store.mjs";
import { classifyArtifactSource } from "../server/artifact-content.mjs";
import { artifactContentUrl, fetchManifestSource, sourceProvenance } from "../server/source-import.mjs";
import { projectMemoryStatus } from "../server/system-ai.mjs";
import { ALLOWED_SOURCE_HOSTS, artifactIdForSource, IMPORTABLE_ROLES, QUETZAL_PROJECT_NAME, QUETZAL_SOURCES, sourcesForTier } from "../examples/quetzal1/source-manifest.mjs";

/** Measured comfortable ceiling for one extraction request against the configured
 * provider: ~4.6 MB of sources completes in seconds, ~6.3 MB takes 57-122 s and
 * exceeds the extraction timeout. Above this the seed warns rather than refuses. */
const COMFORTABLE_SOURCE_BYTES = 4 * 1024 * 1024;

export function assertSeedEnvironment(env) {
  if (env.NORTE_ALLOW_QUETZAL_SEED !== "1") {
    throw new Error("Seed refused: set NORTE_ALLOW_QUETZAL_SEED=1 explicitly. This command rewrites the validation project's memory.");
  }
}

function describeArtifact(artifact) {
  const { status, reason } = classifyArtifactSource(artifact);
  return {
    id: artifact.id,
    label: artifact.label,
    scope: artifact.scope,
    ownerId: artifact.ownerId,
    mimeType: artifact.mimeType || "",
    size: artifact.size || 0,
    status,
    reason,
    origin: artifact.provenance?.sourceUrl || (String(artifact.url || "").startsWith("data:") ? "stored file" : artifact.url || "")
  };
}

/** Everything the operator needs to see about the project before it changes. */
export function describeProject(data, projectId = VALIDATION_PROJECT_ID) {
  const record = data.workspace.projects?.[projectId];
  const project = record?.document ?? null;
  if (!project) return { found: false, projectId };
  const linkedIds = new Set([...(project.context?.projectArtifactIds || []), ...(project.context?.teamArtifactIds || [])]);
  return {
    found: true,
    projectId,
    name: project.name,
    teamId: project.context?.teamId ?? null,
    teamName: project.context?.teamName ?? "",
    programId: project.context?.programId ?? null,
    modalityId: project.context?.modalityId ?? null,
    categoryId: project.context?.categoryId ?? null,
    referenceProgram: project.context?.referenceProgram ?? null,
    memoryRevision: project.memoryRevision || 0,
    hasEngineeringSystem: Boolean(project.engineeringSystem),
    systemGeneratedFromRevision: project.systemGeneratedFromRevision ?? null,
    teamArtifactIds: [...(project.context?.teamArtifactIds || [])],
    projectArtifactIds: [...(project.context?.projectArtifactIds || [])],
    artifacts: data.artifacts.filter((artifact) => linkedIds.has(artifact.id) || (artifact.scope === "project" && artifact.ownerId === projectId)).map(describeArtifact)
  };
}

/** Build the stored artifact for one verified retrieval. Content is real bytes. */
function artifactFromRetrieval(source, retrieval, previous, timestamp) {
  return {
    id: artifactIdForSource(source.id),
    kind: source.kind,
    label: source.label,
    description: source.description,
    url: artifactContentUrl(retrieval),
    fileName: source.fileName,
    mimeType: retrieval.mimeType,
    size: retrieval.size,
    tags: ["quetzal1", source.role === "project_context" ? "project-source" : "manufacturer-datasheet"],
    official: false,
    scope: "project",
    ownerId: VALIDATION_PROJECT_ID,
    createdBy: previous?.createdBy ?? null,
    provenance: sourceProvenance(source, retrieval),
    connectedAt: previous?.connectedAt ?? timestamp,
    updatedAt: timestamp
  };
}

/**
 * Rewrite the validation project from the manifest.
 * Users, members, sessions and every unrelated project are left untouched.
 */
export async function seedQuetzalValidation(value, { tier = "core", manifest = QUETZAL_SOURCES, removeOtherProjects = false, fetchImpl, resolveHost, now = () => new Date().toISOString() } = {}) {
  const data = normalizeStoredData(value);
  const before = describeProject(data);
  const timestamp = now();
  const sources = sourcesForTier(tier, manifest);
  for (const source of sources) {
    if (!IMPORTABLE_ROLES.includes(source.role)) throw new Error(`Seed refused: ${source.id} has role ${source.role}, which must never enter project memory.`);
  }

  const retrievals = [];
  for (const source of sources) {
    retrievals.push({ source, retrieval: await fetchManifestSource(source, { allowedHosts: ALLOWED_SOURCE_HOSTS, fetchImpl, resolveHost }) });
  }

  let record = data.workspace.projects?.[VALIDATION_PROJECT_ID];
  if (!record) {
    const seeded = createInitialData();
    record = { ...seeded.workspace.projects[VALIDATION_PROJECT_ID], createdAt: timestamp, updatedAt: timestamp };
    data.workspace.projects[VALIDATION_PROJECT_ID] = record;
  }
  if (!data.teams.some((team) => team.id === VALIDATION_TEAM_ID)) {
    data.teams.push({ id: VALIDATION_TEAM_ID, name: VALIDATION_TEAM_NAME, description: "", memberIds: [], artifactIds: [], joinRequests: [], createdBy: null, createdAt: timestamp, updatedAt: timestamp });
  }
  const team = data.teams.find((item) => item.id === VALIDATION_TEAM_ID);
  // A signed-in validation member joins the real team; no fake engineers are created.
  const owner = data.users.find((user) => user.accessRole === "owner_admin");
  const ownerMember = data.members.find((member) => member.accountId === owner?.id);
  if (ownerMember && !team.memberIds.includes(ownerMember.id)) team.memberIds.push(ownerMember.id);

  const importedIds = [];
  const imported = [];
  let contentChanged = false;
  for (const { source, retrieval } of retrievals) {
    const id = artifactIdForSource(source.id);
    const index = data.artifacts.findIndex((artifact) => artifact.id === id);
    const previous = index >= 0 ? data.artifacts[index] : null;
    const unchanged = previous?.provenance?.sha256 === retrieval.sha256 && previous?.size === retrieval.size && previous?.label === source.label;
    const next = unchanged ? previous : artifactFromRetrieval(source, retrieval, previous, timestamp);
    if (!unchanged) contentChanged = true;
    if (index >= 0) data.artifacts[index] = next; else data.artifacts.push(next);
    importedIds.push(id);
    imported.push({ ...describeArtifact(next), sourceId: source.id, publisher: source.publisher, revision: source.revision, role: source.role, tier: source.tier, sha256: retrieval.sha256, hashChanged: retrieval.hashChanged, reused: unchanged });
  }

  // Drop everything this project previously carried that the manifest does not
  // supply, including artifacts linked only by id from an older dataset.
  const keep = new Set(importedIds);
  const project = record.document;
  const previouslyLinked = new Set([...(project.context?.projectArtifactIds || []), ...(project.context?.teamArtifactIds || [])]);
  const removed = data.artifacts
    .filter((artifact) => !keep.has(artifact.id) && (previouslyLinked.has(artifact.id) || (artifact.scope === "project" && artifact.ownerId === VALIDATION_PROJECT_ID)))
    .map(describeArtifact);
  const removedIds = new Set(removed.map((artifact) => artifact.id));
  data.artifacts = data.artifacts.filter((artifact) => !removedIds.has(artifact.id));
  for (const item of data.teams) item.artifactIds = item.artifactIds.filter((id) => !removedIds.has(id));
  for (const other of Object.values(data.workspace.projects)) {
    const context = other?.document?.context;
    if (!context) continue;
    context.teamArtifactIds = (context.teamArtifactIds || []).filter((id) => !removedIds.has(id));
    context.projectArtifactIds = (context.projectArtifactIds || []).filter((id) => !removedIds.has(id));
  }

  // Leftover demonstration projects are removed only when explicitly requested,
  // with their project-scoped artifacts and Discovery state, and always audited.
  const discarded = [];
  if (removeOtherProjects) {
    for (const [id, other] of Object.entries(data.workspace.projects)) {
      if (id === VALIDATION_PROJECT_ID) continue;
      const ownedIds = new Set([...(other?.document?.context?.projectArtifactIds || [])]);
      const ownedArtifacts = data.artifacts.filter((artifact) => ownedIds.has(artifact.id) || (artifact.scope === "project" && artifact.ownerId === id));
      discarded.push({ id, name: other?.document?.name || "", artifacts: ownedArtifacts.map((artifact) => artifact.id) });
      const removeIds = new Set(ownedArtifacts.map((artifact) => artifact.id));
      data.artifacts = data.artifacts.filter((artifact) => !removeIds.has(artifact.id));
      for (const team of data.teams) team.artifactIds = team.artifactIds.filter((artifactId) => !removeIds.has(artifactId));
      delete data.workspace.projects[id];
      delete data.workspace.labs?.[id];
    }
    if (data.workspace.project?.document?.id && !data.workspace.projects[data.workspace.project.document.id]) data.workspace.project = null;
  }

  const context = {
    ...project.context,
    configured: true,
    // Quetzal-1 has no relationship with any competition program.
    programId: null, modalityId: null, categoryId: null, referenceProgram: "independent",
    teamId: VALIDATION_TEAM_ID,
    teamName: team.name,
    teamArtifactIds: [],
    projectArtifactIds: importedIds
  };
  const memoryChanged = contentChanged || removedIds.size > 0
    || project.name !== QUETZAL_PROJECT_NAME
    || JSON.stringify(project.context ?? {}) !== JSON.stringify(context)
    || Boolean(project.engineeringSystem);
  const next = { ...project, name: QUETZAL_PROJECT_NAME, context, updatedAt: timestamp,
    memoryRevision: (project.memoryRevision || 0) + (memoryChanged ? 1 : 0),
    // Conception must run again against the newly imported documents.
    phaseProgress: { highestUnlockedStep: 0 },
    navigation: { ...project.navigation, lastRoute: "setup" } };
  delete next.engineeringSystem;
  delete next.systemGeneratedFromRevision;

  record.document = next;
  record.revision = (record.revision || 0) + 1;
  record.updatedAt = timestamp;
  data.workspace.projects[VALIDATION_PROJECT_ID] = record;
  data.workspace.project = record;
  data.updatedAt = timestamp;

  const after = describeProject(data);
  const readiness = projectMemoryStatus(next, data.artifacts);
  return {
    data,
    audit: {
      seededAt: timestamp,
      tier,
      changed: memoryChanged,
      before,
      after,
      imported,
      removed,
      discardedProjects: discarded,
      readiness,
      totalImportedBytes: imported.reduce((total, artifact) => total + artifact.size, 0),
      overComfortableSize: imported.reduce((total, artifact) => total + artifact.size, 0) > COMFORTABLE_SOURCE_BYTES,
      readableImported: imported.filter((artifact) => ["parsed", "pdf"].includes(artifact.status)).length,
      preserved: { users: data.users.length, sessions: data.sessions.length, members: data.members.length, projects: Object.keys(data.workspace.projects).length }
    }
  };
}

async function backupSnapshot(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return filePath;
}

export async function seedJsonFile(filePath, options = {}, env = process.env) {
  assertSeedEnvironment(env);
  const path = resolve(filePath);
  const original = JSON.parse(await readFile(path, "utf8"));
  const { data, audit } = await seedQuetzalValidation(original, options);
  if (options.dryRun) return { dryRun: true, ...audit };
  const backupPath = await backupSnapshot(`${path}.backup-${Date.now()}-${randomUUID()}`, original);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return { backupPath, ...audit };
}

export async function seedPostgres(databaseUrl, options = {}, env = process.env) {
  assertSeedEnvironment(env);
  if (!databaseUrl) throw new Error("Seed refused: DATABASE_URL is not configured.");
  const pool = options.pool ?? new (await import("pg")).default.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 15_000, application_name: "norte-quetzal-seed" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", ["primary"]);
    if (result.rows.length !== 1) throw new Error("Seed refused: no existing Norte state was found in this database.");
    const original = result.rows[0].data;
    const { data, audit } = await seedQuetzalValidation(original, options);
    if (options.dryRun) {
      await client.query("ROLLBACK");
      return { dryRun: true, ...audit };
    }
    const backupPath = await backupSnapshot(resolve(options.backupDirectory ?? "var/backups", `quetzal-seed-${Date.now()}-${randomUUID()}.json`), original);
    await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW() WHERE id = $1", ["primary", JSON.stringify(data)]);
    await client.query("COMMIT");
    return { backupPath, ...audit };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    if (!options.pool) await pool.end();
  }
}

function printAudit(audit) {
  const line = (label, value) => console.log(`${label.padEnd(26)} ${value}`);
  console.log("\n=== Validation project before ===");
  if (!audit.before.found) console.log("No existing validation project; a new one was created.");
  else {
    line("project", `${audit.before.name} (${audit.before.projectId})`);
    line("team", `${audit.before.teamName || "—"} (${audit.before.teamId || "—"})`);
    line("reference program", audit.before.programId || audit.before.referenceProgram || "none");
    line("memoryRevision", audit.before.memoryRevision);
    line("engineeringSystem", audit.before.hasEngineeringSystem ? "present" : "absent");
    for (const artifact of audit.before.artifacts) console.log(`  - ${artifact.id} · ${artifact.label} · ${artifact.status}${artifact.reason ? ` · ${artifact.reason}` : ""}`);
    if (!audit.before.artifacts.length) console.log("  (no linked artifacts)");
  }

  console.log("\n=== Imported sources ===");
  for (const artifact of audit.imported) {
    console.log(`  ${artifact.label}`);
    console.log(`    source=${artifact.sourceId} publisher=${artifact.publisher} revision=${artifact.revision || "—"} role=${artifact.role} tier=${artifact.tier}`);
    console.log(`    artifactId=${artifact.id} mime=${artifact.mimeType} size=${artifact.size} sha256=${artifact.sha256}`);
    console.log(`    parse=${artifact.status} sentToModel=${["parsed", "pdf"].includes(artifact.status) ? "yes" : "no"}${artifact.reused ? " (unchanged)" : ""}${artifact.hashChanged ? " [publisher hash changed since the manifest was written]" : ""}`);
  }

  if (audit.discardedProjects.length) {
    console.log("\n=== Other projects removed ===");
    for (const project of audit.discardedProjects) console.log(`  - ${project.name || "(untitled)"} (${project.id}) with ${project.artifacts.length} artifact(s)`);
  }

  console.log("\n=== Removed from this project's memory ===");
  if (!audit.removed.length) console.log("  (nothing to remove)");
  for (const artifact of audit.removed) console.log(`  - ${artifact.id} · ${artifact.label} · was ${artifact.status}`);

  console.log("\n=== Validation project after ===");
  const line2 = (label, value) => console.log(`${label.padEnd(26)} ${value}`);
  line2("project", `${audit.after.name} (${audit.after.projectId})`);
  line2("team", `${audit.after.teamName} (${audit.after.teamId})`);
  line2("reference program", audit.after.referenceProgram || "none");
  line2("memoryRevision", audit.after.memoryRevision);
  line2("engineeringSystem", audit.after.hasEngineeringSystem ? "present" : "absent (conception required)");
  line2("project artifacts", audit.after.projectArtifactIds.join(", ") || "—");
  line2("readable artifacts", `${audit.readiness.readableCount} / ${audit.readiness.linkedCount}`);
  line2("total imported bytes", audit.totalImportedBytes);
  if (audit.overComfortableSize) console.log(`${"".padEnd(26)} WARNING: above ${COMFORTABLE_SOURCE_BYTES} bytes, extraction requests grow slow enough to hit the provider timeout.`);
  line2("memory ready", audit.readiness.ready ? "yes" : `no (missing: ${audit.readiness.missing.join(", ")})`);
  line2("preserved accounts", `${audit.preserved.users} users, ${audit.preserved.sessions} sessions, ${audit.preserved.members} members`);
  if (audit.backupPath) line2("backup", audit.backupPath);
  if (audit.dryRun) console.log("\nDry run: nothing was written.");
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
  const known = new Set(["--file", "--database", "--tier", "--dry-run", "--json", "--remove-other-projects", "--help"]);
  for (let index = 0; index < args.length; index += 1) {
    if (known.has(args[index])) { if (["--file", "--tier"].includes(args[index])) index += 1; continue; }
    throw new Error(`Unknown argument ${args[index]}. Usage: node scripts/seed-quetzal-validation.mjs [--file path | --database] [--tier core|extended] [--dry-run] [--json] [--remove-other-projects]`);
  }
  if (flag("--help")) {
    console.log("Usage: NORTE_ALLOW_QUETZAL_SEED=1 node scripts/seed-quetzal-validation.mjs [--file path | --database] [--tier core|extended] [--dry-run] [--json] [--remove-other-projects]\nImports the official Quetzal-1 engineering documents listed in examples/quetzal1/source-manifest.mjs into the validation project and requires conception to run again. Never imports evaluator references.\n--remove-other-projects also deletes every other project, with its project-scoped artifacts and Discovery state. Accounts, members and sessions are always preserved. Run --dry-run first to see exactly what it would remove.");
    return;
  }
  const database = flag("--database");
  const tier = option("--tier", "core");
  if (!["core", "extended"].includes(tier)) throw new Error("--tier must be core or extended.");
  const options = { tier, dryRun: flag("--dry-run"), removeOtherProjects: flag("--remove-other-projects") };
  const result = database
    ? await seedPostgres(process.env.DATABASE_URL, options)
    : await seedJsonFile(option("--file", "var/mission-dev-data.json"), options);
  if (flag("--json")) console.log(JSON.stringify(result, null, 2));
  else printAudit(result);
  if (!options.dryRun) console.log("\nRestart the API so it reloads the store, then open Project Memory and select Start conception.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
