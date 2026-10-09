/* Admin observatory: server evidence, runtime question contracts, and isolated replay. */
(function () {
  'use strict';
  if (document.body.dataset.auth === 'on' && document.body.dataset.role !== 'admin') return;
  const page = document.getElementById('aiObservatoryPage'), nav = document.getElementById('aiObservatoryMode');
  if (!page || !nav) return;
  nav.hidden = false;
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const number = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value) : '—';
  const percent = value => Number.isFinite(value) ? number(value * 100) + '%' : '—';
  const money = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value) : '—';
  const stamp = value => { const d = new Date(typeof value === 'number' ? value * 1000 : value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR') : '—'; };
  const names = { queued: 'Na fila', running: 'Executando', done: 'Concluído', completed: 'Concluído', failed: 'Falhou', error: 'Erro', rejected: 'Rejeitada', active: 'Ativa', approved: 'Aprovada', proposed: 'Proposta', disabled: 'Desativada', pending: 'Pendente', validated: 'Validada', review: 'Revisar', published: 'Publicada', audit: 'Auditoria', replay: 'Replay', metrics: 'Métricas', learning: 'Aprendizado', open_simulation: 'Abrir simulação', show_graphs: 'Mostrar gráficos', show_inspection: 'Resultados / cálculos', conversation: 'Conversa' };
  let state = null, initialized = false, loading = false, connectionFailed = false, timer = null, tab = 'overview', questionGroups = [], selectedNode = 'commands';
  const baseline = [
    { text: 'quero abrir a simulacao', expected_intent: 'open_simulation' },
    { text: 'quero fazer uma simulação', expected_intent: 'open_simulation' },
    { text: 'abirr simulação', expected_intent: 'open_simulation' },
    { text: 'vamos simular uma viga', expected_intent: 'open_simulation' },
    { text: 'simula a viga', expected_intent: 'open_simulation' },
    { text: 'não abra a simulação', expected_intent: null },
    { text: 'ontem ele disse: abre a simulação', expected_intent: null },
    { text: 'a viga ficou melhor no último teste', expected_intent: null }
  ];
  function notice(text = '', error = false) { const n = $('aoNotice'); if (!n) return; n.textContent = text; n.hidden = !text; n.dataset.tone = error ? 'error' : 'info'; }
  async function request(path, payload) {
    const response = await fetch('/api/admin/ai/' + path, { credentials: 'same-origin', signal: AbortSignal.timeout(20000), ...(payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) });
    let data; try { data = await response.json(); } catch (_) { throw Error('O servidor não retornou os dados dos agentes.'); }
    if (!response.ok) throw Error(data.error || (response.status === 403 ? 'Esta página exige uma conta admin.' : 'Não foi possível consultar os agentes.'));
    return data;
  }
  function activate(next) {
    tab = next;
    for (const b of page.querySelectorAll('[data-ao-tab]')) { const active = b.dataset.aoTab === next; b.setAttribute('aria-selected', String(active)); b.tabIndex = active ? 0 : -1; }
    for (const p of page.querySelectorAll('[data-ao-panel]')) p.hidden = p.dataset.aoPanel !== next;
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    page.innerHTML = `
      <div class="ao-toolbar"><div><span class="ao-eyebrow">OBSERVATÓRIO · ADMIN</span><p id="aoUpdated">Carregando evidências…</p></div><div class="ao-actions"><button id="aoRefresh" class="compact-button" type="button">Atualizar</button><button id="aoExport" class="compact-button" type="button" title="Imprimir resumo visual e arquitetura · escolha Salvar como PDF">Exportar PDF</button></div></div>
      <div id="aoNotice" class="ao-notice" role="status" hidden></div>
      <div id="aoProviderNotice" class="ao-notice" data-tone="error" role="status" hidden></div>
      <div class="ao-tabs" role="tablist" aria-label="Observatório"><button id="aoOverviewTab" data-ao-tab="overview" role="tab" aria-controls="aoOverview" aria-selected="true">Visão geral</button><button id="aoArchitectureTab" data-ao-tab="architecture" role="tab" aria-controls="aoArchitecture" aria-selected="false" tabindex="-1">Arquitetura atual</button><button id="aoActivityTab" data-ao-tab="activity" role="tab" aria-controls="aoActivity" aria-selected="false" tabindex="-1">Agentes e histórico</button><button id="aoReplayTab" data-ao-tab="replay" role="tab" aria-controls="aoReplay" aria-selected="false" tabindex="-1">Testar interpretações</button></div>
      <div id="aoOverview" data-ao-panel="overview" role="tabpanel" aria-labelledby="aoOverviewTab">
        <div id="aoMetrics" class="ao-metrics"></div>
        <div class="ao-grid"><section class="ao-card"><div class="ao-card-title"><h2>Uso registrado</h2><span>Últimos dias com dados</span></div><div id="aoDaily" class="ao-chart"></div><div class="ao-legend"><i></i> Eventos <i class="ao-legend-error"></i> Erros</div></section><section class="ao-card"><div class="ao-card-title"><h2>Custo e orçamento</h2><span>USD</span></div><div id="aoCosts"></div></section></div>
        <section class="ao-card"><div class="ao-card-title"><h2>Como o sistema aprende</h2><button type="button" class="ao-link" id="aoSeeArchitecture">Ver arquitetura →</button></div><ol id="aoLearning" class="ao-learning"></ol><p class="ao-caption">Regras de navegação passam por testes antes da ativação. Erros sem evidência suficiente ficam registrados para análise; código, parâmetros físicos e prompts não são reescritos automaticamente.</p></section>
        <div id="aoServices" class="ao-services"></div>
      </div>
      <div id="aoArchitecture" data-ao-panel="architecture" role="tabpanel" aria-labelledby="aoArchitectureTab" hidden>
        <section class="ao-card ao-architecture"><div class="ao-card-title"><div><h2>Fluxo atual · 3 camadas</h2><p class="ao-caption">Clique em um bloco para inspecionar o contrato em uso.</p></div><a class="ao-link" href="?profile=memory-v2#memoria" target="_blank" rel="noopener">Abrir Flow V2 ↗</a></div><div id="aoFlow" class="ao-flow"></div></section>
        <section id="aoNodeDetail" class="ao-card" aria-live="polite"></section>
        <section class="ao-card ao-contracts"><div class="ao-card-title"><h2>Perguntas atuais do Jev</h2><span id="aoQuestionCount">Carregando módulos…</span></div><div id="aoQuestions"></div></section>
      </div>
      <div id="aoActivity" data-ao-panel="activity" role="tabpanel" aria-labelledby="aoActivityTab" hidden>
        <section class="ao-card"><div class="ao-card-title"><h2>Execuções dos agentes</h2><button id="aoAudit" class="compact-button" type="button">Analisar agora</button></div><div id="aoJobs"></div></section>
        <section class="ao-card"><div class="ao-card-title"><h2>O que foi aprendido</h2><span>Propostas e evidências</span></div><div id="aoProposals"></div></section>
        <section class="ao-card"><div class="ao-card-title"><h2>Regras ativas</h2><span>Desativação imediata para novas consultas</span></div><div id="aoAliases"></div></section>
      </div>
      <div id="aoReplay" data-ao-panel="replay" role="tabpanel" aria-labelledby="aoReplayTab" hidden>
        <section class="ao-card"><div class="ao-card-title"><div><h2>Replay de frases</h2><p class="ao-caption">Adaptador de abertura no servidor. Não altera uma reunião nem mede a precisão do Jev ou das edições da viga.</p></div><button id="aoReplayDefault" class="compact-button" type="button">Regressão padrão</button></div><form id="aoReplayForm"><label for="aoReplayCases">Casos e intenção esperada · JSON</label><textarea id="aoReplayCases" rows="12" spellcheck="false" aria-describedby="aoReplayHint"></textarea><p id="aoReplayHint" class="ao-caption">Use expected_intent: "open_simulation" para abrir; null para não abrir. Inclua erros de transcrição e frases negativas. O rótulo esperado pertence ao teste.</p><div class="ao-actions"><button class="compact-button ao-primary" id="aoReplaySubmit" type="submit">Executar meus casos</button><button class="compact-button" id="aoReplayExample" type="button">Carregar exemplos</button></div></form></section>
        <section class="ao-card"><div class="ao-card-title"><h2>Avaliações registradas</h2><span>Acerto automático ≠ validação de usuários</span></div><div id="aoEvaluations"></div></section>
      </div>`;
    for (const b of page.querySelectorAll('[data-ao-tab]')) {
      b.onclick = () => activate(b.dataset.aoTab);
      b.onkeydown = event => { const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return; event.preventDefault(); const buttons = [...page.querySelectorAll('[data-ao-tab]')], at = buttons.indexOf(b), index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; activate(buttons[index].dataset.aoTab); buttons[index].focus(); };
    }
    $('aoRefresh').onclick = () => refresh(true);
    $('aoExport').onclick = () => window.print();
    $('aoSeeArchitecture').onclick = () => activate('architecture');
    $('aoAudit').onclick = () => enqueue('run', {}, $('aoAudit'));
    $('aoReplayDefault').onclick = () => enqueue('replay', {}, $('aoReplayDefault'));
    $('aoReplayExample').onclick = () => { $('aoReplayCases').value = JSON.stringify(baseline, null, 2); };
    $('aoReplayCases').value = JSON.stringify(baseline, null, 2);
    $('aoReplayForm').onsubmit = event => {
      event.preventDefault();
      try { const cases = JSON.parse($('aoReplayCases').value); if (!Array.isArray(cases) || !cases.length || cases.length > 100 || cases.some(c => !c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 2000 || !['open_simulation', null].includes(c.expected_intent))) throw Error('Use de 1 a 100 casos com text (até 2.000 caracteres) e expected_intent: "open_simulation" ou null.'); enqueue('replay', { cases }, $('aoReplaySubmit')); }
      catch (error) { notice(error instanceof SyntaxError ? 'O JSON dos casos não é válido. Confira aspas e vírgulas.' : error.message, true); }
    };
    renderFlow();
    loadQuestions().catch(error => { $('aoQuestionCount').textContent = 'Falha ao carregar'; $('aoQuestions').replaceChildren(node('p', 'ao-empty', error.message)); });
  }
  async function enqueue(path, payload, button) {
    button.disabled = true;
    try { const result = await request(path, payload); notice('Execução ' + (result.job_id || '') + ' adicionada à fila. O resultado aparecerá no histórico.'); await refresh(false); }
    catch (error) { notice(error.message, true); }
    finally { button.disabled = false; }
  }
  function metric(label, value, caption, ratio) {
    const card = node('article', 'ao-metric'); card.append(node('h2', '', label), node('strong', '', value), node('p', '', caption));
    if (Number.isFinite(ratio)) { const meter = node('div', 'ao-meter'), fill = node('i'); fill.style.width = Math.min(100, Math.max(0, ratio * 100)) + '%'; meter.append(fill); card.append(meter); }
    return card;
  }
  function row(label, value) { const n = node('div', 'ao-stat-row'); n.append(node('span', '', label), node('strong', '', value)); return n; }
  function renderMetrics() {
    const m = state.metrics || {}, s = state.settings || {}, labeled = m.human_labeled ?? m.labeled, accuracy = m.human_accuracy ?? m.accuracy;
    $('aoMetrics').replaceChildren(
      metric('Acerto validado', percent(accuracy), Number.isFinite(labeled) && labeled > 0 ? number(labeled) + ' respostas avaliadas por pessoas' : 'Aguardando avaliações de usuários', accuracy),
      metric('Execução operacional', percent(m.success_rate), number(m.successes) + ' sucessos / ' + number(m.decisions) + ' decisões · não mede acerto', m.success_rate),
      metric('Latência p95', Number.isFinite(m.latency_p95_ms) ? number(m.latency_p95_ms) + ' ms' : '—', 'p50: ' + (Number.isFinite(m.latency_p50_ms) ? number(m.latency_p50_ms) + ' ms' : 'sem amostras')),
      metric('Propostas publicadas', percent(m.learning_rate), number(m.published_proposals) + ' publicadas / ' + number(m.proposals) + ' propostas · não mede ganho de acerto', m.learning_rate)
    );
    const costs = $('aoCosts'); costs.replaceChildren(row('Custo registrado estimado', money(m.estimated_cost_usd)), row('Chamadas ao provedor', number(m.provider_calls)), row('Tokens informados: entrada / saída', number(m.input_tokens) + ' / ' + number(m.output_tokens)), row('Chamadas com custo desconhecido', number(m.unknown_cost_calls)), row('Agentes: custo + reserva / limite diário', money(s.daily_spend_usd) + ' / ' + money(s.daily_budget_usd)), row('Chamadas de agentes hoje / limite', number(s.daily_calls_used) + ' / ' + number(s.daily_call_limit)));
    costs.append(node('p', 'ao-caption', 'Estimativa por uso e tarifas configuradas. Chamadas sem preço ficam fora da soma; hospedagem, impostos e transcrição do navegador não estão incluídos.'));
    const chart = $('aoDaily'), days = (state.daily || []).slice(-14); chart.replaceChildren();
    if (!days.length) chart.append(node('p', 'ao-empty', 'Os gráficos aparecem após as primeiras falas registradas.'));
    else {
      const max = Math.max(1, ...days.map(d => d.events || 0));
      for (const day of days) { const column = node('div', 'ao-chart-column'), bars = node('div', 'ao-bars'), total = node('i'), errors = node('i', 'ao-error-bar'); total.style.height = Math.max(0, (day.events || 0) / max * 100) + '%'; errors.style.height = Math.max(0, (day.errors || 0) / max * 100) + '%'; bars.append(total, errors); column.append(node('span', 'ao-chart-count', number(day.events)), bars, node('small', '', String(day.day).slice(5).split('-').reverse().join('/'))); column.title = day.day + ': ' + number(day.events) + ' eventos; ' + number(day.errors) + ' erros; custo ' + money(day.cost_usd); chart.append(column); }
    }
    const learning = [['01', 'Observa', number(m.events) + ' eventos'], ['02', 'Investiga', number(m.unrecognized) + ' tentativas não entendidas'], ['03', 'Propõe', number(m.proposals) + ' propostas'], ['04', 'Testa', number(m.automatic_evaluations) + ' avaliações automáticas'], ['05', 'Ativa', number(m.active_aliases) + ' regras']];
    $('aoLearning').replaceChildren(...learning.map(([n, title, value]) => { const item = node('li'); item.append(node('span', 'ao-step-number', n), node('strong', '', title), node('small', '', value)); return item; }));
    renderServices(s, m);
  }
  function renderServices(s, m) {
    const status = s.provider_status || {}, provider = s.agent_provider || status.provider || 'gemini';
    const providerName = { openai: 'OpenAI', gemini: 'Gemini' }[provider] || 'Provedor';
    const configured = s.provider_configured ?? status.configured ?? (provider === 'gemini' && s.gemini_configured);
    const enabled = s.agents_enabled && s.external_review_enabled !== false;
    const setup = !enabled ? 'Desativada' : !configured ? 'Chave não configurada' : s.paid_agents_ready ? 'Chave e tarifas configuradas' : 'Configure as tarifas';
    let connection = 'Ainda não verificado', tone = 'pending';
    if (status.last_status === 'success' && status.verified === true) { connection = 'Última chamada bem-sucedida'; tone = 'success'; }
    else if (['error', 'timeout'].includes(status.last_status)) {
      const code = status.last_error?.http_status;
      const http = Number.isInteger(code) && code >= 400 && code <= 599 ? ' · HTTP ' + code : '';
      connection = status.last_status === 'timeout' ? 'Tempo de resposta esgotado' : code === 403 ? 'Acesso negado' : code === 401 ? 'Credencial recusada' : code === 429 ? 'Limite de chamadas ou cota' : 'Falha na última chamada';
      connection += http; tone = 'error';
    }
    const warning = $('aoProviderNotice'); warning.hidden = tone !== 'error';
    warning.textContent = tone === 'error' ? 'Última chamada a ' + providerName + ': ' + connection + '. Confira o acesso do projeto e a configuração do provedor.' : '';
    $('aoServices').replaceChildren(...[
      ['Agentes de fundo', s.agents_enabled ? 'Habilitados' : 'Desativados'],
      ['Modelo de análise', providerName + ' · ' + (s.agent_model || status.model || 'não informado'), 'aoProviderModel'],
      ['Análise externa', setup, 'aoProviderConfiguration'],
      ['Conexão do provedor', connection, 'aoProviderConnection'],
      ['Publicação de regras', s.auto_publish ? 'Automática após validação' : 'Desativada'],
      ['Worker', s.worker_mode === 'embedded_durable_queue' ? 'Fila persistida · serviço web' : s.worker_mode || 'Não informado'],
      ['Retenção', Number.isFinite(s.retention_days) ? number(s.retention_days) + ' dias' : 'Não informada'],
      ['Replay de navegação', percent(m.automatic_accuracy) + ' · ' + number(m.synthetic_cases) + ' casos automáticos']
    ].map(([label, value, id]) => { const n = node('div'), strong = node('strong', '', value); if (id) strong.id = id; n.append(node('span', '', label), strong); return n; }));
    $('aoProviderConnection').dataset.state = tone;
    $('aoProviderConnection').title = status.last_check_at ? 'Última chamada: ' + stamp(status.last_check_at) : 'Uma chave configurada ainda não comprova acesso ao provedor.';
  }
  function badge(value) { const b = node('span', 'ao-badge', names[value] || value || '—'); b.dataset.status = value || ''; return b; }
  function jsonDetail(value, title = 'Detalhes') { const d = node('details', 'ao-details'); d.append(node('summary', '', title), node('pre', '', JSON.stringify(value, null, 2))); return d; }
  function account(record) { const n = node('span', '', record.username || (record.user_id ? String(record.user_id).slice(0, 8) : '—')); n.title = record.user_id || 'Conta não informada'; return n; }
  function table(id, headers, records, mapper, empty) {
    const host = $(id); host.replaceChildren(); if (!records.length) { host.append(node('p', 'ao-empty', empty)); return; }
    const wrap = node('div', 'ao-table-wrap'), table = node('table', 'ao-table'), head = node('thead'), body = node('tbody'), tr = node('tr');
    for (const text of headers) { const th = node('th', '', text); th.scope = 'col'; tr.append(th); } head.append(tr);
    for (const record of records) { const tr = node('tr'); for (const value of mapper(record)) { const td = node('td'); if (value instanceof Node) td.append(value); else td.textContent = value ?? '—'; tr.append(td); } body.append(tr); }
    table.append(head, body); wrap.append(table); host.append(wrap);
  }
  function renderHistory() {
    table('aoJobs', ['Execução', 'Conta', 'Agente', 'Estado', 'Atualização', 'Resultado'], state.jobs || [], j => [String(j.id), account(j), names[j.kind] || j.kind, badge(j.status), stamp(j.updated_at || j.created_at), j.error ? node('span', 'ao-error-text', j.error) : j.result ? jsonDetail(j.result, 'Ver evidências') : number(j.attempts) + ' tentativas'], 'Nenhum agente executou ainda. As falas alimentam a fila em segundo plano.');
    table('aoProposals', ['Frase', 'Conta', 'Interpretação', 'Evidências', 'Estado', 'Validação'], state.proposals || [], p => [p.phrase, account(p), names[p.intent] || p.intent, number(p.evidence_count), badge(p.status), jsonDetail({ reason: p.reason, evidence: p.evidence, evaluation: p.evaluation }, 'Por que foi proposta?')], 'Nenhuma proposta de melhoria registrada.');
    table('aoAliases', ['Frase aprendida', 'Conta', 'Ação', 'Estado', 'Criada em', 'Controle'], state.aliases || [], a => {
      const b = node('button', 'compact-button', 'Desativar'); b.type = 'button'; b.disabled = a.status !== 'active'; b.onclick = async () => { b.disabled = true; try { await request('aliases', { id: a.id, action: 'disable' }); notice('Regra desativada. O histórico foi preservado.'); await refresh(false); } catch (error) { b.disabled = false; notice(error.message, true); } };
      return [a.phrase, account(a), names[a.intent] || a.intent, badge(a.status), stamp(a.created_at), b];
    }, 'Nenhuma regra aprendida está disponível. O interpretador padrão continua funcionando.');
    table('aoEvaluations', ['Avaliação', 'Tipo', 'Acerto no conjunto', 'Data', 'Casos'], state.evaluations || [], e => [String(e.id), names[e.kind] || e.kind, number(e.passed) + ' / ' + number(e.total) + (e.total > 0 ? ' · ' + percent(e.passed / e.total) : ''), stamp(e.created_at), jsonDetail(e.details || {}, 'Ver resultados')], 'Execute a regressão padrão ou envie um conjunto de casos rotulados.');
  }
  const flowNodes = [
    { id: 'memory', layer: 1, title: 'Memória do projeto', subtitle: 'API de contexto · evidências', description: 'A API consulta dados do projeto com escopo de conta e reunião. Esta etapa prepara a integração de contexto; o gêmeo digital completo ainda não existe. Contexto recuperado não substitui a fala original nem autoriza inventar valores.' },
    { id: 'speech', layer: 2, title: 'Fala e transcrição', subtitle: 'Finalizar · juntar · completar', description: 'A fala é segmentada antes da classificação. Perguntas de continuidade evitam interpretar um fragmento como uma nova instrução completa.' },
    { id: 'commands', layer: 2, title: 'Intenção e simulação', subtitle: 'Roteamento local + Jev', description: 'Pedidos de navegação reconhecidos podem abrir a simulação diretamente. Edições físicas usam extração, contexto e validação de candidatos. Negação, exemplos e alvo ambíguo não devem executar alterações.' },
    { id: 'events', layer: 2, title: 'Memória da conversa', subtitle: 'Guardar? · Qual evento?', description: 'should_store_memory decide se a informação deve ser retida. event_type classifica a fala preservada em observação, hipótese, proposta, resultado, decisão, requisito ou outro evento.' },
    { id: 'threads', layer: 2, title: 'Assuntos e relações', subtitle: 'Continuidade · vínculo · configuração', description: 'Workers atribuem assuntos e relações em paralelo ao recebimento das próximas falas. A compatibilidade de configurações é avaliada separadamente da existência de um vínculo.' },
    { id: 'audit', layer: 3, title: 'Auditor', subtitle: 'Erros · repetição · recuperação', description: 'Observa a telemetria registrada. Tentativas repetidas e uma intenção reconhecida depois podem gerar uma hipótese de melhoria; repetição sozinha não prova o que o usuário quis.' },
    { id: 'validate', layer: 3, title: 'Avaliador', subtitle: 'Replay + testes de regressão', description: 'Avalia uma proposta em casos positivos e negativos. O processo admite regras limitadas de navegação; não modifica o código do servidor, os cálculos físicos nem treina o modelo Jev.' },
    { id: 'publish', layer: 3, title: 'Publicação e métricas', subtitle: 'Regra versionada · reversível', description: 'Regras aprovadas podem ser ativadas se a publicação automática estiver habilitada. Histórico, custos e resultados ficam visíveis. Acerto humano, execução operacional e regressão automática têm denominadores distintos.' }
  ];
  function renderFlow() {
    const flow = $('aoFlow'); flow.replaceChildren();
    const labels = ['01 · Contexto do projeto', '02 · Resposta em tempo real', '03 · Aprendizado em segundo plano'];
    for (let layer = 1; layer <= 3; layer++) {
      const lane = node('div', 'ao-flow-lane'), track = node('div', 'ao-flow-track'); lane.append(node('h3', '', labels[layer - 1]));
      for (const item of flowNodes.filter(n => n.layer === layer)) { const b = node('button', 'ao-flow-node'); b.type = 'button'; b.dataset.node = item.id; b.setAttribute('aria-pressed', String(item.id === selectedNode)); b.append(node('strong', '', item.title), node('span', '', item.subtitle)); b.onclick = () => { selectedNode = item.id; renderNode(); }; track.append(b); }
      lane.append(track); if (layer === 1) lane.append(node('p', 'ao-flow-edge', '↓ API disponível para contexto · gêmeo digital ainda pendente')); if (layer === 2) lane.append(node('p', 'ao-flow-edge', '↓ Telemetria assíncrona · a reunião não espera pelos agentes')); if (layer === 3) lane.append(node('p', 'ao-flow-edge', '↻ Regras validadas voltam ao roteador de intenção')); flow.append(lane);
    }
    renderNode();
  }
  function renderNode() {
    const item = flowNodes.find(n => n.id === selectedNode), detail = $('aoNodeDetail');
    for (const b of page.querySelectorAll('[data-node]')) b.setAttribute('aria-pressed', String(b.dataset.node === selectedNode));
    detail.replaceChildren(node('h2', '', item.title), node('p', 'ao-node-description', item.description));
    const groups = questionGroups.filter(g => g.node === selectedNode);
    for (const group of groups) { const chips = node('div', 'ao-question-chips'); for (const id of Object.keys(group.questions || {})) { const a = node('a', '', id); a.href = '#ao-q-' + id; a.onclick = event => { event.preventDefault(); const target = $('ao-q-' + id); if (target) { target.open = true; target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }; chips.append(a); } detail.append(chips); }
  }
  async function loadQuestions() {
    const dependencies = [['NorteMemoryV2', 'memory-v2.js'], ['NorteTypedRelations', 'typed-relations.js'], ['NorteMeetingCommands', 'meeting-commands.js'], ['NorteBeamEngine', 'beam-engine.js'], ['NorteBeamCommands', 'beam-commands.js'], ['NorteMeetingSession', 'meeting-session.js']];
    for (const [name, file] of dependencies) if (!window[name]) await import('./' + file + '?v=20261009-1');
    const gate = window.NorteMeetingSession?.speechGate;
    questionGroups = [
      { node: 'speech', title: 'Continuidade da fala', source: 'meeting-session.js', questions: { ...gate?.questions, ...gate?.joinQuestions, ...gate?.commandQuestions } },
      { node: 'commands', title: 'Comandos da reunião', source: 'meeting-commands.js', questions: window.NorteMeetingCommands.defaults.questions },
      { node: 'commands', title: 'Simulação de vigas', source: 'beam-commands.js', questions: window.NorteBeamCommands.defaults.questions },
      { node: 'events', title: 'Memória V2', source: 'memory-v2.js', questions: window.NorteMemoryV2.questions },
      { node: 'threads', title: 'Assuntos', source: 'memory-v2.js · threadConfig', questions: window.NorteMemoryV2.threadConfig.questions },
      { node: 'threads', title: 'Relações e configuração', source: 'typed-relations.js', questions: window.NorteTypedRelations.defaults.questions }
    ];
    let count = 0; const host = $('aoQuestions'); host.replaceChildren();
    for (const group of questionGroups) {
      const section = node('section', 'ao-question-group'); section.append(node('h3', '', group.title), node('p', 'ao-caption', 'Fonte: ' + group.source));
      if (!Object.keys(group.questions).length) section.append(node('p', 'ao-caption', 'Contrato não exposto por este módulo.'));
      for (const [id, q] of Object.entries(group.questions)) { count++; const d = node('details', 'ao-question'), summary = node('summary'), criteria = node('dl'); d.id = 'ao-q-' + id; summary.append(node('code', '', id), node('span', 'ao-badge', q.type)); for (const [label, text] of Object.entries(q.criteria || {})) criteria.append(node('dt', '', label), node('dd', '', text)); d.append(summary, node('p', 'ao-instructions', q.instructions), criteria); section.append(d); } host.append(section);
    }
    $('aoQuestionCount').textContent = count + ' contratos · fontes do runtime';
    for (const b of page.querySelectorAll('[data-node]')) {
      const ids = questionGroups.filter(g => g.node === b.dataset.node).flatMap(g => Object.keys(g.questions));
      if (ids.length) { const contracts = node('span', 'ao-flow-contracts'); for (const id of ids) contracts.append(node('code', '', id)); b.append(contracts); }
    }
    renderNode();
  }
  async function refresh(manual = false) {
    if (loading) return;
    loading = true; $('aoRefresh').disabled = true;
    try { state = await request('overview'); renderMetrics(); renderHistory(); $('aoUpdated').textContent = 'Todas as contas · dados retidos no servidor · atualizado ' + new Date().toLocaleTimeString('pt-BR'); if (manual) notice('Dados atualizados.'); else if (connectionFailed) notice(); connectionFailed = false; }
    catch (error) { connectionFailed = true; notice(error.message, true); $('aoUpdated').textContent = state ? 'Última consulta falhou · dados anteriores' : 'Dados indisponíveis'; if (!state) $('aoMetrics').replaceChildren(node('p', 'ao-empty', 'Sem conexão com os agentes. Nenhuma métrica foi estimada.')); }
    finally { loading = false; $('aoRefresh').disabled = false; }
  }
  function visit() {
    clearInterval(timer); timer = null;
    if (document.body.dataset.page !== 'observatory') return;
    initialize(); activate(tab); refresh(false);
    timer = setInterval(() => { if (!document.hidden && document.body.dataset.page === 'observatory') refresh(false); }, 15000);
  }
  window.addEventListener('norte:page-changed', visit);
  window.addEventListener('pagehide', () => clearInterval(timer));
  window.NorteAIObservatory = { refresh: () => { initialize(); return refresh(true); }, snapshot: () => state ? JSON.parse(JSON.stringify(state)) : null };
  visit();
})();
