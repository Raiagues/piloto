'use strict';
/* Batch runner of the tests and of scripts/verify-*.cjs: drives labelled cases through the same
 * requests the room makes, without a browser. The room itself never loads this file.
 * The question sets are the frozen versions these fixtures were labelled with. */
const Flow = require('../../meetings/web/memory-flow.js'),
  E = require('../../meetings/web/jev-answers.js'),
  T = require('../../meetings/web/thread-worker.js'),
  typed = require('../../meetings/web/typed-relations.js');
const { archive: legacyQuestions, current: questions } = require('./memory-questions.json');
const { validateQuestions, memoryState } = Flow;
const request = (item, stage, questionSet = questions) => Flow.request(item, stage, questionSet);
const types = Object.keys(questions.event_type.criteria);
// A null question set validates a recoverable draft, not an executable batch.
function validateBatch(value, questionSet = questions) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.batch_id !== 'string' ||
    !value.batch_id.trim() ||
    value.batch_id.length > 80
  )
    throw Error('Informe batch_id como texto (até 80 caracteres).');
  if (!Array.isArray(value.cases) || !value.cases.length || value.cases.length > 100)
    throw Error('O lote deve ter de 1 a 100 chunks em cases.');
  const ids = new Set();
  const cases = value.cases.map((item, i) => {
    const prefix = 'Chunk ' + (i + 1) + ': ';
    if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80 || ids.has(item.id.trim()))
      throw Error(prefix + 'id ausente, repetido ou maior que 80 caracteres.');
    ids.add(item.id.trim());
    if (typeof item.current_utterance !== 'string' || !item.current_utterance.trim())
      throw Error(prefix + 'preencha current_utterance.');
    E.validateState({ current_utterance: item.current_utterance });
    if (typeof item.expected_store_memory !== 'boolean')
      throw Error(prefix + 'expected_store_memory deve ser true ou false.');
    if (item.expected_store_memory) {
      if (typeof item.expected_event_type !== 'string' || !item.expected_event_type.trim())
        throw Error(prefix + 'preencha expected_event_type com uma categoria de event_type.criteria.');
      if (questionSet && !Object.hasOwn(questionSet.event_type.criteria, item.expected_event_type))
        throw Error(
          prefix +
            'a categoria ' +
            JSON.stringify(item.expected_event_type) +
            ' não existe em event_type.criteria. Atualize o esperado no Input JSON ou adicione a categoria às questões.',
        );
    } else if (item.expected_event_type !== null)
      throw Error(prefix + 'use expected_event_type: null quando expected_store_memory for false.');
    return {
      id: item.id.trim(),
      current_utterance: item.current_utterance,
      expected_store_memory: item.expected_store_memory,
      expected_event_type: item.expected_event_type,
    };
  });
  if (JSON.stringify(cases).length > 500000) throw Error('Lote muito grande (máximo de 500 mil caracteres).');
  const batch = { batch_id: value.batch_id.trim(), cases };
  if (Object.hasOwn(value, 'expected_threads'))
    batch.expected_threads = T.validateExpected(value.expected_threads, cases);
  if (Object.hasOwn(value, 'expected_typed_relations')) {
    batch.expected_typed_relations = typed.validateExpected(value.expected_typed_relations, cases);
  }
  return batch;
}
function typesFor(questionSet = questions) {
  return Object.keys(questionSet.event_type.criteria);
}
function validateOutput(output, item, stage, questionSet = questions) {
  const req = request(item, stage, questionSet);
  E.validateOutput(output, { state: req.state, config: { model: req.model, questions: req.questions } });
  return output;
}
function evaluate(item, storeOutput, typeOutput, threshold = 0.8, questionSet = questions) {
  validateOutput(storeOutput, item, 'store', questionSet);
  const gate = storeOutput.response.answers.should_store_memory;
  const store = E.predicted(gate),
    storeProbability = E.probabilityOf(gate, store);
  let type = null,
    typeProbability = null;
  if (store) {
    validateOutput(typeOutput, item, 'type', questionSet);
    const answer = typeOutput.response.answers.event_type;
    type = E.predicted(answer);
    typeProbability = E.probabilityOf(answer, type);
  }
  const storeMatches = store === item.expected_store_memory;
  // A rejected expected case has no type criterion, even if incorrectly accepted.
  const typeMatches = !item.expected_store_memory ? null : store && type === item.expected_event_type;
  const correct = storeMatches && typeMatches !== false;
  const lowConfidence =
    storeProbability + 1e-12 < threshold ||
    (item.expected_store_memory && typeProbability !== null && typeProbability + 1e-12 < threshold);
  return {
    store,
    type,
    storeProbability,
    typeProbability,
    storeMatches,
    typeMatches,
    correct,
    lowConfidence,
    verdict: !correct ? 'fail' : lowConfidence ? 'warning' : 'pass',
    destination: store ? type : 'ignore',
  };
}
function createRun(batch, provider, threshold = 0.8, questionSet = questions, questionVersion = null) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw Error('Confiança deve estar entre 0 e 100%.');
  const frozenQuestions = validateQuestions(questionSet);
  return {
    schemaVersion: 1,
    memorySchemaVersion: 2,
    batch: validateBatch(batch, frozenQuestions),
    provider,
    threshold,
    questions: frozenQuestions,
    questionVersion,
    createdAt: new Date().toISOString(),
    status: 'ready',
    executionMode: 'step',
    records: [],
    calls: 0,
    meeting_events: [],
    raw_window: [],
    meeting_threads: [],
    meeting_relations: [],
  };
}
function updateMemory(run) {
  Object.assign(run, memoryState(run));
  if (run.thread_worker) T.syncMemory(run);
}
async function execute(
  run,
  {
    send,
    onChange = () => {},
    shouldStop = () => false,
    now = Date.now,
    mode = 'step',
    arrivalBatchSize = 4,
    arrivalIntervalMs = 120,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  },
) {
  if (run.status !== 'ready' || run.records.length) throw Error('Crie uma nova rodada para executar novamente.');
  if (!['step', 'burst'].includes(mode)) throw Error('Modo de execução inválido.');
  if (
    !Number.isInteger(arrivalBatchSize) ||
    arrivalBatchSize < 1 ||
    arrivalBatchSize > 100 ||
    !Number.isFinite(arrivalIntervalMs) ||
    arrivalIntervalMs < 0
  )
    throw Error('Configuração de chegada inválida.');
  run.executionMode = mode;
  const started = now();
  run.startedAt = new Date(started).toISOString();
  run.status = 'running';
  updateMemory(run);
  await onChange(run, { phase: 'start' });
  let halt = false,
    producerDone = mode !== 'burst',
    producerError = null,
    wakeConsumer = null;
  const stopped = () => halt || shouldStop();
  const wake = () => {
    const resolve = wakeConsumer;
    wakeConsumer = null;
    resolve?.();
  };
  function receive(item) {
    const received = now();
    const record = {
      id: item.id,
      status: 'queued',
      stage: 'queued',
      startedAt: new Date(received).toISOString(),
      receivedOffsetMs: Math.max(0, received - started, run.records.at(-1)?.receivedOffsetMs || 0),
    };
    run.records.push(record);
    return record;
  }
  // Receipt is independent of inference in burst mode. The bounded raw FIFO
  // is only a view; the full work queue retains every received chunk.
  const producer =
    mode === 'burst'
      ? (async () => {
          try {
            for (let index = 0; index < run.batch.cases.length && !stopped(); index += arrivalBatchSize) {
              const arrivals = run.batch.cases.slice(index, index + arrivalBatchSize).map(receive);
              updateMemory(run);
              await onChange(run, { phase: 'arrivals', records: arrivals });
              wake();
              if (index + arrivalBatchSize < run.batch.cases.length && !stopped()) await wait(arrivalIntervalMs);
            }
          } catch (error) {
            producerError = error;
            halt = true;
          } finally {
            producerDone = true;
            wake();
          }
        })()
      : null;
  let completed = false;
  try {
    for (const [index, item] of run.batch.cases.entries()) {
      if (stopped()) break;
      if (mode === 'burst') {
        while (!run.records[index] && !producerDone && !stopped())
          await new Promise(resolve => {
            wakeConsumer = resolve;
          });
        if (stopped() || !run.records[index]) break;
      }
      const record = mode === 'burst' ? run.records[index] : receive(item);
      record.status = 'running';
      record.stage = 'store';
      record.processingStartedAt = new Date(now()).toISOString();
      updateMemory(run);
      await onChange(run, { phase: 'processing', record });
      if (stopped()) break;
      try {
        run.calls++;
        record.storeOutput = validateOutput(
          await send(request(item, 'store', run.questions), run.provider),
          item,
          'store',
          run.questions,
        );
        if (E.predicted(record.storeOutput.response.answers.should_store_memory)) {
          record.stage = 'type';
          await onChange(run, { phase: 'type', record });
          if (stopped()) {
            record.status = 'interrupted';
            record.error = 'Interrompido antes de classificar o tipo; não foi armazenado.';
            break;
          }
          record.typeStartedAt = new Date(now()).toISOString();
          run.calls++;
          record.typeOutput = validateOutput(
            await send(request(item, 'type', run.questions), run.provider),
            item,
            'type',
            run.questions,
          );
        }
        record.result = evaluate(item, record.storeOutput, record.typeOutput, run.threshold, run.questions);
        record.status = 'done';
        record.stage = record.result.destination;
        record.timestamp = new Date(now()).toISOString();
        updateMemory(run);
      } catch (error) {
        record.status = 'error';
        record.error = error.message || 'Falha na classificação.';
        // Billed calls are not retried; a quota error stops receipt and processing.
        if (error.stopBatch) halt = true;
      }
      await onChange(run, { phase: 'complete', record });
    }
    completed = !stopped() && run.records.length === run.batch.cases.length;
  } finally {
    halt = true;
    wake();
    if (producer) await producer;
    for (const record of run.records)
      if (record.status === 'queued' || record.status === 'running') {
        record.status = 'interrupted';
        record.error = 'Recebido, mas o processamento foi interrompido. Não houve retomada automática.';
      }
    updateMemory(run);
    run.status = completed && !producerError ? 'done' : 'stopped';
    run.finishedAt = new Date(now()).toISOString();
  }
  if (producerError) throw producerError;
  await onChange(run, { phase: 'finish' });
  return run;
}
function queues(run, questionSet = questions) {
  const memory = Object.fromEntries(typesFor(run?.questions || questionSet).map(type => [type, []])),
    ignored = [];
  if (!run) return { memory, ignored };
  // The diagram is a grouped view of meeting_events, not a second memory store.
  for (const event of run.meeting_events || memoryState(run).meeting_events) {
    const record = run.records.find(record => record.id === event.chunk_id);
    memory[event.type].push({ ...event, id: event.chunk_id, verdict: record.result.verdict });
  }
  for (const record of run.records) {
    if (record.status !== 'done' || record.result.store) continue;
    const item = run.batch.cases.find(item => item.id === record.id),
      r = record.result;
    const entry = {
      id: item.id,
      chunk_id: item.id,
      text: item.current_utterance,
      type: r.type,
      timestamp: record.timestamp,
      verdict: r.verdict,
    };
    ignored.push(entry);
  }
  return { memory, ignored };
}
function restore(saved) {
  if (
    !saved ||
    saved.schemaVersion !== 1 ||
    !['ready', 'running', 'done', 'stopped', 'interrupted'].includes(saved.status) ||
    !Array.isArray(saved.records)
  )
    throw Error('Rodada salva inválida.');
  const run = createRun(
    saved.batch,
    saved.provider,
    saved.threshold,
    saved.questions || legacyQuestions,
    saved.questionVersion || null,
  );
  if (saved.memorySchemaVersion !== undefined && ![1, 2].includes(saved.memorySchemaVersion))
    throw Error('Versão de memória inválida.');
  if (saved.memorySchemaVersion === 2) run.memorySchemaVersion = 2;
  else {
    delete run.memorySchemaVersion;
    delete run.meeting_threads;
    delete run.meeting_relations;
  }
  if (saved.executionMode !== undefined && !['step', 'burst'].includes(saved.executionMode))
    throw Error('Modo de execução salvo inválido.');
  run.executionMode = saved.executionMode || 'step';
  if (
    !Number.isInteger(saved.calls) ||
    saved.calls < 0 ||
    saved.calls > run.batch.cases.length * 2 ||
    saved.records.length > run.batch.cases.length
  )
    throw Error('Contagem de chamadas inválida.');
  run.calls = saved.calls;
  run.createdAt = saved.createdAt;
  run.finishedAt = saved.finishedAt;
  if (saved.startedAt !== undefined) {
    if (!Number.isFinite(Date.parse(saved.startedAt))) throw Error('Início da execução inválido.');
    run.startedAt = saved.startedAt;
  }
  run.status = saved.status === 'running' ? 'interrupted' : saved.status;
  run.records = saved.records.map((record, i) => {
    const item = run.batch.cases[i];
    if (
      !record ||
      record.id !== item.id ||
      !['queued', 'running', 'done', 'error', 'interrupted'].includes(record.status)
    )
      throw Error('Registro salvo inválido.');
    const copy = E.clone(record);
    if (copy.receivedOffsetMs !== undefined && (!Number.isFinite(copy.receivedOffsetMs) || copy.receivedOffsetMs < 0))
      throw Error('Tempo de chegada inválido.');
    if (copy.processingStartedAt !== undefined && !Number.isFinite(Date.parse(copy.processingStartedAt)))
      throw Error('Início do processamento inválido.');
    if (copy.storeOutput) validateOutput(copy.storeOutput, item, 'store', run.questions);
    if (copy.typeOutput) validateOutput(copy.typeOutput, item, 'type', run.questions);
    if (copy.status === 'done') {
      if (!Number.isFinite(Date.parse(copy.timestamp))) throw Error('Timestamp salvo inválido.');
      copy.result = evaluate(item, copy.storeOutput, copy.typeOutput, run.threshold, run.questions);
    } else {
      delete copy.result;
      if (copy.status === 'running' || copy.status === 'queued') {
        copy.status = 'interrupted';
        copy.error = 'Página recarregada durante a execução; não houve retomada automática.';
      }
    }
    return copy;
  });
  updateMemory(run);
  if (saved.thread_worker) {
    if (run.memorySchemaVersion !== 2) throw Error('Snapshot de workers incompatível.');
    run.thread_worker = T.restore(saved.thread_worker, run);
    T.syncMemory(run);
  }
  if (saved.typed_relation_worker) {
    if (!run.thread_worker) throw Error('Snapshot de relações tipadas sem threads.');
    run.typed_relation_worker = typed.restore(saved.typed_relation_worker, run);
    typed.syncMemory(run);
  }
  return run;
}
const example = {
  batch_id: 'B01',
  cases: [
    ['C01', 'The bracket is deforming too much.', true, 'observation'],
    ['C02', 'Good morning, everyone!', false, null],
    ['C03', 'The deformation may be caused by insufficient wall thickness.', true, 'hypothesis'],
    ['C04', "Let's test aluminum on one prototype.", true, 'test_proposal'],
    ['C05', 'The aluminum prototype performed better in the load test.', true, 'test_result'],
    ['C06', 'We are switching the final design to aluminum. This is approved.', true, 'decision'],
    ['C07', 'Maria, send the updated drawings to the supplier tomorrow.', true, 'action_item'],
    ['C08', 'The finished part must weigh less than 500 grams.', true, 'requirement'],
    ['C09', 'The current bracket is made of steel.', true, 'observation'],
  ].map(([id, current_utterance, expected_store_memory, expected_event_type]) => ({
    id,
    current_utterance,
    expected_store_memory,
    expected_event_type,
  })),
};
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(k => JSON.stringify(k) + ':' + stable(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
module.exports = {
  ...Flow,
  request,
  questions: E.clone(questions),
  types,
  typesFor,
  validateBatch,
  evaluate,
  createRun,
  execute,
  queues,
  restore,
  example,
  stable,
};
