/* global window */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

// Credentials stay in private local files. This checks the existing account;
// it never creates demo data, edits a project, or calls an AI provider.
const root = resolve('..'), output = resolve(root, '.runtime/validation');
const state = JSON.parse(await readFile(resolve(output, 'reusable-session.json'), 'utf8'));
const credentials = await readFile(resolve(root, '.runtime/conta-teste.txt'), 'utf8');
const password = /^Senha: ([A-Za-z0-9_-]{32,128})$/mu.exec(credentials)?.[1];
const email = /^E-mail: ([^\r\n]+)$/mu.exec(credentials)?.[1];
assert.ok(password && email && email === state.email, 'Private local credentials must match the prepared account');
assert.equal(state.origin, 'http://127.0.0.1:8000', 'Only the explicitly prepared local installation is allowed');
const withMap = process.argv.includes('--map'), phase = withMap ? 'map' : 'base';
const blocked = [], errors = [];
let browser, page;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1512, height: 1000 } });
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const passive = request.method() === 'GET' || request.method() === 'HEAD';
    const sessionOrVisit = request.method() === 'POST' && (/^\/api\/auth\/(login|logout|heartbeat)$/u.test(path) || /^\/api\/projects\/[^/]+\/visit$/u.test(path));
    if (passive || sessionOrVisit) return route.continue();
    blocked.push({ method: request.method(), endpoint: path.replace(state.projectId, ':projectId') });
    return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'READ_ONLY_VALIDATION', message: 'Esta verificação não altera os dados.' }) });
  });
  await context.addInitScript(projectId => { window.localStorage.setItem('norte-language', 'pt'); window.localStorage.setItem('norte-active-project-v1', projectId); }, state.projectId);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const get = async path => { const response = await context.request.get(state.origin + '/api' + path); assert.equal(response.status(), 200, 'Read endpoint unavailable'); return response.json(); };
  await page.goto(state.origin + '/#/login');
  await page.locator('.auth-form input[name=email]').fill(email);
  await page.locator('.auth-form input[name=password]').fill(password);
  await page.locator('.auth-form .auth-submit').click();
  await page.locator('.app-header').waitFor();
  const [auth, teams, projects, envelope, artifacts, invitations, meetings] = await Promise.all([get('/auth/session'), get('/teams'), get('/projects'), get('/projects/' + state.projectId), get('/artifacts'), get('/meeting-invitations'), get('/meetings')]);
  assert.equal(auth.user.id, state.user.id); assert.equal(auth.user.demoAccount, false);
  assert.equal(teams.teams.length, 1); assert.deepEqual(teams.teams[0].memberIds, [auth.user.memberId]);
  assert.equal(projects.projects.length, 1); assert.equal(envelope.project.context.projectArtifactIds.length, 17);
  assert.equal(artifacts.artifacts.length, 17); assert.equal(invitations.invitations.length, 0);
  const baseline = digest(envelope.project);
  await page.locator('.account-badge-trigger').click();
  await page.getByRole('button', { name: 'Ver e editar perfil', exact: true }).click();
  const profile = page.getByRole('dialog', { name: 'Seu perfil', exact: true }); await profile.waitFor();
  await profile.locator('.profile-teams button').waitFor(); assert.equal(await profile.locator('.profile-teams button').count(), 1);
  await page.screenshot({ path: resolve(output, 'persistent-profile.png'), fullPage: true, mask: [profile.getByLabel('E-mail', { exact: true })] });
  await profile.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.goto(state.origin + '/#/study-setup'); await page.locator('.pm-artifact-card').first().waitFor(); assert.equal(await page.locator('.pm-artifact-card').count(), 17);
  await page.screenshot({ path: resolve(output, 'persistent-project-memory.png'), fullPage: true });
  await page.getByRole('button', { name: 'Avaliações e melhorias', exact: true }).click();
  const learning = page.locator('.project-learning-panel'); await learning.locator('.learning-metrics').waitFor();
  assert.equal(await learning.locator('.learning-error').count(), 0);
  await page.screenshot({ path: resolve(output, 'persistent-learning.png'), fullPage: true });
  await learning.getByRole('button', { name: 'Fechar avaliações', exact: true }).click();
  await page.goto(state.origin + '/#/meetings'); await page.getByRole('button', { name: 'Nova reunião', exact: true }).click();
  await page.getByLabel('Projeto', { exact: true }).selectOption('');
  const without = page.getByRole('radio', { name: 'Sem memória · testar somente a reunião', exact: true }), withMemory = page.getByRole('radio', { name: 'Usar o mapa e as fontes do projeto', exact: true });
  assert.equal(await without.isChecked(), true); assert.equal(await withMemory.isDisabled(), true);
  await page.getByLabel('Projeto', { exact: true }).selectOption(state.projectId); await withMemory.check(); assert.equal(await withMemory.isChecked(), true);
  await page.screenshot({ path: resolve(output, 'persistent-meeting-modes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto(state.origin + '/#/admin/users'); await page.getByRole('heading', { name: 'Confirmar acesso administrativo', exact: true }).waitFor();
  assert.equal(await page.locator('.admin-scroll').count(), 0, 'Global administration stays protected until MFA is confirmed');
  await page.screenshot({ path: resolve(output, 'persistent-admin.png'), fullPage: true, mask: [page.locator('.activity-scroll tbody')] });
  let map = { status: 'pending_import' };
  if (withMap) {
    const model = envelope.project.engineeringSystem;
    assert.ok(model?.entities?.length, 'The map must be imported before running --map');
    assert.equal(model.generatedFromRevision, envelope.project.memoryRevision, 'The imported map must match the current project memory');
    await page.goto(state.origin + '/#/brainstorming'); await page.locator('.engineering-workspace .engineering-model-title').waitFor();
    assert.ok(await page.locator('.architecture-block').count() > 0, 'Engineering architecture renders actual objects');
    await page.screenshot({ path: resolve(output, 'persistent-engineering-map.png'), fullPage: true });
    await page.goto(state.origin + '/#/study-setup'); await page.getByRole('button', { name: 'Resumo', exact: true }).click(); await page.getByRole('button', { name: 'Versões anteriores do mapa', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Versões anteriores do mapa', exact: true }); await history.waitFor(); assert.equal(await history.locator('[role=alert]').count(), 0);
    await history.getByRole('heading', { name: 'Relatório da leitura atual', exact: true }).waitFor();
    const versions = await get('/projects/' + state.projectId + '/system-history');
    const expectedOmissions = Number(process.env.NORTE_EXPECTED_OMISSIONS || 27);
    assert.equal(versions.extractionReport?.omissions?.length, expectedOmissions);
    assert.equal(await history.locator('.extraction-omission').count(), expectedOmissions);
    await history.getByText(`Pendências de revisão (${expectedOmissions})`, { exact: true }).waitFor();
    if (expectedOmissions) {
      await history.locator('.extraction-omission').last().scrollIntoViewIfNeeded();
      const source = await history.locator('.extraction-omission a').first().getAttribute('href');
      assert.ok(source?.startsWith('/api/artifacts/'));
      const sourceResponse = await context.request.get(state.origin + source); assert.equal(sourceResponse.status(), 200, 'Omission source must remain accessible to the persistent account');
    }
    await page.screenshot({ path: resolve(output, 'persistent-extraction-review.png'), fullPage: true });
    await history.getByRole('button', { name: 'Fechar versões', exact: true }).click();
    map = { status: 'viewed_without_changes', entities: model.entities.length, relationships: model.relations.length, requirements: model.requirements.length, evidence: model.evidence.length, preservedVersions: versions.versions.length, needsReview: Boolean(versions.extractionReport?.needsReview), omissions: versions.extractionReport?.omissions?.length || 0 };
  }
  const after = await get('/projects/' + state.projectId), afterMeetings = await get('/meetings');
  assert.equal(digest(after.project), baseline, 'Viewing the account must preserve all project data');
  assert.equal(afterMeetings.meetings.length, meetings.meetings.length, 'Checking meeting modes must not create a meeting');
  assert.deepEqual(blocked, [], 'The walkthrough must not attempt a model call or data mutation'); assert.deepEqual(errors, []);
  const report = { status: 'passed', validatedAt: new Date().toISOString(), phase, normalLogin: true, teamCount: 1, teamMemberCount: 1, invitedMemberCount: 0, documents: 17, sourceRoles: artifacts.artifacts.reduce((result, artifact) => { const role = artifact.sourceRole || 'project_context'; result[role] = (result[role] || 0) + 1; return result; }, {}), profileVisible: true, profileComplete: Boolean(auth.user.profileComplete), adminMfaProtected: true, learningVisible: true, meetingModes: { withoutMemory: true, projectMemory: true, noMeetingCreated: true }, map, projectDataUnchanged: true, providerCalls: 0, blockedMutations: blocked, secretsRecorded: false };
  await mkdir(output, { recursive: true, mode: 0o700 }); await writeFile(resolve(output, 'persistent-browser-' + phase + '.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never capture the login form containing credentials on failure.
  if (page && await page.locator('.app-header').count()) await page.screenshot({ path: resolve(output, 'persistent-browser-failure.png'), fullPage: true, mask: [page.locator('input[type=password],input[type=email],.account-menu-head span,.activity-scroll tbody')] }).catch(() => {});
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [password, email, state.cookie, state.csrfToken]) if (secret) message = message.replaceAll(secret, '[redacted]');
  // Playwright's original error/cause may include the password passed to fill().
  // eslint-disable-next-line preserve-caught-error -- Never retain private input in diagnostic output.
  throw new Error(message);
} finally { await browser?.close(); }
