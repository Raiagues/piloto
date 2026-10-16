/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { prepareProjectArtifactsAsync } from '../server/system-ai.mjs';

// Real browser -> authenticated API -> disposable storage -> asynchronous PDF
// parser. No extraction job, model call, or main-server data is involved.
const root = resolve('..'), directory = await mkdtemp(join(tmpdir(), 'norte-upload-browser-'));
const manifest = JSON.parse(await readFile(resolve(root, 'project-documents/quetzal-1/manifest.json'), 'utf8'));
const source = manifest.sources.find(item => item.id === 'microchip-atmega328p-datasheet');
const path = resolve(root, 'project-documents/quetzal-1', source.path);
const previousProfile = process.env.NORTE_DEMO_PROFILE; process.env.NORTE_DEMO_PROFILE = 'validation';
const port = Number(process.env.NORTE_UPLOAD_VISUAL_PORT || 5303), origin = `http://127.0.0.1:${port}`;
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
let browser, vite, page;
const errors = []; let modelRequests = 0;
app.addHook('onRequest', (request, _reply, done) => { if (/^\/api\/(system-ai|brainstorm-ai)/u.test(request.url) && request.method === 'POST') modelRequests++; done(); });
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Vite timeout')), 25000); vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); resolve(); } }); vite.once('exit', code => { clearTimeout(timer); reject(new Error('Vite exited ' + code)); }); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem('norte-language', 'pt'));
  await page.goto(origin + '/norte/');
  await page.getByRole('button', { name: 'Explorar com conta de teste', exact: true }).click();
  await page.locator('.home-action-card.accent-open').click(); await page.locator('.home-project-open').click();
  await page.locator('.pm-artifact-card').first().waitFor();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Novo artefato do projeto', exact: true });
  assert.equal(await dialog.getByLabel('Uso na memória', { exact: true }).inputValue(), 'project_context');
  await dialog.getByLabel('Nome', { exact: true }).fill('ATmega original · upload de validação');
  await dialog.getByLabel('Uso na memória', { exact: true }).selectOption('supporting_datasheet');
  await dialog.getByText('Referências complementam componentes já identificados; não definem a arquitetura da missão.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Arquivo', exact: true }).click();
  await dialog.getByText('PDF, CAD, imagem, planilha, texto ou código · até 48 MiB', { exact: true }).waitFor();
  const uploadStart = performance.now();
  await dialog.locator('input[type=file]').setInputFiles(path);
  await dialog.locator('.artifact-file-ready strong').waitFor({ timeout: 30_000 });
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/artifacts') && response.request().method() === 'POST', { timeout: 90_000 });
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  const response = await savedResponse; assert.equal(response.status(), 201);
  // Chromium may evict the Network inspection body after a large upload. The
  // actual UI consumes it normally; verify the committed server state here.
  const saved = app.missionStore.read().artifacts.find(item => item.label === 'ATmega original · upload de validação'), uploadElapsedMs = Math.round(performance.now() - uploadStart);
  assert.ok(saved);
  assert.equal(saved.sourceRole, 'supporting_datasheet'); assert.equal(saved.size, source.size_bytes);
  await dialog.waitFor({ state: 'detached' });
  let card = page.locator('.pm-artifact-card').filter({ hasText: 'ATmega original · upload de validação' }); await card.waitFor();
  await page.reload(); card = page.locator('.pm-artifact-card').filter({ hasText: 'ATmega original · upload de validação' }); await card.waitFor();
  await card.getByRole('button', { name: 'Editar', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Editar artefato', exact: true });
  assert.equal(await dialog.getByLabel('Uso na memória', { exact: true }).inputValue(), 'supporting_datasheet');
  await page.screenshot({ path: '/tmp/norte-large-upload-source-role.png', fullPage: true });
  await dialog.getByLabel('Uso na memória', { exact: true }).selectOption('project_context');
  const patchResponse = page.waitForResponse(response => response.url().endsWith('/api/artifacts/' + saved.id) && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); const patched = await patchResponse; assert.equal(patched.status(), 200);
  await dialog.waitFor({ state: 'detached' });
  const data = app.missionStore.read(), stored = data.artifacts.find(item => item.id === saved.id), project = data.workspace.projects[stored.ownerId].document;
  assert.equal(stored.sourceRole, 'project_context'); assert.equal(stored.size, source.size_bytes);
  assert.equal(createHash('sha256').update(Buffer.from(stored.url.split(',')[1], 'base64')).digest('hex'), source.sha256);
  assert.ok(project.context.projectArtifactIds.includes(stored.id));
  const parseStart = performance.now(), parsed = await prepareProjectArtifactsAsync(project, [stored]), parseElapsedMs = Math.round(performance.now() - parseStart);
  assert.equal(parsed.length, 1); assert.equal(parsed[0].source.status, 'parsed'); assert.equal(parsed[0].pages.length, 653); assert.deepEqual(parsed[0].missingPages, []); assert.ok(parsed[0].text.length > 1_000_000);
  assert.equal(modelRequests, 0); assert.deepEqual(errors, []);
  const report = { status: 'passed', validatedAt: new Date().toISOString(), scope: 'Real browser file selection, authenticated HTTP create and patch, reload, disposable persistence, original-byte hash and async PDF parsing; no main-server writes or model calls', file: { fileName: source.filename, bytes: source.size_bytes, sha256: source.sha256 }, sourceRole: { default: 'project_context', created: saved.sourceRole, afterReload: 'supporting_datasheet', edited: stored.sourceRole }, uploadElapsedMs, parser: { status: parsed[0].source.status, pages: parsed[0].pages.length, missingPages: parsed[0].missingPages, textCharacters: parsed[0].text.length, elapsedMs: parseElapsedMs }, providerCalls: 0, documentContentsStoredInReport: false };
  await mkdir(resolve(root, '.runtime/validation'), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, '.runtime/validation/long-pdf-upload-browser.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) { await page?.screenshot({ path: '/tmp/norte-large-upload-source-role-failure.png', fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); vite?.kill('SIGTERM'); await app.close(); if (previousProfile === undefined) delete process.env.NORTE_DEMO_PROFILE; else process.env.NORTE_DEMO_PROFILE = previousProfile; await rm(directory, { recursive: true, force: true }); }
