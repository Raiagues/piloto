/* Compact, navigable projection of the meeting's classified hierarchy. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteMeetingCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const relationLabels = {
    tests: 'avalia',
    result_of: 'resultado de',
    depends_on: 'depende de',
    affects: 'afeta',
    based_on: 'baseia-se em',
    supports: 'sustenta',
    contradicts: 'contradiz',
    supersedes: 'substitui',
  };
  const statusLabels = {
    active: 'Registrado',
    registered: 'Registrado',
    open: 'Aberto',
    completed: 'Concluído',
    review: 'Revisar',
    conflict: 'Conflito',
    error: 'Erro',
    superseded: 'Substituído',
  };
  // Mirrors the editorial eligibility (EDITORIAL_MIN) in meetings/engine/block_agents.py.
  const editorialDraft = text => typeof text === 'string' && text.length >= 60 && text.length <= 4000;
  function meetingState() {
    if (root.NorteMeetingState) return root.NorteMeetingState;
    if (typeof require === 'function') {
      try {
        return require('./meeting-state.js');
      } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
      }
    }
    return null;
  }
  // The validated synthesis of a generated minutes document belongs to the exact source text.
  function minutesSummaries(run) {
    const found = new Map(),
      seen = new WeakSet();
    const visit = value => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      const event = value.event && typeof value.event === 'object' ? value.event : value,
        id = event.event_id;
      if (
        typeof id === 'string' &&
        typeof value.display_text === 'string' &&
        value.display_text.trim() &&
        typeof event.text === 'string' &&
        !found.has(id)
      )
        found.set(id, { text: value.display_text.trim(), source: event.text });
      for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
    };
    visit(run?.minutes_document?.doc?.topics);
    return found;
  }
  function build(sourceRun) {
    const editor = root.NorteMeetingBlocks || (typeof require === 'function' ? require('./meeting-blocks.js') : null);
    const hierarchy =
      root.NorteMeetingHierarchy || (typeof require === 'function' ? require('./meeting-hierarchy.js') : null);
    const evidence =
      root.NorteMeetingEvidence || (typeof require === 'function' ? require('./meeting-evidence.js') : null);
    if (!hierarchy || !evidence) throw Error('A organização dos assuntos ainda não está disponível.');
    const amendments =
        root.NorteMeetingAmendments || (typeof require === 'function' ? require('./meeting-amendments.js') : null),
      revised = sourceRun.post_meeting_edits?.length ? amendments?.build(sourceRun) : null;
    const projected = evidence.project(revised?.source || sourceRun),
      run = projected.run,
      sharedState = revised?.state || meetingState()?.build(sourceRun),
      original = hierarchy.build(run),
      nodes = new Map(),
      review = [],
      edges = [],
      seen = new Set(),
      minutes = minutesSummaries(sourceRun);
    const visit = node => {
      const issues = (projected.diagnostics?.events?.[node.id] || []).map(issue => ({
        ...issue,
        event_ids: [node.id],
        relation_ids: [],
      }));
      nodes.set(node.id, {
        ...node,
        event: { ...node.event },
        parent_id: null,
        parent_relation_id: null,
        children: [],
        links: [],
        review: issues,
      });
      const suggestion = sourceRun.block_review?.blocks?.[node.id],
        summary = minutes.get(node.id);
      if (editor?.valid(suggestion, sourceRun, 'block', node.id)) {
        nodes.get(node.id).display_text = suggestion.text;
        nodes.get(node.id).editorial = suggestion.origin;
      } else if (summary && summary.source === node.text) {
        nodes.get(node.id).display_text = summary.text;
        nodes.get(node.id).editorial = 'minutes';
      }
      const manual = editor?.manual(sourceRun, node.id);
      if (manual) {
        nodes.get(node.id).display_text = manual.text;
        nodes.get(node.id).editorial = 'human';
      }
      review.push(...issues);
      for (const child of node.children) visit(child);
    };
    for (const topic of original.topics) topic.nodes.forEach(visit);
    const high = value => Number.isFinite(value) && value > 0.8;
    for (const [index, edge] of (run.meeting_relations || []).entries()) {
      if (!edge) continue;
      const source = nodes.get(edge.source_event_id || edge.source_id || edge.event_id),
        target = nodes.get(edge.target_event_id || edge.target_id),
        type = edge.relation_type;
      if (
        !relationLabels[type] ||
        !source ||
        !target ||
        source === target ||
        !source.event.thread_id ||
        source.event.thread_id !== target.event.thread_id ||
        !high(edge.relation_probability)
      )
        continue;
      const id = edge.relation_id || edge.id || 'direct-' + index;
      const configSafe =
        type === 'result_of'
          ? edge.configuration_match === 'exact'
          : ['exact', 'not_applicable', ...(type === 'supersedes' ? ['partial', 'mismatch'] : [])].includes(
              edge.configuration_match,
            ) ||
            (edge.configuration_applicable === false && edge.configuration_match == null);
      const confirmed = edge.review_state === 'confirmed' && !edge.error && high(edge.match_probability) && configSafe;
      if (type === 'result_of' && (source.type !== 'test_result' || target.type !== 'test_proposal')) continue;
      const needsReview =
        !!edge.error || ['pending', 'uncertain', 'needs_review'].includes(edge.review_state) || !configSafe;
      if (!confirmed && !needsReview) continue;
      // A low-probability relation is omitted. Explicit uncertainty about a
      // confidently identified relation/configuration belongs on its edge.
      if (
        edge.match_probability != null &&
        !high(edge.match_probability) &&
        !edge.error &&
        edge.configuration_match !== 'uncertain' &&
        edge.configuration_match !== 'ambiguous'
      )
        continue;
      const key = [source.id, target.id, type].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const issues = [];
      if (!confirmed) {
        const message = edge.error
          ? 'Não foi possível concluir a análise deste vínculo.'
          : edge.configuration_match === 'mismatch'
            ? 'O resultado usa uma configuração diferente do teste planejado.'
            : edge.configuration_match === 'partial'
              ? 'Faltam condições do teste para confirmar este vínculo.'
              : edge.configuration_match === 'ambiguous' || edge.configuration_match === 'uncertain'
                ? 'Não está claro a qual configuração este resultado se refere.'
                : 'Este vínculo ainda aguarda confirmação.';
        const issue = {
          id: 'relation:' + id,
          message,
          event_ids: [source.id, target.id],
          relation_ids: [id],
          kind: edge.error ? 'error' : 'review',
        };
        issues.push(issue);
        review.push(issue);
      }
      const link = {
        id,
        source_id: source.id,
        target_id: target.id,
        type,
        label: relationLabels[type],
        thread_id: source.event.thread_id,
        source_text: source.text,
        target_text: target.text,
        review_state: confirmed ? 'confirmed' : 'pending',
        error: edge.error || null,
        issues,
      };
      edges.push(link);
      source.links.push(link);
      target.links.push(link);
    }
    const superseded = new Set(
      sharedState
        ? Object.values(sharedState.byId || {})
            .filter(entry => entry.status === 'superseded')
            .map(entry => entry.id)
        : edges
            .filter(link => link.type === 'supersedes' && link.review_state === 'confirmed')
            .map(link => link.target_id),
    );
    for (let index = edges.length - 1; index >= 0; index--) {
      const link = edges[index];
      if (superseded.has(link.source_id) && link.type !== 'supersedes') {
        edges.splice(index, 1);
        nodes.get(link.source_id).links = nodes.get(link.source_id).links.filter(item => item !== link);
        nodes.get(link.target_id).links = nodes.get(link.target_id).links.filter(item => item !== link);
      }
    }
    const resultParents = new Map();
    for (const link of edges)
      if (link.type === 'result_of' && link.review_state === 'confirmed') {
        if (!resultParents.has(link.source_id)) resultParents.set(link.source_id, []);
        resultParents.get(link.source_id).push(link);
      }
    for (const [id, parents] of resultParents) {
      const node = nodes.get(id);
      if (parents.length === 1) {
        node.parent_id = parents[0].target_id;
        node.parent_relation_id = parents[0].id;
        nodes.get(node.parent_id).children.push(node);
      } else
        for (const link of parents) {
          link.review_state = 'pending';
          const issue = {
            id: 'result-parent:' + link.id,
            message: 'Este resultado aponta para mais de um teste. Confirme qual teste foi executado.',
            event_ids: [id, link.target_id],
            relation_ids: [link.id],
            kind: 'review',
          };
          link.issues.push(issue);
          review.push(issue);
        }
    }
    for (const node of nodes.values()) {
      const state = sharedState?.byId?.[node.id];
      node.completed = state
        ? !!state.completed
        : node.type === 'test_proposal' &&
          !superseded.has(node.id) &&
          edges.some(
            link => link.type === 'result_of' && link.target_id === node.id && link.review_state === 'confirmed',
          );
      node.status =
        state?.status ||
        (superseded.has(node.id)
          ? 'superseded'
          : node.completed
            ? 'completed'
            : ['observation', 'hypothesis', 'test_proposal'].includes(node.type)
              ? 'open'
              : 'registered');
      // Shared state determines semantic closure. An isolated result or an
      // unrelated decision never closes a problem simply by sharing a topic.
      // Classification diagnostics stay on cards; link diagnostics stay edges.
      node.canvas_status =
        node.status === 'superseded'
          ? 'superseded'
          : node.review.some(issue => issue.kind === 'error')
            ? 'error'
            : node.review.length
              ? 'review'
              : node.status;
      node.status_label =
        (state?.status === node.canvas_status && state.state_label) ||
        statusLabels[node.canvas_status] ||
        statusLabels.registered;
      node.resolved = !!state?.resolved;
      node.blocked = !!state?.blocked;
      node.blocked_by = state?.blocked_by || [];
      node.state_reasons = state?.reasons || [];
      const inspectionIssues = [...node.review, ...(state?.alerts || [])],
        messages = new Set(inspectionIssues.map(issue => issue.message));
      for (const [index, message] of node.state_reasons.entries())
        if (!messages.has(message)) {
          inspectionIssues.push({
            id: 'state-reason:' + node.id + ':' + index,
            message,
            kind: 'info',
            event_ids: [node.id],
            relation_ids: state?.relation_ids || [],
          });
          messages.add(message);
        }
      node.inspection = {
        issues: [...new Map(inspectionIssues.map(issue => [issue.message, issue])).values()],
        eventIds: [...new Set([node.id, ...inspectionIssues.flatMap(issue => issue.event_ids || [])])],
        relationIds: [...new Set(inspectionIssues.flatMap(issue => issue.relation_ids || []))],
      };
    }
    const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
    const topics = original.topics.map(topic => {
      const members = (run.meeting_events || [])
        .filter(event => (event.thread_id || null) === (topic.id || null))
        .map(event => nodes.get(event.event_id))
        .filter(Boolean);
      const roots = members.filter(node => !node.parent_id),
        columns = { problems: [], hypotheses: [], tests: [], details: [] };
      for (const node of roots)
        columns[
          node.type === 'observation'
            ? 'problems'
            : node.type === 'hypothesis'
              ? 'hypotheses'
              : ['test_proposal', 'test_result'].includes(node.type)
                ? 'tests'
                : 'details'
        ].push(node);
      const thread = (run.meeting_threads || []).find(thread => thread.thread_id === topic.id),
        manual = clean(run.topic_titles?.[topic.id]) || clean(thread?.title),
        suggestion = sourceRun.block_review?.titles?.[topic.id];
      const editorial = !manual && editor?.valid(suggestion, sourceRun, 'title', topic.id),
        title = manual || (editorial ? clean(suggestion.text) : '');
      return {
        ...topic,
        title,
        editorial: !!editorial,
        nodes: roots,
        columns,
        edges: edges.filter(edge => edge.thread_id === topic.id),
        review: review.filter(item => item.event_ids.some(id => members.some(node => node.id === id))),
      };
    });
    return {
      topics,
      edges,
      review,
      excluded: projected.excluded || [],
      state: sharedState || null,
      metrics: {
        topics: topics.length,
        events: nodes.size,
        nested: [...nodes.values()].filter(node => node.parent_id).length,
        edges: edges.length,
        reviews: review.length,
      },
    };
  }

  // Topics stacked in one scrolling column, as in the landing example. Editing controls exist only while canEdit() is true.
  function create({
    canvas,
    board,
    onRename = () => {},
    onInspect = () => {},
    onReview = null,
    canEdit = () => !!onReview,
  } = {}) {
    if (!canvas || !board || !canvas.contains(board)) throw Error('Informe o canvas e seu quadro de assuntos.');
    const document = canvas.ownerDocument,
      view = document.defaultView || root;
    const collapsed = new Set(),
      warnings = new Set(),
      known = new Set();
    let signature = '',
      runId = null,
      projection = null;
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icon = (text, label, className) => {
      const button = element('button', className, text);
      button.type = 'button';
      button.title = label;
      button.setAttribute('aria-label', label);
      return button;
    };
    const svgIcon = (button, markup) => {
      button.innerHTML = markup;
      return button;
    };
    const inspect = node =>
      onInspect({
        kind: 'event',
        event_id: node.id,
        issues: node.inspection.issues,
        eventIds: [...node.inspection.eventIds],
        relationIds: [...node.inspection.relationIds],
      });

    function warning(node) {
      const detail = element('details', 'room-warning'),
        summary = element('summary'),
        content = element('div', 'mc-warning-content');
      summary.innerHTML =
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 19 18H1Z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10 7v5m0 2v1" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
      summary.setAttribute('aria-label', 'Ver pontos para revisão');
      summary.title = 'Ver pontos para revisão';
      content.append(element('strong', '', 'Revisar classificação'));
      for (const message of new Set(node.review.map(item => item.message))) content.append(element('p', '', message));
      const explore = icon('Ver detalhes', 'Abrir detalhes da classificação', 'mc-inspect');
      explore.addEventListener('click', () => onInspect({ kind: 'event', event_id: node.id, issues: node.review }));
      content.append(explore);
      detail.open = warnings.has(node.id);
      detail.append(summary, content);
      detail.addEventListener('toggle', () => (detail.open ? warnings.add(node.id) : warnings.delete(node.id)));
      return detail;
    }
    // A confirmed relation reads as a line under the record; one under review opens its diagnosis.
    function relationLine(link) {
      const line = element('button', 'mc-node-relation', '↳ ' + link.label);
      line.type = 'button';
      line.dataset.state = link.review_state;
      line.title = link.source_text + ' → ' + link.target_text;
      line.addEventListener('click', () =>
        onInspect({
          kind: 'relation',
          issues: link.issues,
          eventIds: [link.source_id, link.target_id],
          relationIds: [link.id],
        }),
      );
      return line;
    }
    function nodeCard(node, depth = 0) {
      const card = element('article', 'room-node'),
        header = element('header', 'room-node-header'),
        editable = onReview && canEdit();
      Object.assign(card.dataset, {
        eventId: node.id,
        type: node.type,
        status: node.status,
        canvasStatus: node.canvas_status,
        depth: String(depth),
      });
      if (!known.has(node.id)) {
        card.classList.add('mc-new');
        known.add(node.id);
      }
      header.append(
        element('span', 'room-node-label', node.type === 'observation' ? 'Problema' : node.label),
        element('span', 'room-node-state', node.status_label),
      );
      if (node.review.length && canEdit()) header.append(warning(node));
      if (editable) {
        const edit = svgIcon(
          icon('', 'Editar texto do bloco', 'mc-editorial'),
          '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="m10.5 2.5 3 3-8 8-3.5.5.5-3.5zM9 4l3 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
        );
        edit.onclick = () => onReview('block', node.id);
        header.append(edit);
      }
      card.classList.toggle('mc-draft', !node.editorial && editorialDraft(node.text));
      card.append(header, element('p', 'mc-writing', 'escrevendo nota…'));

      const read = element('button', 'mc-node-text'),
        copy = element('span', 'mc-node-copy');
      const text = node.display_text ?? node.text,
        points = text
          .split(/\n+/)
          .map(line => line.trim().replace(/^[•-]\s*/, ''))
          .filter(Boolean);
      if (node.editorial && points.length > 1) {
        const list = element('ul', 'mc-node-points');
        for (const point of points) list.append(element('li', '', point));
        copy.append(list);
      } else copy.textContent = text;
      copy.classList.toggle('mc-node-excerpt', !node.editorial && text.length > 180);
      read.type = 'button';
      read.setAttribute('aria-label', 'Mostrar registro completo: ' + node.text);
      read.append(copy);
      // After the meeting a double-click edits, so a single click waits briefly before opening the details.
      let pending = 0;
      read.addEventListener('click', event => {
        if (!editable) {
          inspect(node);
          return;
        }
        view.clearTimeout(pending);
        if (event.detail < 2) pending = view.setTimeout(() => inspect(node), 260);
      });
      if (editable) {
        read.title = 'Clique para ver detalhes · duplo clique para editar';
        read.addEventListener('dblclick', event => {
          event.preventDefault();
          view.clearTimeout(pending);
          onReview('block', node.id);
        });
      }
      card.append(read);
      for (const link of node.links)
        if (link.source_id === node.id && link.id !== node.parent_relation_id) card.append(relationLine(link));

      if (node.children.length) {
        const children = element('div', 'room-node-children'),
          toggle = icon('⌄', 'Recolher registros relacionados', 'mc-children-toggle');
        const show = hidden => {
          children.hidden = hidden;
          hidden ? collapsed.add(node.id) : collapsed.delete(node.id);
          toggle.textContent = hidden ? '›' : '⌄';
          toggle.setAttribute('aria-expanded', String(!hidden));
          toggle.title = (hidden ? 'Mostrar ' : 'Recolher ') + node.children.length + ' registros relacionados';
          toggle.setAttribute('aria-label', toggle.title);
        };
        toggle.addEventListener('click', () => show(!children.hidden));
        show(collapsed.has(node.id));
        header.append(toggle);
        for (const child of node.children) children.append(nodeCard(child, depth + 1));
        card.append(children);
      }
      return card;
    }
    function topicSection(topic, index) {
      const section = element('section', 'room-topic'),
        header = element('header', 'room-topic-head'),
        name = element('div', 'room-topic-name');
      section.dataset.topicId = topic.id || '';
      section.id = 'topic-' + (topic.id || 'pending');
      const nodes = Object.values(topic.columns).flat();
      const placeholder = topic.id ? 'Assunto ' + (index + 1) : 'Pontos a organizar';
      const title = element('h2', topic.title ? '' : 'mc-title-placeholder', topic.title || placeholder);
      title.title = topic.title || placeholder;
      if (!topic.title && topic.id) title.append(element('small', 'mc-organizing', 'sugerindo título…'));
      name.append(title);
      header.append(element('span', 'room-topic-index', String(index + 1).padStart(2, '0')), name);
      if (topic.id && canEdit()) {
        const edit = icon('✎', topic.title ? 'Renomear ' + topic.title : 'Definir nome do assunto', 'room-edit-title');
        edit.addEventListener('click', () => onRename(topic.id, topic.title || ''));
        header.append(edit);
      }
      const body = element('div', 'room-topic-body');
      for (const node of nodes.sort((a, b) => topic.nodes.indexOf(a) - topic.nodes.indexOf(b)))
        body.append(nodeCard(node));
      section.append(header, body);
      return section;
    }
    function reset() {
      signature = '';
      runId = null;
      projection = null;
      known.clear();
      collapsed.clear();
      warnings.clear();
      board.replaceChildren();
    }
    function render(run) {
      if (!run) {
        reset();
        return {
          topics: [],
          edges: [],
          review: [],
          metrics: { topics: 0, events: 0, nested: 0, edges: 0, reviews: 0 },
        };
      }
      const next = build(run),
        nextId = run.id || run.run_id || null;
      if (runId !== nextId) {
        reset();
        runId = nextId;
      }
      projection = next;
      const nextSignature = JSON.stringify([next, canEdit()]);
      if (signature === nextSignature) return projection;
      signature = nextSignature;
      const top = canvas.scrollTop;
      board.replaceChildren(...next.topics.map(topicSection));
      canvas.scrollTop = top;
      return projection;
    }
    function focusTopic(id) {
      const topic = [...board.querySelectorAll('.room-topic')].find(item => item.dataset.topicId === (id || ''));
      topic?.scrollIntoView({ block: 'start' });
      return !!topic;
    }
    return { render, reset, focusTopic, getProjection: () => projection };
  }
  return { create, build };
});
