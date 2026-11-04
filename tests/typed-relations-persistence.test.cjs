// Real chunk/thread/typed pipelines with local transport fixtures. No external API.
const { test } = require('node:test'),
  assert = require('node:assert/strict');
const F = require('./fixtures/memory-batch.cjs'),
  T = require('../meetings/web/thread-worker.js'),
  TR = require('../meetings/web/typed-relations.js');
const clone = value => JSON.parse(JSON.stringify(value));
const expected = {
  P: {},
  R: { P: { relation_type: 'result_of', configuration_match: 'exact' } },
  AGAIN: {
    P: { relation_type: 'repeats', configuration_match: 'exact' },
    R: { relation_type: 'repeats', configuration_match: 'exact' },
  },
  BACKGROUND: { P: { relation_type: 'none' }, R: { relation_type: 'none' }, AGAIN: { relation_type: 'none' } },
};
function batch() {
  return {
    batch_id: 'TYPED-PERSISTENCE',
    cases: [
      ['P', 'test_proposal', 'Run bracket trial R1 on unit B4 with a 4 mm wall under a 100 N load.'],
      ['R', 'test_result', 'R1 completed on unit B4 with a 4 mm wall under 100 N; deformation was 0.2 mm.'],
      ['AGAIN', 'test_proposal', 'Repeat R1 as R2 tomorrow on unit B4 with the same 4 mm wall and 100 N load.'],
      ['BACKGROUND', 'observation', 'The bracket drawing title is "Mount, B4".\nThe finish note says zinc.'],
    ].map(([id, expected_event_type, current_utterance]) => ({
      id,
      current_utterance,
      expected_store_memory: true,
      expected_event_type,
    })),
    expected_threads: { P: 'T001', R: 'T001', AGAIN: 'T001', BACKGROUND: 'T001' },
    expected_typed_relations: clone(expected),
  };
}
function choice(question, winner, p = 0.96) {
  const keys = Object.keys(question.criteria);
  return {
    type: 'choice',
    choice: winner,
    confidence: p < 0.8 ? 0.99 : 0.02,
    probabilities: Object.fromEntries(keys.map(key => [key, key === winner ? p : (1 - p) / (keys.length - 1)])),
  };
}
function response(req, answers) {
  return {
    request: clone(req),
    response: { model: 'local-test-fixture', answers, usage: { fixture: true } },
    provider: 'official',
    latencyMs: 7,
  };
}
function typedReply(req) {
  return response(
    req,
    Object.fromEntries(
      Object.entries(req.questions).map(([id, q]) => {
        const [stage, eventId] = id.split('__'),
          source = req.state.current_event.chunk_id,
          target = req.state.candidates.find(c => c.event_id === eventId).chunk_id;
        const wanted = expected[source][target][stage];
        return [
          id,
          choice(q, wanted, source === 'AGAIN' && target === 'R' && stage === 'configuration_match' ? 0.72 : 0.96),
        ];
      }),
    ),
  );
}
async function classifiedRun() {
  const input = batch(),
    run = F.createRun(input, 'official'),
    thread = T.start(run, {
      schemaVersion: 5,
      send: async req =>
        response(req, Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, choice(q, 'belongs')]))),
    });
  await F.execute(run, {
    mode: 'burst',
    wait: async () => {},
    send: async req => {
      const c = input.cases.find(c => c.current_utterance === req.state.current_utterance);
      return response(
        req,
        req.questions.should_store_memory
          ? { should_store_memory: { type: 'noul', noul: 0.98 } }
          : { event_type: choice(req.questions.event_type, c.expected_event_type) },
      );
    },
    onChange: (_, change) => {
      if (change.phase === 'complete' && change.record.result?.store) thread.enqueue(run.meeting_events.at(-1));
    },
  });
  thread.close();
  await thread.done;
  assert.ok(run.meeting_events.every(e => e.thread_id === 'T001'));
  return run;
}
async function completedRun(config = TR.defaults) {
  const run = await classifiedRun();
  await TR.start(run, { config, send: async req => typedReply(req) }).done;
  return run;
}
test('F.restore rebuilds typed edges and lifecycle from immutable calls without accepting a forged derived projection', async () => {
  const run = await completedRun(),
    before = clone(run),
    expectedLifecycle = TR.lifecycle(run),
    forged = clone(run);
  forged.meeting_relations = [{ relation_id: 'invented', relation_type: 'supports' }];
  forged.meeting_events[0].status = 'superseded';
  const restored = F.restore(forged);
  assert.deepEqual(restored.meeting_relations, before.meeting_relations);
  assert.deepEqual(TR.lifecycle(restored), expectedLifecycle);
  assert.equal(restored.typed_relation_worker.schemaVersion, 2);
  assert.deepEqual(restored.typed_relation_worker, before.typed_relation_worker);
  assert.equal(expectedLifecycle.E001.status, 'completed');
  assert.equal(
    expectedLifecycle.E003.status,
    'open',
    'two outgoing repeats edges do not complete the newly scheduled execution',
  );
  assert.equal(
    before.meeting_relations.filter(r => r.source_event_id === 'E003').length,
    2,
    'repeat links to the proposal and identified earlier execution both survive',
  );
  assert.equal(
    before.meeting_relations.find(r => r.source_event_id === 'E003' && r.target_event_id === 'E002').review_state,
    'needs_review',
  );
  const altered = clone(before);
  altered.typed_relation_worker.jobs[1].parts[0].request.state.current_event.text = 'Forged request';
  assert.throws(() => F.restore(altered), /adulterado/);
});

test('oversized semantic state fails visibly before transport, retains full evidence, and restores its unattempted errors', async () => {
  // A worker-level boundary fixture: upstream assignments are already frozen.
  // Each source text fits the chunk contract; the complete pair/history does not.
  const textA = 'A vibration report ' + 'a'.repeat(8500),
    textB = 'A subsequent vibration observation ' + 'b'.repeat(3000);
  const run = {
    provider: 'official',
    status: 'done',
    thread_worker: { status: 'done' },
    batch: {
      batch_id: 'TYPED-LIMIT',
      cases: [
        { id: 'A', current_utterance: textA, expected_store_memory: true, expected_event_type: 'observation' },
        { id: 'B', current_utterance: textB, expected_store_memory: true, expected_event_type: 'observation' },
      ],
      expected_typed_relations: { A: {}, B: { A: { relation_type: 'none' } } },
    },
    meeting_events: [
      { event_id: 'E001', chunk_id: 'A', thread_id: 'T1', type: 'observation', text: textA },
      { event_id: 'E002', chunk_id: 'B', thread_id: 'T1', type: 'observation', text: textB },
    ],
  };
  F.validateBatch(run.batch);
  let calls = 0;
  await TR.start(run, {
    send: async () => {
      calls++;
      throw Error('Should never send oversized state');
    },
  }).done;
  assert.equal(calls, 0);
  assert.equal(run.typed_relation_worker.status, 'error');
  assert.equal(run.typed_relation_worker.jobs[1].status, 'error');
  const part = run.typed_relation_worker.jobs[1].parts[0];
  assert.equal(part.request, undefined);
  assert.equal(part.attempted, undefined);
  assert.match(part.error, /16\.000/);
  assert.equal(run.meeting_events[0].text, textA);
  assert.equal(run.meeting_events[1].text, textB);
  assert.deepEqual(run.meeting_relations, []);
  const audit = TR.audit(run, run.typed_relation_worker.jobs[1]);
  assert.equal(audit.pairs[0].tone, 'error');
  assert.equal(audit.pairs[0].result, null);
  assert.equal(TR.summary(run).not_processed, 1, 'failed preparation is not a fabricated correct none');
  assert.deepEqual(TR.restore(clone(run.typed_relation_worker), run), run.typed_relation_worker);
  assert.equal(calls, 0);
});
