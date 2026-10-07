/* Local, incremental view of the actual memory graph. No inference or expected labels. */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const relations = {
    result_of: ['Resultado de', '#66d6f2'], supports: ['Sustenta', '#7cdb9a'], contradicts: ['Contradiz', '#ff8194'],
    depends_on: ['Depende de', '#f4cb73'], affects: ['Afeta', '#efa267'], supersedes: ['Substitui', '#c6a1ff'],
    repeats: ['Repete', '#8cadff'], tests: ['Testa', '#5ce0cb'], clarifies: ['Esclarece', '#ecb8da'],
    based_on: ['Baseia-se em', '#b8d785'], related_to: ['Relaciona-se a', '#a3b7ca']
  };
  const eventTypes = { observation: ['Observação', '#9eb8d3'], hypothesis: ['Hipótese', '#d8b9ff'], test_proposal: ['Teste proposto', '#7bb9ff'], test_result: ['Resultado', '#73ddc4'], decision: ['Decisão', '#ffd78f'], requirement: ['Requisito', '#f7a9b4'], other: ['Outro', '#d1d7df'] };
  const matchLabels = { exact: 'configuração exata', partial: 'configuração parcial', mismatch: 'configuração divergente', ambiguous: 'configuração indefinida' };
  const make = (name, cls, text) => { const el = document.createElement(name); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
  const svg = (name, attrs = {}) => { const el = document.createElementNS(NS, name); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); return el; };
  const short = (text, max = 38) => { const chars = Array.from(String(text || '')); return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  let instance = 0;
  function create(host, { onSelect = () => {} } = {}) {
    if (!host) throw Error('Informe o painel do mapa de relações.');
    const prefix = 'norte-map-' + (++instance), listeners = [], positions = new Map(), nodes = new Map(), edges = new Map(), groups = new Map();
    let eventData = new Map(), edgeData = [], lastKey = null, signature = '', visible = !host.hidden, fitted = false, manipulated = false, destroyed = false;
    let pan = { x: 0, y: 0, zoom: 1 }, selected = null, hovered = null, focused = null, drag = null, ignoreClick = false, width = 1, height = 1, groupSequence = 0, groupColumns = 1;
    host.classList.add('mf-relation-map');
    const toolbar = make('div', 'rm-toolbar'), caption = make('div', 'rm-caption'), count = make('strong', 'rm-count', 'Mapa de relações'), hint = make('span', '', 'Passe pelos tópicos para ver conexões. Clique para fixar.');
    caption.append(count, hint); toolbar.append(caption);
    const controls = make('div', 'rm-controls');
    const button = (label, title, fn) => { const b = make('button', '', label); b.type = 'button'; b.setAttribute('aria-label', title); b.title = title; b.addEventListener('click', fn); controls.append(b); return b; };
    button('−', 'Diminuir mapa', () => zoom(.8)); button('+', 'Ampliar mapa', () => zoom(1.25)); button('Ajustar', 'Enquadrar todos os tópicos', () => fit(true));
    toolbar.append(controls);
    const surface = svg('svg', { class: 'rm-surface', role: 'group', 'aria-label': 'Rede de tópicos. Use Tab para selecionar um tópico; arraste o fundo para mover e use a roda para ampliar.', tabindex: '0' });
    const defs = svg('defs'), scene = svg('g', { class: 'rm-scene' }), clusterLayer = svg('g', { class: 'rm-clusters', 'aria-hidden': 'true' }), edgeLayer = svg('g', { class: 'rm-edges', 'aria-hidden': 'true' }), nodeLayer = svg('g', { class: 'rm-nodes' });
    for (const [type, [, color]] of Object.entries(relations)) {
      const marker = svg('marker', { id: prefix + '-' + type, viewBox: '0 0 10 10', refX: '8.5', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto', markerUnits: 'userSpaceOnUse' });
      marker.append(svg('path', { d: 'M 0 1 L 9 5 L 0 9 z', fill: color })); defs.append(marker);
    }
    scene.append(clusterLayer, edgeLayer, nodeLayer); surface.append(defs, scene);
    const empty = make('div', 'rm-empty'); empty.append(make('strong', '', 'Os tópicos aparecem aqui durante a reunião.'), make('span', '', 'As setas são adicionadas conforme as relações são identificadas.'));
    const detail = make('aside', 'rm-detail'); detail.id = prefix + '-detail'; detail.hidden = true; detail.setAttribute('aria-label', 'Tópico e conexões');
    const legend = make('details', 'rm-legend'), legendTitle = make('summary', '', 'Cores das conexões'), legendBody = make('div', 'rm-legend-body'); legend.append(legendTitle, legendBody);
    const status = make('span', 'rm-sr', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    host.replaceChildren(surface, toolbar, empty, detail, legend, status);
    const listen = (el, type, fn, options) => { el.addEventListener(type, fn, options); listeners.push(() => el.removeEventListener(type, fn, options)); };
    const keyFor = event => event.thread_id || '__pending';
    function groupFor(event) {
      const key = keyFor(event);
      if (!groups.has(key)) {
        const i = groupSequence++, label = svg('text', { class: 'rm-cluster-label' }); label.textContent = key === '__pending' ? 'Sem atribuição' : key;
        const circle = svg('circle', { class: 'rm-cluster-ring', r: 120 }), el = svg('g'); el.append(circle, label); clusterLayer.append(el);
        groups.set(key, { x: (i % groupColumns) * 480, y: Math.floor(i / groupColumns) * 390, next: 0, el, circle, label });
      }
      return groups.get(key);
    }
    function place(event) {
      const group = groupFor(event), old = positions.get(event.event_id), key = keyFor(event);
      if (old && old.group === key) return old;
      const index = group.next++, angle = index * 2.399963229728653 - Math.PI / 2, radius = index ? 65 * Math.sqrt(index) : 0;
      const p = { x: group.x + Math.cos(angle) * radius, y: group.y + Math.sin(angle) * radius, group: key }; positions.set(event.event_id, p); return p;
    }
    function transform() {
      scene.setAttribute('transform', `translate(${pan.x} ${pan.y}) scale(${pan.zoom})`); surface.dataset.zoom = pan.zoom.toFixed(3);
      // Nodes stay usable as pointer/keyboard targets when fitting a larger network.
      for (const node of nodes.values()) { node.querySelector('.rm-node-dot').setAttribute('r', Math.max(6.5, 3 / pan.zoom)); node.querySelector('.rm-node-halo').setAttribute('r', Math.max(14, 9 / pan.zoom)); }
    }
    function measure() {
      let r = host.getBoundingClientRect();
      if (!r.width || !r.height) r = host.parentElement?.querySelector('#mfCanvas')?.getBoundingClientRect() || host.parentElement?.getBoundingClientRect() || r;
      width = Math.max(1, r.width); height = Math.max(1, r.height); surface.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    function fit(force = false) {
      if (!visible || !eventData.size || destroyed) return;
      measure(); if (width < 10 || height < 10) return;
      const points = [...eventData.keys()].map(id => positions.get(id)), left = Math.min(...points.map(p => p.x)) - 80, right = Math.max(...points.map(p => p.x)) + 240;
      const top = Math.min(...points.map(p => p.y)) - 65, bottom = Math.max(...points.map(p => p.y)) + 65;
      pan.zoom = clamp(Math.min((width - 40) / (right - left), (height - 112) / (bottom - top)), .15, 1.4);
      pan.x = width / 2 - (left + right) / 2 * pan.zoom; pan.y = (height + 46) / 2 - (top + bottom) / 2 * pan.zoom;
      fitted = true; if (force) manipulated = false; transform();
    }
    function zoom(factor, x = width / 2, y = height / 2) {
      const before = pan.zoom, after = clamp(before * factor, .15, 3.5); pan.x = x - (x - pan.x) * after / before; pan.y = y - (y - pan.y) * after / before; pan.zoom = after; manipulated = true; transform();
    }
    function drawPositions() {
      for (const [id, node] of nodes) { const p = positions.get(id); node.setAttribute('transform', `translate(${p.x} ${p.y})`); }
      for (const edge of edgeData) {
        const a = positions.get(edge.source_event_id), b = positions.get(edge.target_event_id), el = edges.get(edge.id), dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
        const x1 = a.x + dx / distance * 10, y1 = a.y + dy / distance * 10, x2 = b.x - dx / distance * 13, y2 = b.y - dy / distance * 13;
        const bend = Math.min(22, distance * .12), cx = (x1 + x2) / 2 - dy / distance * bend, cy = (y1 + y2) / 2 + dx / distance * bend;
        el.path.setAttribute('d', `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`); el.label.setAttribute('x', (x1 + 2 * cx + x2) / 4); el.label.setAttribute('y', (y1 + 2 * cy + y2) / 4 - 8);
      }
      for (const [key, group] of groups) {
        const points = [...positions.values()].filter(p => p.group === key), radius = Math.max(75, ...points.map(p => Math.hypot(p.x - group.x, p.y - group.y))) + 34;
        group.el.setAttribute('transform', `translate(${group.x} ${group.y})`); group.circle.setAttribute('r', radius); group.label.setAttribute('x', -radius + 12); group.label.setAttribute('y', -radius + 9);
      }
    }
    function showDetail(id) {
      const event = eventData.get(id); detail.hidden = !event; if (!event) return;
      const heading = make('div', 'rm-detail-heading'), kicker = make('span', '', (event.thread_id || 'Sem atribuição') + ' · ' + (eventTypes[event.type]?.[0] || event.type || 'Tópico'));
      const close = make('button', '', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Limpar seleção'); close.addEventListener('click', () => { selected = hovered = focused = null; highlight(); surface.focus(); }); heading.append(kicker, close);
      const text = make('p', 'rm-detail-text', event.text), list = make('ul', 'rm-detail-connections');
      const incident = edgeData.filter(edge => edge.source_event_id === id || edge.target_event_id === id);
      for (const edge of incident) {
        const outbound = edge.source_event_id === id, other = eventData.get(outbound ? edge.target_event_id : edge.source_event_id), item = make('li');
        const label = make('span', 'rm-connection-type', (outbound ? '→ ' : '← ') + relations[edge.relation_type][0]); label.style.color = relations[edge.relation_type][1];
        const destination = make('button', 'rm-connected-topic', short(other.text, 74)); destination.type = 'button'; destination.title = other.text; destination.addEventListener('click', () => select(other.event_id));
        item.append(label, destination);
        const notes = [matchLabels[edge.configuration_match], edge.review_state === 'needs_review' ? 'a revisar' : null].filter(Boolean);
        if (notes.length) item.append(make('small', '', notes.join(' · '))); list.append(item);
      }
      detail.replaceChildren(heading, text, incident.length ? list : make('p', 'rm-no-connections', 'Ainda sem relação direta registrada.'));
    }
    function highlight() {
      const id = hovered || focused || selected, neighborIds = new Set(id ? [id] : []);
      if (id) for (const edge of edgeData) if (edge.source_event_id === id || edge.target_event_id === id) { neighborIds.add(edge.source_event_id); neighborIds.add(edge.target_event_id); }
      host.classList.toggle('rm-has-focus', !!id);
      for (const [nodeId, node] of nodes) { node.classList.toggle('is-related', neighborIds.has(nodeId)); node.classList.toggle('is-current', nodeId === id); node.setAttribute('aria-pressed', String(nodeId === selected)); if (nodeId === id) node.setAttribute('aria-describedby', detail.id); else node.removeAttribute('aria-describedby'); }
      for (const edge of edgeData) edges.get(edge.id).el.classList.toggle('is-related', edge.source_event_id === id || edge.target_event_id === id);
      showDetail(id);
    }
    function select(id) { selected = id; hovered = focused = null; highlight(); onSelect(id); }
    function render(run) {
      if (destroyed) return;
      const runKey = run ? [run.createdAt || '', run.batch?.batch_id || ''].join('|') : null;
      const events = Array.isArray(run?.meeting_events) ? run.meeting_events : [];
      const nextData = new Map(events.filter(event => event?.event_id).map(event => [event.event_id, event]));
      const incomingEdges = (run?.meeting_relations || []).filter(edge => {
        const source = nextData.get(edge.source_event_id), target = nextData.get(edge.target_event_id);
        return Object.hasOwn(relations, edge.relation_type) && source && target && source !== target && source.thread_id && source.thread_id === target.thread_id;
      }).map(edge => ({ ...edge, id: JSON.stringify([edge.source_event_id, edge.target_event_id]) }));
      const nextSignature = JSON.stringify([runKey, events.map(e => [e.event_id, e.chunk_id, e.thread_id, e.type, e.text]), incomingEdges.map(e => [e.id, e.relation_type, e.configuration_match, e.review_state])]);
      if (nextSignature === signature) return; signature = nextSignature;
      if (lastKey !== runKey) { measure(); groupColumns = width / height > 2.4 ? 3 : width / height > 1.1 ? 2 : 1; positions.clear(); groups.clear(); groupSequence = 0; clusterLayer.replaceChildren(); selected = hovered = focused = null; fitted = manipulated = false; } lastKey = runKey;
      const previousCount = eventData.size; eventData = nextData; edgeData = [...new Map(incomingEdges.map(edge => [edge.id, edge])).values()];
      for (const [id, node] of nodes) if (!eventData.has(id)) { node.remove(); nodes.delete(id); positions.delete(id); }
      for (const event of eventData.values()) {
        place(event); let node = nodes.get(event.event_id);
        if (!node) {
          node = svg('g', { class: 'rm-node', 'data-event-id': event.event_id, role: 'button', tabindex: '0', 'aria-pressed': 'false' });
          node.append(svg('circle', { class: 'rm-node-halo', r: 14 }), svg('circle', { class: 'rm-node-dot', r: 6.5 }), svg('text', { class: 'rm-node-label', x: 15, y: 4 }), svg('text', { class: 'rm-node-reference', x: 15, y: 19 }));
          node.addEventListener('pointerenter', () => { if (!drag) { hovered = event.event_id; highlight(); } });
          node.addEventListener('pointerleave', () => { if (!drag) { hovered = null; highlight(); } });
          node.addEventListener('focus', () => { focused = event.event_id; highlight(); });
          node.addEventListener('blur', () => { focused = null; highlight(); });
          node.addEventListener('click', () => { if (!ignoreClick) select(event.event_id); });
          node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(event.event_id); } });
          nodeLayer.append(node); nodes.set(event.event_id, node);
        }
        node.style.setProperty('--node-color', eventTypes[event.type]?.[1] || '#d1d7df'); node.setAttribute('aria-label', `${event.text}. ${eventTypes[event.type]?.[0] || event.type}. ${event.thread_id || 'Sem atribuição'}.`);
        node.querySelector('.rm-node-label').textContent = short(event.text); node.querySelector('.rm-node-reference').textContent = event.chunk_id || event.event_id;
      }
      // Retain a group's reserved position when temporarily empty (especially pending assignments).
      const usedGroups = new Set([...eventData.values()].map(keyFor)); for (const [key, group] of groups) group.el.style.display = usedGroups.has(key) ? '' : 'none';
      const edgeIds = new Set(edgeData.map(e => e.id)); for (const [id, edge] of edges) if (!edgeIds.has(id)) { edge.el.remove(); edges.delete(id); }
      for (const edge of edgeData) {
        let elements = edges.get(edge.id); if (!elements) {
          const el = svg('g', { class: 'rm-edge', 'data-source': edge.source_event_id, 'data-target': edge.target_event_id }), path = svg('path', { fill: 'none' }), label = svg('text', { class: 'rm-edge-label', 'text-anchor': 'middle' });
          el.append(path, label); edgeLayer.append(el); elements = { el, path, label }; edges.set(edge.id, elements);
        }
        elements.el.dataset.relationType = edge.relation_type; elements.el.classList.toggle('needs-review', edge.review_state === 'needs_review'); elements.path.setAttribute('stroke', relations[edge.relation_type][1]); elements.path.setAttribute('marker-end', `url(#${prefix}-${edge.relation_type})`);
        elements.label.textContent = relations[edge.relation_type][0] + (matchLabels[edge.configuration_match] ? ' · ' + matchLabels[edge.configuration_match] : '');
      }
      const usedTypes = [...new Set(edgeData.map(e => e.relation_type))]; legendBody.replaceChildren(...usedTypes.map(type => { const item = make('span'), line = make('i'); line.style.backgroundColor = relations[type][1]; item.append(line, document.createTextNode(relations[type][0])); return item; }));
      if (edgeData.some(e => e.review_state === 'needs_review')) legendBody.append(make('small', '', 'Linha tracejada: relação a revisar.'));
      legend.hidden = !usedTypes.length; empty.hidden = !!eventData.size; count.textContent = `${eventData.size} tópico${eventData.size === 1 ? '' : 's'} · ${edgeData.length} conex${edgeData.length === 1 ? 'ão' : 'ões'}`;
      status.textContent = count.textContent; drawPositions(); highlight();
      if (!fitted || (!manipulated && previousCount !== eventData.size)) fit();
    }
    listen(surface, 'wheel', e => { e.preventDefault(); const r = surface.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    listen(surface, 'pointerdown', e => {
      if (e.button !== 0) return; const node = e.target.closest('.rm-node'), id = node?.dataset.eventId;
      drag = { id, startX: e.clientX, startY: e.clientY, x: id ? positions.get(id).x : pan.x, y: id ? positions.get(id).y : pan.y, moved: false }; ignoreClick = false; surface.setPointerCapture(e.pointerId); surface.classList.add('is-dragging');
    });
    listen(surface, 'pointermove', e => {
      if (!drag) return; const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY; if (Math.hypot(dx, dy) > 3) drag.moved = true; if (!drag.moved) return;
      manipulated = true; if (drag.id) { const point = positions.get(drag.id); point.x = drag.x + dx / pan.zoom; point.y = drag.y + dy / pan.zoom; drawPositions(); } else { pan.x = drag.x + dx; pan.y = drag.y + dy; transform(); }
    });
    const stopDrag = e => { if (!drag) return; const wasNode = drag.id, moved = drag.moved; ignoreClick = moved; drag = null; surface.classList.remove('is-dragging'); if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId); if (!moved && e.type !== 'pointercancel') { if (wasNode) { ignoreClick = true; select(wasNode); } else { selected = hovered = focused = null; highlight(); } } setTimeout(() => { ignoreClick = false; }, 0); };
    listen(surface, 'pointerup', stopDrag); listen(surface, 'pointercancel', stopDrag);
    listen(surface, 'keydown', e => {
      if (e.key === 'Escape') { selected = hovered = focused = null; highlight(); surface.focus(); }
      else if (e.target === surface && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'].includes(e.key)) {
        e.preventDefault(); if (e.key === '+' || e.key === '=') zoom(1.25); else if (e.key === '-') zoom(.8); else { pan.x += e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0; pan.y += e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0; manipulated = true; transform(); }
      }
    });
    const resize = new ResizeObserver(() => { if (!visible) return; measure(); if (!manipulated) fit(); }); resize.observe(host);
    return { render, reset: () => fit(true), setVisible(value) { visible = !!value; if (visible) { measure(); if (!fitted || !manipulated) fit(); } }, destroy() { destroyed = true; resize.disconnect(); listeners.forEach(remove => remove()); host.replaceChildren(); } };
  }
  root.NorteRelationMap = { create };
})(typeof window !== 'undefined' ? window : globalThis);
