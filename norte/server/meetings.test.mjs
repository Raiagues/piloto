import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildApp } from './app.mjs';
import { createValidationProject } from './test-support/project.mjs';
const require = createRequire(import.meta.url);
const Session = require('../../meetings/web/meeting-session.js'), Bridge = require('../../meetings/web/norte-meeting-bridge.js'), Hierarchy = require('../../meetings/web/meeting-hierarchy.js');

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
    const r = await request(actor, 'POST', '/meetings', { title: 'Revisão de projeto', ...overrides });
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

test('meeting learning takes its scope from the authenticated route and only the host may correct it', async t => {
  const f = await fixture(t), meeting = await f.create();
  await f.accept(await f.invite(meeting));
  const path = `/meetings/${meeting.id}/legacy/ai/blocks/learning`;
  assert.equal((await f.request(f.guest, 'POST', path, { session_id: meeting.id, action: 'get' })).statusCode, 403);
  assert.equal((await f.request(f.outsider, 'POST', path, { session_id: meeting.id, action: 'get' })).statusCode, 404);
  assert.equal((await f.request(f.host, 'POST', path, { session_id: 'other-meeting', action: 'get' })).statusCode, 403);
  assert.equal((await f.request(f.host, 'POST', path, { session_id: meeting.id, action: 'get' })).statusCode, 200);
  assert.equal(f.calls.at(-1).headers['x-norte-bridge-scope'], `meeting:${meeting.id}`);
  const body = { model: 'jev-latest', state: { current_utterance: 'Decidimos revisar o suporte.', _norte_meeting_id: 'forged', meeting_feedback: { version: 999, examples: [] } }, questions: { event_type: { type: 'choice', instructions: 'Classifique a fala.', criteria: { decision: 'Decisão', observation: 'Observação' } } } };
  const result = await f.request(f.host, 'POST', `/meetings/${meeting.id}/legacy/classify`, body);
  assert.equal(result.statusCode, 200, result.body);
  const forwarded = JSON.parse(f.calls.at(-1).body);
  assert.equal(forwarded.state._norte_meeting_id, meeting.id);
  assert.equal(forwarded.state.meeting_feedback, undefined);
  assert.deepEqual(result.json().request, body, 'browser request is preserved without revealing server-added context');
});

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
  const noCsrf = await f.app.inject({ method: 'POST', url: '/api/meetings', headers: { cookie: f.host.headers.cookie }, payload: { title: 'CSRF' } });
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

test('project-linked meetings retain project ACL after external context removal', async t => {
  const f = await fixture(t), own = await f.project(), m = await f.create(f.host, { projectId: own.project.id });
  assert.equal((await f.request(f.host, 'POST', `/meetings/${m.id}/invitations`, { nickname: f.guest.nickname })).statusCode, 403);
  const invitation = (await f.request(f.host, 'POST', `/teams/${own.team.id}/invitations`, { nickname: f.guest.nickname })).json().invitation;
  await f.request(f.guest, 'POST', `/invitations/${invitation.id}/respond`, { decision: 'accept' });
  await f.accept(await f.invite(m));
  assert.equal((await f.request(f.guest, 'POST', `/meetings/${m.id}/context`, { query: 'Energia' })).statusCode, 404);
  await f.request(f.host, 'DELETE', `/teams/${own.team.id}/members/${f.guest.memberId}`);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}`)).statusCode, 404);
  assert.equal((await f.request(f.guest, 'GET', `/meetings/${m.id}/legacy/records?key=norte.meeting-room.session.v2.${m.id}`)).statusCode, 404);
  assert.equal(f.calls.length, 0);
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
  assert.equal((await f.request(f.host, 'POST', path + '/ai/events', { events: [{ session_id: 'other' }] })).statusCode, 404);
  assert.equal((await f.request(f.host, 'POST', path + '/ai/blocks/learning', { session_id: 'other' })).statusCode, 403);
  assert.equal((await f.request(f.host, 'GET', path + '/ai/aliases')).statusCode, 404);
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
  assert.equal((await f.app.inject({ method: 'GET', url: '/meeting-assets/base.css', headers: f.host.headers })).statusCode, 200);
  assert.equal(refreshes, 4);
  f.app.missionStore.refresh = () => f.app.missionStore.update(data => { data.users.find(user => user.id === f.host.id).active = false; });
  assert.equal((await f.app.inject({ method: 'GET', url: `/meeting/${m.id}`, headers: f.host.headers })).statusCode, 302);
  assert.equal((await f.app.inject({ method: 'GET', url: '/meeting-assets/base.css', headers: f.host.headers })).statusCode, 401);
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
  assert.ok(f.calls.every(call => !call.body || !JSON.parse(call.body).state?.project_memory));
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
  assert.equal((await f.request(f.guest, 'POST', '/meetings', { title: 'Forbidden', scope: 'sector', teamId: own.team.id, projectId: own.project.id, sectorId: 'structure' })).statusCode, 403);
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
