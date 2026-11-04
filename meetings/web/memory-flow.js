/* Builds the JEV request for one speech piece and rebuilds the meeting events from the classified records. */
(function (root) {
  const inNode = typeof module !== 'undefined' && module.exports;
  const E = inNode ? require('./jev-answers.js') : root.NorteJevAnswers;
  const T = inNode ? require('./thread-worker.js') : root.NorteThreads;
  const { memoryContext: notes } = inNode ? require('../../prompts/jev/questions.js') : root.NorteJevQuestions;
  function validateQuestions(value) {
    E.validateConfig({ model: 'jev-latest', questions: value });
    if (
      Object.keys(value).length !== 2 ||
      value.should_store_memory?.type !== 'noul' ||
      value.event_type?.type !== 'choice'
    ) {
      throw Error(
        'Mantenha should_store_memory (noul) e event_type (choice). As categorias do mapa são as opções de event_type.criteria.',
      );
    }
    return E.clone(value);
  }
  function recentContext(value) {
    if (!Array.isArray(value) || !value.length || value.length > 3) throw Error('Contexto recente da fala inválido.');
    return value.map(entry => {
      if (
        !entry ||
        typeof entry.text !== 'string' ||
        !entry.text.trim() ||
        entry.text.length > 500 ||
        Object.keys(entry).some(key => !['speaker', 'text'].includes(key)) ||
        (entry.speaker !== undefined &&
          (typeof entry.speaker !== 'string' || !entry.speaker.trim() || entry.speaker.length > 120))
      )
        throw Error('Contexto recente da fala inválido.');
      return { ...(entry.speaker ? { speaker: entry.speaker } : {}), text: entry.text };
    });
  }
  // Current meetings ask retention and type in one call and give both the speech just
  // before the piece, so replies and references are not judged blind.
  function request(item, stage, questions) {
    if (!['store', 'type', 'memory'].includes(stage)) throw Error('Etapa inválida.');
    if (stage === 'memory') {
      if (item.speech_context !== undefined) throw Error('Na memória v3 a continuação da fala vai em recent_context.');
      const state = { current_utterance: item.current_utterance };
      const store = E.clone(questions.should_store_memory),
        type = E.clone(questions.event_type);
      if (item.recent_context !== undefined) {
        state.recent_context = recentContext(item.recent_context);
        type.instructions = `${type.instructions.replace(notes.onlyThisText, notes.typeScope)} ${notes.recentContext}`;
        store.instructions += ` ${notes.storeScope} ${notes.recentContext} ${notes.pastFault}`;
      }
      return { model: 'jev-latest', state, questions: { should_store_memory: store, event_type: type } };
    }
    const id = stage === 'store' ? 'should_store_memory' : 'event_type';
    const state = { current_utterance: item.current_utterance },
      question = E.clone(questions[id]);
    if (item.speech_context !== undefined) {
      if (typeof item.speech_context !== 'string' || !item.speech_context.trim() || item.speech_context.length > 1600)
        throw Error('Contexto de continuação da fala inválido.');
      state.speech_context = { preceding_words: item.speech_context, purpose: 'resolve_continuation_only' };
      question.instructions = `${question.instructions.replace(notes.onlyThisText, notes.continuationScope)} ${notes.continuation}`;
      if (stage === 'store') question.instructions += ` ${notes.continuationFault}`;
    }
    return { model: 'jev-latest', state, questions: { [id]: question } };
  }
  function elapsedTimestamp(milliseconds) {
    const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
  }
  function initialEventStatus(type) {
    // System-owned creation defaults, independent of wording, confidence and
    // test verdict. No lifecycle transitions are inferred from later chunks.
    return type === 'hypothesis' || type === 'test_proposal' ? 'open' : 'active';
  }
  // Materialized memory belongs to one execution. Restoring from verified records
  // also upgrades older runs.
  function memoryState(run) {
    const meeting_events = [],
      raw_window = [];
    if (!run) return { meeting_events, raw_window };
    const threadIds = new Map(
      (run.thread_worker?.jobs || [])
        .filter(job => job.status === 'done')
        .map(job => [job.event_id, job.result.thread_id]),
    );
    for (const record of run.records) {
      const item = run.batch.cases.find(item => item.id === record.id);
      const chunk = T.chunkFor(run, record.id),
        timestamp = chunk.timestamp;
      raw_window.push(chunk);
      if (raw_window.length > (run.memorySchemaVersion >= 2 ? 15 : 4)) raw_window.shift();
      if (record.status !== 'done' || !record.result?.store) continue;
      meeting_events.push({
        event_id: 'E' + String(meeting_events.length + 1).padStart(3, '0'),
        chunk_id: item.id,
        timestamp,
        type: record.result.type,
        text: item.current_utterance,
        status: initialEventStatus(record.result.type),
        ...(run.memorySchemaVersion >= 2
          ? { thread_id: threadIds.get('E' + String(meeting_events.length + 1).padStart(3, '0')) || null }
          : { store_confidence: record.result.storeProbability, type_confidence: record.result.typeProbability }),
        ...(run.thread_worker?.schemaVersion >= 2
          ? {
              thread_assignment_state: threadIds.get('E' + String(meeting_events.length + 1).padStart(3, '0'))
                ? 'assigned'
                : 'pending',
            }
          : {}),
      });
    }
    return { meeting_events, raw_window };
  }
  const api = { validateQuestions, request, memoryState, elapsedTimestamp };
  if (inNode) module.exports = api;
  else root.NorteMemoryFlow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
