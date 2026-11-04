const { test } = require('node:test'),
  assert = require('node:assert/strict');
const F = require('./fixtures/memory-batch.cjs'),
  T = require('../meetings/web/thread-worker');
const { clone, chunkOutput, response } = require('./fixtures/thread-scenarios.cjs');
const batch = require('./fixtures/memory-b001-continuity.json');

async function execute(probability = 0.86) {
  const run = F.createRun(batch, 'official'),
    sent = [];
  let time = Date.parse('2030-01-01T00:00:00Z');
  const worker = T.start(run, {
    send: async req => {
      sent.push(clone(req));
      return response(
        req,
        { belongs_to_active_thread: req.state.current_event.chunk_id === 'C12' ? 'uncertain' : 'belongs' },
        probability,
      );
    },
  });
  await F.execute(run, {
    now: () => time,
    send: async req => {
      time += 1200;
      return chunkOutput(req, batch);
    },
    onChange: (_, change) => {
      if (change.phase === 'complete' && change.record.result?.store) worker.enqueue(run.meeting_events.at(-1));
    },
  });
  worker.close();
  await worker.done;
  return { run, sent };
}

test('legacy v2 calls restore byte-for-byte', () => {
  const saved = clone(require('./fixtures/memory-threads-v2.json')),
    before = JSON.stringify(saved);
  const restored = F.restore(saved);
  assert.equal(restored.thread_worker.schemaVersion, 2);
  assert.deepEqual(restored.thread_worker, saved.thread_worker);
  assert.equal(JSON.stringify(saved), before);
});

test('pending C13 remains in C14 context without being inserted into active_thread.events', async () => {
  const run = F.createRun(batch, 'official');
  const worker = T.start(run, {
    send: async req => {
      const id = req.state.current_event.chunk_id;
      return response(
        req,
        { belongs_to_active_thread: id === 'C12' ? 'uncertain' : 'belongs' },
        id === 'C13' ? 0.78 : 0.94,
      );
    },
  });
  await F.execute(run, {
    send: async req => chunkOutput(req, batch),
    onChange: (_, change) => {
      if (change.phase === 'complete' && change.record.result?.store) worker.enqueue(run.meeting_events.at(-1));
    },
  });
  worker.close();
  await worker.done;
  const c13 = run.thread_worker.jobs.find(job => job.chunk_id === 'C13'),
    c14 = run.thread_worker.jobs.find(job => job.chunk_id === 'C14');
  assert.equal(c13.result.reason, 'low_confidence_active');
  const state = c14.parts[0].request.state;
  assert.equal(state.recent_context.at(-1).chunk_id, 'C13');
  assert.equal(state.recent_context.at(-1).text, batch.cases.find(item => item.id === 'C13').current_utterance);
  assert.equal(
    state.active_thread.events.some(event => event.chunk_id === 'C13'),
    false,
  );
  assert.equal(c14.result.thread_id, 'T001');
  assert.equal(T.assignmentThreshold, 0.8, 'the fix must not lower the confidence gate');
  assert.equal(c13.parts[0].output.response.answers.belongs_to_active_thread.probabilities.belongs, 0.78);
  assert.deepEqual(F.restore(clone(run)).thread_worker, run.thread_worker);
});

test('missing chunk IDs and tampered expanded events are rejected, never shortened or guessed', async () => {
  const { run } = await execute();
  const unknown = clone(run);
  unknown.thread_worker.jobs[1].recent_context = ['C999'];
  assert.throws(() => F.restore(unknown), /contexto/);
  assert.throws(() => T.chunkFor(run, 'C999'), /Chunk ausente/);
  for (const field of ['timestamp', 'status', 'text', 'thread_id']) {
    const corrupt = clone(run);
    corrupt.thread_worker.jobs[1].parts[0].request.state.active_thread.events[0][field] = 'corrupted';
    assert.throws(() => F.restore(corrupt), /snapshot/);
  }
  const corrupt = clone(run);
  corrupt.thread_worker.jobs[1].parts[0].request.state.current_event.chunk.text = 'corrupted';
  assert.throws(() => F.restore(corrupt), /snapshot/);
});
