/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { createEngineeringValidationModel, validationMemoryText } from '../examples/engineering-validation.mjs';

// Real authenticated API, CAS and UI. Extraction results are explicit synthetic
// fixtures; this verifies replacement consent, never provider accuracy.
const directory = await mkdtemp(join(tmpdir(), 'norte-map-review-')), errors = [];
const port = Number(process.env.NORTE_MAP_VISUAL_PORT || 5299), origin = `http://127.0.0.1:${port}`;
const jobs = new Map(); let started = 0, applied = 0, browser, vite, page;
const systemAiService = { status: () => ({ configured: true, model: 'synthetic-browser-fixture' }), async start(project) {
  started++; const model = structuredClone(project.engineeringSystem); model.id = 'updated-model'; model.name = 'Mapa proposto'; model.generatedFromRevision = project.memoryRevision; model.generatedAt = new Date().toISOString(); model.entities[0].name = 'Sistema revisado';
  const job = { jobId: 'job-' + started, status: 'completed', result: model, progress: { totalDocuments: 1, processedDocuments: 1, totalChunks: 2, completedChunks: 2, cachedChunks: 0, failedChunks: 0, coverage: 1 }, report: { complete: true, needsReview: true, omissions: [{ chunkId: 'synthetic', artifactId: 'synthetic', kind: 'relation', id: 'unverified', name: 'Ligação sem citação', reason: 'A relação não foi confirmada no documento.' }], warnings: ['A proposta contém uma omissão pendente de revisão.'] } }; jobs.set(job.jobId, job); return job;
}, async job(id) { return jobs.get(id); }, async resume(id) { return jobs.get(id); } };
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, ai: { apiKey: '' }, systemAiService });
app.addHook('onResponse', (request, reply, done) => { if (request.method === 'POST' && request.url.endsWith('/apply') && reply.statusCode === 200) applied++; done(); });
try {
 const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Map Reviewer', nickname: 'map_reviewer', email: 'map-reviewer@example.test', password: 'map regeneration visual test passphrase' } }); assert.equal(registered.statusCode, 201, registered.body);
 const actor = registered.json(), cookie = registered.headers['set-cookie'].split(';')[0], headers = { cookie, 'x-csrf-token': actor.csrfToken };
 const request = async (method, url, payload) => { const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) }); assert.ok(response.statusCode < 400, response.body); return response.json(); };
 const list = await request('GET', '/api/projects'); const id = list.projects[0].id; let project = (await request('GET', '/api/projects/' + id)).project;
 project.context.assignments = [{ memberId: actor.user.memberId, roleId: 'captain', sectorId: '' }]; project.context.configured = true;
 const artifact = (await request('POST', '/api/artifacts', { kind: 'document', label: 'Memória sintética para teste', scope: 'project', ownerId: id, tags: [], url: 'data:text/plain;base64,' + Buffer.from(validationMemoryText).toString('base64'), fileName: 'fixture.txt', mimeType: 'text/plain', size: Buffer.byteLength(validationMemoryText) })).artifact;
 project.context.projectArtifactIds = [artifact.id]; project.engineeringSystem = createEngineeringValidationModel(); project.engineeringSystem.evidence = project.engineeringSystem.evidence.map(item => ({ ...item, artifactId: artifact.id })); project.engineeringSystem.generatedFromRevision = 0;
 project = (await request('PUT', '/api/projects/' + id, project)).project;
 const baseline = structuredClone(project.engineeringSystem);
 await app.listen({ host: '127.0.0.1', port: 0 });
 vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
 await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Vite timeout')), 25000); vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); resolve(); } }); vite.once('exit', code => { clearTimeout(timer); reject(new Error('Vite exited ' + code)); }); });
 browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
 const context = await browser.newContext({ viewport: { width: 1440, height: 960 } }); const split = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin }]);
 page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.addInitScript(() => window.localStorage.setItem('norte-language', 'pt'));
 await page.goto(origin + '/#/study-setup'); await page.getByText('Os documentos mudaram desde a geração do mapa.', { exact: false }).waitFor();
 await page.getByRole('button', { name: 'Atualizar mapa dos documentos', exact: true }).click();
 let dialog = page.getByRole('dialog', { name: 'Revisar atualização do mapa', exact: true }); await dialog.waitFor();
 assert.equal(applied, 0); assert.deepEqual(app.missionStore.read().workspace.projects[id].document.engineeringSystem, baseline);
 assert.equal(await dialog.getByRole('button', { name: 'Substituir mapa', exact: true }).isDisabled(), true);
 await dialog.getByText('Itens omitidos que precisam de revisão', { exact: false }).click();
 await dialog.getByText('Pendente de validação: Ligação sem citação', { exact: true }).waitFor();
 await page.screenshot({ path: '/tmp/norte-map-proposal-review.png', fullPage: true });
 await dialog.getByRole('button', { name: 'Manter mapa atual', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
 assert.equal(applied, 0); assert.deepEqual(app.missionStore.read().workspace.projects[id].document.engineeringSystem, baseline);
 await page.getByRole('button', { name: 'Atualizar mapa dos documentos', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Revisar atualização do mapa', exact: true }); await dialog.waitFor();
 assert.equal(started, 1, 'a cancelled proposal is reviewed again without spending another extraction');
 await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: 'Substituir mapa', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
 await page.waitForURL('**#/brainstorming'); assert.equal(applied, 1); const record = app.missionStore.read().workspace.projects[id]; assert.equal(record.document.engineeringSystem.id, 'updated-model'); assert.equal(record.engineeringHistory.length, 1); assert.deepEqual(record.engineeringHistory[0].engineeringSystem, baseline);
 await page.goto(origin + '/#/study-setup'); await page.getByRole('button', { name: 'Versões anteriores do mapa', exact: true }).click(); const history = page.getByRole('dialog', { name: 'Versões anteriores do mapa', exact: true }); await history.getByRole('heading', { name: 'Relatório da leitura atual', exact: true }).waitFor(); await history.getByText('Pendente de validação: Ligação sem citação', { exact: true }).waitFor(); assert.equal(await history.locator('.extraction-omission').count(), 1); await history.locator('.previous-map-versions summary').first().click(); await history.getByText(baseline.entities[0].name, { exact: true }).waitFor();
 await page.screenshot({ path: '/tmp/norte-map-preserved-history.png', fullPage: true });
 assert.deepEqual(errors, []); console.log('PASS: stale map warning, regenerate:true, proposal and omissions review, cancel preserves map, cancelled proposal reused, explicit replacement with reviewed:true, old map preserved and visible in history. No provider calls.');
} catch (error) { await page?.screenshot({ path: '/tmp/norte-map-regeneration-failure.png', fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); vite?.kill('SIGTERM'); await app.close(); await rm(directory, { recursive: true, force: true }); }
