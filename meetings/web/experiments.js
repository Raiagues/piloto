/* Pure experiment snapshots and metrics. Expected answers are never model input. */
(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const languages = ['pt', 'en', 'fr', 'es'];
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const seconds = ms => Number.isFinite(ms) ? (ms / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' s' : '—';
  function resultProvider(output) { return output?.provider || (output?.response?.model?.startsWith('jevos') ? 'local' : output?.response?.model?.startsWith('jev-') ? 'official' : null); }
  const resultLabel = output => resultProvider(output) === 'official' ? 'Jev oficial' : resultProvider(output) === 'local' ? 'jevos · local' : 'Origem não registrada';
  function batchLabel(batch) {
    const providers = new Set(batch.runs.filter(run => run.status === 'done').map(run => resultProvider(run.output)));
    if (!providers.size && batch.provider) providers.add(batch.provider);
    return providers.size > 1 ? 'Provedores mistos' : resultLabel({provider: [...providers][0]});
  }
  const stateText = state => typeof state === 'string' ? state : JSON.stringify(state, null, 2);
  const testName = item => item.displayName ?? item.input.name;
  const expectedFor = item => item.expectedOverride ?? item.input.expected;
  function validateName(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw Error('Use um nome de 1 a 100 caracteres.');
  }
  function validateState(state) {
    if (typeof state === 'string') {
      if (!state.trim() || state.length > 16000) throw Error('Escreva um State de até 16.000 caracteres.');
      return;
    }
    if (!state || typeof state !== 'object' || !Object.keys(state).length) throw Error('State deve ser texto, objeto ou lista JSON não vazios.');
    function visit(value, depth) {
      if (depth > 16) throw Error('State excede 16 níveis de profundidade.');
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
      if (typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw Error('State contém um valor inválido.');
      Object.values(value).forEach(child => visit(child, depth + 1));
    }
    visit(state, 0);
    if (JSON.stringify(state).length > 16000) throw Error('State JSON excede 16.000 caracteres.');
  }
  function parseState(text, format = 'text') {
    let state = text;
    if (format === 'json') {
      try { state = JSON.parse(text); } catch (_) { throw Error('State: JSON inválido.'); }
    }
    validateState(state); return state;
  }
  function parseRequest(text) {
    let value;
    try { value = JSON.parse(text); } catch (_) { throw Error('Teste: JSON inválido.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['model', 'state', 'questions'].every(key => Object.hasOwn(value, key))) throw Error('Use um teste com model, state e questions.');
    if (Object.keys(value).some(key => !['model', 'state', 'questions', 'expected', 'name', 'language'].includes(key))) throw Error('Campos aceitos: model, state, questions, expected, name e language.');
    validateState(value.state); validateConfig(value);
    if (Object.hasOwn(value, 'name')) validateName(value.name);
    if (Object.hasOwn(value, 'language') && !languages.includes(value.language)) throw Error('Idioma inválido: use pt, en, fr ou es.');
    if (Object.hasOwn(value, 'expected')) {
      if (!value.expected || typeof value.expected !== 'object' || Array.isArray(value.expected)) throw Error('Resultado esperado inválido.');
      value.expected = Object.fromEntries(Object.entries(value.expected).map(([id, answer]) => [id,
        answer !== null && typeof answer === 'object' ? answer : { type: value.questions[id]?.type, value: answer }
      ]));
      validateExpected(value.expected, value.questions);
    }
    return clone(value);
  }
  function validateConfig(config) {
    if (!config || config.model !== 'jev-latest' || !config.questions || typeof config.questions !== 'object' || Array.isArray(config.questions)) throw Error('Configuração de perguntas inválida.');
    const entries = Object.entries(config.questions);
    if (!entries.length || entries.length > 32) throw Error('Use de 1 a 32 perguntas.');
    for (const [id, q] of entries) {
      if (!id || id.length > 80 || !q || !['choice', 'score', 'noul'].includes(q.type) || typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 1500) throw Error('Pergunta inválida.');
      if (Object.keys(q).some(k => !['type', 'instructions', 'criteria'].includes(k))) throw Error('Campo de pergunta desconhecido.');
      if (q.type === 'choice' && (!q.criteria || typeof q.criteria !== 'object' || Array.isArray(q.criteria) || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 12 || Object.keys(q.criteria).some(k => !k))) throw Error('Choice precisa de 2 a 12 opções.');
      if (q.type === 'score' && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 5)) throw Error('Score precisa de 2 a 5 níveis.');
      if (q.type === 'noul' && q.criteria != null && (typeof q.criteria !== 'object' || Array.isArray(q.criteria) || !Object.keys(q.criteria).length || Object.keys(q.criteria).some(key => !['true', 'false'].includes(key)))) throw Error('Noul aceita critérios true e/ou false.');
      if (q.criteria && Object.values(q.criteria).some(v => typeof v !== 'string' || v.length > 800)) throw Error('Critério inválido.');
    }
  }
  // Empty Questions are allowed only in the local editor, never in a request/archive.
  function validateDraftConfig(config) {
    if(config?.model==='jev-latest' && config.questions && typeof config.questions==='object' && !Array.isArray(config.questions) && !Object.keys(config.questions).length)return;
    validateConfig(config);
  }
  function validateExpected(expected, questions) {
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw Error('Resultado esperado inválido.');
    for (const [id, e] of Object.entries(expected)) {
      const q = Object.hasOwn(questions, id) ? questions[id] : null;
      if (!q || !e || Array.isArray(e) || e.type !== q.type || Object.keys(e).some(key => !['type', 'value', 'minProbability'].includes(key))) throw Error('Esperado incompatível com as perguntas.');
      if (Object.hasOwn(e, 'minProbability') && (typeof e.minProbability !== 'number' || !Number.isFinite(e.minProbability) || e.minProbability < 0 || e.minProbability > 1)) throw Error('minProbability deve ser um número entre 0 e 1.');
      if (q.type === 'choice' && (typeof e.value !== 'string' || !Object.hasOwn(q.criteria, e.value))) throw Error('Classe esperada inválida.');
      if (q.type === 'score' && (!Number.isInteger(e.value) || e.value < 0 || e.value >= q.criteria.length)) throw Error('Nível esperado inválido.');
      if (q.type === 'noul' && typeof e.value !== 'boolean') throw Error('Esperado Noul deve ser true ou false.');
    }
  }
  function validateInput(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !languages.includes(input.language)) throw Error('Nome ou idioma do teste inválido.');
    validateState(input.state);
    validateConfig(input.config); validateExpected(input.expected, input.config.questions);
  }
  function request(input) { return clone({ model: input.config.model, state: input.state, questions: input.config.questions }); }
  function exportTest(input) {
    validateInput(input);
    return { ...request(input), name: input.name, language: input.language, expected: clone(input.expected) };
  }
  function predicted(answer) {
    if (answer.type === 'choice') return answer.choice;
    if (answer.type === 'noul') return answer.noul >= .5;
    const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
    return Math.abs(ranked[0][1] - ranked[1][1]) < 1e-12 ? null : Number(ranked[0][0]);
  }
  function evaluateAnswer(answer, expected) {
    if (!answer || !expected) return null;
    // Compare P(expected), NOT the API's concentration/confidence field or mean Score.
    const probability = answer.type === 'noul' ? (expected.value ? answer.noul : 1 - answer.noul) : answer.probabilities[expected.value];
    const matches = predicted(answer) === expected.value;
    const minimum = expected.minProbability ?? null;
    const meetsProbability = minimum === null || probability + 1e-12 >= minimum;
    return { matches, probability, minimum, passes: matches && meetsProbability, reason: !matches ? 'wrong-value' : !meetsProbability ? 'low-probability' : 'pass' };
  }
  function evaluateRun(answers, expected) {
    const verdicts = Object.entries(expected).map(([id, value]) => evaluateAnswer(answers[id], value));
    const passed = verdicts.filter(verdict => verdict?.passes).length;
    return { passed, total: verdicts.length, passes: verdicts.length ? passed === verdicts.length : null };
  }
  function probabilityOf(answer,value) {
    if(value===null || value===undefined)return null;
    return answer.type==='noul'?(value?answer.noul:1-answer.noul):answer.probabilities[value];
  }
  function questionComparison(batch,id,runIndex=-1) {
    const runs=(runIndex<0?batch.runs:[batch.runs[runIndex]]).filter(run=>run?.status==='done');
    const answers=runs.map(run=>run.output.response.answers[id]);
    const expectation=expectedFor(batch)[id],counts=new Map();
    for(const answer of answers){const value=predicted(answer);counts.set(value,(counts.get(value)||0)+1);}
    const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
    const actual=ranked.length && (ranked.length===1 || ranked[0][1]>ranked[1][1])?ranked[0][0]:null;
    const verdicts=expectation?answers.map(answer=>evaluateAnswer(answer,expectation)):[];
    const wrongValue=verdicts.filter(v=>v.reason==='wrong-value').length,lowProbability=verdicts.filter(v=>v.reason==='low-probability').length;
    return {actual,count:answers.length,probability:actual===null?null:mean(answers.map(answer=>probabilityOf(answer,actual))),varied:counts.size>1,
      passed:verdicts.filter(v=>v.passes).length,wrongValue,lowProbability,
      reason:!answers.length?'pending':!expectation?'unscored':wrongValue && lowProbability?'mixed-failure':wrongValue?'wrong-value':lowProbability?'low-probability':'pass'};
  }
  function campaignGroups(batches) {
    const groups=new Map();
    for(const batch of batches){
      const id=batch.automation?.campaignId || batch.id;
      if(!groups.has(id))groups.set(id,{id,round:batch.automation?.round,members:[],createdAt:batch.createdAt});
      groups.get(id).members.push(batch);
    }
    return [...groups.values()];
  }
  // Independent gates, counted per real execution (never from an averaged answer).
  function questionChecks(batch,id) {
    const expectation=expectedFor(batch)[id];
    const answers=batch.runs.filter(run=>run.status==='done').map(run=>run.output.response.answers[id]).filter(Boolean);
    const verdicts=expectation?answers.map(answer=>evaluateAnswer(answer,expectation)):[];
    const minimum=expectation?.minProbability ?? null;
    return {count:answers.length,evaluated:verdicts.length,expected:expectation?.value,minimum,
      matches:verdicts.filter(v=>v.matches).length,
      confident:minimum===null?null:verdicts.filter(v=>v.probability+1e-12>=minimum).length,
      passed:verdicts.filter(v=>v.passes).length,
      actual:questionComparison(batch,id).actual};
  }
  function validateOutput(output, input) {
    if (!output || !same(output.request, request(input)) || !output.response || typeof output.response.model !== 'string' || !Number.isFinite(output.latencyMs) || output.latencyMs < 0) throw Error('Resultado não corresponde ao teste.');
    const answers = output.response.answers;
    if (!answers || Object.keys(answers).length !== Object.keys(input.config.questions).length) throw Error('Respostas incompletas.');
    const probability = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    for (const [id, q] of Object.entries(input.config.questions)) {
      const a = answers[id];
      if (!a || a.type !== q.type) throw Error('Tipo de resposta inválido.');
      if (q.type === 'noul') { if (!probability(a.noul)) throw Error('Probabilidade inválida.'); continue; }
      const keys = Object.keys(q.criteria);
      if (!a.probabilities || Object.keys(a.probabilities).length !== keys.length || keys.some(k => !probability(a.probabilities[k])) || Math.abs(Object.values(a.probabilities).reduce((s, v) => s + v, 0) - 1) > .02 || !probability(a.confidence)) throw Error('Distribuição inválida.');
      if (q.type === 'choice' && !keys.includes(a.choice)) throw Error('Classe inválida.');
      if (q.type === 'score' && (!Number.isFinite(a.score) || a.score < 0 || a.score > keys.length - 1)) throw Error('Score inválido.');
    }
  }
  function summarize(batch) {
    const runs = batch.runs.filter(run => run.status === 'done');
    const metrics = Object.create(null), vectors = new Map();
    let matches = 0, comparisons = 0, passes = 0;
    for (const run of runs) {
      const vector = JSON.stringify(Object.keys(batch.input.config.questions).map(id => predicted(run.output.response.answers[id])));
      vectors.set(vector, (vectors.get(vector) || 0) + 1);
    }
    for (const [id, q] of Object.entries(batch.input.config.questions)) {
      const answers = runs.map(run => run.output.response.answers[id]);
      const expected = expectedFor(batch)[id];
      const predictions = answers.map(predicted), counts = new Map();
      for (const value of predictions) counts.set(value, (counts.get(value) || 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      const mode = ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
      const values = answers.map(a => q.type === 'score' ? a.score : q.type === 'noul' ? a.noul : a.probabilities[expected?.value ?? mode] ?? 0);
      const average = mean(values);
      const correct = expected ? predictions.filter(value => value === expected.value).length : null;
      const verdicts = expected ? answers.map(answer => evaluateAnswer(answer, expected)) : [];
      const passed = expected ? verdicts.filter(verdict => verdict.passes).length : null;
      if (expected) { matches += correct; passes += passed; comparisons += answers.length; }
      metrics[id] = { count: answers.length, mode, mean: q.type === 'choice' && !expected && mode === null ? null : average, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, deviation: average === null ? null : Math.sqrt(mean(values.map(v => (v - average) ** 2))), matches: correct, passes: passed, expected: expected?.value, minProbability: expected?.minProbability ?? null, expectedProbabilityMean: mean(verdicts.map(verdict => verdict.probability)), consistent: ranked[0]?.[1] || 0 };
    }
    const latencies = runs.map(r => r.output.latencyMs);
    const evaluatedRuns = Object.keys(expectedFor(batch)).length ? runs.length : 0;
    const passedRuns = runs.filter(run => evaluateRun(run.output.response.answers, expectedFor(batch)).passes === true).length;
    return { count: runs.length, failed: batch.runs.filter(r => r.status === 'error').length, matches, passes, comparisons, evaluatedRuns, passedRuns, consistency: runs.length ? Math.max(...vectors.values()) / runs.length : null, latencyMs: mean(latencies), latencyMinMs: latencies.length ? Math.min(...latencies) : null, latencyMaxMs: latencies.length ? Math.max(...latencies) : null, latencyTotalMs: latencies.length ? latencies.reduce((a,b) => a+b, 0) : null, metrics };
  }
  function aggregate(batch) {
    const runs = batch.runs.filter(run => run.status === 'done');
    if (!runs.length) return null;
    if (new Set(runs.map(run => resultProvider(run.output))).size > 1) return null;
    const answers = Object.create(null);
    for (const [id, q] of Object.entries(batch.input.config.questions)) {
      const values = runs.map(run => run.output.response.answers[id]);
      if (q.type === 'noul') { answers[id] = { type: 'noul', noul: mean(values.map(a => a.noul)) }; continue; }
      const probabilities = Object.fromEntries(Object.keys(q.criteria).map(key => [key, mean(values.map(a => a.probabilities[key]))]));
      const ranked = Object.entries(probabilities).sort((a,b) => b[1] - a[1]);
      const winner = Math.abs(ranked[0][1] - ranked[1][1]) < 1e-12 ? null : ranked[0][0];
      answers[id] = q.type === 'score' ? { type: 'score', score: mean(values.map(a => a.score)), probabilities } : { type: 'choice', choice: winner, probabilities };
    }
    // A derived view, deliberately NOT a model response or a recorded execution.
    return { kind: 'aggregate', count: runs.length, request: request(batch.input), answers };
  }
  function validateArchive(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.cases) || !Array.isArray(data.batches) || data.cases.length > 500 || data.batches.length > 2000) throw Error('Arquivo de testes inválido ou grande demais.');
    if (data.deleted !== undefined) {
      if (!data.deleted || typeof data.deleted !== 'object' || Array.isArray(data.deleted) || Object.keys(data.deleted).some(k => !['cases', 'batches'].includes(k))) throw Error('Registro de exclusões inválido.');
      for (const collection of ['cases', 'batches']) {
        const removed = data.deleted[collection];
        if (!Array.isArray(removed) || removed.length > 10000 || new Set(removed).size !== removed.length || removed.some(id => typeof id !== 'string' || !id || id.length > 150)) throw Error('Registro de exclusões inválido.');
        if (data[collection].some(item => removed.includes(item.id))) throw Error('Um item excluído ainda está presente no arquivo.');
      }
    }
    const ids = new Set();
    for (const item of [...data.cases, ...data.batches]) {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 150 || ids.has(item.id)) throw Error('ID de teste inválido ou repetido.');
      ids.add(item.id);
      if (typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt))) throw Error('Data inválida.');
      validateInput(item.input);
      if (item.displayName !== undefined || item.nameUpdatedAt !== undefined) {
        validateName(item.displayName);
        if (typeof item.nameUpdatedAt !== 'string' || Number.isNaN(Date.parse(item.nameUpdatedAt))) throw Error('Data de alteração do nome inválida.');
      }
      if (data.batches.includes(item)) {
        if(item.expectedOverride!==undefined || item.expectedUpdatedAt!==undefined){
          validateExpected(item.expectedOverride,item.input.config.questions);
          if(typeof item.expectedUpdatedAt!=='string' || Number.isNaN(Date.parse(item.expectedUpdatedAt)))throw Error('Data de correção dos esperados inválida.');
        }
        if (item.origin === 'automation' || item.automation !== undefined) {
          const a=item.automation;
          if (item.origin !== 'automation' || !a || typeof a !== 'object' || Array.isArray(a) || typeof a.campaignId !== 'string' || !a.campaignId || a.campaignId.length > 150 || !Number.isInteger(a.round) || a.round < 1 || a.round > 999999 || !['fixed','current_utterance','recent_context','state','mixed'].includes(a.field)) throw Error('Metadados de automação inválidos.');
          for (const field of ['variant','questionVariant','totalScenarios','totalCalls']) if (!Number.isInteger(a[field]) || a[field] < 1 || a[field] > (field === 'totalCalls' ? 200 : 50)) throw Error('Contagem de automação inválida.');
          if (typeof a.label !== 'string' || a.label.length > 160 || typeof a.questionLabel !== 'string' || a.questionLabel.length > 80) throw Error('Nome de variante inválido.');
        }
        if (!['running', 'done', 'cancelled', 'interrupted'].includes(item.status) || !Number.isInteger(item.requested) || item.requested < 1 || item.requested > 10 || !Array.isArray(item.runs) || item.runs.length > item.requested) throw Error('Lote inválido.');
        if (item.status === 'done' && item.runs.length !== item.requested) throw Error('Lote concluído com execuções faltando.');
        item.runs.forEach((run, index) => {
          if (!run || run.index !== index + 1 || !['done', 'error', 'deleted'].includes(run.status)) throw Error('Execução inválida.');
          if (run.status === 'done') validateOutput(run.output, item.input);
          else if (run.status === 'error' && (typeof run.error !== 'string' || run.error.length > 3000)) throw Error('Erro de execução inválido.');
          else if (run.status === 'deleted' && (Object.keys(run).length !== 2 || item.status === 'running')) throw Error('Exclusão de execução inválida.');
        });
      }
    }
    return clone(data);
  }
  function csv(data) {
    const rows = [['batch', 'case', 'language', 'run', 'status', 'question', 'type', 'expected', 'actual', 'value', 'matches', 'latency_seconds', 'state', 'instructions', 'criteria', 'error', 'provider', 'response_model', 'min_probability', 'expected_probability', 'passes', 'run_passes']];
    for (const batch of data.batches) for (const run of batch.runs) {
      if (run.status === 'deleted') continue;
      for (const [id, q] of Object.entries(batch.input.config.questions)) {
        const a = run.output?.response.answers[id], expected = expectedFor(batch)[id];
        const verdict = evaluateAnswer(a, expected);
        rows.push([batch.id, testName(batch), batch.input.language, run.index, run.status, id, q.type, expected?.value ?? '', a ? predicted(a) ?? 'tie' : '', !a ? '' : q.type === 'score' ? a.score : q.type === 'noul' ? a.noul : a.probabilities[a.choice], verdict?.matches ?? '', run.output ? run.output.latencyMs / 1000 : '', stateText(batch.input.state), q.instructions, JSON.stringify(q.criteria ?? null), run.error || '', resultProvider(run.output) || batch.provider || '', run.output?.response?.model || '', expected?.minProbability ?? '', verdict?.probability ?? '', verdict?.passes ?? '', run.output ? evaluateRun(run.output.response.answers, expectedFor(batch)).passes ?? '' : '']);
      }
    }
    // Prevent spreadsheet formula injection in user-authored cells.
    return '\uFEFF' + rows.map(row => row.map(value => {
      const text = String(value); return '"' + (/^\s*[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
    }).join(',')).join('\r\n');
  }
  function mergeArchives(stored, current) {
    const result = { schemaVersion: 1, cases: [], batches: [], deleted: { cases: [], batches: [] } };
    for (const collection of ['cases', 'batches']) {
      // Deletion wins over an older open tab, including during pagehide.
      const deleted = new Set([...(stored.deleted?.[collection] || []), ...(current.deleted?.[collection] || [])]);
      if (deleted.size > 10000) throw Error('Limite do registro de exclusões; faça backup.');
      result.deleted[collection] = [...deleted];
      const combined = new Map(stored[collection].filter(item => !deleted.has(item.id)).map(item => [item.id, item]));
      for (const item of current[collection]) {
        if (deleted.has(item.id)) continue;
        const previous = combined.get(item.id);
        if (!previous) { combined.set(item.id, item); continue; }
        if (collection === 'cases') {
          if (Date.parse(item.updatedAt || item.createdAt) >= Date.parse(previous.updatedAt || previous.createdAt)) combined.set(item.id, item);
        } else {
          if (!same(item.input, previous.input)) throw Error('Conflito entre versões de um lote; faça backup.');
          const complete = value => value.finishedAt ? 2 : value.status === 'interrupted' ? 1 : 0;
          const chosen = item.runs.length > previous.runs.length || (item.runs.length === previous.runs.length && complete(item) >= complete(previous)) ? item : previous;
          // The editable display name is metadata, independent of frozen inputs/run progress.
          const renamed = [item, previous].filter(value => value.nameUpdatedAt).sort((a, b) => Date.parse(b.nameUpdatedAt) - Date.parse(a.nameUpdatedAt) || b.displayName.localeCompare(a.displayName))[0];
          if (renamed) { chosen.displayName = renamed.displayName; chosen.nameUpdatedAt = renamed.nameUpdatedAt; }
          const corrected=[item,previous].filter(value=>value.expectedUpdatedAt).sort((a,b)=>Date.parse(b.expectedUpdatedAt)-Date.parse(a.expectedUpdatedAt) || JSON.stringify(b.expectedOverride).localeCompare(JSON.stringify(a.expectedOverride)))[0];
          if(corrected){chosen.expectedOverride=clone(corrected.expectedOverride);chosen.expectedUpdatedAt=corrected.expectedUpdatedAt;}
          const removed = new Set([...previous.runs, ...item.runs].filter(run => run.status === 'deleted').map(run => run.index));
          chosen.runs = chosen.runs.map(run => removed.has(run.index) ? { index: run.index, status: 'deleted' } : run);
          combined.set(item.id, chosen);
        }
      }
      // Keep current object identities: an in-flight batch continues appending to its own runs.
      result[collection] = [...combined.values()];
    }
    return result;
  }
  function removeItem(data, collection, id) {
    if (!['cases', 'batches'].includes(collection)) throw Error('Coleção inválida.');
    const index = data[collection].findIndex(item => item.id === id);
    if (index === -1) throw Error('Item não encontrado.');
    if (data[collection][index].status === 'running') throw Error('Interrompa o lote antes de excluí-lo.');
    const removed = data.deleted?.[collection] || [];
    if (removed.length >= 10000) throw Error('Limite do registro de exclusões; faça backup.');
    data.deleted ||= { cases: [], batches: [] };
    data.deleted[collection].push(id);
    data[collection].splice(index, 1);
  }
  function removeRun(batch, index) {
    if (!batch || batch.status === 'running') throw Error('Interrompa o lote antes de excluir uma execução.');
    const position = batch.runs.findIndex(run => run.index === index && run.status !== 'deleted');
    if (position === -1) throw Error('Execução não encontrada.');
    // Keep only its ordinal, never its output/error, so old tabs cannot resurrect it.
    batch.runs[position] = { index, status: 'deleted' };
  }
  function renameBatch(data, id, name) {
    validateName(name);
    const item = data.batches.find(batch => batch.id === id);
    if (!item) throw Error('Teste não encontrado.');
    if (item.status === 'running') throw Error('Interrompa o lote antes de renomear.');
    item.displayName = name.trim();
    item.nameUpdatedAt = new Date(Math.max(Date.now(), (Date.parse(item.nameUpdatedAt) || 0) + 1)).toISOString();
  }
  function updateExpected(data,id,values) {
    const item=data.batches.find(batch=>batch.id===id);
    if(!item)throw Error('Teste não encontrado.');
    if(item.status==='running')throw Error('Interrompa o lote antes de corrigir os esperados.');
    validateExpected(values,item.input.config.questions);
    item.expectedOverride=clone(values);
    item.expectedUpdatedAt=new Date(Math.max(Date.now(),(Date.parse(item.expectedUpdatedAt)||0)+1)).toISOString();
  }
  root.NorteExperiments = { clone, languages, validateConfig, validateDraftConfig, validateState, parseState, parseRequest, stateText, sameState: same, validateExpected, validateInput, validateOutput, validateArchive, request, exportTest, testName, renameBatch, expectedFor, updateExpected, predicted, evaluateAnswer, evaluateRun, probabilityOf, questionComparison, questionChecks, campaignGroups, summarize, aggregate, seconds, resultProvider, resultLabel, batchLabel, mergeArchives, removeItem, removeRun, csv };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NorteExperiments;
})(typeof globalThis !== 'undefined' ? globalThis : window);
