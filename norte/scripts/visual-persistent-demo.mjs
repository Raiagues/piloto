/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';

// Real Chromium cookies and UI -> Vite -> Fastify -> isolated persistent JSON.
// The document and built-in mission are explicit fixtures. No LLM is called.
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'norte-demo-browser-'));
const output = resolve(root, '.runtime/validation');
const port = Number(process.env.NORTE_DEMO_VISUAL_PORT || 5299), origin = `http://127.0.0.1:${port}`;
const previousProfile = process.env.NORTE_DEMO_PROFILE, previousOrigins = process.env.NORTE_ALLOWED_ORIGINS;
let app, vite, browser, page;
const pageErrors = [];
const options = { storeFile: join(directory, 'store.json'), logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } };
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => { const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
}
async function openContext(storageState) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(storageState ? { storageState } : {}) });
  await context.addInitScript(() => { if (/^https?:$/.test(window.location.protocol)) window.localStorage.setItem('norte-language', 'pt'); });
  context.on('page', opened => opened.on('pageerror', error => pageErrors.push(error.message)));
  return context;
}
try {
  await mkdir(output, { recursive: true });
  process.env.NORTE_DEMO_PROFILE = 'isolated-browser-fixture'; process.env.NORTE_ALLOWED_ORIGINS = origin;
  app = await buildApp(options); await app.listen({ host: '127.0.0.1', port: 0 });
  const apiPort = app.server.address().port;
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: resolve(root, 'norte'), env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated Vite startup timed out')), 25_000);
    vite.stdout.on('data', bytes => { if (String(bytes).includes('Local:')) { clearTimeout(timer); resolve(); } });
    vite.once('error', error => { clearTimeout(timer); reject(error); });
    vite.once('exit', code => { clearTimeout(timer); reject(new Error('Isolated Vite exited ' + code)); });
  });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  let context = await openContext(); page = await context.newPage();
  await page.goto(origin + '/norte/#/login');
  const opening = page.waitForResponse(response => response.url().endsWith('/api/auth/demo') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Explorar com conta de teste', exact: true }).click();
  const opened = await opening; assert.equal(opened.status(), 201); const actor = await opened.json();
  await page.getByRole('button', { name: 'Visitante Norte', exact: true }).first().waitFor();
  const authHeaders = { 'x-csrf-token': actor.csrfToken };
  const projects = await context.request.get(origin + '/api/projects').then(response => response.json());
  const projectId = projects.projects[0].id;
  const projectResponse = await context.request.get(origin + '/api/projects/' + projectId).then(response => response.json());
  const savedName = projectResponse.project.name;
  const text = 'Documento sintético para validar persistência: a massa nominal do experimento é 1 kg.';
  const uploaded = await context.request.post(origin + '/api/artifacts', { headers: authHeaders, data: { kind: 'document', label: 'Documento sintético preservado', scope: 'project', ownerId: projectId, tags: ['teste de persistência'], url: 'data:text/plain;base64,' + Buffer.from(text).toString('base64'), fileName: 'persistencia.txt', mimeType: 'text/plain', size: Buffer.byteLength(text), sourceRole: 'project_context' } });
  assert.equal(uploaded.status(), 201, await uploaded.text()); const artifact = (await uploaded.json()).artifact;
  const before = app.missionStore.read(), savedProject = before.workspace.projects[projectId];
  const savedArtifact = before.artifacts.find(item => item.id === artifact.id);
  assert.ok(savedProject.document.engineeringSystem.entities.length > 0, 'fixture includes a saved graph');
  const remembered = (await context.cookies()).find(cookie => cookie.name === 'norte_demo');
  assert.ok(remembered?.httpOnly); assert.equal(remembered.sameSite, 'Strict');
  await page.reload(); await page.getByRole('button', { name: /^Abrir projeto/ }).click(); await page.getByText(savedName, { exact: true }).first().waitFor(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Visitante Norte', exact: true }).first().click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('button', { name: 'Retomar conta de teste', exact: true }).waitFor();
  await page.screenshot({ path: join(output, 'persistent-demo-browser-login.png'), fullPage: true });
  const cookiesAfterLogout = await context.cookies();
  assert.equal(cookiesAfterLogout.some(cookie => cookie.name === 'norte_session'), false);
  assert.equal(cookiesAfterLogout.find(cookie => cookie.name === 'norte_demo')?.value, remembered.value);
  const loggedOut = await context.request.get(origin + '/api/auth/session').then(response => response.json());
  assert.equal(loggedOut.authenticated, false); assert.equal(loggedOut.demoResumeAvailable, true);
  // Persist browser storage only in memory, restart the real API on its old port.
  const browserState = await context.storageState(); await context.close(); await app.close();
  app = await buildApp(options); await app.listen({ host: '127.0.0.1', port: apiPort });
  context = await openContext(browserState); page = await context.newPage(); await page.goto(origin + '/norte/#/login');
  const reopening = page.waitForResponse(response => response.url().endsWith('/api/auth/demo') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Retomar conta de teste', exact: true }).click();
  const resumedResponse = await reopening; assert.equal(resumedResponse.status(), 200); const resumed = await resumedResponse.json();
  assert.equal(resumed.user.id, actor.user.id); assert.equal(resumed.resumed, true);
  await page.getByRole('button', { name: /^Abrir projeto/ }).click();
  await page.getByText(savedName, { exact: true }).first().waitFor();
  const after = app.missionStore.read();
  assert.deepEqual(after.workspace.projects[projectId].document.engineeringSystem, savedProject.document.engineeringSystem);
  assert.deepEqual(after.workspace.projects[projectId].document.context.projectArtifactIds, savedProject.document.context.projectArtifactIds);
  assert.deepEqual(after.artifacts.find(item => item.id === artifact.id), savedArtifact);
  assert.equal(after.users.length, before.users.length, 'resuming creates no duplicated user');
  assert.equal(after.artifacts.length, before.artifacts.length, 'resuming creates no duplicated document');
  await page.screenshot({ path: join(output, 'persistent-demo-browser-resumed.png'), fullPage: true });
  const strangerContext = await openContext(), stranger = await strangerContext.newPage(); await stranger.goto(origin + '/norte/#/login');
  assert.equal(await stranger.getByRole('button', { name: 'Retomar conta de teste', exact: true }).count(), 0);
  const otherOpening = stranger.waitForResponse(response => response.url().endsWith('/api/auth/demo') && response.request().method() === 'POST');
  await stranger.getByRole('button', { name: 'Explorar com conta de teste', exact: true }).click();
  const otherResponse = await otherOpening; assert.equal(otherResponse.status(), 201); const other = await otherResponse.json();
  assert.notEqual(other.user.id, actor.user.id);
  assert.equal((await strangerContext.request.get(origin + '/api/projects/' + projectId)).status(), 403);
  assert.deepEqual(pageErrors, []);
  const report = { passed: true, isolated: true, externalModelCalls: 0, checks: { actualBrowserLogin: true, httpOnlyRecoveryCookie: true, sessionRemovedByLogout: true, recoveryCookieSurvivesLogout: true, resumeLabelDisplayed: true, actualServerRestart: true, restoredBrowserStorage: true, sameAccountRestored: true, savedDocumentPreserved: true, savedMapPreserved: true, noDuplicateDocuments: true, newBrowserIsolated: true, foreignProjectDenied: true }, pageErrors, generatedAt: new Date().toISOString() };
  await writeFile(join(output, 'persistent-demo-browser.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: real browser logout, recovery cookie, resume UI, API restart, preserved map/document, no duplicates and browser isolation. No LLM calls.');
} catch (error) {
  await page?.screenshot({ path: join(output, 'persistent-demo-browser-failure.png'), fullPage: true }).catch(() => {}); throw error;
} finally {
  await browser?.close(); await stop(vite); await app?.close(); await rm(directory, { recursive: true, force: true });
  for (const [key, value] of [['NORTE_DEMO_PROFILE', previousProfile], ['NORTE_ALLOWED_ORIGINS', previousOrigins]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
