/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';

// Real React, Fastify accounts/ACLs and embedded meeting UI. The private engine
// is simulated so this acceptance run spends no provider credits.
const directory = await mkdtemp(join(tmpdir(), 'norte-meetings-browser-'));
const records = new Map(), calls = [], errors = [], joinRequests = [];
let releaseInitialHealth, healthPending = false, healthReleased = false;
const initialHealth = new Promise(resolve => { releaseInitialHealth = resolve; });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const engine = async (url, options) => {
  const parsed = new URL(url), input = options.body ? JSON.parse(options.body) : null;
  calls.push({ path: parsed.pathname, input, scope: options.headers['x-norte-bridge-scope'] });
  if (parsed.pathname === '/api/health') { if (!healthReleased) { healthPending = true; await initialHealth; } return json({ ready: true, provider: 'official', engine: 'jev-latest' }); }
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
  process.env.VITE_DEMO_MODE = 'false'; process.env.VITE_BASE_PATH = '/norte/'; process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${app.server.address().port}`;
  vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true, hmr: false } }); await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.NORTE_CHROME || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const account = async actor => {
    const context = await browser.newContext({ viewport: { width: 1512, height: 1000 }, permissions: ['microphone'] });
    const split = actor.cookie.indexOf('='); await context.addCookies([{ name: actor.cookie.slice(0, split), value: actor.cookie.slice(split + 1), url: origin }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && /^\/api\/meetings\/[^/]+\/join$/.test(new URL(request.url()).pathname)) joinRequests.push({ userId: actor.user.id, path: new URL(request.url()).pathname }); });
    await page.addInitScript(() => {
      window.localStorage.setItem('norte-language', 'pt');
      // Speech recognition is stubbed independently; peer audio remains actual WebRTC.
      class TestSpeechRecognition { start() { window.queueMicrotask(() => this.onstart?.()); } stop() { window.queueMicrotask(() => this.onend?.()); } abort() { this.stop(); } }
      window.SpeechRecognition = window.webkitSpeechRecognition = TestSpeechRecognition;
      const Native = window.RTCPeerConnection; window.__audioPeers = [];
      window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); window.__audioPeers.push(this); } };
      if (window.parent !== window && window.location.pathname.startsWith('/meeting/')) {
        const captureFirstRoomPaint = () => {
          const layout = document.querySelector('.app-shell');
          if (!document.body || !layout?.getClientRects().length) { window.requestAnimationFrame(captureFirstRoomPaint); return; }
          const rootStyle = window.getComputedStyle(document.documentElement), bodyStyle = window.getComputedStyle(document.body);
          const colorContext = document.createElement('canvas').getContext('2d');
          const normalize = value => { colorContext.fillStyle = value; return colorContext.fillStyle; };
          window.__firstRoomPaint = {
            theme: document.documentElement.dataset.theme, parentTheme: window.parent.document.documentElement.dataset.theme,
            token: normalize(rootStyle.getPropertyValue('--norte-bg').trim()),
            rootBackground: normalize(rootStyle.backgroundColor), bodyBackground: normalize(bodyStyle.backgroundColor),
            controls: [...document.querySelectorAll('#roomLive,#roomMinutes,#roomSend')].map(button => ({
              id: button.id, background: window.getComputedStyle(button).backgroundColor, color: window.getComputedStyle(button).color
            }))
          };
        };
        window.requestAnimationFrame(captureFirstRoomPaint);
      }
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
  await host.page.waitForFunction(() => Boolean(document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.id));
  const firstPaint = await frame.locator('body').evaluate(() => window.__firstRoomPaint);
  assert.equal(firstPaint.theme, 'light', JSON.stringify(firstPaint));
  assert.equal(firstPaint.parentTheme, 'light');
  assert.equal(firstPaint.rootBackground, firstPaint.token, JSON.stringify(firstPaint));
  assert.equal(firstPaint.bodyBackground, firstPaint.token, JSON.stringify(firstPaint));
  assert.ok(firstPaint.controls.length > 0, 'capture includes the room controls before interactions');
  assert.equal(healthPending, true); assert.equal(healthReleased, false, 'the room and its record open before processing health completes');
  healthReleased = true; releaseInitialHealth();
  assert.equal(await frame.locator('#roomTitle').isVisible(), false);
  assert.equal(await frame.locator('#roomSessionBar').isVisible(), false);
  assert.equal(await frame.locator('#roomTranscriptPanel').isVisible(), true);
  let forcedMetadataRace = false;
  await host.page.route('**/api/meetings/*', async route => {
    if (route.request().method() === 'PATCH' && !forcedMetadataRace) {
      forcedMetadataRace = true;
      await app.missionStore.update(data => { const id = new URL(route.request().url()).pathname.split('/').at(-1); data.meetings[id].revision++; });
    }
    await route.continue();
  });
  await host.page.getByRole('button', { name: 'Editar título da reunião' }).click();
  await host.page.getByLabel('Título da reunião', { exact: true }).fill('Revisão colaborativa editada');
  await host.page.getByRole('button', { name: 'Salvar título' }).click();
  await host.page.getByRole('heading', { name: 'Revisão colaborativa editada', exact: true }).waitFor();
  const meeting = Object.values(app.missionStore.read().meetings)[0]; assert.ok(meeting);
  assert.equal(meeting.memoryMode, undefined); assert.equal(meeting.participantIds.length, 0);
  assert.equal(joinRequests.length, 0, 'creating and opening one’s own meeting does not repeat join');
  await host.page.getByRole('button', { name: 'Participantes e convites' }).click();
  await host.page.getByLabel('Convidar por nickname').fill('guest_visual');
  await host.page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await host.page.getByText('Convite enviado.', { exact: true }).waitFor();
  await host.page.getByRole('button', { name: 'Fechar participantes' }).click();
  const guest = await account(actors[1]);
  await guest.page.getByRole('button', { name: 'Aceitar e abrir' }).click();
  const guestFrame = guest.page.frameLocator('.meetings-frame');
  await guestFrame.locator('#roomText').waitFor({ timeout: 30_000 });
  assert.equal(joinRequests.length, 0, 'an accepted private participant can open without another join write');
  assert.equal(await guestFrame.locator('#roomTitle').getAttribute('readonly'), '');
  // The Norte meeting bar shows the guest the live state; only the host gets the recording button.
  assert.equal(await guest.page.locator('.meeting-record').count(), 0);
  await guest.page.locator('.meeting-record-status').waitFor();
  assert.equal(await frame.locator('#meetingHeader').isVisible(), false, 'the room has no second header row');
  await guestFrame.locator('#roomText').fill('A estrutura do satélite usa alumínio.');
  await guestFrame.locator('#roomSend').click();
  await frame.locator('#roomText').fill('Precisamos revisar a estrutura e a alimentação.');
  await frame.locator('#roomSend').click();
  await host.page.getByRole('button', { name: 'Entrar no áudio da equipe', exact: true }).click();
  await guest.page.getByRole('button', { name: 'Entrar no áudio da equipe', exact: true }).click();
  for (const page of [host.page, guest.page]) {
    await page.locator('[data-audio-connected="1"]').waitFor({ timeout: 30000 });
    await page.waitForFunction(async () => { for (const peer of window.__audioPeers) { for (const report of (await peer.getStats()).values()) if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.bytesReceived > 0) return true; } return false; }, { timeout: 15000 });
  }
  assert.equal(await guest.page.locator('.meeting-bar-center').getAttribute('data-recording'), 'false', 'typed messages do not start voice capture');
  const record = host.page.locator('.meeting-record');
  assert.equal(await record.evaluate(button => { const bar = button.closest('.meeting-bar').getBoundingClientRect(), box = button.getBoundingClientRect(); return Math.abs(box.left + box.width / 2 - (bar.left + bar.width / 2)) < bar.width * .2; }), true, 'recording sits in the middle of the meeting bar');
  await record.click();
  await guest.page.locator('[data-recording="true"]').waitFor({ timeout: 10000 });
  await record.click();
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
  await host.page.getByRole('button', { name: 'Encerrar', exact: true }).click();
  await host.page.waitForFunction(() => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.status === 'done');
  const key = 'norte.meeting-room.session.v2.' + meeting.id;
  const saved = JSON.parse(records.get(key).value);
  assert.equal(saved.title, 'Revisão colaborativa editada'); assert.equal(saved.id, meeting.id); assert.equal(saved.integrated_norte, true); assert.equal(saved.transcript.filter(item => item.text.includes('alumínio')).length, 1);
  assert.equal(calls.some(call => call.input?.state?.project_memory), false, 'memory-off sends no project context');
  const outsider = await app.inject({ method: 'GET', url: '/api/meetings/' + meeting.id, headers: { cookie: actors[2].cookie } }); assert.equal(outsider.statusCode, 404);
  const denied = await app.inject({ method: 'POST', url: '/api/meetings/' + meeting.id + '/legacy/records', headers: { cookie: actors[1].cookie, 'x-csrf-token': actors[1].csrfToken }, payload: { key, value: JSON.stringify(saved), expected_version: records.get(key).version } }); assert.equal(denied.statusCode, 403);
  // A concluded meeting can be continued by its host; the minutes replace the old back button on the right.
  await host.page.getByRole('button', { name: /Continuar gravação/ }).waitFor();
  assert.equal(await host.page.locator('.meeting-record time').isVisible(), true);
  await host.page.locator('.meeting-minutes-button:not([disabled])').waitFor();
  assert.equal(await host.page.locator('.meeting-back').count(), 0);
  assert.equal(await host.page.locator('.app-header-back').count(), 1, 'back lives in the application header');
  assert.ok(await host.page.locator('.meeting-avatar').first().evaluate(node => window.getComputedStyle(node).borderRadius === '50%'), 'participant bubbles are round');
  await host.page.locator('.meeting-minutes-button').click();
  await host.page.waitForFunction(() => new window.URLSearchParams(window.location.search).get('view') === 'minutes');
  await frame.locator('.gm-page').waitFor();
  assert.equal(await frame.locator('#gmDialog').evaluate(node => node.tagName), 'SECTION');
  await host.page.locator('.app-header-back').click();
  await frame.locator('.gm-page').waitFor({ state: 'detached' });
  assert.equal(await host.page.evaluate(() => new window.URLSearchParams(window.location.search).get('meeting')), meeting.id);
  await host.page.evaluate(() => { const url = new window.URL(window.location.href); url.searchParams.set('view','minutes'); window.history.replaceState(null,'',url); window.dispatchEvent(new window.PopStateEvent('popstate')); });
  await frame.locator('.gm-page').waitFor();
  await host.page.locator('.meeting-minutes-button').click();
  await frame.locator('.gm-page').waitFor({ state: 'detached' });
  assert.equal(await host.page.evaluate(() => document.querySelector('.app-content').scrollHeight <= document.querySelector('.app-content').clientHeight + 1), true, 'the open meeting fits the viewport without page scrolling');
  await host.page.screenshot({ path: '/tmp/norte-integrated-meeting.png', fullPage: true });
  await host.page.setViewportSize({ width: 390, height: 844 }); await host.page.screenshot({ path: '/tmp/norte-integrated-meeting-mobile.png', fullPage: true });
  assert.equal(await host.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await host.page.locator('.app-header-back').click();await host.page.locator('.meetings-list').waitFor();assert.equal(await host.page.evaluate(() => window.location.hash), '#/meetings');
  const imported = JSON.parse(records.get(key).value);
  imported.input_mode = 'import'; imported.meeting_metadata = { ...imported.meeting_metadata, duration_unknown: true };
  records.set(key, { value: JSON.stringify(imported), version: records.get(key).version + 1 });
  const readOnlyRequests = [], savedVersion = records.get(key).version;
  host.page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /\/legacy\/(?:records|ai\/blocks\/review)$/.test(path)) readOnlyRequests.push(path);
  });
  for (const page of [host.page, guest.page]) {
    await page.goto(origin + '/norte/?meeting=' + meeting.id + '#/meetings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.id === id, meeting.id);
  }
  assert.equal(joinRequests.length, 0, 'owner and accepted participant deep links avoid join writes');
  await host.page.locator('.meeting-record').waitFor();
  assert.equal(await host.page.locator('.meeting-record time').count(), 0, 'an imported meeting with unknown duration never shows processing time as meeting duration');
  assert.deepEqual(await host.page.evaluate(() => document.querySelector('.meetings-frame').contentWindow.NorteMeetingRoom.snapshot().meeting_metadata), imported.meeting_metadata);
  await frame.locator('#mc-direct-arrow path').waitFor({ state: 'attached' });
  await host.page.locator('.meeting-minutes-button:not([disabled])').click();
  await frame.locator('.gm-page').waitFor();
  assert.equal(await frame.locator('#gmPDF').isEnabled(), true);
  for (const theme of ['light', 'dark']) {
    await host.page.evaluate(value => {
      document.documentElement.dataset.theme = value;
      window.dispatchEvent(new window.CustomEvent('norte:theme-change', { detail: { theme: value } }));
    }, theme);
    assert.equal(await frame.locator('html').getAttribute('data-theme'), theme);
    await frame.locator('#gmPDF').hover();
    const pdfHoverContrast = await frame.locator('#gmPDF').evaluate(async button => {
      await Promise.all(button.getAnimations().map(animation => animation.finished));
      const style = window.getComputedStyle(button);
      const luminance = color => {
        const [red, green, blue] = color.match(/[\d.]+/g).slice(0, 3).map(value => {
          const channel = Number(value) / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        });
        return .2126 * red + .7152 * green + .0722 * blue;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
    });
    assert.ok(pdfHoverContrast >= 4.5, `${theme} PDF hover contrast is sufficient (${pdfHoverContrast.toFixed(2)}:1)`);
    const markers = await frame.locator('body').evaluate(() => {
      const rootStyle = window.getComputedStyle(document.documentElement), colorContext = document.createElement('canvas').getContext('2d');
      const normalize = value => { colorContext.fillStyle = value; return colorContext.fillStyle; };
      return [['direct', 'text-muted'], ['review', 'warning'], ['error', 'danger']].map(([name, token]) => {
        const marker = document.querySelector(`#mc-${name}-arrow path`);
        return { name, fill: marker ? normalize(window.getComputedStyle(marker).fill) : null, expected: normalize(rootStyle.getPropertyValue(`--norte-${token}`).trim()) };
      });
    });
    for (const marker of markers) assert.equal(marker.fill, marker.expected, `${theme} ${marker.name} arrow follows its semantic color`);
  }
  await host.page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    window.dispatchEvent(new window.CustomEvent('norte:theme-change', { detail: { theme: 'light' } }));
  });
  await host.page.locator('.app-header-back').click();
  await frame.locator('.gm-page').waitFor({ state: 'detached' });
  // Cover the editorial agent's 3.5-second debounce after reopening saved content.
  await new Promise(resolve => setTimeout(resolve, 4200));
  assert.deepEqual(readOnlyRequests, [], 'reading a completed meeting and its minutes does not save records or schedule AI');
  assert.equal(records.get(key).version, savedVersion, 'read navigation preserves the persisted meeting version');
  assert.deepEqual(JSON.parse(records.get(key).value).meeting_metadata, imported.meeting_metadata, 'the duration presentation preserves imported metadata');

  let releaseWrite, pendingWrite;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const writeArrived = new Promise(resolve => { pendingWrite = resolve; });
  const recordRoute = `**/api/meetings/${meeting.id}/legacy/records`;
  let queuedWrites = 0;
  const holdFirstWrite = async route => {
    if (route.request().method() === 'POST' && ++queuedWrites === 1) { pendingWrite(); await writeGate; }
    await route.continue();
  };
  await host.page.route(recordRoute, holdFirstWrite);
  try {
    await host.page.evaluate(() => {
      const room = document.querySelector('.meetings-frame').contentWindow, title = room.document.querySelector('#roomTitle');
      room.__savedTitle = title.value; title.value = 'Alteração pendente'; title.onchange();
      room.__pendingSave = room.NorteMeetingRoom.flushStorage();
    });
    await writeArrived;
    await host.page.evaluate(() => {
      const room = document.querySelector('.meetings-frame').contentWindow, title = room.document.querySelector('#roomTitle');
      title.value = room.__savedTitle; title.onchange(); room.__undoSave = room.NorteMeetingRoom.flushStorage();
    });
    releaseWrite();
    assert.deepEqual(await host.page.evaluate(() => {
      const room = document.querySelector('.meetings-frame').contentWindow;
      return Promise.all([room.__pendingSave, room.__undoSave]);
    }), [true, true]);
    assert.equal(queuedWrites, 2, 'undoing to the previous snapshot while a write is pending must queue a second save');
    assert.equal(records.get(key).version, savedVersion + 2);
    assert.equal(JSON.parse(records.get(key).value).title, saved.title);
  } finally { releaseWrite(); await host.page.unroute(recordRoute, holdFirstWrite); }

  let retryWrites = 0;
  const failFirstWrite = async route => {
    if (route.request().method() === 'POST' && ++retryWrites === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Isolated save failure' }) });
    } else await route.continue();
  };
  await host.page.route(recordRoute, failFirstWrite);
  try {
    assert.equal(await host.page.evaluate(() => {
      const room = document.querySelector('.meetings-frame').contentWindow, title = room.document.querySelector('#roomTitle');
      title.value = 'Alteração sem confirmação'; title.onchange(); return room.NorteMeetingRoom.flushStorage();
    }), false);
    assert.equal(await host.page.evaluate(() => {
      const room = document.querySelector('.meetings-frame').contentWindow, title = room.document.querySelector('#roomTitle');
      title.value = room.__savedTitle; title.onchange(); return room.NorteMeetingRoom.flushStorage();
    }), true);
    assert.equal(retryWrites, 2, 'after a failed save, restoring the previous snapshot retries persistence');
    assert.equal(records.get(key).version, savedVersion + 3);
    assert.equal(JSON.parse(records.get(key).value).title, saved.title);
  } finally { await host.page.unroute(recordRoute, failFirstWrite); }

  const injectAs = (actor, method, url, payload) => app.inject({ method, url, headers: { cookie: actor.cookie, 'x-csrf-token': actor.csrfToken }, ...(payload === undefined ? {} : { payload }) });
  const teamResponse = await injectAs(actors[0], 'POST', '/api/teams', { name: 'Opening validation team' }); assert.equal(teamResponse.statusCode, 201, teamResponse.body);
  const team = teamResponse.json().team;
  const invitationResponse = await injectAs(actors[0], 'POST', `/api/teams/${team.id}/invitations`, { nickname: actors[1].user.nickname }); assert.equal(invitationResponse.statusCode, 201, invitationResponse.body);
  assert.equal((await injectAs(actors[1], 'POST', `/api/invitations/${invitationResponse.json().invitation.id}/respond`, { decision: 'accept' })).statusCode, 200);
  const teamMeetingResponse = await injectAs(actors[0], 'POST', '/api/meetings', { title: 'First team entry', scope: 'team', teamId: team.id }); assert.equal(teamMeetingResponse.statusCode, 201, teamMeetingResponse.body);
  const teamMeeting = teamMeetingResponse.json().meeting;
  assert.equal(teamMeeting.participants.some(person => person.userId === actors[1].user.id), false);
  const teamURL = origin + '/norte/?meeting=' + teamMeeting.id + '#/meetings';
  await guest.page.goto(teamURL, { waitUntil: 'domcontentloaded' });
  await guest.page.waitForFunction(id => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.id === id, teamMeeting.id);
  const teamJoins = () => joinRequests.filter(request => request.userId === actors[1].user.id && request.path === `/api/meetings/${teamMeeting.id}/join`);
  assert.equal(teamJoins().length, 1, 'an eligible team member joins on the first entry');
  assert(app.missionStore.read().meetings[teamMeeting.id].participantIds.includes(actors[1].user.id));
  await guest.page.goto(teamURL, { waitUntil: 'domcontentloaded' });
  await guest.page.waitForFunction(id => document.querySelector('.meetings-frame')?.contentWindow?.NorteMeetingRoom?.snapshot()?.id === id, teamMeeting.id);
  assert.equal(teamJoins().length, 1, 'reopening the team meeting does not repeat join');
  assert.equal((await injectAs(actors[2], 'GET', `/api/meetings/${teamMeeting.id}`)).statusCode, 404);
  const deniedHTML = await injectAs(actors[2], 'GET', `/meeting/${teamMeeting.id}`); assert.equal(deniedHTML.statusCode, 404); assert.doesNotMatch(deniedHTML.body, /NORTE_MEETING_BOOTSTRAP/);
  assert.equal((await injectAs(actors[2], 'POST', `/api/meetings/${teamMeeting.id}/join`, {})).statusCode, 404);
  assert.deepEqual(errors, []);
  console.log('PASS: two-way real WebRTC packets, self/host mute and consent release, title editor, transcript chat, authenticated Norte meeting, memory off, consent invite, two accounts, host-only processing, contribution once, guest live state, persistence, isolation, mobile layout, owner/accepted-participant deep links without join writes, read-only meeting/minutes navigation without writes or AI, queued undo and failed-save retry, one first team join and denied outsider HTML/API.');
} catch (error) {
  if (hostPage) await hostPage.screenshot({ path: '/tmp/norte-integrated-meeting-failure.png', fullPage: true }).catch(() => {});
  for (const [index, context] of (browser?.contexts() || []).entries()) for (const page of context.pages()) {
    console.error('Audio state', index, await page.evaluate(() => ({ row: document.querySelector('.meeting-bar-center')?.outerHTML, peers: (window.__audioPeers || []).map(peer => ({ connection: peer.connectionState, ice: peer.iceConnectionState, signaling: peer.signalingState })) })).catch(() => null));
  }
  console.error('Browser errors:', errors); throw error;
} finally { releaseInitialHealth(); await browser?.close(); await vite?.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
