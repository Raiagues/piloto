/* global window, document */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { buildApp } from "../server/app.mjs";
import { createQuetzalDesignModel } from "../benchmark/quetzal1/context/design-context.mjs";

// Explicit UI fixture: real React/accounts/documents, simulated extraction
// progress. No provider calls or claims about extraction quality are made.
const directory = await mkdtemp(join(tmpdir(), "norte-background-browser-"));
const app = await buildApp({ storeFile: join(directory, "state.json"), logger: false, systemAi: { apiKey: "" } });
const port = Number(process.env.NORTE_BACKGROUND_VISUAL_PORT || 5314), origin = `http://127.0.0.1:${port}`;
let vite, browser, page, started = 0, applied = false, stage = 72;
const errors = [], documents = [];
try {
  const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Interface Engineer", nickname: "interface_engineer", email: "interface@example.test", password: "isolated browser validation passphrase 2026" } });
  assert.equal(registration.statusCode, 201, registration.body);
  const session = registration.json(), cookie = registration.headers["set-cookie"].split(";")[0], headers = { cookie, "x-csrf-token": session.csrfToken };
  const projectId = (await app.inject({ method: "GET", url: "/api/projects", headers })).json().projects[0].id;
  const team = (await app.inject({ method: "GET", url: "/api/teams", headers })).json().teams[0];
  const original = (await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers })).json().project;
  const target = { ...original, name: "Quetzal-1 · validação da interface", context: { ...original.context, configured: true, teamId: team.id, teamName: team.name } };
  const save = await app.inject({ method: "PUT", url: `/api/projects/${projectId}`, headers, payload: target }); assert.equal(save.statusCode, 200, save.body);
  const labels = ["Visão geral da missão Quetzal-1", "Arquitetura de alimentação — EPS", "Controle de atitude — ADCS", "Comunicações e antena", "Computador de bordo", "Câmera e carga útil", "Esquema da bateria", "Interface dos painéis solares", "BOM — sistema elétrico", "Regulador TPS63001", "Sensor de corrente INA219", "Microcontrolador ATmega328P", "Interface I²C TCA4311A", "Sensor de temperatura", "Conversor AD7991", "Controlador de carga", "Integração mecânica"];
  for (const [index, label] of labels.entries()) {
    const content = `Documento ${index + 1}. Exemplo de interface: o sistema Quetzal-1 contém um computador de bordo e uma unidade de comunicação. Este arquivo é uma fixture, não documentação técnica real.`;
    const response = await app.inject({ method: "POST", url: "/api/artifacts", headers, payload: { kind: "document", label, url: `data:text/plain;base64,${Buffer.from(content).toString("base64")}`, fileName: `documento-${index + 1}.txt`, mimeType: "text/plain", size: Buffer.byteLength(content), tags: [], scope: "project", ownerId: projectId } });
    assert.equal(response.statusCode, 201, response.body);
    documents.push({ artifactId: response.json().artifact.id, label, totalChunks: index === 11 ? 63 : index === 16 ? 8 : 3, totalPages: index === 11 ? 653 : undefined });
  }
  const otherId = randomUUID(), otherName = "Outro projeto · navegação livre";
  const other = await app.inject({ method: "POST", url: "/api/projects", headers, payload: { ...target, id: otherId, name: otherName, context: { ...target.context, projectArtifactIds: [] } } }); assert.equal(other.statusCode, 201, other.body);
  const proposal = createQuetzalDesignModel(); proposal.generatedAt = new Date().toISOString(); proposal.name = "Quetzal-1 — proposta de interface";
  const job = summary => ({ jobId: "ui-background-job", projectId, regenerate: false, autoRun: true, applied, status: stage === 116 ? "completed" : "running", progress: { totalDocuments: 17, processedDocuments: stage === 116 ? 17 : 11, totalChunks: 116, completedChunks: stage, cachedChunks: 12, failedChunks: 0, coverage: stage / 116 }, report: { complete: stage === 116, needsReview: true, omissionCount: 1, conflictCount: 0, ...(!summary ? { omissions: [{ chunkId: "fixture", artifactId: documents[11].artifactId, kind: "property", id: "ambiguous", name: "Limite de operação", reason: "Conferir valor na tabela da fonte." }] } : {}), documents: documents.map((item, index) => ({ ...item, complete: stage === 116 || index < 11, completedChunks: stage === 116 || index < 11 ? item.totalChunks : index === 11 ? 39 : 0, cachedChunks: index < 4 ? 3 : 0, stage: stage === 116 || index < 11 ? "completed" : index === 11 ? "reading" : "queued", activeChunks: stage !== 116 && index === 11 ? 2 : 0 })) }, ...(!summary && stage === 116 ? { result: proposal } : {}) });
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...process.env, VITE_DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Vite startup timeout")), 25000); vite.stdout.on("data", chunk => { if (String(chunk).includes("Local:")) { clearTimeout(timer); resolve(); } }); vite.once("exit", code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); }); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const split = cookie.indexOf("="); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin }]);
  await context.addInitScript(({ projectId }) => { window.localStorage.setItem("norte-language", "pt"); window.localStorage.setItem("norte-active-project-v1", projectId); }, { projectId });
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.startsWith("/api/system-ai/jobs")) {
      let result;
      if (path.endsWith("/latest")) result = { job: started && url.searchParams.get("projectId") === projectId ? job(true) : null };
      else if (path.endsWith("/apply")) {
        assert.equal(JSON.parse(request.postData()).reviewed, true); applied = true;
        await app.missionStore.update(data => { const record = data.workspace.projects[projectId]; record.document.engineeringSystem = proposal; record.document.phaseProgress = { highestUnlockedStep: 1 }; record.document.systemGeneratedFromRevision = record.document.memoryRevision; record.revision++; });
        result = { engineeringSystem: proposal, project: app.missionStore.read().workspace.projects[projectId].document };
      } else if (path === "/api/system-ai/jobs" && request.method() === "POST") { started++; assert.equal(JSON.parse(request.postData()).autoRun, true); result = job(true); }
      else result = job(url.searchParams.get("summary") === "true");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) }); return;
    }
    const response = await app.inject({ method: request.method(), url: path + url.search, headers: { ...await request.allHeaders(), host: `127.0.0.1:${port}` }, ...(request.postData() ? { payload: request.postData() } : {}) });
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([name]) => !["content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)).map(([name, value]) => [name, String(value)])), body: response.body });
  });
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/norte/#/study-setup");
  await page.getByRole("button", { name: "Gerar mapa", exact: true }).click();
  await page.locator(".extraction-task-panel").waitFor();
  assert.equal(await page.locator(".extraction-document-section li").count(), 17);
  assert.equal(await page.locator(".conception-initialization").count(), 0);
  assert.match(await page.locator(".extraction-review-note").innerText(), /1 item sem comprovação/);
  assert.equal(new URL(page.url()).hash, "#/study-setup");
  await page.screenshot({ path: "/tmp/norte-extraction-background-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Continuar navegando", exact: true }).click();
  await page.locator(".mission-sidebar button[title='Reuniões']").click();
  await page.locator(".meetings-page").waitFor();
  await page.getByRole("button", { name: "Acompanhar geração do mapa", exact: true }).click();
  await page.screenshot({ path: "/tmp/norte-extraction-background-meetings.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/norte-extraction-background-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.getByRole("button", { name: "Minimizar acompanhamento" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Acompanhar geração do mapa", exact: true }).waitFor();
  assert.equal(started, 1, "Reload reconnects to the same job without another generation");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Expandir barra lateral" }).click();
  await page.locator(".mission-context-switcher select").selectOption(otherId);
  await page.locator(".pm-workspace").waitFor();
  assert.equal(await page.locator(".mission-context-switcher select").inputValue(), otherId);
  stage = 116;
  await page.getByText("Mapa pronto para revisão", { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await page.getByRole("dialog").count(), 0, "Completion does not steal focus with a modal");
  assert.equal(new URL(page.url()).hash, "#/study-setup");
  assert.equal(await page.locator(".mission-context-switcher select").inputValue(), otherId, "Completion keeps the selected project");
  await page.getByRole("button", { name: "Acompanhar geração do mapa", exact: true }).click();
  await page.getByRole("button", { name: "Revisar proposta", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: "/tmp/norte-extraction-background-review.png", fullPage: true });
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Aplicar mapa revisado", exact: true }).click();
  await page.getByText("Mapa salvo no projeto", { exact: true }).waitFor();
  assert.equal(await page.locator(".mission-context-switcher select").inputValue(), otherId);
  assert.equal(app.missionStore.read().workspace.projects[otherId].document.engineeringSystem, undefined);
  assert.equal(app.missionStore.read().workspace.projects[projectId].document.engineeringSystem.id, proposal.id);
  await page.evaluate(() => { window.location.hash = "#/software"; });
  await page.waitForURL("**/#/study-setup");
  assert.equal(await page.locator(".mission-pipeline").getByRole("button", { name: /Software/ }).count(), 0);
  assert.equal(started, 1); assert.deepEqual(errors, []);
  console.log("PASS: 17 uploaded documents, individual status, nonblocking progress, meetings navigation, mobile layout, reload recovery without duplicate generation, explicit review, no project/route theft, safe application to the correct project, Software route removed. UI fixture; no paid provider calls.");
} catch (error) { if (page) await page.screenshot({ path: "/tmp/norte-extraction-background-failure.png", fullPage: true }).catch(() => {}); console.error("Browser errors:", errors); throw error; }
finally { await browser?.close(); vite?.kill("SIGTERM"); await app.close(); await rm(directory, { recursive: true, force: true }); }
