import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { buildApp } from './app.mjs';
import { PostgresDataStore } from './postgres-store.mjs';
import { createMemoryPostgresPool } from './test-support/postgres-memory.mjs';
import { DEMO_TTL_MS } from './demo-account.mjs';

const digest = token => createHash('sha256').update(token).digest('hex');
const cookies = response => [response.headers['set-cookie']].flat().filter(Boolean).map(value => value.split(';')[0]);
async function fixture(t) {
  const store = await new PostgresDataStore('unused', { pool: createMemoryPostgresPool() }).init();
  const app = await buildApp({ store, production: false, logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  const credentials = { email: 'heartbeat@example.test', password: 'isolated heartbeat account passphrase' };
  const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Heartbeat Test', ...credentials } });
  assert.equal(registered.statusCode, 201, registered.body);
  const actor = { id: registered.json().user.id, headers: { cookie: cookies(registered).join('; '), 'x-csrf-token': registered.json().csrfToken } };
  const update = store.update.bind(store);
  let writes = 0;
  store.update = (...args) => { writes++; return update(...args); };
  const request = (method = 'POST', url = '/api/auth/heartbeat', headers = actor.headers) => app.inject({ method, url, headers });
  return { app, store, actor, update, request, credentials, writes: () => writes, reset: () => { writes = 0; },
    async demo() {
      const token = randomBytes(32).toString('base64url');
      await update(data => {
        const user = data.users.find(item => item.id === actor.id);
        Object.assign(user, { isDemoAccount: true, demoSandboxOwner: true, demoSandboxId: 'demo-heartbeat-fixture', demoResumeTokenHash: digest(token), demoExpiresAt: Date.now() + DEMO_TTL_MS });
      });
      actor.headers.cookie += `; norte_demo=${token}`;
      return token;
    },
    async staleSession() {
      await update(data => { for (const session of data.sessions.filter(item => item.userId === actor.id)) session.lastSeenAt = new Date(Date.now() - 60_000).toISOString(); });
    }
  };
}

test('heartbeat after login avoids a full snapshot write, but persists after the presence interval', async t => {
  const f = await fixture(t);
  const login = await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: f.credentials });
  assert.equal(login.statusCode, 200);
  f.actor.headers = { cookie: cookies(login).join('; '), 'x-csrf-token': login.json().csrfToken };
  f.reset(); const revision = f.store.revision;
  assert.equal((await f.request()).statusCode, 200);
  assert.equal(f.writes(), 0);
  assert.equal(f.store.revision, revision);
  await f.staleSession();
  const before = f.store.read(data => data.users[0].lastSeenAt);
  assert.equal((await f.request()).statusCode, 200);
  assert.equal(f.writes(), 1);
  assert.notEqual(f.store.read(data => data.users[0].lastSeenAt), before);
  assert.equal((await f.request()).statusCode, 200);
  assert.equal(f.writes(), 1, 'a second recent heartbeat is a read-only success');
});

test('the recent-heartbeat shortcut still enforces CSRF, logout and account revocation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('POST', '/api/auth/heartbeat', { cookie: f.actor.headers.cookie })).statusCode, 403);
  assert.equal(f.writes(), 0);
  await f.update(data => { data.users.find(user => user.id === f.actor.id).active = false; });
  assert.equal((await f.request()).statusCode, 401);
  assert.equal(f.writes(), 0);
  await f.update(data => { data.users.find(user => user.id === f.actor.id).active = true; });
  assert.equal((await f.request('POST', '/api/auth/logout')).statusCode, 204);
  f.reset();
  assert.equal((await f.request()).statusCode, 401);
  assert.equal(f.writes(), 0);
});

test('recent demo heartbeat and session reads preserve browser recovery without rewriting the snapshot', async t => {
  const f = await fixture(t), token = await f.demo();
  const retained = f.store.read(data => data.users.find(user => user.id === f.actor.id).demoExpiresAt);
  const session = await f.request('GET', '/api/auth/session');
  assert.equal(session.statusCode, 200);
  assert.equal(session.json().authenticated, true);
  assert.equal(session.json().demoResumeAvailable, true);
  assert.equal((await f.request()).statusCode, 200);
  assert.equal(f.writes(), 0);
  assert.equal(f.store.read(data => data.users.find(user => user.id === f.actor.id).demoExpiresAt), retained);
  assert.equal((await f.request('POST', '/api/auth/logout')).statusCode, 204);
  const resumed = await f.request('POST', '/api/auth/demo', { cookie: `norte_demo=${token}` });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.equal(resumed.json().resumed, true);
  assert.equal(resumed.json().user.id, f.actor.id);
});

for (const route of ['/api/auth/session', '/api/auth/heartbeat']) test(`${route} renews older demo retention even with a recent presence timestamp`, async t => {
  const f = await fixture(t), token = await f.demo();
  await f.update(data => { data.users.find(user => user.id === f.actor.id).demoExpiresAt = Date.now() + DEMO_TTL_MS - 60_000; });
  const response = await f.request(route.endsWith('session') ? 'GET' : 'POST', route);
  assert.equal(response.statusCode, 200);
  assert.equal(f.writes(), 1);
  assert(cookies(response).includes(`norte_demo=${token}`));
  assert(f.store.read(data => data.users.find(user => user.id === f.actor.id).demoExpiresAt) > Date.now() + DEMO_TTL_MS - 5000);
});

for (const route of ['/api/auth/session', '/api/auth/heartbeat']) test(`${route} repairs missing or invalid demo recovery cookies before considering a skip`, async t => {
  const f = await fixture(t);
  await f.demo();
  for (const invalid of ['', `; norte_demo=${randomBytes(32).toString('base64url')}`]) {
    f.reset();
    const headers = { ...f.actor.headers, cookie: f.actor.headers.cookie.split('; norte_demo=')[0] + invalid };
    const response = await f.request(route.endsWith('session') ? 'GET' : 'POST', route, headers);
    assert.equal(response.statusCode, 200);
    assert.equal(f.writes(), 1);
    const recovery = cookies(response).find(value => value.startsWith('norte_demo='));
    assert(recovery);
    const token = recovery.slice('norte_demo='.length);
    assert.equal(f.store.read(data => data.users.find(user => user.id === f.actor.id).demoResumeTokenHash), digest(token));
    const repaired = { ...headers, cookie: headers.cookie.split('; norte_demo=')[0] + `; ${recovery}` };
    assert.equal((await f.request(route.endsWith('session') ? 'GET' : 'POST', route, repaired)).statusCode, 200);
    assert.equal(f.writes(), 1, 'the repaired credential makes the next request read-only');
  }
});

test('a failed heartbeat write does not suppress the next explicit attempt', async t => {
  const f = await fixture(t); await f.staleSession();
  const before = f.store.read(data => data.sessions[0].lastSeenAt), counted = f.store.update;
  f.store.update = () => { f.store.update = counted; return Promise.reject(new Error('temporary database failure')); };
  assert.equal((await f.request()).statusCode, 500);
  assert.equal(f.store.read(data => data.sessions[0].lastSeenAt), before);
  assert.equal((await f.request()).statusCode, 200);
  assert.equal(f.writes(), 1);
});
