/* An additional page inside the existing Norte shell. Dependencies load on first visit. */
(function () {
  let boot;
  function openPage() {
    if (boot) return boot;
    boot = (async function () {
      const dependencies = [
        ['NorteMemoryStorage', 'memory-storage.js?v=20261015-2'],
        ['NorteTypedRelations', 'typed-relations.js?v=20261015-2'],
        ['NorteMeetingCommands', 'meeting-commands.js?v=20261015-2'],
        ['NorteMeetingSession', 'meeting-session.js?v=20261015-2'],
        ['NorteMeetingSpeech', 'meeting-speech.js?v=20261015-2'],
        ['NorteMeetingEvidence', 'meeting-evidence.js?v=20261015-2'],
        ['NorteMeetingState', 'meeting-state.js?v=20261015-2'],
        ['NorteMeetingReview', 'meeting-review.js?v=20261015-2'],
        ['NorteMeetingHierarchy', 'meeting-hierarchy.js?v=20261015-2'],
        ['NorteMeetingBlocks', 'meeting-blocks.js?v=20261016-ux1'],
        ['NorteMeetingCanvas', 'meeting-canvas.js?v=20261016-ux1'],
        ['NorteMinutes', 'meeting-minutes.js?v=20261015-2'],
        ['NorteMeetingAmendments', 'meeting-amendments.js?v=20261015-2'],
        ['NorteMeetingDocument', 'meeting-document.js?v=20261015-2'],
        ['NorteMinutesEditor', 'minutes-editor.js?v=20261016-ux1'],
        ['NorteMeetingNotes', 'meeting-notes.js?v=20261103-1'],
        ['NorteMeetingHighlights', 'meeting-highlights.js?v=20261103-2'],
        ['NorteMeetingAlerts', 'meeting-alerts.js?v=20261103-1'],
        ['NorteLiveMinutes', 'meeting-live-minutes.js?v=20261103-1'],
      ];
      // Signed in: meetings live in the account (server database) instead of this browser.
      if (document.body.dataset.auth === 'on')
        dependencies.push(['NorteRemoteStorage', 'remote-storage.js?v=20261015-2']);
      // Fetch together; evaluate in dependency order below.
      for (const [name, file] of dependencies) {
        if (!window[name]) {
          const link = document.createElement('link');
          link.rel = 'modulepreload';
          link.href = new URL(file, document.baseURI).href;
          document.head.append(link);
        }
      }
      for (const [name, file] of dependencies) {
        if (!window[name]) await import('./' + file);
        if (!window[name]) throw Error('Não foi possível carregar a página de reunião.');
      }
      await initialize();
    })().catch(error => {
      boot = null;
      for (const id of ['roomNotice', 'roomLibraryNotice']) {
        const notice = document.getElementById(id);
        if (notice) {
          notice.hidden = false;
          notice.textContent = error.message + ' Reabra esta página para tentar novamente.';
        }
      }
    });
    return boot;
  }
  window.addEventListener('norte:page-changed', event => {
    if (['meeting'].includes(event.detail.page)) openPage();
  });
  if (['meeting'].includes(document.body.dataset.page)) openPage();
  async function initialize() {
    'use strict';
    const $ = id => document.getElementById(id),
      Session = NorteMeetingSession;
    const integrated = window.NorteMeetingBridge || null,
      canWrite = () => !integrated || integrated.canWrite();
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const button = (label, fn, cls = 'compact-button') => {
      const n = el('button', cls, label);
      n.type = 'button';
      n.onclick = fn;
      return n;
    };
    let editorSettled = null,
      minutesProgress = '';
    let current = null,
      controller = null,
      mode = null,
      ready = false,
      provider = 'official',
      starting = false,
      closing = false,
      renaming = null,
      db = null,
      saveTimer = null,
      saveQueue = Promise.resolve(),
      renderFrame = 0,
      lastTranscript = '',
      history = [],
      view = 'library',
      initialized = false;
    let recognition = null,
      listening = false,
      micPaused = false,
      ledger = null,
      consumed = new Set(),
      micEnd = null,
      restartTimer = null,
      micStopping = false,
      stopPromise = null;
    let recognitionWindow = null,
      recognitionDeadline = null;
    let savesPending = 0,
      persistedSnapshot = null;
    let pendingContributions = [],
      pendingTyped = null,
      notes = [],
      notesStore = null,
      boardView = 'canvas';
    const roomKind = () => 'meeting';
    const INDEX = 'norte.meeting-room.index.v2';
    const inAccount = document.body.dataset.auth === 'on',
      savedWhere = inAccount ? 'na sua conta' : 'no navegador';
    const saveKey = id => 'norte.meeting-room.session.v2.' + id;
    const cleanError = e =>
      String(e?.message || e || 'Não foi possível concluir a operação.').replace(
        /Gemini(?: Pro)?|OpenAI|TypeSafe|Jev(?: oficial)?/gi,
        'serviço',
      );
    // Canvas and minutes are corrected only after the meeting ends; while it runs the record follows the transcript alone.
    const meetingEnded = () => !!current && !isRunning() && !['draft', 'running', 'finishing'].includes(current.status);
    const canCorrect = () => canWrite() && meetingEnded();
    const canvas = NorteMeetingCanvas.create({
      canvas: $('roomCanvas'),
      board: $('roomBoard'),
      onRename: renameTopic,
      onInspect: inspectEvidence,
      canEdit: canCorrect,
      onReview: (kind, id) => {
        if (canCorrect()) blockAgents?.edit(kind, id);
      },
    });
    const blockStatus = el('small', 'room-block-status');
    blockStatus.setAttribute('role', 'status');
    $('roomSave').parentElement.append(blockStatus);
    // Notes and titles are written in the background after each save of a running
    // meeting; the server keeps going topic by topic. There is no manual trigger.
    const blockAgents = canWrite()
      ? NorteMeetingBlocks.create({
          automatic: inAccount,
          getRun: () => (canWrite() ? current : null),
          onUpdate: () => render(),
          onSave: save,
          onStatus: status => {
            document.body.dataset.editorial = status;
            if (!['pending', 'waiting'].includes(status)) editorSettled?.();
            blockStatus.textContent =
              {
                pending: 'Organizando tópicos…',
                waiting: 'Organizando tópicos…',
                disabled: 'Organização automática desativada',
                error: 'Organização indisponível; falas preservadas',
              }[status] || '';
          },
        })
      : null;
    const clock = ms => {
      const seconds = Math.floor(Math.max(0, ms || 0) / 1000),
        pad = value => String(value).padStart(2, '0'),
        minutes = pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
      return seconds >= 3600 ? Math.floor(seconds / 3600) + ':' + minutes : minutes;
    };
    const alerts = NorteMeetingAlerts.create({
      el,
      button,
      clock,
      host: $('roomAlertsHost'),
      cleanError,
      meetingEnded,
      canCorrect,
      get current() {
        return current;
      },
      get provider() {
        return provider;
      },
      turns: () => transcriptTurns(),
      monitoring: () => canWrite() && !!controller,
      // Live sessions warn on the meeting clock; an imported transcript has no clock of its own.
      elapsed: () => (mode === 'import' || !current?.startedAt ? null : elapsed()),
      projectStatements: async () => (await integrated?.projectStatements?.()) || [],
      boardView: () => boardView,
      meetingState: () => canvas.getProjection()?.state || (current ? NorteMeetingState.build(current) : null),
      refreshTranscript: () => renderTranscript(),
      render: () => render(),
      save: () => save(),
      saveSoon: () => saveSoon(),
      notice: message => notice(message),
      showBoard: next => showBoard(next),
      focusTurn: key => focusTurn(key),
      focusEntry: (id, topicId) => focusEntry(id, topicId),
      inspect: detail => inspectEvidence(detail),
      topicName: (id, state) => topicName(id, state),
    });
    function notice(message = '') {
      for (const id of ['roomNotice', 'roomLibraryNotice']) {
        const target = $(id);
        if (target) {
          target.textContent = message;
          target.hidden = !message;
        }
      }
    }
    async function checkHealth() {
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
        const data = await r.json();
        ready = !!data.ready;
        provider = data.provider || 'official';
        if (!ready) notice('A conexão de processamento não está pronta. Confira o serviço antes de começar.');
      } catch (_) {
        ready = false;
        notice('Não foi possível conectar. Verifique se o serviço está aberto.');
      }
      controls();
      return ready;
    }
    async function send(request, requestProvider, lane) {
      const classifier = window.NorteClassifier;
      try {
        if (lane === 'threads') return await classifier.requestRelation(request, requestProvider);
        if (lane === 'relations') return await classifier.requestTypedRelation(request, requestProvider);
        return await classifier.requestTest(request, requestProvider);
      } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'TypeError')
          throw Object.assign(
            Error('A conexão de processamento foi interrompida. As falas recebidas foram preservadas.'),
            { stopBatch: true },
          );
        throw error;
      }
    }
    function saveSoon() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(), 250);
    }
    function save() {
      clearTimeout(saveTimer);
      if (integrated && !canWrite()) return Promise.resolve(!integrated.host);
      if (!current) return saveQueue.then(() => true);
      if (!db) {
        notice('Não foi possível salvar ' + savedWhere + '. A reunião continuará aberta para você baixar a ata.');
        return Promise.resolve(false);
      }
      const snapshot = JSON.stringify(current),
        item = {
          id: current.id,
          title: current.title,
          date: current.createdAt,
          startedAt: current.startedAt,
          status: current.status,
          points: current.meeting_events.length,
          room_kind: current.room_kind || 'meeting',
        };
      if (!savesPending && snapshot === persistedSnapshot) return saveQueue.then(() => true);
      $('roomSave').textContent = 'Salvando…';
      savesPending++;
      saveQueue = saveQueue
        .catch(() => {})
        .then(async () => {
          await db.write(saveKey(item.id), snapshot);
          history = await db.change(INDEX, raw => {
            let list = raw ? JSON.parse(raw) : [];
            list = [item, ...list.filter(x => x.id !== item.id)].sort(
              (a, b) => Date.parse(b.date) - Date.parse(a.date),
            );
            return { value: JSON.stringify(list), result: list };
          });
          renderLibrary();
          $('roomSave').textContent = inAccount ? 'Salvo na sua conta' : 'Salvo neste navegador';
          if (current?.id === item.id) {
            persistedSnapshot = snapshot;
            blockAgents?.saved(current);
          }
          return true;
        })
        .catch(error => {
          if (current?.id === item.id) persistedSnapshot = null;
          $('roomSave').textContent = 'Falha ao salvar';
          notice(
            (inAccount ? cleanError(error) + ' ' : 'Não foi possível salvar no navegador. ') +
              'Baixe a ata antes de fechar a página.',
          );
          return false;
        })
        .finally(() => {
          savesPending--;
        });
      return saveQueue;
    }
    function renderLibrary() {
      const list = $('roomLibraryList'),
        fragment = document.createDocumentFragment();
      const visibleHistory = history.filter(item => (item.room_kind || 'meeting') === roomKind());
      for (const item of visibleHistory) {
        const row = el('tr', 'room-library-row');
        row.dataset.meetingId = item.id;
        const name = el('td', 'room-meeting-name'),
          open = button(item.title, () => openMeeting(item.id), 'room-open-meeting');
        open.dataset.meetingId = item.id;
        name.append(open);
        if (item.points)
          name.append(el('small', 'room-meeting-meta', item.points + (item.points === 1 ? ' registro' : ' registros')));
        const date = el(
          'td',
          'room-library-date',
          new Date(item.date).toLocaleString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
        const status = el('td', 'room-meeting-status'),
          label = el(
            'span',
            'room-library-badge',
            { draft: 'Não iniciada', done: 'Concluída', interrupted: 'Interrompida' }[item.status] || 'Em andamento',
          );
        label.dataset.status = item.status;
        status.append(label);
        const actions = el('td', 'room-library-actions'),
          action = button('Abrir', () => openMeeting(item.id));
        action.setAttribute('aria-label', 'Abrir ' + item.title);
        actions.append(action);
        row.append(name, date, status, actions);
        fragment.append(row);
      }
      list.replaceChildren(fragment);
      $('roomLibraryEmpty').hidden = !!visibleHistory.length;
      const table = list.closest('table');
      if (table) table.hidden = !visibleHistory.length;
      $('roomLibraryCount').textContent =
        visibleHistory.length + (visibleHistory.length === 1 ? ' reunião' : ' reuniões');
    }
    function renderView() {
      const visible = ['meeting'].includes(document.body.dataset.page),
        room = visible && view === 'room' && (current?.room_kind || 'meeting') === roomKind();
      renderLibrary();
      $('roomLibrary').hidden = !visible || room;
      $('roomLibraryHeader').hidden = !visible || room;
      $('meetingPage').hidden = !room;
      $('meetingHeader').hidden = !room;
      $('roomCreateMenu').hidden = true;
      $('roomNew').setAttribute('aria-expanded', 'false');
    }
    function snapshot() {
      return current ? JSON.parse(JSON.stringify(current)) : null;
    }
    function statusText() {
      if (integrated && !integrated.host && current?.status === 'running') return 'Acompanhando reunião ao vivo';
      if (!current || current.status === 'draft') return 'Ainda não iniciada';
      if (closing || (controller && !current.finishedAt && current.status !== 'running'))
        return 'Concluindo os últimos registros…';
      if (current.status === 'done') return 'Reunião concluída';
      if (current.status === 'interrupted') return 'Reunião preservada · confira as pendências';
      if (listening) return 'Gravando reunião';
      if (mode === 'live') return micPaused ? 'Gravação pausada' : 'Reunião em andamento';
      if (mode === 'text') return 'Reunião em andamento';
      const done = current.transcript.filter(t => ['done', 'command', 'error'].includes(t.status)).length;
      return 'Construindo mapa · ' + done + ' de ' + current.transcript.length + ' falas';
    }
    let reportedRunning = false,
      reportedCapture = false;
    const isRunning = () =>
      starting || closing || micStopping || !!recognition || listening || (!!controller && !current?.finishedAt);
    function controls() {
      const running = isRunning();
      if (running !== reportedRunning) {
        reportedRunning = running;
        window.dispatchEvent(new CustomEvent('norte:meeting-running', { detail: { running } }));
      }
      if (listening !== reportedCapture) {
        reportedCapture = listening;
        window.dispatchEvent(new CustomEvent('norte:meeting-capture', { detail: { recording: listening } }));
      }
      const active = !!controller && !current?.finishedAt,
        draft = current?.status === 'draft' || (integrated?.host && ['interrupted', 'done'].includes(current?.status));
      $('roomImport').disabled = running || !draft;
      $('roomLive').disabled =
        !current ||
        starting ||
        closing ||
        micStopping ||
        (!draft && !active) ||
        (active && !['live', 'text'].includes(mode));
      $('roomLiveLabel').textContent = micStopping
        ? 'Pausando…'
        : listening
          ? 'Pausar'
          : active && mode === 'live'
            ? 'Retomar'
            : current && !draft && !active
              ? ['interrupted', 'stopped'].includes(current.status)
                ? 'Interrompida'
                : 'Concluída'
              : integrated && ['interrupted', 'done'].includes(current?.status) && !active
                ? 'Continuar gravação'
                : 'Gravar';
      $('roomLive').classList.toggle('is-recording', listening);
      $('roomLive').setAttribute('aria-pressed', String(listening));
      $('roomNew').disabled = running || !initialized;
      $('roomCreateInstant').disabled = running || !initialized;
      $('roomBack').disabled = running;
      $('roomStarted').textContent = !current?.startedAt
        ? 'Ainda não iniciada'
        : (current.finishedAt ? 'Realizada em ' : 'Iniciada às ') +
          new Date(current.startedAt).toLocaleString(
            'pt-BR',
            current.finishedAt
              ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
              : { hour: '2-digit', minute: '2-digit' },
          );
      $('roomSessionBar').hidden = !current;
      $('roomStatus').textContent = statusText();
      $('roomPulse').classList.toggle('listening', listening);
      $('roomMic').hidden = true;
      $('roomFinish').hidden = !active || !['live', 'text'].includes(mode);
      $('roomFinish').disabled = closing;
      $('roomStop').hidden = !active || ['live', 'text'].includes(mode);
      $('roomStop').disabled = closing;
      const canType = integrated
        ? !!current &&
          !starting &&
          !closing &&
          (integrated.host || !['done', 'completed', 'ended', 'finished', 'stopped'].includes(current.status))
        : !!controller?.accepting;
      $('roomSend').disabled = !canType;
      $('roomText').disabled = !canType;
      $('roomLanguage').disabled = listening || closing;
      $('roomWrite').disabled = !canType;
      if (!canType) $('roomTextForm').hidden = true;
      if (integrated) {
        $('roomTitle').readOnly = !canWrite();
        $('roomNew').disabled = true;
        $('roomCreateInstant').disabled = true;
        if (!canWrite())
          for (const id of ['roomImport', 'roomLive', 'roomMic', 'roomFinish', 'roomStop']) $(id).disabled = true;
        const start = $('roomIntegratedStartText');
        if (start) {
          start.hidden = !canWrite() || active || !current || !['draft', 'interrupted'].includes(current.status);
          start.disabled = starting || closing;
          start.textContent = current?.status === 'interrupted' ? 'Retomar por texto' : 'Iniciar por texto';
        }
      }
      updateTimer();
      reportControls();
    }
    let reportedControls = '';
    function reportControls() {
      if (!integrated || window.parent === window) return;
      const state = id => ({ hidden: $(id).hidden, disabled: $(id).disabled });
      const value = {
        live: { ...state('roomLive'), label: $('roomLiveLabel').textContent, recording: listening, host: canWrite() },
        timer: { text: $('roomTimer').textContent, hidden: $('roomTimer').hidden },
        finish: state('roomFinish'),
        stop: state('roomStop'),
        importing: state('roomImport'),
        status: current?.status || '',
        statusText: statusText(),
        started: $('roomStarted').textContent,
      };
      const signature = JSON.stringify(value);
      if (signature === reportedControls) return;
      reportedControls = signature;
      window.parent.postMessage(
        { type: 'norte:meeting-controls', meetingId: current?.id || integrated.meeting.id, controls: value },
        location.origin,
      );
    }
    function updateTimer() {
      const timer = $('roomTimer'),
        meta = current?.meeting_metadata || {},
        imported = current?.input_mode === 'import';
      const start = Date.parse(imported ? meta.started_at : current?.continued_at || current?.startedAt),
        end = imported ? Date.parse(meta.ended_at) : current?.finishedAt ? Date.parse(current.finishedAt) : Date.now();
      const duration =
        imported && Number.isFinite(meta.duration_ms) && meta.duration_ms >= 0
          ? meta.duration_ms
          : Number.isFinite(start) && Number.isFinite(end) && end >= start
            ? end - start
            : null;
      timer.hidden = imported && (meta.duration_unknown === true || duration === null);
      const seconds = duration === null ? 0 : Math.floor(duration / 1000);
      timer.textContent =
        String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function renderBoard() {
      const projection = canvas.render(current),
        hasTopics = !!projection.topics.length;
      $('roomWelcome').hidden = hasTopics;
      $('roomBoard').hidden = !hasTopics;
      if (boardView === 'minutes') {
        if (meetingEnded()) {
          if ($('roomMinutesHost').querySelector('.room-live-minutes')) showBoard('minutes');
        } else {
          document.querySelector('#gmDialog')?.close();
          if (boardView === 'minutes') renderLiveMinutes(projection);
        }
      }
    }
    function focusEntry(id, topicId) {
      canvas.focusTopic(topicId);
      const card = [...$('roomBoard').querySelectorAll('[data-event-id]')].find(n => n.dataset.eventId === id);
      const details = card?.closest('.mc-topic-details');
      if (details) details.open = true;
      if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      card?.classList.add('room-highlight');
      setTimeout(() => card?.classList.remove('room-highlight'), 1600);
    }
    // The same name as the canvas: a person's title, then a valid suggested one.
    function topicName(id, state) {
      const explicit = current?.topic_titles?.[id] || current?.meeting_threads?.find(t => t.thread_id === id)?.title,
        suggestion = current?.block_review?.titles?.[id],
        index = state?.topics.findIndex(t => t.id === id) ?? -1;
      if (explicit) return explicit;
      if (NorteMeetingBlocks.valid(suggestion, current, 'title', id)) return suggestion.text;
      return id && index >= 0 ? 'Assunto ' + (index + 1) : 'Pontos a organizar';
    }
    function inspectEvidence(detail = {}) {
      const run = detail.run || current;
      if (!run) return;
      const ids = [...(detail.eventIds || [detail.event_id].filter(Boolean))],
        relationIds = detail.relationIds || [detail.relation_id].filter(Boolean);
      const state = NorteMeetingAmendments.build(run).state,
        events = Object.values(state.byId).map(entry => entry.event);
      const allRelations = new Map((run.meeting_relations || []).map(r => [r.relation_id, r]));
      for (const entry of Object.values(state.byId))
        for (const link of entry.relations || [])
          if (link.relation_id && !allRelations.has(link.relation_id))
            allRelations.set(link.relation_id, link.relation);
      const relations = [...allRelations.values()].filter(r => relationIds.includes(r.relation_id)),
        relation = relations[0];
      for (const edge of relations)
        for (const id of [edge.source_event_id, edge.target_event_id]) if (id && !ids.includes(id)) ids.push(id);
      const title = relation
        ? 'Detalhes da dependência'
        : detail.issues?.length || detail.warning
          ? 'Ponto em acompanhamento'
          : 'Detalhes do registro';
      const dialog = el('dialog', 'room-dialog room-diagnostics');
      dialog.setAttribute('aria-label', title);
      const header = el('header');
      header.append(
        el('h2', '', title),
        button('Fechar', () => dialog.close()),
      );
      dialog.append(header);
      for (const issue of detail.issues || [detail.warning].filter(Boolean))
        dialog.append(
          el(
            'p',
            '',
            issue.kind === 'error'
              ? 'Não foi possível concluir a organização deste registro. Revise a fala original.'
              : issue.message || String(issue),
          ),
        );
      const relationLabels = {
        tests: 'avalia',
        result_of: 'é resultado de',
        depends_on: 'depende de',
        affects: 'afeta',
        based_on: 'baseia-se em',
        supports: 'sustenta',
        contradicts: 'contradiz',
        supersedes: 'substitui',
        answers: 'responde a',
        clarifies: 'esclarece',
        resolves: 'resolve',
      };
      for (const edge of relations) {
        const label = relationLabels[edge.relation_type];
        if (label) dialog.append(el('p', '', edge.source_event_id + ' ' + label + ' ' + edge.target_event_id + '.'));
        const explanation = {
          mismatch: 'As configurações são diferentes; este vínculo não confirma a conclusão.',
          partial: 'As configurações coincidem apenas em parte; revise a conclusão.',
          ambiguous: 'Não foi possível confirmar se as configurações são compatíveis.',
        }[edge.configuration_match];
        if (explanation) dialog.append(el('p', '', explanation));
      }
      for (const event of events.filter(e => ids.includes(e.event_id))) {
        const quote = el('blockquote', '', event.text);
        quote.append(el('small', 'room-diagnostic-id', 'Referência ' + event.event_id));
        dialog.append(quote);
        const preserved = run.minutes_document?.doc?.editorial_fallbacks?.find(
          item => item.event_id === event.event_id,
        );
        if (preserved)
          dialog.append(el('p', 'room-original-preserved', 'Mantido como na transcrição: ' + preserved.reason));
        const correction = NorteMeetingBlocks.classification(run, event);
        if (correction)
          dialog.append(
            el(
              'p',
              '',
              `Classificação revisada: ${NorteMeetingBlocks.labels[correction.label]}. Original: ${NorteMeetingBlocks.labels[correction.original_label] || correction.original_label}. Orientação v${run.classification_learning.version}.`,
            ),
          );
        if (event.source === 'post_meeting') {
          dialog.append(el('p', '', 'Resultado informado na revisão humana após a reunião.'));
          if (event.performed) dialog.append(el('p', '', 'Realizado: ' + event.performed));
          if (event.performed_at)
            dialog.append(el('p', '', 'Data: ' + event.performed_at.slice(0, 10).split('-').reverse().join('/')));
        }
      }
      // Raw classifier requests/responses are useful to diagnose the system, but
      // they are not meeting content. Only administrators get this closed section.
      if (canWrite() && !isRunning() && run === current && ids.some(id => state.byId[id]?.current)) {
        const form = el('form', 'room-review-form'),
          heading = el('h3', '', 'Revisar registro'),
          record = el('select'),
          action = el('select'),
          reference = el('select'),
          note = el('textarea'),
          message = el('p', 'room-review-message');
        message.setAttribute('role', 'status');
        const field = (label, input) => {
          input.setAttribute('aria-label', label);
          const wrap = el('label', '', label);
          wrap.append(input);
          form.append(wrap);
        };
        for (const id of ids.filter(id => state.byId[id]?.current)) {
          const option = el('option', '', id + ' · ' + state.byId[id].text);
          option.value = id;
          record.append(option);
        }
        for (const [value, label] of [
          ['assign_topic', 'Associar a um assunto'],
          ['link_reference', 'Ligar referência'],
          ['resolve_point', 'Resolver com uma decisão'],
          ['confirm_replacement', 'Confirmar substituição'],
        ]) {
          const option = el('option', '', label);
          option.value = value;
          action.append(option);
        }
        const linkType = el('select');
        for (const [value, label] of [
          ['clarifies', 'Esclarece'],
          ['based_on', 'Baseia-se em'],
          ['depends_on', 'Depende de'],
          ['supports', 'Sustenta'],
          ['contradicts', 'Contradiz'],
        ]) {
          const option = el('option', '', label);
          option.value = value;
          linkType.append(option);
        }
        const choices = () => {
          const selected = state.byId[record.value];
          reference.replaceChildren();
          if (action.value === 'assign_topic') {
            for (const topic of state.topics.filter(t => t.id && t.id !== selected.topic_id)) {
              const option = el('option', '', topic.title || topic.id);
              option.value = topic.id;
              reference.append(option);
            }
            linkType.closest('label').hidden = true;
            return;
          }
          for (const entry of Object.values(state.byId).filter(
            entry =>
              entry.current &&
              entry.id !== selected.id &&
              entry.topic_id === selected.topic_id &&
              (action.value !== 'resolve_point' || entry.type === 'decision'),
          )) {
            const option = el('option', '', entry.id + ' · ' + entry.text);
            option.value = entry.id;
            reference.append(option);
          }
          linkType.closest('label').hidden = action.value !== 'link_reference';
        };
        form.append(heading);
        field('Registro', record);
        field('Ação', action);
        field('Significado do vínculo', linkType);
        field('Referência da própria reunião', reference);
        field('Justificativa', note);
        note.required = true;
        note.maxLength = 4000;
        note.rows = 3;
        const actions = el('div', 'room-review-actions'),
          submit = button('Salvar revisão', () => {}),
          reclassify = button('Reclassificar', () => {
            dialog.close();
            blockAgents?.edit('block', record.value);
          });
        submit.type = 'submit';
        actions.append(submit, reclassify);
        form.append(actions, message);
        dialog.append(form);
        record.onchange = action.onchange = choices;
        action.value = state.byId[record.value]?.topic_id ? 'link_reference' : 'assign_topic';
        choices();
        if (state.byId[record.value]?.type === 'test_proposal')
          actions.append(
            button('Conferir teste na ata', () => {
              dialog.close();
              openMinutes();
            }),
          );
        const baseline = JSON.stringify(run);
        form.onsubmit = async event => {
          event.preventDefault();
          if (current !== run || JSON.stringify(run) !== baseline) {
            message.textContent = 'A reunião mudou. Feche e reabra este registro antes de revisar.';
            return;
          }
          submit.disabled = true;
          reclassify.disabled = true;
          const previous = run.post_meeting_edits ? JSON.parse(JSON.stringify(run.post_meeting_edits)) : undefined;
          try {
            NorteMeetingAmendments.record(run, {
              type: action.value,
              event_id: record.value,
              reference_id: reference.value,
              topic_id: reference.value,
              relation_type: linkType.value,
              note: note.value,
            });
            if (!(await save())) {
              if (current === run) run.post_meeting_edits = previous;
              throw Error('A revisão não foi salva. Recarregue para conferir a versão atual.');
            }
            render();
            dialog.close();
          } catch (error) {
            message.textContent = cleanError(error);
            submit.disabled = false;
            reclassify.disabled = false;
          }
        };
      }
      if (document.body.dataset.role === 'admin') {
        const records = (run.records || []).filter(r =>
          events.some(e => ids.includes(e.event_id) && e.chunk_id === r.id),
        );
        const logs = {
          records,
          thread_jobs: (run.thread_worker?.jobs || []).filter(j => ids.includes(j.event_id)),
          ...(relationIds.length
            ? {
                relations,
                relation_jobs: (run.typed_relation_worker?.jobs || []).filter(
                  j =>
                    relations.some(r => r.source_event_id === j.event_id) ||
                    relationIds.some(id => id.startsWith('MR_' + j.event_id + '_')),
                ),
              }
            : {}),
        };
        const disclosure = el('details', 'room-diagnostic-log');
        disclosure.append(
          el('summary', '', 'Diagnóstico técnico · administrador'),
          el('pre', '', JSON.stringify(logs, null, 2)),
        );
        dialog.append(disclosure);
      }
      dialog.addEventListener('close', () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    }
    function transcriptTurns() {
      const entries = [
        ...(current?.transcript || []),
        ...pendingContributions
          .filter(row => !(current?.transcript || []).some(entry => entry.segmentId === 'contribution:' + row.id))
          .map(row => ({
            id: 'PENDING-' + row.id,
            text: row.text,
            speaker: row.name || 'Participante',
            source: 'participant',
            status: 'queued',
            receivedAt: row.createdAt,
            offsetMs: current?.startedAt ? Math.max(0, Date.parse(row.createdAt) - Date.parse(current.startedAt)) : 0,
          })),
        ...(current?.speech_ledger?.records || [])
          .filter(r => r.status === 'unconfirmed')
          .map(r => ({
            id: 'UNCONFIRMED-' + r.id,
            text: r.text,
            speaker: r.speaker,
            offsetMs: r.startMs,
            status: 'unconfirmed',
            error: 'Fala não confirmada pelo microfone; não entrou no mapa.',
          })),
      ].sort((a, b) => (a.offsetMs ?? Infinity) - (b.offsetMs ?? Infinity));
      const turns = [];
      for (const entry of entries) {
        const sourceKey = entry.segmentId || entry.id;
        for (const [index, text] of NorteMeetingSpeech.split(entry.text, { preserveCommands: false }).entries()) {
          const count = text.trim().split(/\s+/).length;
          let turn = turns.at(-1);
          if (
            !turn ||
            turn.sourceKey !== sourceKey ||
            turn.wordCount + count > 18 ||
            turn.command ||
            entry.command?.consumed
          ) {
            turn = {
              key: entry.id + ':' + index,
              sourceKey,
              entries: [],
              text: [],
              wordCount: 0,
              speaker: entry.speaker || '',
              offsetMs: entry.offsetMs,
              notes: [],
              command: !!entry.command?.consumed,
              settled: true,
            };
            turns.push(turn);
          }
          turn.entries.push(entry.id);
          turn.settled &&= ['done', 'command', 'error'].includes(entry.status);
          turn.text.push(text);
          turn.wordCount += count;
          if (entry.error) turn.notes.push(cleanError(entry.error));
          if (
            entry.command?.consumed &&
            entry.command.message &&
            !entry.command.renamed &&
            !['applied', 'conversation'].includes(entry.command.status)
          )
            turn.notes.push(cleanError(entry.command.message));
        }
      }
      return turns;
    }
    function noteRow(note) {
      const row = el('aside', 'room-note' + (note.done ? ' is-done' : ''));
      row.dataset.noteId = note.id;
      const done = button(note.done ? 'Reabrir' : 'Feito', () => changeNote(note.id, !note.done), 'room-note-action'),
        remove = button('Apagar', () => deleteNote(note.id), 'room-note-action');
      const actions = el('span', 'room-note-actions');
      actions.append(done, remove);
      row.append(el('small', '', 'Sua nota'), el('p', '', note.text), actions);
      return row;
    }
    function renderTranscript() {
      const turns = transcriptTurns(),
        used = new Set(current?.meeting_events?.map(event => event.chunk_id)),
        outside = turn =>
          turn.settled &&
          !turn.command &&
          !(current?.transcript || []).some(
            entry => turn.entries.includes(entry.id) && (used.has(entry.chunk_id) || used.has(entry.id)),
          ),
        key = JSON.stringify([turns, notes, current?.highlights?.findings, [...used]]);
      if (key === lastTranscript) return;
      lastTranscript = key;
      const list = $('roomTranscript'),
        scroller = list.closest('.room-transcript-scroll'),
        follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70;
      const expanded = new Set(
        [...list.querySelectorAll('details[open]')].map(node => node.closest('[data-source-id]').dataset.sourceId),
      );
      const fragment = document.createDocumentFragment(),
        placed = NorteMeetingNotes.placeNotes(turns, notes);
      fragment.append(...(placed.get(-1) || []).map(noteRow));
      for (const [position, turn] of turns.entries()) {
        const row = el('article', 'room-speech' + (outside(turn) ? ' is-filtered' : ''));
        row.dataset.sourceId = turn.key;
        row.dataset.entries = turn.entries.join(' ');
        const time = el('time', 'room-speech-time', clock(turn.offsetMs));
        time.title = 'Horário da fala';
        if (Number.isFinite(turn.offsetMs)) time.dateTime = 'PT' + (turn.offsetMs / 1000).toFixed(3) + 'S';
        const body = el('div', 'room-speech-body');
        if (turn.speaker) body.append(el('span', 'room-speech-speaker', turn.speaker));
        body.append(alerts.speechText(turn), ...alerts.monitorLines(turn));
        if (outside(turn)) body.append(el('span', 'room-speech-tag', 'Fora das notas'));
        if (turn.notes.length) {
          const notes = el('details', 'room-speech-notes');
          notes.open = expanded.has(turn.key);
          notes.append(el('summary', '', 'Ver observação'));
          for (const note of new Set(turn.notes)) notes.append(el('p', '', note));
          body.append(notes);
        }
        row.append(time, body);
        fragment.append(row, ...(placed.get(position) || []).map(noteRow));
      }
      list.replaceChildren(fragment);
      $('roomTranscriptEmpty').hidden = !!turns.length || !!notes.length;
      $('roomTranscriptCount').textContent = turns.length + (turns.length === 1 ? ' fala' : ' falas');
      if (follow) scroller.scrollTop = scroller.scrollHeight;
    }
    function focusTurn(key) {
      const row = [...$('roomTranscript').querySelectorAll('.room-speech')].find(node => node.dataset.sourceId === key);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('is-referenced');
      setTimeout(() => row.classList.remove('is-referenced'), 2400);
    }
    function appendTurn(entry, source) {
      for (const part of NorteMeetingSpeech.entries(entry, source)) {
        const { text, ...meta } = part;
        controller.append(text, meta);
      }
    }

    function render() {
      renderFrame = 0;
      renderBoard();
      renderTranscript();
      renderFooter();
      controls();
      alerts.refresh();
      void alerts.tick();
    }
    const STAGES = ['Fala', 'Filtro', 'Classificação', 'Assunto e relações', 'Nota'];
    // The steps of the latest line, read from what the session really recorded for it.
    function pipelineSteps() {
      const entry = current?.transcript?.at(-1);
      if (!entry) return null;
      const event = current.meeting_events.find(item => item.chunk_id === entry.chunk_id || item.chunk_id === entry.id),
        settled = ['done', 'command', 'error'].includes(entry.status);
      const filtered = settled && !event,
        topic = event?.thread_id
          ? current.meeting_threads.findIndex(item => item.thread_id === event.thread_id) + 1
          : 0;
      const note = event && current.block_review?.blocks?.[event.event_id];
      const values = [
        [entry.speaker || 'Fala', clock(entry.offsetMs)].join(' · '),
        !settled ? '' : event ? 'Entra nas notas' : 'Fica só na transcrição',
        event ? NorteMeetingHierarchy.labels[event.type] || NorteMeetingHierarchy.labels.other : '',
        topic ? 'Assunto ' + String(topic).padStart(2, '0') : '',
        note ? 'Escrita' : '',
      ];
      let active = false;
      return STAGES.map((label, index) => {
        if (filtered && index > 1) return { label, value: '—', state: 'skipped' };
        if (values[index]) return { label, value: values[index], state: 'done' };
        if (active) return { label, value: '', state: 'waiting' };
        active = true;
        return { label, value: '…', state: 'active' };
      });
    }
    function renderFooter() {
      const ended = meetingEnded(),
        steps = ended ? null : pipelineSteps(),
        open = notes.filter(note => !note.done).length;
      $('roomFooter').hidden = !ended && !steps;
      $('roomPipeline').hidden = ended || !steps;
      $('roomEnded').hidden = !ended;
      $('roomLock').dataset.locked = String(!ended);
      $('roomLockText').textContent = !ended
        ? 'Durante a reunião, canvas e ata só acompanham a transcrição.'
        : canWrite()
          ? 'Reunião encerrada: agora dá para corrigir os registros.'
          : 'Reunião encerrada.';
      if (ended) {
        $('roomEndedText').textContent =
          (minutesProgress === 'organizing'
            ? 'Organizando a ata por assunto…'
            : minutesProgress || 'Ata organizada por assunto, com a fala de origem de cada item.') +
          (open ? ' ' + open + (open === 1 ? ' nota sua para revisar.' : ' notas suas para revisar.') : '');
        $('roomEnded').dataset.state = minutesProgress === 'organizing' ? 'working' : minutesProgress ? 'failed' : 'done';
        $('roomEndedAction').textContent = boardView === 'minutes' ? 'Voltar ao canvas' : 'Ver ata';
      } else if (steps) {
        $('roomPipeline').replaceChildren(
          ...steps.map((step, index) => {
            const item = el('li');
            item.dataset.state = step.state;
            const text = el('span', 'room-step-text');
            text.append(el('strong', '', step.label), el('small', '', step.value));
            item.append(el('span', 'room-step-dot', step.state === 'done' ? '✓' : String(index + 1)), text);
            return item;
          }),
        );
      }
    }
    function focusSpeech(eventId) {
      const chunk = current?.meeting_events.find(item => item.event_id === eventId)?.chunk_id,
        entry = current?.transcript.find(item => item.chunk_id === chunk || item.id === chunk);
      const row =
        entry &&
        [...$('roomTranscript').querySelectorAll('.room-speech')].find(node =>
          node.dataset.entries.split(' ').includes(entry.id),
        );
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      row.classList.add('is-referenced');
      setTimeout(() => row.classList.remove('is-referenced'), 2400);
    }
    function renderLiveMinutes(projection) {
      const chunkOf = id => current?.transcript.find(entry => entry.id === id)?.chunk_id,
        turns = transcriptTurns(),
        participants = [...new Set(turns.map(turn => turn.speaker).filter(Boolean))],
        used = new Set(current?.meeting_events.map(item => item.chunk_id));
      NorteLiveMinutes.render($('roomMinutesHost'), {
        title: current?.title || 'Reunião',
        participants,
        lines: turns.length,
        outside: (current?.transcript || []).filter(entry => !used.has(entry.chunk_id) && !used.has(entry.id)).length,
        projection,
        onReference: focusSpeech,
        // The number of the line in the transcript, as in the finished minutes.
        referenceOf: id => {
          const chunk = current?.meeting_events.find(item => item.event_id === id)?.chunk_id;
          return turns.findIndex(turn => turn.entries.some(entry => entry === chunk || chunkOf(entry) === chunk)) + 1;
        },
      });
    }
    async function loadNotes() {
      notesStore = integrated ? integrated.notes : NorteMeetingNotes.localStore(db, current.id);
      try {
        notes = await notesStore.list();
      } catch (error) {
        notes = [];
        notice(cleanError(error));
      }
      renderTranscript();
      renderFooter();
    }
    const noteOffset = () => {
      const offsets = (current?.transcript || []).map(entry => entry.offsetMs).filter(Number.isFinite);
      return Math.round(isRunning() && current?.startedAt ? elapsed() : offsets.length ? Math.max(...offsets) : 0);
    };
    async function changeNote(id, done) {
      try {
        const next = await notesStore.update(id, done);
        notes = notes.map(note => (note.id === id ? next : note));
        renderTranscript();
        renderFooter();
      } catch (error) {
        notice(cleanError(error));
      }
    }
    async function deleteNote(id) {
      try {
        await notesStore.remove(id);
        notes = notes.filter(note => note.id !== id);
        renderTranscript();
        renderFooter();
      } catch (error) {
        notice(cleanError(error));
      }
    }
    $('roomNoteText').oninput = () => {
      $('roomNoteSend').disabled = !$('roomNoteText').value.trim() || !notesStore;
    };
    $('roomNoteForm').onsubmit = async event => {
      event.preventDefault();
      const input = $('roomNoteText'),
        text = input.value.trim();
      if (!text || !notesStore) return;
      input.value = '';
      $('roomNoteSend').disabled = true;
      try {
        notes = [...notes, await notesStore.add({ text, offsetMs: noteOffset() })];
        renderTranscript();
        renderFooter();
      } catch (error) {
        input.value = text;
        notice(cleanError(error));
      }
    };
    function changed(run, change) {
      current = run;
      if (change.phase === 'command' && change.command?.message) {
        if (change.command.status === 'applied') notice('');
        else if (change.command.renamed)
          window.dispatchEvent(new CustomEvent('norte:notice', { detail: change.command.message }));
        else notice(change.command.message);
      }
      if (change.phase === 'error' || change.phase === 'stopped')
        notice(
          cleanError(change.error || run.error || 'Um trecho não pôde ser processado. A transcrição foi preservada.'),
        );
      if (change.phase === 'stopped' && listening) stopMic();
      if (!renderFrame) renderFrame = requestAnimationFrame(render);
      saveSoon();
    }
    function draft(title = 'Nova reunião') {
      const stamp = new Date().toISOString(),
        id = crypto.randomUUID();
      return {
        room_kind: roomKind(),
        schemaVersion: 1,
        liveSchemaVersion: 1,
        memorySchemaVersion: 3,
        id,
        title,
        provider,
        threshold: 0.6,
        questions: NorteMemoryFlow.validateQuestions(NorteJevQuestions.memory),
        questionVersion: 'memory-v2',
        createdAt: stamp,
        startedAt: null,
        status: 'draft',
        batch: { batch_id: id, cases: [] },
        records: [],
        calls: 0,
        meeting_events: [],
        meeting_threads: [],
        meeting_relations: [],
        raw_window: [],
        transcript: [],
        topic_titles: {},
        meeting_commands: [],
      };
    }
    async function createInstant() {
      if (integrated) return;
      if (isRunning() || !initialized) return;
      starting = true;
      controls();
      try {
        if (current && !(await save())) return;
        current = draft();
        controller = null;
        mode = null;
        closing = false;
        lastTranscript = '';
        canvas.reset();
        $('roomTitle').value = current.title;
        $('roomImportText').value = '';
        $('roomFile').value = '';
        $('roomFileLabel').textContent = 'Selecionar arquivo';
        $('roomImportError').textContent = '';
        filename = 'transcricao.txt';
        view = 'room';
        notice('');
        renderView();
        showBoard('canvas');
        render();
        await save();
        await loadNotes();
        $('roomTitle').focus();
      } finally {
        starting = false;
        controls();
      }
    }
    async function openMeeting(id) {
      if (integrated && id !== integrated.meeting.id) return false;
      if (isRunning() || !db) return false;
      starting = true;
      controls();
      try {
        if (current && !(await save())) return false;
        const raw = await db.read(saveKey(id));
        if (!raw && !integrated)
          throw Error(
            inAccount
              ? 'Esta reunião não está disponível nesta conta. Entre na conta que criou a ata.'
              : 'Esta reunião não está salva neste navegador. Abra o link no navegador em que ela foi criada.',
          );
        const original = raw ? JSON.parse(raw) : null,
          saved = original
            ? integrated?.meeting.copiedFromExample
              ? integrated.view({ ...original, readonly_projection: 'norte.meeting-view.v1' })
              : integrated && !integrated.host
                ? integrated.view(original)
                : Session.restore(original)
            : draft(integrated.meeting.title);
        if (integrated) {
          saved.id = id;
          saved.batch.batch_id = id;
          saved.room_kind = integrated.meeting.roomKind || 'meeting';
          saved.createdAt = integrated.meeting.createdAt || saved.createdAt;
          saved.project_id = integrated.meeting.projectId;
          saved.integrated_norte = true;
          if (!integrated.host && original) saved.status = original.status;
        }
        current = saved;
        if (!integrated) delete current.block_review;
        controller = null;
        mode = current.input_mode || null;
        lastTranscript = '';
        canvas.reset();
        // Reading a saved meeting does not enqueue editorial work or another save.
        persistedSnapshot = raw && !integrated?.meeting.copiedFromExample ? JSON.stringify(current) : null;
        $('roomTitle').value = current.title;
        view = 'room';
        renderView();
        showBoard('canvas');
        void loadNotes();
        notice(
          current.status === 'interrupted'
            ? 'Esta reunião foi interrompida. Os registros recebidos foram preservados; gere a ata com os avisos de revisão.'
            : '',
        );
        render();
        if (integrated?.host && (!raw || integrated.meeting.copiedFromExample)) await save();
        if (new URLSearchParams(location.search).get('view') === 'minutes') queueMicrotask(openMinutes);
        return true;
      } catch (error) {
        notice(cleanError(error));
        return false;
      } finally {
        starting = false;
        controls();
      }
    }
    let referenceHandled = '',
      referenceOpening = false;
    async function followReference() {
      if (!initialized || !db || referenceOpening) return false;
      const params = new URLSearchParams(location.search),
        id = params.get('meeting'),
        eventId = params.get('event');
      if (!id) return false;
      const signature = JSON.stringify([id, eventId]);
      if (referenceHandled === signature) return false;
      if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(id) || (eventId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(eventId))) {
        referenceHandled = signature;
        notice('A referência da ata é inválida.');
        return false;
      }
      referenceHandled = signature;
      if (isRunning() && current?.id !== id) {
        notice(
          'Há uma reunião em andamento. Encerre-a antes de abrir outra referência, ou abra o link em uma nova aba.',
        );
        return false;
      }
      referenceOpening = true;
      try {
        if (current?.id !== id && !(await openMeeting(id))) return false;
        if (current.room_kind && current.room_kind !== 'meeting')
          throw Error('Abra esta reunião pelo arquivo histórico.');
        if (!eventId) return true;
        const entry = NorteMeetingAmendments.build(current).state.byId[eventId];
        if (!entry) {
          notice('O registro indicado não está disponível nesta reunião. Confira a referência na ata.');
          return false;
        }
        focusEntry(entry.id, entry.topic_id);
        inspectEvidence({ eventIds: [eventId] });
        return true;
      } catch (error) {
        notice(cleanError(error));
        return false;
      } finally {
        referenceOpening = false;
      }
    }
    async function showLibrary() {
      if (integrated) {
        if (!isRunning()) integrated.returnToNorte();
        return false;
      }
      if (isRunning()) return false;
      starting = true;
      controls();
      try {
        if (current && !(await save())) return false;
        view = 'library';
        notice('');
        renderLibrary();
        renderView();
        return true;
      } finally {
        starting = false;
        controls();
      }
    }
    async function begin(nextMode) {
      if (
        !canWrite() ||
        isRunning() ||
        !(current?.status === 'draft' || (integrated && ['interrupted', 'done'].includes(current?.status)))
      )
        return false;
      starting = true;
      controls();
      if (!(await checkHealth())) {
        starting = false;
        controls();
        return false;
      }
      const previous = current;
      try {
        notice('');
        mode = nextMode;
        lastTranscript = '';
        canvas.reset();
        closing = false;
        controller = Session.create({
          provider,
          title: $('roomTitle').value.trim() || 'Nova reunião',
          send,
          onChange: changed,
          continuation: true,
          ...(integrated && previous.status !== 'draft' ? { seed: previous } : {}),
        });
        current = controller.run;
        current.room_kind = previous.room_kind || 'meeting';
        current.id = previous.id;
        current.batch.batch_id = previous.id;
        current.createdAt = previous.createdAt;
        current.input_mode = nextMode;
        // A continued meeting times only the new session; the original duration stays in its metadata.
        if (previous.status !== 'draft') current.continued_at = new Date().toISOString();
        if (integrated) {
          current.project_id = integrated.meeting.projectId;
          current.integrated_norte = true;
        }
        return true;
      } catch (error) {
        controller = null;
        current = previous;
        notice(cleanError(error));
        return false;
      } finally {
        starting = false;
        render();
        saveSoon();
      }
    }
    function renameTopic(id, title) {
      if (!canWrite()) return;
      if (
        blockAgents &&
        NorteMeetingBlocks.valid(current?.block_review?.titles?.[id], current, 'title', id) &&
        !current?.topic_titles?.[id]
      ) {
        blockAgents.edit('title', id);
        return;
      }
      renaming = id;
      $('roomRenameValue').value =
        current?.topic_titles?.[id] || current?.meeting_threads.find(t => t.thread_id === id)?.title || '';
      const n = Number(id.replace(/\D/g, ''));
      $('roomRenameHint').textContent = 'Por voz: “Norte, o assunto ' + n + ' é [nome do assunto]”.';
      $('roomRenameDialog').showModal();
      $('roomRenameValue').focus();
    }
    $('roomRenameForm').onsubmit = e => {
      e.preventDefault();
      const name = $('roomRenameValue').value.trim();
      if (!name || !current || !renaming) return;
      current.topic_titles ||= {};
      current.topic_titles[renaming] = name;
      for (const t of current.meeting_threads) if (t.thread_id === renaming) t.title = name;
      current.title_edits ||= [];
      current.title_edits.push({ thread_id: renaming, title: name, source: 'manual', at: new Date().toISOString() });
      $('roomRenameDialog').close();
      render();
      saveSoon();
    };
    $('roomRenameCancel').onclick = () => $('roomRenameDialog').close();
    $('roomTitle').onchange = () => {
      if (current && canWrite()) {
        current.title = $('roomTitle').value.trim() || 'Nova reunião';
        saveSoon();
      }
    };
    function reportView(view) {
      if (integrated)
        window.parent.postMessage({ type: 'norte:meeting-view', meetingId: current?.id, view }, location.origin);
    }
    // The final minutes are written once, right after the host ends the meeting. They wait for the
    // last notes and titles because those are part of what the minutes read.
    async function finishMinutes() {
      if (!canWrite() || !current?.meeting_events.length) return;
      const run = current;
      minutesProgress = 'organizing';
      renderFooter();
      try {
        await blockAgents?.refresh();
        if (['pending', 'waiting'].includes(document.body.dataset.editorial))
          await new Promise(resolve => {
            editorSettled = resolve;
            setTimeout(resolve, 60000);
          });
        const draft = await NorteMinutesEditor.organize(run, AbortSignal.timeout(190000));
        if (current !== run) return;
        await NorteMinutesEditor.saveDraft(run, draft, { storage: localStorage, onUpdate: () => save() });
        minutesProgress = '';
        if (boardView === 'minutes') {
          document.querySelector('#gmDialog')?.remove();
          showBoard('minutes');
        } else $('roomMinutesReady').hidden = false;
      } catch (error) {
        if (current === run) minutesProgress = NorteMinutesEditor.organizeError(error);
      } finally {
        editorSettled = null;
        render();
      }
    }
    function openMinutes() {
      NorteMinutesEditor.open(current, {
        host: $('roomMinutesHost'),
        readOnly: !canWrite(),
        onExplore: inspectEvidence,
        onClose: () => {
          if (boardView === 'minutes') showBoard('canvas');
        },
        onUpdate: async run => {
          if (current?.id !== run.id) return;
          current = run;
          controller = null;
          render();
          return await save();
        },
      });
    }
    // Same pane, two views. While the meeting runs the Ata tab is a read-only preview; once it ends it becomes the document.
    function showBoard(next) {
      const changed = boardView !== next;
      boardView = next;
      $('roomViewCanvas').setAttribute('aria-pressed', String(next === 'canvas'));
      $('roomMinutes').setAttribute('aria-pressed', String(next === 'minutes'));
      $('roomViewAlerts').setAttribute('aria-pressed', String(next === 'alerts'));
      $('roomCanvas').hidden = next !== 'canvas';
      $('roomMinutesHost').hidden = next !== 'minutes';
      $('roomAlertsHost').hidden = next !== 'alerts';
      if (next === 'minutes') $('roomMinutesReady').hidden = true;
      if (next !== 'minutes') document.querySelector('#gmDialog')?.close();
      else if (!document.querySelector('#gmDialog')) {
        $('roomMinutesHost').replaceChildren();
        if (meetingEnded() && current?.meeting_events.length) openMinutes();
        else renderLiveMinutes(canvas.getProjection() || canvas.render(current));
      }
      if (changed) reportView(next);
      renderFooter();
      alerts.refresh();
    }
    $('roomViewCanvas').onclick = () => showBoard('canvas');
    $('roomMinutes').onclick = () => showBoard('minutes');
    $('roomViewAlerts').onclick = () => showBoard('alerts');
    $('roomEndedAction').onclick = () => showBoard(boardView === 'minutes' ? 'canvas' : 'minutes');
    window.addEventListener('message', event => {
      if (
        !integrated ||
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.meetingId !== current?.id ||
        event.data?.type !== 'norte:meeting-view'
      )
        return;
      showBoard(event.data.view === 'minutes' ? 'minutes' : 'canvas');
    });
    // The Norte meeting bar sends the same actions as the room's own buttons; each keeps its gating.
    window.addEventListener('message', event => {
      if (
        !integrated ||
        event.source !== window.parent ||
        event.origin !== location.origin ||
        event.data?.type !== 'norte:meeting-command' ||
        event.data.meetingId !== (current?.id || integrated.meeting.id)
      )
        return;
      if (event.data.command === 'refresh') {
        reportedControls = '';
        reportControls();
        return;
      }
      const target = {
        live: 'roomLive',
        finish: 'roomFinish',
        stop: 'roomStop',
        minutes: 'roomMinutes',
        import: 'roomImport',
      }[event.data.command];
      if (target && !$(target).disabled && !$(target).hidden) $(target).click();
    });
    $('roomWrite').onclick = () => {
      $('roomMore').open = false;
      $('roomTextForm').hidden = !$('roomTextForm').hidden;
      if (!$('roomTextForm').hidden) $('roomText').focus();
    };
    $('roomImport').onclick = () => {
      $('roomMore').open = false;
      $('roomImportDialog').showModal();
      $('roomImportText').focus();
    };
    $('roomImportClose').onclick = () => $('roomImportDialog').close();
    let filename = 'transcricao.txt';
    async function loadFile(file) {
      if (!file) return;
      if (file.size > 2_000_000) {
        $('roomImportError').textContent = 'O arquivo é grande demais. Use uma transcrição de até 500 mil caracteres.';
        return;
      }
      try {
        const text = await file.text();
        Session.parseTranscriptEntries(text, file.name);
        filename = file.name;
        $('roomImportText').value = text;
        $('roomFileLabel').textContent = file.name;
        $('roomImportError').textContent = '';
      } catch (e) {
        $('roomImportError').textContent = cleanError(e);
      }
    }
    $('roomImportText').oninput = () => {
      filename = 'transcricao.txt';
      $('roomImportError').textContent = '';
    };
    $('roomFile').onchange = () => loadFile($('roomFile').files[0]);
    $('roomDrop').ondragover = e => {
      e.preventDefault();
    };
    $('roomDrop').ondrop = e => {
      e.preventDefault();
      loadFile(e.dataTransfer.files[0]);
    };
    $('roomImportForm').onsubmit = async e => {
      e.preventDefault();
      let parts;
      try {
        parts = Session.parseTranscriptEntries($('roomImportText').value, filename);
      } catch (error) {
        $('roomImportError').textContent = cleanError(error);
        return;
      }
      $('roomImportSubmit').disabled = true;
      try {
        if (!(await begin('import'))) return;
        for (const part of parts) appendTurn(part, 'import');
        current.import_filename = filename;
        $('roomImportDialog').close();
        await controller.close();
        await save();
        void finishMinutes();
      } catch (error) {
        notice(cleanError(error));
        controller?.stop(error);
      } finally {
        $('roomImportSubmit').disabled = false;
        render();
      }
    };
    $('roomTextForm').onsubmit = async e => {
      e.preventDefault();
      const text = $('roomText').value.trim();
      if (!text) return;
      if (integrated) {
        // The account accepts contributions once the continued run is saved as running.
        if (integrated.host && ['draft', 'interrupted', 'done'].includes(current?.status) && !controller?.accepting) {
          if (!(await begin('text'))) return;
          if (!(await save())) return;
        }
        if (pendingTyped?.text !== text) pendingTyped = { text, clientId: crypto.randomUUID() };
        $('roomSend').disabled = true;
        try {
          await integrated.contribute(text, pendingTyped.clientId);
          $('roomText').value = '';
          pendingTyped = null;
          notice('');
        } catch (error) {
          notice(cleanError(error));
        } finally {
          controls();
        }
        return;
      }
      if (!controller?.accepting) return;
      try {
        appendTurn({ text, segmentId: 'typed:' + crypto.randomUUID() }, 'typed');
        $('roomText').value = '';
      } catch (error) {
        notice(cleanError(error));
      }
    };
    function elapsed() {
      return Math.max(0, Date.now() - Date.parse(current?.startedAt || new Date().toISOString()));
    }
    function ingestSpeech(event) {
      if (!ledger || !current) return;
      ledger.ingest(event.results, event.resultIndex, elapsed(), $('roomLanguage').value);
      for (const [index, record] of ledger.records.entries()) {
        if (record.status !== 'final' || consumed.has(record.id)) continue;
        consumed.add(record.id);
        try {
          if (controller?.accepting) {
            const previous = ledger.records[index - 1],
              continues =
                previous?.status === 'final' &&
                previous.speaker === record.speaker &&
                record.startMs - previous.endMs < 2000;
            appendTurn(
              {
                text: record.text,
                sourceText: record.text,
                sourceId: record.id,
                segmentId: 'microphone:' + ledger.sessionId + ':' + record.id,
                offsetMs: record.startMs,
                ...(Number.isFinite(record.endMs) ? { endOffsetMs: record.endMs } : {}),
                speaker: record.speaker,
                ...(continues ? { speechContext: NorteMeetingSpeech.boundedContext(previous.text) } : {}),
              },
              'microphone',
            );
          } else {
            current.transcript.push({
              id: 'AUDIO-' + record.id,
              text: record.text,
              source: 'microphone',
              segmentId: 'microphone:' + ledger.sessionId + ':' + record.id,
              speaker: record.speaker,
              receivedAt: new Date().toISOString(),
              offsetMs: record.startMs,
              status: 'interrupted',
              error: 'Fala preservada após a interrupção; não foi processada.',
            });
            if (!renderFrame) renderFrame = requestAnimationFrame(render);
          }
        } catch (error) {
          notice(cleanError(error));
          stopMic();
          break;
        }
      }
      const interim = ledger.records
        .filter(r => r.status === 'interim')
        .map(r => r.text)
        .join(' ');
      showInterim(interim.trim().split(/\s+/u).slice(-18).join(' '));
      recognitionWindow?.activity(!!interim.trim());
      if (interim.trim()) controller?.heard?.();
      current.speech_ledger = ledger.snapshot();
      saveSoon();
    }
    // The line still being said, in the same place and shape as a finished one.
    function showInterim(text) {
      const row = $('roomInterim'),
        scroller = row.closest('.room-transcript-scroll'),
        follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70;
      row.hidden = !text;
      if (!text) return;
      row.querySelector('time').textContent = clock(elapsed());
      $('roomInterimName').textContent = integrated?.user?.name || 'Fala';
      $('roomInterimText').textContent = text;
      if (follow) scroller.scrollTop = scroller.scrollHeight;
    }
    function launchRecognition() {
      if (!listening || micStopping || recognition) return;
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const instance = new Recognition();
      recognition = instance;
      instance.lang = $('roomLanguage').value;
      instance.continuous = true;
      instance.interimResults = true;
      ledger.beginRun();
      const capture = new NorteWindows.CaptureWindow({
        maxPendingMs: 10000,
        onBoundary: () => {
          if (instance !== recognition) return;
          // The final result is still accepted after stop.
          recognitionDeadline = setTimeout(() => {
            if (instance !== recognition) return;
            try {
              instance.abort();
            } catch (_) {}
            setTimeout(() => {
              if (instance === recognition) instance.onend();
            }, 0);
          }, 6000);
          try {
            instance.stop();
          } catch (_) {
            instance.onend();
          }
        },
      });
      recognitionWindow = capture;
      instance.onstart = () => {
        if (instance !== recognition) return;
        if (capture.startedAt === null) capture.start();
      };
      instance.onspeechstart = () => {
        if (instance === recognition) ledger.speechStart(elapsed());
      };
      instance.onresult = event => {
        if (instance !== recognition) return;
        ingestSpeech(event);
      };
      instance.onerror = event => {
        if (instance !== recognition || event.error === 'no-speech' || (event.error === 'aborted' && micStopping))
          return;
        listening = false;
        micPaused = true;
        notice(
          {
            'not-allowed': 'O microfone não foi autorizado. Permita o acesso no navegador ou importe uma transcrição.',
            'audio-capture': 'Não foi possível acessar o microfone. Confira o dispositivo.',
            network: 'A transcrição perdeu a conexão. Você pode retomar o microfone ou continuar por texto.',
            'service-not-allowed':
              'Este navegador não autorizou a transcrição. Use um navegador compatível ou importe o texto.',
          }[event.error] || 'A captura de fala foi interrompida. Você pode retomar o microfone.',
        );
        controls();
      };
      instance.onend = () => {
        if (instance !== recognition) return;
        capture.end();
        clearTimeout(recognitionDeadline);
        recognitionDeadline = null;
        recognitionWindow = null;
        ledger.finishRun();
        if (current) {
          current.speech_ledger = ledger.snapshot();
          saveSoon();
        }
        showInterim('');
        recognition = null;
        if (!renderFrame) renderFrame = requestAnimationFrame(render);
        micEnd?.();
        micEnd = null;
        if (listening && controller?.accepting) restartTimer = setTimeout(() => launchRecognition(), 0);
        controls();
      };
      try {
        instance.start();
        capture.start();
      } catch (error) {
        capture.end();
        listening = false;
        micPaused = true;
        recognition = null;
        recognitionWindow = null;
        notice('Não foi possível iniciar o microfone. Você pode importar a transcrição.');
        controls();
      }
    }
    function stopMic() {
      if (stopPromise) return stopPromise;
      listening = false;
      micPaused = true;
      clearTimeout(restartTimer);
      if (!recognition) {
        controls();
        return Promise.resolve();
      }
      micStopping = true;
      controls();
      const instance = recognition;
      stopPromise = new Promise(resolve => {
        let timer,
          ended = false;
        const done = () => {
          if (ended) return;
          ended = true;
          clearTimeout(timer);
          micEnd = null;
          resolve();
        };
        micEnd = done;
        timer = setTimeout(() => {
          try {
            instance.abort();
          } catch (_) {}
          if (recognition === instance) {
            ledger.finishRun();
            current.speech_ledger = ledger.snapshot();
            recognition = null;
            saveSoon();
          }
          notice('A captura demorou a encerrar. Falas sem confirmação permanecem no registro de áudio.');
          done();
        }, 6000);
        try {
          if (recognitionWindow) recognitionWindow.request('manual');
          else instance.stop();
        } catch (_) {
          if (recognition === instance) {
            ledger.finishRun();
            current.speech_ledger = ledger.snapshot();
            recognition = null;
            saveSoon();
          }
          done();
        }
      }).finally(() => {
        micStopping = false;
        stopPromise = null;
        controls();
      });
      return stopPromise;
    }
    async function toggleRecording() {
      if (!canWrite()) return;
      if (micStopping || closing || starting) return;
      if (controller?.accepting && mode === 'text') {
        if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
          notice('Este navegador não oferece transcrição por voz. Continue por texto ou use um navegador compatível.');
          return;
        }
        mode = 'live';
        current.input_mode = 'live';
        ledger = new NorteTranscript.Ledger();
        consumed = new Set();
      }
      if (listening) {
        await stopMic();
        controls();
        return;
      }
      if (controller?.accepting && mode === 'live') {
        notice('');
        listening = true;
        micPaused = false;
        launchRecognition();
        controls();
        return;
      }
      if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
        notice(
          'A fala ao vivo não está disponível neste navegador. Use Chrome com microfone habilitado ou importe uma transcrição.',
        );
        return;
      }
      if (!(await begin('live'))) return;
      ledger = new NorteTranscript.Ledger();
      consumed = new Set();
      listening = true;
      micPaused = false;
      launchRecognition();
      controls();
    }
    $('roomLive').onclick = toggleRecording;
    $('roomMic').onclick = toggleRecording;
    $('roomFinish').onclick = async () => {
      if (!controller || closing) return;
      closing = true;
      controls();
      try {
        await stopMic();
        await controller.close();
        await save();
        void finishMinutes();
      } catch (error) {
        notice(cleanError(error));
        controller?.stop(error);
      } finally {
        closing = false;
        render();
      }
    };
    $('roomStop').onclick = async () => {
      if (!controller || closing) return;
      closing = true;
      controls();
      try {
        controller.stop();
        await controller.done;
        await save();
      } finally {
        closing = false;
        render();
      }
    };
    $('roomNew').onclick = () => {
      $('roomCreateMenu').hidden = !$('roomCreateMenu').hidden;
      $('roomNew').setAttribute('aria-expanded', String(!$('roomCreateMenu').hidden));
      if (!$('roomCreateMenu').hidden) $('roomCreateInstant').focus();
    };
    $('roomCreateInstant').onclick = createInstant;
    $('roomBack').onclick = showLibrary;
    document.addEventListener('click', event => {
      if (
        !$('roomCreateMenu').hidden &&
        !$('roomCreateMenu').contains(event.target) &&
        !$('roomNew').contains(event.target)
      ) {
        $('roomCreateMenu').hidden = true;
        $('roomNew').setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('roomCreateMenu').hidden) {
        $('roomCreateMenu').hidden = true;
        $('roomNew').setAttribute('aria-expanded', 'false');
        $('roomNew').focus();
      }
    });
    window.addEventListener('norte:page-changed', renderView);
    window.addEventListener('popstate', followReference);
    window.addEventListener('hashchange', followReference);
    // Account saves travel over the network: closing the page mid-save would drop the end of the meeting.
    window.addEventListener('beforeunload', e => {
      if (isRunning() || savesPending) {
        e.preventDefault();
        e.returnValue = '';
      }
      save();
    });
    setInterval(() => {
      if (current && view === 'room') controls();
    }, 1000);
    window.NorteMeetingRoom = {
      isRunning,
      snapshot,
      flushStorage: save,
      ready: () => ready,
      view: () => ((current?.room_kind || 'meeting') === roomKind() ? view : 'library'),
      openMeeting,
    };
    controls();
    if (inAccount) $('roomSave').textContent = 'Na sua conta';
    try {
      db = integrated
        ? integrated.storage
        : inAccount
          ? await NorteRemoteStorage.open()
          : await NorteMemoryStorage.open();
      history = JSON.parse((await db.read(INDEX)) || '[]');
    } catch (error) {
      notice(cleanError(error));
    }
    initialized = true;
    renderLibrary();
    renderView();
    render();
    void checkHealth();
    if (integrated) {
      let remoteFingerprint = '';
      integrated.attach({
        snapshot,
        save,
        notice,
        accepting: () => canWrite() && !!controller?.accepting,
        pending: rows => {
          pendingContributions = rows;
          lastTranscript = '';
          renderTranscript();
        },
        title: value => {
          if (current) {
            current.title = value;
            $('roomTitle').value = value;
            saveSoon();
          }
        },
        audioMute: muted => {
          if (muted && listening) void stopMic();
        },
        contribute: async (row, segmentId) => {
          if (!canWrite() || !controller?.accepting) return;
          const participant = integrated.meeting.participants?.find(item => item.userId === row.userId);
          appendTurn(
            { text: row.text, segmentId, speaker: row.name || participant?.name || 'Participante' },
            'participant',
          );
        },
        remote: run => {
          if (integrated.host || run.id !== integrated.meeting.id) return;
          const fingerprint = JSON.stringify(run);
          if (fingerprint === remoteFingerprint) return;
          remoteFingerprint = fingerprint;
          current = integrated.view(run);
          controller = null;
          $('roomTitle').value = current.title;
          view = 'room';
          renderView();
          render();
        },
      });
      window.addEventListener('norte:meeting-conflict', () => {
        controller?.stop(Error('A reunião mudou em outra aba. Recarregue para continuar.'));
        void stopMic();
        notice(
          'A reunião mudou em outra aba. O processamento foi interrompido; recarregue a página para continuar com a versão salva.',
        );
        controls();
      });
    }
    await followReference();
  }
})();
