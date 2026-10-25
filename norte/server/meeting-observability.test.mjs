import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createMeetingAccess } from './meeting-service.mjs';
import { projectMeetingTrace, projectMeetingArtifacts, meetingDiagnosticSuggestions, registerMeetingObservability } from './meeting-observability.mjs';

const run = { id: 'm1', transcript: [{ id: 'S1', chunk_id: 'C1', text: 'Medimos 2 mm.', speaker: 'Pessoa' }], records: [{ id: 'C1', status: 'done', storeOutput: { provider: 'official', latencyMs: 20, request: { headers: { authorization: 'SECRET' }, state: { current_utterance: 'Medimos 2 mm.', project_memory: 'EXTERNAL', secret: 'SECRET' }, questions: { keep: { type: 'noul', instructions: 'Preservar resultado?', secret: 'SECRET' } } }, response: { model: 'jev', answers: { keep: { noul: .99, debug: 'SECRET' } } } } }], meeting_events: [{ event_id: 'E1', chunk_id: 'C1', type: 'result', text: 'Medimos 2 mm.', thread_id: 'T1' }], raw_window: ['Medimos 2 mm.'] };
test('trace projection joins real input, fixed questions, answers and produced blocks without credentials or external context', () => {
  const result = projectMeetingTrace(run); assert.equal(result.traces[0].speech[0].text, 'Medimos 2 mm.'); assert.equal(result.traces[0].blocks[0].id, 'E1');
  assert.equal(result.traces[0].stages[0].questions.keep.instructions, 'Preservar resultado?'); assert.equal(result.traces[0].stages[0].answers.keep.noul, .99);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|EXTERNAL|authorization|project_memory/);
  assert.ok(meetingDiagnosticSuggestions(result, { learning: { examples: [] } }).some(item => item.id === 'human-labels'));
});
test('only completed recorded segmentation, topic and relation calls appear in the map', () => {
  const saved = structuredClone(run), output = saved.records[0].storeOutput;
  saved.records[0].segmentation = { checks: [{ literal: true }, { output }] };
  saved.thread_worker = { jobs: [{ event_id: 'E1', parts: [{ request: { state: { current_event: { event_id: 'E1' }, active_thread: { thread_id: 'T1' } }, questions: { same: { type: 'noul', instructions: 'Mesmo assunto?' } } }, output: { response: { answers: { same: { noul: .95 } } } } }, { status: 'queued' }] }] };
  saved.typed_relation_worker = { jobs: [{ chunk_id: 'C1', parts: [{ output }] }, { chunk_id: 'C2', parts: [{ output }] }] };
  const report = projectMeetingTrace(saved), stages = report.traces[0].stages;
  assert.deepEqual(stages.map(item => item.name), ['Segmentação', 'Filtro', 'Assunto', 'Relações']);
  assert.equal(stages[2].questions.same.instructions, 'Mesmo assunto?');
  assert.equal(stages[2].answers.same.noul, .95); assert.match(stages[2].input.active_thread, /T1/);
  assert.equal(projectMeetingTrace(saved, 1).traces.length, 0);
});
test('observability requires admin and current meeting membership, rechecked after reading the engine', async () => {
  const users = [{ id: 'host', active: true }, { id: 'admin', active: true, accessRole: 'owner_admin' }, { id: 'outsider', active: true, accessRole: 'owner_admin' }];
  const data = { users, meetings: { m1: { id: 'm1', title: 'Privada', ownerId: 'host', participantIds: ['admin'], roomKind: 'meeting' } }, workspace: { projects: {} } };
  const app = Fastify(), access = createMeetingAccess({ canAccessProject: () => false }); let calls = 0, revoke = false;
  registerMeetingObservability(app, { store: { read: () => data }, access, requireAuth: async request => { request.auth = { user: users.find(user => user.id === request.headers.actor) }; }, readEngine: async (request, meeting, path) => { calls++; if (revoke) meeting.participantIds = []; return path.includes('/records') ? { value: JSON.stringify(run) } : { editorial: [], editorial_total: 0, learning: { version: 0, examples: [], history: [] } }; } });
  try {
    assert.equal((await app.inject({ url: '/api/admin/meetings/m1/observability', headers: { actor: 'host' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/admin/meetings/m1/observability', headers: { actor: 'outsider' } })).statusCode, 404); assert.equal(calls, 0);
    assert.equal((await app.inject({ url: '/api/admin/meetings/m1/observability', headers: { actor: 'admin' } })).statusCode, 200);
    revoke = true; const revoked = await app.inject({ url: '/api/admin/meetings/m1/observability', headers: { actor: 'admin' } }); assert.equal(revoked.statusCode, 404); assert.doesNotMatch(revoked.body, /Medimos/);
  } finally { await app.close(); }
});

test('persisted minutes and recorded provider metadata do not pretend to populate the block cache', () => {
  const saved = structuredClone(run); saved.input_mode = 'import';
  saved.minutes_document = {presentationVersion: 10, doc:{mode:'organized',event_count:1,editorial_counts:{accepted:0,preserved_original:1},editorial_fallbacks:[{event_id:'E1',reason:'Numeric mismatch',secret:'SECRET'}],topics:[{title:'Medição',current:{requirements:[{id:'E1',text:'Medimos 2 mm.',display_text:'Medimos 2 mm.',secret:'SECRET'}]},history:{events:[]}}]}};
  const result=projectMeetingArtifacts(saved);
  assert.equal(result.execution.source,'saved_provider_records');assert.equal(result.execution.recordedCalls,1);assert.deepEqual(result.execution.models,['jev']);
  assert.equal(result.minutes.persisted,true);assert.equal(result.minutes.preservedOriginal,1);assert.equal(result.minutes.entries[0].id,'E1');assert.equal(result.minutes.fallbacks[0].reason,'Numeric mismatch');
  assert.doesNotMatch(JSON.stringify(result),/SECRET|editorial_total/);
  const empty=projectMeetingArtifacts({});assert.equal(empty.execution.source,'no_recorded_calls');assert.equal(empty.minutes.persisted,false);assert.deepEqual(empty.minutes.entries,[]);
});
