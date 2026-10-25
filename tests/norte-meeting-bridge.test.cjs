const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../meetings/web/norte-meeting-bridge.js');
const documentModel = require('../meetings/web/meeting-document.js');

function fixture(responses = [], owner = true) {
  const requests = [], events = [], origin = 'https://norte.test';
  const root = {
    fetch: async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(responses.shift() || { value: null, version: 0 }), { status: requests.at(-1).status || 200, headers: { 'Content-Type': 'application/json' } }); },
    Headers, Response, CustomEvent: class { constructor(type) { this.type = type; } },
    document: { body: { dataset: {} }, head: { append() {} }, createElement: () => ({}) },
    location: { origin, href: origin + '/meeting/m1' }, history: { replaceState() {} },
    dispatchEvent: event => events.push(event), addEventListener() {}, setInterval() {}, clearInterval() {}
  };
  root.parent = root;
  const bootstrap = { meeting: { id: 'm1', ownerId: 'owner', title: 'Test', status: 'draft', roomKind: 'meeting', participants: [] }, user: { id: owner ? 'owner' : 'guest', role: 'user' }, csrfToken: 'token' };
  return { root, requests, events, bootstrap };
}

test('gateway rewrites only this origin legacy API and never account endpoints on another origin', () => {
  const base = '/api/meetings/m1/legacy';
  assert.equal(bridge.legacyURL('/api/classify', 'https://norte.test', base), base + '/classify');
  assert.equal(bridge.legacyURL('https://elsewhere.test/api/classify', 'https://norte.test', base), null);
  assert.equal(bridge.legacyURL('/api/meetings/m1/contributions', 'https://norte.test', base), null);
  assert.equal(bridge.legacyURL('/classifier-config.json', 'https://norte.test', base), null);
  assert.throws(() => bridge.configuration({ meeting: { id: '../x' }, user: { id: 'x' }, csrfToken: 'x' }));
});

test('run writes require loaded version, carry CSRF and are restricted to exact meeting key', async () => {
  const f = fixture([{ value: null, version: 4 }, { version: 5 }]), api = bridge.create(f.root, f.bootstrap), key = 'norte.meeting-room.session.v2.m1';
  await assert.rejects(api.storage.write(key, '{"id":"m1"}'), /Carregue/);
  assert.equal(await api.storage.read(key), null);
  await api.storage.write(key, '{"id":"m1","title":"Updated"}');
  assert.equal(JSON.parse(f.requests[1].init.body).expected_version, 4);
  assert.equal(f.requests[1].init.headers.get('x-csrf-token'), 'token');
  await assert.rejects(api.storage.read('norte.meeting-room.session.v2.other'), /selecionada/);
  const count = f.requests.length;
  await api.storage.change('norte.meeting-room.index.v2', raw => ({ value: raw, result: [] }));
  assert.equal(f.requests.length, count, 'embedded library never writes a second meeting index');
});

test('a CAS conflict permanently stops writes instead of retrying an older snapshot', async () => {
  const f = fixture(), calls = [];
  f.root.fetch = async (url, init = {}) => { calls.push({ url, init }); return new Response(JSON.stringify(init.method === 'POST' ? { version: 9, value: 'newer' } : { version: 4, value: null }), { status: init.method === 'POST' ? 409 : 200 }); };
  const api = bridge.create(f.root, f.bootstrap), key = 'norte.meeting-room.session.v2.m1';
  await api.storage.read(key);
  await assert.rejects(api.storage.write(key, '{"id":"m1"}'), /outra aba/);
  await assert.rejects(api.storage.write(key, '{"id":"m1"}'), /outra aba/);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 1);
  assert.equal(api.canWrite(), false); assert.equal(f.events[0].type, 'norte:meeting-conflict');
});

test('participants cannot call processing or persist a run; contribution retries are recognized from source ids', async () => {
  const f = fixture([], false), api = bridge.create(f.root, f.bootstrap);
  const response = await f.root.fetch('/api/classify', { method: 'POST', body: '{}' });
  assert.equal(response.status, 403); assert.equal(f.requests.length, 0);
  await assert.rejects(api.storage.write('norte.meeting-room.session.v2.m1', '{"id":"m1"}'), /anfitrião/);
  assert.equal(bridge.wasContributed({ transcript: [{ segmentId: 'contribution:c1' }] }, { id: 'c1' }), true);
  assert.equal(bridge.wasContributed({ transcript: [] }, { id: 'c1' }), false);
});

test('integrated PDF references keep the authenticated meeting route and exact record', () => {
  const url = documentModel.meetingURL({ id: 'm1', integrated_norte: true, room_kind: 'meeting' }, 'https://norte.test');
  assert.equal(url, 'https://norte.test/meeting/m1?meeting=m1#reuniao');
  assert.equal(documentModel.eventURL(url, 'E004'), 'https://norte.test/meeting/m1?meeting=m1&event=E004#reuniao');
});

test('participants open only the server materialized view without classification archives', () => {
  const snapshot = { id: 'm1', readonly_projection: 'norte.meeting-view.v1', meeting_events: [{ event_id: 'E001', text: 'Ponto preservado.' }], meeting_threads: [], meeting_relations: [], records: [], transcript: [] };
  const f = fixture([], false), api = bridge.create(f.root, f.bootstrap), opened = api.view(snapshot);
  assert.deepEqual(opened.meeting_events, snapshot.meeting_events); opened.meeting_events[0].text = 'Edited locally';
  assert.equal(snapshot.meeting_events[0].text, 'Ponto preservado.');
  assert.throws(() => api.view({ ...snapshot, id: 'another-meeting' }), /inválida/);
  assert.throws(() => api.view({ ...snapshot, readonly_projection: undefined }), /inválida/);
  const host = fixture(), hostApi = bridge.create(host.root, host.bootstrap);
  assert.throws(() => hostApi.view(snapshot), /retomada/);
});
