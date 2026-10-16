/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { createValidationProject } from '../server/data-store.mjs';
import { shiftDate } from '../shared/delivery-lifecycle.mjs';

// Every record belongs to this disposable local store. No production credentials,
// provider calls, or application data from the running Norte service are used.
const directory = await mkdtemp(join(tmpdir(), 'norte-schedule-browser-'));
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(appRoot, '../.runtime/validation');
const port = 5298, origin = `http://127.0.0.1:${port}`, projectId = 'schedule-browser';
const checks = [], errors = [], externalRequests = [], apiErrors = [], viewportMetrics = [];
const previousOrigins = process.env.NORTE_ALLOWED_ORIGINS;
let app, vite, browser, page;
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise(done => { const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 4000); child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM'); });
}
async function screenshot(name) {
  const path = join(output, `schedule-redesign-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`SCREENSHOT ${path}`);
}
async function noHorizontalOverflow(label) {
  const size = await page.evaluate(() => ({ width: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(size.document <= size.width + 1 && size.body <= size.width + 1, `${label}: page horizontal overflow ${JSON.stringify(size)}`);
  const board = await page.locator('.schedule-board').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert(board.scroll <= board.client + 1, `${label}: board horizontal overflow ${JSON.stringify(board)}`);
  checks.push(`${label}: no horizontal overflow`);
}
try {
  await mkdir(output, { recursive: true });
  process.env.NORTE_ALLOWED_ORIGINS = origin;
  app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const config = join(directory, 'vite.config.mjs');
  await writeFile(config, `export default ${JSON.stringify({ root: appRoot, base: '/norte/', server: { hmr: false, watch: null, proxy: { '/api': { target: `http://127.0.0.1:${app.server.address().port}`, changeOrigin: false } } } })};\n`);
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: appRoot, env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite timeout')), 25000);
    let diagnostics = '';
    vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); done(); } });
    vite.stderr.on('data', chunk => { diagnostics += String(chunk); });
    vite.once('exit', code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}: ${diagnostics}`)); });
  });
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    externalRequests.push(url); return route.abort();
  });
  await context.addInitScript(() => {
    if (/^https?:$/.test(window.location.protocol)) {
      window.localStorage.setItem('norte-language', 'pt');
      window.localStorage.setItem('norte-theme', 'dark');
      window.localStorage.setItem('norte-active-project-v1', 'schedule-browser');
    }
  });
  const registration = await context.request.post(origin + '/api/auth/register', { data: { name: 'Engenheira de sistemas', nickname: 'schedule_engineer', email: 'schedule-browser@example.test', password: 'isolated-schedule-browser-password' } });
  assert.equal(registration.status(), 201, await registration.text());
  const actor = await registration.json(), headers = { 'x-csrf-token': actor.csrfToken };
  const teamResponse = await context.request.post(origin + '/api/teams', { headers, data: { name: 'Equipe Quetzal' } });
  assert.equal(teamResponse.status(), 201, await teamResponse.text());
  const team = (await teamResponse.json()).team;
  const project = createValidationProject();
  project.id = projectId; project.name = 'Quetzal-1'; project.context.teamId = team.id; project.context.teamName = team.name;
  project.context.assignments = [{ memberId: actor.user.memberId, roleId: 'captain', sectorId: '' }];
  const created = await context.request.post(origin + '/api/projects', { headers, data: project });
  assert.equal(created.status(), 201, await created.text());
  const read = async () => {
    const response = await context.request.get(`${origin}/api/projects/${projectId}/delivery`);
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const action = async (name, payload) => {
    const before = await read();
    const response = await context.request.post(`${origin}/api/projects/${projectId}/delivery/actions`, { headers, data: { ...payload, action: name, expectedRevision: before.revision, expectedBaselineHash: before.baselineHash } });
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const configured = await action('lifecycle.configure', { profile: 'nasa', startDate: '2026-11-02' });
  const phase = configured.lifecycleRanges.find(item => item.code === 'C');
  const withActivity = await action('task.save', { item: { title: 'Integrar a placa EPS', description: 'Conferir interfaces, executar integração e registrar evidências.', kind: 'task', phaseId: phase.id, phase: phase.name, startDate: phase.start, dueDate: shiftDate(phase.start, 21), prepDays: 0, closeDays: 0, status: 'planned', sectorId: '', ownerId: actor.user.id, dependencyIds: [], requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [] } });
  const activity = withActivity.tasks.find(item => item.title === 'Integrar a placa EPS');
  await action('task.save', { item: { title: 'Definir ensaio de antenas', description: '', kind: 'task', phaseId: '', phase: '', startDate: '', dueDate: '', prepDays: 0, closeDays: 0, status: 'planned', sectorId: '', ownerId: '', dependencyIds: [], requirementIds: [], testIds: [], inputArtifactIds: [], outputArtifactIds: [] } });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().startsWith(origin + '/api/') && response.status() >= 400) apiErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  page.setDefaultTimeout(15000);
  const button = name => page.getByRole('button', { name, exact: true });
  const mutateUi = async (name, trigger) => {
    const pending = page.waitForResponse(response => response.url().endsWith('/delivery/actions') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === name);
    await trigger(); const response = await pending;
    assert.equal(response.status(), 200, await response.text()); return response.json();
  };
  const panel = page.locator('.schedule-task-panel');
  const settings = page.locator('.planning-settings-panel');
  await page.goto(origin + '/norte/#/schedule');
  await page.locator('.schedule-board').waitFor();
  await page.locator('.schedule-phase-row').first().waitFor();
  assert.equal(await page.locator('.schedule-phase-row').count(), 8);
  await screenshot('overview-dark');
  await noHorizontalOverflow('desktop overview');
  for (const height of [1000, 900, 768]) {
    await page.setViewportSize({ width: 1440, height });
    await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
    const metrics = await page.locator('.schedule-board').evaluate(element => {
      const marker = element.querySelector('.schedule-marker'), style = window.getComputedStyle(marker);
      const footer = element.querySelector('.schedule-board-footer').getBoundingClientRect();
      const scroll = element.querySelector('.schedule-gantt-scroll');
      return { height: window.innerHeight, footerBottom: footer.bottom, scrollClient: scroll.clientHeight, scrollHeight: scroll.scrollHeight, marker: { border: style.border, background: style.backgroundColor, minHeight: style.minHeight, font: style.font, color: style.color } };
    });
    viewportMetrics.push(metrics);
    console.log('VIEWPORT ' + JSON.stringify(metrics));
    assert(metrics.footerBottom <= height, `Desktop ${height}px: footer must remain within the viewport (${metrics.footerBottom}px)`);
    await noHorizontalOverflow(`desktop ${height}px`);
    if (height !== 1000) await screenshot(`overview-${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('NASA phases, review milestones, duration activity and unassigned undated activity render');

  // Opening a milestone keeps the timeline visible and exposes explicit-save fields.
  await page.locator('.schedule-marker[aria-label="SRR · Requisitos do sistema"]').click();
  await panel.waitFor();
  assert.equal(await panel.getByRole('heading', { name: 'SRR · Requisitos do sistema' }).count(), 1);
  await screenshot('review-details');
  await button('Fechar detalhes').click();
  const search = page.getByRole('searchbox', { name: 'Buscar no cronograma', exact: true });
  await search.fill('Integrar a placa EPS');
  assert.equal(await page.locator('.schedule-task-row').count(), 1);
  await page.locator('.schedule-task-label').filter({ hasText: 'Integrar a placa EPS' }).click();
  await panel.getByLabel('Início', { exact: true }).fill(shiftDate(activity.startDate, 2));
  await panel.getByLabel('Prazo', { exact: true }).fill(shiftDate(activity.dueDate, 5));
  await panel.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption('');
  await panel.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('in_progress');
  assert.equal((await read()).tasks.find(item => item.id === activity.id).startDate, activity.startDate, 'Quick edit must not save before confirmation');
  let state = await mutateUi('task.save', () => panel.getByRole('button', { name: 'Salvar alterações', exact: true }).click());
  let savedTask = state.tasks.find(item => item.id === activity.id);
  assert.equal(savedTask.startDate, shiftDate(activity.startDate, 2)); assert.equal(savedTask.dueDate, shiftDate(activity.dueDate, 5)); assert.equal(savedTask.ownerId, ''); assert.equal(savedTask.status, 'in_progress');
  await screenshot('activity-edit');
  await page.reload(); await page.locator('.schedule-board').waitFor();
  await search.fill('Integrar a placa EPS');
  await page.locator('.schedule-task-label').filter({ hasText: 'Integrar a placa EPS' }).click();
  assert.equal(await panel.getByLabel('Início', { exact: true }).inputValue(), savedTask.startDate);
  assert.equal(await panel.getByLabel('Prazo', { exact: true }).inputValue(), savedTask.dueDate);
  assert.equal(await panel.getByRole('combobox', { name: 'Responsável', exact: true }).inputValue(), '');
  assert.equal(await panel.getByRole('combobox', { name: 'Situação', exact: true }).inputValue(), 'in_progress');
  await panel.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption(actor.user.id);
  await mutateUi('task.save', () => panel.getByRole('button', { name: 'Salvar alterações', exact: true }).click());
  await button('Fechar detalhes').click(); await search.fill('');
  checks.push('Quick edit start, due date, owner and status requires Save and survives reload');

  // A quick draft belongs to its task, and unrelated live edits must not be reverted.
  await search.fill('Integrar a placa EPS');
  await page.locator('.schedule-task-label').filter({ hasText: 'Integrar a placa EPS' }).click();
  await panel.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption('');
  await button('Fechar detalhes').click(); await search.fill('');
  await page.locator('.schedule-marker[aria-label="SRR · Requisitos do sistema"]').click();
  await button('Fechar detalhes').click(); await search.fill('Integrar a placa EPS');
  await page.locator('.schedule-task-label').filter({ hasText: 'Integrar a placa EPS' }).click();
  assert.equal(await panel.getByRole('combobox', { name: 'Responsável', exact: true }).inputValue(), '', 'Closing and reopening a task retains its unsaved owner');
  const beforeOwnerDrag = (await read()).tasks.find(item => item.id === activity.id);
  const activityMarker = page.locator('.schedule-marker[aria-label="Integrar a placa EPS"]');
  const activityBox = await activityMarker.boundingBox(); assert(activityBox);
  state = await mutateUi('task.reschedule', async () => { await page.mouse.move(activityBox.x + activityBox.width / 2, activityBox.y + activityBox.height / 2); await page.mouse.down(); await page.mouse.move(activityBox.x + activityBox.width / 2 + 12, activityBox.y + activityBox.height / 2, { steps: 6 }); await page.mouse.up(); });
  const afterOwnerDrag = state.tasks.find(item => item.id === activity.id);
  assert.notEqual(afterOwnerDrag.dueDate, beforeOwnerDrag.dueDate);
  assert.equal(afterOwnerDrag.ownerId, actor.user.id, 'A draft owner is not saved by dragging a date');
  state = await mutateUi('task.save', () => panel.getByRole('button', { name: 'Salvar alterações', exact: true }).click());
  const savedOwner = state.tasks.find(item => item.id === activity.id);
  assert.equal(savedOwner.ownerId, '');
  assert.equal(savedOwner.startDate, afterOwnerDrag.startDate); assert.equal(savedOwner.dueDate, afterOwnerDrag.dueDate);
  state = await mutateUi('task.save', () => button('Desfazer').click());
  const undoneOwner = state.tasks.find(item => item.id === activity.id);
  assert.equal(undoneOwner.ownerId, '', 'Undo keeps the separately saved owner');
  assert.equal(undoneOwner.startDate, beforeOwnerDrag.startDate); assert.equal(undoneOwner.dueDate, beforeOwnerDrag.dueDate);
  checks.push('Unsaved quick edits survive closing and another task; saving owner preserves dragged dates; Undo preserves owner');

  // Conflicting changes to the same date are surfaced before another Save.
  await panel.getByLabel('Prazo', { exact: true }).fill(shiftDate(undoneOwner.dueDate, 3));
  await activityMarker.focus();
  state = await mutateUi('task.reschedule', () => page.keyboard.press('ArrowRight'));
  await panel.getByRole('button', { name: 'Usar valores atuais', exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'Salvar alterações', exact: true }).isDisabled(), true);
  await screenshot('draft-conflict');
  await panel.getByRole('button', { name: 'Usar valores atuais', exact: true }).click();
  await panel.getByRole('button', { name: 'Usar valores atuais', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await panel.getByLabel('Prazo', { exact: true }).inputValue(), state.tasks.find(item => item.id === activity.id).dueDate);
  await mutateUi('task.save', () => button('Desfazer').click());
  checks.push('A changed date blocks a conflicting draft until current values are accepted');

  // The complete editor starts with the quick draft, and archive remains reversible.
  await panel.getByRole('combobox', { name: 'Responsável', exact: true }).selectOption(actor.user.id);
  await panel.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('blocked');
  await panel.getByRole('button', { name: 'Editar todos os campos', exact: true }).click();
  const fullEditor = page.getByRole('dialog', { name: 'Editar atividade', exact: true });
  await fullEditor.waitFor();
  assert.equal(await fullEditor.getByRole('combobox', { name: 'Responsável', exact: true }).inputValue(), actor.user.id);
  assert.equal(await fullEditor.getByRole('combobox', { name: 'Situação', exact: true }).inputValue(), 'blocked');
  state = await mutateUi('task.save', () => fullEditor.getByRole('button', { name: 'Salvar atividade', exact: true }).click());
  await fullEditor.waitFor({ state: 'hidden' });
  assert.equal(state.tasks.find(item => item.id === activity.id).status, 'blocked');
  await mutateUi('task.archive', () => panel.getByRole('button', { name: 'Arquivar atividade', exact: true }).click());
  await panel.getByRole('button', { name: 'Restaurar atividade', exact: true }).waitFor();
  assert.equal(await panel.isVisible(), true);
  state = await mutateUi('task.restore', () => panel.getByRole('button', { name: 'Restaurar atividade', exact: true }).click());
  await panel.getByRole('button', { name: 'Arquivar atividade', exact: true }).waitFor();
  assert.equal(state.tasks.find(item => item.id === activity.id).archived, false);
  await button('Fechar detalhes').click(); await search.fill('');
  checks.push('Full editor receives quick draft; archived task stays open and restores without data loss');

  // Keyboard and pointer edits are real persisted reschedules, with one-step undo.
  const srr = (await read()).tasks.find(item => item.reviewCode === 'SRR');
  const srrMarker = page.locator('.schedule-marker[aria-label="SRR · Requisitos do sistema"]');
  await srrMarker.focus();
  state = await mutateUi('task.reschedule', () => page.keyboard.press('ArrowRight'));
  assert.equal(state.tasks.find(item => item.id === srr.id).dueDate, shiftDate(srr.dueDate, 1));
  await mutateUi('task.save', () => button('Desfazer').click());
  assert.equal((await read()).tasks.find(item => item.id === srr.id).dueDate, srr.dueDate);
  const box = await srrMarker.boundingBox(); assert(box);
  state = await mutateUi('task.reschedule', async () => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2, { steps: 8 }); await page.mouse.up(); });
  assert.notEqual(state.tasks.find(item => item.id === srr.id).dueDate, srr.dueDate);
  await mutateUi('task.save', () => button('Desfazer').click());
  assert.equal((await read()).tasks.find(item => item.id === srr.id).dueDate, srr.dueDate);
  checks.push('Keyboard and pointer reschedules persist and Desfazer restores the original date');

  // Settings preview remains a local draft, including review selection and model switches.
  const beforeSettings = await read();
  await button('Modelo de ciclo de vida').click(); await settings.waitFor();
  await settings.getByRole('button', { name: /^Revisões / }).click();
  await settings.getByRole('checkbox', { name: /^SRR/ }).uncheck();
  await page.locator('.schedule-marker[aria-label="SRR · Requisitos do sistema"]').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.schedule-marker[aria-label="SRR · Requisitos do sistema"]').count(), 0);
  assert.deepEqual((await read()).lifecycle, beforeSettings.lifecycle);
  await screenshot('phase-preview');
  await settings.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await settings.waitFor({ state: 'hidden' }); await srrMarker.waitFor();
  assert.deepEqual((await read()).lifecycle, beforeSettings.lifecycle);
  await button('Editar fase C').click(); await settings.getByLabel('Nome da fase C', { exact: true }).waitFor();
  assert.equal(await settings.locator('.planning-settings-phase-fields').count(), 1);
  await settings.getByLabel('Nome da fase C', { exact: true }).fill('Integração do hardware');
  const originalEnd = await settings.getByLabel('Fim da fase C', { exact: true }).inputValue();
  await settings.getByLabel('Fim da fase C', { exact: true }).fill(shiftDate(originalEnd, 3));
  await settings.getByRole('button', { name: /^Revisões / }).click();
  await settings.getByRole('checkbox', { name: /^PRR/ }).check();
  await settings.getByRole('combobox', { name: 'Referência de planejamento', exact: true }).selectOption('ecss');
  await settings.getByRole('combobox', { name: 'Referência de planejamento', exact: true }).selectOption('nasa');
  assert.equal(await settings.getByRole('checkbox', { name: /^PRR/ }).isChecked(), true);
  await settings.getByRole('button', { name: /^Fases / }).click();
  await settings.getByRole('button', { name: 'Editar fase C: Integração do hardware', exact: true }).click();
  assert.equal(await settings.getByLabel('Nome da fase C', { exact: true }).inputValue(), 'Integração do hardware');
  assert.equal(await settings.getByLabel('Fim da fase C', { exact: true }).inputValue(), shiftDate(originalEnd, 3));
  state = await mutateUi('lifecycle.configure', () => settings.getByRole('button', { name: 'Salvar ciclo de vida', exact: true }).click());
  await settings.waitFor({ state: 'hidden' });
  assert.equal(state.lifecycle.phases.find(item => item.code === 'C').name, 'Integração do hardware');
  assert(state.lifecycle.selectedReviews.includes('PRR'));
  await page.reload(); await page.locator('.schedule-board').waitFor();
  assert.equal((await read()).lifecycle.phases.find(item => item.code === 'C').end, shiftDate(originalEnd, 3));
  checks.push('Phase/review preview and cancel do not persist; profile switching preserves draft; explicit save persists phase and review choices');

  // Review tree documents use the actual deterministic document preparation API.
  await page.locator('.planning-tabs').getByRole('button', { name: /^Revisões/ }).click();
  const docs = page.getByRole('button', { name: 'Documentos de SRR · Requisitos do sistema', exact: true });
  await docs.click();
  const review = page.locator('.schedule-review').filter({ has: docs });
  const specification = review.locator('.review-document').filter({ hasText: 'REQ ·' });
  await mutateUi('document.prepare', () => specification.getByRole('button', { name: 'Preparar', exact: true }).click());
  await specification.getByRole('button', { name: 'Abrir rascunho · v1', exact: true }).click();
  const draftContent = page.getByRole('textbox', { name: 'Conteúdo do rascunho', exact: true });
  await draftContent.waitFor(); await draftContent.fill((await draftContent.inputValue()) + '\nRegistro do teste isolado do cronograma.');
  state = await mutateUi('document.save', () => button('Salvar rascunho').click());
  await specification.getByRole('button', { name: 'Abrir rascunho · v2', exact: true }).waitFor();
  assert.equal(state.documents.find(item => item.templateId === 'REQ').version, 2);
  await screenshot('reviews-documents');
  await page.locator('.planning-tabs').getByRole('button', { name: 'Planejamento', exact: true }).click();
  await screenshot('overview-final-dark');
  await button('Ativar tema claro').click(); await screenshot('overview-light');
  await noHorizontalOverflow('light overview');
  checks.push('Review tree groups by phase, prepares and edits a document to version 2');

  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow('mobile overview'); await screenshot('mobile');
  await search.fill('Definir ensaio de antenas');
  await page.locator('.schedule-task-label').filter({ hasText: 'Definir ensaio de antenas' }).click();
  await panel.waitFor();
  const mobileBounds = await panel.evaluate(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, sidebarRight: document.querySelector('.mission-sidebar').getBoundingClientRect().right, width: window.innerWidth }));
  assert(mobileBounds.left >= mobileBounds.sidebarRight && mobileBounds.right <= mobileBounds.width, `Mobile details must respect the navigation bounds: ${JSON.stringify(mobileBounds)}`);
  assert.equal(await panel.getByLabel('Prazo', { exact: true }).inputValue(), '');
  await panel.getByLabel('Início', { exact: true }).fill('2027-03-01');
  await panel.getByLabel('Prazo', { exact: true }).fill('2027-03-05');
  await mutateUi('task.save', () => panel.getByRole('button', { name: 'Salvar alterações', exact: true }).click());
  await screenshot('mobile-details');
  await button('Fechar detalhes').click(); await search.fill('');
  await noHorizontalOverflow('mobile after edit');
  checks.push('Mobile opens an undated activity and saves its dates');
  assert.deepEqual(errors, []); assert.deepEqual(apiErrors, []); assert.deepEqual(externalRequests, []);
  await writeFile(join(output, 'schedule-redesign-browser.json'), JSON.stringify({ passed: true, isolated: true, externalModelCalls: 0, checks, viewportMetrics, generatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
  console.log('PASS: isolated schedule workspace, persistence, preview, reviews and mobile. No external requests or LLM calls.');
} catch (error) {
  await screenshot('failure').catch(() => {});
  await writeFile(join(output, 'schedule-redesign-browser.json'), JSON.stringify({ passed: false, error: error.message, checks, viewportMetrics, pageErrors: errors, apiErrors, externalRequests, generatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await stop(vite); await app?.close(); await rm(directory, { recursive: true, force: true });
  if (previousOrigins === undefined) delete process.env.NORTE_ALLOWED_ORIGINS; else process.env.NORTE_ALLOWED_ORIGINS = previousOrigins;
}
