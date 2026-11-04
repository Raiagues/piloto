const { test } = require('node:test'),
  assert = require('node:assert/strict');
const F = require('./fixtures/memory-batch.cjs'),
  T = require('../meetings/web/thread-worker.js');
const { response, chunkOutput, clone } = require('./fixtures/thread-scenarios.cjs');
const batch = (ids, expected_threads = {}) => ({
  batch_id: 'CONFIDENCE',
  cases: ids.map(id => ({
    id,
    current_utterance: 'Input ' + id,
    expected_store_memory: true,
    expected_event_type: 'observation',
  })),
  expected_threads,
});
const reply = (req, choice, p = 0.94) =>
  response(req, Object.fromEntries(Object.keys(req.questions).map(id => [id, choice])), p);
async function execute(input, send) {
  const run = F.createRun(input, 'official'),
    requests = [];
  const worker = T.start(run, {
    send: async req => {
      requests.push(clone(req));
      return send(req);
    },
  });
  await F.execute(run, {
    mode: 'burst',
    wait: async () => {},
    send: async req => chunkOutput(req, input),
    onChange: (_, change) => {
      if (change.phase === 'complete' && change.record.result?.store) worker.enqueue(run.meeting_events.at(-1));
    },
  });
  worker.close();
  await worker.done;
  return { run, requests };
}
test('low active answers consult archives and remain pending when archives are also inconclusive', async () => {
  for (const choice of ['belongs', 'does_not_belong', 'uncertain']) {
    const { run, requests } = await execute(
      batch(['first', 'switch', 'low', 'after'], { low: null, after: 'T002' }),
      req =>
        reply(
          req,
          req.state.current_event.chunk_id === 'switch'
            ? 'does_not_belong'
            : req.state.current_event.chunk_id === 'low'
              ? choice
              : 'belongs',
          req.state.current_event.chunk_id === 'low' ? 0.7 : 0.94,
        ),
    );
    const job = run.thread_worker.jobs[2];
    assert.equal(job.result.reason, 'low_confidence_archive');
    assert.equal(job.parts.length, 2);
    assert.equal(T.shouldSearchArchives(job), true);
    assert.equal(requests.length, 4);
    assert.equal(run.meeting_events[2].thread_assignment_state, 'pending');
    assert.equal(run.meeting_events[3].thread_id, 'T002');
    assert.deepEqual(
      run.meeting_threads.map(t => [t.thread_id, t.status, t.anchor_event_ids]),
      [
        ['T001', 'archived', ['E001']],
        ['T002', 'active', ['E002', 'E004']],
      ],
    );
    assert.deepEqual(
      requests.at(-1).state.active_thread.events.map(e => e.event_id),
      ['E002'],
    );
    assert.ok(
      requests.at(-1).state.recent_context.some(c => c.chunk_id === 'low'),
      'pending utterance remains in linguistic context',
    );
    assert.equal(
      requests.at(-1).state.current_event.thread_assignment_state,
      'pending',
      'the complete current event uses its pre-assignment state',
    );
    assert.equal(requests.at(-1).state.active_thread.events[0].thread_assignment_state, 'assigned');
    assert.deepEqual(F.restore(clone(run)).thread_worker, run.thread_worker);
  }
});
test('archive answers below 80% cannot reactivate or create threads; exactly 80% is sufficient', async () => {
  for (const choice of ['belongs', 'does_not_belong', 'uncertain'])
    for (const p of [0.79, 0.8]) {
      const expected = p < 0.8 || choice === 'uncertain' ? null : choice === 'belongs' ? 'T001' : 'T003';
      const { run, requests } = await execute(
        batch(['first', 'switch', 'check'], {
          check: {
            expected_active_result: 'does_not_belong',
            expected_archive_results: { T001: choice },
            expected_thread_id: expected,
          },
        }),
        req =>
          reply(req, req.state.candidate_threads ? choice : 'does_not_belong', req.state.candidate_threads ? p : 0.94),
      );
      const job = run.thread_worker.jobs[2];
      assert.equal(job.parts.length, 2);
      assert.equal(requests.length, 3);
      assert.equal(run.meeting_events[2].thread_id, expected);
      assert.equal(run.meeting_events[2].thread_assignment_state, expected ? 'assigned' : 'pending');
      assert.equal(run.meeting_threads.find(t => t.status === 'active').thread_id, expected || 'T002');
      assert.equal(run.meeting_threads.length, expected === 'T003' ? 3 : 2);
      assert.equal(
        job.result.reason,
        p < 0.8
          ? 'low_confidence_archive'
          : choice === 'uncertain'
            ? 'uncertain_archive'
            : choice === 'belongs'
              ? 'reopened'
              : 'no_archive_match',
      );
      assert.equal(T.audit(run, job).matches, true);
      assert.equal(T.audit(run, job).tone, p < 0.8 ? 'warning' : 'pass');
      assert.deepEqual(F.restore(clone(run)).meeting_threads, run.meeting_threads);
    }
});
test('one confident archive match plus a low negative in the same request still leaves assignment pending', async () => {
  for (const p of [0.79, 0.8]) {
    const { run, requests } = await execute(batch(['first', 'second', 'third', 'return']), req => {
      const back = req.state.current_event.chunk_id === 'return';
      const out = reply(req, 'does_not_belong');
      if (back && req.state.candidate_threads) {
        Object.assign(out.response.answers.belongs_to_archive_thread__T001, {
          choice: 'belongs',
          probabilities: { belongs: 0.94, does_not_belong: 0.03, uncertain: 0.03 },
        });
        out.response.answers.belongs_to_archive_thread__T002.probabilities = {
          belongs: (1 - p) / 2,
          does_not_belong: p,
          uncertain: (1 - p) / 2,
        };
      }
      return out;
    });
    assert.equal(run.meeting_threads.length, 3);
    assert.equal(run.meeting_events[3].thread_id, p < 0.8 ? null : 'T001');
    assert.equal(run.meeting_threads.find(t => t.status === 'active').thread_id, p < 0.8 ? 'T003' : 'T001');
    const archive = requests.filter(
      req => req.state.current_event.chunk_id === 'return' && req.state.candidate_threads,
    );
    assert.equal(archive.length, 1);
    assert.deepEqual(Object.keys(archive[0].questions), [
      'belongs_to_archive_thread__T001',
      'belongs_to_archive_thread__T002',
    ]);
    assert.deepEqual(F.restore(clone(run)).meeting_events, run.meeting_events);
  }
});

test('assignment table covers safe matches, uncertainty, low probability, failures and missing calls', () => {
  const threads = [
    { thread_id: 'T001', status: 'archived' },
    { thread_id: 'T002', status: 'archived' },
    { thread_id: 'T003', status: 'active' },
  ];
  const states = [
    ['belongs', 0.8],
    ['belongs', 0.7999999999999],
    ['does_not_belong', 0.8],
    ['does_not_belong', 0.7999999999999],
    ['uncertain', 0.95],
    ['uncertain', 0.6],
    ['failed'],
    ['missing'],
  ];
  function part(stage, id, state) {
    if (state[0] === 'missing') return [];
    if (state[0] === 'failed') return [{ stage, candidate_ids: [id], status: 'error', error: 'Network failure' }];
    const key = stage === 'active' ? 'belongs_to_active_thread' : 'belongs_to_archive_thread__' + id;
    const req = { model: 'jev-latest', state: {}, questions: { [key]: T.defaults.questions.belongs_to_active_thread } };
    return [{ stage, candidate_ids: [id], status: 'done', output: response(req, { [key]: state[0] }, state[1]) }];
  }
  for (const active of states)
    for (const one of states)
      for (const two of states) {
        const job = {
          active_thread_id: 'T003',
          parts: [...part('active', 'T003', active), ...part('archive', 'T001', one), ...part('archive', 'T002', two)],
        };
        const positive = s => s[0] === 'belongs' && s[1] >= 0.8,
          negative = s => s[0] === 'does_not_belong' && s[1] >= 0.8;
        const expected = positive(active)
          ? 'T003'
          : positive(one) && negative(two)
            ? 'T001'
            : negative(one) && positive(two)
              ? 'T002'
              : negative(active) && negative(one) && negative(two)
                ? 'T004'
                : null;
        const before = clone({ job, threads }),
          actual = T.decide(job, threads);
        assert.equal(actual.thread_id, expected, JSON.stringify({ active, one, two }));
        assert.equal(T.shouldSearchArchives(job), !positive(active));
        assert.deepEqual({ job, threads }, before, 'routing cannot rewrite answers or thread state');
      }
  assert.equal(T.decide({ parts: [] }, []).reason, 'first_event');
  assert.equal(T.decide({ parts: [] }, [{ thread_id: 'T001', status: 'active' }]).thread_id, null);
});

test('uncertain and low active answers reactivate a unique archive, after checking every other archive', async () => {
  for (const [choice, p] of [
    ['uncertain', 0.94],
    ['uncertain', 0.6],
    ['belongs', 0.79],
    ['does_not_belong', 0.79],
    ['does_not_belong', 0.8],
  ]) {
    const input = batch(['first', 'second', 'third', 'return', 'after']);
    const { run, requests } = await execute(input, req => {
      const id = req.state.current_event.chunk_id;
      if (id === 'return' && req.state.active_thread) return reply(req, choice, p);
      if (id === 'return')
        return response(
          req,
          { belongs_to_archive_thread__T001: 'belongs', belongs_to_archive_thread__T002: 'does_not_belong' },
          0.8,
        );
      return reply(req, id === 'after' ? 'belongs' : 'does_not_belong');
    });
    const job = run.thread_worker.jobs[3],
      calls = requests.filter(req => req.state.current_event.chunk_id === 'return');
    assert.equal(calls.length, 2);
    assert.equal(job.result.route, 'archive');
    assert.equal(job.result.thread_id, 'T001');
    assert.deepEqual(
      calls[1].state.candidate_threads.map(thread => thread.thread_id),
      ['T001', 'T002'],
    );
    assert.equal(job.parts[0].output.response.answers.belongs_to_active_thread.choice, choice);
    assert.equal(job.parts[0].output.response.answers.belongs_to_active_thread.probabilities[choice], p);
    assert.deepEqual(
      run.meeting_threads.map(t => [t.thread_id, t.status, t.anchor_event_ids]),
      [
        ['T001', 'active', ['E001', 'E004', 'E005']],
        ['T002', 'archived', ['E002']],
        ['T003', 'archived', ['E003']],
      ],
    );
    assert.deepEqual(F.restore(clone(run)).thread_worker, run.thread_worker);
  }
});

test('rejecting all archives cannot create a new thread until the active answer is a safe rejection too', async () => {
  for (const [choice, p] of [
    ['uncertain', 0.94],
    ['belongs', 0.79],
    ['does_not_belong', 0.79],
    ['does_not_belong', 0.8],
  ]) {
    const { run, requests } = await execute(batch(['first', 'second', 'check']), req =>
      req.state.current_event.chunk_id === 'check' && req.state.active_thread
        ? reply(req, choice, p)
        : reply(req, 'does_not_belong', 0.8),
    );
    const accepted = choice === 'does_not_belong' && p >= 0.8;
    assert.equal(requests.filter(req => req.state.current_event.chunk_id === 'check').length, 2);
    assert.equal(run.meeting_events[2].thread_id, accepted ? 'T003' : null);
    assert.equal(run.meeting_threads.find(t => t.status === 'active').thread_id, accepted ? 'T003' : 'T002');
    assert.deepEqual(F.restore(clone(run)).meeting_threads, run.meeting_threads);
  }
});

test('failed or invalid archive calls stay pending; a failed active call is never a rejection', async () => {
  for (const failure of ['active', 'archive', 'invalid_archive', 'active_with_archive_match']) {
    const { run, requests } = await execute(batch(['first', 'second', 'check']), req => {
      if (req.state.current_event.chunk_id !== 'check') return reply(req, 'does_not_belong');
      const active = !!req.state.active_thread;
      if ((active && failure.startsWith('active')) || (!active && failure === 'archive'))
        throw Error('Fixture failed call');
      if (!active && failure === 'invalid_archive')
        return { ...reply(req, 'does_not_belong'), response: { model: 'fixture', answers: {} } };
      return reply(req, !active && failure === 'active_with_archive_match' ? 'belongs' : 'does_not_belong');
    });
    const recovered = failure === 'active_with_archive_match',
      job = run.thread_worker.jobs[2];
    assert.equal(requests.filter(req => req.state.current_event.chunk_id === 'check').length, 2);
    assert.equal(job.status, recovered ? 'done' : 'error');
    assert.equal(run.meeting_events[2].thread_id, recovered ? 'T001' : null);
    assert.equal(run.meeting_threads.length, 2);
    assert.equal(run.meeting_threads.find(t => t.status === 'active').thread_id, recovered ? 'T001' : 'T002');
    assert.ok(job.parts.some(part => part.status === 'error'));
    assert.deepEqual(F.restore(clone(run)).thread_worker, run.thread_worker);
  }
});

test('v3 history retains its calls and pending decisions instead of acquiring unexecuted archive queries', async () => {
  const { run } = await execute(batch(['first', 'second', 'low']), req =>
    reply(
      req,
      req.state.current_event.chunk_id === 'low' ? 'uncertain' : 'does_not_belong',
      req.state.current_event.chunk_id === 'low' ? 0.7 : 0.94,
    ),
  );
  const historical = clone(run),
    job = historical.thread_worker.jobs[2];
  historical.thread_worker.schemaVersion = 3;
  historical.thread_worker.calls -= job.parts.filter(part => part.stage === 'archive').length;
  job.parts = job.parts.filter(part => part.stage === 'active');
  job.result = { thread_id: null, route: 'pending', reason: 'low_confidence_active' };
  const restored = F.restore(historical);
  assert.deepEqual(restored.thread_worker, historical.thread_worker);
  assert.equal(T.shouldSearchArchives(job, 3), false);
  assert.equal(T.shouldSearchArchives(job, 4), true);
  assert.equal(restored.meeting_threads.find(t => t.status === 'active').thread_id, 'T002');
});
