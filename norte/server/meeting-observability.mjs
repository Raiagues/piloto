/** Admin diagnostics remain inside the same meeting ACL as the user-facing room. */
const text = (value, max = 12000) => typeof value === 'string' ? value.slice(0, max) : '';
const list = value => Array.isArray(value) ? value : [];
const scalar = value => typeof value === 'string' ? text(value) : typeof value === 'boolean' || Number.isFinite(value) ? value : null;
function question(value) {
  return { type: text(value?.type, 40), instructions: text(value?.instructions, 5000), criteria: Object.fromEntries(Object.entries(value?.criteria || {}).slice(0, 40).map(([key, description]) => [text(key, 100), text(description, 4000)])) };
}
function state(value) {
  if (typeof value === 'string') return { current_utterance: text(value) };
  return Object.fromEntries(['current_utterance', 'recent_context', 'previous_context', 'raw_window', 'event', 'candidate', 'thread', 'instruction', 'next_utterance', 'meeting_feedback', 'current_event', 'active_thread', 'candidate_threads', 'candidates', 'thread_history', 'relation_type'].filter(key => value?.[key] !== undefined).map(key => [key, typeof value[key] === 'string' ? text(value[key]) : text(JSON.stringify(value[key]), 16000)]));
}
function stage(name, output) {
  if (!output || typeof output !== 'object') return null;
  return { name, input: state(output.request?.state), questions: Object.fromEntries(Object.entries(output.request?.questions || {}).slice(0, 40).map(([id, value]) => [text(id, 100), question(value)])), answers: Object.fromEntries(Object.entries(output.response?.answers || {}).slice(0, 40).map(([id, answer]) => [text(id, 100), Object.fromEntries(['type', 'choice', 'noul', 'confidence', 'score', 'probabilities'].filter(key => answer?.[key] !== undefined).map(key => [key, key === 'probabilities' ? Object.fromEntries(Object.entries(answer[key] || {}).slice(0, 40).map(([label, probability]) => [text(label, 100), scalar(probability)])) : scalar(answer[key])]))])), provider: text(output.provider, 60), model: text(output.response?.model, 100), latencyMs: scalar(output.latencyMs), feedbackVersion: output.learningVersion || 0 };
}
export function projectMeetingTrace(run, offset = 0) {
  const records = list(run.records), events = list(run.meeting_events), transcript = list(run.transcript);
  const workerStages = (worker, record, name) => list(worker?.jobs).filter(job => job.chunk_id === record.id || events.some(event => event.event_id === job.event_id && event.chunk_id === record.id)).flatMap(job => list(job.parts).filter(part => part.output).map(part => stage(name, { ...part.output, request: part.output.request || part.request })));
  const traces = records.slice(offset, offset + 50).map(record => ({ id: text(record.id, 160), status: text(record.status, 40), error: text(record.error, 1000), stages: [...list(record.segmentation?.checks).map(check => stage('Segmentação', check.output)), stage('Filtro', record.storeOutput), stage('Classificação', record.typeOutput), stage('Filtro e classificação', record.memoryOutput), ...workerStages(run.thread_worker, record, 'Assunto'), ...workerStages(run.typed_relation_worker, record, 'Relações')].filter(Boolean), blocks: events.filter(event => event.chunk_id === record.id || event.source_chunk_id === record.id || event.event_id === record.id).map(event => ({ id: event.event_id, type: event.type, text: text(event.text), threadId: event.thread_id })), speech: transcript.filter(speech => speech.chunk_id === record.id).map(speech => ({ id: speech.id, text: text(speech.text), speaker: text(speech.speaker, 200) })) }));
  return { total: records.length, offset, nextOffset: offset + traces.length < records.length ? offset + traces.length : null, traces, counts: { utterances: transcript.length, chunks: records.length, blocks: events.length, topics: list(run.meeting_threads).length, relations: list(run.meeting_relations).length, humanEdits: Object.keys(run.block_edits || {}).length }, transientWindow: list(run.raw_window).map(item => typeof item === 'string' ? text(item, 2000) : { text: text(item.text || item.current_utterance, 2000), id: text(item.id, 160) }).slice(-12) };
}
/** Persisted artifacts are distinct from the optional BlockAgents cache. */
export function projectMeetingArtifacts(run) {
  const stages = [];
  for (let offset = 0; offset < list(run.records).length; offset += 50) stages.push(...projectMeetingTrace(run, offset).traces.flatMap(trace => trace.stages));
  const draft = run.minutes_document, doc = draft?.doc, entries = new Map();
  for (const topic of list(doc?.topics).slice(0, 200)) {
    for (const entry of [...Object.values(topic.current || {}).flatMap(list), ...list(topic.history?.events)]) {
      const id = text(entry.id || entry.event?.event_id, 160);
      if (id && !entries.has(id) && entries.size < 500) entries.set(id, { id, text: text(entry.display_text || entry.text, 2000), topic: text(topic.title, 200) });
    }
  }
  return {
    execution: { source: stages.length ? 'saved_provider_records' : 'no_recorded_calls', imported: run.input_mode === 'import', recordedCalls: stages.length, providers: [...new Set(stages.map(item => item.provider).filter(Boolean))], models: [...new Set(stages.map(item => item.model).filter(Boolean))] },
    minutes: { persisted: !!doc, version: Number(draft?.presentationVersion) || 0, mode: text(doc?.mode, 50), eventCount: Number(doc?.event_count) || 0, accepted: Number(doc?.editorial_counts?.accepted) || 0, preservedOriginal: Number(doc?.editorial_counts?.preserved_original) || 0, entries: [...entries.values()], fallbacks: list(doc?.editorial_fallbacks).slice(0, 500).map(item => ({ eventId: text(item.event_id, 160), reason: text(item.reason, 1000) })) }
  };
}
export function meetingDiagnosticSuggestions(report, memories) {
  const items = [];
  if (!report.total) items.push({ id: 'empty', message: 'A reunião ainda não possui chamadas registradas. Importe uma transcrição ou inicie uma reunião para observar o fluxo.' });
  if (report.traces.some(trace => trace.stages.length === 0)) items.push({ id: 'missing-trace', message: 'Há blocos antigos sem entrada e resposta preservadas. Eles continuam consultáveis, mas não permitem reconstruir a classificação.' });
  if (!(memories.learning?.examples || []).length) items.push({ id: 'human-labels', message: 'Não há correções humanas nesta reunião. A precisão do modelo não pode ser medida apenas por respostas HTTP bem-sucedidas.' });
  items.push({ id: 'holdout', message: 'Para medir melhora, ainda falta uma avaliação com falas rotuladas por pessoas e separadas das correções usadas no contexto.' });
  return items;
}
export function registerMeetingObservability(app, { store, requireAuth, access, readEngine }) {
  const authorize = request => {
    const actor = store.read().users.find(user => user.id === request.auth.user.id && user.active);
    if (actor?.accessRole !== 'owner_admin') throw Object.assign(new Error('Acesso restrito à administração.'), { statusCode: 403 });
    return access.requireMeeting(store.read(), actor, request.params.id);
  };
  app.get('/api/admin/meetings/:id/observability', { preHandler: [requireAuth] }, async (request, reply) => {
    const meeting = authorize(request), offset = Number(request.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw Object.assign(new Error('Posição inválida.'), { statusCode: 400 });
    if (meeting.roomKind === 'archive') return { archived: true, meeting: { id: meeting.id, title: meeting.title }, message: 'Os registros legados estão no arquivo de reunião.' };
    const saved = await readEngine(request, meeting, '/api/records?key=' + encodeURIComponent('norte.meeting-room.session.v2.' + meeting.id));
    let run = { id: meeting.id };
    if (saved.value) { try { run = JSON.parse(saved.value); } catch { throw Object.assign(new Error('Registro inválido.'), { statusCode: 502 }); } }
    if (run.id !== meeting.id) throw Object.assign(new Error('O registro não pertence à reunião.'), { statusCode: 502 });
    const memories = saved.value ? await readEngine(request, meeting, '/api/ai/blocks/inspect', { session_id: meeting.id }) : { editorial: [], editorial_total: 0, learning: { version: 0, examples: [], history: [] }, external_context: false };
    await store.refresh?.(); authorize(request);
    const report = projectMeetingTrace(run, offset), artifacts = projectMeetingArtifacts(run);
    return reply.header('cache-control', 'no-store').send({ meeting: { id: meeting.id, title: meeting.title }, ...report, ...artifacts, memories, suggestions: meetingDiagnosticSuggestions(report, memories), validation: { source: 'local_tests', modelAccuracyMeasured: false, scope: 'Os testes locais verificam preservação de fala, isolamento de reunião, limites do resumo e reversão de correções. Não medem a precisão do modelo em chamadas reais.' } });
  });
}
