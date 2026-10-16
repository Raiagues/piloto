/* global document, window, getComputedStyle */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { buildApp } from "../server/app.mjs";
import { attachQuetzalArchitectureSources } from "../server/quetzal-source-extension.mjs";
import { createEngineeringValidationModel, validationMemoryText } from "../examples/engineering-validation.mjs";

// Real React + authenticated API + persistence; only the external extraction provider is mocked.
// Uses an isolated temporary store and test browser. Never modifies the user's database.
const directory = await mkdtemp(join(tmpdir(), "norte-browser-"));
const port = Number(process.env.NORTE_VISUAL_PORT || 5275);
const baseUrl = `http://127.0.0.1:${port}/norte/`;
let interpretations = 0, generations = 0, failGeneration = true, failContract = false, artifactId = "", lastDiscoveryContext;
const app = await buildApp({ storeFile: join(directory, "state.json"), logger: false, systemAi: { retryWait: async () => {}, apiKey: "test-provider", fetch: async (_url, options) => {
  const prompt = JSON.parse(options.body).contents[0].parts[0].text;
  if (prompt.startsWith("Interpret the engineering hypothesis")) {
    interpretations++;
    lastDiscoveryContext = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
    const text = lastDiscoveryContext.hypothesis;
    const mass = (confirmation) => ({ kind: "parameter", targetId: "payload", summary: "A massa do payload passa a 280 g.", question: "", confirmation, replacementName: "", updates: [{ propertyKey: "mass", operation: "set", value: 280, unit: "g", quote: "280 g" }] });
    const result = text === "Payload 280 g" ? mass("") : text === "Payload mais leve, 280 g" ? mass("Você quer aplicar essa massa ao Payload?") : { kind: "clarification", targetId: "", summary: "", question: "O que mudaria nessa alternativa?", confirmation: "", replacementName: "", updates: [] };
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(result) }] } }] }), { status: 200 });
  }
  if (JSON.parse(options.body).contents[0].parts[0].text.startsWith("Give concise")) return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"inferences":[]}' }] } }] }), { status: 200 });
  generations += 1;
  if (failGeneration) return new Response("{}", { status: 503 });
  const model = createEngineeringValidationModel();
  if (failContract) model.entities.find((entity) => entity.properties.some((property) => property.key === "formula")).properties.find((property) => property.key === "formula").value = "unsupported_rule";
  model.evidence = model.evidence.map((item) => ({ ...item, artifactId }));
  return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(model) }] } }] }), { status: 200 });
} } });
const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Validation Engineer", email: "validation@example.test", password: "Engineering validation passphrase 42" } });
assert.equal(registration.statusCode, 201, registration.body);
const session = registration.json();
const cookie = registration.headers["set-cookie"].split(";")[0];
const headers = { cookie, "x-csrf-token": session.csrfToken };
const request = async (method, url, payload) => {
  const response = await app.inject({ method, url, payload, headers });
  assert.ok(response.statusCode < 400, `${url}: ${response.body}`);
  return response.statusCode === 204 ? undefined : response.json();
};
const initial = await request("GET", "/api/projects");
assert.equal(initial.projects.length, 1);
const projectId = initial.projects[0].id;
let project = (await request("GET", `/api/projects/${projectId}`)).project;
project.context.assignments = [{ memberId: session.user.memberId, roleId: "captain", sectorId: "" }];
project.context.configured = true;
const artifact = (await request("POST", "/api/artifacts", { kind: "document", label: "Validation memory", description: "Explicit test fixture", url: `data:text/plain;base64,${Buffer.from(validationMemoryText).toString("base64")}`, scope: "project", ownerId: projectId, tags: [], fileName: "validation.txt", mimeType: "text/plain", size: Buffer.byteLength(validationMemoryText) })).artifact;
artifactId = artifact.id;
project.context.projectArtifactIds = [artifact.id];
for (let index = 1; index <= 4; index++) {
  const extra = (await request("POST", "/api/artifacts", { kind: "document", label: `Synthetic attachment ${index}`, description: "Browser layout fixture", url: `data:text/plain;base64,${Buffer.from(`Synthetic attachment ${index}. No engineering quantities.`).toString("base64")}`, scope: "project", ownerId: projectId, tags: [], fileName: `fixture-${index}.txt`, mimeType: "text/plain", size: Buffer.byteLength(`Synthetic attachment ${index}. No engineering quantities.`) })).artifact;
  project.context.projectArtifactIds.push(extra.id);
}

await request("PUT", `/api/projects/${projectId}`, project);
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...process.env, VITE_DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
const viteReady = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Vite startup timeout")), 15000); vite.stdout.on("data", (chunk) => { if (String(chunk).includes("Local:")) { clearTimeout(timer); resolve(); } }); vite.once("exit", (code) => reject(new Error(`Vite exited ${code}`))); });
const browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const split = cookie.indexOf("=");
await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: new URL(baseUrl).origin }]);
const errors = [];
let failedMemoryReads = 0, memoryReads = 0, projectWrites = 0, deferredWrite = null;
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/api/**", async (route) => {
  const incoming = route.request();
  if (incoming.method() === "PUT" && new URL(incoming.url()).pathname === `/api/projects/${projectId}`) {
    projectWrites++;
    if (deferredWrite) { const pending = deferredWrite; deferredWrite = null; pending.started(); await pending.gate; }
  }
  if (incoming.method() === "GET" && new URL(incoming.url()).pathname === "/api/artifacts") {
    memoryReads++;
    if (failedMemoryReads > 0) {
      failedMemoryReads--;
      await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service temporarily unavailable</html>" });
      return;
    }
  }
  const response = await app.inject({ method: incoming.method(), url: new URL(incoming.url()).pathname + new URL(incoming.url()).search, headers: { ...await incoming.allHeaders(), host: `127.0.0.1:${port}` }, ...(incoming.postData() ? { payload: incoming.postData() } : {}) });
  const outputHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !["content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)).map(([name, value]) => [name, String(value)]));
  await route.fulfill({ status: response.statusCode, headers: outputHeaders, body: response.body });
});
const node = (id) => page.locator(`[data-entity-id="${id}"]`);
const closeDialog = () => page.getByRole("dialog").getByRole("button", { name: /^(Fechar|Close)$/u }).click();
const waitSaved = () => page.waitForTimeout(450);
const results = [];
try {
  await viteReady;
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".home-action-card.accent-create").waitFor();
  console.log("Browser: authenticated home loaded");
  assert.ok(await page.locator(".home-action-card.accent-create").isEnabled());
  await page.locator(".mission-sidebar-toggle").click();
  assert.equal(await page.locator(".mission-context-switcher select").count(), 1);
  assert.equal(await page.locator(".mission-project-team strong").innerText(), "Norte Validation Team");
  assert.ok(await page.locator(".mission-phase").nth(1).isDisabled());
  await page.locator(".home-action-card.accent-team").click();
  const createTeam = page.locator(".teams-hub-heading > button");
  assert.ok(await createTeam.isEnabled());
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".home-action-card.accent-open").click();
  failedMemoryReads = Number.POSITIVE_INFINITY;
  await page.locator(".home-project-open").click();
  await page.locator(".pm-memory-error").waitFor();
  assert.ok(await page.locator(".pm-open-conception").isDisabled());
  assert.equal(await page.locator(".pm-readiness").innerText(), "Aguardando carregar a memória");
  assert.ok((await page.locator(".pm-memory-error").innerText()).includes("HTTP 503"));
  const beforeRetry = memoryReads;
  failedMemoryReads = 1;
  await page.locator(".pm-memory-error button").click();
  await page.waitForFunction(() => document.querySelector(".pm-open-conception")?.disabled === false);
  assert.equal(memoryReads - beforeRetry, 2);
  assert.equal(await page.locator(".pm-memory-error").count(), 0);
  assert.equal(await page.locator(".pm-readiness").innerText(), "");
  assert.equal(await page.locator(".pm-heading h1").innerText(), "MEMÓRIA DO PROJETO");
  assert.equal(await page.locator(".pm-heading > div > span, .pm-heading > div > p").count(), 0);
  assert.equal(await page.locator(".pm-artifact-band").count(), 1);
  assert.equal(await page.locator(".pm-artifact-grid .pm-artifact-card").count(), 5);
  assert.ok(await page.locator(".pm-artifact-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length <= 4));
  assert.ok(await page.locator(".pm-artifact-grid").evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
  await page.getByRole("button", { name: "EN", exact: true }).click();
  assert.equal(await page.locator(".pm-heading h1").innerText(), "PROJECT MEMORY");
  for (const text of ["Essential memory is ready.", "The mission's essential context", "Associate a team and choose", "Repositories and documents created specifically", "TEAM ARTIFACTS"]) assert.ok(!(await page.locator(".pm-workspace").innerText()).includes(text));
  await page.screenshot({ path: "/tmp/norte-memory-simplified.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".pm-artifact-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
  await page.locator(".pm-artifact-card").last().scrollIntoViewIfNeeded();
  assert.ok(await page.locator(".pm-artifact-grid").evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: "/tmp/norte-memory-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".pm-empty-program").click();
  await page.locator('.pm-program-picker [role="radio"]').nth(1).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".pm-program-toast").waitFor();
  assert.equal(await page.locator(".pm-feedback").count(), 0);
  assert.equal(await page.locator(".pm-program-toast").evaluate((element) => getComputedStyle(element).position), "fixed");
  const programLabel = await page.locator(".pm-program-card .pm-card-label").boundingBox();
  const programContent = await page.locator(".pm-program-copy").boundingBox();
  assert.ok(programContent.y - (programLabel.y + programLabel.height) >= 14);
  // Permission labels add a line while preserving compact, readable cards.
  assert.ok((await page.locator(".pm-artifact-card").first().boundingBox()).height <= 160);
  await page.screenshot({ path: "/tmp/norte-memory-obsat-toast.png", fullPage: true });
  await page.locator(".pm-program-toast").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "PT", exact: true }).click();
  await page.locator(".pm-open-conception").click();
  await page.locator(".pm-feedback").waitFor();
  assert.ok((await page.locator(".pm-feedback").innerText()).includes("temporariamente indisponível"));
  assert.equal((await request("GET", `/api/projects/${projectId}`)).project.engineeringSystem, undefined);
  assert.ok(page.url().includes("study-setup"));
  failGeneration = false;
  failContract = true;
  await page.locator(".pm-open-conception").click();
  await page.locator(".pm-feedback").waitFor();
  assert.ok((await page.locator(".pm-feedback").innerText()).includes("dependências dos cálculos"));
  assert.equal((await request("GET", `/api/projects/${projectId}`)).project.engineeringSystem, undefined);
  failContract = false;
  await page.locator(".pm-open-conception").click();
  await page.locator(".engineering-graph").waitFor();
  // Two transient attempts, two contract attempts (existing service policy),
  // then one successful generation. The API client never retries this POST.
  assert.equal(generations, 5);
  assert.equal(await page.getByRole("tab").count(), 0);
  assert.equal(await page.getByRole("button", { name: /Gerar arquitetura|Generate initial/u }).count(), 0);
  const baseline = (await request("GET", `/api/projects/${projectId}`)).project;
  assert.ok(baseline.engineeringSystem);
  assert.equal(baseline.phaseProgress.highestUnlockedStep, 1);
  assert.equal(await page.locator(".engineering-node").count(), 6);
  assert.equal(await page.locator('[data-entity-id^="REQ-"]').count(), 0);
  await page.locator(".mission-phase").first().click();
  await page.locator(".pm-workspace").waitFor();
  assert.equal(await page.locator(".mission-phase").nth(1).isDisabled(), false);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".mission-phase").nth(1).isDisabled(), false);
  await page.locator(".mission-phase").nth(1).click();
  await page.locator(".engineering-graph").waitFor();
  assert.equal(generations, 5);
  await page.locator(".mission-sidebar-toggle").click();
  await page.waitForTimeout(220);
  await page.screenshot({ path: "/tmp/norte-system-macro.png", fullPage: true });
  assert.equal(await page.locator(".engineering-requirements-panel").count(), 0);
  // Scoped to the page: "Requisitos" is also a project area in the sidebar.
  for (const name of ["Requisitos", "Revisar documentos", "E se…", "Relações do elemento"]) assert.equal(await page.locator(".app-page").getByRole("button", { name, exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Buscar elemento").count(), 0);
  assert.equal(await page.locator(".mission-phase").count(), 6);
  // Areas are reachable from the start; only Operations is still to come.
  for (let phase = 2; phase < 5; phase++) assert.equal(await page.locator(".mission-phase").nth(phase).isDisabled(), false);
  assert.ok(await page.locator(".mission-phase").nth(5).isDisabled());
  await node("communication").locator(".engineering-node-expand").click();
  await node("radio").waitFor();
  assert.equal(await node("communication").locator(".engineering-node-expand").getAttribute("aria-expanded"), "true");
  assert.equal(await node("power").count(), 1); // Sibling stays on the same canvas.
  assert.ok((await node("payload-system").getAttribute("class")).includes("dimmed"));
  await page.screenshot({ path: "/tmp/norte-system-expanded.png", fullPage: true });
  await node("communication").locator(".engineering-node-expand").click();
  assert.equal(await node("radio").count(), 0);
  await page.getByRole("button", { name: "Expandir tudo", exact: true }).click();
  assert.equal(await page.locator(".engineering-node").count(), baseline.engineeringSystem.entities.length);
  await page.getByRole("button", { name: "Recolher tudo", exact: true }).click();
  assert.equal(await page.locator(".engineering-node").count(), 1);
  await page.locator(".engineering-node-expand").click();
  const draggable = node("communication");
  const originalPosition = await draggable.evaluate((element) => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
  const dragBy = async (dx, dy) => {
    const bounds = await draggable.locator(".engineering-node-main").boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 25);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + 25 + dy, { steps: 8 });
    await page.mouse.up();
  };
  // Reading the map must never rearrange it.
  await dragBy(50, 30);
  assert.deepEqual(await draggable.evaluate((element) => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) })), originalPosition);
  assert.equal((await request("GET", `/api/projects/${projectId}`)).project.navigation.systemLayouts?.architecture, undefined);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  assert.equal(await page.locator(".engineering-edit-hint").count(), 1);
  await dragBy(50, 30);
  await waitSaved();
  const moved = (await request("GET", `/api/projects/${projectId}`)).project;
  const savedPosition = moved.navigation.systemLayouts.architecture.communication;
  assert.ok(savedPosition.x > originalPosition.x + 40);
  assert.deepEqual(moved.engineeringSystem, baseline.engineeringSystem);
  assert.equal(moved.memoryRevision, baseline.memoryRevision);
  await page.reload({ waitUntil: "networkidle" });
  await draggable.waitFor();
  assert.ok(Math.abs(await draggable.evaluate((element) => parseFloat(element.style.left)) - savedPosition.x) < .01);
  assert.equal(await page.locator(".engineering-edit-hint").count(), 0, "edit mode must not survive a reload");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("button", { name: "Concluir edição", exact: true }).click();
  assert.equal(await page.locator(".engineering-edit-hint").count(), 0);
  const communicationToggle = page.getByRole("button", { name: "Expandir ou recolher Communication", exact: true });
  await communicationToggle.click();
  await node("radio").waitFor();
  assert.equal(await node("communication").locator(".engineering-node-expand").getAttribute("aria-expanded"), "true");
  await communicationToggle.click();
  assert.equal(await node("radio").count(), 0);
  await node("communication").locator(".engineering-node-expand").click();
  assert.equal(await communicationToggle.getAttribute("aria-expanded"), "true");
  await page.locator('.engineering-tree-row button[title="Radio R1"]').click();
  await node("radio").waitFor();
  assert.ok((await node("radio").getAttribute("class")).includes("selected"));
  await node("radio").locator(".engineering-node-info").click();
  await page.getByRole("dialog").locator(".engineering-evidence summary").first().click();
  assert.ok((await page.getByRole("dialog").innerText()).includes("400 mA"));
  await closeDialog();
  await page.getByRole("button", { name: "Recolher hierarquia", exact: true }).click();
  assert.equal(await page.locator(".engineering-explorer").count(), 0);
  await page.getByRole("button", { name: "Expandir hierarquia", exact: true }).click();
  assert.equal(await page.locator(".engineering-explorer").count(), 1);
  // Rename and immediately navigate; ensure the latest name survives API persistence and reload.
  await page.getByRole("button", { name: /Fase anterior/u }).click();
  let releaseWrite;
  const gate = new Promise((resolve) => { releaseWrite = resolve; });
  const started = new Promise((resolve) => { deferredWrite = { gate, started: resolve }; });
  await page.locator("#project-memory-name").fill("Earlier pending name");
  await started;
  const writesBeforeNavigation = projectWrites;
  await page.locator("#project-memory-name").fill("Quetzal-1 · revised mission");
  await page.locator(".pm-open-conception").click();
  await page.waitForTimeout(100);
  assert.equal(projectWrites, writesBeforeNavigation, "The new save waits for the earlier in-flight autosave");
  releaseWrite();
  await page.locator(".engineering-model-title strong").waitFor();
  assert.equal(await page.locator(".engineering-model-title strong").innerText(), "Quetzal-1 · revised mission");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".engineering-model-title strong").innerText(), "Quetzal-1 · revised mission");
  assert.equal((await request("GET", `/api/projects/${projectId}`)).project.name, "Quetzal-1 · revised mission");
  assert.equal(generations, 5);
  assert.deepEqual((await request("GET", `/api/projects/${projectId}`)).project.engineeringSystem, baseline.engineeringSystem);
  await page.locator(".explore-impact-action").click();
  await page.locator(".discovery-panel .lab-canvas").waitFor();
  for (const removed of ["Arrumar mapa", "Estruturar missão", "Organização automática"]) assert.equal(await page.getByRole("button", { name: removed, exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Testar alteração", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Elementos do sistema", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Nova ideia", exact: true }).first().click();
  // A writer types everyday words; the composer offers the names the architecture carries.
  await page.locator(".lab-composer textarea").fill("radio mais forte");
  await page.locator(".discovery-completions button").first().waitFor();
  assert.ok((await page.locator(".discovery-completions").innerText()).includes("Radio R1"), await page.locator(".discovery-completions").innerText());
  await page.screenshot({ path: "/tmp/norte-discovery-completions.png", fullPage: true });
  await page.locator(".discovery-completions button").filter({ hasText: "Radio R1" }).first().click();
  assert.equal(await page.locator(".lab-composer textarea").inputValue(), "Radio R1 mais forte");
  await page.locator(".lab-composer textarea").fill("Payload 280 g");
  await page.locator(".lab-composer textarea").press("Enter");
  await page.locator(".lab-composer textarea").press("Escape");
  await page.locator(".discovery-interpretation.resolved").waitFor();
  assert.equal(interpretations, 1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.screenshot({ path: "/tmp/norte-discovery-interpreted.png", fullPage: true });
  await page.locator(".lab-node").getByRole("button", { name: "Testar ideia" }).click();
  await page.locator(".discovery-suggestion").first().waitFor();
  const suggestions = await page.locator(".discovery-suggestion").allInnerTexts();
  assert.ok(suggestions.length > 1, `expected an impact flow, got ${suggestions.length}`);
  assert.ok(suggestions.some((block) => block.includes("Payload")), suggestions.join(" | "));
  assert.equal(await page.locator(".discovery-suggestion.status-changed").count(), 1);
  assert.equal(await page.locator(".discovery-suggestion.status-critical").count(), 1);
  await page.screenshot({ path: "/tmp/norte-discovery-suggestions.png", fullPage: true });
  await page.getByRole("button", { name: "Abrir mapa completo", exact: true }).click();
  await page.locator(".engineering-scenario").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.ok((await node("payload").innerText()).includes("280"));
  assert.equal(await node("radio").count(), 0);
  assert.ok((await page.locator(".engineering-requirement-impact").innerText()).includes("Conflito"));
  await page.screenshot({ path: "/tmp/norte-discovery-impact.png", fullPage: true });
  await page.getByRole("button", { name: "Salvar cenário", exact: true }).click();
  await page.getByRole("button", { name: "Limpar análise" }).click();
  await page.getByRole("button", { name: "Descartar sugestões", exact: true }).click();
  assert.equal(await page.locator(".discovery-suggestion").count(), 0);
  assert.equal(await page.locator(".lab-node").count(), 1);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  assert.equal(await page.locator(".lab-node").count(), 0);
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  assert.equal(await page.locator(".lab-node").count(), 1);
  await page.getByRole("button", { name: "Nova ideia", exact: true }).first().click();
  await page.locator(".lab-composer textarea").fill("Payload mais leve, 280 g");
  await page.locator(".lab-composer textarea").press("Enter");
  await page.locator(".lab-composer textarea").press("Escape");
  await page.locator(".discovery-interpretation.confirmation").waitFor();
  assert.ok((await page.locator(".lab-node").last().innerText()).includes("Você quer aplicar essa massa ao Payload?"));
  await page.locator(".lab-node").last().getByRole("button", { name: "Sim, testar ideia", exact: true }).click();
  await page.locator(".discovery-suggestion").first().waitFor();
  await page.screenshot({ path: "/tmp/norte-discovery-confirmation.png", fullPage: true });
  // Accepting is the only step that writes: the architecture must actually carry the value afterwards.
  assert.ok((await node("payload").innerText({ timeout: 2000 }).catch(() => "")) === "");
  await page.getByRole("button", { name: "Aplicar ao sistema", exact: true }).click();
  assert.equal(await page.locator(".discovery-suggestion").count(), 0);
  await page.getByRole("button", { name: "Expandir tudo", exact: true }).click();
  await node("payload").waitFor();
  assert.ok((await node("payload").innerText()).includes("280"), await node("payload").innerText());
  await page.screenshot({ path: "/tmp/norte-discovery-applied.png", fullPage: true });
  await page.locator(".lab-node").last().locator(".discovery-node-text").click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("button", { name: "Nova ideia", exact: true }).first().click();
  await page.locator(".lab-composer textarea").fill("Investigar uma alternativa");
  await page.locator(".lab-composer textarea").press("Enter");
  await page.locator(".lab-composer textarea").press("Escape");
  await page.locator(".discovery-interpretation.clarification").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.ok((await page.locator(".lab-node").last().innerText()).includes("O que mudaria"));
  await page.locator(".lab-node").last().getByRole("button", { name: "Completar ideia", exact: true }).click();
  await page.locator(".lab-composer textarea").waitFor();
  assert.equal(await page.locator(".lab-composer textarea").inputValue(), "");
  assert.ok((await page.locator(".discovery-clarification-context").innerText()).includes("Investigar uma alternativa"));
  const clarificationAnswer = `Avaliar o rádio em outra condição. ${"Preservar as premissas e medições antes de alterar parâmetros. ".repeat(8)}`;
  await page.locator(".lab-composer textarea").fill(clarificationAnswer);
  await page.locator(".lab-composer textarea").press("Enter");
  await page.locator(".lab-composer").waitFor({ state: "hidden" });
  await page.locator(".lab-node").last().locator(".discovery-interpretation.clarification").waitFor();
  assert.equal(lastDiscoveryContext.hypothesis, `Investigar uma alternativa\n${clarificationAnswer.trim()}`);
  assert.equal(lastDiscoveryContext.clarifications[0].answer, clarificationAnswer.trim());
  await waitSaved();
  const savedHypothesis = (await request("GET", `/api/workspace/labs/${projectId}`)).board.nodes.at(-1);
  assert.ok(savedHypothesis.text.length <= 220);
  assert.equal(savedHypothesis.description, lastDiscoveryContext.hypothesis);
  assert.equal(savedHypothesis.clarifications[0].answer, clarificationAnswer.trim());
  await page.locator(".lab-node").last().getByRole("button", { name: "Ler hipótese completa", exact: true }).click();
  assert.equal(await page.locator(".lab-composer textarea").inputValue(), savedHypothesis.description);
  await page.locator(".lab-composer textarea").press("Escape");
  await page.locator(".lab-node").last().locator(".discovery-node-text").click();
  await page.getByRole("button", { name: "Duplicar", exact: true }).click();
  assert.equal(await page.locator(".lab-node").count(), 3);
  await waitSaved();
  assert.equal((await request("GET", `/api/workspace/labs/${projectId}`)).board.nodes.at(-1).description, savedHypothesis.description);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  assert.equal(await page.locator(".lab-node").count(), 2);
  await page.locator(".lab-node").first().locator(".discovery-node-text").click();
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await page.locator(".lab-node").last().locator(".discovery-node-text").click();
  await waitSaved();
  assert.equal((await request("GET", `/api/workspace/labs/${projectId}`)).board.links.length, 1);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  assert.equal(await page.locator(".lab-node").count(), 1);
  await waitSaved();
  assert.equal((await request("GET", `/api/workspace/labs/${projectId}`)).board.links.length, 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".lab-node").waitFor();
  assert.equal(generations, 5);
  // Conception hands straight to Requirements, in the rail's own order.
  const nextPhase = page.getByRole("button", { name: /Próxima fase/u });
  assert.equal(await nextPhase.isDisabled(), false);
  assert.ok((await nextPhase.innerText()).includes("Requisitos"), await nextPhase.innerText());
  assert.ok((await page.getByRole("button", { name: /Fase anterior/u }).innerText()).includes("Memória do projeto"));
  await waitSaved();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".engineering-graph").waitFor();
  assert.ok(await page.locator(".mission-phase").nth(5).isDisabled());

  // Areas are reachable in any order and each keeps the project's own data.
  await page.locator(".mission-sidebar-toggle").click();
  assert.equal(await page.locator(".mission-area").count(), 0);
  assert.equal(await page.locator(".mission-phase").count(), 6);
  assert.ok(await page.locator(".mission-phase").nth(5).isDisabled(), "Operations stays locked");
  const rail = page.locator(".mission-phase");
  for (const [index, heading, previous, next] of [[2, "REQUISITOS", "Concepção", "Software"], [3, "SOFTWARE", "Requisitos", "Verificação"], [4, "VERIFICAÇÃO", "Software", "Operações"]]) {
    await rail.nth(index).click();
    assert.equal(await page.locator(".project-head h1").innerText(), heading);
    assert.ok((await page.getByRole("button", { name: /Fase anterior/u }).innerText()).includes(previous), heading);
    assert.ok((await page.getByRole("button", { name: /Próxima fase/u }).innerText()).includes(next), heading);
    assert.equal(await page.locator(".explore-impact-action").count(), 1);
  }
  // Only the last stop is still to come, so only it is offered as locked.
  assert.ok(await page.getByRole("button", { name: /Próxima fase/u }).isDisabled());
  await page.getByRole("button", { name: /Fase anterior/u }).click();
  assert.equal(await page.locator(".project-head h1").innerText(), "SOFTWARE");
  await rail.nth(2).click();
  // System requirements and the reference programme's own rules share one list.
  const rows = () => page.locator(".requirement-table tbody tr");
  assert.ok(await rows().count() > 2, `expected system and programme rows, got ${await rows().count()}`);
  assert.ok((await page.locator(".requirement-table").innerText()).includes("Total mass"));
  assert.ok((await page.locator(".requirement-table").innerText()).includes("OBSAT"), await page.locator(".requirement-table").innerText());
  await page.screenshot({ path: "/tmp/norte-area-requirements.png", fullPage: true });
  const total = await rows().count();
  await page.locator(".requirement-filters select").first().selectOption("Structure");
  assert.ok(await rows().count() < total, "the subsystem filter changed nothing");
  assert.equal(await page.locator(".requirement-table tbody tr .requirement-tag").first().innerText(), "Structure");
  await page.locator(".requirement-search input").fill("nada disso existe");
  assert.equal(await page.locator(".requirement-empty").count(), 1);
  await page.locator(".requirement-clear").click();
  assert.equal(await rows().count(), total);
  await rail.nth(4).click();
  // A change explored and saved earlier marks the verification that depended on it.
  assert.equal(await page.locator(".requirement-table tbody tr.changed").count(), 1);
  assert.ok((await page.locator(".requirement-table tbody tr.changed").innerText()).includes("Total mass"), await page.locator(".requirement-table tbody tr.changed").innerText());
  await page.locator(".requirement-filters select").last().selectOption("review");
  assert.equal(await page.locator(".requirement-table tbody tr").count(), 1);
  await page.locator(".requirement-clear").click();
  await page.screenshot({ path: "/tmp/norte-area-verification.png", fullPage: true });
  await rail.nth(3).click();
  assert.ok(await page.locator(".area-repo-action").isDisabled());
  // Apps are named after real parts of this project; the core panel is always there.
  assert.ok(await page.locator(".software-app").count() >= 3, `apps: ${await page.locator(".software-app").count()}`);
  assert.equal(await page.locator(".software-service").count(), 5);
  const power = page.locator(".software-app").filter({ hasText: "EPS" });
  await power.click();
  assert.ok((await page.locator(".software-inspector").innerText()).includes("Battery"), await page.locator(".software-inspector").innerText());
  // The canvas only moves in edit mode, and a move is kept.
  const before = await power.evaluate((element) => element.style.left);
  const box = await power.boundingBox();
  const drag = async () => { await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 }); await page.mouse.up(); };
  await drag();
  assert.equal(await power.evaluate((element) => element.style.left), before);
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await drag();
  assert.notEqual(await power.evaluate((element) => element.style.left), before);
  await waitSaved();
  assert.ok((await request("GET", `/api/projects/${projectId}`)).project.navigation.systemLayouts.software.eps);
  // Nothing may escape the panel it belongs to.
  const escaped = await page.evaluate(() => {
    const frame = document.querySelector(".software-apps").getBoundingClientRect();
    return [...document.querySelectorAll(".software-app")].some((app) => {
      const box = app.getBoundingClientRect();
      return box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < frame.top - 1 || box.bottom > frame.bottom + 1;
    });
  });
  assert.equal(escaped, false, "a software block escaped its panel");
  await page.getByRole("button", { name: "Concluir edição", exact: true }).click();
  await page.screenshot({ path: "/tmp/norte-area-software.png", fullPage: true });

  // Discovery follows the user onto any page, resizes and closes without losing the board.
  if (!(await page.locator(".discovery-panel").count())) await page.locator(".explore-impact-action").click();
  await page.locator(".discovery-panel .lab-node").first().waitFor();
  const startWidth = (await page.locator(".discovery-panel").boundingBox()).width;
  await page.locator(".discovery-panel-grip").focus();
  await page.locator(".discovery-panel-grip").press("ArrowLeft");
  const widened = (await page.locator(".discovery-panel").boundingBox()).width;
  assert.ok(widened > startWidth, `${startWidth} -> ${widened}`);
  assert.ok((await page.locator(".discovery-panel-context").innerText()).includes("Software"));
  // The page must give way to the panel, not hide underneath it.
  // The page yields to the panel through a transition; measure once it settles.
  await page.waitForFunction(() => {
    const shell = document.querySelector(".app-page"), panel = document.querySelector(".discovery-panel");
    return shell && panel && Math.abs(parseFloat(getComputedStyle(shell).paddingRight) - panel.getBoundingClientRect().width) < 1;
  });
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector(".discovery-panel").getBoundingClientRect().left;
    return Math.max(...[...document.querySelectorAll(".software-panel")].map((card) => card.getBoundingClientRect().right)) - panel;
  });
  assert.ok(overflow <= 1, `a card runs ${overflow}px past the panel edge`);
  await page.screenshot({ path: "/tmp/norte-discovery-panel.png" });
  await page.getByRole("button", { name: /Fechar Testar ideias/u }).click();
  assert.equal(await page.locator(".discovery-panel").count(), 0);
  await page.locator(".explore-impact-action").click();
  assert.equal(await page.locator(".discovery-panel .lab-node").count(), 1);
  await page.getByRole("button", { name: /Fechar Testar ideias/u }).click();
  // The tool is offered on every project page, the Conception Room included.
  await page.locator(".mission-phase").nth(1).click();
  await page.locator(".engineering-graph").waitFor();
  assert.equal(await page.locator(".explore-impact-action").count(), 1);
  await page.locator(".mission-sidebar-toggle").click();
  // Each selected project brings its own progress, team and workspace.
  const secondTeam = (await request("POST", "/api/teams", { name: "Independent test team", description: "Temporary acceptance fixture" })).team;
  const secondProject = { ...project, id: "independent-browser-project", name: "Independent project", phaseProgress: { highestUnlockedStep: 0 }, navigation: { lastRoute: "setup" }, context: { ...project.context, teamId: secondTeam.id, teamName: secondTeam.name, projectArtifactIds: [] } };
  await request("POST", "/api/projects", secondProject);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".mission-sidebar-toggle").click();
  await page.locator(".mission-context-switcher select").selectOption(secondProject.id);
  await page.locator(".pm-workspace").waitFor();
  assert.ok(await page.locator(".mission-phase").nth(1).isDisabled());
  assert.equal(await page.locator(".mission-project-team strong").innerText(), secondTeam.name);
  await page.locator(".mission-context-switcher select").selectOption(projectId);
  await page.locator(".engineering-graph").waitFor();
  // The current phase is aria-disabled because it is already selected, but remains unlocked.
  assert.equal(await page.locator(".mission-phase").nth(1).getAttribute("disabled"), null);
  assert.equal(await page.locator(".mission-phase").nth(1).getAttribute("aria-current"), "step");
  assert.equal(await page.locator(".mission-project-team strong").innerText(), "Norte Validation Team");
  await page.locator(".mission-sidebar-toggle").click();
  assert.equal(await page.getByRole("tab").count(), 0);
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.locator(".engineering-graph").waitFor();
    assert.ok(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1), `Horizontal overflow at ${width}`);
    await page.screenshot({ path: `/tmp/norte-system-${width}.png`, fullPage: true });
    results.push({ width, height, overflow: false });
  }
  // Replay real, source-verified extractions onto this isolated synthetic baseline.
  // The marker is test setup only; no user's database or production account is read.
  await waitSaved();
  await app.missionStore.update((data) => {
    data.artifacts.find((item) => item.id === artifactId).provenance = { sourceId: "quetzal-eps-hardware-readme" };
  });
  const beforeExtension = await request("GET", `/api/projects/${projectId}`);
  assert.equal((await attachQuetzalArchitectureSources(app.missionStore)).added, 4);
  const staleSave = await app.inject({ method: "PUT", url: `/api/projects/${projectId}`, headers, payload: beforeExtension.project });
  assert.equal(staleSave.statusCode, 409);
  assert.equal(staleSave.json().error, "PROJECT_UPDATED");
  const expandedProject = (await request("GET", `/api/projects/${projectId}`)).project;
  assert.equal(expandedProject.context.programId, beforeExtension.project.context.programId);
  await page.setViewportSize({ width: 1844, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".engineering-graph").waitFor();
  await page.waitForFunction((count) => document.querySelector(".engineering-model-title small")?.textContent?.endsWith(`/ ${count}`), expandedProject.engineeringSystem.entities.length);
  for (const name of ["ADCS", "Antenna Deployment Mechanism", "On-Board Computer", "Payload", "Structure"]) {
    const entity = expandedProject.engineeringSystem.entities.find((item) => item.name === name);
    assert.ok(entity, name);
    // Existing branches retain their parent; newly added top-level blocks appear now.
    if (["ADCS", "Antenna Deployment Mechanism", "On-Board Computer"].includes(name)) assert.equal(await node(entity.id).count(), 1, `${name} visible in the overview`);
  }
  await page.getByRole("button", { name: "Enquadrar sistema", exact: true }).click();
  await page.screenshot({ path: "/tmp/norte-quetzal-whole-overview.png", fullPage: true });
  await page.getByRole("button", { name: "Expandir tudo", exact: true }).click();
  assert.equal(await page.locator(".engineering-node").count(), expandedProject.engineeringSystem.entities.length);
  await page.getByRole("button", { name: "Enquadrar sistema", exact: true }).click();
  await page.screenshot({ path: "/tmp/norte-quetzal-whole-expanded.png", fullPage: true });
  await page.getByRole("button", { name: /Fase anterior/u }).click();
  await page.locator(".pm-artifact-card").last().waitFor();
  assert.equal(await page.locator(".pm-artifact-card").count(), 9);
  // Artifacts scroll inside their own band, in the project's scrollbar colours.
  await page.setViewportSize({ width: 1440, height: 900 });
  const artifactScroll = await page.locator(".pm-artifact-grid").evaluate((grid) => ({
    scrolls: grid.scrollHeight > grid.clientHeight + 1,
    thumb: getComputedStyle(grid).getPropertyValue("--scroll-thumb").trim(),
    firefox: getComputedStyle(grid).scrollbarColor
  }));
  assert.ok(artifactScroll.scrolls, "the artifacts band should scroll on its own");
  assert.equal(artifactScroll.thumb, "#2f6389");
  assert.ok(/2f6389|47, 99, 137/u.test(artifactScroll.firefox), artifactScroll.firefox);
  // Memory contains organization only; ideas are available in technical areas.
  // The tool lives in the navigation, so nothing floats over the page content.
  assert.equal(await page.locator(".discovery-launcher").count(), 0);
  assert.equal(await page.locator(".explore-impact-action").count(), 0);
  await page.locator(".pm-workspace").evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await page.screenshot({ path: "/tmp/norte-memory-artifacts-scroll.png" });
  for (const source of ["ADCS hardware", "ADM hardware", "ADCS software", "MISSION overview"]) assert.equal(await page.locator(".pm-artifact-card").filter({ hasText: source }).count(), 1);
  await page.screenshot({ path: "/tmp/norte-quetzal-whole-memory.png", fullPage: true });
  // Flush pending navigation writes before testing deletion. Missing projects are never recreated by autosave.
  await waitSaved();
  await request("DELETE", `/api/projects/${projectId}`);
  await request("DELETE", "/api/projects/independent-browser-project");
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".home-action-card.accent-open").click();
  assert.ok(await page.locator(".home-project-dialog-empty button").isEnabled());
  await page.locator(".home-project-dialog-empty button").click();
  await page.locator(".project-create").waitFor();
  assert.equal(await page.locator(".pm-workspace").count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, generations, checks: ["persistent phases and upcoming phases", "automatic initialization and recovery", "inline expansion without drilldown", "selection dims unrelated branches", "persistent node dragging", "hierarchy edge toggle", "removed System controls", "rename immediately opens and survives reload", "automatic AI interpretation and inline clarification", "contextual details and provenance", "project-specific progress and team switching", "Discovery mass conflict", "undo redo persistence", "two accessible conception tabs", "folder-based artifact library", "responsive"], viewports: results }, null, 2));
} catch (error) { await page.screenshot({ path: "/tmp/norte-browser-failure.png", fullPage: true }).catch(() => undefined); throw error; }
finally { await browser.close(); await app.close(); vite.kill("SIGTERM"); await rm(directory, { recursive: true, force: true }); }
