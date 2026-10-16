import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { platformError as fail } from './platform-security.mjs';
const pages = new Set(['landing', 'login', 'register', 'home', 'newProject', 'setup', 'projectTeam', 'brainstorm', 'requirements', 'verification', 'schedule', 'meetings', 'teams', 'dashboard', 'invitations', 'people', 'messages', 'plans', 'admin']);
const names = new Set(['page_view', 'page_time', 'plan_selected', 'seats_changed', 'quote_viewed', 'request_started', 'request_submitted', 'request_failed', 'deferred']);
const digest = value => createHash('sha256').update(value).digest('hex');
const telemetry = data => (data.telemetry ||= { sessions: {}, events: [] });
function clean(data) { const state = telemetry(data), cutoff = Date.now() - 90 * 86400000; state.events = state.events.filter(event => Date.parse(event.at) > cutoff).slice(-20000); for (const [id, session] of Object.entries(state.sessions)) if (session.expiresAt < Date.now()) delete state.sessions[id]; }
function optionsOf(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  if (['individual', 'company'].includes(input.kind)) out.kind = input.kind;
  for (const key of ['editors', 'reviewers', 'viewers']) if (Number.isInteger(input[key]) && input[key] >= 0 && input[key] <= 19) out[key] = input[key];
  if (['later', 'price', 'unclear', 'missing_feature'].includes(input.reason)) out.reason = input.reason;
  return out;
}
export function telemetrySummary(data, now = Date.now()) {
  const events = (data.telemetry?.events || []).filter(event => Date.parse(event.at) >= now - 30 * 86400000), sessions = new Map(), pageRows = {}, options = {}, regions = {};
  for (const event of events) {
    const session = sessions.get(event.sessionId) || { id: event.sessionId, userId: event.userId, firstAt: event.at, lastAt: event.at, lastPage: event.page, steps: new Set(), activeSeconds: 0 };
    if (event.at >= session.lastAt) { session.lastAt = event.at; session.lastPage = event.page; }
    if (event.at < session.firstAt) session.firstAt = event.at;
    session.steps.add(event.name === 'page_view' ? event.page : event.name); session.activeSeconds += event.activeSeconds || 0; sessions.set(event.sessionId, session);
    const row = pageRows[event.page] ||= { page: event.page, views: 0, activeSeconds: 0, visitors: new Set() }; row.visitors.add(event.sessionId); if (event.name === 'page_view') row.views++; row.activeSeconds += event.activeSeconds || 0;
    if (Object.keys(event.options).length) { const key = JSON.stringify(event.options); options[key] = (options[key] || 0) + 1; }
    const key = `${event.country || 'unknown'}:${event.region || ''}`; (regions[key] ||= { country: event.country || null, region: event.region || null, source: event.geoSource || 'unavailable', visitors: new Set() }).visitors.add(event.sessionId);
  }
  const list = [...sessions.values()];
  return { days: 30, consentedSessions: list.length, events: events.length, pages: Object.values(pageRows).map(row => ({ ...row, visitors: row.visitors.size, averageActiveSeconds: row.visitors.size ? Math.round(row.activeSeconds / row.visitors.size) : 0 })), funnel: ['landing', 'plans', 'plan_selected', 'quote_viewed', 'request_started', 'request_submitted'].map(step => ({ step, visitors: list.filter(session => session.steps.has(step)).length })), options: Object.entries(options).map(([selection, count]) => ({ selection: JSON.parse(selection), count })), regions: Object.values(regions).map(row => ({ ...row, visitors: row.visitors.size })), recent: list.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 100).map(session => ({ ...session, steps: [...session.steps], inactiveWithoutRequest: now - Date.parse(session.lastAt) > 30 * 60000 && !session.steps.has('request_submitted') })), limitations: 'Somente navegação autorizada. Tempo ativo medido enquanto a tela está visível e há interação recente. Saída sem solicitação não comprova desistência. Localização aproximada só existe com provedor confiável configurado. Nenhum IP ou conteúdo de projeto é salvo nestes eventos.' };
}
export function registerTelemetry(app, { store, requireAuth, requireCsrf, privileged, getSessionUser, production, trustedLocation }) {
  const cookie = production ? '__Host-norte_usage' : 'norte_usage';
  const cookieOptions = { path: '/', httpOnly: true, secure: production, sameSite: 'strict', maxAge: 86400 };
  app.post('/api/platform/telemetry/session', { bodyLimit: 300, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    if (request.body?.consent !== true) throw fail(400, 'CONSENT_REQUIRED', 'Autorize as métricas de uso antes de iniciar.');
    // Anonymous requests still need same-origin browser proof, independent of proxy headers.
    const origin = request.headers.origin;
    if (origin) {
      let parsed; try { parsed = new URL(origin); } catch { throw fail(403, 'ORIGIN_REJECTED', 'Origem não permitida.'); }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== request.headers.host || (production && parsed.protocol !== 'https:')) throw fail(403, 'ORIGIN_REJECTED', 'Origem não permitida.');
    } else if (request.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'ORIGIN_REJECTED', 'Origem não permitida.');
    reply.header('Cache-Control', 'no-store');
    let token = request.cookies[cookie]; if (!/^[A-Za-z0-9_-]{43}$/u.test(token || '')) token = randomBytes(32).toString('base64url');
    const id = digest(token), auth = getSessionUser(request), csrf = randomBytes(32).toString('base64url');
    await store.update(data => { clean(data); const previous = data.telemetry.sessions[id]; data.telemetry.sessions[id] = { id: previous?.id || randomUUID(), userId: auth?.user.id || null, csrfHash: digest(csrf), expiresAt: Date.now() + 86400000, consentAt: previous?.consentAt || new Date().toISOString() }; });
    reply.setCookie(cookie, token, cookieOptions); return { csrfToken: csrf };
  });
  const identify = (request, data) => {
    const token = request.cookies[cookie], csrf = request.headers['x-usage-token'];
    if (typeof token !== 'string' || typeof csrf !== 'string' || csrf.length > 200) throw fail(403, 'USAGE_SESSION_REQUIRED', 'Sessão de métricas indisponível.');
    const id = digest(token), session = data.telemetry?.sessions[id];
    if (!session || session.expiresAt < Date.now() || !timingSafeEqual(Buffer.from(session.csrfHash), Buffer.from(digest(csrf)))) throw fail(403, 'USAGE_SESSION_REQUIRED', 'Sessão de métricas indisponível.');
    return { id, session };
  };
  app.post('/api/platform/telemetry/events', { bodyLimit: 4000, config: { rateLimit: { max: 90, timeWindow: '1 minute' } } }, async request => {
    const input = request.body || {};
    if (!pages.has(input.page) || !names.has(input.name) || typeof input.key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/u.test(input.key)) throw fail(400, 'INVALID_EVENT', 'Evento não permitido.');
    const geo = trustedLocation?.(request) || null;
    return store.update(data => {
      const { session } = identify(request, data), auth = getSessionUser(request), userId = auth?.user.id || null;
      if (session.userId && session.userId !== userId) throw fail(403, 'USAGE_SESSION_CHANGED', 'Reinicie as métricas após trocar de conta.');
      session.userId = userId;
      const state = telemetry(data); if (state.events.some(event => event.sessionId === session.id && event.key === input.key)) return { ok: true };
      const activeSeconds = input.name === 'page_time' && Number.isInteger(input.activeSeconds) ? Math.min(60, Math.max(0, input.activeSeconds)) : 0;
      state.events.push({ sessionId: session.id, userId, key: input.key, name: input.name, page: input.page, activeSeconds, options: optionsOf(input.options), at: new Date().toISOString(), country: typeof geo?.country === 'string' && /^[A-Z]{2}$/u.test(geo.country) ? geo.country : null, region: typeof geo?.region === 'string' ? geo.region.slice(0, 80) : null, geoSource: geo ? 'trusted_proxy' : 'unavailable' });
      clean(data); return { ok: true };
    });
  });
  app.delete('/api/platform/telemetry/session', { bodyLimit: 1000 }, async (request, reply) => { await store.update(data => { const { id, session } = identify(request, data); data.telemetry.events = data.telemetry.events.filter(event => event.sessionId !== session.id); delete data.telemetry.sessions[id]; }); reply.clearCookie(cookie, { path: '/', secure: production, sameSite: 'strict' }); return { ok: true }; });
  app.get('/api/platform/admin/analytics', { preHandler: [requireAuth] }, async request => { privileged(request); const data = store.read(); return { ...telemetrySummary(data), orders: { requested: (data.platform?.planRequests || []).length, contacted: (data.platform?.planRequests || []).filter(order => order.status === 'contacted').length, confirmed: (data.platform?.planRequests || []).filter(order => order.status === 'confirmed').length, cancelled: (data.platform?.planRequests || []).filter(order => order.status === 'cancelled').length }, countryConfigured: Boolean(trustedLocation) }; });
  app.post('/api/platform/privacy/erase-usage', { preHandler: [requireAuth, requireCsrf] }, async request => store.update(data => { const state = telemetry(data); state.events = state.events.filter(event => event.userId !== request.auth.user.id); for (const [id, session] of Object.entries(state.sessions)) if (session.userId === request.auth.user.id) delete state.sessions[id]; return { ok: true }; }));
}
