/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { totp } from '../server/platform-security.mjs';
// Actual session processing, fixture answers, real accounts/MFA/ACL, no paid calls.
const require = createRequire(import.meta.url), Session = require('../../meetings/web/meeting-session.js');
const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/memory-b002-reviewed.json', import.meta.url), 'utf8'));
const speeches = fixture.cases.filter(item => item.expected_store_memory).slice(0, 3);
const directory = await mkdtemp(join(tmpdir(), 'norte-observability-visual-'));
const password = 'isolated observability admin password', requests = [], errors = [];
let run, memories, meetingId, browser, vite, page;
const send = async input => {
  const row = speeches.find(item => item.current_utterance === input.state.current_utterance);
  const answers = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => {
    if (question.type === 'noul') return [id, { type: 'noul', noul: .99 }];
    const choices = Object.keys(question.criteria);
    const desired = id === 'command_type' ? 'conversation' : id === 'event_type' ? row?.expected_event_type : id === 'belongs_to_active_thread' ? 'belongs' : id.startsWith('belongs_to_archive_thread__') ? 'does_not_belong' : id.startsWith('relation_type__') ? 'none' : id.startsWith('configuration_match__') ? 'not_applicable' : 'finished';
    const choice = choices.includes(desired) ? desired : choices[0];
    return [id, { type: 'choice', choice, confidence: .99, probabilities: Object.fromEntries(choices.map(value => [value, value === choice ? .99 : .01 / Math.max(1, choices.length - 1)])) }];
  }));
  return { provider: 'official', latencyMs: 2, request: structuredClone(input), response: { model: 'fixture-jev-no-network', answers } };
};
const engine = async (url, options) => {
  const path = new URL(url).pathname;
  requests.push({ path, scope: options.headers['x-norte-bridge-scope'] });
  assert.equal(options.headers['x-norte-bridge-scope'], 'meeting:' + meetingId);
  if (path === '/api/records') return Response.json({ value: JSON.stringify(run), version: 1 });
  if (path === '/api/ai/blocks/inspect') return Response.json(memories);
  throw Error('Unexpected provider path: ' + path);
};
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, ai: { apiKey: '' }, platform: { encryptionKey: 'isolated-observability-mfa-key-more-than-32-characters' }, meetingGateway: { secret: 'isolated-observability-bridge-key-more-than-32-characters', fetchImpl: engine } });
const api = (actor, method, path, payload) => app.inject({ method, url: '/api' + path, headers: actor?.headers || {}, ...(payload !== undefined ? { payload } : {}) });
const account = async (name, login) => {
  const response = await api(null, 'POST', '/auth/register', { name, login, password }); assert.equal(response.statusCode, 201, response.body);
  return { ...response.json(), headers: { cookie: response.headers['set-cookie'].split(';')[0], 'x-csrf-token': response.json().csrfToken } };
};
try {
  const admin = await account('Admin do teste visual', 'map_admin'); assert.equal(admin.user.accessRole, 'owner_admin');
  const ordinary = await account('Conta comum do teste', 'map_regular');
  const enrolled = await api(admin, 'POST', '/platform/admin/security/enroll', { password }); assert.equal(enrolled.statusCode, 200, enrolled.body);
  const verified = await api(admin, 'POST', '/platform/admin/security/verify', { code: totp(enrolled.json().secret, Math.floor(Date.now() / 30000)) }); assert.equal(verified.statusCode, 200, verified.body);
  assert.equal((await api(admin, 'GET', '/platform/admin/people')).statusCode, 200);
  const created = await api(admin, 'POST', '/meetings', { title: 'Inspeção de suporte · fixture', scope: 'private' }); assert.equal(created.statusCode, 201, created.body); meetingId = created.json().meeting.id;
  const session = Session.create({ title: 'Inspeção de suporte · fixture', send });
  session.run.id = meetingId; session.run.batch.batch_id = meetingId;
  for (const [index, speech] of speeches.entries()) session.append(speech.current_utterance, { source: 'text', speaker: 'Engenharia · fixture', offsetMs: index * 10000 });
  run = await session.close(); assert.equal(run.status, 'done'); assert.equal(run.records.length, 3); assert.equal(run.meeting_events.length, 3);
  const source = run.meeting_events[0].text;
  memories = { external_context: false, editorial_total: 1, editorial: [{ key: 'fixture-editorial', kind: 'block', source, text: source, origin: 'human', version: 2, enabled: true }], learning: { version: 1, scope: 'meeting', session_id: meetingId, examples: [{ event_id: run.meeting_events[0].event_id, source, label: speeches[0].expected_event_type, original_label: 'other', status: 'human_example' }], history: [{ version: 1, action: 'correct' }] } };
  const report = await api(admin, 'GET', `/admin/meetings/${meetingId}/observability`); assert.equal(report.statusCode, 200, report.body); assert.equal(report.json().traces.length, 3);
  assert.equal((await api(ordinary, 'GET', `/admin/meetings/${meetingId}/observability`)).statusCode, 403);
  const outside = await api(ordinary, 'POST', '/meetings', { title: 'Privada da conta comum' }), before = requests.length;
  assert.equal((await api(admin, 'GET', `/admin/meetings/${outside.json().meeting.id}/observability`)).statusCode, 404); assert.equal(requests.length, before);
  const originApi = await app.listen({ host: '127.0.0.1', port: 0 });
  process.env.VITE_BASE_PATH = '/'; process.env.VITE_API_PROXY_TARGET = originApi;
  const webRoot = fileURLToPath(new URL('../', import.meta.url));
  vite = await createServer({ root: webRoot, configFile: join(webRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 5391, strictPort: true, hmr: false } }); await vite.listen();
  const origin = 'http://127.0.0.1:5391';
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const cookie = admin.headers.cookie, index = cookie.indexOf('='); await context.addCookies([{ name: cookie.slice(0, index), value: cookie.slice(index + 1), url: origin }]);
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => window.localStorage.setItem('norte-language', 'pt'));
  await page.goto(origin + '/#/admin/meetings', { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: 'Fluxo das reuniões', exact: true }).waitFor();
  const detail = page.locator('.observability-detail'), map = page.locator('.observability-map');
  await detail.getByRole('heading', { name: 'Texto recebido', exact: true }).waitFor(); assert.ok((await detail.innerText()).includes(source));
  // Memory v3 answers the filter and the event type in one recorded call.
  await map.getByRole('button', { name: 'Filtro e classificação', exact: true }).click(); await detail.getByRole('heading', { name: 'Filtro e classificação', exact: true }).waitFor();
  for (const token of ['current_utterance', 'Perguntas e critérios', 'Classificações retornadas', 'should_store_memory', 'event_type', 'observation']) assert.ok((await detail.innerText()).includes(token), token); assert.match(await detail.innerText(), /fixture-jev-no-network/);
  await page.screenshot({ path: '/tmp/norte-meeting-observability-classification.png', fullPage: true });
  await map.getByRole('button', { name: 'Blocos', exact: true }).click(); await detail.getByRole('heading', { name: 'Blocos produzidos', exact: true }).waitFor(); assert.ok((await detail.innerText()).includes(source));
  await page.locator('.observability-workspace>aside>button').nth(1).click(); await detail.getByRole('heading', { name: 'Texto recebido', exact: true }).waitFor(); assert.ok((await detail.innerText()).includes(speeches[1].current_utterance));
  await map.getByRole('button', { name: 'Assunto', exact: true }).click(); assert.match(await detail.innerText(), /topic_assignment/);
  const memory = page.locator('.observability-memories');
  await memory.getByText('Janela transitória de fala', { exact: true }).click(); await memory.getByText('Correções humanas para o JEV · v1', { exact: true }).click(); await memory.locator('summary').filter({ hasText: 'Resumos editoriais' }).click();
  assert.match(await memory.innerText(), /human_example|human · v2|original_label/); assert.ok((await memory.innerText()).includes(source));
  await memory.screenshot({ path: '/tmp/norte-meeting-observability-memories.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('heading', { name: 'Fluxo das reuniões', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '/tmp/norte-meeting-observability-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile must not overflow horizontally');
  assert.deepEqual(errors, []); assert.ok(requests.every(request => ['/api/records', '/api/ai/blocks/inspect'].includes(request.path)));
  console.log('PASS: populated admin map, real session fixture processing, MFA, ordinary-account denial, private-meeting ACL, input/questions/answers, topic and block navigation, real-shape memories, mobile, no paid calls.');
} catch (error) { await page?.screenshot({ path: '/tmp/norte-meeting-observability-failure.png', fullPage: true }).catch(() => {}); throw error;
} finally { await browser?.close(); await vite?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
