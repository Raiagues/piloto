import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createInitialData, normalizeStoredData } from "../server/data-store.mjs";

const LEGACY_ARTIFACT_IDS = new Set(["team-aurora-report", "team-aurora-lessons", "norte-aurora-telemetry"]);
const LEGACY_MEMBER_PATTERN = /^(?:aurora-|team-(?:zenith|sirius|caracara|gauchosat)-member-)/u;

export function assertResetEnvironment(env, databaseUrl) {
  if (env.NORTE_ALLOW_DESTRUCTIVE_RESET !== "1") throw new Error("Reset refused: set NORTE_ALLOW_DESTRUCTIVE_RESET=1 explicitly.");
  if (!["development", "test"].includes(env.NODE_ENV)) throw new Error("Reset refused: NODE_ENV must explicitly be development or test.");
  if (env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_URL) throw new Error("Reset refused: a hosted Render environment was detected.");
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || /(?:^|[_-])(?:prod|production|live)(?:$|[_-])/iu.test(databaseName)
    || !/(?:^|[_-])(?:dev|development|test)(?:$|[_-])/iu.test(databaseName)) {
    throw new Error("Reset refused: PostgreSQL must use a loopback host and an explicitly dev/test database name. Remote and production databases are not reset by this utility.");
  }
}

export function resetValidationData(value) {
  const previous = normalizeStoredData(value);
  const next = createInitialData();
  const ownedArtifactIds = new Set(LEGACY_ARTIFACT_IDS);
  const removedOwnerIds = new Set(previous.teams.map((team) => team.id));
  for (const team of previous.teams) for (const id of team.artifactIds) ownedArtifactIds.add(id);
  for (const [projectId, record] of Object.entries(previous.workspace.projects)) {
    removedOwnerIds.add(projectId);
    for (const id of record.document?.context?.projectArtifactIds ?? []) ownedArtifactIds.add(id);
    for (const id of record.document?.context?.teamArtifactIds ?? []) ownedArtifactIds.add(id);
  }
  next.createdAt = previous.createdAt;
  next.users = previous.users;
  next.sessions = previous.sessions;
  next.members = previous.members.filter((member) => member.accountId || !LEGACY_MEMBER_PATTERN.test(member.id));
  next.artifacts = [...next.artifacts, ...previous.artifacts.filter((artifact) => !ownedArtifactIds.has(artifact.id)
    && !next.artifacts.some((seed) => seed.id === artifact.id)
    && !(removedOwnerIds.has(artifact.ownerId) && ["team", "project"].includes(artifact.scope)))];
  const owner = next.users.find((user) => user.accessRole === "owner_admin");
  const ownerMember = next.members.find((member) => member.accountId === owner?.id);
  next.teams[0].createdBy = owner?.id ?? null;
  next.teams[0].memberIds = ownerMember ? [ownerMember.id] : [];
  next.workspace.validationResetId = randomUUID();
  return next;
}

export function validationSummary(data) {
  return {
    teams: data.teams.length,
    projects: Object.keys(data.workspace.projects).length,
    artifacts: data.artifacts.length,
    labs: Object.keys(data.workspace.labs).length,
    accountsPreserved: data.users.length,
    validationResetId: data.workspace.validationResetId
  };
}

async function backupSnapshot(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

export async function resetJsonFile(filePath, env = process.env) {
  assertResetEnvironment(env);
  const path = resolve(filePath);
  const original = JSON.parse(await readFile(path, "utf8"));
  const next = resetValidationData(original);
  const backupPath = `${path}.backup-${Date.now()}-${randomUUID()}`;
  await backupSnapshot(backupPath, original);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  const verified = normalizeStoredData(JSON.parse(await readFile(path, "utf8")));
  return { backupPath, ...validationSummary(verified) };
}

export async function resetPostgres(databaseUrl, env = process.env, options = {}) {
  assertResetEnvironment(env, databaseUrl);
  const pool = options.pool ?? new (await import("pg")).default.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, application_name: "norte-validation-reset" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT data FROM norte_state WHERE id = $1 FOR UPDATE", ["primary"]);
    if (result.rows.length !== 1) throw new Error("Reset refused: no existing Norte state found.");
    const original = result.rows[0].data;
    const next = resetValidationData(original);
    const backupPath = resolve(options.backupDirectory ?? "var/backups", `validation-postgres-${Date.now()}-${randomUUID()}.json`);
    await backupSnapshot(backupPath, original);
    await client.query("UPDATE norte_state SET data = $2::jsonb, updated_at = NOW() WHERE id = $1", ["primary", JSON.stringify(next)]);
    await client.query("COMMIT");
    return { backupPath, ...validationSummary(next) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    if (!options.pool) await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  const database = args.includes("--database");
  if (database && fileIndex >= 0) throw new Error("Choose --file or --database, not both.");
  if (fileIndex >= 0 && !args[fileIndex + 1]) throw new Error("--file requires a path.");
  if (args.some((arg, index) => !["--file", "--database"].includes(arg) && !(fileIndex >= 0 && index === fileIndex + 1))) throw new Error("Usage: node scripts/reset-validation-data.mjs [--file path | --database]");
  if (database && !process.env.DATABASE_URL) throw new Error("--database requires DATABASE_URL.");
  if (!database && fileIndex < 0 && process.env.DATABASE_URL) throw new Error("DATABASE_URL is configured. Choose --file explicitly or --database for a verified local dev/test database.");
  const result = database
    ? await resetPostgres(process.env.DATABASE_URL)
    : await resetJsonFile(fileIndex >= 0 ? args[fileIndex + 1] : "var/mission-dev-data.json");
  console.log(JSON.stringify(result, null, 2));
  console.log("Restart the API after resetting its store. Browser project caches must be refreshed from the project list.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
