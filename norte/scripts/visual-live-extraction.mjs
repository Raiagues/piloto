import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { buildApp } from "../server/app.mjs";
import { attachBenchmarkContext } from "./attach-benchmark-context.mjs";


// Real external extraction; isolated local database, authenticated API and actual UI.
const directory = await mkdtemp(join(tmpdir(), "norte-live-browser-"));
const reportDirectory = join(process.cwd(), "var/benchmarks", `browser-live-${Date.now()}`);
await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
const port = Number(process.env.NORTE_VISUAL_PORT || 5281);
const base = `http://127.0.0.1:${port}/norte/`;
let generations = 0, vite, browser;
const report = { startedAt: new Date().toISOString(), execution: "LIVE provider, real UI/API, isolated database; no model fixtures", requests: [], apiResponses: [], interactions: [], checks: [], passed: false };
const saveReport = () => writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
const app = await buildApp({ storeFile: join(directory, "state.json"), logger: false, systemAi: { model: process.env.NORTE_LIVE_MODEL || process.env.GEMINI_MODEL, onAttempt: async (record, payload) => {
  generations++;
  report.requests.push(record);
  await writeFile(join(reportDirectory, `provider-${generations}.json`), JSON.stringify(payload, null, 2), { mode: 0o600 });
  await saveReport();
  console.log(JSON.stringify({ browserProviderAttempt: generations, model: record.model, status: record.status, http: record.httpStatus, ms: record.elapsedMs, retry: record.retryScheduled }));
} } });
try {
  const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Validation Engineer", email: "quetzal-validation@example.test", password: "Quetzal validation passphrase 42" } });
  assert.equal(registration.statusCode, 201);
  const session = registration.json(), cookie = registration.headers["set-cookie"].split(";")[0];
  const headers = { cookie, "x-csrf-token": session.csrfToken };
  const projectId = (await app.inject({ method: "GET", url: "/api/projects", headers })).json().projects[0].id;
  const saved = async () => (await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers })).json().project;
  assert.equal((await saved()).context.programId, null);
  await attachBenchmarkContext(app, headers, projectId);
  assert.equal((await saved()).context.projectArtifactIds.length, 2);
  assert.equal((await saved()).engineeringSystem, undefined);
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...process.env, VITE_DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Vite startup timeout")), 15000); vite.stdout.on("data", (chunk) => { if (String(chunk).includes("Local:")) { clearTimeout(timer); resolve(); } }); vite.once("exit", (code) => reject(new Error(`Vite exited ${code}`))); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const split = cookie.indexOf("=");
  await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: new URL(base).origin }]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const response = await app.inject({ method: request.method(), url: new URL(request.url()).pathname + new URL(request.url()).search, headers: { ...await request.allHeaders(), host: `127.0.0.1:${port}` }, ...(request.postData() ? { payload: request.postData() } : {}) });
    if (new URL(request.url()).pathname.endsWith("/system-ai/generate")) {
      const data = response.json();
      report.apiResponses.push({ status: response.statusCode, code: (typeof data.error === "string" ? data.error : data.error?.code) || data.code || null, message: data.error?.message || data.message || null });
      await saveReport();
    }
    const outputHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !["content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)).map(([name, value]) => [name, String(value)]));
    await route.fulfill({ status: response.statusCode, headers: outputHeaders, body: response.body });
  });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".home-action-card.accent-open").click();
  await page.locator(".home-project-open").click();
  await page.locator(".pm-workspace").waitFor();
  page.setDefaultTimeout(20000);
  for (let interaction = 1; interaction <= 3; interaction++) {
    const started = performance.now();
    await page.locator(".pm-open-conception").click();
    await page.locator(".conception-initialization").waitFor();
    report.checks.push("Visible loading before provider completion");
    const outcome = await Promise.race([
      page.locator(".engineering-graph").waitFor({ timeout: 195000 }).then(() => "system"),
      page.locator(".pm-feedback").waitFor({ timeout: 195000 }).then(() => "error")
    ]);
    report.interactions.push({ interaction, outcome, elapsedMs: performance.now() - started });
    if (outcome === "system") break;
    report.interactions.at(-1).message = await page.locator(".pm-feedback").innerText();
    assert.equal((await saved()).engineeringSystem, undefined);
    assert.equal((await saved()).context.projectArtifactIds.length, 2);
    report.checks.push("Failed live extraction preserved Memory and created no fixture baseline");
    await page.locator(".pm-feedback button").click();
    await saveReport();
  }
  const baseline = (await saved()).engineeringSystem;
  if (!baseline) throw new Error("No live baseline after three explicit user-style retries; inspect physical provider attempts.");
  report.baselineCounts = { entities: baseline.entities.length, relations: baseline.relations.length, requirements: baseline.requirements.length };
  await writeFile(join(reportDirectory, "prediction.json"), JSON.stringify(baseline, null, 2), { mode: 0o600 });
  assert.equal((await saved()).phaseProgress.highestUnlockedStep, 1);
  assert.ok(baseline.model && !baseline.model.includes("fixture"));
  assert.ok(await page.locator(".engineering-node").count() > 0);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.locator(".engineering-node-info").first().click();
  await page.getByRole("dialog").waitFor();
  if (await page.getByRole("dialog").locator(".engineering-evidence summary").count()) await page.getByRole("dialog").locator(".engineering-evidence summary").first().click();
  await page.getByRole("dialog").locator(".engineering-source").first().waitFor();
  await page.keyboard.press("Escape");
  report.checks.push("Macro graph, explicit detail dialog and source excerpt visible");
  const beforeReentry = generations;
  await page.screenshot({ path: join(reportDirectory, "system.png"), fullPage: true });
  await page.locator(".mission-phase").first().click();
  await page.locator(".pm-workspace").waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".mission-phase").nth(1).isDisabled(), false);
  await page.locator(".mission-phase").nth(1).click();
  await page.locator(".engineering-graph").waitFor();
  assert.equal(generations, beforeReentry);
  assert.deepEqual((await saved()).engineeringSystem, baseline);
  assert.equal(errors.length, 0);
  report.checks.push("Refresh and re-entry preserve exact baseline with zero new provider requests", "No browser JavaScript errors");
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await saveReport();
  await browser?.close();
  vite?.kill("SIGTERM");
  await app.close();
  await rm(directory, { recursive: true, force: true });
  console.log(JSON.stringify({ directory: reportDirectory, passed: report.passed, physicalRequests: report.requests.length, interactions: report.interactions, failure: report.failure || null }));
}
