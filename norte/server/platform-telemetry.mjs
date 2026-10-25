import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { platformError as fail } from './platform-security.mjs';
import { isFictionalProfile } from './reviewer-eligibility.mjs';
import { setInterval, clearInterval } from 'node:timers';
const pages = new Set(['landing', 'login', 'register', 'home', 'newProject', 'requirements', 'verification', 'schedule', 'documents', 'meetings', 'teams', 'invitations', 'people', 'messages', 'privacy', 'terms', 'admin']);
const names = new Set(['page_view', 'page_time', 'feature_click']);
const actions = new Set(['requirements.analyze', 'requirements.create', 'verification.suggest', 'schedule.template', 'documents.preview', 'documents.generate', 'chat.send', 'meeting.create', 'team.create', 'project.create']);
const digest = value => createHash('sha256').update(value).digest('hex');
const telemetry = data => (data.telemetry ||= { sessions: {}, events: [] });
function clean(data) { const state = telemetry(data), cutoff = Date.now() - 90 * 86400000; state.events = state.events.filter(event => Date.parse(event.at) > cutoff).slice(-20000); for (const [id, session] of Object.entries(state.sessions)) if (session.expiresAt < Date.now()) delete state.sessions[id]; }
function optionsOf(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  if (actions.has(input.action)) out.action = input.action;
  return out;
}
export function telemetrySummary(data, now = Date.now()) {
  const events = (data.telemetry?.events || []).filter(event => Date.parse(event.at) >= now - 30 * 86400000 && pages.has(event.page) && names.has(event.name)), sessions = new Map(), pageRows = {}, clicks = {}, regions = {};
  for (const event of events) {
    const session = sessions.get(event.sessionId) || { id: event.sessionId, userId: event.userId, firstAt: event.at, lastAt: event.at, lastPage: event.page, steps: new Set(), activeSeconds: 0 };
    if (event.at >= session.lastAt) { session.lastAt = event.at; session.lastPage = event.page; }
    if (event.at < session.firstAt) session.firstAt = event.at;
    session.steps.add(event.name === 'page_view' ? event.page : event.name); session.activeSeconds += event.activeSeconds || 0; sessions.set(event.sessionId, session);
    const row = pageRows[event.page] ||= { page: event.page, views: 0, activeSeconds: 0, visitors: new Set() }; row.visitors.add(event.sessionId); if (event.name === 'page_view') row.views++; row.activeSeconds += event.activeSeconds || 0;
    if (event.name === 'feature_click' && actions.has(event.options?.action)) { const key = event.options.action; clicks[key] = (clicks[key] || 0) + 1; }
    const key = `${event.country || 'unknown'}:${event.region || ''}`; (regions[key] ||= { country: event.country || null, region: event.region || null, source: event.geoSource || 'unavailable', visitors: new Set() }).visitors.add(event.sessionId);
  }
  const list = [...sessions.values()];
  return {
    days: 30, consentedSessions: list.length, events: events.length,
    averageActiveSeconds: list.length ? Math.round(list.reduce((sum, session) => sum + session.activeSeconds, 0) / list.length) : 0,
    pages: Object.values(pageRows).map(row => ({ ...row, visitors: row.visitors.size, averageActiveSeconds: row.visitors.size ? Math.round(row.activeSeconds / row.visitors.size) : 0 })).sort((a, b) => b.views - a.views),
    clicks: Object.entries(clicks).map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    regions: Object.values(regions).map(row => ({ ...row, visitors: row.visitors.size })),
    recent: list.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 100).map(session => ({ ...session, steps: [...session.steps] })),
    limitations: 'Últimos 30 dias, somente com autorização. O tempo conta enquanto a tela está visível e há interação recente. País e região dependem de uma origem confiável configurada. Não são coletados textos, documentos, mensagens ou coordenadas.'
  };
}
export function registerTelemetry(app, { store, requireAuth, requireCsrf, privileged, getSessionUser, production, trustedLocation }) {
  const cookie = production ? '__Host-norte_usage' : 'norte_usage';
  const cookieOptions = { path: '/', httpOnly: true, secure: production, sameSite: 'strict', maxAge: 86400 };
  const pruneExpired = async () => {
    const state = store.read(data => data.telemetry), now = Date.now();
    if (state && (state.events.some(event => Date.parse(event.at) <= now - 90 * 86400000) || Object.values(state.sessions).some(session => session.expiresAt < now))) await store.update(clean);
  };
  const retentionTimer = setInterval(() => { void pruneExpired().catch(() => app.log.warn('Usage retention cleanup failed')); }, 3600000);
  retentionTimer.unref();
  app.addHook('onReady', pruneExpired);
  app.addHook('onClose', async () => clearInterval(retentionTimer));
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
    await store.update(data => {
      clean(data);
      const userId = auth?.user.id || null, previous = data.telemetry.sessions[id];
      const sameAccount = previous && previous.userId === userId;
      data.telemetry.sessions[id] = { id: sameAccount ? previous.id : randomUUID(), userId, csrfHash: digest(csrf), expiresAt: Date.now() + 86400000, consentAt: sameAccount ? previous.consentAt : new Date().toISOString() };
    });
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
    if (!pages.has(input.page) || !names.has(input.name) || (input.name === 'feature_click' && !actions.has(input.options?.action)) || typeof input.key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/u.test(input.key)) throw fail(400, 'INVALID_EVENT', 'Evento não permitido.');
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
  app.get('/api/platform/admin/analytics', { preHandler: [requireAuth] }, async request => {
    privileged(request);
    const data = store.read(), users = data.users.filter(user => user.passwordHash && !isFictionalProfile(user) && !user.isDemoAccount && !user.demoSandboxId);
    return { ...telemetrySummary(data), accounts: { total: users.length, createdLast30Days: users.filter(user => Date.parse(user.createdAt) >= Date.now() - 30 * 86400000).length }, countryConfigured: Boolean(trustedLocation) };
  });
  app.post('/api/platform/privacy/erase-usage', { preHandler: [requireAuth, requireCsrf] }, async request => store.update(data => { const state = telemetry(data); state.events = state.events.filter(event => event.userId !== request.auth.user.id); for (const [id, session] of Object.entries(state.sessions)) if (session.userId === request.auth.user.id) delete state.sessions[id]; return { ok: true }; }));
}
