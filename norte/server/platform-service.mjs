import { randomUUID, timingSafeEqual } from 'node:crypto';
import { administrator, platformError as fail, registerPlatformSecurity } from './platform-security.mjs';
import { sameDemoScope } from './demo-account.mjs';
import { registerTelemetry } from './platform-telemetry.mjs';
import { registerConversationRoutes } from './conversation-service.mjs';

const now = () => new Date().toISOString();
const defaultCatalog = { version: 1, currency: 'BRL', individual: 7900, company: 14900, editor: 3900, reviewer: 1900, approved: false };
export const planFeatures = ['project_memory', 'document_extraction', 'engineering_map', 'idea_exploration', 'requirements_reviews', 'tests_verification', 'schedule', 'meetings_minutes'];
const state = data => (data.platform ||= { conversations: {}, planRequests: [], catalog: { ...defaultCatalog }, entitlements: {} });
const readState = data => data.platform || { conversations: {}, planRequests: [], catalog: defaultCatalog, entitlements: {} };
function string(value, max, min = 0) { if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw fail(400, 'INVALID_FIELDS', 'Confira os campos informados.'); return value.trim(); }
function integer(value, max = 19) { if (!Number.isSafeInteger(value) || value < 0 || value > max) throw fail(400, 'INVALID_FIELDS', 'Informe uma quantidade válida.'); return value; }
function version(received, expected) { if (received !== expected) throw fail(409, 'VERSION_CONFLICT', 'Os dados foram atualizados. Recarregue antes de confirmar.'); }
function audit(data, actorId, event, subjectId) { data.platformAudit ||= []; data.platformAudit.push({ actorId, event, subjectId, at: now() }); data.platformAudit = data.platformAudit.slice(-2000); }
export function planSelection(input) {
  if (!input || !['individual', 'company'].includes(input.kind)) throw fail(400, 'INVALID_SELECTION', 'Escolha um plano válido.');
  const selection = { kind: input.kind, company: string(input.company || '', 120), editors: integer(input.editors), reviewers: integer(input.reviewers), viewers: integer(input.viewers) };
  if (selection.editors + selection.reviewers + selection.viewers > 19 || (selection.kind === 'individual' && (selection.editors || selection.reviewers > 1 || selection.viewers > 3)) || (selection.kind === 'company' && selection.company.length < 2)) throw fail(400, 'INVALID_SELECTION', 'Confira a equipe e a quantidade de participantes.');
  return selection;
}
export function quotePlan(catalog, selection) {
  const baseCents = catalog[selection.kind], editorCents = selection.kind === 'company' ? catalog.editor * selection.editors : 0, reviewerCents = selection.kind === 'company' ? catalog.reviewer * selection.reviewers : 0;
  return { version: catalog.version, monthlyCents: baseCents + editorCents + reviewerCents, baseCents, editorCents, reviewerCents, currency: 'BRL', approved: catalog.approved, periodDays: 30, automaticRenewal: false, paymentsProcessed: false, features: planFeatures };
}
export function registerPlatformRoutes(app, { store, requireAuth, requireCsrf, canAccessProject, presence, getSessionUser, production, ...options }) {
  const { privileged } = registerPlatformSecurity(app, { store, requireAuth, requireCsrf, ...options });
  const geoSecret = process.env.NORTE_GEO_HEADER_SECRET;
  const trustedLocation = options.trustedLocation || (geoSecret?.length >= 32 ? request => {
    const supplied = request.headers['x-norte-geo-token'];
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(geoSecret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(geoSecret))) return null;
    return { country: request.headers['x-norte-country'], region: request.headers['x-norte-region'] };
  } : undefined);
  registerTelemetry(app, { store, requireAuth, requireCsrf, privileged, getSessionUser, production, trustedLocation });
  const userView = (data, user, admin = false) => ({ id: user.id, memberId: user.memberId, name: user.name, nickname: user.nickname, institution: user.institution || '', ...presence(data, user), ...(admin ? { email: user.email, active: user.active, demoAccount: Boolean(user.isDemoAccount), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt } : {}) });
  const peopleFor = (data, actor) => data.users.filter(user => user.active && sameDemoScope(actor, user));
  app.get('/api/platform/people', { preHandler: [requireAuth] }, async request => {
    const data = store.read(), q = String(request.query.q || '').slice(0, 100).toLocaleLowerCase(), offset = Math.max(0, Math.min(100000, Number(request.query.offset) || 0));
    const users = peopleFor(data, request.auth.user).filter(user => `${user.name} ${user.nickname}`.toLocaleLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    return { users: users.slice(offset, offset + 100).map(user => userView(data, user)), total: users.length };
  });
  app.get('/api/platform/admin/people', { preHandler: [requireAuth] }, async request => {
    privileged(request); const data = store.read(), q = String(request.query.q || '').slice(0, 100).toLocaleLowerCase();
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(request.query.offset) || 0)));
    const users = data.users.filter(user => `${user.name} ${user.email} ${user.nickname}`.toLocaleLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { users: users.slice(offset, offset + 100).map(user => userView(data, user, true)), matched: users.length, offset, total: data.users.length, online: data.users.filter(user => presence(data, user).presence === 'online').length };
  });
  app.get('/api/platform/admin/technical', { preHandler: [requireAuth] }, async request => {
    privileged(request);
    const fields = ['jevCalls', 'llmCalls', 'cacheHits', 'providerFailures', 'reportedInputTokens', 'reportedOutputTokens', 'feedback'];
    const metrics = Object.fromEntries(fields.map(field => [field, Object.values(store.read().projectLearning || {}).reduce((total, project) => total + (Number(project.metrics?.[field]) || 0), 0)]));
    return { metrics };
  });
  registerConversationRoutes(app, { store, state, readState, requireAuth, requireCsrf, canAccessProject, userView, privileged });
  app.get('/api/platform/plans', async () => ({ catalog: readState(store.read()).catalog, features: planFeatures, paymentsProcessed: false }));
  app.post('/api/platform/plans/quote', { preHandler: [requireAuth, requireCsrf], bodyLimit: 2000 }, async request => ({ quote: quotePlan(readState(store.read()).catalog, planSelection(request.body)) }));
  app.get('/api/platform/plans/requests', { preHandler: [requireAuth] }, async request => { const platform = readState(store.read()); return { requests: platform.planRequests.filter(item => item.userId === request.auth.user.id), entitlement: platform.entitlements[request.auth.user.id] || null }; });
  app.post('/api/platform/plans/requests', { preHandler: [requireAuth, requireCsrf], bodyLimit: 4000, config: { rateLimit: { max: 8, timeWindow: '1 hour' } } }, async request => store.update(data => {
    if (request.auth.user.isDemoAccount) throw fail(403, 'DEMO_RESTRICTED', 'Crie uma conta permanente para solicitar contratação.');
    const platform = state(data), selection = planSelection(request.body?.selection), key = string(request.body.key, 100, 8);
    if (request.body.consent !== true) throw fail(400, 'CONSENT_REQUIRED', 'Confirme o contato sobre esta solicitação.');
    const previous = platform.planRequests.find(item => item.userId === request.auth.user.id && item.key === key);
    if (previous) { if (JSON.stringify(previous.selection) !== JSON.stringify(selection)) throw fail(409, 'IDEMPOTENCY_CONFLICT', 'A solicitação já foi registrada com outra configuração.'); return { request: previous }; }
    const quote = quotePlan(platform.catalog, selection); version(request.body.version, quote.version); version(request.body.expectedCents, quote.monthlyCents);
    const order = { id: randomUUID(), key, userId: request.auth.user.id, selection, quote, contactConsentAt: now(), status: 'requested', version: 1, createdAt: now(), updatedAt: now() };
    platform.planRequests.push(order); audit(data, request.auth.user.id, 'plan_requested', order.id); return { request: order };
  }));
  app.post('/api/platform/plans/requests/:id/cancel', { preHandler: [requireAuth, requireCsrf], bodyLimit: 1000 }, async request => store.update(data => { const order = state(data).planRequests.find(item => item.id === request.params.id && item.userId === request.auth.user.id); if (!order) throw fail(404, 'REQUEST_NOT_FOUND', 'Solicitação não encontrada.'); version(request.body?.version, order.version); if (!['requested', 'contacted'].includes(order.status)) throw fail(409, 'REQUEST_CLOSED', 'A solicitação já foi encerrada.'); order.status = 'cancelled'; order.version++; order.updatedAt = now(); audit(data, request.auth.user.id, 'plan_cancelled', order.id); return { request: order }; }));
  app.get('/api/platform/admin/plans', { preHandler: [requireAuth] }, async request => { privileged(request); const data = store.read(), platform = readState(data); return { catalog: platform.catalog, requests: platform.planRequests.slice().reverse().map(order => ({ ...order, user: userView(data, data.users.find(user => user.id === order.userId), true) })) }; });
  app.post('/api/platform/admin/plans/catalog', { preHandler: [requireAuth, requireCsrf], bodyLimit: 2000 }, async request => { privileged(request); return store.update(data => { privileged(request, data); const platform = state(data); version(request.body?.version, platform.catalog.version); const prices = Object.fromEntries(['individual', 'company', 'editor', 'reviewer'].map(field => [field, integer(request.body.prices?.[field], 1000000)])); if (typeof request.body.approved !== 'boolean') throw fail(400, 'INVALID_FIELDS', 'Confirme a aprovação do catálogo.'); platform.catalog = { ...platform.catalog, ...prices, approved: request.body.approved, version: platform.catalog.version + 1 }; audit(data, request.auth.user.id, 'catalog_updated', String(platform.catalog.version)); return { catalog: platform.catalog }; }); });
  app.post('/api/platform/admin/plans/:id', { preHandler: [requireAuth, requireCsrf], bodyLimit: 1500 }, async request => { privileged(request); return store.update(data => {
    privileged(request, data);
    const platform = state(data), order = platform.planRequests.find(item => item.id === request.params.id); if (!order) throw fail(404, 'REQUEST_NOT_FOUND', 'Solicitação não encontrada.'); version(request.body?.version, order.version);
    const status = request.body.status; if (!['contacted', 'confirmed', 'cancelled'].includes(status) || !['requested', 'contacted'].includes(order.status)) throw fail(409, 'INVALID_TRANSITION', 'Transição não permitida.');
    if (status === 'confirmed') {
      const current = quotePlan(platform.catalog, order.selection);
      if (request.body.confirm !== true || !current.approved) throw fail(409, 'OFFER_PENDING', 'Aprove o catálogo e confirme a contratação manual.');
      if (current.monthlyCents !== order.quote.monthlyCents) throw fail(409, 'QUOTE_CHANGED', 'O valor mudou. Solicite uma nova confirmação do cliente.');
      const until = Math.max(Date.now(), Date.parse(platform.entitlements[order.userId]?.until || '') || 0) + 30 * 86400000;
      platform.entitlements[order.userId] = { kind: order.selection.kind, features: planFeatures, seats: { editors: order.selection.editors, reviewers: order.selection.reviewers, viewers: order.selection.viewers }, until: new Date(until).toISOString(), requestId: order.id, confirmedBy: request.auth.user.id, confirmation: 'manual', paymentVerifiedAutomatically: false };
      order.confirmedAt = now();
    }
    order.status = status; order.version++; order.updatedAt = now(); audit(data, request.auth.user.id, `plan_${status}`, order.id); return { request: order };
  }); });
  return { privileged, administrator };
}
