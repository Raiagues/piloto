/** The controlled importer: allowlisted retrieval, no evaluator leakage, idempotent writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertReachableUrl, fetchManifestSource, isPrivateAddress, sourceProvenance } from "./source-import.mjs";
import { classifyArtifactSource } from "./artifact-content.mjs";
import { createInitialData } from "./data-store.mjs";
import { seedQuetzalValidation, assertSeedEnvironment, describeProject } from "../scripts/seed-quetzal-validation.mjs";
import { ALLOWED_SOURCE_HOSTS, artifactIdForSource, IMPORTABLE_ROLES, QUETZAL_SOURCES, sourcesForTier } from "../examples/quetzal1/source-manifest.mjs";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fakeBytes(source) {
  if (source.expectedMimeType === "application/pdf") return Buffer.concat([Buffer.from(`%PDF-1.7 ${source.id} `), Buffer.alloc(32, 0x20)]);
  if (source.expectedMimeType.includes("spreadsheetml")) return Buffer.from("PK fake workbook");
  return Buffer.from(`# ${source.label} — document body for ${source.id}.`, "utf8");
}

/** Serves manifest bytes and recomputes pinned hashes, so tests never re-download. */
function stubTransport(overrides = new Map()) {
  const bytesFor = (source) => overrides.get(source.id) ?? fakeBytes(source);
  const byUrl = new Map(QUETZAL_SOURCES.map((source) => [source.sourceUrl, source]));
  const sources = QUETZAL_SOURCES.map((source) => ({ ...source, ...(source.sha256 ? { sha256: sha(bytesFor(source)) } : {}) }));
  const fetchImpl = async (url) => {
    const source = byUrl.get(url);
    if (!source) return new Response("", { status: 404 });
    const bytes = bytesFor(source);
    return new Response(bytes, { status: 200, headers: { "content-type": source.expectedMimeType, "content-length": String(bytes.length) } });
  };
  return { fetchImpl, sources, resolveHost: publicLookup };
}

test("the manifest describes sources, never engineering content", () => {
  const text = JSON.stringify(QUETZAL_SOURCES);
  for (const pattern of [/\b2640\b/u, /\b1\.58\b/u, /generated_power/u, /tx_duty_cycle/u, /"entities"/u, /"relations"/u]) {
    assert.doesNotMatch(text, pattern, `the manifest must not carry engineering values: ${pattern}`);
  }
  for (const source of QUETZAL_SOURCES) {
    assert.ok(source.id && source.label && source.publisher && source.sourceUrl && source.role && source.contextPolicy, `${source.id} is missing provenance metadata`);
    assert.equal(new URL(source.sourceUrl).protocol, "https:", `${source.id} must use HTTPS`);
  }
  // Only the design sources are importable; the paper stays with the evaluator.
  assert.deepEqual([...new Set(sourcesForTier("extended").map((source) => source.role))].sort(), [...IMPORTABLE_ROLES].sort());
  assert.ok(QUETZAL_SOURCES.some((source) => source.role === "evaluation_reference" && source.tier === "excluded"));
  for (const source of sourcesForTier("extended")) assert.ok(ALLOWED_SOURCE_HOSTS.includes(new URL(source.sourceUrl).hostname), `${source.id} host is not allowlisted`);
});

test("retrieval refuses anything outside the allowlist, private networks and plaintext", async () => {
  await assert.rejects(() => assertReachableUrl("http://raw.githubusercontent.com/a", ALLOWED_SOURCE_HOSTS, { resolveHost: publicLookup }), /HTTPS/u);
  await assert.rejects(() => assertReachableUrl("https://evil.test/a.pdf", ALLOWED_SOURCE_HOSTS, { resolveHost: publicLookup }), /not an allowed source host/u);
  await assert.rejects(() => assertReachableUrl("https://user:pass@www.ti.com/a.pdf", ALLOWED_SOURCE_HOSTS, { resolveHost: publicLookup }), /credentials/u);
  await assert.rejects(() => assertReachableUrl("https://www.ti.com/a.pdf", ALLOWED_SOURCE_HOSTS, { resolveHost: async () => [{ address: "127.0.0.1", family: 4 }] }), /non-public address/u);
  await assert.rejects(() => assertReachableUrl("https://www.ti.com/a.pdf", ALLOWED_SOURCE_HOSTS, { resolveHost: async () => [{ address: "169.254.169.254", family: 4 }] }), /non-public address/u);
  for (const address of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "169.254.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(address), true, `${address} must be treated as private`);
  }
  assert.equal(isPrivateAddress("93.184.216.34"), false);
});

test("retrieval verifies status, type, signature, size and pinned hash", async () => {
  const source = sourcesForTier("core").find((item) => item.expectedMimeType === "application/pdf");
  const options = { allowedHosts: ALLOWED_SOURCE_HOSTS, resolveHost: publicLookup };

  await assert.rejects(() => fetchManifestSource(source, { ...options, fetchImpl: async () => new Response("", { status: 503 }) }), /HTTP 503/u);
  await assert.rejects(() => fetchManifestSource(source, { ...options, fetchImpl: async () => new Response("x", { status: 200, headers: { "content-type": "text/html" } }) }), /content-type/u);
  await assert.rejects(() => fetchManifestSource(source, { ...options, fetchImpl: async () => new Response("not a pdf", { status: 200, headers: { "content-type": "application/pdf" } }) }), /file signature/u);
  await assert.rejects(() => fetchManifestSource(source, { ...options, fetchImpl: async () => new Response(Buffer.from("%PDF-1.7 tampered"), { status: 200, headers: { "content-type": "application/pdf" } }) }), /does not match the pinned/u);

  // A redirect off the allowlist is refused rather than followed.
  await assert.rejects(() => fetchManifestSource(source, { ...options, fetchImpl: async () => new Response("", { status: 302, headers: { location: "https://evil.test/a.pdf" } }) }), /not an allowed source host/u);

  const evaluator = QUETZAL_SOURCES.find((item) => item.role === "evaluation_reference");
  await assert.rejects(() => fetchManifestSource(evaluator, { ...options, fetchImpl: async () => new Response("x") }), /evaluator-only/u);
});

test("provenance records where a file came from without describing what it says", async () => {
  const { fetchImpl, sources, resolveHost } = stubTransport();
  const source = sources.find((item) => item.id === "quetzal-eps-hardware-readme");
  const retrieval = await fetchManifestSource(source, { allowedHosts: ALLOWED_SOURCE_HOSTS, fetchImpl, resolveHost });
  const provenance = sourceProvenance(source, retrieval);
  assert.equal(provenance.publisher, source.publisher);
  assert.equal(provenance.revision, source.revision);
  assert.equal(provenance.sha256, retrieval.sha256);
  assert.equal(provenance.license, source.license);
  assert.equal(typeof provenance.retrievedAt, "string");
  assert.equal(provenance.size, retrieval.size);
});

test("the seed guard refuses to run without an explicit opt-in", () => {
  assert.throws(() => assertSeedEnvironment({}), /NORTE_ALLOW_QUETZAL_SEED/u);
  assert.throws(() => assertSeedEnvironment({ NORTE_ALLOW_QUETZAL_SEED: "true" }), /NORTE_ALLOW_QUETZAL_SEED/u);
  assert.doesNotThrow(() => assertSeedEnvironment({ NORTE_ALLOW_QUETZAL_SEED: "1" }));
});

test("seeding replaces old memory with real sources, requires conception again and preserves accounts", async () => {
  const { fetchImpl, sources, resolveHost } = stubTransport();
  const original = createInitialData();
  original.users = [{ id: "owner", accessRole: "owner_admin", passwordHash: "keep" }];
  original.members = [{ id: "member-1", accountId: "owner" }];
  original.sessions = [{ id: "session-1", userId: "owner" }];
  const project = original.workspace.projects["quetzal1-eps-comms"].document;
  // An older dataset: competition context, stale documents and a generated system.
  project.context.programId = "obsat";
  project.context.modalityId = "practical";
  project.context.categoryId = "n3";
  project.context.teamName = "Equipe Aurora";
  project.context.projectArtifactIds = ["team-aurora-report"];
  project.context.teamArtifactIds = ["team-aurora-lessons"];
  project.engineeringSystem = { schemaVersion: 1, id: "old", name: "old", entities: [], relations: [], requirements: [], evidence: [], artifactSources: [], generatedAt: "", generatedFromRevision: 1 };
  project.systemGeneratedFromRevision = 1;
  project.phaseProgress = { highestUnlockedStep: 1 };
  original.artifacts = [
    { id: "team-aurora-report", label: "Relatorio Aurora", scope: "project", ownerId: "quetzal1-eps-comms", url: "artifacts/aurora.md" },
    { id: "team-aurora-lessons", label: "Licoes Aurora", scope: "team", ownerId: "team-norte-validation", url: "artifacts/aurora.csv" },
    { id: "unrelated", label: "Someone else's file", scope: "project", ownerId: "other-project", url: "https://example.test/x" }
  ];
  original.teams[0].artifactIds = ["team-aurora-lessons"];

  const { data, audit } = await seedQuetzalValidation(original, { manifest: sources, fetchImpl, resolveHost });
  const after = describeProject(data);

  assert.equal(after.name, "Quetzal-1");
  assert.equal(after.teamId, "team-norte-validation");
  assert.equal(after.programId, null);
  assert.equal(after.modalityId, null);
  assert.equal(after.categoryId, null);
  assert.equal(after.referenceProgram, "independent");
  assert.equal(after.hasEngineeringSystem, false);
  assert.equal(after.systemGeneratedFromRevision, null);
  assert.equal(data.workspace.projects["quetzal1-eps-comms"].document.phaseProgress.highestUnlockedStep, 0);
  assert.equal(after.memoryRevision, 2);

  // Old documents are gone from the store, the team library and every project link.
  assert.doesNotMatch(JSON.stringify(data.workspace), /Aurora/iu);
  assert.deepEqual(data.artifacts.filter((artifact) => /aurora/iu.test(artifact.id)), []);
  assert.deepEqual(data.teams[0].artifactIds, []);
  assert.ok(data.artifacts.some((artifact) => artifact.id === "unrelated"), "another project's file is untouched");
  assert.deepEqual(audit.removed.map((artifact) => artifact.id).sort(), ["team-aurora-lessons", "team-aurora-report"]);

  // Every imported source stores real bytes the extraction pipeline can read.
  assert.deepEqual(after.projectArtifactIds, sourcesForTier("core").map((source) => artifactIdForSource(source.id)));
  for (const id of after.projectArtifactIds) {
    const artifact = data.artifacts.find((item) => item.id === id);
    assert.ok(artifact.url.startsWith("data:"), `${id} must store its bytes, not a link`);
    assert.equal(artifact.provenance.sha256.length, 64);
    assert.notEqual(classifyArtifactSource(artifact).status, "metadata_only");
  }
  assert.equal(audit.readiness.basicProjectReady, true);

  // Accounts, sessions and members survive.
  assert.deepEqual(data.users, original.users.map(user => ({ ...user, nickname: user.nickname || "pessoa", emailVerifiedAt: user.emailVerifiedAt || null })));
  assert.deepEqual(data.sessions, original.sessions);
  assert.deepEqual(data.members, original.members);
  assert.deepEqual(data.teams[0].memberIds, ["member-1"]);
});

test("seeding twice creates no duplicates and does not churn the memory revision", async () => {
  const { fetchImpl, sources, resolveHost } = stubTransport();
  const first = await seedQuetzalValidation(createInitialData(), { manifest: sources, fetchImpl, resolveHost });
  const second = await seedQuetzalValidation(first.data, { manifest: sources, fetchImpl, resolveHost });

  assert.equal(second.data.artifacts.length, first.data.artifacts.length);
  assert.deepEqual(second.audit.after.projectArtifactIds, first.audit.after.projectArtifactIds);
  assert.deepEqual(second.audit.removed, []);
  assert.equal(second.audit.changed, false);
  assert.equal(second.audit.after.memoryRevision, first.audit.after.memoryRevision);
  assert.ok(second.audit.imported.every((artifact) => artifact.reused));

  // A republished file is picked up in place, still without duplicating the artifact.
  const changed = stubTransport(new Map([["quetzal-eps-hardware-readme", Buffer.from("# Revised overview", "utf8")]]));
  const third = await seedQuetzalValidation(second.data, { manifest: changed.sources, fetchImpl: changed.fetchImpl, resolveHost });
  assert.equal(third.data.artifacts.length, first.data.artifacts.length);
  assert.equal(third.audit.after.memoryRevision, first.audit.after.memoryRevision + 1);
});

test("stray demonstration projects are removed only when explicitly asked, and audited", async () => {
  const { fetchImpl, sources, resolveHost } = stubTransport();
  const original = createInitialData();
  original.users = [{ id: "owner", accessRole: "owner_admin" }];
  original.members = [{ id: "member-1", accountId: "owner" }];
  original.sessions = [{ id: "session-1", userId: "owner" }];
  original.workspace.projects["projeto-teste"] = {
    document: { schemaVersion: 2, id: "projeto-teste", name: "Projeto Teste", context: { teamId: "team-norte-validation", projectArtifactIds: ["teste-doc"], teamArtifactIds: [] }, board: { nodes: [], links: [] } },
    revision: 1
  };
  original.workspace.labs = { "projeto-teste": { board: { nodes: [{ id: 1 }] } } };
  original.artifacts = [{ id: "teste-doc", label: "Arquivo de teste", scope: "project", ownerId: "projeto-teste", url: "https://example.test/x" }];

  const kept = await seedQuetzalValidation(original, { manifest: sources, fetchImpl, resolveHost });
  assert.ok(kept.data.workspace.projects["projeto-teste"], "another project is never removed by default");
  assert.deepEqual(kept.audit.discardedProjects, []);

  const cleaned = await seedQuetzalValidation(original, { manifest: sources, fetchImpl, resolveHost, removeOtherProjects: true });
  assert.deepEqual(Object.keys(cleaned.data.workspace.projects), ["quetzal1-eps-comms"]);
  assert.deepEqual(cleaned.data.workspace.labs["projeto-teste"], undefined);
  assert.equal(cleaned.data.artifacts.some((artifact) => artifact.id === "teste-doc"), false);
  assert.deepEqual(cleaned.audit.discardedProjects, [{ id: "projeto-teste", name: "Projeto Teste", artifacts: ["teste-doc"] }]);
  assert.equal(cleaned.audit.after.name, "Quetzal-1");
  // Accounts survive a project removal.
  assert.deepEqual(cleaned.data.users, original.users.map(user => ({ ...user, nickname: user.nickname || "pessoa", emailVerifiedAt: user.emailVerifiedAt || null })));
  assert.deepEqual(cleaned.data.sessions, original.sessions);
  assert.deepEqual(cleaned.data.members, original.members);
});
