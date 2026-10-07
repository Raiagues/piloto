#!/usr/bin/env node
'use strict';

// Live verification uses the exact application pipeline. Expected labels are
// retained only in the local run and audited after inference.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../memory-flow.js');
const T = require('../relation-worker.js').threads;
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));

function options(argv) {
  const result = { url: 'http://localhost:8000', legacy: false, chunksOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--legacy') result.legacy = true;
    else if (arg === '--chunks-only') result.chunksOnly = true;
    else if (arg === '--help') result.help = true;
    else if (['--batch', '--output', '--url', '--questions'].includes(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`${arg} requires a value.`);
      result[arg.slice(2)] = argv[++i];
    } else throw Error(`Unknown option: ${arg}`);
  }
  const url = new URL(result.url);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/') {
    throw Error('--url must point to the local Norte server, e.g. http://localhost:8000.');
  }
  result.url = url.origin;
  return result;
}

function assertNoExpected(value, location = 'request') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!key.startsWith('expected_'), `Answer leakage at ${location}.${key}`);
    assertNoExpected(child, `${location}.${key}`);
  }
}

function summarize(run, journal, restored, fatal) {
  const jobs = new Map((run.thread_worker?.jobs || []).map(job => [job.chunk_id, job]));
  const cases = run.batch.cases.map(item => {
    const record = run.records.find(record => record.id === item.id);
    const job = jobs.get(item.id);
    const audit = job ? T.audit(run, job) : null;
    return {
      id: item.id, current_utterance: item.current_utterance,
      status: record?.status || 'not_processed', error: record?.error || null,
      gate: { expected: item.expected_store_memory, actual: record?.result?.store ?? null,
        matches: record?.result?.storeMatches ?? null, probability: record?.result?.storeProbability ?? null },
      type: { expected: item.expected_event_type, actual: record?.result?.type ?? null,
        matches: record?.result?.typeMatches ?? null, probability: record?.result?.typeProbability ?? null },
      chunk_matches: record?.result?.correct ?? null,
      low_confidence: record?.result?.lowConfidence ?? null,
      verdict: record?.result?.verdict || record?.status || 'not_processed',
      thread: audit ? {
        status: job.status, error: job.error || null, expected: audit.expectedSpec,
        actual: audit.actual, action: audit.action, matches: audit.matches,
        verdict: audit.tone, checks: audit.checks,
        responses: audit.responses.map(response => ({
          id: response.id, stage: response.part.stage, target_thread_id: response.target_thread_id,
          expected: response.expected, actual: response.actual, matches: response.matches,
          probability: response.probability, verdict: response.tone
        }))
      } : null
    };
  });
  const threadExpected = run.thread_worker ? Object.keys(run.batch.expected_threads || {}) : [];
  const threadsMatched = cases.filter(item => item.thread?.matches === true).length;
  const chunkErrors = cases.filter(item => item.status !== 'done').length;
  const chunkMatches = cases.filter(item => item.chunk_matches === true).length;
  const chunkWarnings = cases.filter(item => item.low_confidence).length;
  const threadWarnings = cases.filter(item => item.thread?.responses.some(response => response.probability !== null && response.probability < T.assignmentThreshold)).length;
  const threadErrors = cases.filter(item => item.thread && item.thread.status !== 'done').length;
  const complete = run.status === 'done' && (!run.thread_worker || run.thread_worker.status === 'done');
  const correct = complete && chunkMatches === cases.length && threadsMatched === threadExpected.length && !chunkErrors && !threadErrors && restored && !fatal;
  return {
    batch_id: run.batch.batch_id, status: run.status, thread_status: run.thread_worker?.status || null,
    created_at: run.createdAt, finished_at: new Date().toISOString(),
    questions_version: run.questionVersion, thread_schema_version: run.thread_worker?.schemaVersion || null,
    chunk_calls: run.calls, thread_calls: run.thread_worker?.calls || 0,
    recorded_requests: journal.length, no_expected_fields_in_requests: true,
    restore_verified: restored, fatal_error: fatal || null,
    gates: { matches: cases.filter(item => item.gate.matches === true).length, total: cases.length },
    types: { matches: cases.filter(item => item.type.matches === true).length, total: cases.filter(item => item.type.expected !== null).length },
    chunks: { matches: chunkMatches, total: cases.length, errors: chunkErrors, low_confidence: chunkWarnings },
    threads: { matches: threadsMatched, total: threadExpected.length, errors: threadErrors, low_confidence: threadWarnings,
      assigned_events: run.meeting_events.filter(event => event.thread_id).length,
      pending_events: run.thread_worker ? run.meeting_events.filter(event => !event.thread_id).map(event => event.chunk_id) : [],
      count: run.meeting_threads?.length || 0 },
    classifications_correct: correct, all_checks_passed: correct && !chunkWarnings && !threadWarnings,
    cases
  };
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/verify-memory-v2.cjs [--batch file.json] [--legacy] [--chunks-only] [--output run.json] [--url http://localhost:8000] [--questions questions.json]');
    return;
  }
  const V = args.legacy ? null : require('../memory-v2.js');
  const readJSON = filename => JSON.parse(fs.readFileSync(path.resolve(filename), 'utf8'));
  const questionsFile = args.questions ? readJSON(args.questions) : null;
  const questions = questionsFile?.questions || questionsFile || (args.legacy ? F.questions : V.questions);
  const config = args.legacy ? T.defaults : V.threadConfig;
  const batch = args.batch ? readJSON(args.batch) : args.legacy ? F.example : V.example;
  const run = F.createRun(batch, 'official', .8, questions, args.legacy ? 'legacy-baseline' : 'memory-v2');
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const output = args.output ? path.resolve(args.output) : path.join(root, '.runtime', 'memory-v2', `${timestamp}-${args.legacy ? 'legacy' : 'v2'}${args.chunksOnly ? '-chunks' : ''}.json`);
  const summaryOutput = output.replace(/\.json$/i, '') + '.summary.json';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const journal = [];
  const artifact = { schemaVersion: 1, source: 'live-jev', server: args.url, options: args, run, requests: journal };
  const persist = () => fs.writeFileSync(output, JSON.stringify(artifact, null, 2) + '\n');
  let halt = false, worker = null, fatal = null;
  const signalStop = () => { halt = true; fatal = 'Interrupted by operator'; worker?.stop(); persist(); };
  process.once('SIGINT', signalStop);
  process.once('SIGTERM', signalStop);
  const send = endpoint => async request => {
    assertNoExpected(request);
    const call = { index: journal.length + 1, endpoint, started_at: new Date().toISOString(), request: clone(request) };
    journal.push(call); persist();
    try {
      const response = await fetch(args.url + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Norte-Provider': 'official' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(120000)
      });
      call.http_status = response.status;
      const raw = await response.text();
      try { call.response = JSON.parse(raw); }
      catch (_) { call.raw_response = raw; throw Error(`Invalid JSON from ${endpoint} (HTTP ${response.status})`); }
      if (!response.ok) throw Error(`${endpoint}: HTTP ${response.status}: ${call.response.error || response.statusText}`);
      assert.equal(call.response.provider, 'official', 'Expected the official Jev provider.');
      return clone(call.response);
    } catch (error) {
      // Authentication, quota, busy lanes, network and malformed responses all
      // stop this run. The verifier never retries a possibly billed request.
      error.stopBatch = true; call.error = error.message; fatal = error.message; halt = true; worker?.stop();
      throw error;
    } finally {
      call.finished_at = new Date().toISOString(); persist();
    }
  };
  console.log(`Live Jev ${args.legacy ? 'baseline' : 'v2'}: ${run.batch.batch_id}, ${run.batch.cases.length} chunks${args.chunksOnly ? ', chunks only' : ''}.`);
  let restored = false;
  try {
    const healthResponse = await fetch(args.url + '/api/health', { signal: AbortSignal.timeout(10000) });
    artifact.health = await healthResponse.json();
    assert.ok(healthResponse.ok && artifact.health.provider === 'official' && artifact.health.ready, 'Local server must have the official Jev API configured.');
    if (!args.chunksOnly) {
      const schemaVersion = args.legacy ? 4 : 5;
      worker = T.start(run, { config, schemaVersion, version: args.legacy ? 'legacy-baseline' : 'memory-v2', send: send('/api/relations') });
      assert.equal(run.thread_worker.schemaVersion, schemaVersion, 'Worker schema differs from the selected pipeline.');
    }
    await F.execute(run, {
      send: send('/api/classify'), shouldStop: () => halt,
      onChange: (_, change) => {
        if (change.phase === 'complete') {
          if (change.record.result?.store) worker?.enqueue(run.meeting_events.at(-1));
          const result = change.record.result;
          console.log(`${change.record.id}: ${result ? `${result.store ? result.type : 'ignore'} ${result.verdict}` : change.record.error}`);
          persist();
        }
      }
    });
  } catch (error) {
    fatal = error.message; halt = true; worker?.stop();
  } finally {
    worker?.close();
    if (worker) await worker.done;
    try {
      const recovered = F.restore(clone(run));
      assert.deepEqual(recovered.meeting_events, run.meeting_events);
      assert.deepEqual(recovered.meeting_threads, run.meeting_threads);
      assert.deepEqual(recovered.records.map(record => record.result), run.records.map(record => record.result));
      if (run.thread_worker) assert.deepEqual(recovered.thread_worker, run.thread_worker);
      for (const call of journal) assertNoExpected(call.request);
      restored = true;
    } catch (error) { fatal = [fatal, `Restore assertion: ${error.message}`].filter(Boolean).join('; '); }
    const summary = summarize(run, journal, restored, fatal);
    artifact.summary = summary;
    persist(); fs.writeFileSync(summaryOutput, JSON.stringify(summary, null, 2) + '\n');
    console.log(`Chunks ${summary.chunks.matches}/${summary.chunks.total}; types ${summary.types.matches}/${summary.types.total}; threads ${summary.threads.matches}/${summary.threads.total}; warnings ${summary.chunks.low_confidence + summary.threads.low_confidence}; restore ${restored ? 'OK' : 'FAILED'}.`);
    console.log(`Run: ${output}\nSummary: ${summaryOutput}`);
    if (fatal) console.error(fatal);
    process.exitCode = summary.all_checks_passed ? 0 : 1;
    process.removeListener('SIGINT', signalStop); process.removeListener('SIGTERM', signalStop);
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { options, assertNoExpected, summarize };
