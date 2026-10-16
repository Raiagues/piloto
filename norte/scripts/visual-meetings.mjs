/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';

// Real React, Fastify accounts/ACLs and embedded meeting UI. The private engine
// is simulated so this acceptance run spends no provider credits.
const directory = await mkdtemp(join(tmpdir(), 'norte-meetings-browser-'));
const records = new Map(), calls = [], errors = [];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const engine = async (url, options) => {
  const parsed = new URL(url), input = options.body ? JSON.parse(options.body) : null;
  calls.push({ path: parsed.pathname, input, scope: options.headers['x-norte-bridge-scope'] });
  if (parsed.pathname === '/api/health') return json({ ready: true, provider: 'official', engine: 'jev-latest' });
  if (parsed.pathname === '/api/records') {
    const key = options.method === 'GET' ? parsed.searchParams.get('key') : input.key;
    const record = records.get(key) || { value: null, version: 0 };
    if (options.method === 'GET') return json(record);
    if (input.expected_version !== record.version) return json(record, 409);
    const next = { value: input.value, version: record.version + 1 }; records.set(key, next); return json({ version: next.version });
  }
  if (parsed.pathname === '/api/ai/blocks/review') return json({ status: 'disabled', blocks: {}, titles: {} });
  if (parsed.pathname.startsWith('/api/ai/')) return json({ aliases: [], accepted: true });
  const answers = Object.fromEntries(Object.entries(input.questions).map(([id, question]) => {
    if (question.type === 'noul') return [id, { type: 'noul', noul: .99 }];
    const choices = Object.keys(question.criteria);
    const desired = id === 'command_type' ? 'conversation' : id === 'event_type' ? 'observation' : id === 'belongs_to_active_thread' ? 'belongs' : id.startsWith('belongs_to_archive_thread__') ? 'does_not_belong' : id.startsWith('relation_type__') ? 'none' : id.startsWith('configuration_match__') ? 'not_applicable' : id === 'speech_status' ? 'finished' : 'separate';
    const choice = choices.includes(desired) ? desired : choices[0];
    return [id, { type: 'choice', choice, confidence: .99, probabilities: Object.fromEntries(choices.map(value => [value, value === choice ? .99 : .01 / Math.max(1, choices.length - 1)])) }];
  }));
  return json({ provider: 'official', latencyMs: 2, request: input, response: { model: 'browser-fixture', answers } });
};
const app = await buildApp({ storeFile: join(directory, 'state.json'), logger: false, ai: { apiKey: '' }, meetingGateway: { secret: 'local-browser-bridge-secret-at-least-32-characters', fetchImpl: engine } });
const port = Number(process.env.NORTE_MEETINGS_VISUAL_PORT || 5297), origin = `http://127.0.0.1:${port}`;
process.env.NORTE_ALLOWED_ORIGINS = origin;
let browser, vite, hostPage;
const actors = [];
try {
  for (const [name, nickname] of [['Host Test', 'host_visual'], ['Guest Test', 'guest_visual'], ['Outside Test', 'outside_visual']]) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name, nickname, email: nickname + '@example.test', password: 'meeting browser test passphrase 2026' } });
    assert.equal(response.statusCode, 201, response.body);
    actors.push({ ...response.json(), cookie: response.headers['set-cookie'].split(';')[0] });
  }
  await app.listen({ host: '127.0.0.1', port: 0 });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { env: { ...process.env, VITE_DEMO_MODE: 'false', VITE_API_PROXY_TARGET: `http://127.0.0.1:${app.server.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Vite startup timeout')), 25_000); vite.stdout.on('data', chunk => { if (String(chunk).includes('Local:')) { clearTimeout(timer); resolve(); } }); vite.once('exit', code => { clearTimeout(timer); reject(new Error('Vite exited ' + code)); }); });
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const account = async actor => {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1000 }, permissions: ['microphone'] });
    const split = actor.cookie.indexOf('='); await context.addCookies([{ name: actor.cookie.slice(0, split), value: actor.cookie.slice(split + 1), url: origin }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.localStorage.setItem('norte-language', 'pt');
      // Speech recognition is stubbed independently; peer audio remains actual WebRTC.
      class TestSpeechRecognition { start() { window.queueMicrotask(() => this.onstart?.()); } stop() { window.queueMicrotask(() => this.onend?.()); } abort() { this.stop(); } }
      window.SpeechRecognition = window.webkitSpeechRecognition = TestSpeechRecognition;
      const Native = window.RTCPeerConnection; window.__audioPeers = [];
      window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__audioPeers.push(this); } };
    });
    await page.goto(origin + '/norte/#/meetings'); return { context, page };
  };
  const host = await account(actors[0]); hostPage = host.page;
  await host.page.getByRole('button', { name: 'Nova reunião', exact: true }).click();
  await host.page.getByLabel('Título', { exact: true }).fill('Revisão colaborativa');
  await host.page.getByLabel('Quem participa').selectOption('private');
  await host.page.getByRole('button', { name: 'Criar e abrir', exact: true }).click();
  const frame = host.page.frameLocator('.meetings-frame');
  await frame.locator('#roomText').waitFor({ timeout: 30_000 });
  assert.equal(await frame.locator('#roomTitle').isVisible(), false);
  assert.equal(await frame.locator('#roomSessionBar').isVisible(), false);
  assert.equal(await frame.locator('#roomTranscriptPanel').isVisible(), true);
  await host.page.getByRole('button', { name: 'Editar título da reunião' }).click();
  await host.page.getByLabel('Título da reunião', { exact: true }).fill('Revisão colaborativa editada');
  await host.page.getByRole('button', { name: 'Salvar título' }).click();
  await host.page.getByRole('heading', { name: 'Revisão colaborativa editada', exact: true }).waitFor();
  const meeting = Object.values(app.missionStore.read().meetings)[0]; assert.ok(meeting);
  assert.equal(meeting.memoryMode, 'none'); assert.equal(meeting.participantIds.length, 0);
  await host.page.getByRole('button', { name: 'Participantes e convites' }).click();
  await host.page.getByLabel('Convidar por nickname').fill('guest_visual');
  await host.page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await host.page.getByText('Convite enviado.', { exact: true }).waitFor();
  await host.page.getByRole('button', { name: 'Fechar participantes' }).click();
  const guest = await account(actors[1]);
  await guest.page.getByRole('button', { name: 'Aceitar e abrir' }).click();
  const guestFrame = guest.page.frameLocator('.meetings-frame');
  await guestFrame.locator('#roomText').waitFor({ timeout: 30_000 });
  assert.equal(await guestFrame.locator('#roomTitle').getAttribute('readonly'), '');
  assert.equal(await guestFrame.locator('#roomLive').isVisible(), false);
  await guestFrame.locator('#roomText').fill('A estrutura do satélite usa alumínio.');
  await guestFrame.locator('#roomSend').click();
  await frame.locator('#roomText').fill('Precisamos revisar a estrutura e a alimentação.');
  await frame.locator('#roomSend').click();
  await host.page.getByRole('button', { name: 'Entrar no áudio', exact: true }).click();
  await guest.page.getByRole('button', { name: 'Entrar no áudio', exact: true }).click();
  for (const page of [host.page, guest.page]) {
    await page.locator('[data-audio-connected="1"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(async () => { for (const peer of window.__audioPeers) { for (const report of (await peer.getStats()).values()) if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.bytesReceived > 0) return true; } return false; }, { timeout: 15000 });
  }
  assert.equal(await guest.page.locator('.meeting-audio-controls').getAttribute('data-recording'), 'false', 'typed messages do not start voice capture');
  await frame.locator('#roomLive').click();
  await guest.page.locator('[data-recording="true"]').waitFor({ timeout: 10000 });
  await frame.locator('#roomLive').click();
  await guest.page.locator('[data-recording="false"]').waitFor({ timeout: 10000 });
  await guest.page.getByRole('button', { name: 'Silenciar microfone', exact: true }).click();
  assert.equal(await guest.page.evaluate(() => window.__audioPeers.every(peer => peer.getSenders().every(sender => !sender.track || !sender.track.enabled))), true);
  await host.page.waitForFunction(() => [...document.querySelectorAll('audio[data-meeting-audio-peer]')].every(audio => audio.muted));
  await guest.page.getByRole('button', { name: 'Ativar microfone', exact: true }).click();
  await host.page.getByRole('button', { name: 'Participantes e convites' }).click();
  await host.page.getByRole('button', { name: 'Silenciar Guest Test', exact: true }).click();
  await guest.page.getByRole('button', { name: 'Silenciado pelo anfitrião', exact: true }).waitFor();
  assert.equal(await guest.page.evaluate(() => window.__audioPeers.every(peer => peer.getSenders().every(sender => !sender.track || !sender.track.enabled))), true);
  await host.page.getByRole('button', { name: 'Permitir microfone de Guest Test', exact: true }).click();
  await guest.page.getByRole('button', { name: 'Ativar microfone', exact: true }).waitFor();
  assert.equal(await guest.page.evaluate(() => window.__audioPeers.every(peer => peer.getSenders().every(sender => !sender.track || !sender.track.enabled))), true, 'host release never silently unmutes');
  await host.page.getByRole('button', { name: 'Fechar participantes' }).click();
  await guest.page.getByRole('button', { name: 'Sair do áudio', exact: true }).click();
  await host.page.getByRole('button', { name: 'Sair do áudio', exact: true }).click();
  await host.page.waitForFunction(() => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.meeting_events?.some(event => event.text.includes('alumínio')), { timeout: 30_000 });
  await guest.page.waitForFunction(() => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.meeting_events?.some(event => event.text.includes('alumínio')), { timeout: 30_000 });
  await frame.locator('#roomFinish').click();
  await host.page.waitForFunction(() => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.status === 'done');
  const key = 'norte.meeting-room.session.v2.' + meeting.id;
  const saved = JSON.parse(records.get(key).value);
  assert.equal(saved.title, 'Revisão colaborativa editada'); assert.equal(saved.id, meeting.id); assert.equal(saved.integrated_norte, true); assert.equal(saved.transcript.filter(item => item.text.includes('alumínio')).length, 1);
  assert.equal(calls.some(call => call.input?.state?.project_memory), false, 'memory-off sends no project context');
  const outsider = await app.inject({ method: 'GET', url: '/api/meetings/' + meeting.id, headers: { cookie: actors[2].cookie } }); assert.equal(outsider.statusCode, 404);
  const denied = await app.inject({ method: 'POST', url: '/api/meetings/' + meeting.id + '/legacy/records', headers: { cookie: actors[1].cookie, 'x-csrf-token': actors[1].csrfToken }, payload: { key, value: JSON.stringify(saved), expected_version: records.get(key).version } }); assert.equal(denied.statusCode, 403);
  await host.page.screenshot({ path: '/tmp/norte-integrated-meeting.png', fullPage: true });
  await host.page.setViewportSize({ width: 390, height: 844 }); await host.page.screenshot({ path: '/tmp/norte-integrated-meeting-mobile.png', fullPage: true });
  assert.equal(await host.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(errors, []);
  console.log('PASS: two-way real WebRTC packets, self/host mute and consent release, title editor, transcript chat, authenticated Norte meeting, memory off, consent invite, two accounts, host-only processing, contribution once, guest live state, persistence, isolation and mobile layout.');
} catch (error) {
  if (hostPage) await hostPage.screenshot({ path: '/tmp/norte-integrated-meeting-failure.png', fullPage: true }).catch(() => {});
  console.error('Browser errors:', errors); throw error;
} finally { await browser?.close(); vite?.kill('SIGTERM'); await app.close(); await rm(directory, { recursive: true, force: true }); }
