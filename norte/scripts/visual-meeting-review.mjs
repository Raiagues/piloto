/* global window, document, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { createValidationProject } from '../server/data-store.mjs';
import { seedMeetingExamples } from './seed-meeting-examples.mjs';
// Isolated accounts/store and an offline provider fixture. Never loads .env.
const directory = await mkdtemp(join(tmpdir(), 'norte-meeting-review-')), output = resolve('../.runtime/validation'), origin = 'http://127.0.0.1:5337';
const records = new Map(), calls = [], errors = [];
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, demoAccount: false, ai: { apiKey: '' }, systemAi: { apiKey: '' }, meetingGateway: { secret: 'offline-meeting-review-at-least-32-characters', fetchImpl: async (url, options) => {
  calls.push(url.pathname); const input = options.body ? JSON.parse(options.body) : {};
  if (url.pathname === '/api/records') {
    const key = options.method === 'GET' ? url.searchParams.get('key') : input.key, old = records.get(key) || { value: null, version: 0 };
    if (options.method === 'GET') return Response.json(old);
    if (input.expected_version !== old.version) return Response.json(old, { status: 409 });
    const next = { value: input.value, version: old.version + 1 }; records.set(key, next); return Response.json({ version: next.version });
  }
  if (url.pathname === '/api/minutes') return Response.json({ topics: input.source.threads.map(thread => ({ thread_id: thread.thread_id, entries: input.source.events.filter(event => event.thread_id === thread.thread_id).map(event => ({ event_id: event.event_id, text: event.text.length <= 180 ? event.text : event.text.slice(0, 170).replace(/\s+\S*$/, '') + '…' })) })), warnings: [] });
  if (url.pathname === '/api/ai/blocks/review') return Response.json({ status: 'disabled', review: { blocks: {}, titles: {} } });
  return Response.json({ ready: true, provider: 'official', aliases: [] });
} } });
let browser, vite, page;
try {
  const signup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Revisora Local', nickname: 'meeting_reviewer', email: 'meeting-review@example.test', password: 'offline browser meeting passphrase' } }); assert.equal(signup.statusCode, 201, signup.body);
  const actor = signup.json(), headers = { cookie: signup.headers['set-cookie'].split(';')[0], 'x-csrf-token': actor.csrfToken };
  const teamResponse = await app.inject({ method: 'POST', url: '/api/teams', headers, payload: { name: 'Equipe do exemplo' } }); assert.equal(teamResponse.statusCode, 201); const team = teamResponse.json().team;
  const project = createValidationProject(); project.id = 'meeting-review-project'; project.context.teamId = team.id; project.context.teamName = team.name; project.context.assignments = [{ memberId: actor.user.memberId, roleId: 'captain', sectorId: '' }]; project.context.sectors = [{ id: 'systems', name: 'Sistemas' }];
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers, payload: project })).statusCode, 201);
  await app.missionStore.update(data => { data.environment = 'quetzal-workspace-test'; });
  const seeded = seedMeetingExamples(app.missionStore.read(), { projectId: project.id, actorId: actor.user.id, allowLocalTest: true }); await app.missionStore.update(data => { data.meetings = seeded.data.meetings; });
  const id = seeded.audit.meetingIds[0], original = JSON.stringify(app.missionStore.read().meetings[id].exampleSnapshot);
  process.env.NORTE_ALLOWED_ORIGINS = origin; await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.VITE_DEMO_MODE = 'false'; process.env.VITE_BASE_PATH = '/'; process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${app.server.address().port}`;
  vite = await createServer({ server: { host: '127.0.0.1', port: 5337, strictPort: true, hmr: false } }); await vite.listen();
  browser = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), split = headers.cookie.indexOf('='); await context.addCookies([{ name: headers.cookie.slice(0, split), value: headers.cookie.slice(split + 1), url: origin }]);
  await context.addInitScript(() => window.localStorage.setItem('norte-language', 'pt')); page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/?meeting=' + id + '#/meetings'); let frame = page.frameLocator('.meetings-frame'); await frame.locator('#roomBoard .room-node').first().waitFor({ timeout: 30000 });
  assert.equal(await frame.locator('#roomLive').isVisible(), true); assert.equal(await frame.locator('#roomLive').isDisabled(), true); assert.equal(await frame.locator('#roomTimer').innerText(), '25:00');
  assert.equal(await frame.locator('#roomMinutes').isEnabled(), true); assert.equal(await frame.locator('.room-legend').isVisible(), false);
  assert.match(await frame.locator('.mc-node-copy').first().innerText(), /Hipótese: imagens sem compressão/);
  assert.ok(await frame.locator('.mc-node-copy').first().evaluate(node => Number(getComputedStyle(node).webkitLineClamp) === 2));
  await frame.locator('.mc-node-text').first().click(); await frame.locator('.room-diagnostics[open]').waitFor(); assert.equal(await frame.locator('.room-diagnostics pre').count(), 0); await frame.getByRole('button', { name: 'Fechar', exact: true }).click();
  await frame.locator('#roomMinutes').click(); await frame.locator('#gmDialog').waitFor(); assert.equal(await frame.locator('#gmOrganize').isVisible(), false); assert.equal(await frame.locator('.gm-test-form').count(), 0);
  const download = page.waitForEvent('download'); await frame.locator('#gmPDF').click(); const pdf = await download, pdfPath = join(directory, 'mock.pdf'); await pdf.saveAs(pdfPath); assert.ok((await readFile(pdfPath)).length > 1000);
  const pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' }); assert.match(pdfText, /Alinhamento geral/); assert.match(pdfText, /Pendências/); assert.doesNotMatch(pdfText, /Histórico da discussão/); assert.equal(calls.includes('/api/minutes'), false); assert.match(pdfText, /Hipótese: imagens sem compressão/); assert.doesNotMatch(pdfText, /Voltando à tela inicial/);
  await frame.getByRole('button', { name: 'Fechar', exact: true }).click(); await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'meeting-compact-mock.png'), fullPage: true });
  await page.getByRole('button', { name: 'Editar uma cópia', exact: true }).click(); await page.getByRole('heading', { name: /^Cópia/ }).waitFor(); frame = page.frameLocator('.meetings-frame'); await frame.getByRole('button', { name: 'Editar resumo do bloco', exact: true }).first().waitFor();
  const copy = Object.values(app.missionStore.read().meetings).find(meeting => meeting.copiedFromExample === id); assert.ok(copy); const sourceText = seeded.data.meetings[id].exampleSnapshot.meeting_events[0].text;
  await frame.getByRole('button', { name: 'Editar resumo do bloco', exact: true }).first().click(); await frame.getByLabel('Resumo para exibição', { exact: true }).fill('Resumo revisado pela equipe.'); await frame.getByRole('button', { name: 'Salvar resumo', exact: true }).click(); await frame.locator('.mc-node-copy').filter({ hasText: 'Resumo revisado pela equipe.' }).waitFor();
  await page.reload(); frame = page.frameLocator('.meetings-frame'); await frame.locator('.mc-node-copy').filter({ hasText: 'Resumo revisado pela equipe.' }).waitFor(); assert.equal(JSON.parse(records.get('norte.meeting-room.session.v2.' + copy.id).value).meeting_events[0].text, sourceText);
  await frame.locator('#roomMinutes').click(); await frame.locator('#gmOrganize').click(); await frame.getByRole('button', { name: 'Organizar novamente', exact: true }).waitFor(); assert.equal(calls.filter(path => path === '/api/minutes').length, 1);
  await frame.getByRole('button', { name: 'Fechar', exact: true }).click(); await page.screenshot({ path: join(output, 'meeting-editable-copy.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ativar tema claro', exact: true }).click();
  await frame.locator('html[data-theme=light]').waitFor(); await frame.locator('#roomMinutes').click(); await frame.locator('#gmDialog').waitFor();
  await page.screenshot({ path: join(output, 'meeting-pdf-light.png'), fullPage: true }); await frame.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Ativar tema escuro', exact: true }).click();
  await page.getByRole('button', { name: 'Dispensar aviso de exemplo', exact: true }).click(); assert.equal(await page.locator('.meeting-example-note').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250); await page.screenshot({ path: join(output, 'meeting-compact-mobile.png'), fullPage: true }); const geometry = await frame.locator('#roomMinutes').evaluate(node => ({ right: node.getBoundingClientRect().right, width: window.innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(geometry.right <= geometry.width + 1, JSON.stringify(geometry)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.equal(JSON.stringify(app.missionStore.read().meetings[id].exampleSnapshot), original); assert.deepEqual(errors, []);
  await writeFile(join(output, 'meeting-review-browser.json'), JSON.stringify({ passed: true, externalCalls: 0, checks: ['completed_microphone_and_timer', 'two_line_cards', 'human_details_no_json', 'mock_pdf_actual_download', 'no_history_in_pdf', 'private_editable_copy', 'manual_summary_persists', 'immutable_original', 'ai_minutes_offline_fixture', 'dismissible_mock_note', 'mobile_no_overflow'], at: new Date().toISOString() }, null, 2));
  console.log('PASS: compact completed meeting, mock PDF download, private copy, manual edit/reload, original preserved, offline AI minutes and mobile.');
} catch (error) { await page?.screenshot({ path: '/tmp/norte-meeting-review-failure.png', fullPage: true }).catch(() => {}); console.error('Browser errors:', errors); throw error; }
finally { await browser?.close(); await vite?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
