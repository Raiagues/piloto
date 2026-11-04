/* Assigns each meeting event to a discussion thread. Work IDs are a queue, not memory. */
(function (root) {
  const E = typeof module !== 'undefined' && module.exports ? require('./jev-answers.js') : root.NorteJevAnswers;
  const Q =
    typeof module !== 'undefined' && module.exports
      ? require('../../prompts/jev/questions.js')
      : root.NorteJevQuestions;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const choices = ['belongs', 'does_not_belong', 'uncertain'];
  const defaults = { questions: Q.threads };
  // Topic memory v6 asks one question: which recent topic current_event
  // belongs to, or whether it opens a new one. A return to an earlier subject
  // is an ordinary answer. Topic options are built per request from the topic memory.
  const topicOptions = 10,
    topicEvents = 5,
    topicThreshold = 0.6;
  const topicDefaults = { questions: Q.topics };
  function validateTopicConfig(value) {
    const config = value && Object.keys(value).join() === 'questions' ? value : { questions: value },
      q = config.questions?.topic_assignment;
    if (
      !q ||
      Object.keys(config.questions).join() !== 'topic_assignment' ||
      q.type !== 'choice' ||
      Object.keys(q.criteria || {})
        .sort()
        .join() !== 'new_topic,topic' ||
      !String(q.criteria.topic).includes('{{topic_id}}')
    )
      throw Error('Mantenha topic_assignment (choice) com os critérios topic e new_topic.');
    E.validateConfig({
      model: 'jev-latest',
      questions: { topic_assignment: { ...q, criteria: { T001: q.criteria.topic, new_topic: q.criteria.new_topic } } },
    });
    return E.clone(config);
  }
  const configFor = (value, schemaVersion) => (schemaVersion >= 6 ? validateTopicConfig(value) : validateConfig(value));
  const clip = (text, limit) => {
    const value = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    return value.length > limit ? value.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…' : value;
  };
  function topicRequest(run, event, context, threads, config) {
    const byId = new Map(run.meeting_events.map(item => [item.event_id, item])),
      position = new Map(run.meeting_events.map((item, index) => [item.event_id, index]));
    const latest = thread => position.get(thread.anchor_event_ids.at(-1));
    // The most recently discussed topics are offered, in creation order.
    const recent = new Set([...threads].sort((a, b) => latest(b) - latest(a)).slice(0, topicOptions)),
      offered = threads.filter(thread => recent.has(thread));
    const speakers = new Map(
      (run.transcript || [])
        .filter(entry => entry.chunk_id && entry.speaker)
        .map(entry => [entry.chunk_id, entry.speaker]),
    );
    const recent_context = context.map(id => {
      const chunk = chunkFor(run, id),
        speaker = speakers.get(id);
      return { chunk_id: id, ...(speaker ? { speaker: clip(speaker, 120) } : {}), text: clip(chunk.text, 400) };
    });
    const q = config.questions.topic_assignment,
      semantic = item => ({ event_id: item.event_id, type: item.type, text: clip(item.text, 240) });
    for (let size = topicEvents; size >= 1; size--) {
      const topics = offered.map(thread => {
        const ids = thread.anchor_event_ids,
          head = Math.min(2, size - 1),
          picked = ids.length <= size ? ids : [...ids.slice(0, head), ...ids.slice(ids.length - (size - head))];
        return {
          topic_id: thread.thread_id,
          event_count: ids.length,
          events: picked.map(id => semantic(byId.get(id))),
        };
      });
      const criteria = Object.fromEntries([
        ...offered.map(thread => {
          const first = byId.get(thread.anchor_event_ids[0]),
            last = byId.get(thread.anchor_event_ids.at(-1));
          const summary =
            '«' + clip(first.text, 140) + '»' + (last !== first ? ' … «' + clip(last.text, 140) + '»' : '');
          return [
            thread.thread_id,
            q.criteria.topic.replaceAll('{{topic_id}}', thread.thread_id).replaceAll('{{summary}}', summary),
          ];
        }),
        ['new_topic', q.criteria.new_topic],
      ]);
      const req = {
        model: 'jev-latest',
        state: {
          current_event: { ...semantic(event), text: clip(event.text, 1200) },
          recent_context,
          current_topic_id: threads.find(thread => thread.status === 'active')?.thread_id || null,
          topics,
        },
        questions: { topic_assignment: { type: 'choice', instructions: q.instructions, criteria } },
      };
      try {
        return checked(req);
      } catch (error) {
        if (size === 1) throw error;
      }
    }
  }
  function validateConfig(value) {
    const config = value && Object.keys(value).join() === 'questions' ? value : { questions: value };
    E.validateConfig({ model: 'jev-latest', questions: config.questions });
    if (
      Object.keys(config.questions).sort().join() !== 'belongs_to_active_thread,belongs_to_archive_thread' ||
      Object.values(config.questions).some(
        q => q.type !== 'choice' || Object.keys(q.criteria).sort().join() !== [...choices].sort().join(),
      )
    )
      throw Error(
        'Mantenha belongs_to_active_thread e belongs_to_archive_thread (choice), com belongs, does_not_belong e uncertain.',
      );
    return E.clone(config);
  }
  function validateExpected(value, cases) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw Error('expected_threads deve ser um objeto por ID de chunk.');
    const ids = new Set(cases.map(item => item.id));
    const fields = [
      'expected_action',
      'expected_thread_id',
      'expected_active_thread_id',
      'expected_active_result',
      'expected_archive_results',
      'expected_archive_match',
      'expected_archive_result',
    ];
    const validId = id => typeof id === 'string' && /^T\d{3,}$/.test(id);
    for (const [id, thread] of Object.entries(value)) {
      if (!ids.has(id)) throw Error('Chunk desconhecido em expected_threads: ' + id + '.');
      if (thread === null || validId(thread)) continue;
      if (!thread || typeof thread !== 'object' || Array.isArray(thread) || !Object.keys(thread).length)
        throw Error(id + ': use um objeto com os campos de expected_threads, um thread_id ou null.');
      const unknown = Object.keys(thread).filter(key => !fields.includes(key));
      if (unknown.length) throw Error(id + ': campo não reconhecido em expected_threads: ' + unknown.join(', ') + '.');
      for (const key of ['expected_thread_id', 'expected_active_thread_id', 'expected_archive_match'])
        if (Object.hasOwn(thread, key) && thread[key] !== null && !validId(thread[key]))
          throw Error(id + ': ' + key + ' deve ser um ID como T001 ou null.');
      for (const key of ['expected_active_result', 'expected_archive_result'])
        if (Object.hasOwn(thread, key) && !choices.includes(thread[key]))
          throw Error(id + ': ' + key + ' deve ser belongs, does_not_belong ou uncertain.');
      if (
        Object.hasOwn(thread, 'expected_action') &&
        ![
          'create_new_thread',
          'reactivate_thread',
          'keep_active_thread',
          'assign_active_thread',
          'assignment_pending',
        ].includes(thread.expected_action)
      )
        throw Error(
          id +
            ': expected_action deve ser create_new_thread, reactivate_thread, keep_active_thread ou assignment_pending.',
        );
      if (Object.hasOwn(thread, 'expected_archive_results')) {
        const results = thread.expected_archive_results;
        if (!results || typeof results !== 'object' || Array.isArray(results))
          throw Error(
            id +
              ': expected_archive_results deve ser um objeto de IDs de threads para belongs, does_not_belong ou uncertain; use {} quando nenhuma consulta é esperada.',
          );
        for (const [target, result] of Object.entries(results)) {
          if (!validId(target))
            throw Error(id + ': ID de thread inválido em expected_archive_results: ' + target + '.');
          if (!choices.includes(result))
            throw Error(
              id + ': expected_archive_results.' + target + ' deve ser belongs, does_not_belong ou uncertain.',
            );
        }
      }
      if (Object.hasOwn(thread, 'expected_archive_result') && !Object.hasOwn(thread, 'expected_archive_match'))
        throw Error(id + ': informe expected_archive_match para identificar a pergunta da thread arquivada.');
      if (thread.expected_archive_result === 'belongs' && thread.expected_archive_match === null)
        throw Error(id + ': belongs exige um expected_archive_match com ID de thread.');
    }
    return E.clone(value);
  }
  const eventFields = event =>
    Object.fromEntries(
      ['event_id', 'chunk_id', 'timestamp', 'type', 'text', 'status']
        .map(key => [key, event[key]])
        .filter(([, value]) => value !== undefined),
    );
  function chunkFor(run, id) {
    const record = run.records.find(record => record.id === id),
      item = run.batch.cases.find(item => item.id === id);
    if (!record || !item) throw Error('Chunk ausente: ' + id);
    const origin = Date.parse(run.startedAt || run.createdAt),
      arrival = Date.parse(record.startedAt || record.timestamp);
    const elapsed = Number.isFinite(record.receivedOffsetMs)
      ? record.receivedOffsetMs
      : Number.isFinite(arrival - origin)
        ? Math.max(0, arrival - origin)
        : 0;
    const seconds = Math.floor(Math.max(0, elapsed) / 1000);
    const timestamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
    return { chunk_id: id, timestamp, text: item.current_utterance };
  }
  function contextFor(run, event, schemaVersion = 3) {
    const index = run.records.findIndex(record => record.id === event.chunk_id);
    if (index < 0) throw Error('Evento sem chunk de origem.');
    // Snapshot at receipt: chunks that arrive during the backlog stay out.
    return run.records
      .slice(Math.max(0, index - (schemaVersion >= 6 ? 4 : schemaVersion >= 5 ? 8 : 5)), index)
      .map(record =>
        schemaVersion >= 3
          ? record.id
          : { chunk_id: record.id, text: run.batch.cases.find(item => item.id === record.id).current_utterance },
      );
  }
  function hydrate(thread, events) {
    const byId = new Map(events.map(event => [event.event_id, event]));
    return {
      ...E.clone(thread),
      anchors: thread.anchor_event_ids.map(id => {
        const event = byId.get(id);
        if (!event) throw Error('Anchor ausente: ' + id);
        return eventFields(event);
      }),
    };
  }
  function request(event, context, threads, config, stage) {
    const current_event = E.clone(event),
      recent_context = E.clone(context);
    if (stage === 'active')
      return {
        model: 'jev-latest',
        state: { current_event, recent_context, active_thread: E.clone(threads[0]) },
        questions: { belongs_to_active_thread: E.clone(config.questions.belongs_to_active_thread) },
      };
    const questions = Object.fromEntries(
      threads.map(thread => {
        const q = E.clone(config.questions.belongs_to_archive_thread);
        q.instructions =
          Q.threadCandidate.replace('{{thread_id}}', JSON.stringify(thread.thread_id)) + '\n' + q.instructions;
        return ['belongs_to_archive_thread__' + thread.thread_id, q];
      }),
    );
    return {
      model: 'jev-latest',
      state: { current_event, recent_context, candidate_threads: E.clone(threads) },
      questions,
    };
  }
  function planJob(run, job, threads, config, stage, schemaVersion) {
    const event = run.meeting_events.find(event => event.event_id === job.event_id);
    if (!event) throw Error('Evento ausente: ' + job.event_id);
    if (schemaVersion >= 6)
      return threads.length
        ? [
            {
              stage: 'topic',
              candidate_ids: threads.map(thread => thread.thread_id),
              request: topicRequest(run, event, job.recent_context, threads, config),
              status: 'queued',
            },
          ]
        : [];
    const candidates = threads.filter(thread => thread.status === (stage === 'active' ? 'active' : 'archived'));
    const prior = run.meeting_events.slice(0, run.meeting_events.indexOf(event));
    if (schemaVersion < 3)
      return plan(
        eventFields(event),
        job.recent_context,
        candidates.map(thread => hydrate(thread, prior)),
        config,
        stage,
      );
    if (schemaVersion >= 5) {
      // Semantic evidence only: a pending assignment is not a topic signal.
      // Each utterance appears once within its evidence collection. Keep full
      // thread histories, including the original problem, without duplicating
      // each event inside a nested chunk or exposing mutable routing status.
      const semantic = source => ({
        event_id: source.event_id,
        chunk_id: source.chunk_id,
        type: source.type,
        text: source.text,
      });
      const byId = new Map(prior.map(source => [source.event_id, source]));
      const expanded = candidates.map(thread => ({
        thread_id: thread.thread_id,
        events: thread.anchor_event_ids.map(id => {
          const source = byId.get(id);
          if (!source) throw Error('Evento referenciado ausente: ' + id);
          return semantic(source);
        }),
      }));
      return plan(
        semantic(event),
        job.recent_context.map(id => chunkFor(run, id)),
        expanded,
        config,
        stage,
      );
    }
    // Resolve typed references from their own stores, never from a truncated
    // raw_window or a future assignment. IDs remain available as identity;
    // chunk/events carry the complete referenced values in the wire payload.
    const byId = new Map(prior.map(event => [event.event_id, event]));
    const assignments = new Map(threads.flatMap(thread => thread.anchor_event_ids.map(id => [id, thread.thread_id])));
    const fullEvent = source => {
      const thread_id = assignments.get(source.event_id) || null;
      return {
        ...E.clone(source),
        thread_id,
        thread_assignment_state: thread_id ? 'assigned' : 'pending',
        chunk: chunkFor(run, source.chunk_id),
      };
    };
    const expanded = candidates.map(thread => {
      const { anchor_event_ids, ...fields } = thread;
      return {
        ...E.clone(fields),
        events: anchor_event_ids.map(id => {
          const source = byId.get(id);
          if (!source) throw Error('Evento referenciado ausente: ' + id);
          return fullEvent(source);
        }),
      };
    });
    return plan(
      fullEvent(event),
      job.recent_context.map(id => chunkFor(run, id)),
      expanded,
      config,
      stage,
    );
  }
  function checked(req) {
    E.validateConfig(req);
    E.validateState(req.state);
    if (new TextEncoder().encode(JSON.stringify(req)).length > 64000) throw Error('A chamada excede 64 KB.');
    return req;
  }
  function plan(event, context, threads, config, stage) {
    const parts = [];
    let group = [];
    const flush = () => {
      if (group.length) {
        parts.push({
          stage,
          candidate_ids: group.map(t => t.thread_id),
          request: checked(request(event, context, group, config, stage)),
          status: 'queued',
        });
        group = [];
      }
    };
    for (const thread of threads) {
      try {
        checked(request(event, context, [...group, thread], config, stage));
        group.push(thread);
      } catch (_) {
        flush();
        try {
          checked(request(event, context, [thread], config, stage));
          group.push(thread);
        } catch (error) {
          parts.push({
            stage,
            candidate_ids: [thread.thread_id],
            status: 'error',
            error: 'Thread ' + thread.thread_id + ' não enviada: ' + error.message + ' Nenhum anchor foi descartado.',
          });
        }
      }
    }
    flush();
    return parts;
  }
  const assignmentThreshold = 0.8;
  const answer = (part, id) => (part?.status === 'done' ? part.output?.response?.answers?.[id] || null : null);
  const activeAnswer = job =>
    answer(
      job.parts.find(part => part.stage === 'active'),
      'belongs_to_active_thread',
    );
  // Uses P(the chosen answer), not the API's separate confidence field.
  // Saved v1-v3 snapshots retain their original routing. New runs use v4.
  const confident = a => !!a && E.probabilityOf(a, a.choice) >= assignmentThreshold;
  function shouldSearchArchives(job, schemaVersion = 4) {
    const a = activeAnswer(job);
    if (schemaVersion >= 4) return !(a?.choice === 'belongs' && confident(a));
    return a?.choice === 'does_not_belong' && (schemaVersion === 1 || confident(a));
  }
  const pending = reason => ({ thread_id: null, route: 'pending', reason });
  function decide(job, threads, schemaVersion = 4) {
    const active = threads.find(t => t.status === 'active');
    const create = () => ({
      thread_id: 'T' + String(threads.length + 1).padStart(3, '0'),
      route: 'new',
      reason: active ? (schemaVersion >= 6 ? 'new_topic' : 'no_archive_match') : 'first_event',
    });
    if (schemaVersion >= 6) {
      if (!threads.length) return create();
      const a = answer(
        job.parts.find(part => part.stage === 'topic'),
        'topic_assignment',
      );
      if (!a) return pending('missing_topic_response');
      const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)),
        best = ranked.find(([id]) => id !== 'new_topic');
      // A new topic needs a clear signal; otherwise conversational continuity
      // keeps the event in its most likely topic, marked as tentative.
      if (ranked[0][0] === 'new_topic' && (ranked[0][1] >= 0.5 || !best)) return create();
      const [id, probability] = ranked[0][0] === 'new_topic' ? best : ranked[0];
      return {
        thread_id: id,
        route: id === active?.thread_id ? 'active' : 'archive',
        reason: ranked[0][0] === id && probability >= topicThreshold ? 'belongs' : 'tentative',
      };
    }
    if (schemaVersion >= 4) {
      if (!threads.length) return create();
      const a = activeAnswer(job);
      if (active && a?.choice === 'belongs' && confident(a))
        return { thread_id: active.thread_id, route: 'active', reason: 'belongs' };
      const archived = threads.filter(thread => thread.status === 'archived');
      const replies = archived.map(thread => ({
        thread,
        a: answer(
          job.parts.find(part => part.stage === 'archive' && part.candidate_ids.includes(thread.thread_id)),
          'belongs_to_archive_thread__' + thread.thread_id,
        ),
      }));
      const matches = replies.filter(({ a }) => a?.choice === 'belongs' && confident(a));
      if (matches.length > 1) return pending('conflicting_archives');
      if (replies.some(({ a }) => !a)) return pending('missing_archive_response');
      if (replies.some(({ a }) => !confident(a))) return pending('low_confidence_archive');
      const rejected = replies.filter(({ a }) => a.choice === 'does_not_belong' && confident(a));
      if (matches.length === 1 && rejected.length === replies.length - 1)
        return { thread_id: matches[0].thread.thread_id, route: 'archive', reason: 'reopened' };
      if (rejected.length !== replies.length) return pending('uncertain_archive');
      if (!active || !a) return pending('missing_active_response');
      if (!confident(a)) return pending('low_confidence_active');
      if (a.choice !== 'does_not_belong') return pending('uncertain_active');
      return create();
    }
    if (!active) return create();
    const a = activeAnswer(job),
      value = a?.choice;
    if (a && schemaVersion >= 2 && !confident(a)) return pending('low_confidence_active');
    if (value === 'belongs') return { thread_id: active.thread_id, route: 'active', reason: 'belongs' };
    if (value !== 'does_not_belong') return pending('uncertain_active');
    const archived = threads.filter(t => t.status === 'archived');
    if (!archived.length) return create();
    const matches = [],
      uncertain = [];
    let low = false;
    for (const thread of archived) {
      const part = job.parts.find(p => p.stage === 'archive' && p.candidate_ids.includes(thread.thread_id));
      const a = answer(part, 'belongs_to_archive_thread__' + thread.thread_id),
        value = a?.choice;
      if (a && schemaVersion >= 2 && !confident(a)) low = true;
      if (value === 'belongs') matches.push(thread.thread_id);
      else if (value !== 'does_not_belong') uncertain.push(thread.thread_id);
    }
    if (low) return pending('low_confidence_archive');
    if (matches.length > 1) return pending('conflicting_archives');
    if (uncertain.length) return pending('uncertain_archive');
    return matches.length ? { thread_id: matches[0], route: 'archive', reason: 'reopened' } : create();
  }
  function apply(threads, event, result, schemaVersion = 3) {
    if (!result?.thread_id) return;
    let thread = threads.find(t => t.thread_id === result.thread_id);
    if (result.route === 'new') {
      if (thread || result.thread_id !== 'T' + String(threads.length + 1).padStart(3, '0'))
        throw Error('Sequência de threads inválida.');
      thread = {
        thread_id: result.thread_id,
        status: 'active',
        ...(schemaVersion < 3 ? { title: event.text } : {}),
        created_by_event_id: event.event_id,
        anchor_event_ids: [],
      };
      threads.push(thread);
    }
    if (!thread) throw Error('Thread atribuída ausente.');
    for (const item of threads) item.status = item === thread ? 'active' : 'archived';
    thread.anchor_event_ids.push(event.event_id);
  }
  function syncMemory(run) {
    const threads = [],
      byId = new Map(run.meeting_events.map(event => [event.event_id, event]));
    for (const event of run.meeting_events) {
      event.thread_id = null;
      if (run.thread_worker?.schemaVersion >= 2) event.thread_assignment_state = 'pending';
    }
    for (const job of run.thread_worker?.jobs || []) {
      const event = byId.get(job.event_id);
      if (!event) throw Error('Evento de thread ausente.');
      if (job.status === 'done') {
        apply(threads, event, job.result, run.thread_worker.schemaVersion);
        event.thread_id = job.result.thread_id;
        if (run.thread_worker.schemaVersion >= 2)
          event.thread_assignment_state = !event.thread_id
            ? 'pending'
            : job.result.reason === 'tentative'
              ? 'tentative'
              : 'assigned';
      }
    }
    run.meeting_threads = threads;
    if (!run.typed_relation_worker) run.meeting_relations = [];
  }
  function start(
    run,
    { config = defaults, version = null, schemaVersion = 4, send, onChange = () => {}, now = Date.now, resume = false },
  ) {
    if ((run.thread_worker && !resume) || run.relation_worker)
      throw Error('Crie uma nova rodada para atribuir threads.');
    if (![4, 5, 6].includes(schemaVersion)) throw Error('Versão de threads inválida para nova execução.');
    const state = (run.thread_worker =
      resume && run.thread_worker
        ? restore(run.thread_worker, run)
        : {
            schemaVersion,
            config: configFor(schemaVersion >= 6 && config === defaults ? topicDefaults : config, schemaVersion),
            version,
            status: 'running',
            calls: 0,
            jobs: [],
          });
    state.status = 'running';
    syncMemory(run);
    const queue = [],
      seen = new Set(state.jobs.map(job => job.event_id));
    let working = false,
      halted = false,
      closed = false,
      resolveDone;
    const done = new Promise(resolve => (resolveDone = resolve)),
      notify = () => onChange(state);
    const finish = () => {
      if (!working && !queue.length && (closed || halted)) {
        state.status = halted ? 'stopped' : 'done';
        notify();
        resolveDone(state);
      }
    };
    function stop() {
      if (state.status !== 'running') return;
      halted = true;
      for (const job of queue.splice(0)) {
        job.status = 'interrupted';
        job.error = 'Atribuição interrompida; sem retomada automática.';
      }
      notify();
      finish();
    }
    async function consult(job, parts) {
      job.parts.push(...parts);
      notify();
      for (const part of parts) {
        if (halted) break;
        if (part.status === 'error') continue;
        part.status = 'running';
        part.attempted = true;
        state.calls++;
        notify();
        try {
          const output = await send(E.clone(part.request), run.provider);
          E.validateOutput(output, {
            state: part.request.state,
            config: { model: part.request.model, questions: part.request.questions },
          });
          part.output = E.clone(output);
          part.status = 'done';
        } catch (error) {
          part.status = 'error';
          part.error = error.message || 'Falha ao consultar thread.';
          if (error.stopBatch) stop();
        }
        notify();
      }
    }
    async function drain() {
      if (working || halted) return;
      working = true;
      try {
        while (queue.length && !halted) {
          const job = queue.shift();
          job.status = 'running';
          job.startedAt = new Date(now()).toISOString();
          const threads = E.clone(run.meeting_threads);
          const active = threads.find(thread => thread.status === 'active');
          job.active_thread_id = active?.thread_id || null;
          if (state.schemaVersion >= 6) {
            if (threads.length)
              await consult(job, planJob(run, job, threads, state.config, 'topic', state.schemaVersion));
          } else {
            if (active) await consult(job, planJob(run, job, threads, state.config, 'active', state.schemaVersion));
            if (
              !halted &&
              threads.some(thread => thread.status === 'archived') &&
              shouldSearchArchives(job, state.schemaVersion)
            )
              await consult(job, planJob(run, job, threads, state.config, 'archive', state.schemaVersion));
          }
          for (const part of job.parts) if (['queued', 'running'].includes(part.status)) part.status = 'interrupted';
          const result = decide(job, threads, state.schemaVersion);
          if (job.parts.some(part => part.status === 'error') && (halted || result.route === 'pending')) {
            job.status = 'error';
            job.error = 'Não foi possível concluir a atribuição. Nenhuma thread foi inferida a partir do erro.';
          } else if (halted) {
            job.status = 'interrupted';
            job.error = 'Atribuição interrompida.';
          } else {
            job.status = 'done';
            job.result = result;
          }
          job.finishedAt = new Date(now()).toISOString();
          syncMemory(run);
          notify();
        }
      } catch (error) {
        state.error = error.message;
        for (const job of state.jobs)
          if (job.status === 'running') {
            job.status = 'error';
            job.error = error.message;
          }
        stop();
      } finally {
        working = false;
        finish();
      }
    }
    function enqueue(event) {
      if (seen.has(event.event_id)) return;
      const index = state.jobs.length;
      if (run.meeting_events[index]?.event_id !== event.event_id)
        throw Error('A fila de threads deve seguir a ordem de meeting_events.');
      seen.add(event.event_id);
      const job = {
        event_id: event.event_id,
        chunk_id: event.chunk_id,
        recent_context: contextFor(run, event, state.schemaVersion),
        status: halted ? 'interrupted' : 'queued',
        parts: [],
        queuedAt: new Date(now()).toISOString(),
      };
      state.jobs.push(job);
      if (!halted) {
        queue.push(job);
        setTimeout(drain, 0);
      }
      notify();
    }
    return {
      enqueue,
      stop,
      done,
      close() {
        closed = true;
        finish();
      },
      get pending() {
        return queue.map(job => job.event_id);
      },
    };
  }
  function restore(saved, run) {
    if (
      !saved ||
      ![1, 2, 3, 4, 5, 6].includes(saved.schemaVersion) ||
      !Array.isArray(saved.jobs) ||
      !['running', 'done', 'stopped', 'interrupted'].includes(saved.status)
    )
      throw Error('Worker de threads salvo inválido.');
    const state = {
      ...E.clone(saved),
      config: configFor(saved.config, saved.schemaVersion),
      status: saved.status === 'running' ? 'interrupted' : saved.status,
      jobs: [],
    };
    const threads = [];
    let calls = 0;
    for (const [i, raw] of saved.jobs.entries()) {
      const event = run.meeting_events[i],
        job = E.clone(raw);
      if (
        !event ||
        job.event_id !== event.event_id ||
        job.chunk_id !== event.chunk_id ||
        !Array.isArray(job.parts) ||
        !['queued', 'running', 'done', 'error', 'interrupted'].includes(job.status) ||
        !same(job.recent_context, contextFor(run, event, state.schemaVersion))
      )
        throw Error('Fila/contexto de threads inválido.');
      const active = threads.find(t => t.status === 'active');
      if (job.active_thread_id !== undefined && job.active_thread_id !== (active?.thread_id || null))
        throw Error('Thread ativa do snapshot inválida.');
      let planned =
        state.schemaVersion >= 6
          ? planJob(run, job, threads, state.config, 'topic', state.schemaVersion)
          : active
            ? planJob(run, job, threads, state.config, 'active', state.schemaVersion)
            : [];
      if (state.schemaVersion < 6 && shouldSearchArchives(job, state.schemaVersion))
        planned.push(...planJob(run, job, threads, state.config, 'archive', state.schemaVersion));
      if (job.parts.length > planned.length || (job.status === 'done' && job.parts.length !== planned.length))
        throw Error('Chamadas de threads incompletas ou inesperadas.');
      for (const [j, part] of job.parts.entries()) {
        const p = planned[j];
        if (
          part.stage !== p.stage ||
          !same(part.candidate_ids, p.candidate_ids) ||
          !same(part.request, p.request) ||
          !['queued', 'running', 'done', 'error', 'interrupted'].includes(part.status)
        )
          throw Error('Chamada de thread difere do snapshot.');
        if (part.status === 'done') {
          if (!p.request) throw Error('Resposta inesperada.');
          E.validateOutput(part.output, {
            state: p.request.state,
            config: { model: p.request.model, questions: p.request.questions },
          });
          calls++;
        } else if (part.attempted || part.status === 'running') calls++;
        if (part.status === 'running') part.attempted = true;
        if (['queued', 'running'].includes(part.status)) part.status = 'interrupted';
      }
      if (job.status === 'done') {
        const result = decide(job, threads, state.schemaVersion);
        const recovered =
          state.schemaVersion >= 4 &&
          result.route === 'archive' &&
          job.parts.every(p => p.status === 'done' || (p.stage === 'active' && p.status === 'error'));
        if (job.parts.some(p => p.status !== 'done') && !recovered)
          throw Error('Atribuição concluída sem respostas válidas.');
        if (!same(job.result, result)) throw Error('Atribuição de thread não corresponde às respostas.');
        apply(threads, event, result, state.schemaVersion);
      } else {
        delete job.result;
        if (['queued', 'running'].includes(job.status)) {
          job.status = 'interrupted';
          job.error = 'Página recarregada; não houve retomada automática.';
        }
      }
      state.jobs.push(job);
    }
    if (!Number.isInteger(saved.calls) || saved.calls !== calls)
      throw Error('Contagem de chamadas de threads inválida.');
    return state;
  }
  function audit(run, job) {
    if (!job) return null;
    const event = run.meeting_events.find(e => e.event_id === job.event_id),
      labels = run.batch.expected_threads || {};
    const hasExpected = Object.hasOwn(labels, event.chunk_id),
      raw = labels[event.chunk_id];
    const expectedSpec = !hasExpected
      ? {}
      : raw === null || typeof raw === 'string'
        ? { expected_thread_id: raw }
        : raw;
    const hasThreadExpected = Object.hasOwn(expectedSpec, 'expected_thread_id'),
      expected = hasThreadExpected ? expectedSpec.expected_thread_id : null;
    const complete = job.status === 'done',
      actual = complete ? job.result.thread_id : null;
    const responses = job.parts.flatMap(part =>
      Object.entries(part.request?.questions || {}).map(([id, definition]) => {
        const a = answer(part, id),
          actual = a ? E.predicted(a) : null,
          probability = a ? E.probabilityOf(a, actual) : null;
        const target =
          part.stage === 'topic'
            ? actual
            : part.stage === 'active'
              ? job.active_thread_id
              : id.slice('belongs_to_archive_thread__'.length);
        let wanted = null;
        if (part.stage === 'active')
          wanted =
            expectedSpec.expected_active_result ??
            (hasThreadExpected && expected !== null ? (expected === target ? 'belongs' : 'does_not_belong') : null);
        else if (Object.hasOwn(expectedSpec, 'expected_archive_results'))
          wanted = expectedSpec.expected_archive_results[target] ?? null;
        else if (Object.hasOwn(expectedSpec, 'expected_archive_match'))
          wanted =
            expectedSpec.expected_archive_match === target
              ? expectedSpec.expected_archive_result || 'belongs'
              : expectedSpec.expected_archive_match === null
                ? expectedSpec.expected_archive_result || 'does_not_belong'
                : 'does_not_belong';
        else if (hasThreadExpected && expected !== null) wanted = expected === target ? 'belongs' : 'does_not_belong';
        const match = wanted !== null && a ? actual === wanted : null;
        return {
          id,
          definition,
          part,
          target_thread_id: target,
          expected: wanted,
          actual,
          probability,
          matches: match,
          tone:
            part.status === 'error'
              ? 'error'
              : match === false
                ? 'fail'
                : probability !== null && probability < 0.8
                  ? 'warning'
                  : match === true
                    ? 'pass'
                    : '',
        };
      }),
    );
    const archive = responses.filter(r => r.part.stage === 'archive'),
      archiveMatches = archive.filter(r => r.actual === 'belongs').map(r => r.target_thread_id);
    const action =
      {
        new: 'create_new_thread',
        archive: 'reactivate_thread',
        active: 'keep_active_thread',
        pending: 'assignment_pending',
      }[job.result?.route] || null;
    const actuals = {
      expected_thread_id: actual,
      expected_action: action,
      expected_active_thread_id: job.active_thread_id ?? null,
      expected_active_result: responses.find(r => r.part.stage === 'active')?.actual ?? null,
      expected_archive_results: Object.fromEntries(archive.map(r => [r.target_thread_id, r.actual])),
      expected_archive_match: archiveMatches.length > 1 ? archiveMatches : archiveMatches[0] || null,
      expected_archive_result: expectedSpec.expected_archive_match
        ? (archive.find(r => r.target_thread_id === expectedSpec.expected_archive_match)?.actual ?? null)
        : archive.length && archive.every(r => r.actual === expectedSpec.expected_archive_result)
          ? expectedSpec.expected_archive_result
          : null,
    };
    const checks = Object.entries(expectedSpec).map(([key, wanted]) => {
      const obtained = actuals[key];
      // Compare result maps by IDs, not JSON key order. An explicit empty map
      // expects no archived questions; missing/extra targets are divergences.
      const equal =
        key === 'expected_archive_results'
          ? Object.keys(wanted).length === Object.keys(obtained).length &&
            Object.entries(wanted).every(([id, value]) => Object.hasOwn(obtained, id) && obtained[id] === value)
          : same(wanted, obtained);
      return { key, expected: wanted, actual: obtained, matches: complete ? equal : null };
    });
    const evaluated = [...checks.map(c => c.matches), ...responses.map(r => r.matches)].filter(m => m !== null);
    const matches = complete && evaluated.length ? evaluated.every(Boolean) : null;
    const low = responses.some(r => r.probability !== null && r.probability < 0.8);
    return {
      event,
      job,
      hasExpected,
      hasThreadExpected,
      expectedSpec,
      expected,
      actual,
      action,
      matches,
      checks,
      responses,
      tone:
        job.status === 'error'
          ? 'error'
          : matches === false
            ? 'fail'
            : job.status === 'running'
              ? 'active'
              : job.status === 'done' && low
                ? 'warning'
                : matches === true
                  ? 'pass'
                  : '',
    };
  }
  const api = {
    defaults,
    topicDefaults,
    assignmentThreshold,
    shouldSearchArchives,
    validateConfig,
    validateExpected,
    chunkFor,
    request,
    plan,
    decide,
    syncMemory,
    start,
    restore,
    audit,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NorteThreads = api;
})(globalThis);
