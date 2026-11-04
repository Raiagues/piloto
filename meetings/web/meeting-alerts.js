/* The room's alert monitor. While a meeting runs each new sentence goes to JEV on its own lane; a finding is saved in
   the run, marked in the speech and listed in the Alertas tab with the same structure as the requirement findings. */
(function (root) {
  'use strict';
  const LABELS = { critical: 'Pendência crítica', warning: 'Revisar' };
  const code = position => 'A' + String(position).padStart(2, '0');
  const kept = (text, item) => text.slice(item.start, item.end) === item.affectedText;

  function create(room) {
    const { el, button, clock } = room;
    let busy = false,
      stopped = '',
      analyzing = null,
      history = null,
      referenceFor,
      signature = '';

    const send = request => root.NorteClassifier.requestHighlight(request, room.provider);
    const spoken = () =>
      room
        .turns()
        .filter(turn => !turn.command && turn.entries.every(id => !/^(?:PENDING|UNCONFIRMED)-/.test(id)))
        .map(turn => ({ key: turn.key, speaker: turn.speaker, offsetMs: turn.offsetMs, text: turn.text.join(' ') }));

    // The table of annex items lives with the requirement rules; a room without it keeps the general reference.
    async function prepare() {
      if (referenceFor === undefined)
        referenceFor = await import('./regulatory-references.mjs').then(
          module => module.regulatoryReferenceFor,
          () => null,
        );
      if (history === null) history = await room.projectStatements().catch(() => []);
    }
    function ledger(run) {
      run.highlights ||= { version: root.NorteJevQuestions.highlightVersion, sentences: 0, calls: 0, findings: [] };
      run.highlights.seen ||= run.highlights.findings.map(item => item.id.split(':')[0]);
      return run.highlights;
    }
    async function reviewNext(run, list, index) {
      const state = ledger(run),
        sentence = list[index],
        started = Date.now();
      const result = await root.NorteMeetingHighlights.review(
        sentence,
        root.NorteMeetingHighlights.contextOf(list, index, history),
        send,
        referenceFor,
      );
      state.calls += result.calls;
      if (result.finding)
        state.findings.push({
          ...result.finding,
          code: code(state.findings.length + 1),
          noticeMs: room.elapsed() ?? (sentence.offsetMs || 0) + Date.now() - started,
        });
      state.seen.push(sentence.id);
      state.sentences = state.seen.length;
      return !!result.finding;
    }
    /** Runs after every render: reads whatever was said since the last pass, one sentence at a time. */
    async function tick() {
      if (busy || stopped || !room.monitoring()) return;
      const run = room.current;
      busy = true;
      try {
        await prepare();
        for (;;) {
          const list = root.NorteMeetingHighlights.sentences(spoken()),
            seen = new Set(ledger(run).seen),
            index = list.findIndex(sentence => !seen.has(sentence.id));
          if (index < 0 || room.current !== run) break;
          if (await reviewNext(run, list, index)) room.refreshTranscript();
          refresh();
          room.saveSoon();
        }
      } catch (error) {
        stopped = 'O monitor parou nesta reunião: ' + room.cleanError(error);
        refresh();
      } finally {
        busy = false;
      }
    }
    async function analyzeAll() {
      analyzing = { done: 0, total: 0 };
      stopped = '';
      refresh();
      try {
        await prepare();
        const { trace: _trace, ...result } = await root.NorteMeetingHighlights.analyze(
          spoken(),
          send,
          progress => {
            analyzing = progress;
            refresh();
          },
          { history, referenceFor },
        );
        room.current.highlights = {
          ...result,
          findings: result.findings.map((item, index) => ({ ...item, code: code(index + 1) })),
          analyzedAt: new Date().toISOString(),
        };
        await room.save();
      } catch (error) {
        room.notice(room.cleanError(error));
      } finally {
        analyzing = null;
        refresh();
        room.render();
      }
    }

    function open(id) {
      room.showBoard('alerts');
      const card = [...room.host.querySelectorAll('[data-finding]')].find(node => node.dataset.finding === id);
      card?.scrollIntoView({ block: 'center' });
      card?.classList.add('is-referenced');
      setTimeout(() => card?.classList.remove('is-referenced'), 2400);
    }
    const findingsOf = turn =>
      (room.current?.highlights?.findings || []).filter(
        item => item.turnKey === turn.key && kept(turn.text.join(' '), item),
      );
    /** A speech with its marks. A mark is shown only while its offsets still point to the same words. */
    function speechText(turn) {
      const text = turn.text.join(' '),
        row = el('p', 'room-speech-text'),
        findings = findingsOf(turn);
      if (!findings.length) row.textContent = text;
      for (const piece of findings.length ? root.NorteMeetingHighlights.segments(text, findings) : []) {
        const [finding] = piece.findings;
        if (!finding) {
          row.append(piece.text);
          continue;
        }
        const mark = el('mark', 'room-mark ' + finding.severity, piece.text);
        mark.tabIndex = 0;
        mark.title = finding.title;
        mark.onclick = () => open(finding.id);
        mark.onkeydown = event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          open(finding.id);
        };
        row.append(mark);
      }
      return row;
    }
    /** The line under a marked speech, as in the monitor's transcript: code, category and when it warned. */
    function monitorLines(turn) {
      return findingsOf(turn).map(finding => {
        const line = button('', () => open(finding.id), 'room-monitor ' + finding.severity);
        line.append(el('b', '', 'Monitor ' + (finding.code || '')), el('span', '', finding.title));
        if (Number.isFinite(finding.noticeMs)) line.append(el('span', '', 'Aviso em ' + clock(finding.noticeMs)));
        return line;
      });
    }

    function judge(id, verdict) {
      const run = room.current;
      run.highlight_feedback = { ...run.highlight_feedback };
      if (run.highlight_feedback[id]?.verdict === verdict) delete run.highlight_feedback[id];
      else run.highlight_feedback[id] = { verdict, at: new Date().toISOString() };
      refresh();
      room.saveSoon();
    }
    function exportCorrections() {
      const run = room.current,
        corrections = run.highlights.findings
          .filter(item => run.highlight_feedback?.[item.id])
          .map(item => ({
            ruleId: item.ruleId,
            sentence: item.affectedText,
            verdict: run.highlight_feedback[item.id].verdict,
          }));
      const link = el('a');
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify({ version: run.highlights.version, corrections }, null, 2)], {
          type: 'application/json',
        }),
      );
      link.download = 'correcoes-alertas.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
    function proof(items) {
      const box = el('div', 'room-finding-proof');
      box.append(el('strong', '', 'Prova'));
      for (const item of items) {
        const who = [item.meeting, item.speaker, item.time].filter(Boolean).join(' · '),
          quote = who + ': “' + item.quote + '”';
        box.append(
          item.turnKey ? button(quote, () => room.focusTurn(item.turnKey), 'room-finding-quote') : el('p', '', quote),
        );
      }
      return box;
    }
    function referenceLink({ source, title, section, page, url }) {
      const link = el('a', '', [source || title, section, page && 'p. ' + page].filter(Boolean).join(' · ') + ' ↗');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      return link;
    }
    function card(finding) {
      const verdict = room.current.highlight_feedback?.[finding.id]?.verdict,
        box = el('article', 'room-finding ' + finding.severity);
      box.dataset.finding = finding.id;
      box.append(
        el('span', 'room-finding-label', [finding.code, LABELS[finding.severity]].filter(Boolean).join(' · ')),
        el('h3', '', finding.title),
        button('“' + finding.affectedText + '”', () => room.focusTurn(finding.turnKey), 'room-finding-quote'),
        el('small', '', [finding.speaker, finding.time].filter(Boolean).join(' · ')),
        el('p', '', finding.comment || finding.explanation),
      );
      const next = el('p');
      next.append(el('strong', '', 'Próximo passo: '), finding.suggestion);
      box.append(next);
      if (finding.evidence.length) box.append(proof(finding.evidence));
      if (finding.reference) box.append(referenceLink(finding.reference));
      box.append(el('small', '', 'Triagem de texto; a aplicabilidade precisa de revisão humana.'));
      if (room.canCorrect()) {
        const actions = el('div', 'room-finding-actions');
        for (const [value, label] of [
          ['confirmed', 'Procede'],
          ['rejected', 'Não procede'],
        ]) {
          const choice = button(label, () => judge(finding.id, value));
          choice.setAttribute('aria-pressed', String(verdict === value));
          actions.append(choice);
        }
        box.append(actions);
      } else if (verdict)
        box.append(
          el('small', '', verdict === 'confirmed' ? 'Marcado como procedente.' : 'Marcado como não procedente.'),
        );
      return box;
    }

    function introText(result) {
      if (analyzing)
        return analyzing.total
          ? 'Lendo a frase ' + Math.min(analyzing.done + 1, analyzing.total) + ' de ' + analyzing.total + '.'
          : 'Preparando as frases.';
      if (stopped) return stopped;
      if (!room.meetingEnded())
        return result?.findings.length
          ? 'O monitor lê cada frase enquanto a reunião acontece.'
          : 'O monitor lê cada frase enquanto a reunião acontece. Nenhum alerta até agora.';
      if (!result) return 'O JEV lê cada frase da transcrição e aponta o trecho que merece revisão. Nada é enviado antes deste clique.';
      return (
        result.findings.length +
        (result.findings.length === 1 ? ' alerta em ' : ' alertas em ') +
        result.sentences +
        ' frases.'
      );
    }
    function intro(result) {
      const box = el('div', 'room-alerts-intro');
      box.append(el('p', '', introText(result)));
      if (!analyzing && room.canCorrect())
        box.append(button(result ? 'Analisar de novo' : 'Analisar falas', analyzeAll));
      return box;
    }
    // Conflicts and open points of the records: they need a person, so they appear once the meeting is over.
    function attention(state) {
      const conflicts = (state?.alerts || []).filter(item => item.kind !== 'pending'),
        pending = state?.pending || [],
        parts = [];
      const row = (kind, entry, text, reason, issues) => {
        const item = button(
          '',
          () => {
            if (entry) room.focusEntry(entry.id, entry.topic_id);
            room.inspect({
              eventIds: [...new Set([entry?.id, ...issues.flatMap(issue => issue.event_ids || [])].filter(Boolean))],
              relationIds: [...new Set(issues.flatMap(issue => issue.relation_ids || []))],
              issues,
            });
          },
          'room-attention-item',
        );
        item.dataset.kind = kind;
        item.append(
          el('small', '', entry ? room.topicName(entry.topic_id, state) : 'Dependência'),
          el('span', '', text),
          el('small', '', reason),
        );
        return item;
      };
      if (conflicts.length) parts.push(el('h3', 'room-alerts-section', 'Conflitos nos registros · ' + conflicts.length));
      for (const alert of conflicts) {
        const affected = (alert.event_ids || []).map(id => state.byId[id]).filter(Boolean),
          entry = affected.find(item => item.status === alert.kind) || affected[0];
        parts.push(
          row(
            alert.kind,
            entry,
            entry?.text || alert.message,
            { conflict: 'Conflito', error: 'Erro' }[alert.kind] || 'Revisar',
            [alert],
          ),
        );
      }
      if (pending.length) parts.push(el('h3', 'room-alerts-section', 'Informações pendentes · ' + pending.length));
      for (const entry of pending)
        parts.push(
          row(
            'pending',
            entry,
            entry.text,
            entry.reasons[0] || 'Ainda sem fechamento registrado.',
            entry.alerts?.length
              ? entry.alerts
              : entry.reasons.map(message => ({ message, event_ids: [entry.id], relation_ids: [] })),
          ),
        );
      return parts;
    }
    function refresh() {
      const run = room.current,
        result = run?.highlights;
      root.document.getElementById('roomAlertCount').textContent = result?.findings.length || '';
      if (!run || room.boardView() !== 'alerts') return;
      const state = room.meetingEnded() ? room.meetingState() : null,
        next = JSON.stringify([
          run.id,
          result?.findings,
          run.highlight_feedback,
          analyzing,
          stopped,
          room.meetingEnded(),
          room.canCorrect(),
          state?.alerts,
          state?.pending?.map(item => [item.id, item.text, item.reasons]),
        ]);
      if (next === signature) return;
      signature = next;
      const cards = (result?.findings || []).map(card),
        parts = [intro(result), ...cards];
      if (cards.length)
        parts.push(el('small', 'room-alerts-legal', 'Hipóteses de triagem. Não são conclusão jurídica nem prova de embargo.'));
      if (room.canCorrect() && Object.keys(run.highlight_feedback || {}).length)
        parts.push(button('Exportar correções', exportCorrections));
      room.host.replaceChildren(...parts, ...attention(state));
    }
    return { tick, refresh, speechText, monitorLines };
  }
  root.NorteMeetingAlerts = { create };
})(globalThis);
