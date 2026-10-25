/* Pure memory-routing experiment. No transcript/test storage and no expected labels in requests. */
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const R = typeof module !== 'undefined' && module.exports ? require('./relation-worker.js') : root.NorteRelations;
  const T = R.threads;
  const typed = () => typeof module !== 'undefined' && module.exports ? require('./typed-relations.js') : root.NorteTypedRelations;
  // Immutable original contract for archives that predate question snapshots.
  const legacyQuestions = {
    should_store_memory: {
      type: 'noul',
      instructions: 'Should the current utterance be retained as useful project memory? Evaluate only the supplied current_utterance. Do not invent context, an assignment, agreement, or a result. Useful factual background about the project can be memory even when it introduces no new task.',
      criteria: {
        true: 'Contains concrete project information worth recalling later: a factual observation or durable background, hypothesis, proposed test or change, test result, explicit decision, actionable task, requirement, constraint, unresolved question, or risk.',
        false: 'Contains only greetings, filler, acknowledgements without an explicit project fact, unrelated conversation, or transient logistics without lasting project consequence. A fragment with no recoverable project meaning is not memory.'
      }
    },
    event_type: {
      type: 'choice',
      instructions: 'Classify the primary event in current_utterance, which has been selected for project memory. Use only the supplied text. Distinguish a proposed experiment from its result and from a final adoption decision. Prefer a specific test_proposal, test_result, or decision over the generic action_item category. Do not treat a suggestion alone as final approval.',
      criteria: {
        observation: 'Reports a concrete project fact, current condition, or useful factual background without a more specific event type.',
        hypothesis: 'Suggests an unverified explanation, cause, effect, or possibility; no concrete test or adoption decision is established.',
        test_proposal: 'Proposes actually performing an investigation, experiment, prototype, measurement, validation, or comparison to learn something.',
        test_result: 'Reports an outcome, measurement, or conclusion obtained from a test or experiment, without explicitly deciding adoption.',
        decision: 'Explicitly decides, approves, or commits the actual project to a choice now, not merely suggesting or testing it.',
        action_item: 'Establishes a concrete task to perform, not primarily a proposed test, test result, or project decision; a person or deadline is not required.',
        other: 'Useful project memory not covered above, such as a requirement, unresolved question, risk, or proposed change without an explicit final decision.'
      }
    }
  };
  const questions = E.clone(legacyQuestions);
  delete questions.event_type.criteria.other;
  questions.event_type.criteria = {
    ...questions.event_type.criteria,
    requirement: 'States a required project property, constraint, acceptance criterion, or obligation that the design or solution must satisfy; not a measured test outcome or adoption decision.',
    other: 'Useful project memory not covered above, such as an unresolved question, risk, or proposed change without an explicit final decision.'
  };
  const types = Object.keys(questions.event_type.criteria);
  // A null question set validates a recoverable draft, not an executable batch.
  function validateBatch(value, questionSet = questions) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.batch_id !== 'string' || !value.batch_id.trim() || value.batch_id.length > 80) throw Error('Informe batch_id como texto (até 80 caracteres).');
    if (!Array.isArray(value.cases) || !value.cases.length || value.cases.length > 100) throw Error('O lote deve ter de 1 a 100 chunks em cases.');
    const ids = new Set();
    const cases = value.cases.map((item, i) => {
      const prefix = 'Chunk ' + (i + 1) + ': ';
      if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 80 || ids.has(item.id.trim())) throw Error(prefix + 'id ausente, repetido ou maior que 80 caracteres.');
      ids.add(item.id.trim());
      if (typeof item.current_utterance !== 'string' || !item.current_utterance.trim()) throw Error(prefix + 'preencha current_utterance.');
      E.validateState({ current_utterance: item.current_utterance });
      if (typeof item.expected_store_memory !== 'boolean') throw Error(prefix + 'expected_store_memory deve ser true ou false.');
      if (item.expected_store_memory) {
        if (typeof item.expected_event_type !== 'string' || !item.expected_event_type.trim()) throw Error(prefix + 'preencha expected_event_type com uma categoria de event_type.criteria.');
        if (questionSet && !Object.hasOwn(questionSet.event_type.criteria, item.expected_event_type)) throw Error(prefix + 'a categoria ' + JSON.stringify(item.expected_event_type) + ' não existe em event_type.criteria. Atualize o esperado no Input JSON ou adicione a categoria às questões.');
      } else if (item.expected_event_type !== null) throw Error(prefix + 'use expected_event_type: null quando expected_store_memory for false.');
      return { id: item.id.trim(), current_utterance: item.current_utterance, expected_store_memory: item.expected_store_memory, expected_event_type: item.expected_event_type };
    });
    if (JSON.stringify(cases).length > 500000) throw Error('Lote muito grande (máximo de 500 mil caracteres).');
    const batch = { batch_id: value.batch_id.trim(), cases };
    if (Object.hasOwn(value,'expected_relations')) batch.expected_relations = R.validateExpected(value.expected_relations,cases);
    if (Object.hasOwn(value,'expected_threads')) batch.expected_threads = T.validateExpected(value.expected_threads,cases);
    if (Object.hasOwn(value,'expected_typed_relations')) {
      if(!typed())throw Error('Abra Memória V2 para usar relações tipadas.');
      batch.expected_typed_relations=typed().validateExpected(value.expected_typed_relations,cases);
    }
    return batch;
  }
  function validateQuestions(value) {
    E.validateConfig({ model: 'jev-latest', questions: value });
    if (Object.keys(value).length !== 2 || value.should_store_memory?.type !== 'noul' || value.event_type?.type !== 'choice') {
      throw Error('Mantenha should_store_memory (noul) e event_type (choice). As categorias do mapa são as opções de event_type.criteria.');
    }
    return E.clone(value);
  }
  function typesFor(questionSet = questions) { return Object.keys(questionSet.event_type.criteria); }
  function request(item, stage, questionSet = questions) {
    if (!['store', 'type'].includes(stage)) throw Error('Etapa inválida.');
    const id = stage === 'store' ? 'should_store_memory' : 'event_type';
    const state = { current_utterance: item.current_utterance }, question = E.clone(questionSet[id]);
    if (item.speech_context !== undefined) {
      if (typeof item.speech_context !== 'string' || !item.speech_context.trim() || item.speech_context.length > 1600) throw Error('Contexto de continuação da fala inválido.');
      state.speech_context = { preceding_words: item.speech_context, purpose: 'resolve_continuation_only' };
      question.instructions = question.instructions.replace('using only this text.', 'using the current text and the supplied continuation context to resolve its references.');
      question.instructions += ' Short speech slice: speech_context is prior speech only to resolve references and unfinished grammar. Evaluate ONLY information newly stated or completed in current_utterance. A continuation adding a parameter keeps the speech act it completes. Questions about trying or varying design values are test_proposal, not decisions. Tentative remedies are hypotheses, not commitments. Do not re-extract context, invent values, or infer executed tests from proposals.';
      if(stage==='store')question.instructions += ' Reporting a fault in a past test is substantive even when its cause and measurement are omitted; distinguish reporting that fault from merely announcing a topic.';
    }
    return { model: 'jev-latest', state, questions: { [id]: question } };
  }
  function validateOutput(output, item, stage, questionSet = questions) {
    const req = request(item, stage, questionSet);
    E.validateOutput(output, { state: req.state, config: { model: req.model, questions: req.questions } });
    return output;
  }
  function evaluate(item, storeOutput, typeOutput, threshold = .8, questionSet = questions) {
    validateOutput(storeOutput, item, 'store', questionSet);
    const gate = storeOutput.response.answers.should_store_memory;
    const store = E.predicted(gate), storeProbability = E.probabilityOf(gate, store);
    let type = null, typeProbability = null;
    if (store) {
      validateOutput(typeOutput, item, 'type', questionSet);
      const answer = typeOutput.response.answers.event_type;
      type = E.predicted(answer); typeProbability = E.probabilityOf(answer, type);
    }
    const storeMatches = store === item.expected_store_memory;
    // A rejected expected case has no type criterion, even if incorrectly accepted.
    const typeMatches = !item.expected_store_memory ? null : store && type === item.expected_event_type;
    const correct = storeMatches && typeMatches !== false;
    const lowConfidence = storeProbability + 1e-12 < threshold || (item.expected_store_memory && typeProbability !== null && typeProbability + 1e-12 < threshold);
    return { store, type, storeProbability, typeProbability, storeMatches, typeMatches, correct, lowConfidence, verdict: !correct ? 'fail' : lowConfidence ? 'warning' : 'pass', destination: store ? type : 'ignore' };
  }
  function createRun(batch, provider, threshold = .8, questionSet = questions, questionVersion = null) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw Error('Confiança deve estar entre 0 e 100%.');
    const frozenQuestions = validateQuestions(questionSet);
    return { schemaVersion: 1, memorySchemaVersion:2, batch: validateBatch(batch, frozenQuestions), provider, threshold, questions: frozenQuestions, questionVersion,
      createdAt: new Date().toISOString(), status: 'ready', executionMode: 'step', records: [], calls: 0, meeting_events: [], raw_window: [], meeting_threads:[], meeting_relations:[] };
  }
  function elapsedTimestamp(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
  }
  function initialEventStatus(type) {
    // System-owned creation defaults, independent of wording, confidence and
    // test verdict. No lifecycle transitions are inferred from later chunks.
    return type === 'hypothesis' || type === 'test_proposal' ? 'open' : 'active';
  }
  // Materialized memory belongs to one execution. Restoring from verified records
  // also upgrades older runs and never trusts an edited/corrupt memory projection.
  function memoryState(run) {
    const meeting_events = [], raw_window = [];
    if (!run) return { meeting_events, raw_window };
    const threadIds=new Map((run.thread_worker?.jobs || []).filter(job=>job.status==='done').map(job=>[job.event_id,job.result.thread_id]));
    for (const record of run.records) {
      const item = run.batch.cases.find(item => item.id === record.id);
      const chunk = T.chunkFor(run,record.id), timestamp = chunk.timestamp;
      raw_window.push(chunk);
      if (raw_window.length > (run.memorySchemaVersion===2?15:4)) raw_window.shift();
      if (record.status !== 'done' || !record.result?.store) continue;
      meeting_events.push({
        event_id: 'E' + String(meeting_events.length + 1).padStart(3, '0'),
        chunk_id: item.id, timestamp, type: record.result.type, text: item.current_utterance,
        status: initialEventStatus(record.result.type),
        ...(run.memorySchemaVersion===2?{thread_id:threadIds.get('E'+String(meeting_events.length+1).padStart(3,'0')) || null}:{store_confidence:record.result.storeProbability,type_confidence:record.result.typeProbability}),
        ...(run.thread_worker?.schemaVersion>=2?{thread_assignment_state:threadIds.get('E'+String(meeting_events.length+1).padStart(3,'0'))?'assigned':'pending'}:{})
      });
    }
    return { meeting_events, raw_window };
  }
  function updateMemory(run) { Object.assign(run, memoryState(run)); if(run.thread_worker)T.syncMemory(run); }
  async function execute(run, { send, onChange = () => {}, shouldStop = () => false, now = Date.now,
    mode = 'step', arrivalBatchSize = 4, arrivalIntervalMs = 120, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (run.status !== 'ready' || run.records.length) throw Error('Crie uma nova rodada para executar novamente.');
    if (!['step','burst'].includes(mode)) throw Error('Modo de execução inválido.');
    if (!Number.isInteger(arrivalBatchSize) || arrivalBatchSize < 1 || arrivalBatchSize > 100 || !Number.isFinite(arrivalIntervalMs) || arrivalIntervalMs < 0) throw Error('Configuração de chegada inválida.');
    run.executionMode = mode;
    const started = now(); run.startedAt = new Date(started).toISOString();
    run.status = 'running'; updateMemory(run); await onChange(run, { phase: 'start' });
    let halt = false, producerDone = mode !== 'burst', producerError = null, wakeConsumer = null;
    const stopped = () => halt || shouldStop();
    const wake = () => { const resolve = wakeConsumer; wakeConsumer = null; resolve?.(); };
    function receive(item) {
      const received = now();
      const record = { id: item.id, status: 'queued', stage: 'queued', startedAt: new Date(received).toISOString(),
        receivedOffsetMs: Math.max(0, received - started, run.records.at(-1)?.receivedOffsetMs || 0) };
      run.records.push(record); return record;
    }
    // Receipt is independent of inference in burst mode. The bounded raw FIFO
    // is only a view; the full work queue retains every received chunk.
    const producer = mode === 'burst' ? (async () => {
      try {
        for (let index = 0; index < run.batch.cases.length && !stopped(); index += arrivalBatchSize) {
          const arrivals = run.batch.cases.slice(index, index + arrivalBatchSize).map(receive);
          updateMemory(run); await onChange(run, { phase: 'arrivals', records: arrivals }); wake();
          if (index + arrivalBatchSize < run.batch.cases.length && !stopped()) await wait(arrivalIntervalMs);
        }
      } catch (error) { producerError = error; halt = true; }
      finally { producerDone = true; wake(); }
    })() : null;
    let completed = false;
    try {
      for (const [index, item] of run.batch.cases.entries()) {
        if (stopped()) break;
        if (mode === 'burst') {
          while (!run.records[index] && !producerDone && !stopped()) await new Promise(resolve => { wakeConsumer = resolve; });
          if (stopped() || !run.records[index]) break;
        }
        const record = mode === 'burst' ? run.records[index] : receive(item);
        record.status = 'running'; record.stage = 'store'; record.processingStartedAt = new Date(now()).toISOString();
        updateMemory(run); await onChange(run, { phase: 'processing', record });
        if (stopped()) break;
        try {
          run.calls++;
          record.storeOutput = validateOutput(await send(request(item, 'store', run.questions), run.provider), item, 'store', run.questions);
          if (E.predicted(record.storeOutput.response.answers.should_store_memory)) {
            record.stage = 'type'; await onChange(run, { phase: 'type', record });
            if (stopped()) { record.status = 'interrupted'; record.error = 'Interrompido antes de classificar o tipo; não foi armazenado.'; break; }
            record.typeStartedAt = new Date(now()).toISOString();
            run.calls++;
            record.typeOutput = validateOutput(await send(request(item, 'type', run.questions), run.provider), item, 'type', run.questions);
          }
          record.result = evaluate(item, record.storeOutput, record.typeOutput, run.threshold, run.questions);
          record.status = 'done'; record.stage = record.result.destination;
          record.timestamp = new Date(now()).toISOString();
          updateMemory(run);
        } catch (error) {
          record.status = 'error'; record.error = error.message || 'Falha na classificação.';
          // Never retry billed calls, and stop both receipt and processing on quota errors.
          if (error.stopBatch) halt = true;
        }
        await onChange(run, { phase: 'complete', record });
      }
      completed = !stopped() && run.records.length === run.batch.cases.length;
    } finally {
      halt = true; wake(); if (producer) await producer;
      for (const record of run.records) if (record.status === 'queued' || record.status === 'running') {
        record.status = 'interrupted'; record.error = 'Recebido, mas o processamento foi interrompido. Não houve retomada automática.';
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
    const memory = Object.fromEntries(typesFor(run?.questions || questionSet).map(type => [type, []])), ignored = [];
    if (!run) return { memory, ignored };
    // The diagram is a grouped view of meeting_events, not a second memory store.
    for (const event of (run.meeting_events || memoryState(run).meeting_events)) {
      const record = run.records.find(record => record.id === event.chunk_id);
      memory[event.type].push({ ...event, id: event.chunk_id, verdict: record.result.verdict });
    }
    for (const record of run.records) {
      if (record.status !== 'done' || record.result.store) continue;
      const item = run.batch.cases.find(item => item.id === record.id), r = record.result;
      const entry = { id: item.id, chunk_id: item.id, text: item.current_utterance, type: r.type, timestamp: record.timestamp, verdict: r.verdict };
      ignored.push(entry);
    }
    return { memory, ignored };
  }
  function restore(saved) {
    if (!saved || saved.schemaVersion !== 1 || !['ready', 'running', 'done', 'stopped', 'interrupted'].includes(saved.status) || !Array.isArray(saved.records)) throw Error('Rodada salva inválida.');
    const run = createRun(saved.batch, saved.provider, saved.threshold, saved.questions || legacyQuestions, saved.questionVersion || null);
    if(saved.memorySchemaVersion!==undefined && ![1,2].includes(saved.memorySchemaVersion))throw Error('Versão de memória inválida.');
    if(saved.memorySchemaVersion===2)run.memorySchemaVersion=2;
    else {delete run.memorySchemaVersion;delete run.meeting_threads;delete run.meeting_relations;}
    if (saved.executionMode !== undefined && !['step','burst'].includes(saved.executionMode)) throw Error('Modo de execução salvo inválido.');
    run.executionMode = saved.executionMode || 'step';
    if (!Number.isInteger(saved.calls) || saved.calls < 0 || saved.calls > run.batch.cases.length * 2 || saved.records.length > run.batch.cases.length) throw Error('Contagem de chamadas inválida.');
    run.calls = saved.calls; run.createdAt = saved.createdAt; run.finishedAt = saved.finishedAt;
    if (saved.startedAt !== undefined) {
      if (!Number.isFinite(Date.parse(saved.startedAt))) throw Error('Início da execução inválido.');
      run.startedAt = saved.startedAt;
    }
    run.status = saved.status === 'running' ? 'interrupted' : saved.status;
    run.records = saved.records.map((record, i) => {
      const item = run.batch.cases[i];
      if (!record || record.id !== item.id || !['queued', 'running', 'done', 'error', 'interrupted'].includes(record.status)) throw Error('Registro salvo inválido.');
      const copy = E.clone(record);
      if (copy.receivedOffsetMs !== undefined && (!Number.isFinite(copy.receivedOffsetMs) || copy.receivedOffsetMs < 0)) throw Error('Tempo de chegada inválido.');
      if (copy.processingStartedAt !== undefined && !Number.isFinite(Date.parse(copy.processingStartedAt))) throw Error('Início do processamento inválido.');
      if (copy.storeOutput) validateOutput(copy.storeOutput, item, 'store', run.questions);
      if (copy.typeOutput) validateOutput(copy.typeOutput, item, 'type', run.questions);
      if (copy.status === 'done') {
        if (!Number.isFinite(Date.parse(copy.timestamp))) throw Error('Timestamp salvo inválido.');
        copy.result = evaluate(item, copy.storeOutput, copy.typeOutput, run.threshold, run.questions);
      } else {
        delete copy.result;
        if (copy.status === 'running' || copy.status === 'queued') { copy.status = 'interrupted'; copy.error = 'Página recarregada durante a execução; não houve retomada automática.'; }
      }
      return copy;
    });
    updateMemory(run);
    if (saved.relation_worker) {
      run.relation_worker = R.restore(saved.relation_worker,run.meeting_events);
      run.relations = R.relationsFor(run.relation_worker.jobs);
    }
    if(saved.thread_worker) {
      if(saved.relation_worker || run.memorySchemaVersion!==2)throw Error('Snapshot de workers incompatível.');
      run.thread_worker=T.restore(saved.thread_worker,run);T.syncMemory(run);
    }
    if(saved.typed_relation_worker){
      if(!run.thread_worker || !typed())throw Error('Snapshot de relações tipadas sem threads ou módulo V2.');
      run.typed_relation_worker=typed().restore(saved.typed_relation_worker,run);typed().syncMemory(run);
    }
    return run;
  }
  const example = { batch_id: 'B01', cases: [
    ['C01', 'The bracket is deforming too much.', true, 'observation'],
    ['C02', 'Good morning, everyone!', false, null],
    ['C03', 'The deformation may be caused by insufficient wall thickness.', true, 'hypothesis'],
    ['C04', "Let's test aluminum on one prototype.", true, 'test_proposal'],
    ['C05', 'The aluminum prototype performed better in the load test.', true, 'test_result'],
    ['C06', 'We are switching the final design to aluminum. This is approved.', true, 'decision'],
    ['C07', 'Maria, send the updated drawings to the supplier tomorrow.', true, 'action_item'],
    ['C08', 'The finished part must weigh less than 500 grams.', true, 'requirement'],
    ['C09', 'The current bracket is made of steel.', true, 'observation']
  ].map(([id, current_utterance, expected_store_memory, expected_event_type]) => ({ id, current_utterance, expected_store_memory, expected_event_type })) };
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  const emptyLibrary = () => ({ schemaVersion: 1, versions: [], relationVersions: [], threadVersions:[], typedRelationVersions:[], tests: [] });
  function validateLibrary(value) {
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.versions) || !Array.isArray(value.tests)) throw Error('Histórico de memória inválido.');
    const copy = E.clone(value), ids = new Set();
    copy.relationVersions ??= [];
    if (!Array.isArray(copy.relationVersions)) throw Error('Versões de relações inválidas.');
    const relationIds = new Set();
    copy.threadVersions ??= [];
    if(!Array.isArray(copy.threadVersions))throw Error('Versões de threads inválidas.');
    const threadIds=new Set();
    copy.typedRelationVersions??=[];
    if(!Array.isArray(copy.typedRelationVersions))throw Error('Versões de relações tipadas inválidas.');
    const typedIds=new Set();
    for(const version of copy.typedRelationVersions){
      if(!/^TRQ\d{3,}$/.test(version.id)||typedIds.has(version.id)||!Number.isFinite(Date.parse(version.createdAt)))throw Error('Versão de relações tipadas inválida.');
      typed().validateConfig(version.config);typedIds.add(version.id);
    }
    for(const version of copy.threadVersions) {
      if(!/^TQ\d{3,}$/.test(version.id) || threadIds.has(version.id) || !Number.isFinite(Date.parse(version.createdAt)))throw Error('Versão de threads inválida.');
      T.validateConfig(version.config);threadIds.add(version.id);
    }
    for (const version of copy.relationVersions) {
      if (!/^RQ\d{3,}$/.test(version.id) || relationIds.has(version.id) || !Number.isFinite(Date.parse(version.createdAt))) throw Error('Versão de relações inválida.');
      R.validateConfig(version.config); relationIds.add(version.id);
    }
    for (const version of copy.versions) {
      if (!/^Q\d{3,}$/.test(version.id) || ids.has(version.id) || !Number.isFinite(Date.parse(version.createdAt))) throw Error('Versão de questões inválida.');
      validateQuestions(version.questions); ids.add(version.id);
    }
    const testIds = new Set();
    for (const test of copy.tests) {
      if (!/^T\d{3,}$/.test(test.id) || testIds.has(test.id) || !ids.has(test.questionVersion) || !Number.isFinite(Date.parse(test.createdAt))) throw Error('Teste salvo inválido.');
      const version = copy.versions.find(v => v.id === test.questionVersion);
      testIds.add(test.id); validateBatch(test.batch, version.questions);
      if (test.relationVersion && !relationIds.has(test.relationVersion)) throw Error('Versão de relações ausente.');
      if(test.threadVersion && !threadIds.has(test.threadVersion))throw Error('Versão de threads ausente.');
      if(test.typedRelationVersion&&!typedIds.has(test.typedRelationVersion))throw Error('Versão de relações tipadas ausente.');
      if (test.run) {
        test.run = restore(test.run);
        if (stable(test.run.batch) !== stable(test.batch) || stable(test.run.questions) !== stable(version.questions)) throw Error('Snapshot não corresponde à versão do teste.');
        if (test.run.relation_worker && test.relationVersion && stable(test.run.relation_worker.config) !== stable(copy.relationVersions.find(v => v.id === test.relationVersion).config)) throw Error('Snapshot de relações não corresponde à versão.');
        if(test.run.thread_worker && test.threadVersion && stable(test.run.thread_worker.config)!==stable(copy.threadVersions.find(v=>v.id===test.threadVersion).config))throw Error('Snapshot de threads não corresponde à versão.');
        if(test.run.typed_relation_worker&&test.typedRelationVersion&&stable(test.run.typed_relation_worker.config)!==stable(copy.typedRelationVersions.find(v=>v.id===test.typedRelationVersion).config))throw Error('Snapshot de relações tipadas não corresponde à versão.');
      }
    }
    if (copy.nextTestNumber !== undefined && (!Number.isSafeInteger(copy.nextTestNumber) || copy.nextTestNumber <= Math.max(0,...copy.tests.map(t=>Number(t.id.slice(1)))))) throw Error('Sequência de IDs de testes inválida.');
    return copy;
  }
  function addVersion(library, candidate) {
    const questionSet = validateQuestions(candidate), signature = stable(questionSet);
    const existing = library.versions.find(v => stable(v.questions) === signature);
    if (existing) return existing;
    const next = Math.max(0, ...library.versions.map(v => Number(v.id.slice(1)))) + 1;
    const version = { id: 'Q' + String(next).padStart(3, '0'), createdAt: new Date().toISOString(), questions: questionSet };
    library.versions.push(version); return version;
  }
  function addRelationVersion(library,candidate) {
    const config = R.validateConfig(candidate); library.relationVersions ??= [];
    const existing = library.relationVersions.find(v => stable(v.config) === stable(config));
    if (existing) return existing;
    const next = Math.max(0,...library.relationVersions.map(v=>Number(v.id.slice(2))))+1;
    const version = { id:'RQ'+String(next).padStart(3,'0'), createdAt:new Date().toISOString(), config };
    library.relationVersions.push(version); return version;
  }
  function saveTest(library, batch, questionSet, run = null, relationConfig = run?.relation_worker?.config, typedConfig = run?.typed_relation_worker?.config) {
    const validQuestions = validateQuestions(questionSet), frozenBatch = validateBatch(batch, validQuestions);
    if (run && (stable(run.batch) !== stable(frozenBatch) || stable(run.questions || legacyQuestions) !== stable(validQuestions))) throw Error('O teste e a execução não têm a mesma configuração.');
    const version = addVersion(library, validQuestions);
    const next = Math.max(library.nextTestNumber || 1, Math.max(0, ...library.tests.map(t => Number(t.id.slice(1)))) + 1);
    const test = { id: 'T' + String(next).padStart(3, '0'), createdAt: new Date().toISOString(), questionVersion: version.id, batch: frozenBatch, run: run ? E.clone(run) : null };
    if (test.run) test.run.questionVersion = version.id;
    if (relationConfig && !run?.thread_worker && !relationConfig.questions?.belongs_to_active_thread) {
      if (run?.relation_worker && stable(run.relation_worker.config) !== stable(relationConfig)) throw Error('Configuração de relações difere da execução.');
      const relationVersion = addRelationVersion(library,relationConfig); test.relationVersion = relationVersion.id;
      if (test.run?.relation_worker) test.run.relation_worker.version = relationVersion.id;
    }
    const threadConfig=run?.thread_worker?.config || (relationConfig?.questions?.belongs_to_active_thread?relationConfig:null);
    if(threadConfig) {
      const version=addThreadVersion(library,threadConfig);test.threadVersion=version.id;
      if(test.run?.thread_worker)test.run.thread_worker.version=version.id;
    }
    if(typedConfig){
      if(run?.typed_relation_worker&&stable(run.typed_relation_worker.config)!==stable(typedConfig))throw Error('Configuração de relações tipadas difere da execução.');
      const version=addTypedRelationVersion(library,typedConfig);test.typedRelationVersion=version.id;
      if(test.run?.typed_relation_worker)test.run.typed_relation_worker.version=version.id;
    }
    library.tests.push(test); library.nextTestNumber = next + 1; return test;
  }
  function addThreadVersion(library,candidate) {
    const config=T.validateConfig(candidate);library.threadVersions??=[];
    const existing=library.threadVersions.find(v=>stable(v.config)===stable(config));if(existing)return existing;
    const next=Math.max(0,...library.threadVersions.map(v=>Number(v.id.slice(2))))+1;
    const version={id:'TQ'+String(next).padStart(3,'0'),createdAt:new Date().toISOString(),config};library.threadVersions.push(version);return version;
  }
  function addTypedRelationVersion(library,candidate){
    const config=typed().validateConfig(candidate);library.typedRelationVersions??=[];
    const existing=library.typedRelationVersions.find(v=>stable(v.config)===stable(config));if(existing)return existing;
    const next=Math.max(0,...library.typedRelationVersions.map(v=>Number(v.id.slice(3))))+1;
    const version={id:'TRQ'+String(next).padStart(3,'0'),createdAt:new Date().toISOString(),config};library.typedRelationVersions.push(version);return version;
  }
  function deleteTest(library, id) {
    const index = library.tests.findIndex(test=>test.id===id);
    if (index < 0) throw Error('Teste não encontrado; o histórico não foi alterado.');
    library.nextTestNumber = Math.max(library.nextTestNumber || 1,...library.tests.map(test=>Number(test.id.slice(1))+1));
    return library.tests.splice(index,1)[0];
  }
  function diffQuestions(before, after) {
    const diffs = [];
    function visit(a,b,path) {
      if (stable(a) === stable(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key],b[key],path?path+'.'+key:key);
      } else diffs.push({ path, before: a ?? null, after: b ?? null });
    }
    visit(before,after,''); return diffs;
  }
  // Export is a detached, read-only snapshot. Never save, rerun or relabel a test.
  function exportResults(options) {
    const run = options.run ? E.clone(options.run) : null;
    if (run?.status === 'running' || run?.relation_worker?.status === 'running' || run?.thread_worker?.status==='running' || run?.typed_relation_worker?.status==='running') throw Error('Aguarde a execução terminar ou interrompa antes de exportar.');
    const questionSet = run ? run.questions || legacyQuestions : options.questions || questions;
    const input = validateBatch(run?.batch || options.batch, null);
    const minimum = run?.threshold ?? .8, records = new Map((run?.records || []).map(record=>[record.id,record]));
    const events = new Map((run?.meeting_events || []).map(event=>[event.chunk_id,event]));
    const hasRelations=!!(run?.relation_worker || !run && options.relationConfig);
    const report = {
      format: 'norte.memory-results', schema_version: 1, exported_at: options.exportedAt || new Date().toISOString(),
      test_id: options.testId || null, batch_id: input.batch_id, status: run?.status || 'not_run',
      question_version: run ? run.questionVersion || null : options.questionVersion || null,
      relation_question_version: run ? run.relation_worker?.version || null : options.relationVersion || null,
      thread_question_version:run?run.thread_worker?.version || null:options.threadVersion || null,
      typed_relation_question_version:run?run.typed_relation_worker?.version || null:options.typedRelationVersion || null,
      input, configuration: {
        model: 'jev-latest', provider: run?.provider || null, confidence_threshold: minimum,
        relation_candidate_scope: hasRelations?(R.isFiltered(run?.relation_worker)?'legacy_type_status_filter':'all_previous_events'):null,
        relation_expectation_policy: hasRelations?(!run || run.relation_worker?.schemaVersion>=3?'positives_only':'explicit_pairs'):null,
        relation_retention_threshold: hasRelations?R.threshold:null, relation_retention_operator: hasRelations?'>':null, execution_mode: run?.executionMode || null,
        chunk_questions: questionSet, relation_worker: run ? run.relation_worker?.config || null : options.relationConfig || null,
        thread_worker:run?run.thread_worker?.config || null:options.threadConfig || null,
        typed_relation_worker:run?run.typed_relation_worker?.config || null:options.typedRelationConfig || null,
        typed_relation_policy:run?.typed_relation_worker?{schema_version:run.typed_relation_worker.schemaVersion,direction:'current_to_previous',candidates:'all_previous_assigned_same_thread',expectations:'explicit_pairs_only',stages:['relation_type','configuration_match_positive_only'],negative:'none_no_edge',match_not_applicable:'edge_without_configuration_comparison',review_threshold:.8,completion:'confirmed_result_of_exact_configuration',relation_context:'all_previous_events_same_thread_no_future',match_context:run.typed_relation_worker.schemaVersion>=2?'isolated_pair_no_history':'all_previous_events_same_thread'}:null,
        thread_assignment_policy:run?.thread_worker?run.thread_worker.schemaVersion>=4?'confidence_gated_archive_fallback':run.thread_worker.schemaVersion>=2?'confidence_gated':'legacy_choice_only':null,
        thread_assignment_threshold:run?.thread_worker?.schemaVersion>=2?T.assignmentThreshold:null,
        thread_assignment_operator:run?.thread_worker?.schemaVersion>=2?'>=':null,
        raw_window_limit:run?.memorySchemaVersion===2 || !run?15:4,thread_context_limit:run?.thread_worker?.schemaVersion>=5?8:5,anchor_policy:'all_assigned_events'
      },
      summary: {
        total_chunks: input.cases.length, processed_chunks: (run?.records || []).filter(r=>['done','error'].includes(r.status)).length,
        correct_chunks: (run?.records || []).filter(r=>r.result?.correct).length,
        divergent_chunks: (run?.records || []).filter(r=>r.result?.correct===false).length,
        low_confidence_chunks: (run?.records || []).filter(r=>r.result?.lowConfidence).length,
        chunk_errors: (run?.records || []).filter(r=>r.status==='error').length,
        chunk_calls: run?.calls || 0, relation_calls: run?.relation_worker?.calls || 0,
        stored_events: run?.meeting_events?.length || 0, ignored_chunks: queues(run,questionSet).ignored.length,
        stored_relations: run?.relations?.length || 0
      },
      execution: run, question_results: [], filter_results: [], thread_assignments:[], typed_relation_results:[], event_lifecycle:run?.typed_relation_worker?typed().lifecycle(run):{}
    };
    function addQuestion(fields, definition, output, expected, applicable, threshold, strict = false) {
      const answer = output?.response?.answers?.[fields.question_id] || null;
      const actual = answer ? E.predicted(answer) : null, probability = answer ? E.probabilityOf(answer,actual) : null;
      const matches = applicable && answer ? actual === expected : null;
      const confidencePasses = probability === null ? null : strict ? probability > threshold : fields.worker==='threads' ? probability >= threshold : probability + 1e-12 >= threshold;
      report.question_results.push({
        ...fields, question_type: definition.type, definition, expected, expected_applicable: applicable, actual, matches,
        confidence_minimum: threshold, confidence_operator: strict ? '>' : '>=',
        probability_actual: probability, probability_expected: applicable && answer ? E.probabilityOf(answer,expected) : null,
        confidence_passes: confidencePasses, api_confidence: answer?.confidence ?? null,
        probabilities: answer ? answer.type==='noul' ? {true:answer.noul,false:1-answer.noul} : answer.probabilities : null,
        verdict: fields.status==='error' ? 'error' : matches===false ? 'fail' : probability!==null && !confidencePasses ? 'warning' : matches===true ? 'pass' : 'not_evaluated',
        output: output || null
      });
    }
    for (const item of input.cases) {
      const record = records.get(item.id), event = events.get(item.id);
      for (const [stage,id] of [['store','should_store_memory'],['type','event_type']]) {
        const output = record?.[stage==='store'?'storeOutput':'typeOutput'];
        const gateFalse = record?.storeOutput && !E.predicted(record.storeOutput.response.answers.should_store_memory);
        const failed = record?.status==='error' && record.stage===stage;
        const skipped = stage==='type' && (gateFalse || record?.status==='error' && record.stage==='store');
        const status = output ? 'done' : failed ? 'error' : skipped ? 'not_consulted' : record?.status==='interrupted' ? 'interrupted' : 'not_run';
        addQuestion({worker:'chunks',chunk_id:item.id,event_id:event?.event_id || null,event_type:event?.type || null,event_status:event?.status || null,question_id:id,status,
          current_utterance:item.current_utterance,state:{current_utterance:item.current_utterance},
          request:output?.request || null, planned_request:request(item,stage,questionSet),
          timestamp:record?.timestamp || null,error:failed || status==='interrupted' ? record.error || null : null},
          questionSet[id],output,stage==='store'?item.expected_store_memory:item.expected_event_type,
          stage==='store' || item.expected_store_memory,minimum);
      }
    }
    for (const job of run?.relation_worker?.jobs || []) {
      const audit = R.auditJob(run,job); if (!audit) continue;
      for (const pair of audit.pairs) {
        const context = {worker:'relations',event_id:audit.current.event_id,chunk_id:audit.current.chunk_id,event_type:audit.current.type,event_status:audit.current.status,
          target_event_id:pair.target.event_id,target_chunk_id:pair.target.chunk_id,
          current_utterance:audit.current.text,target_text:pair.target.text};
        if (audit.filtered) report.filter_results.push({...context,status:'done',expected:pair.expectedCandidate,actual:pair.candidate,
          expected_source:pair.expectedCandidateSource,matches:pair.filterMatches,verdict:pair.filterTone,
          rule_expected:pair.ruleExpected,expected_has_relation:pair.expectedRelation,blocked:pair.blocked,
          source_event:audit.current,target_event:pair.target});
        if (!pair.candidate) continue;
        const id = 'has_relation__'+pair.target.event_id;
        const planned = pair.part?.request || R.request(audit.current,[pair.target],run.relation_worker.config);
        addQuestion({...context,question_id:id,status:pair.part?.status || job.status,
          state:planned.state,request:pair.part?.attempted ? planned : null,planned_request:planned,
          retained:pair.retained,timestamp:job.finishedAt || null,error:pair.part?.error || job.error || null},
          planned.questions[id],pair.part?.output,pair.expectedRelation,pair.expectedRelation!==null,R.threshold,true);
      }
    }
    for(const job of run?.thread_worker?.jobs || []) {
      const audit=T.audit(run,job);
      report.thread_assignments.push({event_id:job.event_id,chunk_id:job.chunk_id,status:job.status,thread_assignment_state:audit.event.thread_assignment_state ?? null,expected:audit.expectedSpec,expected_applicable:audit.hasExpected,actual:audit.actual,action:audit.action,checks:audit.checks,matches:audit.matches,verdict:audit.tone || 'not_evaluated',route:job.result?.route || null,reason:job.result?.reason || null,error:job.error || null});
      for(const result of audit.responses) {
        const part=result.part;
        addQuestion({worker:'threads',event_id:job.event_id,chunk_id:job.chunk_id,target_thread_id:result.target_thread_id,question_id:result.id,status:part.status,
          current_utterance:audit.event.text,state:part.request.state,request:part.attempted?part.request:null,planned_request:part.request,timestamp:job.finishedAt || null,error:part.error || null},
          result.definition,part.output,result.expected,result.expected!==null,.8);
      }
    }
    report.summary.thread_calls=run?.thread_worker?.calls || 0;report.summary.threads=run?.meeting_threads?.length || 0;
    report.summary.pending_assignments=run?.thread_worker?.jobs.filter(job=>job.status==='done'&&job.result.thread_id===null).length || 0;
    for(const job of run?.typed_relation_worker?.jobs||[]){
      const audit=typed().audit(run,job);
      for(const pair of audit.pairs){
        report.typed_relation_results.push({event_id:job.event_id,chunk_id:job.chunk_id,target_event_id:pair.target.event_id,target_chunk_id:pair.target.chunk_id,expected:pair.expected,actual:pair.result,checks:pair.checks,matches:pair.matches,verdict:pair.tone,status:job.status,error:pair.error});
        for(const [stage,part] of [['relation_type',pair.part],['configuration_match',pair.matchPart]]){
          if(!part?.request)continue;const id=stage+'__'+pair.target.event_id;
          addQuestion({worker:'typed_relations',event_id:job.event_id,chunk_id:job.chunk_id,target_event_id:pair.target.event_id,target_chunk_id:pair.target.chunk_id,question_id:id,status:part.status,current_utterance:audit.event.text,target_text:pair.target.text,state:part.request.state,request:part.attempted?part.request:null,planned_request:part.request,error:part.error||null},part.request.questions[id],part.output,pair.expected?.[stage]??null,pair.expected?.[stage]!==undefined,.8);
        }
      }
    }
    if(run?.typed_relation_worker)report.summary.typed_relations=typed().summary(run);
    return E.clone(report);
  }
  function resultsCsv(report) {
    const columns = ['record_type','worker','test_id','batch_id','question_version','relation_question_version',
      'chunk_id','event_id','event_type','event_status','store_confidence','type_confidence','relation_id','relation_confidence',
      'target_chunk_id','target_event_id','thread_id','thread_assignment_state','target_thread_id','thread_question_version','typed_relation_question_version','relation_type','configuration_match','configuration_applicable','review_state','question_id','question_type','status','current_utterance','target_text',
      'expected','expected_applicable','expected_source','actual','matches','probability_expected','probability_actual',
      'confidence_minimum','confidence_operator','confidence_passes','api_confidence','verdict','retained','timestamp','latency_ms',
      'provider','response_model','instructions','criteria_json','probabilities_json','state_json','request_json','response_json','error','details_json'];
    const rows = [], json = value => value == null ? '' : JSON.stringify(value);
    const {execution,question_results,filter_results,...metadata} = report;
    const {records=[],meeting_events=[],raw_window=[],relations=[],relation_worker,...executionMetadata} = execution || {};
    const {jobs=[],...workerMetadata} = relation_worker || {};
    rows.push({record_type:'test',status:report.status,details_json:json({...metadata,execution:execution ? {...executionMetadata,relation_worker:relation_worker?workerMetadata:null} : null})});
    const recordsById = new Map(records.map(record=>[record.id,record]));
    for (const input of report.input.cases) {
      const {storeOutput,typeOutput,...record} = recordsById.get(input.id) || {};
      rows.push({record_type:'chunk',worker:'chunks',chunk_id:input.id,status:record.status || 'not_run',
        current_utterance:input.current_utterance,timestamp:record.timestamp,error:record.error,details_json:json({input,record})});
    }
    for (const q of question_results) rows.push({record_type:'question',...q,
      instructions:q.definition.instructions,criteria_json:json(q.definition.criteria),probabilities_json:json(q.probabilities),
      state_json:json(q.state),request_json:json(q.request),response_json:json(q.output?.response),
      provider:q.output?.provider || report.configuration.provider,response_model:q.output?.response?.model,
      latency_ms:q.output?.latencyMs,details_json:json(q)});
    for (const filter of filter_results) rows.push({record_type:'filter',...filter,expected_applicable:true,details_json:json(filter)});
    for (const [type,items] of [['meeting_event',meeting_events],['raw_window',raw_window],['relation',relations]]) {
      for (const item of items) rows.push({record_type:type,chunk_id:item.chunk_id,event_id:item.event_id || item.source_event_id,
        event_type:item.type,event_status:item.status,thread_id:item.thread_id,thread_assignment_state:item.thread_assignment_state,store_confidence:item.store_confidence,type_confidence:item.type_confidence,
        relation_id:item.relation_id,relation_confidence:item.relation_confidence,
        target_event_id:item.target_id,current_utterance:item.text,timestamp:item.timestamp,status:item.status,details_json:json(item)});
    }
    for (const job of jobs) {
      const {parts,...jobMetadata} = job;
      rows.push({record_type:'relation_job',worker:'relations',event_id:job.event_id,status:job.status,error:job.error,details_json:json(jobMetadata)});
      for (const part of parts) rows.push({record_type:'relation_call',worker:'relations',event_id:job.event_id,status:part.status,
        request_json:json(part.request),response_json:json(part.output?.response),error:part.error,details_json:json(part)});
    }
    for(const thread of execution?.meeting_threads || [])rows.push({record_type:'thread',thread_id:thread.thread_id,status:thread.status,details_json:json(thread)});
    for(const assignment of report.thread_assignments || []) {
      rows.push({record_type:'thread_assignment',worker:'threads',...assignment,details_json:json(assignment)});
      for(const check of assignment.checks)rows.push({record_type:'thread_check',worker:'threads',event_id:assignment.event_id,chunk_id:assignment.chunk_id,question_id:check.key,status:assignment.status,expected_applicable:true,...check,details_json:json(check)});
    }
    for(const job of execution?.thread_worker?.jobs || []) {
      rows.push({record_type:'thread_job',worker:'threads',event_id:job.event_id,chunk_id:job.chunk_id,status:job.status,error:job.error,details_json:json(job)});
      for(const part of job.parts)rows.push({record_type:'thread_call',worker:'threads',event_id:job.event_id,status:part.status,request_json:json(part.request),response_json:json(part.output?.response),error:part.error,details_json:json(part)});
    }
    for(const edge of execution?.meeting_relations||[])rows.push({record_type:'meeting_relation',worker:'typed_relations',event_id:edge.source_event_id,target_event_id:edge.target_event_id,relation_id:edge.relation_id,thread_id:edge.thread_id,status:edge.review_state,actual:edge.relation_type,relation_type:edge.relation_type,configuration_match:edge.configuration_match,configuration_applicable:edge.configuration_applicable,review_state:edge.review_state,details_json:json(edge)});
    for(const pair of report.typed_relation_results||[])rows.push({record_type:'typed_relation_audit',worker:'typed_relations',...pair,details_json:json(pair)});
    for(const state of Object.values(report.event_lifecycle||{}))rows.push({record_type:'event_lifecycle',event_id:state.event_id,status:state.status,details_json:json(state)});
    for(const job of execution?.typed_relation_worker?.jobs||[]){
      rows.push({record_type:'typed_relation_job',worker:'typed_relations',event_id:job.event_id,chunk_id:job.chunk_id,status:job.status,error:job.error,details_json:json(job)});
      for(const part of job.parts)rows.push({record_type:'typed_relation_call',worker:'typed_relations',event_id:job.event_id,status:part.status,state_json:json(part.request?.state),request_json:json(part.request),response_json:json(part.output?.response),error:part.error,details_json:json(part)});
    }
    const common = Object.fromEntries(['test_id','batch_id','question_version','relation_question_version','thread_question_version','typed_relation_question_version'].map(key=>[key,report[key]]));
    // Quoting alone does not stop spreadsheet formulas. JSON keeps the exact text.
    const cell = value => { const text = value == null ? '' : typeof value==='object'?JSON.stringify(value):String(value); return '"'+(/^\s*[=+@\-\t\r]/.test(text)?"'":'')+text.replaceAll('"','""')+'"'; };
    return '\uFEFF'+[columns,...rows.map(row=>{ const values={...common,...row}; return columns.map(key=>values[key]); })].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function exportFilename(report,format) {
    if (!['json','csv'].includes(format)) throw Error('Formato de exportação inválido.');
    const id = [report.test_id,report.batch_id].filter(Boolean).join('_').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,160);
    return 'resultados_'+id+'_'+report.exported_at.replace(/\D/g,'').slice(0,14)+'.'+format;
  }
  const api = { types, typesFor, questions: E.clone(questions), validateQuestions, validateBatch, request, evaluate, createRun, execute, queues, restore, memoryState, elapsedTimestamp, example,
    stable, emptyLibrary, validateLibrary, addVersion, addRelationVersion, addThreadVersion, addTypedRelationVersion, saveTest, deleteTest, diffQuestions, exportResults, resultsCsv, exportFilename };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NorteMemoryFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
