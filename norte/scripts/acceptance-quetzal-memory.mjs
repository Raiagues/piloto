/** Real browser acceptance run over the seeded Quetzal-1 Project Memory.
 *
 * Unlike the fixture browser checks, this drives the LIVE extraction provider
 * against the documents the seed command actually imported. It works on a copy
 * of the validation store so a failed run cannot damage local data, and it
 * re-registers the operator account because password hashes are not reversible.
 * Every artifact, link and project field comes from the seeded database.
 *
 *   NORTE_ACCEPTANCE_STORE=var/mission-dev-data.json \
 *     node --env-file-if-exists=.env.local scripts/acceptance-quetzal-memory.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { buildApp } from "../server/app.mjs";
import { normalizeStoredData } from "../server/data-store.mjs";

const sourceStore = resolve(process.env.NORTE_ACCEPTANCE_STORE || "var/mission-dev-data.json");
const projectId = process.env.NORTE_ACCEPTANCE_PROJECT || "quetzal1-eps-comms";
const attempts = Number(process.env.NORTE_ACCEPTANCE_ATTEMPTS || 4);
const port = Number(process.env.NORTE_VISUAL_PORT || 5291);
const base = `http://127.0.0.1:${port}/norte/`;
const directory = await mkdtemp(join(tmpdir(), "norte-acceptance-"));
const reportDirectory = resolve("var/benchmarks", `acceptance-quetzal-${Date.now()}`);
await mkdir(reportDirectory, { recursive: true, mode: 0o700 });

const report = { startedAt: new Date().toISOString(), store: sourceStore, projectId, execution: "LIVE provider, real UI/API, copy of the seeded validation database", memory: null, providerAttempts: [], generation: [], checks: [], passed: false };
const save = () => writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
const check = async (name, value) => { report.checks.push({ name, value }); await save(); console.log(`  ${value ? "PASS" : "FAIL"}  ${name}`); assert.ok(value, name); };

// The seeded content is copied verbatim; only credentials are cleared so this
// run can sign in. Artifacts, links and project fields are untouched.
const original = normalizeStoredData(JSON.parse(await readFile(sourceStore, "utf8")));
const state = { ...original, users: [], sessions: [], members: [], teams: original.teams.map((team) => ({ ...team, memberIds: [], createdBy: null })) };
const storeFile = join(directory, "state.json");
await writeFile(storeFile, JSON.stringify(state), { mode: 0o600 });

let vite, browser;
const app = await buildApp({ storeFile, logger: false, systemAi: { model: process.env.NORTE_LIVE_MODEL || process.env.GEMINI_MODEL, onAttempt: async (record) => {
  report.providerAttempts.push({ attempt: record.attempt, model: record.model, requestBytes: record.requestBytes, httpStatus: record.httpStatus, status: record.status, elapsedMs: record.elapsedMs, promptTokens: record.usageMetadata?.promptTokenCount ?? null, finishReason: record.finishReason });
  await save();
  console.log(`  provider  bytes=${record.requestBytes} http=${record.httpStatus} status=${record.status} ms=${record.elapsedMs}`);
} } });

try {
  const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Validation Engineer", email: "quetzal-acceptance@example.test", password: "Quetzal acceptance passphrase 42", institution: "Universidad del Valle" } });
  assert.equal(registration.statusCode, 201, registration.body);
  const session = registration.json();
  const cookie = registration.headers["set-cookie"].split(";")[0];
  const headers = { cookie, "x-csrf-token": session.csrfToken };
  const saved = async () => (await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers })).json().project;

  console.log("\nSeeded database, before Start conception");
  const before = await saved();
  const artifacts = (await app.inject({ method: "GET", url: "/api/artifacts", headers })).json().artifacts;
  const linked = artifacts.filter((artifact) => before.context.projectArtifactIds.includes(artifact.id));
  report.memory = {
    projectName: before.name, teamName: before.context.teamName, programId: before.context.programId,
    referenceProgram: before.context.referenceProgram ?? null, memoryRevision: before.memoryRevision,
    artifacts: linked.map((artifact) => ({ id: artifact.id, label: artifact.label, mimeType: artifact.mimeType, size: artifact.size, readability: artifact.readability, publisher: artifact.provenance?.publisher ?? null, sourceUrl: artifact.provenance?.sourceUrl ?? null }))
  };
  await save();
  for (const artifact of linked) console.log(`  ${artifact.label} · ${artifact.mimeType} · ${artifact.size} B · ${artifact.readability.status}`);

  await check("project is Quetzal-1", before.name === "Quetzal-1");
  await check("team is Norte Validation Team", before.context.teamName === "Norte Validation Team");
  await check("no competition reference program", before.context.programId === null && before.context.modalityId === null && before.context.categoryId === null);
  await check("no engineering system before conception", before.engineeringSystem === undefined);
  await check("every linked artifact is readable", linked.length > 0 && linked.every((artifact) => ["parsed", "pdf"].includes(artifact.readability.status)));
  await check("the schematic and AX100 datasheet are PDFs Norte holds", linked.some((artifact) => /Schematic/u.test(artifact.label) && artifact.readability.status === "pdf") && linked.some((artifact) => /AX100/u.test(artifact.label) && artifact.readability.status === "pdf"));
  await check("stored bytes are served through a content path, not inline", linked.every((artifact) => typeof artifact.contentPath === "string"));
  await check("no artifact is a metadata-only link", linked.every((artifact) => artifact.readability.status !== "metadata_only"));
  await check("no Aurora or OBSAT residue in this project", !/Aurora|OBSAT|Projeto Teste/iu.test(JSON.stringify({ before, linked })));

  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...process.env, VITE_DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((done, fail) => { const timer = setTimeout(() => fail(new Error("Vite startup timeout")), 20000); vite.stdout.on("data", (chunk) => { if (String(chunk).includes("Local:")) { clearTimeout(timer); done(); } }); vite.once("exit", (code) => fail(new Error(`Vite exited ${code}`))); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const split = cookie.indexOf("=");
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: new URL(base).origin }]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await app.inject({ method: request.method(), url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: `127.0.0.1:${port}` }, ...(request.postData() ? { payload: request.postData() } : {}) });
    const outputHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !["content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)).map(([name, value]) => [name, String(value)]));
    await route.fulfill({ status: response.statusCode, headers: outputHeaders, body: response.rawPayload });
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  console.log("\nProject Memory in the browser");
  await page.goto(`${base}#/study-setup`, { waitUntil: "networkidle" });
  await page.locator(".pm-artifacts-board").waitFor({ timeout: 20000 });
  // The board mounts before its authenticated requests finish. Wait for the
  // actual memory load, not only the surrounding layout or network idle.
  await page.locator(".pm-loading").waitFor({ state: "hidden", timeout: 20000 });
  await check("Project Memory loaded without an API error", await page.locator(".pm-memory-error").count() === 0);
  const shown = await page.locator(".pm-artifact-card strong").allInnerTexts();
  const statuses = await page.locator(".pm-artifact-status").allInnerTexts();
  report.memory.visibleCards = shown;
  report.memory.visibleStatuses = statuses;
  await save();
  for (const [index, label] of shown.entries()) console.log(`  card  ${label} — ${statuses[index] ?? ""}`);
  await check("Project Memory lists the seeded documents", linked.every((artifact) => shown.includes(artifact.label)));
  await check("every card is marked usable", statuses.length === shown.length && statuses.every((text) => /Source connected|Fonte conectada/u.test(text)));
  await check("the page shows an independent project, not OBSAT", !/OBSAT|Olimpíada|Brazilian Satellite/iu.test(await page.locator(".pm-program-card").innerText()));
  await check("the readiness line agrees the memory is ready", !(await page.locator(".pm-readiness").getAttribute("class")).includes("missing") && await page.locator(".pm-open-conception").isEnabled());
  await page.screenshot({ path: join(reportDirectory, "project-memory.png"), fullPage: true });

  console.log("\nStart conception");
  let model = null;
  for (let attempt = 1; attempt <= attempts && !model; attempt += 1) {
    console.log(`  attempt ${attempt}`);
    await page.locator(".pm-open-conception").click();
    await page.locator(".conception-initialization").waitFor({ timeout: 5000 }).catch(() => undefined);
    // Evaluated in the page, not in Node: wait for the loading state to clear.
    await page.locator(".conception-initialization").waitFor({ state: "detached", timeout: 240000 });
    // A failure on the memory page surfaces in its feedback banner; a failure
    // after leaving it surfaces in the conception error panel. Read both.
    const failure = await page.locator(".pm-feedback").innerText().catch(() => "")
      || await page.locator(".conception-error p").innerText().catch(() => "");
    const current = await saved();
    const providerCode = report.providerAttempts.at(-1)?.status ?? null;
    report.generation.push({ attempt, error: failure.replace(/\s+/gu, " ").trim() || null, providerStatus: providerCode, generated: Boolean(current.engineeringSystem) });
    await save();
    if (current.engineeringSystem) { model = current.engineeringSystem; break; }
    console.log(`    visible failure: ${failure.replace(/\s+/gu, " ").trim() || "(none shown)"}`);
    await page.locator(".conception-error button").last().click().catch(() => undefined);
    await page.goto(`${base}#/study-setup`, { waitUntil: "networkidle" });
    await page.locator(".pm-artifacts-board").waitFor({ timeout: 20000 });
  }
  await check(`conception produced a persisted system within ${attempts} attempts`, Boolean(model));

  await page.locator(".system-graph, [data-entity-id]").first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(reportDirectory, "system-workspace.png"), fullPage: true });
  const graphNodes = await page.locator("[data-entity-id]").count();
  report.system = {
    entities: model.entities.length, relations: model.relations.length, requirements: model.requirements.length,
    evidence: model.evidence.length, model: model.model, generatedFromRevision: model.generatedFromRevision,
    artifactSources: model.artifactSources, graphNodes,
    evidenceSample: model.evidence.slice(0, 6).map((item) => ({ id: item.id, artifactLabel: item.artifactLabel, locator: item.locator ?? null, kind: item.kind, excerpt: item.excerpt }))
  };
  await save();
  await writeFile(join(reportDirectory, "engineering-system.json"), JSON.stringify(model, null, 2), { mode: 0o600 });
  console.log(`\n  entities=${model.entities.length} relations=${model.relations.length} requirements=${model.requirements.length} evidence=${model.evidence.length} graphNodes=${graphNodes}`);
  for (const item of report.system.evidenceSample) console.log(`  evidence  ${item.artifactLabel} ${item.locator ?? ""} — "${item.excerpt.slice(0, 80)}"`);

  const seededIds = new Set(before.context.projectArtifactIds);
  await check("the system was generated from the seeded memory revision", model.generatedFromRevision === before.memoryRevision);
  await check("every evidence record cites a seeded artifact", model.evidence.length > 0 && model.evidence.every((item) => seededIds.has(item.artifactId)));
  await check("every entity is supported by evidence", model.entities.length > 0 && model.entities.every((entity) => entity.evidenceRefs.length > 0));
  await check("the graph rendered the extracted entities", graphNodes > 0);
  await check("no client error was raised", pageErrors.length === 0);

  console.log("\nRe-entry");
  await page.goto(`${base}#/study-setup`, { waitUntil: "networkidle" });
  await page.locator(".pm-artifacts-board").waitFor({ timeout: 20000 });
  await check("returning to Project Memory does not lock conception", await page.locator(".pm-open-conception").isEnabled());
  const providerCallsBefore = report.providerAttempts.length;
  await page.locator(".pm-open-conception").click();
  await page.locator(".system-graph, [data-entity-id]").first().waitFor({ timeout: 30000 });
  const reopened = await saved();
  await check("re-entering conception reopens the saved model without regenerating", report.providerAttempts.length === providerCallsBefore && JSON.stringify(reopened.engineeringSystem) === JSON.stringify(model));


  report.passed = report.checks.every((item) => item.value);
  await save();
  console.log(`\nAcceptance ${report.passed ? "PASSED" : "FAILED"} — report: ${reportDirectory}`);
} finally {
  await browser?.close().catch(() => undefined);
  vite?.kill("SIGTERM");
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
