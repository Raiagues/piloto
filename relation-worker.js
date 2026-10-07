/* Independent, bounded relation pipeline. Work IDs are a queue, not memory. */
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const threshold = .8, token = '{{candidate_id}}';
  const defaults = {
    questions: { has_relation: {
      type: 'noul',
      instructions: 'Is current_event meaningfully related to candidate {{candidate_id}}? Always evaluate the direction current_event -> candidate. Use the supplied event text, type and status; do not invent missing context.',
      criteria: {
        true: 'The current_event refers to, evaluates, provides a result for, supports, contradicts, depends on, affects, replaces, or otherwise has a meaningful semantic connection to candidate {{candidate_id}}.',
        false: 'The current_event and candidate {{candidate_id}} concern different subjects, objectives, conditions, or project matters and do not have a meaningful semantic connection.'
      }
    } }
  };
  function validateConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !['questions','candidate_rules,questions'].includes(Object.keys(value).sort().join())) throw Error('Use questions com o template has_relation. Novas execuções comparam todos os eventos anteriores, sem filtro.');
    // candidate_rules is read only for historical snapshots, never new work.
    const rules = Object.hasOwn(value,'candidate_rules') ? value.candidate_rules : {};
    if (!rules || typeof rules !== 'object' || Array.isArray(rules) || Object.keys(rules).length > 100) throw Error('candidate_rules deve ser um objeto de regras por tipo de origem.');
    for (const [type, targets] of Object.entries(rules)) {
      if (!type.trim() || type.length > 80 || !Array.isArray(targets) || targets.length > 100) throw Error('Cada tipo deve ter uma lista de candidatos {type, status}.');
      const seen = new Set();
      for (const target of targets) {
        if (!target || Object.keys(target).sort().join() !== 'status,type' || !['type','status'].every(k => typeof target[k] === 'string' && target[k].trim() && target[k].length <= 80)) throw Error('Informe type e status como textos em cada regra.');
        const key = JSON.stringify([target.type,target.status]);
        if (seen.has(key)) throw Error('Regra de candidato repetida.'); seen.add(key);
      }
    }
    E.validateConfig({ model: 'jev-latest', questions: value.questions });
    if (Object.keys(value.questions).join() !== 'has_relation' || value.questions.has_relation.type !== 'noul') throw Error('Mantenha apenas has_relation (noul) nesta etapa.');
    if (!value.questions.has_relation.instructions.includes(token)) throw Error('Inclua {{candidate_id}} nas instruções para identificar o candidato.');
    return E.clone(value);
  }
  function currentConfig(value = defaults) { return {questions:validateConfig(value).questions}; }
  function isFiltered(state) { return state?.schemaVersion===1 && Object.hasOwn(state.config,'candidate_rules'); }
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const fields = event => Object.fromEntries(['event_id','chunk_id','timestamp','type','text','status'].map(key => [key,event[key]]));
  function request(current, candidates, config) {
    const questions = Object.fromEntries(candidates.map(candidate => {
      const template = config.questions.has_relation;
      const question = { type: 'noul', instructions: template.instructions.replaceAll(token, candidate.event_id) };
      if (template.criteria) question.criteria = Object.fromEntries(Object.entries(template.criteria).map(([key,text]) => [key,text.replaceAll(token,candidate.event_id)]));
      return ['has_relation__' + candidate.event_id, question];
    }));
    return { model: 'jev-latest', state: { current_event: fields(current), candidates: candidates.map(fields) }, questions };
  }
  function validateRequest(value) {
    E.validateConfig(value); E.validateState(value.state);
    if (new TextEncoder().encode(JSON.stringify(value)).length > 64000) throw Error('A chamada de relações excede 64 KB.');
    return value;
  }
  function plan(current, candidates, config) {
    const parts = []; let group = [];
    const flush = () => { if (group.length) { parts.push({ request: validateRequest(request(current, group, config)), status: 'queued' }); group = []; } };
    for (const candidate of candidates) {
      try { validateRequest(request(current, [...group,candidate],config)); group.push(candidate); }
      catch (_) {
        flush();
        try { validateRequest(request(current,[candidate],config)); group.push(candidate); }
        catch (error) { parts.push({ candidate_id: candidate.event_id, status: 'error', error: 'Par não enviado: ' + error.message }); }
      }
    }
    flush(); return parts;
  }
  function candidatesFor(current, previous, config) {
    if (!Object.hasOwn(config,'candidate_rules')) return previous.filter(event=>event.event_id!==current.event_id);
    const rules = Object.hasOwn(config.candidate_rules,current.type) ? config.candidate_rules[current.type] : [];
    return previous.filter(event => event.event_id !== current.event_id && rules.some(rule => rule.type === event.type && rule.status === event.status));
  }
  function validateExpected(value,cases) {
    const positions = new Map(cases.map((item,i)=>[item.id,i])), seen = new Set();
    const checkTarget = (sourceId,targetId) => {
      const source = positions.get(sourceId), target = positions.get(targetId);
      if (source === undefined || target === undefined || target >= source) throw Error('A relação esperada deve apontar de um chunk existente para outro anterior.');
    };
    const checkLabels = (sourceId,labels) => {
      if (!labels || typeof labels !== 'object' || Array.isArray(labels)) throw Error(sourceId+': informe um objeto por ID de chunk anterior.');
      return Object.fromEntries(Object.entries(labels).map(([targetId,label])=>{
        checkTarget(sourceId,targetId);
        if (!label || typeof label !== 'object' || Array.isArray(label) || Object.keys(label).join() !== 'has_relation' || typeof label.has_relation !== 'boolean') throw Error(sourceId+' → '+targetId+': informe has_relation como true ou false.');
        return [targetId,{has_relation:label.has_relation}];
      }));
    };
    if (!Array.isArray(value)) {
      if (!value || typeof value !== 'object') throw Error('expected_relations deve ser um objeto por ID de chunk.');
      return Object.fromEntries(Object.entries(value).map(([sourceId,group])=>{
        if (!positions.has(sourceId)) throw Error('Chunk de origem desconhecido em expected_relations: '+sourceId+'.');
        if (!group || typeof group !== 'object' || Array.isArray(group)) throw Error(sourceId+': informe um objeto por ID de chunk anterior.');
        const keys = Object.keys(group), legacy = keys.some(key=>['expected_candidates','candidate_expectations'].includes(key));
        if (!legacy) return [sourceId,checkLabels(sourceId,group)];
        if (keys.some(key=>!['expected_candidates','candidate_expectations'].includes(key))) throw Error(sourceId+': não misture IDs diretos com expected_candidates ou candidate_expectations.');
        const fields = [];
        if (Object.hasOwn(group,'expected_candidates')) {
          if (!Array.isArray(group.expected_candidates)) throw Error(sourceId+': expected_candidates deve ser uma lista de IDs de chunks anteriores.');
          const ids = new Set();
          for (const targetId of group.expected_candidates) {
            checkTarget(sourceId,targetId);
            if (ids.has(targetId)) throw Error(sourceId+': ID repetido em expected_candidates.');
            ids.add(targetId);
          }
          fields.push(['expected_candidates',[...ids]]);
        }
        if (Object.hasOwn(group,'candidate_expectations')) {
          fields.push(['candidate_expectations',checkLabels(sourceId,group.candidate_expectations)]);
        }
        return [sourceId,Object.fromEntries(fields)];
      }));
    }
    // Keep earlier saved batches in their original flat-pair format.
    if (value.length > cases.length*(cases.length-1)/2) throw Error('expected_relations tem mais pares que o limite de chunks anteriores.');
    return value.map(pair=>{
      const keys = ['source_chunk_id','target_chunk_id','expected_candidate','expected_has_relation'];
      if (!pair || typeof pair !== 'object' || Array.isArray(pair) || Object.keys(pair).some(key=>!keys.includes(key))) throw Error('Use source_chunk_id, target_chunk_id, expected_candidate e/ou expected_has_relation.');
      checkTarget(pair.source_chunk_id,pair.target_chunk_id);
      const key = JSON.stringify([pair.source_chunk_id,pair.target_chunk_id]);
      if (seen.has(key)) throw Error('Par repetido em expected_relations.'); seen.add(key);
      const expected = ['expected_candidate','expected_has_relation'].filter(key=>Object.hasOwn(pair,key));
      if (!expected.length || expected.some(key=>typeof pair[key] !== 'boolean')) throw Error('Informe expected_candidate e/ou expected_has_relation como true ou false.');
      return { source_chunk_id: pair.source_chunk_id, target_chunk_id: pair.target_chunk_id,...Object.fromEntries(expected.map(key=>[key,pair[key]])) };
    });
  }
  function expectedFor(value,sourceId,previous,complete) {
    // Complete only the actual arrival prefix in meeting_events, by chunk ID.
    // This is a local evaluation projection, never part of an inference request.
    const expected = new Map(previous.map(target=>[target.chunk_id,complete?{expected_has_relation:false}:{}]));
    if (Array.isArray(value)) {
      for (const pair of value) if (pair.source_chunk_id===sourceId && expected.has(pair.target_chunk_id)) expected.set(pair.target_chunk_id,{...expected.get(pair.target_chunk_id),...pair});
      return expected;
    }
    const group = value && Object.hasOwn(value,sourceId) ? value[sourceId] : null;
    if (!group) return expected;
    // Old filter labels remain readable for historical v1 runs only.
    const candidates = Object.hasOwn(group,'expected_candidates') ? new Set(group.expected_candidates) : null;
    const labels = Object.hasOwn(group,'candidate_expectations') ? group.candidate_expectations : candidates ? {} : group;
    for (const target of previous) {
      const label = expected.get(target.chunk_id);
      if (candidates) label.expected_candidate = candidates.has(target.chunk_id);
      if (Object.hasOwn(labels,target.chunk_id)) label.expected_has_relation = labels[target.chunk_id].has_relation;
    }
    return expected;
  }
  // Inspection projection only: never add rejected pairs to the inference queue
  // or pass expected labels to request(). Older jobs see only their own prefix.
  function auditJob(run,job) {
    const events = run?.meeting_events || [], position = events.findIndex(event=>event.event_id===job?.event_id);
    if (position < 0 || !run.relation_worker) return null;
    const current = events[position], previous = events.slice(0,position), config = run.relation_worker.config;
    const allowed = new Set(candidatesFor(current,previous,config).map(event=>event.event_id)), selected = new Set(job.candidate_ids);
    const expected = expectedFor(run.batch?.expected_relations,current.chunk_id,previous,run.relation_worker.schemaVersion>=3);
    const scores = new Map(job.scores.map(score=>[score.target_id,score]));
    const filtered = isFiltered(run.relation_worker);
    const pairs = previous.map(target=>{
      const label = expected.get(target.chunk_id), candidate = selected.has(target.event_id), ruleExpected = allowed.has(target.event_id);
      const expectedCandidate = filtered ? label?.expected_candidate ?? ruleExpected : null, expectedRelation = label?.expected_has_relation ?? null;
      const score = scores.get(target.event_id), obtained = score ? score.probability >= .5 : null;
      const probability = score ? obtained ? score.probability : 1-score.probability : null;
      const low = probability !== null && probability <= threshold;
      const part = job.parts.find(part=>part.candidate_id===target.event_id || part.request?.state.candidates.some(event=>event.event_id===target.event_id));
      const blocked = !candidate && expectedRelation === true;
      const filterMatches = filtered ? candidate === expectedCandidate : null;
      const matches = expectedRelation === null || obtained === null ? null : obtained === expectedRelation;
      const resultTone = part?.status === 'error' ? 'error' : blocked ? 'fail' : obtained === null ? '' : matches === false ? 'fail' : low ? 'warning' : matches ? 'pass' : '';
      return { target, candidate, ruleExpected, expectedCandidate, expectedCandidateSource:!filtered?null:label?.expected_candidate===undefined?'rule':'label', filterMatches, blocked,
        filterTone:filtered?(filterMatches && !blocked?'pass':'fail'):'', expectedRelation, obtained, probability, lowConfidence:low, matches, resultTone,
        probabilityTrue:score?.probability ?? null, retained:score?.accepted || false, part:part || null };
    });
    return { current, job, filtered:isFiltered(run.relation_worker), pairs, approved:pairs.filter(pair=>pair.candidate), rejected:pairs.filter(pair=>!pair.candidate),
      positive:pairs.filter(pair=>pair.obtained===true), negative:pairs.filter(pair=>pair.obtained===false), pending:pairs.filter(pair=>pair.candidate&&pair.obtained===null) };
  }
  function combinedTone(tones) {
    if (tones.includes('error')) return 'error';
    if (tones.includes('fail')) return 'fail';
    if (tones.includes('warning')) return 'warning';
    if (tones.includes('active')) return 'active';
    return tones.length && tones.every(tone=>tone==='pass') ? 'pass' : '';
  }
  function validateOutput(output, req) {
    E.validateOutput(output, { state: req.state, config: { model: req.model, questions: req.questions } });
  }
  function scoresFor(job) {
    return (job.parts || []).flatMap(part => part.status !== 'done' ? [] : part.request.state.candidates.map(candidate => {
      const probability = part.output.response.answers['has_relation__' + candidate.event_id].noul;
      return { target_id: candidate.event_id, probability, accepted: probability > threshold };
    }));
  }
  function relationsFor(jobs) {
    const relations = [];
    for (const job of jobs) for (const score of scoresFor(job)) if (score.accepted) relations.push({
      relation_id: 'R' + String(relations.length + 1).padStart(3,'0'), source_event_id: job.event_id,
      target_type: 'meeting_event', target_id: score.target_id, relation_confidence: score.probability
    });
    return relations;
  }
  function createState(config = defaults, version = null, schemaVersion = 3) {
    const valid = validateConfig(config);
    if (schemaVersion>=2 && Object.hasOwn(valid,'candidate_rules')) throw Error('Execuções novas não usam candidate_rules.');
    return { schemaVersion, config: valid, version, status: 'running', calls: 0, jobs: [] };
  }
  function start(run, { config = defaults, version = null, send, onChange = () => {}, now = Date.now }) {
    if (run.relation_worker) throw Error('Crie uma nova rodada; relações nunca são retomadas automaticamente.');
    const state = run.relation_worker = createState(currentConfig(config),Object.hasOwn(config,'candidate_rules')?null:version); run.relations = [];
    const queue = [], events = new Map(), enqueued = new Set();
    let working = false, halted = false, inputClosed = false, fatal = false, resolveDone;
    const done = new Promise(resolve => { resolveDone = resolve; });
    const notify = () => { onChange(state); };
    const finish = () => {
      if (working || queue.length || !inputClosed && !halted) return;
      state.status = halted ? 'stopped' : 'done'; notify(); resolveDone(state);
    };
    function stop() {
      if (state.status !== 'running') return;
      halted = true;
      for (const id of queue.splice(0)) {
        const job = state.jobs.find(job => job.event_id === id);
        job.status = 'interrupted'; job.error = 'Não processado: worker interrompido; sem retomada automática.';
      }
      notify(); finish();
    }
    async function drain() {
      if (working || halted) return;
      working = true;
      try {
        while (queue.length && !halted) {
          const id = queue.shift(), job = state.jobs.find(job => job.event_id === id), current = events.get(id);
          job.status = 'running'; job.startedAt = new Date(now()).toISOString();
          job.parts = plan(current, job.candidate_ids.map(id => events.get(id)), state.config); notify();
          for (const part of job.parts) {
            if (halted) break;
            if (part.status === 'error') continue;
            part.status = 'running'; part.attempted = true; state.calls++; notify();
            try {
              const output = await send(E.clone(part.request), run.provider);
              validateOutput(output,part.request); part.output = E.clone(output); part.status = 'done';
              job.scores = scoresFor(job); run.relations = relationsFor(state.jobs); notify();
            } catch (error) {
              part.status = 'error'; part.error = error.message || 'Falha no relation worker.';
              if (error.stopBatch) { fatal = true; stop(); }
            }
          }
          for (const part of job.parts) if (['queued','running'].includes(part.status)) part.status = 'interrupted';
          job.scores = scoresFor(job);
          job.status = job.parts.some(p => p.status === 'error') ? 'error' : halted ? 'interrupted' : 'done';
          job.finishedAt = new Date(now()).toISOString(); notify();
        }
      } catch (error) {
        state.error = error.message || 'Falha interna do relation worker.'; fatal = true; stop();
        for (const job of state.jobs) if (job.status === 'running') { job.status = 'error'; job.error = state.error; }
      } finally { working = false; finish(); }
    }
    function enqueue(event) {
      if (enqueued.has(event.event_id)) return;
      enqueued.add(event.event_id);
      // Freeze the complete arrival prefix before adding the new event. There
      // is no type/status/label filter and no self or future-event comparison.
      const candidates = [...events.keys()];
      const copy = E.clone(event); events.set(event.event_id,copy);
      const job = { event_id: event.event_id, status: halted ? 'interrupted' : candidates.length ? 'queued' : 'skipped', candidate_ids: candidates,
        parts: [], scores: [], queuedAt: new Date(now()).toISOString() };
      if (halted) job.error = fatal ? 'Worker interrompido após falha; chunks continuam independentes.' : 'Worker interrompido.';
      if (!candidates.length) job.reason = 'no_previous_events';
      state.jobs.push(job);
      if (job.status === 'queued') { queue.push(event.event_id); setTimeout(drain,0); }
      notify();
    }
    return { enqueue, stop, done, close() { inputClosed = true; finish(); }, get pending() { return [...queue]; } };
  }
  function restore(saved, events) {
    if (!saved || ![1,2,3].includes(saved.schemaVersion) || !Array.isArray(saved.jobs) || !['running','done','stopped','interrupted'].includes(saved.status)) throw Error('Relation worker salvo inválido.');
    const state = createState(saved.config,saved.version || null,saved.schemaVersion); state.status = saved.status === 'running' ? 'interrupted' : saved.status;
    if (saved.error) state.error = String(saved.error);
    let calls = 0;
    state.jobs = saved.jobs.map((raw,i) => {
      const current = events[i];
      if (!current || raw.event_id !== current.event_id || !['queued','running','done','error','skipped','interrupted'].includes(raw.status)) throw Error('Fila de relações inválida.');
      const candidates = candidatesFor(current,events.slice(0,i),state.config);
      if (!same(raw.candidate_ids,candidates.map(c=>c.event_id))) throw Error('Candidatos salvos não correspondem ao conjunto anterior da execução.');
      const planned = plan(current,candidates,state.config), job = E.clone(raw);
      if (!Array.isArray(job.parts) || job.parts.length && job.parts.length !== planned.length || job.status === 'done' && job.parts.length !== planned.length) throw Error('Lotes de relações inválidos.');
      for (const [j,part] of job.parts.entries()) {
        if (planned[j].request) {
          if (!same(part.request,planned[j].request) || !['queued','running','done','error','interrupted'].includes(part.status)) throw Error('Chamada de relação não corresponde ao snapshot.');
          if (part.status === 'done') { validateOutput(part.output,part.request); calls++; }
          else if (['running','error'].includes(part.status) || part.attempted) calls++;
          if (part.status === 'running') part.attempted = true;
          if (['queued','running'].includes(part.status)) part.status = 'interrupted';
        } else if (!same(part,planned[j])) throw Error('Par não enviado inválido.');
      }
      if (job.status === 'skipped' && candidates.length) throw Error('Candidatos ignorados indevidamente.');
      if (['queued','running'].includes(job.status)) { job.status = 'interrupted'; job.error = 'Página recarregada; não houve retomada automática.'; }
      job.scores = scoresFor(job); return job;
    });
    if (!Number.isInteger(saved.calls) || saved.calls !== calls) throw Error('Contagem de relações inválida.');
    state.calls = calls; return state;
  }
  // The old relation pipeline above is retained solely for historical snapshots.
  // New memory-page executions use this independent thread-assignment worker.
  function threadAPI() {
    const choices=['belongs','does_not_belong','uncertain'];
    const legacyDefaults={questions:{
      belongs_to_active_thread:{type:'choice',instructions:'Determine whether current_event belongs to the same specific discussion thread represented by active_thread. Use current_event, recent_context, and the active_thread anchors. A thread is a continuing discussion about the same specific problem, objective, decision, investigation, component in context, or chain of work. Do not decide based only on shared words, numbers, dimensions, or generic technical vocabulary.',criteria:{
        belongs:"The current event continues, answers, updates, tests, challenges, decides, or otherwise advances the same specific discussion represented by the active thread. It may introduce a new hypothesis, test, result, requirement, or decision while still addressing the same underlying issue or objective. Indirect references such as 'it', 'that test', 'the problem', 'again', or 'the real issue' may count when recent_context and the thread anchors make the reference clear.",
        does_not_belong:"The current event starts or continues a meaningfully different discussion, problem, objective, component context, investigation, or decision chain. Shared words, values, units, component types, or phrases such as '4 mm' are not sufficient by themselves to make two events part of the same thread.",
        uncertain:'There is not enough information to determine whether the current event continues the active thread. Use this when the wording could plausibly belong to more than one discussion and recent_context does not resolve it.'}},
      belongs_to_archive_thread:{type:'choice',instructions:'Determine whether current_event resumes or continues the specific archived discussion represented by candidate_thread. Use current_event, recent_context, and the candidate_thread anchors. Evaluate this candidate thread independently. An old thread may be resumed after a long gap, but shared terminology, numbers, dimensions, or components alone are not enough.',criteria:{
        belongs:"The current event clearly resumes, refers back to, continues, updates, repeats, or acts on the same specific problem, objective, investigation, decision, or work chain represented by the archived thread. Explicit return cues such as 'back to', 'about the bracket', 'that earlier test', or compatible indirect references can support this.",
        does_not_belong:'The current event belongs to a different discussion or only shares generic terminology, values, measurements, or technical concepts with the archived thread. The current recent_context points to another subject or objective.',
        uncertain:'There is plausible overlap with the archived thread, but there is not enough information to determine whether the speaker is actually returning to it.'}}
    }};
    const defaults=E.clone(legacyDefaults);
    defaults.questions.belongs_to_active_thread={type:'choice',instructions:'Decide whether current_event clearly continues the same conversational thread as active_thread. Use recent_context as the strongest evidence of conversational continuity, and use active_thread.events to understand what the thread is about. Do not decide based on whether the current event could technically be relevant to the same project. The question is whether the conversation itself provides enough evidence that this event continues this specific thread. If the connection is merely plausible but not established, choose uncertain.',criteria:{
      belongs:'There is clear conversational evidence that current_event continues the same specific problem, investigation, objective, test chain, decision chain, or line of work. This may be shown by an explicit reference, a clear continuation of the immediately preceding discussion, an answer or result to something in the thread, or another strong contextual link.',
      does_not_belong:'There is clear conversational evidence that current_event concerns a different problem, component in context, objective, investigation, decision chain, or line of work. A clear topic switch or explicit introduction of another subject supports this result.',
      uncertain:'The current event could plausibly belong to the active thread, but the conversation does not provide enough evidence to establish that continuation. Use this for isolated requirements, facts, constraints, or statements that might apply to the active subject but do not explicitly or contextually identify it. Also use uncertain rather than guessing when deciding would require an unstated assumption.'}};
    defaults.questions.belongs_to_archive_thread.instructions=defaults.questions.belongs_to_archive_thread.instructions.replace('candidate_thread anchors','candidate_thread.events');
    const previousActiveQuestions=[E.clone(defaults.questions.belongs_to_active_thread),{"type": "choice", "instructions": "Determine whether current_event continues the specific discussion represented by active_thread. Use active_thread.events to understand the established thread and use recent_context to resolve conversational references. A recent event marked pending or unassigned has not changed the active thread and should not by itself be treated as a topic switch. An isolated uncertain event may temporarily interrupt a thread without ending it.", "criteria": {"belongs": "The current event clearly continues or returns to the same established problem, objective, investigation, test chain, decision chain, or line of work. Indirect expressions such as 'the real issue', 'that test', 'again', or 'the problem' count when they can be resolved from the established active thread. A pending intervening event does not prevent a later event from belonging to the active thread.", "does_not_belong": "There is clear evidence that the current event starts or continues a different problem, objective, investigation, decision chain, component in context, or line of work. A topic change should be supported by the conversation rather than inferred only from a new technical fact.", "uncertain": "The current event could plausibly belong to the active thread, but there is not enough evidence to establish or reject that continuation. Use uncertain when assigning the event would require an unstated assumption."}}];
    defaults.questions.belongs_to_active_thread={
      "type": "choice",
      "instructions": "Determine conversational continuity. Identify the established problem or goal from active_thread.events, then read recent_context chronologically to resolve current_event. Track that problem across facts, alternative causes, tests, results, and decisions. Facts and requirements explicitly identifying the same subject can add background or constraints without proving a causal relationship. A new suspected cause, involved part, or next test may continue the same investigation without repeating its subject. Logistics, acknowledgments, and isolated statements without an identified subject do not establish a topic change. Pending recent events remain useful conversational context even when absent from active_thread.events. Routing fields (thread_id, thread_assignment_state, status) are application bookkeeping, not evidence of topic membership; current_event is pending because it awaits classification. Its nested chunk repeats the source utterance, not a second utterance. Mere adjacency or possible technical relevance to the same project is insufficient. An isolated requirement or constraint with no identified subject is uncertain; do not silently attach it to the last discussed design. Reserve does_not_belong for a conversationally supported change of problem or goal.",
      "criteria": {
        "belongs": "The conversation establishes a continuation or return to the same problem, goal, or line of work. This includes a fact identifying the subject already under discussion, an alternative cause of the established problem, a change to how that problem will be tested, or a follow-up to a recent hypothesis or result. Resolve implicit references using both the established thread and the recent sequence; the speaker need not repeat the subject in every utterance. A different suspected cause or involved part does not by itself mean a different thread. A requirement or constraint explicitly identifying the active subject and stating a property or acceptance criterion for it also continues the discussion; this is different from an isolated requirement with no identified subject.",
        "does_not_belong": "The conversation clearly establishes a different problem, goal, or independent line of work, such as an explicit topic switch to another investigation. A different component name is evidence only when it identifies a different discussion, not when it is offered as another explanation or test of the established problem.",
        "uncertain": "The current event could plausibly belong to the active thread, but the conversation does not provide enough evidence to establish that continuation. Use this for isolated requirements, facts, constraints, or statements that might apply to the active subject but do not explicitly or contextually identify it. Mere adjacency in the transcript or possible technical applicability does not identify the subject. Also use uncertain rather than guessing when deciding would require an unstated assumption."
      }
    };
    // Upgrade only these exact previous rubrics for new executions. Stored
    // requests and all other user-authored questions remain immutable.
    function currentConfig(value) {
      const config=validateConfig(value);
      for(const id of Object.keys(defaults.questions))if(same(config.questions[id],legacyDefaults.questions[id]))config.questions[id]=E.clone(defaults.questions[id]);
      if(previousActiveQuestions.some(question=>same(config.questions.belongs_to_active_thread,question)))config.questions.belongs_to_active_thread=E.clone(defaults.questions.belongs_to_active_thread);
      return config;
    }
    function validateConfig(value,base) {
      let config=value && Object.keys(value).join()==='questions'?value:{questions:value};
      // The editor can paste either template independently; snapshots remain full.
      if(base && config.questions && Object.keys(config.questions).length===1 && Object.keys(config.questions).every(id=>Object.hasOwn(defaults.questions,id)))config={questions:{...E.clone(base.questions),...config.questions}};
      E.validateConfig({model:'jev-latest',questions:config.questions});
      if(Object.keys(config.questions).sort().join()!=='belongs_to_active_thread,belongs_to_archive_thread' || Object.values(config.questions).some(q=>q.type!=='choice' || Object.keys(q.criteria).sort().join()!==[...choices].sort().join())) throw Error('Mantenha belongs_to_active_thread e belongs_to_archive_thread (choice), com belongs, does_not_belong e uncertain.');
      return E.clone(config);
    }
    function validateExpected(value,cases) {
      if(!value || typeof value!=='object' || Array.isArray(value))throw Error('expected_threads deve ser um objeto por ID de chunk.');
      const ids=new Set(cases.map(item=>item.id));
      const fields=['expected_action','expected_thread_id','expected_active_thread_id','expected_active_result','expected_archive_results','expected_archive_match','expected_archive_result'];
      const validId=id=>typeof id==='string' && /^T\d{3,}$/.test(id);
      for(const [id,thread] of Object.entries(value)) {
        if(!ids.has(id))throw Error('Chunk desconhecido em expected_threads: '+id+'.');
        if(thread===null || validId(thread))continue;
        if(!thread || typeof thread!=='object' || Array.isArray(thread) || !Object.keys(thread).length)throw Error(id+': use um objeto com os campos de expected_threads, um thread_id ou null.');
        const unknown=Object.keys(thread).filter(key=>!fields.includes(key));
        if(unknown.length)throw Error(id+': campo não reconhecido em expected_threads: '+unknown.join(', ')+'.');
        for(const key of ['expected_thread_id','expected_active_thread_id','expected_archive_match'])if(Object.hasOwn(thread,key) && thread[key]!==null && !validId(thread[key]))throw Error(id+': '+key+' deve ser um ID como T001 ou null.');
        for(const key of ['expected_active_result','expected_archive_result'])if(Object.hasOwn(thread,key) && !choices.includes(thread[key]))throw Error(id+': '+key+' deve ser belongs, does_not_belong ou uncertain.');
        if(Object.hasOwn(thread,'expected_action') && !['create_new_thread','reactivate_thread','keep_active_thread','assign_active_thread','assignment_pending'].includes(thread.expected_action))throw Error(id+': expected_action deve ser create_new_thread, reactivate_thread, keep_active_thread ou assignment_pending.');
        if(Object.hasOwn(thread,'expected_archive_results')) {
          const results=thread.expected_archive_results;
          if(!results || typeof results!=='object' || Array.isArray(results))throw Error(id+': expected_archive_results deve ser um objeto de IDs de threads para belongs, does_not_belong ou uncertain; use {} quando nenhuma consulta é esperada.');
          for(const [target,result] of Object.entries(results)) {
            if(!validId(target))throw Error(id+': ID de thread inválido em expected_archive_results: '+target+'.');
            if(!choices.includes(result))throw Error(id+': expected_archive_results.'+target+' deve ser belongs, does_not_belong ou uncertain.');
          }
        }
        if(Object.hasOwn(thread,'expected_archive_result') && !Object.hasOwn(thread,'expected_archive_match'))throw Error(id+': informe expected_archive_match para identificar a pergunta da thread arquivada.');
        if(thread.expected_archive_result==='belongs' && thread.expected_archive_match===null)throw Error(id+': belongs exige um expected_archive_match com ID de thread.');
      }
      return E.clone(value);
    }
    const eventFields=event=>Object.fromEntries(['event_id','chunk_id','timestamp','type','text','status'].map(key=>[key,event[key]]).filter(([,value])=>value!==undefined));
    function chunkFor(run,id) {
      const record=run.records.find(record=>record.id===id),item=run.batch.cases.find(item=>item.id===id);
      if(!record || !item)throw Error('Chunk ausente: '+id);
      const origin=Date.parse(run.startedAt || run.createdAt),arrival=Date.parse(record.startedAt || record.timestamp);
      const elapsed=Number.isFinite(record.receivedOffsetMs)?record.receivedOffsetMs:Number.isFinite(arrival-origin)?Math.max(0,arrival-origin):0;
      const seconds=Math.floor(Math.max(0,elapsed)/1000);
      const timestamp=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
      return {chunk_id:id,timestamp,text:item.current_utterance};
    }
    function contextFor(run,event,schemaVersion=3) {
      const index=run.records.findIndex(record=>record.id===event.chunk_id);
      if(index<0)throw Error('Evento sem chunk de origem.');
      // Snapshot at receipt: never use later chunks that arrived during backlog.
      return run.records.slice(Math.max(0,index-(schemaVersion>=5?8:5)),index).map(record=>schemaVersion>=3?record.id:{chunk_id:record.id,text:run.batch.cases.find(item=>item.id===record.id).current_utterance});
    }
    function hydrate(thread,events) {
      const byId=new Map(events.map(event=>[event.event_id,event]));
      return {...E.clone(thread),anchors:thread.anchor_event_ids.map(id=>{
        const event=byId.get(id);if(!event)throw Error('Anchor ausente: '+id);return eventFields(event);
      })};
    }
    function request(event,context,threads,config,stage) {
      const current_event=E.clone(event),recent_context=E.clone(context);
      if(stage==='active')return {model:'jev-latest',state:{current_event,recent_context,active_thread:E.clone(threads[0])},questions:{belongs_to_active_thread:E.clone(config.questions.belongs_to_active_thread)}};
      const questions=Object.fromEntries(threads.map(thread=>{
        const q=E.clone(config.questions.belongs_to_archive_thread);
        q.instructions='For this question, candidate_thread is the entry with thread_id '+JSON.stringify(thread.thread_id)+' in state.candidate_threads. Evaluate only that thread.\n'+q.instructions;
        return ['belongs_to_archive_thread__'+thread.thread_id,q];
      }));
      return {model:'jev-latest',state:{current_event,recent_context,candidate_threads:E.clone(threads)},questions};
    }
    function planJob(run,job,threads,config,stage,schemaVersion) {
      const event=run.meeting_events.find(event=>event.event_id===job.event_id);
      if(!event)throw Error('Evento ausente: '+job.event_id);
      const candidates=threads.filter(thread=>thread.status===(stage==='active'?'active':'archived'));
      const prior=run.meeting_events.slice(0,run.meeting_events.indexOf(event));
      if(schemaVersion<3)return plan(eventFields(event),job.recent_context,candidates.map(thread=>hydrate(thread,prior)),config,stage);
      if(schemaVersion>=5) {
        // Semantic evidence only: a pending assignment is not a topic signal.
        // Each utterance appears once within its evidence collection. Keep full
        // thread histories, including the original problem, without duplicating
        // each event inside a nested chunk or exposing mutable routing status.
        const semantic=source=>({event_id:source.event_id,chunk_id:source.chunk_id,type:source.type,text:source.text});
        const byId=new Map(prior.map(source=>[source.event_id,source]));
        const expanded=candidates.map(thread=>({thread_id:thread.thread_id,events:thread.anchor_event_ids.map(id=>{
          const source=byId.get(id);if(!source)throw Error('Evento referenciado ausente: '+id);return semantic(source);
        })}));
        return plan(semantic(event),job.recent_context.map(id=>chunkFor(run,id)),expanded,config,stage);
      }
      // Resolve typed references from their own stores, never from a truncated
      // raw_window or a future assignment. IDs remain available as identity;
      // chunk/events carry the complete referenced values in the wire payload.
      const byId=new Map(prior.map(event=>[event.event_id,event]));
      const assignments=new Map(threads.flatMap(thread=>thread.anchor_event_ids.map(id=>[id,thread.thread_id])));
      const fullEvent=source=>{
        const thread_id=assignments.get(source.event_id) || null;
        return {...E.clone(source),thread_id,thread_assignment_state:thread_id?'assigned':'pending',chunk:chunkFor(run,source.chunk_id)};
      };
      const expanded=candidates.map(thread=>{
        const {anchor_event_ids,...fields}=thread;
        return {...E.clone(fields),events:anchor_event_ids.map(id=>{
          const source=byId.get(id);if(!source)throw Error('Evento referenciado ausente: '+id);
          return fullEvent(source);
        })};
      });
      return plan(fullEvent(event),job.recent_context.map(id=>chunkFor(run,id)),expanded,config,stage);
    }
    function checked(req) {
      E.validateConfig(req);E.validateState(req.state);
      if(new TextEncoder().encode(JSON.stringify(req)).length>64000)throw Error('A chamada excede 64 KB.');return req;
    }
    function plan(event,context,threads,config,stage) {
      const parts=[];let group=[];
      const flush=()=>{if(group.length){parts.push({stage,candidate_ids:group.map(t=>t.thread_id),request:checked(request(event,context,group,config,stage)),status:'queued'});group=[];}};
      for(const thread of threads) {
        try {checked(request(event,context,[...group,thread],config,stage));group.push(thread);}
        catch(_) {
          flush();
          try {checked(request(event,context,[thread],config,stage));group.push(thread);}
          catch(error){parts.push({stage,candidate_ids:[thread.thread_id],status:'error',error:'Thread '+thread.thread_id+' não enviada: '+error.message+' Nenhum anchor foi descartado.'});}
        }
      }
      flush();return parts;
    }
    const assignmentThreshold=.8;
    const answer=(part,id)=>part?.status==='done'?part.output?.response?.answers?.[id] || null:null;
    const activeAnswer=job=>answer(job.parts.find(part=>part.stage==='active'),'belongs_to_active_thread');
    // Use P(the chosen answer), never the API's separate confidence field.
    // Saved v1-v3 snapshots retain their original routing. New runs use v4.
    const confident=a=>!!a && E.probabilityOf(a,a.choice)>=assignmentThreshold;
    function shouldSearchArchives(job,schemaVersion=4) {
      const a=activeAnswer(job);
      if(schemaVersion>=4)return !(a?.choice==='belongs' && confident(a));
      return a?.choice==='does_not_belong' && (schemaVersion===1 || confident(a));
    }
    const pending=reason=>({thread_id:null,route:'pending',reason});
    function decide(job,threads,schemaVersion=4) {
      const active=threads.find(t=>t.status==='active');
      const create=()=>({thread_id:'T'+String(threads.length+1).padStart(3,'0'),route:'new',reason:active?'no_archive_match':'first_event'});
      if(schemaVersion>=4) {
        if(!threads.length)return create();
        const a=activeAnswer(job);
        if(active && a?.choice==='belongs' && confident(a))return {thread_id:active.thread_id,route:'active',reason:'belongs'};
        const archived=threads.filter(thread=>thread.status==='archived');
        const replies=archived.map(thread=>({thread,a:answer(job.parts.find(part=>part.stage==='archive' && part.candidate_ids.includes(thread.thread_id)),'belongs_to_archive_thread__'+thread.thread_id)}));
        const matches=replies.filter(({a})=>a?.choice==='belongs' && confident(a));
        if(matches.length>1)return pending('conflicting_archives');
        if(replies.some(({a})=>!a))return pending('missing_archive_response');
        if(replies.some(({a})=>!confident(a)))return pending('low_confidence_archive');
        const rejected=replies.filter(({a})=>a.choice==='does_not_belong' && confident(a));
        if(matches.length===1 && rejected.length===replies.length-1)return {thread_id:matches[0].thread.thread_id,route:'archive',reason:'reopened'};
        if(rejected.length!==replies.length)return pending('uncertain_archive');
        if(!active || !a)return pending('missing_active_response');
        if(!confident(a))return pending('low_confidence_active');
        if(a.choice!=='does_not_belong')return pending('uncertain_active');
        return create();
      }
      if(!active)return create();
      const a=activeAnswer(job),value=a?.choice;
      if(a && schemaVersion>=2 && !confident(a))return pending('low_confidence_active');
      if(value==='belongs')return {thread_id:active.thread_id,route:'active',reason:'belongs'};
      if(value!=='does_not_belong')return pending('uncertain_active');
      const archived=threads.filter(t=>t.status==='archived');
      if(!archived.length)return create();
      const matches=[],uncertain=[];let low=false;
      for(const thread of archived) {
        const part=job.parts.find(p=>p.stage==='archive'&&p.candidate_ids.includes(thread.thread_id));
        const a=answer(part,'belongs_to_archive_thread__'+thread.thread_id),value=a?.choice;
        if(a && schemaVersion>=2 && !confident(a))low=true;
        if(value==='belongs')matches.push(thread.thread_id);
        else if(value!=='does_not_belong')uncertain.push(thread.thread_id);
      }
      if(low)return pending('low_confidence_archive');
      if(matches.length>1)return pending('conflicting_archives');
      if(uncertain.length)return pending('uncertain_archive');
      return matches.length?{thread_id:matches[0],route:'archive',reason:'reopened'}:create();
    }
    function apply(threads,event,result,schemaVersion=3) {
      if(!result?.thread_id)return;
      let thread=threads.find(t=>t.thread_id===result.thread_id);
      if(result.route==='new') {
        if(thread || result.thread_id!=='T'+String(threads.length+1).padStart(3,'0'))throw Error('Sequência de threads inválida.');
        thread={thread_id:result.thread_id,status:'active',...(schemaVersion<3?{title:event.text}:{}),created_by_event_id:event.event_id,anchor_event_ids:[]};threads.push(thread);
      }
      if(!thread)throw Error('Thread atribuída ausente.');
      for(const item of threads)item.status=item===thread?'active':'archived';
      thread.anchor_event_ids.push(event.event_id);
    }
    function syncMemory(run) {
      const threads=[],byId=new Map(run.meeting_events.map(event=>[event.event_id,event]));
      for(const event of run.meeting_events){event.thread_id=null;if(run.thread_worker?.schemaVersion>=2)event.thread_assignment_state='pending';}
      for(const job of run.thread_worker?.jobs || []) {
        const event=byId.get(job.event_id);if(!event)throw Error('Evento de thread ausente.');
        if(job.status==='done'){apply(threads,event,job.result,run.thread_worker.schemaVersion);event.thread_id=job.result.thread_id;if(run.thread_worker.schemaVersion>=2)event.thread_assignment_state=event.thread_id?'assigned':'pending';}
      }
      run.meeting_threads=threads;
      if(!run.typed_relation_worker)run.meeting_relations=[];
    }
    function start(run,{config=defaults,version=null,schemaVersion=4,send,onChange=()=>{},now=Date.now,resume=false}) {
      if((run.thread_worker&&!resume) || run.relation_worker)throw Error('Crie uma nova rodada para atribuir threads.');
      if(![4,5].includes(schemaVersion))throw Error('Versão de threads inválida para nova execução.');
      const state=run.thread_worker=resume&&run.thread_worker?restore(run.thread_worker,run):{schemaVersion,config:validateConfig(config),version,status:'running',calls:0,jobs:[]};
      state.status='running';
      syncMemory(run);
      const queue=[],seen=new Set(state.jobs.map(job=>job.event_id));let working=false,halted=false,closed=false,resolveDone;
      const done=new Promise(resolve=>resolveDone=resolve),notify=()=>onChange(state);
      const finish=()=>{if(!working&&!queue.length&&(closed||halted)){state.status=halted?'stopped':'done';notify();resolveDone(state);}};
      function stop(){if(state.status!=='running')return;halted=true;for(const job of queue.splice(0)){job.status='interrupted';job.error='Atribuição interrompida; sem retomada automática.';}notify();finish();}
      async function consult(job,parts) {
        job.parts.push(...parts);notify();
        for(const part of parts) {
          if(halted)break;if(part.status==='error')continue;
          part.status='running';part.attempted=true;state.calls++;notify();
          try {const output=await send(E.clone(part.request),run.provider);E.validateOutput(output,{state:part.request.state,config:{model:part.request.model,questions:part.request.questions}});part.output=E.clone(output);part.status='done';}
          catch(error){part.status='error';part.error=error.message || 'Falha ao consultar thread.';if(error.stopBatch)stop();}
          notify();
        }
      }
      async function drain() {
        if(working||halted)return;working=true;
        try {
          while(queue.length&&!halted) {
            const job=queue.shift(),event=run.meeting_events.find(event=>event.event_id===job.event_id);
            job.status='running';job.startedAt=new Date(now()).toISOString();
            const threads=E.clone(run.meeting_threads);
            const active=threads.find(thread=>thread.status==='active');
            job.active_thread_id=active?.thread_id || null;
            if(active)await consult(job,planJob(run,job,threads,state.config,'active',state.schemaVersion));
            if(!halted && threads.some(thread=>thread.status==='archived') && shouldSearchArchives(job,state.schemaVersion))await consult(job,planJob(run,job,threads,state.config,'archive',state.schemaVersion));
            for(const part of job.parts)if(['queued','running'].includes(part.status))part.status='interrupted';
            const result=decide(job,threads,state.schemaVersion);
            if(job.parts.some(part=>part.status==='error') && (halted || result.route==='pending')){job.status='error';job.error='Não foi possível concluir a atribuição. Nenhuma thread foi inferida a partir do erro.';}
            else if(halted){job.status='interrupted';job.error='Atribuição interrompida.';}
            else {job.status='done';job.result=result;}
            job.finishedAt=new Date(now()).toISOString();syncMemory(run);notify();
          }
        }catch(error){state.error=error.message;for(const job of state.jobs)if(job.status==='running'){job.status='error';job.error=error.message;}stop();}
        finally{working=false;finish();}
      }
      function enqueue(event) {
        if(seen.has(event.event_id))return;
        const index=state.jobs.length;
        if(run.meeting_events[index]?.event_id!==event.event_id)throw Error('A fila de threads deve seguir a ordem de meeting_events.');
        seen.add(event.event_id);
        const job={event_id:event.event_id,chunk_id:event.chunk_id,recent_context:contextFor(run,event,state.schemaVersion),status:halted?'interrupted':'queued',parts:[],queuedAt:new Date(now()).toISOString()};
        state.jobs.push(job);if(!halted){queue.push(job);setTimeout(drain,0);}notify();
      }
      return {enqueue,stop,done,close(){closed=true;finish();},get pending(){return queue.map(job=>job.event_id);}};
    }
    function restore(saved,run) {
      if(!saved || ![1,2,3,4,5].includes(saved.schemaVersion) || !Array.isArray(saved.jobs) || !['running','done','stopped','interrupted'].includes(saved.status))throw Error('Worker de threads salvo inválido.');
      const state={...E.clone(saved),config:validateConfig(saved.config),status:saved.status==='running'?'interrupted':saved.status,jobs:[]};
      const threads=[];let calls=0;
      for(const [i,raw] of saved.jobs.entries()) {
        const event=run.meeting_events[i],job=E.clone(raw);
        if(!event || job.event_id!==event.event_id || job.chunk_id!==event.chunk_id || !Array.isArray(job.parts) || !['queued','running','done','error','interrupted'].includes(job.status) || !same(job.recent_context,contextFor(run,event,state.schemaVersion)))throw Error('Fila/contexto de threads inválido.');
        const active=threads.find(t=>t.status==='active');
        if(job.active_thread_id!==undefined && job.active_thread_id!==(active?.thread_id || null))throw Error('Thread ativa do snapshot inválida.');
        let planned=active?planJob(run,job,threads,state.config,'active',state.schemaVersion):[];
        if(shouldSearchArchives(job,state.schemaVersion))planned.push(...planJob(run,job,threads,state.config,'archive',state.schemaVersion));
        if(job.parts.length>planned.length || job.status==='done'&&job.parts.length!==planned.length)throw Error('Chamadas de threads incompletas ou inesperadas.');
        for(const [j,part] of job.parts.entries()) {
          const p=planned[j];
          if(part.stage!==p.stage || !same(part.candidate_ids,p.candidate_ids) || !same(part.request,p.request) || !['queued','running','done','error','interrupted'].includes(part.status))throw Error('Chamada de thread difere do snapshot.');
          if(part.status==='done'){if(!p.request)throw Error('Resposta inesperada.');E.validateOutput(part.output,{state:p.request.state,config:{model:p.request.model,questions:p.request.questions}});calls++;}
          else if(part.attempted || part.status==='running')calls++;
          if(part.status==='running')part.attempted=true;
          if(['queued','running'].includes(part.status))part.status='interrupted';
        }
        if(job.status==='done') {
          const result=decide(job,threads,state.schemaVersion);
          const recovered=state.schemaVersion>=4 && result.route==='archive' && job.parts.every(p=>p.status==='done' || p.stage==='active' && p.status==='error');
          if(job.parts.some(p=>p.status!=='done') && !recovered)throw Error('Atribuição concluída sem respostas válidas.');
          if(!same(job.result,result))throw Error('Atribuição de thread não corresponde às respostas.');
          apply(threads,event,result,state.schemaVersion);
        } else {delete job.result;if(['queued','running'].includes(job.status)){job.status='interrupted';job.error='Página recarregada; não houve retomada automática.';}}
        state.jobs.push(job);
      }
      if(!Number.isInteger(saved.calls) || saved.calls!==calls)throw Error('Contagem de chamadas de threads inválida.');
      return state;
    }
    function audit(run,job) {
      if(!job)return null;
      const event=run.meeting_events.find(e=>e.event_id===job.event_id),labels=run.batch.expected_threads || {};
      const hasExpected=Object.hasOwn(labels,event.chunk_id),raw=labels[event.chunk_id];
      const expectedSpec=!hasExpected?{}:raw===null || typeof raw==='string'?{expected_thread_id:raw}:raw;
      const hasThreadExpected=Object.hasOwn(expectedSpec,'expected_thread_id'),expected=hasThreadExpected?expectedSpec.expected_thread_id:null;
      const complete=job.status==='done',actual=complete?job.result.thread_id:null;
      const responses=job.parts.flatMap(part=>Object.entries(part.request?.questions || {}).map(([id,definition])=>{
        const a=answer(part,id),actual=a?E.predicted(a):null,probability=a?E.probabilityOf(a,actual):null;
        const target=part.stage==='active'?job.active_thread_id:id.slice('belongs_to_archive_thread__'.length);
        let wanted=null;
        if(part.stage==='active')wanted=expectedSpec.expected_active_result ?? (hasThreadExpected&&expected!==null?(expected===target?'belongs':'does_not_belong'):null);
        else if(Object.hasOwn(expectedSpec,'expected_archive_results'))wanted=expectedSpec.expected_archive_results[target] ?? null;
        else if(Object.hasOwn(expectedSpec,'expected_archive_match'))wanted=expectedSpec.expected_archive_match===target?(expectedSpec.expected_archive_result || 'belongs'):expectedSpec.expected_archive_match===null?(expectedSpec.expected_archive_result || 'does_not_belong'):'does_not_belong';
        else if(hasThreadExpected&&expected!==null)wanted=expected===target?'belongs':'does_not_belong';
        const match=wanted!==null&&a?actual===wanted:null;
        return {id,definition,part,target_thread_id:target,expected:wanted,actual,probability,matches:match,tone:part.status==='error'?'error':match===false?'fail':probability!==null&&probability<.8?'warning':match===true?'pass':''};
      }));
      const archive=responses.filter(r=>r.part.stage==='archive'),archiveMatches=archive.filter(r=>r.actual==='belongs').map(r=>r.target_thread_id);
      const action={new:'create_new_thread',archive:'reactivate_thread',active:'keep_active_thread',pending:'assignment_pending'}[job.result?.route] || null;
      const actuals={expected_thread_id:actual,expected_action:action,expected_active_thread_id:job.active_thread_id ?? null,expected_active_result:responses.find(r=>r.part.stage==='active')?.actual ?? null,
        expected_archive_results:Object.fromEntries(archive.map(r=>[r.target_thread_id,r.actual])),
        expected_archive_match:archiveMatches.length>1?archiveMatches:archiveMatches[0] || null,
        expected_archive_result:expectedSpec.expected_archive_match?archive.find(r=>r.target_thread_id===expectedSpec.expected_archive_match)?.actual ?? null:archive.length&&archive.every(r=>r.actual===expectedSpec.expected_archive_result)?expectedSpec.expected_archive_result:null};
      const checks=Object.entries(expectedSpec).map(([key,wanted])=>{
        const obtained=actuals[key];
        // Compare result maps by IDs, not JSON key order. An explicit empty map
        // expects no archived questions; missing/extra targets are divergences.
        const equal=key==='expected_archive_results'?Object.keys(wanted).length===Object.keys(obtained).length&&Object.entries(wanted).every(([id,value])=>Object.hasOwn(obtained,id)&&obtained[id]===value):same(wanted,obtained);
        return {key,expected:wanted,actual:obtained,matches:complete?equal:null};
      });
      const evaluated=[...checks.map(c=>c.matches),...responses.map(r=>r.matches)].filter(m=>m!==null);
      const matches=complete&&evaluated.length?evaluated.every(Boolean):null;
      const low=responses.some(r=>r.probability!==null&&r.probability<.8);
      return {event,job,hasExpected,hasThreadExpected,expectedSpec,expected,actual,action,matches,checks,responses,tone:job.status==='error'?'error':matches===false?'fail':job.status==='running'?'active':job.status==='done'&&low?'warning':matches===true?'pass':''};
    }
    return {defaults,currentConfig,assignmentThreshold,shouldSearchArchives,validateConfig,validateExpected,eventFields,chunkFor,contextFor,hydrate,request,plan,decide,syncMemory,start,restore,audit};
  }
  const api = { defaults, threshold, validateConfig, currentConfig, isFiltered, validateExpected, auditJob, combinedTone, candidatesFor, request, plan, scoresFor, relationsFor, start, restore, threads:threadAPI() };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NorteRelations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
