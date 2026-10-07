(() => {
  const editor = document.querySelector('#questionEditor');
  const container = document.querySelector('#classificationResults');
  const modelStatus = document.querySelector('#modelStatus');
  const apply = document.querySelector('#applyQuestions');
  const results = new Map();
  const copy = value => JSON.parse(JSON.stringify(value));
  const colors = ['#75b5ff', '#b6a1ef', '#69d5b5', '#e7bb72', '#b0bdcc', '#ed9faa'];
  const levels = ['#69d5b5', '#9dcc88', '#e7c475', '#e9a174', '#eb8494'];
  let config, available = false, running = false, initialized = false, latest = [], changed = () => {};
  let minimumWindow = 0, lastRender = '', nowMs = 0, selectedItem = null;
  let processedPackets = null, processedConfig = null;
  let manual = null, liveConfig = null, liveEditorDraft = null, engineFingerprint = null;
  let provider = null, providerMessage = 'Conectando…', providerVerified = false;
  const testQueue = [];
  const sequence = packet => Number(packet.id.split('-').at(-1));
  const time = ms => String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const percent = value => (value * 100).toFixed(1) + '%';
  const probabilityColor = value => value >= .75 ? '#69d5b5' : value >= .4 ? '#e7c475' : '#eb8494';
  const levelColor = (index, count) => levels[Math.round(index * (levels.length - 1) / (count - 1))];
  const expectedColor = (q, value) => q.type === 'noul' ? probabilityColor(value ? 1 : 0) : q.type === 'score' ? levelColor(value, q.criteria.length) : colors[Object.keys(q.criteria).indexOf(value) % colors.length];
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  // Build tokens with textContent; spoken text and edited JSON never become HTML.
  function highlight(node, source) {
    const fragment = document.createDocumentFragment();
    const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?\b/g;
    let start = 0, match;
    while ((match = pattern.exec(source))) {
      fragment.append(document.createTextNode(source.slice(start, match.index)));
      fragment.append(element('span', match[2] ? 'json-key' : match[1] ? 'json-string' : 'json-value', match[0]));
      start = pattern.lastIndex;
    }
    fragment.append(document.createTextNode(source.slice(start)));
    node.replaceChildren(fragment);
  }
  // Native textareas own editing, wrapping and scrolling; mirrors only add color.
  // One mirror row per source line also keeps gutter numbers aligned after wraps.
  function codeEditor(input, mirror, gutter = null) {
    let source=null, width=0, markedField='';
    function markField(field='') {
      markedField=field;
      for(const row of mirror.children)row.classList.toggle('variation-focus',field==='state' || !!field && [...row.querySelectorAll('.json-key')].some(key=>key.textContent.replace(/:\s*$/,'').trim()===JSON.stringify(field)));
    }
    function scroll() {
      mirror.style.transform='translateY('+-input.scrollTop+'px)';
      if(gutter)gutter.style.transform='translateY('+-input.scrollTop+'px)';
    }
    function refresh() {
      if(!input.clientWidth)return;
      const changed=source!==input.value,resized=width!==input.clientWidth;
      if(changed){
        source=input.value;const lines=document.createDocumentFragment(),numbers=document.createDocumentFragment();
        source.split('\n').forEach((line,index)=>{const row=element('span','editor-source-line');highlight(row,line || '\u200b');lines.append(row);if(gutter)numbers.append(element('span','editor-line-number',String(index+1)));});
        mirror.replaceChildren(lines);if(gutter)gutter.replaceChildren(numbers);markField(markedField);
      }
      if(changed || resized){
        width=input.clientWidth;mirror.style.width=width+'px';
        if(gutter)[...mirror.children].forEach((line,i)=>gutter.children[i].style.height=line.getBoundingClientRect().height+'px');
      }
      scroll();
    }
    function indent(event) {
      if(event.key!=='Tab' || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || input.readOnly || input.disabled)return;
      event.preventDefault();
      const value=input.value,start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
      let from=start,to=end,text='  ',nextStart=start+2,nextEnd=start+2;
      if(event.shiftKey || value.slice(start,end).includes('\n')){
        from=value.slice(0,start).lastIndexOf('\n')+1;
        const last=end>start && value[end-1]==='\n'?end-1:end;
        const lineEnd=value.indexOf('\n',last);to=lineEnd<0?value.length:lineEnd;
        const lines=value.slice(from,to).split('\n');
        if(event.shiftKey){
          const removed=lines.map(line=>(line.match(/^(?:\t| {1,2})/)?.[0] || '').length);
          if(!removed.some(Boolean))return;
          text=lines.map((line,i)=>line.slice(removed[i])).join('\n');
          nextStart=start-Math.min(start-from,removed[0]);
          nextEnd=Math.max(nextStart,end-removed.reduce((sum,n)=>sum+n,0));
        }else{
          text=lines.map(line=>'  '+line).join('\n');nextStart=start+2;nextEnd=end+2*lines.length;
        }
      }
      const top=input.scrollTop,left=input.scrollLeft;
      input.setSelectionRange(from,to);
      // Native insertion retains the browser's undo history. Fall back for hosts
      // without insertText support, still notifying every editor/draft listener.
      let inserted=false;
      try { inserted=document.execCommand('insertText',false,text); } catch (_) { /* Native fallback below. */ }
      if(!inserted){input.setRangeText(text,from,to,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
      input.setSelectionRange(nextStart,nextEnd,direction);
      input.scrollTop=top;input.scrollLeft=left;refresh();
    }
    input.addEventListener('input',refresh);input.addEventListener('scroll',scroll);input.addEventListener('keydown',indent);
    const observer=new ResizeObserver(refresh);observer.observe(input);
    return {refresh,markField,dispose(){observer.disconnect();input.removeEventListener('input',refresh);input.removeEventListener('scroll',scroll);input.removeEventListener('keydown',indent);}};
  }
  const codeEditors=[codeEditor(editor,document.querySelector('#questionHighlight'),document.querySelector('#questionLines')),
    codeEditor(document.querySelector('#manualState'),document.querySelector('#manualStateHighlight')),
    codeEditor(document.querySelector('#autoStateEditor'),document.querySelector('#autoStateHighlight'))];
  const refreshEditors=()=>codeEditors.forEach(view=>view.refresh());
  function editorChanged() {
    refreshEditors();
    const dirty = editor.value.trim()?editor.value !== JSON.stringify(config.questions, null, 2):Object.keys(config.questions).length>0;
    apply.disabled = !dirty;
    document.querySelector('#questionsStatus').textContent = dirty ? 'Não aplicado' : '';
  }
  function validate(candidate) {
    NorteExperiments.validateConfig(candidate);
  }
  function dot(color, title, active = true) {
    const node = element('span', 'answer-dot' + (active ? ' selected' : ''));
    node.style.setProperty('--answer-color', color);
    node.title = title; node.setAttribute('aria-label', title);
    return node;
  }
  function meter(value, color) {
    const bar = element('div', 'probability-track');
    bar.style.setProperty('--answer-color', color);
    const fill = element('span', 'probability-fill'); fill.style.width = (value * 100) + '%';
    bar.append(fill); bar.title = percent(value); return bar;
  }
  function renderAnswer(q, answer) {
    const cell = element('div', 'answer-value');
    if (!answer) { cell.append(element('span', 'answer-pending', '—')); return cell; }
    if (q.type === 'score') {
      const count = q.criteria.length;
      const ranked = Object.entries(answer.probabilities).sort((a,b) => b[1] - a[1]);
      const winner = Math.abs(ranked[0][1] - ranked[1][1]) < 1e-12 ? null : ranked[0][0];
      const dots = element('div', 'score-dots');
      q.criteria.forEach((criterion, i) => {
        const item = element('span', 'score-level');
        item.append(dot(levelColor(i, count), i + ' · ' + criterion + ' · ' + percent(answer.probabilities[i]), String(i) === winner), element('small', '', i));
        dots.append(item);
      });
      cell.append(element('strong', '', answer.score.toFixed(2) + ' / ' + (count - 1)), dots);
      cell.append(element('small', 'score-caption', winner === null ? 'Empate entre níveis' : 'Nível ' + winner + ' · ' + percent(answer.probabilities[winner])));
      cell.title = 'Média ponderada dos níveis, não certeza. Destaque: nível mais provável. Clique para ver a distribuição.';
    } else if (q.type === 'noul') {
      const color = probabilityColor(answer.noul);
      const value = element('div', 'answer-primary');
      value.style.color = color;
      value.append(dot(color, 'P(true)'), element('strong', '', percent(answer.noul)), element('small', '', 'P(true)'));
      cell.append(value, meter(answer.noul, color));
      cell.title = 'Probabilidade de true; não é uma garantia de acerto.';
    } else {
      const index = Object.keys(q.criteria).indexOf(answer.choice);
      const probability = answer.choice === null ? Math.max(...Object.values(answer.probabilities)) : answer.probabilities[answer.choice];
      const value = element('div', 'answer-primary');
      const color = index < 0 ? colors[4] : colors[index % colors.length];
      value.append(dot(color, answer.choice ?? 'Empate'), element('strong', 'choice-label', answer.choice ?? 'Empate'), element('small', 'choice-probability', percent(probability)));
      value.querySelector('.choice-label').style.color = color;
      value.querySelector('.choice-probability').style.color = probabilityColor(probability);
      cell.append(value, meter(probability, color));
    }
    const probabilities = q.type === 'noul' ? [answer.noul, 1 - answer.noul] : Object.values(answer.probabilities);
    const ordered = [...probabilities].sort((a, b) => b - a);
    if (ordered[0] < .5 || ordered[0] - ordered[1] < .15) {
      const warning = element('small', 'answer-uncertainty', 'Incerto');
      warning.title = 'Sinal visual: maior probabilidade abaixo de 50% ou diferença entre as duas primeiras abaixo de 15 pontos. Não altera a resposta do modelo e não é uma medida calibrada de acerto.';
      cell.append(warning);
    }
    return cell;
  }
  function renderRow(id, q, answer) {
    const row = element('details', 'answer-row'); row.dataset.question = id;
    const summary = element('summary', 'answer-summary');
    const key = element('div', 'answer-key');
    key.append(element('code', '', id), element('p', 'answer-instructions', q.instructions));
    summary.append(key, renderAnswer(q, answer), element('span', 'primitive-type', q.type === 'noul' ? 'Noul' : q.type === 'choice' ? 'Choice' : 'Score'));
    row.append(summary);
    const detail = element('div', 'answer-breakdown');
    const entries = q.type === 'noul' ? [['false', q.criteria?.false || 'false'], ['true', q.criteria?.true || 'true']] : Object.entries(q.criteria);
    entries.forEach(([name, description], index) => {
      const value = !answer ? null : q.type === 'noul' ? (index ? answer.noul : 1 - answer.noul) : answer.probabilities[name];
      const color = q.type === 'score' ? levelColor(index, entries.length) : q.type === 'noul' ? (value == null ? colors[4] : probabilityColor(value)) : colors[index % colors.length];
      const line = element('div', 'distribution-line');
      line.append(dot(color, description), element('span', 'distribution-label', q.type === 'score' ? name + ' · ' + description : name), element('span', '', value == null ? '—' : percent(value)));
      line.title = description;
      if (q.type === 'noul' && q.criteria?.[name]) {
        line.querySelector('.distribution-label').append(element('small', 'criterion-description', description));
      }
      detail.append(line);
    });
    row.append(detail);
    return row;
  }
  function render() {
    if (!initialized) return;
    const viewConfig = manual?.config || config;
    const packets = latest.filter(packet => sequence(packet) >= minimumWindow);
    // An empty newly opened window must not erase the last utterance.
    const packet = manual ? { id: 'manual', text: manual.state, status: 'confirmed', startMs: 0, endMs: 0 } : [...packets].reverse().find(entry => entry.text.trim());
    const state = JSON.stringify({ state: packet?.text || '' }, null, 2);
    const stateNode = document.querySelector('#stateCode');
    if (stateNode.textContent !== state) {
      stateNode.replaceChildren();
      state.split('\n').forEach((source, index) => {
        if (index) stateNode.append(document.createTextNode('\n'));
        const line = element('span', 'state-code-line'); line.dataset.line = index + 1;
        const code = element('span', 'state-code-text'); highlight(code, source);
        line.append(code); stateNode.append(line);
      });
    }
    const isLive = packet?.endMs === null;
    const offset = packet?.takeOffsetMs || 0;
    document.querySelector('#stateStatus').textContent = !packet ? 'Ao vivo' : isLive ? 'Ao vivo · ' + Math.min(15, Math.max(0, (nowMs - packet.startMs) / 1000)).toFixed(1) + ' s' : time((packet.inputStartMs ?? packet.startMs) - offset) + '–' + time(packet.endMs - offset);
    document.querySelector('#stateStatus').title = packet ? (packet.status === 'confirmed' ? 'Confirmado' : 'Provisório') + (packet.context === 'same-utterance-prefix' ? ' · início da mesma fala incluído para não perder a frase' : ' · sem fala anterior adicionada') + (packet.contextTruncated ? ' · início limitado por tamanho' : '') : 'Último trecho transcrito';
    if (manual) { document.querySelector('#stateStatus').textContent = NorteExperiments.stateText(manual.state).length + ' car.'; document.querySelector('#stateStatus').title = 'State de teste; não altera a transcrição'; }
    const item = manual ? manual.output && { packet, request: manual.output.request, output: manual.output, status: 'done' } : packet && results.get(packet.id);
    // Never show an old answer beside a newer State or a different applied contract.
    selectedItem = item && NorteExperiments.sameState(item.request.state, packet.text) && JSON.stringify(item.request.questions) === JSON.stringify(viewConfig.questions) && item.packet.status === packet.status ? item : null;
    const output = selectedItem?.output;
    const providerLabel = provider === 'official' ? 'Jev oficial' : provider === 'local' ? 'jevos · local' : 'Modelo';
    modelStatus.textContent = available ? providerLabel + (provider === 'official' && !providerVerified ? ' · configurado' : '') : providerMessage;
    modelStatus.dataset.ready = String(available);
    modelStatus.title = provider === 'official' ? providerMessage + ' · State e Questions são enviados à TypeSafe e consomem sua API; a chave fica no servidor.' : providerMessage;
    document.querySelector('.sidebar-footer').title = modelStatus.title;
    const providerStatus = document.querySelector('#providerStatus'); providerStatus.textContent = modelStatus.textContent; providerStatus.title = modelStatus.title;
    const latency = document.querySelector('#liveLatency');
    latency.hidden = !!manual || !output;
    latency.textContent = !manual && output ? NorteExperiments.resultLabel(output) + ' · ' + NorteExperiments.seconds(output.latencyMs) : '';
    latency.title = 'Tempo de resposta, incluindo rede quando remoto; sem captura da fala';
    const status = manual ? manual.status || '' : !packet ? '' : isLive ? 'Ouvindo…' : selectedItem?.status === 'error' ? selectedItem.error : output ? (packet.status === 'confirmed' ? '' : 'Texto provisório') : available ? 'Classificando…' : 'Aguardando modelo';
    document.querySelector('#classificationStatus').textContent = status;
    document.querySelector('#retryClassification').hidden = selectedItem?.status !== 'error';
    document.querySelector('#saveLiveResult').hidden = !!manual || !output;
    const aggregate = manual?.aggregate && NorteExperiments.sameState(manual.aggregate.request.state, packet?.text) && JSON.stringify(manual.aggregate.request.questions) === JSON.stringify(viewConfig.questions) ? manual.aggregate : null;
    const answers = aggregate?.answers || output?.response.answers;
    const signature = JSON.stringify([viewConfig.questions, packet?.id, packet?.text, packet?.status, answers || null, aggregate?.count]);
    if (signature === lastRender) return;
    lastRender = signature;
    const open = new Set([...container.querySelectorAll('details[open]')].map(row => row.dataset.question));
    container.replaceChildren();
    for (const [id, q] of Object.entries(viewConfig.questions)) {
      const row = renderRow(id, q, answers?.[id]);
      if (manual) window.NorteLab?.decorateRow(row, id, q, answers?.[id]);
      row.open = open.has(id); container.append(row);
    }
  }
  let relationRunning = false;
  let typedRelationRunning = false;
  async function classify(request, requestProvider, relation = false) {
    if (!requestProvider || requestProvider !== provider) throw Object.assign(Error('O provedor mudou. Inicie um novo teste.'), { stopBatch: true });
    const fingerprint = engineFingerprint;
    const response = await fetch(relation==='typed' ? '/api/typed-relations' : relation ? '/api/relations' : '/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Norte-Provider': requestProvider }, body: JSON.stringify(request), signal: AbortSignal.timeout(35000) });
    if (relation && response.status === 404) throw Object.assign(Error('Reinicie o servidor com ./start para habilitar o canal independente de relações.'), { stopBatch: true });
    const output = await response.json();
    if (!response.ok) {
      if (requestProvider === 'official' && [401, 402, 403, 503].includes(response.status)) { providerVerified = false; providerMessage = output.error || 'Jev oficial indisponível'; }
      throw Object.assign(Error(output.error || 'Falha no modelo'), { stopBatch: [401, 402, 403, 409, 429, 503, 504].includes(response.status) });
    }
    if (output.provider !== requestProvider) throw Object.assign(Error('A resposta veio de outro provedor; resultado descartado.'), { stopBatch: true });
    if (requestProvider === 'official') { providerVerified = true; providerMessage = 'Jev oficial · conexão verificada'; }
    return { ...output, engineFingerprint: requestProvider === 'local' ? fingerprint : null };
  }
  async function processQueue() {
    if (!available || running) return;
    if (testQueue.length) {
      const job = testQueue.shift(); running = true;
      try {
        job.resolve(await classify(job.request, job.provider));
      } catch (error) { job.reject(error); }
      finally { running = false; processQueue(); }
      return;
    }
    if (manual) return;
    const item = [...results.values()].reverse().find(entry => entry.status === 'queued');
    if (!item) return;
    running = true; item.status = 'running'; render();
    try {
      const output = await classify(item.request, item.provider || provider);
      if (results.get(item.id) === item) { item.output = output; item.status = 'done'; }
    } catch (error) {
      if (results.get(item.id) === item) { item.error = error.message; item.status = 'error'; }
    } finally {
      running = false; render(); changed(); processQueue();
    }
  }
  function update(packets, timestamp = 0) {
    latest = packets; nowMs = timestamp;
    if (!initialized) return;
    if (manual) { render(); return; }
    if (processedPackets === packets && processedConfig === config) { render(); return; }
    processedPackets = packets; processedConfig = config;
    let anyChange = false;
    const newest = [...packets].reverse().find(packet => packet.text.trim());
    for (const packet of packets) {
      if (packet.endMs === null || sequence(packet) < minimumWindow) continue;
      if (!packet.text.trim()) {
        const old = results.get(packet.id);
        if (old && old.status !== 'withdrawn') {
          results.set(packet.id, { ...old, packet: copy(packet), status: 'withdrawn', output: null, token: 'withdrawn', history: [...(old.history || []), ...(old.output ? [{ request: old.request, output: old.output, withdrawn: true }] : [])] });
          anyChange = true;
        }
        continue;
      }
      const existing = results.get(packet.id);
      // Applying questions updates the latest State, not the entire archived meeting.
      const questions = existing && packet.id !== newest?.id ? existing.request.questions : config.questions;
      const request = { model: config.model, state: packet.text, questions: copy(questions) };
      const token = JSON.stringify([request, packet.status]);
      if (existing?.token === token) continue;
      const item = { id: packet.id, token, packet: copy(packet), request, provider, status: 'queued', history: [...(existing?.history || [])] };
      if (existing?.output) item.history.push({ request: existing.request, output: existing.output, sourceStatus: existing.packet.status });
      results.set(item.id, item); anyChange = true;
    }
    render();
    if (anyChange) changed();
    processQueue();
  }
  async function health() {
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
      const body = await response.json();
      const previous = provider;
      provider = ['official', 'local'].includes(body.provider) ? body.provider : body.engine === 'jevos-v3' ? 'local' : null;
      available = response.ok && body.ready === true;
      if (previous !== provider || !available) providerVerified = false;
      providerMessage = providerVerified && provider === 'official' ? 'Jev oficial · conexão verificada' : body.message || (provider === 'local' ? 'jevos-v3 · inferência local' : 'Modelo indisponível');
      engineFingerprint = body.health?.fingerprint || null;
    } catch (_) { available = false; providerMessage = 'Servidor indisponível · execute ./start'; }
    if (!available) while (testQueue.length) testQueue.shift().reject(Error('O modelo ficou indisponível antes de executar.'));
    render(); processQueue(); window.dispatchEvent(new Event('norte:model-status'));
  }
  async function init(saved, onChange) {
    changed = onChange;
    try {
      config = saved?.config || await fetch('classifier-config.json').then(response => response.json());
      validate(config);
      minimumWindow = saved?.minimumWindow || 0;
      editor.value = JSON.stringify(config.questions, null, 2); editorChanged();
      initialized = true;
      for (const item of saved?.results || []) {
        if (item.status === 'running' || item.status === 'queued') { item.status = 'error'; item.error = 'Classificação interrompida. Reenvie explicitamente para executar.'; }
        results.set(item.id, item);
      }
      update(latest, nowMs); window.dispatchEvent(new Event('norte:classifier-ready')); health(); setInterval(health, 5000);
    } catch (error) { document.querySelector('#configError').textContent = error.message; }
  }
  editor.addEventListener('input', () => { if (initialized) editorChanged(); });
  editor.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); apply.click(); }
    if (event.key === 'Tab') {
      event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editorChanged();
    }
  });
  apply.addEventListener('click', () => {
    try {
      const candidate = { model: config.model, questions: JSON.parse(editor.value) };
      validate(candidate); config = candidate;
      editor.value = JSON.stringify(config.questions, null, 2); editorChanged();
      document.querySelector('#configError').textContent = '';
      editor.removeAttribute('aria-invalid'); update(latest, nowMs); changed();
      window.dispatchEvent(new Event('norte:questions-changed'));
    } catch (error) {
      editor.setAttribute('aria-invalid', 'true');
      document.querySelector('#configError').textContent = error.message;
    }
  });
  document.querySelector('#retryClassification').addEventListener('click', () => {
    if (selectedItem?.status !== 'error') return;
    selectedItem.status = 'queued'; selectedItem.provider = provider; render(); processQueue();
  });
  NorteLayout.bind({
    id: '#classifierDivider', host: '#workspace-classifier', property: '--input-width',
    initial: axis => axis === 'y' ? 52 : 43,
    axis: () => {
      const panel = document.querySelector('#workspace-classifier');
      const stacked = panel.getBoundingClientRect().width < 720;
      panel.classList.toggle('stacked', stacked);
      return stacked ? 'y' : 'x';
    },
    pixels: axis => axis === 'y' ? [document.querySelector('#manualStateView').hidden ? 130 : document.body.dataset.page==='automated' ? 392 : 302, 110] : [230, 240],
  });
  NorteLayout.bind({ id: '#stateDivider', host: '#inputPaneBody', property: '--state-height', initial: () => document.querySelector('#manualStateView').hidden ? 42 : 50, axis: () => 'y', pixels: () => document.querySelector('#manualStateView').hidden ? [65,75] : [96,96] });
  window.NorteClassifier = {
    init, update, renderRow, expectedColor, refreshEditors, highlight, codeEditor,
    markStateField: field=>codeEditors[2].markField(field),
    getConfig: () => initialized ? copy(config) : null,
    isAvailable: () => available,
    getProvider: () => provider,
    getLiveText: () => [...latest].reverse().find(packet => sequence(packet) >= minimumWindow && packet.text.trim())?.text || '',
    getVisibleResult: () => selectedItem?.output ? copy(selectedItem) : null,
    setManualMode(enabled) {
      if (!initialized || !!manual === enabled) return;
      if (enabled) { liveConfig = copy(config); liveEditorDraft = editor.value; manual = { state: this.getLiveText(), output: null, status: '' }; }
      else { manual = null; config = liveConfig; liveConfig = null; processedPackets = null; }
      editor.value = !enabled && liveEditorDraft !== null ? liveEditorDraft : JSON.stringify(config.questions, null, 2); editorChanged();
      document.querySelector('#configError').textContent = ''; editor.removeAttribute('aria-invalid');
      lastRender = ''; update(latest, nowMs); changed(); processQueue();
    },
    setManualPreview(preview) {
      if (!manual) return;
      manual = { ...manual, ...preview }; lastRender = ''; render();
    },
    loadTestConfig(candidate) {
      if (!manual) throw Error('Entre no modo manual para carregar o caso.');
      validate(candidate); config = copy(candidate);
      editor.value = JSON.stringify(config.questions, null, 2); editorChanged();
      document.querySelector('#configError').textContent = ''; editor.removeAttribute('aria-invalid');
      lastRender = ''; render();
    },
    loadDraftConfig(candidate,source='') {
      if(!manual)throw Error('Entre no modo de testes para editar.');
      NorteExperiments.validateDraftConfig(candidate);config=copy(candidate);editor.value=source;editorChanged();
      document.querySelector('#configError').textContent='';editor.removeAttribute('aria-invalid');lastRender='';render();
    },
    restoreQuestionDraft(value) { editor.value = value; editorChanged(); },
    requestTest(request, requestProvider = provider) {
      validate(request);
      if (!manual || !available) return Promise.reject(Error('Modelo indisponível para o teste.'));
      try { NorteExperiments.validateState(request.state); } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => { testQueue.push({ request: copy(request), provider: requestProvider, resolve, reject }); processQueue(); });
    },
    async requestRelation(request, requestProvider = provider) {
      validate(request); NorteExperiments.validateState(request.state);
      if (!manual || !available) throw Error('Modelo indisponível para relações.');
      if (relationRunning) throw Error('Já existe uma chamada do relation worker em andamento.');
      relationRunning = true;
      try { return await classify(copy(request),requestProvider,true); }
      finally { relationRunning = false; }
    },
    async requestTypedRelation(request, requestProvider = provider) {
      validate(request); NorteExperiments.validateState(request.state);
      if(!manual || !available)throw Error('Modelo indisponível para relações tipadas.');
      if(typedRelationRunning)throw Error('Já existe uma chamada de relações tipadas em andamento.');
      typedRelationRunning=true;
      try{return await classify(copy(request),requestProvider,'typed');}
      finally{typedRelationRunning=false;}
    },
    beginTake(nextSequence) {
      minimumWindow = nextSequence; lastRender = ''; render(); changed();
    },
    snapshot: () => initialized ? copy({ config: liveConfig || config, minimumWindow, results: [...results.values()] }) : null,
  };
})();
