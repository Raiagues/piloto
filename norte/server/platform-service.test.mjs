import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { base32, totp, validCounter } from './platform-security.mjs';

const password = 'isolated platform acceptance password';
const cookieOf = response => [response.headers['set-cookie']].flat().filter(Boolean).map(value => value.split(';')[0]).join('; ');
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-platform-'));
  const storeFile = join(directory, 'state.json'), platform = { encryptionKey: 'test-only-platform-key-with-more-than-32-characters', ...options.platform };
  let app = await buildApp({ storeFile, logger: false, ai: { apiKey: '' }, demoAccount: true, ...options, platform });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (actor, method, path, payload, headers = {}) => app.inject({ method, url: `/api${path}`, headers: { ...actor?.headers, ...headers }, ...(payload !== undefined ? { payload } : {}) });
  async function account(name) {
    const response = await request(null, 'POST', '/auth/register', { name, email: `${name.toLowerCase()}@example.test`, password });
    assert.equal(response.statusCode, 201, response.body);
    return { ...response.json().user, headers: { cookie: cookieOf(response), 'x-csrf-token': response.json().csrfToken } };
  }
  async function login(actor) {
    const response = await request(null, 'POST', '/auth/login', { email: actor.email, password });
    assert.equal(response.statusCode, 200, response.body);
    return { ...response.json().user, headers: { cookie: cookieOf(response), 'x-csrf-token': response.json().csrfToken } };
  }
  const owner = await account('Owner'), alice = await account('Alice'), bob = await account('Bob');
  async function elevate(actor = owner) {
    const enrolled = await request(actor, 'POST', '/platform/admin/security/enroll', { password });
    assert.equal(enrolled.statusCode, 200, enrolled.body);
    assert.equal(enrolled.headers['cache-control'], 'no-store');
    const secret = enrolled.json().secret, counter = Math.floor(Date.now() / 30000), code = totp(secret, counter);
    const verified = await request(actor, 'POST', '/platform/admin/security/verify', { code });
    assert.equal(verified.statusCode, 200, verified.body);
    return { secret, counter, code };
  }
  return { get app() { return app; }, request, owner, alice, bob, account, login, elevate, storeFile, async restart(key = platform.encryptionKey) { await app.close(); app = await buildApp({ storeFile, logger: false, ai: { apiKey: '' }, demoAccount: true, ...options, platform: { ...platform, encryptionKey: key } }); } };
}

// Interoperability vectors from RFC 6238 Appendix B:
// https://www.rfc-editor.org/rfc/rfc6238#appendix-B (SHA-1, 30-second step).
test('authenticator matches RFC 6238 and rejects malformed, expired and replayed codes', () => {
  const secret = base32(Buffer.from('12345678901234567890'));
  for (const [timestamp, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) assert.equal(totp(secret, Math.floor(timestamp / 30), 8), expected);
  const now = 1234567890000, counter = Math.floor(now / 30000), code = totp(secret, counter);
  assert.equal(validCounter(secret, code, now), counter);
  assert.equal(validCounter(secret, code, now, counter), null);
  assert.equal(validCounter(secret, totp(secret, counter - 2), now), null);
  for (const invalid of [123456, ['123456'], null, {}, '12345', '1234567', '<test>']) assert.equal(validCounter(secret, invalid, now), null);
});

test('MFA gates global administration, binds enrollment to session, encrypts secrets and rejects replay', async t => {
  const f = await fixture(t), { request, owner, alice } = f;
  for (const path of ['/platform/admin/people', '/platform/admin/analytics', '/platform/admin/plans', '/platform/admin/technical']) {
    assert.equal((await request(null, 'GET', path)).statusCode, 401);
    assert.equal((await request(alice, 'GET', path)).statusCode, 403);
    assert.equal((await request(owner, 'GET', path)).json().error, 'ADMIN_MFA_REQUIRED');
  }
  assert.equal((await request(owner, 'POST', '/platform/admin/security/enroll', { password: 'incorrect' })).json().error, 'REAUTH_REQUIRED');
  assert.equal((await request(owner, 'POST', '/platform/admin/security/enroll', { password }, { 'x-csrf-token': '' })).statusCode, 403);
  const enrollment = await request(owner, 'POST', '/platform/admin/security/enroll', { password });
  const secret = enrollment.json().secret; assert.ok(secret);
  assert.equal((await readFile(f.storeFile, 'utf8')).includes(secret), false, 'MFA seed is never stored in plaintext');
  const secondSession = await f.login(owner), code = totp(secret, Math.floor(Date.now() / 30000));
  assert.equal((await request(secondSession, 'POST', '/platform/admin/security/verify', { code })).json().error, 'MFA_ENROLL_REQUIRED');
  assert.equal((await request(owner, 'POST', '/platform/admin/security/verify', { code: 123456 })).json().error, 'MFA_INVALID');
  const competing = await Promise.all([request(owner, 'POST', '/platform/admin/security/verify', { code }), request(owner, 'POST', '/platform/admin/security/verify', { code })]);
  assert.deepEqual(competing.map(response => response.statusCode).sort(), [200, 403]);
  const people = await request(owner, 'GET', '/platform/admin/people');
  assert.equal(people.statusCode, 200, people.body); assert.ok(people.json().users.some(user => user.id === alice.id));
  assert.doesNotMatch(people.body, /passwordHash|tokenHash|csrfToken|adminMfa|ciphertext/);
  assert.equal((await request(secondSession, 'GET', '/platform/admin/people')).json().error, 'ADMIN_MFA_REQUIRED');
  assert.equal((await request(owner, 'POST', '/platform/admin/security/enroll', { password })).statusCode, 409);
  await f.restart();
  assert.equal((await request(owner, 'GET', '/platform/admin/people')).statusCode, 200, 'temporary elevation survives restart only in the same valid session');
  await f.app.missionStore.update(data => { for (const session of data.sessions.filter(item => item.userId === owner.id)) session.adminElevatedUntil = Date.now() - 1; });
  assert.equal((await request(owner, 'GET', '/platform/admin/people')).json().error, 'ADMIN_MFA_REQUIRED');
  await f.restart('different-stable-test-key-with-more-than-32-characters');
  assert.equal((await request(owner, 'POST', '/platform/admin/security/verify', { code: totp(secret, Math.floor(Date.now() / 30000) + 1) })).json().error, 'ADMIN_KEY_UNAVAILABLE');
});

test('MFA enrollment is unavailable without a persistent key and cannot be enabled by a demo account', async t => {
  const f = await fixture(t, { platform: { encryptionKey: '' } });
  assert.equal((await f.request(f.owner, 'GET', '/platform/admin/security')).json().configured, false);
  assert.equal((await f.request(f.owner, 'POST', '/platform/admin/security/enroll', { password })).statusCode, 503);
  const response = await f.request(null, 'POST', '/auth/demo', {});
  const demo = { ...response.json().user, headers: { cookie: cookieOf(response), 'x-csrf-token': response.json().csrfToken } };
  assert.equal((await f.request(demo, 'GET', '/platform/admin/security')).statusCode, 403);
  assert.equal((await f.request(demo, 'POST', '/platform/plans/requests', {})).json().error, 'DEMO_RESTRICTED');
  const people = await f.request(demo, 'GET', '/platform/people');
  assert.equal(people.json().users.some(user => user.id === f.alice.id), false, 'demo directory cannot enumerate permanent accounts');
});

test('platform directory exposes presence and public names without exposing emails, credentials or cross-demo users', async t => {
  const { request, app, owner, alice, bob } = await fixture(t);
  assert.equal((await request(null, 'GET', '/platform/people')).statusCode, 401);
  let people = (await request(alice, 'GET', '/platform/people')).json();
  assert.ok(people.users.some(user => user.id === bob.id)); assert.ok(people.users.some(user => user.id === owner.id));
  assert.doesNotMatch(JSON.stringify(people), /email|password|token|adminMfa|invitationCode/);
  await app.missionStore.update(data => { for (const session of data.sessions.filter(item => item.userId === bob.id)) session.lastSeenAt = new Date(Date.now() - 100_000).toISOString(); });
  people = (await request(alice, 'GET', '/platform/people?q=bob')).json();
  assert.equal(people.users.length, 1); assert.equal(people.users[0].presence, 'offline'); assert.ok(people.users[0].lastSeenAt);
  assert.equal((await request(bob, 'POST', '/auth/heartbeat')).statusCode, 200);
  assert.equal((await request(alice, 'GET', '/platform/people?q=bob')).json().users[0].presence, 'online');
});

test('direct messages enforce participants even for admins, CSRF, idempotency, read cursors and active accounts', async t => {
  const f = await fixture(t), { request, alice, bob, owner } = f;
  assert.equal((await request(alice, 'POST', '/platform/conversations', { recipientId: bob.id }, { 'x-csrf-token': '' })).statusCode, 403);
  const created = await request(alice, 'POST', '/platform/conversations', { recipientId: bob.id });
  assert.equal(created.statusCode, 200, created.body); const id = created.json().conversation.id;
  assert.equal((await request(bob, 'POST', '/platform/conversations', { recipientId: alice.id })).json().conversation.id, id);
  const payload = { key: randomUUID(), body: 'Revise a especificação com as fontes anexadas.' };
  const first = await request(alice, 'POST', `/platform/conversations/${id}/messages`, payload);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal((await request(alice, 'POST', `/platform/conversations/${id}/messages`, payload)).json().message.id, first.json().message.id);
  assert.equal((await request(alice, 'POST', `/platform/conversations/${id}/messages`, { ...payload, body: 'changed' })).statusCode, 409);
  assert.equal((await request(bob, 'GET', `/platform/conversations/${id}`)).json().conversation.unread, 1);
  assert.equal((await request(bob, 'POST', `/platform/conversations/${id}/read`, { through: 1 })).statusCode, 200);
  assert.equal((await request(bob, 'GET', `/platform/conversations/${id}`)).json().conversation.unread, 0);
  await f.elevate();
  for (const actor of [owner, null]) {
    assert.equal((await request(actor, 'GET', `/platform/conversations/${id}`)).statusCode, actor ? 404 : 401);
    assert.equal((await request(actor, 'POST', `/platform/conversations/${id}/messages`, payload)).statusCode, actor ? 404 : 401);
  }
  assert.deepEqual((await request(owner, 'GET', '/platform/conversations')).json().conversations, []);
  assert.equal((await request(alice, 'GET', '/platform/conversations/__proto__')).statusCode, 404);
  await f.app.missionStore.update(data => { data.users.find(user => user.id === bob.id).active = false; });
  assert.equal((await request(alice, 'POST', `/platform/conversations/${id}/messages`, { key: randomUUID(), body: 'Unsent' })).statusCode, 409);
  assert.equal((await request(bob, 'GET', `/platform/conversations/${id}`)).statusCode, 401);
});

test('project conversation access is revoked immediately with membership and cannot be escalated by platform administration', async t => {
  const f = await fixture(t), { request, alice, bob, owner } = f;
  const team = (await request(alice, 'POST', '/teams', { name: 'Project conversation team' })).json().team;
  await f.app.missionStore.update(data => data.teams.find(item => item.id === team.id).memberIds.push(bob.memberId));
  const project = createValidationProject(); project.id = randomUUID(); project.creatorId = alice.id;
  project.context = { ...project.context, teamId: team.id, teamName: team.name, teamArtifactIds: [], projectArtifactIds: [], sectors: [], folders: [], assignments: [{ memberId: alice.memberId, roleId: 'captain', sectorId: '' }, { memberId: bob.memberId, roleId: 'member', sectorId: '' }] };
  const saved = await request(alice, 'POST', '/projects', project); assert.equal(saved.statusCode, 201, saved.body);
  const created = await request(alice, 'POST', '/platform/conversations', { recipientId: bob.id, projectId: project.id });
  assert.equal(created.statusCode, 200, created.body); const id = created.json().conversation.id;
  assert.equal((await request(owner, 'POST', '/platform/conversations', { recipientId: alice.id, projectId: project.id })).statusCode, 404);
  await request(alice, 'POST', `/platform/conversations/${id}/messages`, { key: randomUUID(), body: 'Private engineering context' });
  await f.app.missionStore.update(data => { data.teams.find(item => item.id === team.id).memberIds = [alice.memberId]; });
  assert.equal((await request(bob, 'GET', `/platform/conversations/${id}`)).statusCode, 404);
  assert.deepEqual((await request(bob, 'GET', '/platform/conversations')).json().conversations, []);
  assert.equal((await request(alice, 'POST', `/platform/conversations/${id}/messages`, { key: randomUUID(), body: 'Stopped after revocation' })).statusCode, 403);
});

const selection = { kind: 'company', company: 'Engineering fixture', editors: 2, reviewers: 1, viewers: 3 };
test('plans use server prices, version checks, consent, per-account requests and idempotent manual confirmation', async t => {
  const f = await fixture(t), { request, owner, alice, bob } = f;
  const catalog = (await request(null, 'GET', '/platform/plans')).json();
  assert.equal(catalog.paymentsProcessed, false); assert.ok(catalog.features.includes('meetings_minutes')); assert.ok(catalog.features.includes('document_extraction'));
  const quoteResponse = await request(alice, 'POST', '/platform/plans/quote', { ...selection, monthlyCents: 1 });
  assert.equal(quoteResponse.statusCode, 200); const quote = quoteResponse.json().quote;
  assert.equal(quote.monthlyCents, catalog.catalog.company + 2 * catalog.catalog.editor + catalog.catalog.reviewer);
  const payload = { key: randomUUID(), selection, consent: true, version: quote.version, expectedCents: quote.monthlyCents };
  assert.equal((await request(alice, 'POST', '/platform/plans/requests', { ...payload, expectedCents: 1 })).statusCode, 409);
  assert.equal((await request(alice, 'POST', '/platform/plans/requests', { ...payload, consent: false })).statusCode, 400);
  const result = await request(alice, 'POST', '/platform/plans/requests', payload);
  assert.equal(result.statusCode, 200, result.body); let order = result.json().request;
  const duplicate = await request(alice, 'POST', '/platform/plans/requests', payload); assert.equal(duplicate.json().request.id, order.id);
  assert.equal((await request(alice, 'POST', '/platform/plans/requests', { ...payload, selection: { ...selection, editors: 3 } })).statusCode, 409);
  assert.deepEqual((await request(bob, 'GET', '/platform/plans/requests')).json().requests, []);
  assert.equal((await request(bob, 'POST', `/platform/plans/requests/${order.id}/cancel`, { version: 1 })).statusCode, 404);
  assert.equal((await request(owner, 'POST', `/platform/admin/plans/${order.id}`, { version: 1, status: 'confirmed', confirm: true })).json().error, 'ADMIN_MFA_REQUIRED');
  await f.elevate();
  assert.equal((await request(owner, 'POST', `/platform/admin/plans/${order.id}`, { version: 1, status: 'confirmed', confirm: true })).json().error, 'OFFER_PENDING');
  const approval = await request(owner, 'POST', '/platform/admin/plans/catalog', { version: catalog.catalog.version, prices: catalog.catalog, approved: true });
  assert.equal(approval.statusCode, 200, approval.body);
  assert.equal((await request(owner, 'POST', '/platform/admin/plans/catalog', { version: catalog.catalog.version, prices: catalog.catalog, approved: true })).statusCode, 409);
  const confirmed = await request(owner, 'POST', `/platform/admin/plans/${order.id}`, { version: order.version, status: 'confirmed', confirm: true });
  assert.equal(confirmed.statusCode, 200, confirmed.body); order = confirmed.json().request;
  const entitlement = (await request(alice, 'GET', '/platform/plans/requests')).json().entitlement;
  assert.equal(entitlement.paymentVerifiedAutomatically, false); assert.equal(entitlement.confirmation, 'manual');
  assert.ok(Date.parse(entitlement.until) > Date.now() + 29 * 86400000);
  assert.equal((await request(owner, 'POST', `/platform/admin/plans/${order.id}`, { version: order.version, status: 'confirmed', confirm: true })).statusCode, 409);
  assert.equal((await request(alice, 'POST', `/platform/plans/requests/${order.id}/cancel`, { version: order.version })).statusCode, 409);
  await f.restart();
  assert.equal((await request(alice, 'GET', '/platform/plans/requests')).json().entitlement.until, entitlement.until);
  assert.equal(f.app.missionStore.read().platform.planRequests.length, 1);
});

test('catalog changes require renewed customer quote and revoked administrator cannot mutate after admission', async t => {
  const f = await fixture(t), { request, alice, owner } = f; await f.elevate();
  const catalog = (await request(null, 'GET', '/platform/plans')).json().catalog;
  const quote = (await request(alice, 'POST', '/platform/plans/quote', selection)).json().quote;
  const order = (await request(alice, 'POST', '/platform/plans/requests', { key: randomUUID(), selection, consent: true, version: quote.version, expectedCents: quote.monthlyCents })).json().request;
  assert.equal((await request(owner, 'POST', '/platform/admin/plans/catalog', { version: catalog.version, prices: { ...catalog, company: catalog.company + 100 }, approved: true })).statusCode, 200);
  assert.equal((await request(owner, 'POST', `/platform/admin/plans/${order.id}`, { version: order.version, status: 'confirmed', confirm: true })).json().error, 'QUOTE_CHANGED');
  // A queued request passed HTTP authorization before a concurrent revocation.
  // Intercept its transaction to model that race without relying on timing.
  const store = f.app.missionStore, update = store.update.bind(store); let revoke = true;
  store.update = mutator => update(async data => { if (revoke) { data.users.find(user => user.id === owner.id).accessRole = 'member'; revoke = false; } return mutator(data); });
  const denied = await request(owner, 'POST', '/platform/admin/plans/catalog', { version: catalog.version + 1, prices: catalog, approved: true });
  store.update = update;
  assert.equal(denied.statusCode, 403, denied.body);
  assert.equal((await request(null, 'GET', '/platform/plans')).json().catalog.company, catalog.company + 100);
});

test('telemetry requires consent and session proof, strips payload PII, deduplicates and gates analytics', async t => {
  const f = await fixture(t), { request, alice, bob, owner } = f;
  assert.equal((await request(null, 'POST', '/platform/telemetry/session', { consent: false })).statusCode, 400);
  assert.equal((await request(null, 'POST', '/platform/telemetry/session', { consent: true }, { origin: 'bad://', host: 'app.example.test' })).statusCode, 403);
  assert.equal((await request(null, 'POST', '/platform/telemetry/session', { consent: true }, { origin: 'https://other.example.test', host: 'app.example.test' })).statusCode, 403);
  assert.equal((await request(null, 'POST', '/platform/telemetry/session', { consent: true }, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  const session = await request(alice, 'POST', '/platform/telemetry/session', { consent: true });
  assert.equal(session.statusCode, 200, session.body);
  const headers = { cookie: `${alice.headers.cookie}; ${cookieOf(session)}`, 'x-usage-token': session.json().csrfToken };
  const payload = { key: randomUUID(), page: 'plans', name: 'page_view', options: { kind: 'company', editors: 2, email: 'do-not-store@example.test', document: 'secret content' }, country: 'US', region: 'Spoofed', ip: '192.0.2.42', content: 'secret content', activeSeconds: 9000 };
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', payload)).statusCode, 403);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', payload, headers)).statusCode, 200);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', payload, headers)).statusCode, 200);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', { ...payload, key: randomUUID(), page: '/project/secret-name' }, headers)).statusCode, 400);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', { ...payload, key: 'email@example.test' }, headers)).statusCode, 400);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', { key: randomUUID(), page: 'plans', name: 'page_time', activeSeconds: 9000, options: null }, headers)).statusCode, 200);
  const events = f.app.missionStore.read().telemetry.events;
  assert.equal(events.length, 2); assert.equal(events[1].activeSeconds, 60); assert.equal(events[0].country, null);
  assert.doesNotMatch(JSON.stringify(events), /secret content|do-not-store|192\.0\.2\.42|Spoofed|email/);
  assert.equal((await request(alice, 'GET', '/platform/admin/analytics')).statusCode, 403);
  assert.equal((await request(owner, 'GET', '/platform/admin/analytics')).json().error, 'ADMIN_MFA_REQUIRED');
  await f.elevate();
  const analytics = (await request(owner, 'GET', '/platform/admin/analytics')).json();
  assert.equal(analytics.consentedSessions, 1); assert.equal(analytics.pages.find(page => page.page === 'plans').averageActiveSeconds, 60); assert.equal(analytics.funnel.find(step => step.step === 'plans').visitors, 1);
  const changed = { ...headers, cookie: `${bob.headers.cookie}; ${cookieOf(session)}` };
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', { ...payload, key: randomUUID() }, changed)).json().error, 'USAGE_SESSION_CHANGED');
  assert.equal((await request(null, 'DELETE', '/platform/telemetry/session', undefined, headers)).statusCode, 200);
  assert.equal(f.app.missionStore.read().telemetry.events.length, 0);
  assert.equal((await request(null, 'POST', '/platform/telemetry/events', { ...payload, key: randomUUID() }, headers)).statusCode, 403);
});

test('trusted location is explicit and usage erasure stays scoped to the requesting account', async t => {
  const f = await fixture(t, { platform: { trustedLocation: () => ({ country: 'BR', region: 'SP' }) } });
  for (const actor of [f.alice, f.bob]) {
    const session = await f.request(actor, 'POST', '/platform/telemetry/session', { consent: true });
    const headers = { cookie: `${actor.headers.cookie}; ${cookieOf(session)}`, 'x-usage-token': session.json().csrfToken };
    assert.equal((await f.request(null, 'POST', '/platform/telemetry/events', { key: randomUUID(), page: 'home', name: 'page_view' }, headers)).statusCode, 200);
  }
  assert.equal(f.app.missionStore.read().telemetry.events[0].country, 'BR');
  assert.equal((await f.request(f.alice, 'POST', '/platform/privacy/erase-usage', {})).statusCode, 200);
  const events = f.app.missionStore.read().telemetry.events;
  assert.equal(events.length, 1); assert.equal(events[0].userId, f.bob.id);
  assert.equal(events[0].geoSource, 'trusted_proxy');
});

test('location headers require the configured upstream secret and cannot be forged by the visitor', async t => {
  const previous = process.env.NORTE_GEO_HEADER_SECRET;
  process.env.NORTE_GEO_HEADER_SECRET = 'test-only-geo-proof-with-more-than-32-characters';
  t.after(() => { if (previous === undefined) delete process.env.NORTE_GEO_HEADER_SECRET; else process.env.NORTE_GEO_HEADER_SECRET = previous; });
  const f = await fixture(t);
  const session = await f.request(f.alice, 'POST', '/platform/telemetry/session', { consent: true });
  const headers = { cookie: `${f.alice.headers.cookie}; ${cookieOf(session)}`, 'x-usage-token': session.json().csrfToken, 'x-norte-country': 'BR', 'x-norte-region': 'São Paulo' };
  for (const token of [undefined, 'wrong-proof', process.env.NORTE_GEO_HEADER_SECRET]) {
    const response = await f.request(null, 'POST', '/platform/telemetry/events', { key: randomUUID(), page: 'home', name: 'page_view' }, { ...headers, ...(token ? { 'x-norte-geo-token': token } : {}) });
    assert.equal(response.statusCode, 200, response.body);
  }
  const events = f.app.missionStore.read().telemetry.events;
  assert.deepEqual(events.map(event => event.country), [null, null, 'BR']);
  assert.equal(events[2].region, 'São Paulo');
  assert.doesNotMatch(JSON.stringify(events), /test-only-geo-proof/);
});
