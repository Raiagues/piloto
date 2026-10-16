import { withPreparedExampleSummaries } from '../scripts/meeting-example-summaries.mjs';
/** Same-origin facade for the private Python meeting engine. No browser identity is forwarded. */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { meetingError } from './meeting-service.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fail = (status, code, message) => { throw meetingError(status, code, message); };
const API_GET = new Set(['health', 'records', 'ai/aliases']);
const API_POST = new Set(['classify', 'relations', 'typed-relations', 'minutes', 'records', 'ai/events', 'ai/resolve', 'ai/memory/query', 'ai/blocks/review', 'ai/blocks/feedback']);
const ASSETS = new Set(('styles.css memory-flow.css memory-flow.js memory-page.js relation-worker.js app.js transcription.js speech-windows.js classifier.js workspace.js experiments.js automation.js lab.js classifier-config.json memory-v2.js gemini-minutes.js gemini-minutes.css meeting-room.js meeting-room.css meeting-canvas.js meeting-canvas.css meeting-session.js meeting-commands.js meeting-hierarchy.js meeting-evidence.js meeting-state.js meeting-review.js beam-engine.js beam-commands.js beam-workspace.js beam-workspace.css meeting-beam.js meeting-beam.css meeting-speech.js meeting-document.js meeting-amendments.js account.css remote-storage.js ai-client.js ai-observatory.js ai-observatory.css meeting-blocks.js meeting-blocks.css typed-relations.js typed-relations-page.js meeting-minutes.js meeting-minutes.css relation-map.js relation-map.css memory-storage.js norte-meeting-bridge.js norte-meeting-bridge.css vendor/minutes/jspdf-4.2.1.umd.min.js vendor/minutes/DejaVuSans-2.37.ttf').split(' '));
const mime = name => name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.json') ? 'application/json' : 'font/ttf';
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const viewFields = new Set(('id title createdAt startedAt finishedAt status schemaVersion liveSchemaVersion memorySchemaVersion presentationVersion room_kind input_mode provider threshold calls batch records meeting_events meeting_threads meeting_relations raw_window transcript topic_titles title_edits meeting_commands post_meeting_edits block_edits block_review speech_ledger beam_started beam_open_tabs beam_previous_view beam_view beam_recorded beam_lab beam_commands meeting_metadata project_id project_memory_mode integrated_norte').split(' '));
const diagnosticFields = new Set(['request', 'response', 'output', 'storeOutput', 'typeOutput', 'jobs', 'questions', 'config', 'headers', 'authorization', 'project_memory', 'engineFingerprint', 'debug', 'trace', 'stack']);
function withoutDiagnostics(value) {
  if (Array.isArray(value)) return value.map(withoutDiagnostics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !diagnosticFields.has(key)).map(([key, child]) => [key, withoutDiagnostics(child)]));
}
/** Guests receive the materialized meeting, never the host's processing archive. */
export function publicMeetingSnapshot(run) {
  const view = withoutDiagnostics(Object.fromEntries(Object.entries(run).filter(([key]) => viewFields.has(key))));
  for (const key of ['meeting_events', 'meeting_threads', 'meeting_relations', 'transcript', 'records', 'meeting_commands']) if (!Array.isArray(view[key])) view[key] = [];
  view.batch ??= { batch_id: run.id, cases: [] };
  view.readonly_projection = 'norte.meeting-view.v1';
  return view;
}
function clientRequest(body) {
  const value = structuredClone(body);
  if (value && typeof value === 'object') { delete value.project_memory; if (value.state && typeof value.state === 'object') delete value.state.project_memory; }
  return value;
}
/** Match the browser's original request, not the private context added by Node. */
function classificationResponse(output, original) {
  const answerFields = new Set(['type', 'noul', 'choice', 'score', 'confidence', 'probabilities']);
  const answers = Object.fromEntries(Object.entries(output.response?.answers || {}).filter(([id]) => Object.hasOwn(original?.questions || {}, id)).map(([id, answer]) => [id, answer && typeof answer === 'object' ? Object.fromEntries(Object.entries(answer).filter(([key]) => answerFields.has(key))) : answer]));
  return { provider: output.provider, latencyMs: output.latencyMs, request: original, response: { model: output.response?.model, answers } };
}

export function signedBridgeHeaders({ method, path, userId, scope, role = 'user', body = '', secret, time = String(Math.floor(Date.now() / 1000)) }) {
  if (!secret || secret.length < 32) fail(503, 'BRIDGE_UNAVAILABLE', 'O serviço de reuniões ainda não foi configurado.');
  const digest = createHash('sha256').update(body).digest('hex');
  const canonical = [method.toUpperCase(), path, userId, scope, role, time, digest].join('\n');
  return { 'x-norte-bridge-user': userId, 'x-norte-bridge-scope': scope, 'x-norte-bridge-role': role, 'x-norte-bridge-time': time, 'x-norte-bridge-signature': createHmac('sha256', secret).update(canonical).digest('hex') };
}

export function registerMeetingGateway(app, { store, requireAuth, requireCsrf, access, backendUrl = process.env.NORTE_MEETING_BACKEND_URL || 'http://127.0.0.1:8790', secret = process.env.NORTE_MEETING_BRIDGE_SECRET, fetchImpl = fetch, legacyRoot = ROOT, prepareMeetingRequest }) {
  const backend = new URL(backendUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname) || backend.protocol !== 'http:' || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('The private meeting backend must be a loopback HTTP origin.');
  async function authenticatedHTML(request, reply) {
    await store.refresh?.();
    try { await requireAuth(request); }
    catch (error) { if (error.statusCode !== 401) throw error; const event = typeof request.query.event === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(request.query.event) ? '&event=' + encodeURIComponent(request.query.event) : ''; return reply.redirect('/?meeting=' + encodeURIComponent(request.params.id) + event + '#/meetings'); }
  }
  app.get('/meeting/:id', { preHandler: [authenticatedHTML] }, async (request, reply) => {
    const data = store.read(), meeting = access.requireMeeting(data, request.auth.user, request.params.id);
    const nonce = randomBytes(18).toString('base64');
    const bootstrap = { meeting: access.publicMeeting(data, meeting, request.auth.user), user: { id: request.auth.user.id, name: request.auth.user.name, nickname: request.auth.user.nickname, role: 'user' }, csrfToken: request.auth.session.csrfToken, apiBase: `/api/meetings/${meeting.id}/legacy`, returnUrl: '/#/meetings' };
    let html = await readFile(resolve(legacyRoot, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head>\n<base href="/meeting-assets/">\n<script nonce="' + nonce + '">window.NORTE_MEETING_BOOTSTRAP=' + scriptJSON(bootstrap) + ';</script>');
    html = html.replace('<body data-page="live">', `<body data-page="live" data-auth="on" data-role="user" data-username="${escapeHTML(request.auth.user.nickname)}" data-integrated-meeting="on"><script src="/meeting-assets/norte-meeting-bridge.js"></script>`);
    reply.header('cache-control', 'no-store').header('referrer-policy', 'same-origin').header('content-security-policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`);
    return reply.type('text/html; charset=utf-8').send(html);
  });
  app.get('/meeting-assets/*', { preHandler: [async request => { await store.refresh?.(); await requireAuth(request); }] }, async (request, reply) => {
    const name = request.params['*'];
    if (!ASSETS.has(name)) fail(404, 'ASSET_NOT_FOUND', 'Arquivo não encontrado.');
    let content;
    try { content = await readFile(resolve(legacyRoot, name)); }
    catch (error) { if (error.code === 'ENOENT') fail(404, 'ASSET_NOT_FOUND', 'Arquivo não encontrado.'); throw error; }
    return reply.header('cache-control', 'no-store').type(mime(name)).send(content);
  });
  async function proxy(request, reply) {
    const suffix = request.params['*'];
    if (!(request.method === 'GET' ? API_GET : API_POST).has(suffix)) fail(404, 'ROUTE_NOT_FOUND', 'Operação não disponível na reunião.');
    const data = store.read(), meeting = access.requireMeeting(data, request.auth.user, request.params.id, request.method !== 'GET');
    const expectedKey = 'norte.meeting-room.session.v2.' + meeting.id;
    let body = request.method === 'POST' ? request.body : null, path = '/api/' + suffix, run;
    const originalRequest = request.method === 'POST' && ['classify', 'relations', 'typed-relations'].includes(suffix) ? clientRequest(body) : null;
    if (suffix === 'records') {
      const key = request.method === 'GET' ? request.query.key : body?.key;
      if (key !== expectedKey) fail(403, 'RECORD_SCOPE', 'O registro não pertence a esta reunião.');
      if (request.method === 'GET') path += '?key=' + encodeURIComponent(expectedKey);
      else {
        if (!body || Object.keys(body).some(key => !['key', 'value', 'expected_version'].includes(key)) || typeof body.value !== 'string' || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0) fail(400, 'VERSION_REQUIRED', 'Envie o registro com a versão esperada.');
        try { run = JSON.parse(body.value); } catch { fail(400, 'INVALID_RUN', 'Registro de reunião inválido.'); }
        if (!run || typeof run !== 'object' || run.id !== meeting.id || run.batch?.batch_id && run.batch.batch_id !== meeting.id) fail(403, 'RECORD_SCOPE', 'O registro não pertence a esta reunião.');
        if (run.title && (typeof run.title !== 'string' || run.title.length > 160)) fail(400, 'INVALID_TITLE', 'Título inválido.');
        // The outer meeting title is authoritative; queued iframe saves cannot
        // undo a rename made while classification was running.
        run.title = meeting.title; body.value = JSON.stringify(run);
      }
    } else if (Object.keys(request.query || {}).length) fail(400, 'INVALID_QUERY', 'Parâmetros não permitidos.');
    if (body?.session_id !== undefined && body.session_id !== meeting.id || suffix === 'ai/events' && body?.events?.some(row => row.session_id !== meeting.id)) fail(403, 'RECORD_SCOPE', 'Os eventos não pertencem a esta reunião.');
    if (meeting.example === 'curated_mock_v1' && meeting.exampleSnapshot) {
      if (request.method !== 'GET') fail(403, 'READONLY_EXAMPLE', 'Este exemplo fictício é somente leitura. Crie uma reunião para usar sua própria transcrição.');
      if (suffix === 'records') return reply.header('cache-control', 'no-store').send({ value: JSON.stringify(publicMeetingSnapshot(withPreparedExampleSummaries({ ...meeting.exampleSnapshot, title: meeting.title }))), version: 1 });
      if (suffix === 'health') return { ready: true, provider: 'official', example: true };
      if (suffix === 'ai/aliases') return { aliases: [] };
    }
    if (prepareMeetingRequest && request.method === 'POST' && ['classify', 'relations', 'typed-relations'].includes(suffix)) body = await prepareMeetingRequest({ meeting, user: request.auth.user, body, path, data });
    await store.refresh?.(); access.requireMeeting(store.read(), request.auth.user, meeting.id, request.method !== 'GET');
    const raw = body === null ? '' : JSON.stringify(body);
    const headers = { ...signedBridgeHeaders({ method: request.method, path, userId: request.auth.user.id, scope: 'meeting:' + meeting.id, body: raw, secret }), ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}) };
    let response;
    try { response = await fetchImpl(new URL(path, backend), { method: request.method, headers, ...(request.method === 'POST' ? { body: raw } : {}), redirect: 'error', signal: AbortSignal.timeout(180_000) }); }
    catch { fail(503, 'MEETING_ENGINE_UNAVAILABLE', 'O processamento da reunião está indisponível. Seus registros foram preservados.'); }
    let output;
    try { output = await response.json(); } catch { fail(502, 'MEETING_ENGINE_RESPONSE', 'O processamento retornou uma resposta inválida.'); }
    await store.refresh?.(); access.requireMeeting(store.read(), request.auth.user, meeting.id, request.method !== 'GET');
    if (run && response.ok) await store.update(current => {
      const latest = access.requireMeeting(current, request.auth.user, meeting.id, true);
      if (!Number.isSafeInteger(output.version) || output.version <= (latest.runVersion || 0)) return;
      latest.runVersion = output.version; delete latest.initialSnapshot;
      if (['draft', 'running', 'completed', 'interrupted', 'ended', 'finished', 'stopped', 'done'].includes(run.status)) latest.status = run.status;
      latest.revision++; latest.updatedAt = new Date().toISOString();
    });
    if (response.ok && originalRequest) output = classificationResponse(output, originalRequest);
    // A copy has a durable seed until its first engine save. Read the engine
    // first so a lost metadata acknowledgement never reopens version zero.
    if (response.ok && suffix === 'records' && request.method === 'GET' && output.value === null && output.version === 0 && meeting.initialSnapshot) {
      output = { value: JSON.stringify(withPreparedExampleSummaries(meeting.initialSnapshot)), version: 0 };
    }
    if (response.ok && suffix === 'records' && request.method === 'GET' && typeof output.value === 'string') {
      let snapshot;
      try { snapshot = JSON.parse(output.value); } catch { fail(502, 'MEETING_RECORD_INVALID', 'Não foi possível abrir o registro desta reunião.'); }
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.id !== meeting.id) fail(502, 'MEETING_RECORD_INVALID', 'O registro recebido não pertence a esta reunião.');
      if (meeting.initialSnapshot && Number.isSafeInteger(output.version) && output.version > 0) await store.update(current => {
        const latest = access.requireMeeting(current, request.auth.user, meeting.id);
        if (latest.initialSnapshot && output.version > (latest.runVersion || 0)) { latest.runVersion = output.version; delete latest.initialSnapshot; }
      });
      if (meeting.copiedFromExample) snapshot = withPreparedExampleSummaries(snapshot);
      snapshot.title = store.read().meetings[meeting.id].title;
      output = { value: JSON.stringify(meeting.ownerId !== request.auth.user.id ? publicMeetingSnapshot(snapshot) : snapshot), version: output.version };
    }
    return reply.header('cache-control', 'no-store').code(response.status).send(output);
  }
  const preParsing = async (request, reply, payload) => {
    const encoding = request.headers['content-encoding'];
    if (!encoding || encoding === 'identity') return payload;
    if (encoding !== 'gzip') fail(415, 'ENCODING_NOT_SUPPORTED', 'Codificação não suportada.');
    const stream = createGunzip(); stream.receivedEncodedLength = 0;
    payload.on('data', chunk => { stream.receivedEncodedLength += chunk.length; });
    return payload.pipe(stream);
  };
  app.get('/api/meetings/:id/legacy/*', { preHandler: [requireAuth] }, proxy);
  app.post('/api/meetings/:id/legacy/*', { bodyLimit: 32_000_000, preParsing, preHandler: [requireAuth, requireCsrf], config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, proxy);
}
