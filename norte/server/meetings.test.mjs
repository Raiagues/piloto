import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { createEngineeringValidationModel } from '../examples/engineering-validation.mjs';
const require = createRequire(import.meta.url);
const Session = require('../../meeting-session.js'), Bridge = require('../../norte-meeting-bridge.js'), Hierarchy = require('../../meeting-hierarchy.js');

const secret = 'test-only-bridge-secret-at-least-thirty-two-characters';
async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-meetings-'));
  const calls = [], records = new Map();
  const app = await buildApp({ logger: false, storeFile: join(directory, 'state.json'), demoAccount: true, meetingGateway: { secret, fetchImpl: async (url, options) => {
    const path = url.pathname + url.search, headers = options.headers;
    const canonical = [options.method, path, headers['x-norte-bridge-user'], headers['x-norte-bridge-scope'], headers['x-norte-bridge-role'], headers['x-norte-bridge-time'], createHash('sha256').update(options.body || '').digest('hex')].join('\n');
    assert.equal(headers['x-norte-bridge-signature'], createHmac('sha256', secret).update(canonical).digest('hex'));
    assert.equal(headers.cookie, undefined); assert.equal(headers.authorization, undefined);
    calls.push({ path, ...options });
    if (['/api/classify', '/api/relations', '/api/typed-relations'].includes(url.pathname)) {
      const request = JSON.parse(options.body), answers = Object.fromEntries(Object.entries(request.questions).map(([id, question]) => {
        if (question.type === 'noul') return [id, { type: 'noul', noul: .99 }];
        const keys = Object.keys(question.criteria), choice = ['conversation', 'observation', 'belongs', 'none'].find(value => keys.includes(value)) || keys[0];
        return [id, { type: 'choice', choice, confidence: .99, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])), debug: 'backend-answer-details' }];
      }));
      return Response.json({ provider: 'official', latencyMs: 1, request, response: { model: 'jev-latest', answers, debug: 'backend-response-details' }, debug: 'backend-diagnostics' });
    }
    if (url.pathname !== '/api/records') return Response.json({ ready: true, provider: 'official' });
    const scope = headers['x-norte-bridge-scope'];
    if (options.method === 'GET') return Response.json(records.get(scope) || { value: null, version: 0 });
    const body = JSON.parse(options.body), old = records.get(scope) || { value: null, version: 0 };
    if (body.expected_version !== old.version) return Response.json({ error: 'version', ...old }, { status: 409 });
    const current = { value: body.value, version: old.version + 1 }; records.set(scope, current);
    return Response.json({ version: current.version });
  } }, ...extra });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function register(name) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: '127.0.0.' + (app.missionStore.read().users.length + 1), payload: { name, nickname: name.toLowerCase(), email: name.toLowerCase() + '@example.test', password: 'meeting test private passphrase ' + name } });
    assert.equal(response.statusCode, 201, response.body);
    return { ...response.json().user, headers: { cookie: [response.headers['set-cookie']].flat().map(value => value.split(';')[0]).join('; '), 'x-csrf-token': response.json().csrfToken } };
  }
  const request = (actor, method, path, payload, headers = {}) => app.inject({ method, url: '/api' + path, headers: { ...actor.headers, ...headers }, ...(payload !== undefined ? { payload } : {}) });
  const owner = await register('Owner'), host = await register('Host'), guest = await register('Guest'), outsider = await register('Outsider');
  async function create(actor = host, overrides = {}) {
    const r = await request(actor, 'POST', '/meetings', { title: 'Revisão de projeto', memoryMode: 'none', ...overrides });
    assert.equal(r.statusCode, 201, r.body); return r.json().meeting;
  }
  async function invite(meeting, recipient = guest) {
    const r = await request(host, 'POST', `/meetings/${meeting.id}/invitations`, { nickname: recipient.nickname });
    assert.equal(r.statusCode, 201, r.body); return r.json().invitation;
  }
  async function accept(invitation, actor = guest) { return request(actor, 'POST', `/meeting-invitations/${invitation.id}/respond`, { decision: 'accept' }); }
  async function project(actor = host) {
    const teamResponse = await request(actor, 'POST', '/teams', { name: 'Equipe própria' });
    assert.equal(teamResponse.statusCode, 201, teamResponse.body);
    const team = teamResponse.json().team;
    const doc = { ...createValidationProject(), id: 'private-' + actor.id, name: 'Projeto privado', context: { ...createValidationProject().context, teamId: team.id, teamName: team.name, assignments: [{ memberId: actor.memberId, roleId: 'captain', sectorId: '' }] } };
    const r = await request(actor, 'POST', '/projects', doc); assert.equal(r.statusCode, 201, r.body);
    return { team, project: r.json().project };
  }
  return { app, calls, records, register, request, owner, host, guest, outsider, create, invite, accept, project };
}

test('meetings are private until the invited account explicitly accepts; administrative role has no content bypass', async t => {
  const f = await fixture(t), m = await f.create();
  for (const actor of [f.owner, f.guest, f.outsider]) {
    assert.equal((await f.request(actor, 'GET', `/meetings/${m.id}`)).statusCode, 404);
    assert.equal((await f.request(actor, 'GET', '/meetings')).json().meetings.length, 0);
  }
  const invitation = await f.invite(m);
  assert.equal((await f.request(f.guest, 'GET', '/meeting-invitations')).json().invitations.length, 1);
  assert.equal((await f.request(f.outsider, 'GET', '/meeting-invitations')).json().invitations.length, 0);
  assert.equal((await f.accept(invitation, f.outsider)).statusCode, 404);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}`)).statusCode, 404);
  assert.equal((await f.accept(invitation)).statusCode, 200);
  assert.equal((await f.accept(invitation)).statusCode, 409);
  const result = await f.request(f.guest, 'GET', `/meetings/${m.id}`);
  assert.equal(result.json().meeting.myRole, 'participant');
  assert.equal(result.json().meeting.participants.length, 2);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/invitations`, { nickname: f.outsider.nickname })).statusCode, 403);
  assert.equal((await f.request(f.host, 'DELETE', `/meetings/${m.id}/participants/${f.guest.id}`)).statusCode, 204);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}`)).statusCode, 404);
});

test('CSRF, host ownership and compare-and-swap prevent unauthorized changes and lost metadata updates', async t => {
  const f = await fixture(t), m = await f.create();
  const noCsrf = await f.app.inject({ method: 'POST', url: '/api/meetings', headers: { cookie: f.host.headers.cookie }, payload: { title: 'CSRF', memoryMode: 'none' } });
  assert.equal(noCsrf.statusCode, 403); assert.equal(noCsrf.json().error, 'CSRF_INVALID');
  const invitation = await f.invite(m); await f.accept(invitation);
  const current = (await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting;
  assert.equal((await f.request(f.guest, 'PATCH', `/meetings/${m.id}`, { title: 'Hijacked', expectedRevision: current.revision })).statusCode, 403);
  const edits = await Promise.all(['A', 'B'].map(title => f.request(f.host, 'PATCH', `/meetings/${m.id}`, { title, expectedRevision: current.revision })));
  assert.deepEqual(edits.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await f.request(f.host, 'PATCH', `/meetings/${m.id}`, { ownerId: f.guest.id, expectedRevision: current.revision })).statusCode, 409);
  assert.equal((await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting.ownerId, f.host.id);
});

test('contributions are an ordered idempotent queue, presence is authenticated, ended meetings reject new turns', async t => {
  const f = await fixture(t), m = await f.create(); await f.accept(await f.invite(m));
  const payload = { text: 'Precisamos validar a potência.', clientId: 'turn-1' };
  const rows = await Promise.all([f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, payload), f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, payload)]);
  assert.equal(rows[0].json().contribution.id, rows[1].json().contribution.id);
  const other = await f.request(f.host, 'POST', `/meetings/${m.id}/contributions`, payload);
  assert.equal(other.json().contribution.sequence, 2);
  const queue = (await f.request(f.host, 'GET', `/meetings/${m.id}/contributions?after=1`)).json();
  assert.equal(queue.contributions.length, 1); assert.equal(queue.cursor, 2);
  const presence = await f.request(f.guest, 'POST', `/meetings/${m.id}/presence`, {});
  assert.equal(presence.json().participants.find(p => p.userId === f.guest.id).online, true);
  assert.equal((await f.request(f.outsider, 'POST', `/meetings/${m.id}/contributions`, payload)).statusCode, 404);
  const current = (await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting;
  await f.request(f.host, 'PATCH', `/meetings/${m.id}`, { expectedRevision: current.revision, status: 'completed' });
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, { text: 'Depois', clientId: 'turn-2' })).statusCode, 409);
});

test('project memory requires current project access for invitation, acceptance, reads, processing and retrieval', async t => {
  let contextCalls = 0;
  const f = await fixture(t, { meetingContext: async ({ project, query }) => { contextCalls++; return { items: [{ id: project.id, text: query }] }; } });
  const own = await f.project(), m = await f.create(f.host, { projectId: own.project.id, memoryMode: 'project' });
  assert.equal((await f.request(f.host, 'POST', `/meetings/${m.id}/invitations`, { nickname: f.guest.nickname })).statusCode, 403);
  const invitation = (await f.request(f.host, 'POST', `/teams/${own.team.id}/invitations`, { nickname: f.guest.nickname })).json().invitation;
  await f.request(f.guest, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' });
  const meetingInvite = await f.invite(m); await f.accept(meetingInvite);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/context`, { query: 'Energia' })).statusCode, 200);
  assert.equal(contextCalls, 1);
  await f.request(f.host, 'DELETE', `/teams/${own.team.id}/members/${f.guest.memberId}`);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}`)).statusCode, 404);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/context`, { query: 'Energia' })).statusCode, 404);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}/legacy/records?key=norte.meeting-room.session.v2.${m.id}`)).statusCode, 404);
  assert.equal(contextCalls, 1); assert.equal(f.calls.length, 0);
  const noMemory = await f.create(f.host, { projectId: own.project.id, memoryMode: 'none' });
  await f.accept(await f.invite(noMemory));
  const context = await f.request(f.guest, 'POST', `/meetings/${noMemory.id}/context`, { query: 'Energia' });
  assert.equal(context.json().enabled, false); assert.deepEqual(context.json().items, []); assert.equal(contextCalls, 1);
});

test('platform owner cannot read, download, invite into or edit another team and project', async t => {
  const f = await fixture(t), { team, project } = await f.project();
  assert.equal(f.owner.accessRole, 'owner_admin');
  assert.equal((await f.request(f.owner, 'GET', `/projects/${project.id}`)).statusCode, 403);
  assert.equal((await f.request(f.owner, 'PATCH', `/teams/${team.id}`, { name: 'Captured' })).statusCode, 403);
  assert.equal((await f.request(f.owner, 'POST', `/teams/${team.id}/invitations`, { nickname: f.guest.nickname })).statusCode, 403);
  assert.equal((await f.request(f.owner, 'PUT', `/projects/${project.id}`, project)).statusCode, 403);
  const artifactResponse = await f.request(f.host, 'POST', '/artifacts', { kind: 'document', label: 'Documento privado', documentText: 'Potência nominal do payload: 2 W.', fileName: 'private.txt', mimeType: 'text/plain', scope: 'project', ownerId: project.id, description: '', tags: [] });
  assert.equal(artifactResponse.statusCode, 201, artifactResponse.body);
  const artifact = artifactResponse.json().artifact;
  const list = (await f.request(f.owner, 'GET', '/artifacts')).json().artifacts;
  assert.equal(list.some(a => a.id === artifact.id), false);
  assert.equal((await f.request(f.owner, 'GET', `/artifacts/${artifact.id}/content`)).statusCode, 404);
  assert.equal((await f.request(f.owner, 'PATCH', `/artifacts/${artifact.id}`, { label: 'Captured' })).statusCode, 403);
});

test('legacy gateway signs server-derived identity, narrows records, enforces host CAS and preserves a failed save', async t => {
  const f = await fixture(t), m = await f.create(); await f.accept(await f.invite(m));
  const path = `/meetings/${m.id}/legacy`, key = 'norte.meeting-room.session.v2.' + m.id;
  const forged = { 'x-norte-bridge-user': f.owner.id, 'x-norte-bridge-scope': 'meeting:other', 'x-norte-bridge-role': 'admin', 'x-norte-bridge-signature': 'fake' };
  assert.equal((await f.request(f.host, 'GET', path + '/records?key=wrong', undefined, forged)).statusCode, 403);
  assert.equal((await f.request(f.host, 'GET', path + '/admin/ai/overview')).statusCode, 404);
  assert.equal((await f.request(f.guest, 'POST', path + '/classify', {}, forged)).statusCode, 403);
  assert.equal((await f.request(f.host, 'GET', path + '/health', undefined, forged)).statusCode, 200);
  assert.equal(f.calls[0].headers['x-norte-bridge-user'], f.host.id);
  assert.equal(f.calls[0].headers['x-norte-bridge-scope'], 'meeting:' + m.id);
  assert.equal(f.calls[0].headers['x-norte-bridge-role'], 'user');
  const run = { id: m.id, title: 'Ata salva', status: 'done', batch: { batch_id: m.id }, meeting_events: [] };
  assert.equal((await f.request(f.host, 'POST', path + '/records', { key, value: JSON.stringify(run) })).statusCode, 400);
  assert.equal((await f.request(f.host, 'POST', path + '/records', { key, expected_version: 0, value: JSON.stringify({ ...run, id: 'other' }) })).statusCode, 403);
  const saved = await f.request(f.host, 'POST', path + '/records', { key, expected_version: 0, value: JSON.stringify(run) }, forged);
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.json().version, 1);
  const conflict = await f.request(f.host, 'POST', path + '/records', { key, expected_version: 0, value: JSON.stringify({ ...run, title: 'stale' }) });
  assert.equal(conflict.statusCode, 409); assert.equal(JSON.parse(conflict.json().value).title, m.title);
  const metadata = (await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting;
  assert.equal(metadata.title, m.title); assert.equal(metadata.status, 'done');
  const read = await f.request(f.guest, 'GET', path + '/records?key=' + encodeURIComponent(key));
  assert.equal(read.statusCode, 200); assert.equal(JSON.parse(read.json().value).id, m.id);
  assert.equal((await f.request(f.host, 'POST', path + '/ai/events', { events: [{ session_id: 'other' }] })).statusCode, 403);
  const compressed = gzipSync(JSON.stringify({ key, expected_version: 1, value: JSON.stringify({ ...run, title: 'Compressed' }) }));
  const r = await f.request(f.host, 'POST', path + '/records', compressed, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().version, 2);
  const renamed = await f.request(f.host, 'PATCH', `/meetings/${m.id}`, { expectedRevision: (await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting.revision, title: 'Título editado no cabeçalho' });
  assert.equal(renamed.statusCode, 200, renamed.body);
  await f.request(f.host, 'POST', path + '/records', { key, expected_version: 2, value: JSON.stringify(run) });
  assert.equal((await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting.title, 'Título editado no cabeçalho');
  assert.equal(JSON.parse((await f.request(f.guest, 'GET', path + '/records?key=' + encodeURIComponent(key))).json().value).title, 'Título editado no cabeçalho');
});

test('meeting HTML keeps bootstrap safe, assets are allowlisted, and login return preserves record reference', async t => {
  const f = await fixture(t), m = await f.create(f.host, { title: '</script><script>alert(1)</script>' });
  let refreshes = 0; f.app.missionStore.refresh = async () => { refreshes++; };
  const html = await f.app.inject({ method: 'GET', url: `/meeting/${m.id}`, headers: f.host.headers });
  assert.equal(html.statusCode, 200); assert.match(html.body, /NORTE_MEETING_BOOTSTRAP/); assert.doesNotMatch(html.body, /<script>alert\(1\)<\/script>/);
  assert.equal(refreshes, 1);
  assert.ok(html.body.indexOf('norte-meeting-bridge.js') > html.body.indexOf('<body'));
  assert.ok(html.body.indexOf('norte-meeting-bridge.js') < html.body.indexOf('speech-windows.js'));
  assert.match(html.headers['content-security-policy'], /nonce-/);
  const anonymous = await f.app.inject({ method: 'GET', url: `/meeting/${m.id}?event=E001` });
  assert.equal(anonymous.statusCode, 302); assert.match(anonymous.headers.location, /event=E001/);
  assert.equal((await f.app.inject({ method: 'GET', url: '/meeting-assets/server.py', headers: f.host.headers })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'GET', url: '/meeting-assets/styles.css', headers: f.host.headers })).statusCode, 200);
  assert.equal(refreshes, 4);
  f.app.missionStore.refresh = () => f.app.missionStore.update(data => { data.users.find(user => user.id === f.host.id).active = false; });
  assert.equal((await f.app.inject({ method: 'GET', url: `/meeting/${m.id}`, headers: f.host.headers })).statusCode, 302);
  assert.equal((await f.app.inject({ method: 'GET', url: '/meeting-assets/styles.css', headers: f.host.headers })).statusCode, 401);
});

test('private project context never returns in classifier echoes; guests see no processing archive and host can resume', async t => {
  const f = await fixture(t, { prepareMeetingRequest: async ({ body }) => ({ ...body, state: { ...body.state, project_memory: { private_context: 'server-only-context' } } }) });
  const m = await f.create(); await f.accept(await f.invite(m));
  const path = `/meetings/${m.id}/legacy`, key = 'norte.meeting-room.session.v2.' + m.id;
  const session = Session.create({ provider: 'official', title: 'Reunião com memória', send: async (request, provider, lane) => {
    const response = await f.request(f.host, 'POST', path + (lane === 'threads' ? '/relations' : lane === 'relations' ? '/typed-relations' : '/classify'), request);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().request, request, 'the client validator sees its original request');
    assert.doesNotMatch(response.body, /server-only-context|backend-diagnostics|backend-answer-details|backend-response-details|project_memory/);
    return response.json();
  } });
  session.run.id = m.id; session.run.batch.batch_id = m.id;
  session.append('O rádio precisa de alimentação estável.');
  const run = await session.close();
  assert.equal(run.status, 'done'); assert.equal(run.meeting_events.length, 1);
  assert.ok(f.calls.some(call => call.body && JSON.parse(call.body).state?.project_memory?.private_context === 'server-only-context'));
  run.debug = { request: 'archive-only' };
  const written = await f.request(f.host, 'POST', path + '/records', { key, expected_version: 0, value: JSON.stringify(run) });
  assert.equal(written.statusCode, 200, written.body);
  const host = JSON.parse((await f.request(f.host, 'GET', path + '/records?key=' + encodeURIComponent(key))).json().value);
  assert.equal(host.debug.request, 'archive-only'); assert.ok(host.records[0].storeOutput);
  assert.doesNotThrow(() => Session.restore(host));
  const archived = f.records.get('meeting:' + m.id).value;
  const shared = JSON.parse((await f.request(f.guest, 'GET', path + '/records?key=' + encodeURIComponent(key))).json().value);
  assert.doesNotMatch(JSON.stringify(shared), /"(?:request|response|storeOutput|typeOutput|jobs|debug|project_memory)"|archive-only/);
  assert.deepEqual(shared.meeting_events, run.meeting_events);
  assert.deepEqual(shared.transcript.map(({ id, text, source, chunk_id }) => ({ id, text, source, chunk_id })), run.transcript.map(({ id, text, source, chunk_id }) => ({ id, text, source, chunk_id })));
  assert.equal(Hierarchy.build(Bridge.readView(shared, m.id)).topics.length, 1);
  assert.equal(f.records.get('meeting:' + m.id).value, archived, 'reading a projection never rewrites the host archive');
  const resumed = Session.create({ seed: host, provider: 'official', send: async () => { throw Error('Historical classifications must not be replayed'); } });
  assert.deepEqual((await resumed.close()).meeting_events, run.meeting_events);
});

test('demo-created teams, projects, artifacts and meetings inherit the server sandbox rather than client scope', async t => {
  const f = await fixture(t);
  const response = await f.app.inject({ method: 'POST', url: '/api/auth/demo' });
  assert.equal(response.statusCode, 201, response.body);
  const actor = { ...response.json().user, headers: { cookie: [response.headers['set-cookie']].flat().map(value => value.split(';')[0]).join('; '), 'x-csrf-token': response.json().csrfToken } };
  const { team, project } = await f.project(actor);
  const scope = f.app.missionStore.read().users.find(u => u.id === actor.id).demoSandboxId;
  assert.equal(team.demoSandboxId, scope); assert.ok(team.id.startsWith(scope + '-'));
  assert.equal(project.demoSandboxId, scope);
  assert.equal((await f.request(actor, 'GET', `/projects/${project.id}`)).statusCode, 200);
  assert.equal((await f.request(f.owner, 'GET', `/projects/${project.id}`)).statusCode, 403);
  const m = await f.create(actor, { projectId: project.id, memoryMode: 'project' });
  assert.equal(f.app.missionStore.read().meetings[m.id].demoSandboxId, scope);
  assert.equal((await f.request(f.owner, 'GET', `/meetings/${m.id}`)).statusCode, 404);
});

test('long extraction jobs isolate accounts, require explicit CSRF publication and refuse a changed or revoked project', async t => {
  const jobs = new Map(); let sequence = 0;
  const systemAiService = {
    status: () => ({ configured: true, model: 'test' }),
    async start(project, artifacts, language, { scopeKey }) {
      const jobId = 'job-' + ++sequence, job = { jobId, projectId: project.id, status: 'paused', progress: { totalChunks: 2, completedChunks: 1, coverage: .5 }, scopeKey };
      jobs.set(jobId, job); return { jobId, projectId: project.id, status: job.status, progress: job.progress };
    },
    job(id, { scopeKey }) { const job = jobs.get(id); assert.equal(scopeKey, job.scopeKey); return { ...job }; },
    async resume(id, { scopeKey }) { const job = jobs.get(id); assert.equal(scopeKey, job.scopeKey); job.status = 'completed'; job.result = createEngineeringValidationModel(); return { ...job }; }
  };
  const f = await fixture(t, { systemAiService }), own = await f.project();
  const begin = await f.request(f.host, 'POST', '/system-ai/jobs', { projectId: own.project.id, language: 'pt' });
  assert.equal(begin.statusCode, 202, begin.body);
  const job = begin.json(), route = `/system-ai/jobs/${job.jobId}`;
  assert.equal(jobs.get(job.jobId).scopeKey, f.host.id + ':' + own.project.id);
  assert.equal((await f.request(f.owner, 'GET', route + '?projectId=' + own.project.id)).statusCode, 404);
  assert.equal((await f.request(f.host, 'POST', route + '/apply', { projectId: own.project.id })).statusCode, 409);
  assert.equal((await f.request(f.host, 'POST', route + '/resume', { projectId: own.project.id })).statusCode, 202);
  const status = await f.request(f.host, 'GET', route + '?projectId=' + own.project.id);
  assert.equal(status.json().status, 'completed');
  assert.equal(f.app.missionStore.read().workspace.projects[own.project.id].document.engineeringSystem, undefined, 'GET never publishes a generated model');
  const blocked = await f.app.inject({ method: 'POST', url: '/api' + route + '/apply', headers: { cookie: f.host.headers.cookie }, payload: { projectId: own.project.id } });
  assert.equal(blocked.statusCode, 403);
  await f.app.missionStore.update(data => { data.workspace.projects[own.project.id].document.memoryRevision++; });
  const stale = await f.request(f.host, 'POST', route + '/apply', { projectId: own.project.id });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().error, 'PROJECT_MEMORY_CHANGED');
  const fresh = (await f.request(f.host, 'POST', '/system-ai/jobs', { projectId: own.project.id, language: 'pt' })).json();
  const freshRoute = '/system-ai/jobs/' + fresh.jobId;
  await f.request(f.host, 'POST', freshRoute + '/resume', { projectId: own.project.id });
  const applied = await f.request(f.host, 'POST', freshRoute + '/apply', { projectId: own.project.id });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.ok(applied.json().engineeringSystem.entities.length);
  assert.equal((await f.request(f.host, 'POST', freshRoute + '/apply', { projectId: own.project.id })).statusCode, 200, 'publication is idempotent');
  await f.app.missionStore.update(data => { data.teams.find(team => team.id === own.team.id).memberIds = []; });
  assert.equal((await f.request(f.host, 'GET', freshRoute + '?projectId=' + own.project.id)).statusCode, 404);
});

test('regeneration requires review, archives the old map and refuses concurrent corrections', async t => {
  const jobs = new Map(); let sequence = 0;
  const systemAiService = {
    status: () => ({ configured: true }),
    async start(project) {
      const result = createEngineeringValidationModel(); result.generatedFromRevision = project.memoryRevision || 0;
      const job = { jobId: 'regen-' + ++sequence, status: 'completed', result, report: { complete: true, warnings: ['Review sources'] }, progress: { coverage: 1 } };
      jobs.set(job.jobId, job); return job;
    },
    job: id => jobs.get(id)
  };
  const f = await fixture(t, { systemAiService }), own = await f.project();
  const initial = createEngineeringValidationModel(); initial.entities[0].name = 'Correção humana preservada';
  await f.app.missionStore.update(data => {
    const record = data.workspace.projects[own.project.id];
    record.document.engineeringSystem = initial;
    record.document.phaseProgress = { highestUnlockedStep: 2 };
  });
  const payload = { projectId: own.project.id, regenerate: true };
  assert.equal((await f.request(f.host, 'POST', '/system-ai/jobs', { projectId: own.project.id })).statusCode, 409);
  const first = (await f.request(f.host, 'POST', '/system-ai/jobs', payload)).json();
  const route = '/system-ai/jobs/' + first.jobId;
  assert.deepEqual(f.app.missionStore.read().workspace.projects[own.project.id].document.engineeringSystem, initial);
  const noReview = await f.request(f.host, 'POST', route + '/apply', { projectId: own.project.id });
  assert.equal(noReview.json().error, 'SYSTEM_REPLACEMENT_REQUIRES_REVIEW');
  await f.app.missionStore.update(data => { data.workspace.projects[own.project.id].document.engineeringSystem.entities[0].name = 'Nova correção'; });
  assert.equal((await f.request(f.host, 'POST', route + '/apply', payload)).json().error, 'SYSTEM_CHANGED');
  const fresh = (await f.request(f.host, 'POST', '/system-ai/jobs', payload)).json();
  jobs.get(fresh.jobId).report.needsReview = true;
  jobs.get(fresh.jobId).report.omissions = [{ kind: 'evidence', id: 'unverified', reason: 'Citação não comprovada' }];
  const pendingReview = await f.request(f.host, 'POST', '/system-ai/jobs/' + fresh.jobId + '/apply', payload);
  assert.equal(pendingReview.json().error, 'EXTRACTION_REQUIRES_REVIEW');
  const reviewedPayload = { ...payload, reviewed: true };
  const applied = await f.request(f.host, 'POST', '/system-ai/jobs/' + fresh.jobId + '/apply', reviewedPayload);
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().project.phaseProgress.highestUnlockedStep, 2);
  assert.equal(applied.json().regenerated, true);
  const history = await f.request(f.host, 'GET', `/projects/${own.project.id}/system-history`);
  assert.equal(history.json().versions.length, 1);
  assert.equal(history.json().versions[0].engineeringSystem.entities[0].name, 'Nova correção');
  assert.equal(history.json().extractionReport.complete, true);
  assert.equal(history.json().extractionReport.progress.coverage, 1);
  assert.equal(history.json().extractionReport.needsReview, true);
  assert.equal(history.json().extractionReport.omissions.length, 1);
  assert.equal((await f.request(f.outsider, 'GET', `/projects/${own.project.id}/system-history`)).statusCode, 404);
  await f.request(f.host, 'POST', '/system-ai/jobs/' + fresh.jobId + '/apply', reviewedPayload);
  assert.equal((await f.request(f.host, 'GET', `/projects/${own.project.id}/system-history`)).json().versions.length, 1);
});

test('extraction responses and publication recheck current access after awaiting the provider', async t => {
  for (const scenario of [
    { stage: 'start', change: 'team', status: 404 },
    { stage: 'job', change: 'inactive', status: 403 },
    { stage: 'resume', change: 'advisor', status: 403 },
    { stage: 'apply', change: 'inactive', status: 403 }
  ]) await t.test(`${scenario.stage}: ${scenario.change}`, async child => {
    let beforeReturn = async () => {};
    const model = createEngineeringValidationModel();
    model.entities[0].name = 'PRIVATE_EXTRACTION_SENTINEL';
    const result = { jobId: 'acl-race', status: 'completed', result: model, progress: { coverage: 1 } };
    const systemAiService = {
      status: () => ({ configured: true }),
      async start() { await beforeReturn('start'); return result; },
      async job() { await beforeReturn('job'); return result; },
      async resume() { await beforeReturn('resume'); return result; }
    };
    const f = await fixture(child, { systemAiService }), own = await f.project();
    const payload = { projectId: own.project.id }, route = '/system-ai/jobs/acl-race';
    if (scenario.stage !== 'start') {
      const initial = await f.request(f.host, 'POST', '/system-ai/jobs', payload);
      assert.equal(initial.statusCode, 202, initial.body);
    }
    let revoked = false;
    beforeReturn = async stage => {
      if (stage !== (scenario.stage === 'apply' ? 'job' : scenario.stage)) return;
      await f.app.missionStore.update(data => {
        const user = data.users.find(user => user.id === f.host.id);
        if (scenario.change === 'team') data.teams.find(team => team.id === own.team.id).memberIds = [];
        if (scenario.change === 'inactive') user.active = false;
        if (scenario.change === 'advisor') user.accessRole = 'advisor';
      });
      revoked = true;
    };
    const response = scenario.stage === 'start'
      ? await f.request(f.host, 'POST', '/system-ai/jobs', payload)
      : scenario.stage === 'job'
        ? await f.request(f.host, 'GET', route + '?projectId=' + own.project.id)
        : await f.request(f.host, 'POST', route + '/' + scenario.stage, payload);
    assert.equal(revoked, true, 'revocation happened after initial authentication while awaiting extraction');
    assert.equal(response.statusCode, scenario.status, response.body);
    assert.equal(response.body.includes('PRIVATE_EXTRACTION_SENTINEL'), false, 'no completed extraction may escape after access is revoked');
    const record = f.app.missionStore.read().workspace.projects[own.project.id];
    assert.equal(record.document.engineeringSystem, undefined, 'revocation prevents publication');
    assert.equal(record.engineeringHistory?.length || 0, 0);
    const history = await f.request(f.host, 'GET', `/projects/${own.project.id}/system-history`);
    assert.ok([401, 403, 404].includes(history.statusCode), history.body);
    assert.equal(history.body.includes('PRIVATE_EXTRACTION_SENTINEL'), false);
  });
});

test('extraction lookup survives a new app instance, deduplicates navigation starts and omits final graphs from polls', async t => {
  const jobs = new Map(); let starts = 0;
  const service = {
    status: () => ({ configured: true }),
    async start(project, _artifacts, _language, settings) {
      starts++;
      assert.equal(settings.autoRun, true);
      await new Promise(resolve => setTimeout(resolve, 20));
      const job = { jobId: 'durable-job', status: 'completed', projectId: project.id, result: createEngineeringValidationModel(), progress: { coverage: 1 }, report: { complete: true } };
      jobs.set(job.jobId, job); return job;
    },
    job: id => jobs.get(id)
  };
  const f = await fixture(t, { systemAiService: service }), own = await f.project();
  const payload = { projectId: own.project.id, language: 'pt', autoRun: true };
  const [first, second] = await Promise.all([f.request(f.host, 'POST', '/system-ai/jobs', payload), f.request(f.host, 'POST', '/system-ai/jobs', payload)]);
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(second.json().jobId, first.json().jobId);
  assert.equal(starts, 1);
  await f.app.missionStore.update(data => { data.workspace.projects[own.project.id].document.navigation = { lastRoute: 'meeting' }; });
  const navigated = await f.request(f.host, 'POST', '/system-ai/jobs', payload);
  assert.equal(navigated.json().jobId, first.json().jobId);
  assert.equal(starts, 1);
  const metadata = f.app.missionStore.read().workspace.extractionJobs['durable-job'];
  assert.equal(metadata.userId, f.host.id);
  assert.equal(metadata.snapshot, undefined, 'no full artifact data is duplicated in ownership metadata');
  assert.equal(metadata.snapshotHash.length, 64);
  const lookup = await f.request(f.host, 'GET', '/system-ai/jobs/latest?projectId=' + own.project.id);
  assert.equal(lookup.json().job.jobId, 'durable-job');
  assert.equal(lookup.json().job.result, undefined);
  const compact = await f.request(f.host, 'GET', '/system-ai/jobs/durable-job?summary=true&projectId=' + own.project.id);
  assert.equal(compact.json().result, undefined);
  assert.ok(jobs.get('durable-job').result, 'polling cannot mutate the provider result');
  assert.equal((await f.request(f.outsider, 'GET', '/system-ai/jobs/latest?projectId=' + own.project.id)).statusCode, 404);
  const storeFile = f.app.missionStore.filePath;
  await f.app.close();
  const restored = await buildApp({ logger: false, storeFile, systemAiService: service });
  t.after(() => restored.close());
  const request = (method, path, body) => restored.inject({ method, url: '/api' + path, headers: f.host.headers, ...(body ? { payload: body } : {}) });
  const afterRestart = await request('GET', '/system-ai/jobs/latest?projectId=' + own.project.id);
  assert.equal(afterRestart.statusCode, 200, afterRestart.body);
  assert.equal(afterRestart.json().job.jobId, 'durable-job');
  assert.equal(starts, 1, 'recovering the job index does not start another extraction');
  const applied = await request('POST', '/system-ai/jobs/durable-job/apply', payload);
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(restored.missionStore.read().workspace.extractionJobs['durable-job'].applied, true);
  assert.deepEqual((await request('GET', '/system-ai/jobs/latest?projectId=' + own.project.id)).json(), { job: null }, 'published maps never reappear as pending proposals');
});

test('startup restores only the explicitly continuous current job and never a revoked project', async t => {
  const f = await fixture(t, { systemAiService: {
    status: () => ({ configured: true }),
    async start(project) { return { jobId: 'restart-current', projectId: project.id, status: 'running', progress: { completedChunks: 2, totalChunks: 4 } }; }
  } });
  const own = await f.project();
  assert.equal((await f.request(f.host, 'POST', '/system-ai/jobs', { projectId: own.project.id, autoRun: true })).statusCode, 202);
  const storeFile = f.app.missionStore.filePath;
  await f.app.close();
  let restores = 0, recovered = null;
  const service = {
    status: () => ({ configured: true }),
    job() { if (!recovered) throw Object.assign(new Error('Missing'), { code: 'EXTRACTION_JOB_NOT_FOUND' }); return recovered; },
    async restore(id, project, _artifacts, _language, settings) {
      restores++;
      assert.equal(settings.scopeKey, f.host.id + ':' + own.project.id);
      assert.equal(settings.autoRun, true);
      await settings.assertAuthorized();
      recovered = { jobId: id, projectId: project.id, status: 'running', progress: { completedChunks: 2, totalChunks: 4 } };
      return recovered;
    }
  };
  const restarted = await buildApp({ logger: false, storeFile, systemAiService: service });
  await restarted.ready();
  assert.equal(restores, 1);
  const result = await restarted.inject({ method: 'GET', url: '/api/system-ai/jobs/latest?projectId=' + own.project.id, headers: f.host.headers });
  assert.equal(result.json().job.jobId, 'restart-current');
  assert.equal(result.json().job.progress.completedChunks, 2);
  await restarted.missionStore.update(data => { data.users.find(user => user.id === f.host.id).active = false; });
  await restarted.close();
  recovered = null;
  const revoked = await buildApp({ logger: false, storeFile, systemAiService: service });
  t.after(() => revoked.close());
  await revoked.ready();
  assert.equal(restores, 1, 'revoked actor never reaches the recovery service or a provider');
});

test('removed documentary sources cannot escape through an in-memory job after an awaited response', async t => {
  for (const stage of ['start', 'job', 'latest', 'resume']) await t.test(stage, async child => {
    let beforeReturn = async () => {};
    const model = createEngineeringValidationModel(); model.entities[0].name = 'REMOVED_SOURCE_SENTINEL';
    const result = { jobId: 'source-race', status: 'completed', result: model, report: { complete: true, documents: [{ label: 'REMOVED_SOURCE_SENTINEL' }] } };
    const service = {
      status: () => ({ configured: true }),
      async start() { await beforeReturn('start'); return result; },
      async job() { await beforeReturn('job'); return result; },
      async resume() { await beforeReturn('resume'); return result; }
    };
    const f = await fixture(child, { systemAiService: service }), own = await f.project();
    const artifactId = 'document-' + own.project.id;
    await f.app.missionStore.update(data => {
      data.artifacts.push({ id: artifactId, label: 'Engineering source', scope: 'project', ownerId: own.project.id, url: 'data:text/plain;base64,TXkgZG9jdW1lbnQu' });
      data.workspace.projects[own.project.id].document.context.projectArtifactIds.push(artifactId);
    });
    const payload = { projectId: own.project.id };
    if (stage !== 'start') assert.equal((await f.request(f.host, 'POST', '/system-ai/jobs', payload)).statusCode, 202);
    let removed = false;
    beforeReturn = async operation => {
      if (operation !== (stage === 'latest' ? 'job' : stage) || removed) return;
      removed = true;
      await f.app.missionStore.update(data => { data.artifacts = data.artifacts.filter(artifact => artifact.id !== artifactId); });
    };
    const response = stage === 'start' ? await f.request(f.host, 'POST', '/system-ai/jobs', payload)
      : stage === 'resume' ? await f.request(f.host, 'POST', '/system-ai/jobs/source-race/resume', payload)
      : await f.request(f.host, 'GET', '/system-ai/jobs/' + (stage === 'latest' ? 'latest' : 'source-race') + '?projectId=' + own.project.id);
    assert.equal(removed, true);
    assert.equal(response.statusCode, stage === 'latest' ? 200 : 409, response.body);
    assert.equal(response.body.includes('REMOVED_SOURCE_SENTINEL'), false);
    if (stage === 'latest') assert.deepEqual(response.json(), { job: null });
    assert.equal((await f.request(f.host, 'GET', '/projects/' + own.project.id)).statusCode, 200, 'project membership remains authorized');
  });
});

test('team and sector meetings use current explicit membership for lists, links, invitations and audio', async t => {
  const f = await fixture(t), own = await f.project();
  const invitation = (await f.request(f.host, 'POST', `/teams/${own.team.id}/invitations`, { nickname: f.guest.nickname })).json().invitation;
  assert.equal((await f.request(f.guest, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' })).statusCode, 200);
  await f.app.missionStore.update(data => { const project = data.workspace.projects[own.project.id].document; project.context.sectors = [{ id: 'structure', name: 'Estruturas' }, { id: 'power', name: 'Energia' }]; project.context.assignments.push({ memberId: f.guest.memberId, roleId: 'member', sectorId: 'power', sectorRoles: [] }); });
  const general = await f.create(f.host, { scope: 'team', teamId: own.team.id });
  const structure = await f.create(f.host, { scope: 'sector', teamId: own.team.id, projectId: own.project.id, sectorId: 'structure' });
  const power = await f.create(f.host, { scope: 'sector', teamId: own.team.id, projectId: own.project.id, sectorId: 'power' });
  assert.deepEqual((await f.request(f.guest, 'GET', `/meetings?teamId=${own.team.id}`)).json().meetings.map(row => row.id).sort(), [general.id, power.id].sort());
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${structure.id}`)).statusCode, 404);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${structure.id}/audio/join`, {})).statusCode, 404);
  assert.equal((await f.request(f.host, 'POST', `/meetings/${structure.id}/invitations`, { nickname: f.guest.nickname })).statusCode, 403);
  assert.equal((await f.request(f.guest, 'POST', '/meetings', { title: 'Forbidden', memoryMode: 'none', scope: 'sector', teamId: own.team.id, projectId: own.project.id, sectorId: 'structure' })).statusCode, 403);
  assert.deepEqual((await f.request(f.guest, 'GET', '/meeting-scopes')).json().teams[0].projects[0].sectors.map(item => item.id), ['power']);
  assert.equal((await f.request(f.outsider, 'POST', `/meetings/${general.id}/join`, {})).statusCode, 404);
  const joined = await f.request(f.guest, 'POST', `/meetings/${general.id}/join`, {}); assert.equal(joined.statusCode, 200, joined.body); assert.ok(joined.json().meeting.participants.some(person => person.userId === f.guest.id));
  await f.request(f.host, 'DELETE', `/meetings/${general.id}/participants/${f.guest.id}`);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${general.id}/join`, {})).statusCode, 404);
  await f.request(f.host, 'DELETE', `/teams/${own.team.id}/members/${f.guest.memberId}`);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${power.id}`)).statusCode, 404);
  assert.deepEqual((await f.request(f.guest, 'GET', '/meeting-scopes')).json().teams, []);
});

test('audio signaling isolates sessions; host mute cannot be bypassed or silently reversed; speech requires active capture', async t => {
  const f = await fixture(t), m = await f.create(); await f.accept(await f.invite(m));
  const base = `/meetings/${m.id}/audio`;
  assert.equal((await f.request(f.outsider, 'POST', base + '/join', {})).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'POST', url: '/api' + base + '/join', headers: { cookie: f.host.headers.cookie }, payload: {} })).statusCode, 403);
  const hostJoin = (await f.request(f.host, 'POST', base + '/join', {})).json(), guestJoin = (await f.request(f.guest, 'POST', base + '/join', {})).json();
  assert.ok(hostJoin.sessionId); assert.equal(guestJoin.peers.length, 2);
  const signal = { sessionId: hostJoin.sessionId, to: f.guest.id, toSessionId: guestJoin.sessionId, description: { type: 'offer', sdp: 'v=0\r\n' } };
  assert.equal((await f.request(f.host, 'POST', base + '/signal', { ...signal, to: f.outsider.id })).statusCode, 404);
  assert.equal((await f.request(f.guest, 'POST', base + '/signal', signal)).statusCode, 409);
  assert.equal((await f.request(f.host, 'POST', base + '/signal', signal)).statusCode, 200);
  const guestPoll = (await f.request(f.guest, 'POST', base + '/poll', { sessionId: guestJoin.sessionId, after: 0 })).json();
  assert.equal(guestPoll.signals.length, 1); assert.equal(guestPoll.signals[0].from, f.host.id); assert.equal(guestPoll.recording, false);
  const speech = { text: 'A medição foi revisada.', clientId: 'audio-test', kind: 'speech', audioSessionId: guestJoin.sessionId };
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, speech)).statusCode, 403);
  const current = (await f.request(f.host, 'GET', `/meetings/${m.id}`)).json().meeting;
  await f.request(f.host, 'PATCH', `/meetings/${m.id}`, { expectedRevision: current.revision, status: 'running' });
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, speech)).statusCode, 403, 'typing does not enable voice capture');
  assert.equal((await f.request(f.guest, 'POST', base + '/capture', { active: true })).statusCode, 403);
  assert.equal((await f.request(f.host, 'POST', base + '/capture', { active: true })).statusCode, 200);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, speech)).statusCode, 201);
  assert.equal((await f.request(f.guest, 'POST', base + '/poll', { sessionId: guestJoin.sessionId, after: 0 })).json().recording, true);
  const realNow = Date.now; t.mock.method(Date, 'now', () => realNow() + 21_000);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, { ...speech, clientId: 'expired-capture' })).statusCode, 403, 'disconnected host cannot leave recording active');
  t.mock.restoreAll();
  await f.request(f.host, 'POST', base + '/capture', { active: false });
  assert.equal((await f.request(f.guest, 'POST', base + '/poll', { sessionId: guestJoin.sessionId, after: 0 })).json().recording, false);
  await f.request(f.host, 'POST', base + '/capture', { active: true });
  assert.equal((await f.request(f.guest, 'POST', base + '/moderate', { userId: f.host.id, muted: true })).statusCode, 403);
  await f.request(f.host, 'POST', base + '/moderate', { userId: f.guest.id, muted: true });
  assert.equal((await f.request(f.guest, 'POST', base + '/mute', { sessionId: guestJoin.sessionId, muted: false })).statusCode, 403);
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/contributions`, { ...speech, clientId: 'muted' })).statusCode, 403);
  await f.request(f.host, 'POST', base + '/moderate', { userId: f.guest.id, muted: false });
  const released = (await f.request(f.guest, 'POST', base + '/poll', { sessionId: guestJoin.sessionId, after: 0 })).json().peers.find(peer => peer.userId === f.guest.id);
  assert.equal(released.forcedMuted, false); assert.equal(released.muted, true);
  assert.equal((await f.request(f.guest, 'POST', base + '/mute', { sessionId: guestJoin.sessionId, muted: false })).statusCode, 200);
  const newGuest = (await f.request(f.guest, 'POST', base + '/join', {})).json(); assert.notEqual(newGuest.sessionId, guestJoin.sessionId);
  assert.equal((await f.request(f.guest, 'POST', base + '/poll', { sessionId: guestJoin.sessionId, after: 0 })).statusCode, 409);
  assert.equal((await f.request(f.host, 'POST', base + '/signal', signal)).statusCode, 404);
  await f.request(f.host, 'DELETE', `/meetings/${m.id}/participants/${f.guest.id}`);
  assert.equal((await f.request(f.guest, 'POST', base + '/poll', { sessionId: newGuest.sessionId, after: 0 })).statusCode, 404);
  assert.equal((await f.request(f.host, 'POST', base + '/poll', { sessionId: hostJoin.sessionId, after: 0 })).json().peers.length, 1);
});

test('TURN configuration uses one-hour per-account HMAC credentials without returning the shared secret', async () => {
  const { meetingIceConfiguration } = await import('./meeting-audio.mjs');
  const env = { NORTE_TURN_URLS: 'turn:turn.example.test:3478,turns:turn.example.test:5349?transport=tcp', NORTE_TURN_SECRET: 'long-enough-private-test-shared-secret' };
  const now = 1_760_000_000_000, config = meetingIceConfiguration('test-user', env, now), turn = config.iceServers.find(item => item.credential);
  assert.equal(config.relayConfigured, true); assert.equal(turn.username, '1760003600:test-user');
  assert.equal(turn.credential, createHmac('sha1', env.NORTE_TURN_SECRET).update(turn.username).digest('base64'));
  assert.ok(!JSON.stringify(config).includes(env.NORTE_TURN_SECRET));
  assert.equal(meetingIceConfiguration('user', { NORTE_TURN_URLS: env.NORTE_TURN_URLS, NORTE_TURN_SECRET: 'short' }, now).relayConfigured, false);
});

test('fictional meeting examples are idempotent, preserve sources and open read-only without any provider call', async t => {
  const { seedMeetingExamples } = await import('../scripts/seed-meeting-examples.mjs');
  const f = await fixture(t), own = await f.project();
  await f.app.missionStore.update(data => { data.environment = 'quetzal-workspace-test'; const project = data.workspace.projects[own.project.id].document; project.context.sectors = [{ id: 'systems', name: 'Engenharia de sistemas' }]; });
  const initial = f.app.missionStore.read(), usersBefore = JSON.stringify(initial.users), artifactsBefore = JSON.stringify(initial.artifacts);
  assert.throws(() => seedMeetingExamples(initial, { projectId: own.project.id, actorId: f.host.id }), /sandbox|cópia local/);
  const first = seedMeetingExamples(initial, { projectId: own.project.id, actorId: f.host.id, allowLocalTest: true });
  const second = seedMeetingExamples(first.data, { projectId: own.project.id, actorId: f.host.id, allowLocalTest: true });
  assert.equal(first.audit.createdMeetingIds.length, 2); assert.equal(second.audit.changed, false); assert.deepEqual(first.data, second.data);
  assert.equal(JSON.stringify(first.data.users), usersBefore); assert.equal(JSON.stringify(first.data.artifacts), artifactsBefore);
  await f.app.missionStore.update(data => { data.meetings = first.data.meetings; });
  for (const id of first.audit.meetingIds) {
    const meeting = first.data.meetings[id], snapshot = meeting.exampleSnapshot;
    assert.equal(snapshot.transcript.length, 61); assert.equal(snapshot.transcript.at(-1).offsetMs, 1_500_000); assert.equal(snapshot.calls, 0);
    assert.ok(Hierarchy.build(snapshot).topics.length >= 5); assert.match(meeting.title, /MOCK/);
    assert.equal((await f.request(f.host, 'GET', `/meetings/${id}`)).json().meeting.example, true);
    assert.equal((await f.request(f.outsider, 'GET', `/meetings/${id}`)).statusCode, 404);
    const result = await f.request(f.host, 'GET', `/meetings/${id}/legacy/records?key=norte.meeting-room.session.v2.${id}`);
    assert.equal(result.statusCode, 200, result.body); const view = JSON.parse(result.json().value); assert.equal(view.readonly_projection, 'norte.meeting-view.v1');
    assert.doesNotThrow(() => Bridge.readView(view, id));
    assert.equal((await f.request(f.host, 'POST', `/meetings/${id}/legacy/records`, { key: `norte.meeting-room.session.v2.${id}`, value: JSON.stringify(snapshot), expected_version: 1 })).statusCode, 403);
    assert.equal((await f.request(f.host, 'GET', `/meetings/${id}/legacy/health`)).statusCode, 200);
  }
  assert.equal(f.calls.length, 0, 'no paid service or private engine needed to display curated examples');
});
