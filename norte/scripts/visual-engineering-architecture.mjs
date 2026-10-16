/* global window, document, getComputedStyle */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { buildApp } from "../server/app.mjs";
import { createQuetzalDesignModel } from "../benchmark/quetzal1/context/design-context.mjs";

// Real isolated API + real UI, with a saved architecture fixture. No provider calls.
const directory = await mkdtemp(join(tmpdir(), "norte-architecture-"));
const app = await buildApp({ storeFile: join(directory, "state.json"), logger: false, systemAi: { apiKey: "" } });
const port = Number(process.env.NORTE_ARCHITECTURE_VISUAL_PORT || 5316), origin = `http://127.0.0.1:${port}`;
let vite, browser, page;
const errors = [];
try {
  const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { name: "Architecture Engineer", nickname: "architecture_engineer", email: "architecture@example.test", password: "isolated architecture browser validation 2026" } });
  assert.equal(registration.statusCode, 201, registration.body);
  const cookieHeader = registration.headers["set-cookie"], cookie = (Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader]).find(value => value.startsWith("norte_session=")).split(";")[0];
  const headers = { cookie, "x-csrf-token": registration.json().csrfToken };
  const projectId = (await app.inject({ method: "GET", url: "/api/projects", headers })).json().projects[0].id;
  const original = (await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers })).json().project;
  let model; try { if (process.env.NORTE_ARCHITECTURE_VISUAL_FIXTURE === "builtin") throw new Error("Use public fixture"); model = JSON.parse(await readFile("../.runtime/validation/quetzal-architecture-cleanup/proposed.json", "utf8")); } catch { model = createQuetzalDesignModel(); }
  const powerSubsystem = model.entities.find(entity => entity.kind === "subsystem" && /EPS|Electrical Power/u.test(entity.name));
  assert(powerSubsystem, "Fixture must contain an EPS subsystem");
  const searchComponent = model.entities.find(entity => entity.kind === "component" && entity.parentId === powerSubsystem.id);
  assert(searchComponent, "Fixture must contain a component inside EPS");
  await app.missionStore.update(data => { data.workspace.projects[projectId].document = { ...original, name: "Quetzal-1", context: { ...original.context, configured: true }, engineeringSystem: model, navigation: { ...original.navigation, lastRoute: "brainstorm", lastConceptionWorkspace: "system" }, phaseProgress: { highestUnlockedStep: 1 } }; });
  const emptyId = randomUUID(), empty = { ...original, id: emptyId, name: "New engineering project", engineeringSystem: undefined, context: { ...original.context, configured: true }, phaseProgress: { highestUnlockedStep: 1 }, navigation: { ...original.navigation, lastRoute: "brainstorm", lastConceptionWorkspace: "system" } };
  const emptySaved = await app.inject({ method: "POST", url: "/api/projects", headers, payload: empty }); assert.equal(emptySaved.statusCode, 201, emptySaved.body);
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { env: { ...process.env, VITE_DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Vite timeout")), 25000); vite.stdout.on("data", chunk => { if (String(chunk).includes("Local:")) { clearTimeout(timer); resolve(); } }); vite.once("exit", code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)); }); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || "/opt/google/chrome/chrome", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } }); const split = cookie.indexOf("="); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin }]);
  await context.addInitScript(({ projectId }) => { if (!/^https?:$/.test(window.location.protocol)) return; if (!window.localStorage.getItem("norte-active-project-v1")) window.localStorage.setItem("norte-active-project-v1", projectId); window.localStorage.setItem("norte-language", "pt"); }, { projectId });
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    assert(!url.pathname.includes("system-ai") || request.method() === "GET", "Architecture editing must not call an AI provider");
    const response = await app.inject({ method: request.method(), url: url.pathname + url.search, headers: { ...await request.allHeaders(), host: `127.0.0.1:${port}` }, ...(request.postData() ? { payload: request.postData() } : {}) });
    if (response.statusCode >= 400 && !["/api/public/content"].includes(url.pathname)) errors.push(`${request.method()} ${url.pathname}: ${response.statusCode} ${response.body.slice(0, 120)}`);
    await route.fulfill({ status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([name]) => !["content-length", "transfer-encoding", "connection", "set-cookie"].includes(name)).map(([name, value]) => [name, String(value)])), body: response.body });
  });
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/norte/#/brainstorming"); await page.locator(".architecture-block-grid").waitFor();
  assert(await page.locator(".architecture-block").count() >= 2); assert.equal(await page.locator(".architecture-workspace .engineering-world").count(), 0);
  await page.screenshot({ path: "/tmp/norte-architecture-desktop.png", fullPage: true });
  const themeChecks = [];
  for (const theme of ["dark", "light"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: theme === "light" ? "Ativar tema claro" : "Ativar tema escuro", exact: true }).first().click();
    await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
    const palette = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      const tokens = ["bg", "surface", "surface-muted", "surface-raised", "text", "text-secondary", "text-muted", "accent", "on-accent", "link"];
      return Object.fromEntries(tokens.map(token => [token, styles.getPropertyValue(`--norte-${token}`).trim()]));
    });
    const luminance = hex => { const channels = hex.replace("#", "").match(/.{2}/g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
    const contrast = (a, b) => { const values = [luminance(palette[a]), luminance(palette[b])].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
    for (const foreground of ["text", "text-secondary", "text-muted", "link"]) for (const background of ["bg", "surface", "surface-muted", "surface-raised"]) assert(contrast(foreground, background) >= 4.5, `${theme}: ${foreground}/${background} contrast below 4.5`);
    assert(contrast("on-accent", "accent") >= 4.5);
    const background = await page.locator(".architecture-workspace").evaluate(element => getComputedStyle(element).backgroundColor);
    themeChecks.push({ theme, palette, background, textContrast: "AA", buttonBorders: await page.locator(".theme-toggle").first().evaluate(element => getComputedStyle(element).borderColor) });
    await page.screenshot({ path: `/tmp/norte-architecture-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const toggle = page.getByRole("button", { name: theme === "light" ? "Ativar tema escuro" : "Ativar tema claro", exact: true }).first();
    await toggle.focus(); assert.equal(await toggle.evaluate(element => getComputedStyle(element).outlineStyle), "solid");
    await page.screenshot({ path: `/tmp/norte-architecture-${theme}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1680, height: 1050 });
  }
  await page.reload(); await page.locator(".architecture-block-grid").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "Theme survives reload");
  const themePeer = await context.newPage(); await themePeer.goto(origin + "/norte/#/brainstorming"); await themePeer.locator(".architecture-block-grid").waitFor();
  await page.getByRole("button", { name: "Ativar tema escuro", exact: true }).first().click();
  await themePeer.waitForFunction(() => document.documentElement.dataset.theme === "dark"); await themePeer.close();
  await page.getByRole("button", { name: "Ativar tema claro", exact: true }).first().click();
  await writeFile("../.runtime/validation/theme-browser.json", JSON.stringify({ passed: true, checks: themeChecks, persistence: true, tabSynchronization: true, mobileOverflow: false, keyboardFocus: true, providerCalls: 0 }, null, 2), { mode: 0o600 });
  await page.getByRole("tab", { name: /^Interfaces/ }).click(); await page.locator(".architecture-matrix").waitFor();
  await page.locator(".architecture-matrix-connected button").first().click(); assert(await page.locator(".architecture-interface-row").count() > 0);
  await page.locator(".architecture-interface-row").first().click(); await page.getByRole("dialog").waitFor(); assert.match(await page.getByRole("dialog").innerText(), /Fontes|evidências/);
  await page.getByRole("dialog").getByRole("button", { name: "Fechar" }).click();
  await page.screenshot({ path: "/tmp/norte-architecture-interfaces.png", fullPage: true });
  await page.getByRole("tab", { name: "Arquitetura", exact: true }).click();
  await page.getByRole("button", { name: `Abrir subsistema ${powerSubsystem.name}`, exact: true }).click();
  assert((await page.locator(".architecture-breadcrumbs").innerText()).includes(powerSubsystem.name));
  await page.getByRole("searchbox", { name: "Buscar na arquitetura" }).fill(searchComponent.name); assert(await page.locator(".architecture-inventory tbody tr").count() > 0);
  await page.getByRole("searchbox", { name: "Buscar na arquitetura" }).fill(""); await page.screenshot({ path: "/tmp/norte-architecture-components.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator(".architecture-content").evaluate(element => { element.scrollTop = 300; }); await page.screenshot({ path: "/tmp/norte-architecture-mobile.png", fullPage: true }); if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) console.log("OVERFLOW", await page.evaluate(() => [...document.querySelectorAll("body *")].map(element => ({ class: element.className, tag: element.tagName, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, overflow: getComputedStyle(element).overflow })).filter(item => item.right > window.innerWidth + 1 && item.width > 300).slice(0, 20))); assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.getByRole("button", { name: "Adicionar elemento", exact: true }).click(); await page.getByRole("dialog").getByLabel("Nome", { exact: true }).fill("Review-only temperature sensor"); await page.getByRole("dialog").getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByRole("button", { name: "Review-only temperature sensor", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".workspace-save-state.error"));
  await new Promise(resolve => setTimeout(resolve, 1600)); assert(app.missionStore.read().workspace.projects[projectId].document.engineeringSystem.entities.some(item => item.name === "Review-only temperature sensor"));
  await page.goto("about:blank"); const second = await context.newPage(); second.on("pageerror", error => errors.push(error.message)); await second.goto(origin + "/norte/"); await second.evaluate(id => window.localStorage.setItem("norte-active-project-v1", id), emptyId); await second.goto(origin + "/norte/#/brainstorming"); await second.reload();
  await second.getByRole("button", { name: "Criar arquitetura manualmente" }).click(); await second.getByRole("button", { name: "Adicionar elemento", exact: true }).click(); await second.getByRole("dialog").getByLabel("Nome", { exact: true }).fill("Avionics"); await second.getByRole("dialog").getByRole("button", { name: "Adicionar", exact: true }).click();
  await second.getByRole("button", { name: "Abrir subsistema Avionics" }).waitFor(); await second.screenshot({ path: "/tmp/norte-architecture-manual.png", fullPage: true });
  await new Promise(resolve => setTimeout(resolve, 1600)); assert.equal(app.missionStore.read().workspace.projects[emptyId].document.engineeringSystem.entities.length, 2); assert.deepEqual(errors, []);
  await writeFile("../.runtime/validation/engineering-architecture-browser.json", JSON.stringify({ passed: true, fixtureEntities: model.entities.length, checks: ["readable scoped composition", "directional interface matrix", "original relationship evidence", "drill-down and breadcrumbs", "component search", "mobile overflow", "manual component persistence", "architecture creation without documents"], providerCalls: 0 }, null, 2), { mode: 0o600 });
  console.log("PASS: architecture, interfaces, evidence, drill-down, search, mobile, persisted manual component and empty-project creation. No provider calls.");
} catch (error) { if (page) await page.screenshot({ path: "/tmp/norte-architecture-failure.png", fullPage: true }).catch(() => {}); console.error("Browser issues:", errors); throw error; }
finally { await browser?.close(); vite?.kill("SIGTERM"); await app.close(); await rm(directory, { recursive: true, force: true }); }
