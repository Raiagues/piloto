/* Optional local test bench. Does not write to the speech ledger. */
(() => {
  const E = NorteExperiments, C = NorteClassifier;
  const $ = selector => document.querySelector(selector);
  const memoryV2 = new URLSearchParams(location.search).get('profile') === 'memory-v2';
  // Signed-in accounts other than the admin only reach the beam-simulation meetings.
  const restricted = document.body.dataset.auth === 'on' && document.body.dataset.role !== 'admin';
  const key = 'norte.tests.v1';
  const A = NorteAutomation, drafts = { manual: null, automated: null };
  const identityKey='norte.test-identities.v1';
  let optionGroups={}, selectedOptionId=null, currentPlan=null, includeBase=false;
  let inputLayout='tabs',campaignSelection=null,nameEditing=false;
  let testView='tabs',optionNavigationKey='';
  const stackEditors=new Map(),stackCollapsed=new Set(),overviewCollapsed=new Set();
  let editorError='',baseName='',originalName='';
  let page = 'live', commonSetup = null, loadingExample = false, campaign = null, campaignOutcome = null;
  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const percent = value => (value * 100).toFixed(1) + '%';
  const thresholdHint = 'Probabilidade mínima da resposta esperada. Para false usa 1 − P(true); Score usa a probabilidade do nível, não a média. É um critério de teste, não garantia de acerto nem o campo confidence da API.';
  let data = { schemaVersion: 1, cases: [], batches: [] };
  let manualMode = false, busy = false, cancel = false, expected = {};
  let selectedBatch = null, selectedRun = -1, storageBlocked = false;
  let selectedCampaignId=null,inputTab='state';
  const scenarioRuns=new Map();
  const checkedTests = new Set();
  let comparing = false;
  let stateFormat = 'text';
  function el(tag, className, text) { const n = document.createElement(tag); n.className = className; if (text !== undefined) n.textContent = text; return n; }
  function message(text, error = false) { $('#testMessage').textContent = text; $('#testMessage').classList.toggle('error', error); }
  function storageError() { $('#testStorageStatus').textContent = 'Alterações não salvas'; $('#testStorageStatus').title = 'Armazenamento indisponível ou cheio. Mantenha a página aberta e exporte o CSV antes de liberar espaço.'; }
  try {
    const saved = localStorage.getItem(key);
    if (saved) data = E.validateArchive(JSON.parse(saved));
    data.batches.forEach(batch => { if (batch.status === 'running') batch.status = 'interrupted'; });
  } catch (_) { storageBlocked = true; storageError(); }
  function persist() {
    if (storageBlocked) { storageError(); return; }
    try {
      const stored = localStorage.getItem(key);
      if (stored) data = E.mergeArchives(E.validateArchive(JSON.parse(stored)), data);
      localStorage.setItem(key, JSON.stringify(data)); $('#testStorageStatus').textContent = ''; return true;
    }
    catch (_) { storageError(); }
  }
  function lastRun(batch) { return batch?.runs.findLastIndex(run => run.status !== 'deleted') ?? -1; }
  function syncSelection() {
    const existing = new Set(data.batches.map(item => item.id));
    for (const id of checkedTests) if (!existing.has(id)) checkedTests.delete(id);
    if(selectedCampaignId && !data.batches.some(item=>item.automation?.campaignId===selectedCampaignId))selectedCampaignId=null;
    if (!checkedTests.size) comparing = false;
    if (!selectedBatch) return;
    selectedBatch = data.batches.find(item => item.id === selectedBatch.id) || null;
    if (busy && !selectedBatch) cancel = true;
    if (!selectedBatch || selectedBatch.runs[selectedRun]?.status === 'deleted') selectedRun = lastRun(selectedBatch);
  }
  function commitChange(change) {
    if (busy) throw Error('Interrompa o lote antes de alterar testes salvos.');
    if (storageBlocked) throw Error('Armazenamento indisponível. Não foi possível alterar os testes salvos.');
    // Persist first: a failed write must not pretend that a saved item was changed.
    try {
      const stored = localStorage.getItem(key);
      const candidate = stored ? E.mergeArchives(E.validateArchive(JSON.parse(stored)), E.clone(data)) : E.clone(data);
      change(candidate); E.validateArchive(candidate);
      localStorage.setItem(key, JSON.stringify(candidate)); data = candidate;
      $('#testStorageStatus').textContent = '';
    } catch (error) { storageError(); throw error; }
    syncSelection(); refreshPreview(); renderLibrary(); controls();
  }
  function deleteBatch(item) {
    const prompt = 'Excluir o teste “' + E.testName(item) + '” e todas as suas execuções?';
    if (!window.confirm(prompt + '\nEsta exclusão não pode ser desfeita.')) return;
    try {
      commitChange(next => E.removeItem(next, 'batches', item.id));
      message('');
    } catch (error) { message('Não foi possível excluir: ' + error.message, true); }
  }
  function visibleBatches() { return data.batches.filter(item => page === 'automated' ? item.origin === 'automation' : item.origin !== 'automation'); }
  function checkedBatches() { return visibleBatches().filter(item => checkedTests.has(item.id)); }
  function selectionControls() {
    const items = checkedBatches(), count = items.length;
    $('#testSelectionActions').hidden = !count;
    $('#testSelectionCount').textContent = count + ' selecionado' + (count === 1 ? '' : 's');
    $('#compareTests').disabled = busy || !count;
    $('#deleteSelectedTests').disabled = busy || !count || items.some(item => item.status === 'running');
    $('#deleteSelectedTests').setAttribute('aria-label', 'Excluir ' + count + ' testes selecionados');
    $('#clearTestSelection').disabled = busy;
    const all = $('#selectAllTests');
    if (all) { all.checked = count > 0 && count === visibleBatches().length; all.indeterminate = count > 0 && count < visibleBatches().length; all.disabled = busy; }
    document.querySelectorAll('[data-select-test]').forEach(box => {
      box.checked = checkedTests.has(box.dataset.selectTest); box.disabled = busy;
      box.closest('tr').classList.toggle('test-checked', box.checked);
    });
    for(const box of document.querySelectorAll('[data-select-campaign]')) {
      const items=visibleBatches().filter(item=>item.automation?.campaignId===box.dataset.selectCampaign);
      const selected=items.filter(item=>checkedTests.has(item.id)).length;
      box.checked=!!items.length && selected===items.length;box.indeterminate=selected>0 && selected<items.length;box.disabled=busy;
      box.closest('tr').classList.toggle('test-checked',selected>0);
    }
  }
  function selectionChanged() { selectionControls(); renderComparison(); renderCampaign(); }
  $('#clearTestSelection').addEventListener('click', () => { checkedTests.clear(); comparing = false; selectionChanged(); });
  $('#compareTests').addEventListener('click', () => {
    if (busy || !checkedTests.size) return;
    comparing = true; renderComparison(); renderCampaign(); $('#closeTestComparison').focus();
  });
  $('#deleteSelectedTests').addEventListener('click', () => {
    if (busy) return;
    const items = checkedBatches();
    if (!items.length || items.some(item => item.status === 'running')) return;
    const names = items.slice(0, 5).map(item => '• ' + E.testName(item)).join('\n');
    if (!window.confirm('Excluir ' + items.length + ' teste(s) selecionado(s) e todas as suas execuções?\n\n' + names + (items.length > 5 ? '\n… e mais ' + (items.length - 5) : '') + '\n\nEsta exclusão não pode ser desfeita.')) return;
    try {
      commitChange(next => {
        for (const item of items) if (next.batches.some(batch => batch.id === item.id)) E.removeItem(next, 'batches', item.id);
      });
      message('');
    } catch (error) { message('Não foi possível excluir: ' + error.message, true); }
  });
  function activateLog() {
    const panel = manualMode ? 'tests' : 'transcription';
    document.querySelectorAll('.log-panel').forEach(node => { node.classList.toggle('active', node.dataset.panel === panel); node.hidden = node.dataset.panel !== panel; });
  }
  function sidebar(expanded) {
    document.body.classList.toggle('sidebar-expanded', expanded);
    $('#sidebarToggle').setAttribute('aria-expanded', String(expanded));
    $('#sidebarToggle').setAttribute('aria-label', expanded ? 'Recolher navegação' : 'Expandir navegação');
    $('#sidebarOverlay').hidden = !expanded;
    $('.app-shell').inert = expanded && innerWidth <= 900;
    try { sessionStorage.setItem('norte.sidebar', String(expanded)); } catch (_) {}
    NorteLayout.refresh();
  }
  $('#sidebarToggle').addEventListener('click', () => sidebar(!document.body.classList.contains('sidebar-expanded')));
  $('#sidebarOverlay').addEventListener('click', () => sidebar(false));
  window.matchMedia('(max-width: 900px)').addEventListener('change', () => { sidebar(false); });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('sidebar-expanded')) { sidebar(false); $('#sidebarToggle').focus(); } });
  try { sidebar(sessionStorage.getItem('norte.sidebar') === 'true' && innerWidth > 900); } catch (_) {}
  function input() {
    return { name: $('#testName').value.trim() || 'Teste manual', language: $('#testLanguage').value, state: readState(), config: C.getConfig(), expected: E.clone(expected) };
  }
  function readState() { return E.parseState($('#manualState').value, stateFormat); }
  function writeState(value) {
    stateFormat = typeof value === 'string' ? 'text' : 'json'; $('#stateFormat').value = stateFormat;
    $('#manualState').value = E.stateText(value);
  }
  function controls() {
    const ready = !!C.getConfig();
    let stateError = '';
    try { readState(); } catch (error) { stateError = error.message; }
    $('#stateError').textContent = $('#manualState').value.trim() ? stateError : '';
    $('#manualState').setAttribute('aria-invalid', String(!!stateError && !!$('#manualState').value.trim()));
    const meetingBusy = !!window.NorteMeetingRoom?.isRunning();
    const flowBusy = !!window.NorteMemoryPage?.isRunning() || meetingBusy;
    $('#meetingMode').disabled = !ready || busy || loadingExample || !!window.NorteMemoryPage?.isRunning();
    $('#beamMode').disabled = !ready || busy || loadingExample || !!window.NorteMemoryPage?.isRunning();
    $('#manualMode').disabled = !ready || busy || loadingExample || flowBusy; $('#liveMode').disabled = busy || loadingExample || flowBusy; $('#automatedMode').disabled = !ready || busy || loadingExample || flowBusy;
    $('#memoryMode').disabled = !ready || busy || loadingExample || meetingBusy;
    $('#runTest').disabled = !ready || !Object.keys(C.getConfig()?.questions || {}).length || busy || loadingExample || !C.isAvailable() || !!stateError || !$('#applyQuestions').disabled;
    $('#runTest').textContent = busy ? 'Executando…' : 'Executar';
    $('#runTest').title = C.getProvider() === 'official' ? 'Envia State e Questions à TypeSafe. Cada repetição consome uma chamada da API.' : 'Executar no modelo local';
    $('#newTestCase').disabled = busy || loadingExample; $('#testRepeats').disabled = busy;
    $('#clearTestDraft').disabled = busy || loadingExample;
    $('#clearTestDraft').hidden = page!=='automated';
    $('#useExample').hidden = page==='automated';
    $('#testLanguage').disabled = busy || loadingExample; $('#testName').readOnly = busy || loadingExample || !nameEditing; $('#manualState').readOnly = busy || loadingExample;
    if(page==='manual' && ready && !stateError && !busy && !nameEditing && !selectedBatch && (!$('#testName').value.trim() || /^(JEV-\d+-U\d+-C\d+|Protótipo)/.test($('#testName').value))) {
      try{$('#testName').value=A.identify(input(),readIdentities()).name;}catch(_){}
    }
    $('#questionEditor').readOnly = busy || loadingExample;
    $('#stateFormat').disabled = busy; $('#useExample').disabled = busy || loadingExample || !ready;
    if (busy) $('#applyQuestions').disabled = true;
    $('#cancelTest').hidden = !busy; $('#cancelTest').disabled = cancel;
    for (const node of document.querySelectorAll('#testVariantMenu button, #renameCurrentTest, #backToDraft')) node.disabled = busy || loadingExample;
    automationControls();
    $('#questionsPending').hidden=$('#applyQuestions').disabled;$('#questionsInputTab').title=$('#applyQuestions').disabled?'Editar perguntas':'Há alterações de Questions ainda não aplicadas';
    selectionControls();
  }
  function captureDraft() {
    return { name:$('#testName').value, language:$('#testLanguage').value, text:$('#manualState').value, format:stateFormat, config:C.getConfig(), editor:$('#questionEditor').value, expected:E.clone(expected), batchId:selectedBatch?.id, campaignId:selectedCampaignId,campaignSelection,inputTab,inputLayout,testView,collapsedStates:[...stackCollapsed], run:selectedRun, repeats:$('#testRepeats').value, automation:automationOptions(), view:$('#autoStateView').value };
  }
  function setMode(next) {
    if (busy || !C.getConfig()) return;
    if (next === page) return;
    if (['manual', 'automated'].includes(page)) drafts[page] = captureDraft();
    const enabled = next !== 'live';
    window.dispatchEvent(new CustomEvent('norte:page-changing', { detail: { manual: enabled, page: next } }));
    manualMode = enabled; page = next; C.setManualMode(enabled); comparing = false; checkedTests.clear();selectedCampaignId=null;inputTab='state';
    inputLayout=next==='manual'?'stacked':'tabs';testView='tabs';stackCollapsed.clear();campaignSelection=null;$('#testVariantMenu').hidden=true;
    if (['manual', 'automated'].includes(next)) {
      const draft = drafts[next];
      if (draft) {
        $('#testName').value=draft.name; $('#testLanguage').value=draft.language; $('#manualState').value=draft.text; stateFormat=draft.format; $('#stateFormat').value=stateFormat;
        expected=E.clone(draft.expected); C.loadDraftConfig(draft.config,draft.editor);
        selectedBatch=data.batches.find(item=>item.id===draft.batchId) || null; selectedRun=draft.run; $('#testRepeats').value=draft.repeats;
        selectedCampaignId=draft.campaignId || null;inputTab=draft.inputTab==='questions'?'questions':'state';
        inputLayout=['tabs','stacked'].includes(draft.inputLayout)?draft.inputLayout:inputLayout;campaignSelection=draft.campaignSelection || null;
        testView=draft.testView==='stacked'?'stacked':'tabs';
        if(Array.isArray(draft.collapsedStates))for(const id of draft.collapsedStates)if(typeof id==='string')stackCollapsed.add(id);
        setAutomationOptions(draft.automation); $('#autoStateView').value=draft.view;
      } else {
        blankInput();
      }
    }
    document.body.dataset.page = page;
    const meetingPage = ['meeting','beam'].includes(page);
    $('#sessionContent').hidden = page === 'memory' || page === 'observatory' || meetingPage; $('#memoryPage').hidden = page !== 'memory';
    $('#aiObservatoryPage').hidden = page !== 'observatory';
    const roomOpen = window.NorteMeetingRoom?.view() === 'room';
    $('#meetingPage').hidden = !meetingPage || !roomOpen; $('#meetingHeader').hidden = !meetingPage || !roomOpen;
    $('#roomLibrary').hidden = !meetingPage || roomOpen; $('#roomLibraryHeader').hidden = !meetingPage || roomOpen;
    for (const [selector, active] of [['#aiObservatoryMode', page==='observatory'], ['#meetingMode', page==='meeting'], ['#beamMode', page==='beam'], ['#manualMode', page==='manual'], ['#automatedMode', page==='automated'], ['#memoryMode', page==='memory' && !memoryV2], ['#memoryV2Mode', page==='memory' && memoryV2], ['#liveMode', !enabled]]) { $(selector).classList.toggle('selected', active); if (active) $(selector).setAttribute('aria-current', 'page'); else $(selector).removeAttribute('aria-current'); }
    for (const selector of ['.header-context', '.audio-widget', '.header-actions', '.log-options']) $(selector).hidden = enabled;
    $('.manual-page-title').hidden = !enabled || meetingPage; $('#testToolbar').hidden = !enabled;
    $('#logHeading').textContent = enabled ? 'Testes' : 'Transcrição';
    $('.log-shell').setAttribute('aria-label', enabled ? 'Testes' : 'Transcrição da reunião');
    $('.manual-page-title h1').textContent = page==='observatory' ? 'Agentes e métricas' : page==='beam' ? 'Reuniões · simulação de vigas' : page==='meeting' ? 'Reuniões' : page==='memory' ? (memoryV2 ? 'Fluxo de memória V2' : 'Fluxo de memória') : page==='automated' ? 'Testes automatizados' : 'Classificador manual';
    document.title = enabled ? 'Norte · ' + $('.manual-page-title h1').textContent : 'Norte · ' + $('#meetingName').value;
    $('#liveStateView').hidden = enabled; $('#manualStateView').hidden = !enabled;
    renderInputTabs();
    NorteLayout.refresh();
    $('#testSummary').hidden = !enabled;
    if (['manual', 'automated'].includes(page)) {
      // Keep the manual draft separate; saved executions restore their own Questions.
      expected = compatibleExpected(expected, C.getConfig().questions);
      refreshPreview();
    }
    activateLog();
    renderComparison();
    renderCampaign();
    controls(); renderLibrary();
    window.dispatchEvent(new CustomEvent('norte:page-changed', { detail: { page } }));
  }
  function navigate(next, updateHistory = true) {
    if (typeof next === 'boolean') next = next ? 'manual' : 'live';
    if (restricted) next = 'beam';
    if (busy || loadingExample || window.NorteMemoryPage?.isRunning() || window.NorteMeetingRoom?.isRunning() || !C.getConfig()) {
      if (busy || loadingExample || window.NorteMemoryPage?.isRunning() || window.NorteMeetingRoom?.isRunning()) { window.dispatchEvent(new CustomEvent('norte:notice', { detail: 'Aguarde ou interrompa a execução antes de mudar de página.' })); history.replaceState(null, '', page==='observatory'?'#agentes':page==='beam'?'#simulacao':page==='meeting'?'#reuniao':page==='memory'?'#memoria':page==='live'?'#ao-vivo':page==='automated'?'#automatizados':'#manual'); }
      return;
    }
    setMode(next);
    const hash=next==='observatory'?'#agentes':next==='beam'?'#simulacao':next==='meeting'?'#reuniao':next==='memory'?'#memoria':next==='live'?'#ao-vivo':next==='automated'?'#automatizados':'#manual';
    if (updateHistory && location.hash !== hash) history.pushState(null, '', hash);
    if (innerWidth <= 900) sidebar(false);
  }
  const fromLocation = () => navigate(location.hash === '#agentes' ? 'observatory' : location.hash === '#simulacao' ? 'beam' : location.hash === '#reuniao' ? 'meeting' : (location.hash === '#memoria' || memoryV2 && !location.hash)?'memory':location.hash === '#automatizados'?'automated':location.hash === '#manual'?'manual':'live', false);
  window.addEventListener('popstate', fromLocation);
  window.addEventListener('hashchange', fromLocation);
  function compatibleExpected(values, questions) {
    return Object.fromEntries(Object.entries(values).filter(([id, value]) => {
      try { E.validateExpected({ [id]: value }, questions); return true; } catch (_) { return false; }
    }));
  }
  function dirty() { selectedBatch = null; selectedRun = -1; selectedCampaignId=null; campaignSelection=null;comparing = false; campaignOutcome=null; controls(); refreshPreview(); }
  function renderInputTabs() {
    $('#requestHeader').hidden=!manualMode;
    const stacked=!manualMode || inputLayout==='stacked';$('#inputPaneBody').dataset.layout=stacked?'stacked':'tabs';
    $('#testInputTabs').hidden=!manualMode || stacked;
    $('#inputLayoutToggle').setAttribute('aria-pressed',String(stacked));
    $('#inputLayoutTabs').setAttribute('aria-pressed',String(!stacked));
    for(const kind of ['state','questions']) {
      const panel=$('#'+kind+'InputPanel'),tab=$('#'+kind+'InputTab'),active=inputTab===kind;
      panel.hidden=!stacked && !active;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      if(manualMode && !stacked){panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);}
      else{panel.removeAttribute('role');panel.setAttribute('aria-labelledby',kind==='state'?'stateHeading':'questionsHeading');}
    }
    $('#stateDivider').hidden=!stacked;NorteLayout.refresh();
  }
  function setInputLayout(next) {
    const reset=next==='stacked' && inputLayout!=='stacked';inputLayout=next;renderInputTabs();
    if(reset)NorteLayout.reset('#stateDivider',50);
  }
  $('#inputLayoutToggle').addEventListener('click',()=>setInputLayout('stacked'));
  $('#inputLayoutTabs').addEventListener('click',()=>setInputLayout('tabs'));
  for(const kind of ['state','questions']) {
    const tab=$('#'+kind+'InputTab');
    tab.addEventListener('click',()=>{inputTab=kind;renderInputTabs();});
    tab.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();inputTab=event.key==='Home'?'state':event.key==='End'?'questions':inputTab==='state'?'questions':'state';renderInputTabs();$('#'+inputTab+'InputTab').focus();}});
  }
  const inputDragType='application/x-norte-input';
  for(const handle of document.querySelectorAll('[data-input-drag]')) {
    handle.title='Arraste para empilhar ou juntar State e Questions';
    handle.addEventListener('dragstart',event=>{if(!manualMode)return;event.stopPropagation();event.dataTransfer.setData(inputDragType,handle.dataset.inputDrag);event.dataTransfer.effectAllowed='move';});
    handle.addEventListener('dragend',()=>delete $('#inputPaneBody').dataset.dropInput);
  }
  for(const [selector,layout]of [['#testInputTabs','tabs'],['#requestHeader','tabs'],['#inputPaneBody','stacked']]) {
    const target=$(selector);
    target.addEventListener('dragover',event=>{if(!Array.from(event.dataTransfer.types).includes(inputDragType))return;event.preventDefault();event.stopPropagation();if(layout==='stacked')target.dataset.dropInput='stacked';});
    target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))delete target.dataset.dropInput;});
    target.addEventListener('drop',event=>{const source=event.dataTransfer.getData(inputDragType);if(!['state','questions'].includes(source))return;event.preventDefault();event.stopPropagation();inputTab=source;delete $('#inputPaneBody').dataset.dropInput;setInputLayout(layout);if(layout==='tabs')$('#'+source+'InputTab').focus();});
  }
  $('#meetingMode').addEventListener('click', () => navigate('meeting'));
  $('#aiObservatoryMode').addEventListener('click', () => navigate('observatory'));
  $('#beamMode').addEventListener('click', () => navigate('beam'));
  $('#manualMode').addEventListener('click', () => navigate(true));
  $('#automatedMode').addEventListener('click', () => navigate('automated'));
  $('#memoryMode').addEventListener('click', () => {
    if (!memoryV2) return navigate('memory');
    const original = new URL(location.href); original.searchParams.delete('profile'); original.hash = 'memoria';
    window.open(original.href, '_blank', 'noopener');
  });
  $('#memoryV2Mode').addEventListener('click', event => {
    if (memoryV2) { event.preventDefault(); navigate('memory'); }
  });
  if (memoryV2) {
    $('#memoryV2Mode').removeAttribute('target');
    $('#memoryV2Mode').title = 'Fluxo de memória V2';
    $('#memoryMode').title = 'Fluxo de memória original · abrir em nova aba';
  }
  $('#liveMode').addEventListener('click', () => navigate(false));
  $('#manualState').addEventListener('input',()=>{const source=$('#manualState').value.trim();stateFormat=/^[{\["]/.test(source)?'json':'text';$('#stateFormat').value=stateFormat;dirty();});
  $('#testName').addEventListener('input',()=>{if(!nameEditing)dirty();});
  $('#stateFormat').addEventListener('change', () => {
    const next = $('#stateFormat').value;
    try {
      if (!$('#manualState').value.trim()) { stateFormat = next; dirty(); return; }
      const value = readState();
      $('#manualState').value = next === 'json' ? JSON.stringify(value, null, 2) : E.stateText(value);
      stateFormat = next; dirty();
    } catch (error) { $('#stateFormat').value = stateFormat; $('#stateError').textContent = error.message; }
  });
  $('#testLanguage').addEventListener('change', dirty);
  $('#manualState').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('#runTest').click(); }
  });
  $('#questionEditor').addEventListener('input', controls);
  window.addEventListener('norte:questions-changed', () => {
    if (manualMode) {
      expected = compatibleExpected(expected, C.getConfig().questions);
      for(const options of Object.values(optionGroups)) for(const option of options)option.expected=compatibleExpected(option.expected,C.getConfig().questions);
      dirty();
      rememberIdentities();
    }
  });
  window.addEventListener('norte:classifier-ready', async () => { if (!restricted) try { await fetchCommon(); } catch (_) {} fromLocation(); controls(); });
  window.addEventListener('norte:model-status', controls);
  window.addEventListener('norte:memory-running', controls);
  window.addEventListener('norte:meeting-running', controls);
  function parsedInput(value) { return {name:value.name || 'Teste',language:value.language || 'en',state:value.state,config:{model:value.model,questions:value.questions},expected:value.expected || {}}; }
  async function fetchCommon() {
    const response=await fetch('manual-test-example.json',{cache:'no-store'});
    if (!response.ok) throw Error('Não foi possível carregar o exemplo.');
    const candidate=parsedInput(E.parseRequest(await response.text())); E.validateInput(candidate); commonSetup=candidate; return E.clone(candidate);
  }
  async function useExample() {
    if (busy || loadingExample || !manualMode) return;
    loadingExample=true; controls();
    try { const value=await fetchCommon(); fillInput(value); if(page==='automated'){$('#autoStateView').value='variants';setAutomationOptions(defaultAutomation());} inputTab='state';renderInputTabs();dirty(); message(''); }
    catch(error){message(error.message,true);}
    finally {loadingExample=false;controls();refreshPreview();}
  }
  $('#useExample').addEventListener('click',useExample);
  function defaultAutomation() {
    const options=commonSetup?A.exampleOptions(commonSetup.config.questions).map(option=>({...option,focusField:'current_utterance',state:{...E.clone(commonSetup.state),current_utterance:option.text}})):[];
    return {field:'current_utterance',options,repeats:1};
  }
  function optionsForField() { return optionGroups[$('#autoField').value] || []; }
  function activeOption() { return page==='automated' && $('#autoStateView').value==='variants' && $('#autoField').value!=='fixed' ? optionsForField().find(option=>option.id===selectedOptionId) : null; }
  function automationOptions() { return {field:$('#autoField').value,options:E.clone(optionsForField()),groups:E.clone(optionGroups),selectedOptionId,baseName,includeBase,repeats:Number($('#testRepeats').value)}; }
  function setAutomationOptions(value) {
    baseName=value.baseName || '';
    includeBase=value.includeBase===true;
    $('#autoField').value=value.field;
    optionGroups=E.clone(value.groups || {});
    if(Array.isArray(value.options))optionGroups[value.field]=E.clone(value.options);
    else {
      // Migrate old tab drafts without retaining the removed Questions variation axis.
      let variants;
      try { variants=value.format==='json'?JSON.parse(value.variants):String(value.variants || '').split(/\r?\n\s*\r?\n/); } catch(_){ variants=[value.variants || '']; }
      optionGroups[value.field]=(Array.isArray(variants)?variants:[]).map((entry,index)=>{
        const v=typeof entry==='string'?entry:entry.value;
        const labels=value.expectations==='fixed'?expected:value.expectations==='variant'?entry.expected || {}:{};
        const normalized=E.parseRequest(JSON.stringify({model:C.getConfig().model,questions:C.getConfig().questions,state:'Migration',expected:labels})).expected;
        return {id:String(index+1),text:value.field==='state'?JSON.stringify(v,null,2):Array.isArray(v)?v.join('\n'):String(v ?? ''),expected:normalized};
      });
    }
    if(commonSetup && optionGroups.current_utterance) {
      try {optionGroups.current_utterance=A.completeDecisionDraft(optionGroups.current_utterance,{config:C.getConfig(),state:readState()},commonSetup);}catch(_){}
    }
    if(Array.isArray(value.options) && !value.options.length) {
      $('#autoField').value='fixed';optionGroups.fixed=[];includeBase=true;
    }
    selectedOptionId=Object.hasOwn(value,'selectedOptionId')?value.selectedOptionId:optionsForField()[0]?.id || null;renderOptions();
  }
  function readIdentities() {
    const saved=localStorage.getItem(identityKey),catalog=A.registry(saved?JSON.parse(saved):null);
    if(!saved)for(const batch of data.batches)A.identify(batch.input,catalog);
    return catalog;
  }
  function planned() { return A.plan(input(),automationOptions(),nextRound(),readIdentities()); }
  function rememberIdentities() {
    if(!manualMode || busy || selectedBatch || selectedCampaignId || !$('#applyQuestions').disabled)return;
    let catalog;
    try{catalog=page==='automated'?planned().registry:readIdentities();if(page==='manual')A.identify(input(),catalog);}catch(_){return;}
    try{localStorage.setItem(identityKey,JSON.stringify(catalog));}catch(_){storageError();}
  }
  $('#manualState').addEventListener('blur',rememberIdentities);
  $('#autoStateEditor').addEventListener('blur',rememberIdentities);
  let displayedEditorKey=null;
  function optionField(option) { return option?.field || $('#autoField').value; }
  function optionState(option) {
    if(option && Object.hasOwn(option,'state'))return E.clone(option.state);
    const base=readState();if(!option)return base;
    const field=optionField(option);
    if(field==='state')return E.parseState(option.text,'json');
    const value=field==='recent_context'?option.text.split(/\r?\n/).filter(line=>line.trim()):option.text;
    return {...base,[field]:value};
  }
  function closeVariantMenu() { $('#testVariantMenu').hidden=true;$('#addTestVariation').setAttribute('aria-expanded','false');$('#addVariantChoices').hidden=true; }
  function selectDraftOption(id) {
    selectedOptionId=id;$('#autoStateView').value='variants';displayedEditorKey=null;editorError='';
    closeVariantMenu();dirty();inputTab='state';renderInputTabs();
  }
  function testEntries() {
    const historic=selectedCampaignId?data.batches.filter(b=>b.automation?.campaignId===selectedCampaignId):[];
    if(historic.length)return historic.map((batch,index)=>({key:batch.id,label:E.testName(batch),batch,selected:batch.id===selectedBatch?.id || (!selectedBatch && index===0),field:'State salvo'}));
    let original=baseName || 'Novo teste';if(!baseName)try{original=A.identify(input(),currentPlan?.registry || readIdentities()).name;}catch(_){}
    return [{key:'base',label:original,selected:!activeOption(),field:'Original'},...optionsForField().map((option,i)=>({
      key:option.id,label:option.name || currentPlan?.items.find(item=>item.optionId===option.id)?.input.name || 'Variação '+(i+1),
      option,selected:option.id===selectedOptionId,field:optionField(option)
    }))];
  }
  function activateEntry(entry) { stackCollapsed.delete(entry.key);if(entry.batch)selectCampaignTest(entry.batch.id);else selectDraftOption(entry.option?.id || null); }
  function removeOption(option) {
    if(busy || loadingExample)return;
    optionGroups[$('#autoField').value]=optionsForField().filter(o=>o.id!==option.id);
    if(selectedOptionId===option.id)selectedOptionId=optionsForField()[0]?.id || null;
    if(!optionsForField().length){$('#autoField').value='fixed';optionGroups.fixed=[];includeBase=true;}
    displayedEditorKey=null;dirty();
  }
  const testDragType='application/x-norte-test';
  function draggableTest(node,key) {
    node.draggable=true;node.title='Arraste para o State para empilhar os testes, ou para as abas para agrupá-los';
    node.addEventListener('dragstart',event=>{if(busy)return;event.stopPropagation();event.dataTransfer.setData(testDragType,key);event.dataTransfer.effectAllowed='move';});
    node.addEventListener('dragend',()=>{delete $('#automationSetup').dataset.dropTests;});
  }
  function entryText(entry) {
    try{return entry.batch?E.stateText(entry.batch.input.state):entry.option?.editor ?? entry.option?.stateSource ?? (entry.option?E.stateText(optionState(entry.option)):$('#manualState').value);}
    catch(_){return entry.option?.editor || $('#manualState').value;}
  }
  function renderOptions() {
    const automatic=page==='automated',node=$('#autoOptions'),entries=automatic?testEntries():[];
    const wasHidden=node.hidden;
    $('#automationNavigator').hidden=!automatic;
    const stacked=automatic && testView==='stacked';
    $('#testViewTabs').setAttribute('aria-pressed',String(!stacked));$('#testViewStacked').setAttribute('aria-pressed',String(stacked));
    $('#testViewTabs').disabled=$('#testViewStacked').disabled=busy || loadingExample;
    node.hidden=stacked;$('#autoStateStack').hidden=!stacked;$('#autoStateCodeView').hidden=stacked;
    $('#addTestVariation').hidden=!!selectedCampaignId;$('#addTestVariation').disabled=busy || loadingExample || optionsForField().length+(includeBase?1:0)>=50;
    const signature=JSON.stringify([entries.map(e=>[e.key,e.label,e.field,e.selected,!!e.batch]),busy,loadingExample,testView]);
    if(optionNavigationKey!==signature) {
      const scrollLeft=node.scrollLeft,activeKey=entries.find(e=>e.selected)?.key || '',reveal=node.dataset.activeTest!==activeKey || wasHidden;
      node.dataset.activeTest=activeKey;
      optionNavigationKey=signature;node.replaceChildren();
      for(const entry of entries) {
        const item=el('div','request-option'+(entry.selected?' selected':'')),button=el('button','request-option-tab',entry.label);
        button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(entry.selected));
        button.setAttribute('aria-controls',stacked?'autoStateStack':'autoStateCodeView');button.tabIndex=entry.selected?0:-1;button.disabled=busy || loadingExample;
        button.setAttribute('aria-label',entry.label+' · '+entry.field);
        if(entry.batch)button.dataset.selectSaved=entry.key;else if(entry.option)button.dataset.selectOption=entry.key;else button.dataset.selectBase='';
        button.addEventListener('click',()=>activateEntry(entry));draggableTest(button,entry.key);item.append(button);
        if(entry.option && entry.selected) {
          const remove=el('button','text-button','×');remove.type='button';remove.dataset.removeOption=entry.key;remove.disabled=busy || loadingExample;
          remove.setAttribute('aria-label','Excluir variação '+entry.label);remove.addEventListener('click',()=>removeOption(entry.option));item.append(remove);
        }
        node.append(item);
      }
      if(!entries.some(e=>e.selected))node.querySelector('[role=tab]')?.setAttribute('tabindex','0');
      node.scrollLeft=scrollLeft;
      if(reveal)requestAnimationFrame(revealActiveTab);
    }
    renderStackedTests(stacked?entries:[]);
  }
  function renderStackedTests(entries) {
    const host=$('#autoStateStack'),keys=new Set(entries.map(entry=>entry.key));
    for(const [key,view]of stackEditors)if(!keys.has(key)){view.editor.dispose();view.node.remove();stackEditors.delete(key);}
    for(const entry of entries) {
      let view=stackEditors.get(entry.key);
      if(!view) {
        const node=el('section','stacked-test'),heading=el('div','stacked-test-heading'),toggle=el('button','text-button stack-disclosure'),select=el('button','text-button'),field=el('small',''),remove=el('button','text-button','×');
        node.dataset.stackTest=entry.key;select.type=remove.type='button';select.dataset.stackSelect=entry.key;draggableTest(select,entry.key);
        toggle.type='button';toggle.dataset.stackToggle=entry.key;heading.append(toggle,select,field,remove);
        const code=el('div','code-view editable-code state-editor'),stack=el('div','code-stack'),mirror=el('pre','stack-state-highlight'),input=el('textarea','stack-state-editor');
        code.id='stack-state-'+entry.key;toggle.setAttribute('aria-controls',code.id);
        mirror.setAttribute('aria-hidden','true');input.spellcheck=false;input.wrap='soft';
        stack.append(mirror,input);code.append(stack);node.append(heading,code);host.append(node);
        view={node,select,toggle,code,field,remove,input,editor:C.codeEditor(input,mirror),entry};stackEditors.set(entry.key,view);
        toggle.addEventListener('click',()=>{if(stackCollapsed.has(entry.key))stackCollapsed.delete(entry.key);else stackCollapsed.add(entry.key);syncStackDisclosure(view);});
        select.addEventListener('click',()=>activateEntry(view.entry));
        remove.addEventListener('click',()=>removeOption(view.entry.option));
        input.addEventListener('focus',()=>{
          if(view.entry.batch && !busy){forkSavedInput(view.entry.batch,'state');return;}
          if(!view.entry.selected && !busy)activateEntry(view.entry);
        });
        input.addEventListener('input',()=>{if(!busy && !view.entry.batch)editStateVariant(input.value,view.entry.option);});
        input.addEventListener('blur',rememberIdentities);
      }
      view.entry=entry;view.node.classList.toggle('selected',entry.selected);view.select.textContent=entry.label;
      view.select.setAttribute('aria-pressed',String(entry.selected));view.field.textContent=entry.field;
      view.field.title=entry.option?.focusField?'Destaque visual; todos os campos do State são editáveis.':'';
      view.select.disabled=busy || loadingExample;view.remove.hidden=!entry.option;view.remove.disabled=busy || loadingExample;
      view.remove.setAttribute('aria-label','Excluir variação '+entry.label);
      view.input.setAttribute('aria-label','State de '+entry.label);view.input.readOnly=busy || loadingExample || !!entry.batch;
      view.input.setAttribute('aria-invalid',String(!!entry.option?.editor));
      const text=entryText(entry);if(view.input.value!==text)view.input.value=text;syncStackDisclosure(view);view.editor.markField(entry.option?.focusField || '');
    }
  }
  function syncStackDisclosure(view) {
    const open=!stackCollapsed.has(view.entry.key);
    view.node.classList.toggle('collapsed',!open);view.code.hidden=!open;view.toggle.textContent=open?'⌄':'›';
    view.toggle.setAttribute('aria-expanded',String(open));view.toggle.setAttribute('aria-label',(open?'Recolher':'Expandir')+' State de '+view.entry.label);
    view.editor.refresh();
  }
  function revealActiveTab() {
    const node=$('#autoOptions'),active=node.querySelector('[aria-selected=true]')?.parentElement;
    if(node.hidden || !active)return;
    const rail=node.getBoundingClientRect(),tab=active.getBoundingClientRect();
    if(tab.left<rail.left)node.scrollLeft+=tab.left-rail.left;
    else if(tab.right>rail.right)node.scrollLeft+=tab.right-rail.right;
  }
  $('#autoOptions').addEventListener('wheel',event=>{
    const node=event.currentTarget;if(event.ctrlKey || Math.abs(event.deltaX)>Math.abs(event.deltaY) || node.scrollWidth<=node.clientWidth)return;
    const delta=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?node.clientWidth:1);
    if((delta<0 && node.scrollLeft>0) || (delta>0 && node.scrollLeft<node.scrollWidth-node.clientWidth)){
      event.preventDefault();node.scrollLeft+=delta;
    }
  },{passive:false});
  function setTestView(next) {
    if(busy)return;testView=next;inputTab='state';renderInputTabs();renderOptions();C.refreshEditors();
  }
  $('#testViewTabs').addEventListener('click',()=>setTestView('tabs'));
  $('#testViewStacked').addEventListener('click',()=>setTestView('stacked'));
  $('#autoOptions').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key) || busy)return;
    const entries=testEntries(),index=entries.findIndex(e=>e.selected);
    const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowRight'?1:-1)+entries.length)%entries.length;
    if(!entries[next])return;event.preventDefault();activateEntry(entries[next]);$('#autoOptions [aria-selected=true]')?.focus();
  });
  for(const [selector,layout]of [['#automationNavigator','tabs'],['#automationSetup','stacked']]) {
    const target=$(selector);
    target.addEventListener('dragover',event=>{if(busy || !Array.from(event.dataTransfer.types).includes(testDragType))return;event.preventDefault();event.stopPropagation();if(layout==='stacked')target.dataset.dropTests='';});
    target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))delete target.dataset.dropTests;});
    target.addEventListener('drop',event=>{
      const key=event.dataTransfer.getData(testDragType);if(!key || busy)return;
      event.preventDefault();event.stopPropagation();delete target.dataset.dropTests;
      const entry=testEntries().find(e=>e.key===key);if(!entry)return;activateEntry(entry);setTestView(layout);
      if(layout==='stacked')stackEditors.get(key)?.node.scrollIntoView({block:'nearest'});else $('#autoOptions [aria-selected=true]')?.focus();
    });
  }
  $('#addTestVariation').addEventListener('click',()=>{
    const open=$('#testVariantMenu').hidden;$('#testVariantMenu').hidden=!open;$('#addVariantChoices').hidden=!open;
    $('#addTestVariation').setAttribute('aria-expanded',String(open));
  });
  function nextRound() {
    const stored=Number(localStorage.getItem('norte.automation.round') || 0);
    if(!Number.isInteger(stored) || stored<0)throw Error('Contador de rodadas inválido.');
    return Math.max(stored,...data.batches.map(item=>item.automation?.round || 0))+1;
  }
  function syncRequestEditor() {
    const automatic=page==='automated',saved=automatic && (selectedBatch || (selectedCampaignId && data.batches.find(b=>b.automation?.campaignId===selectedCampaignId))),option=activeOption();
    const identity=selectedBatch?E.testName(selectedBatch):saved?E.testName(saved):automatic?(currentPlan?.items.find(item=>item.optionId===option?.id)?.input.name || (option?.name || (!option && baseName) || (()=>{try{return A.identify(input(),currentPlan?.registry || readIdentities()).name;}catch(_){return 'Novo teste';}})())):$('#testName').value;
    if(!nameEditing && automatic)$('#testName').value=identity;
    $('#requestHeader').dataset.selectedTest=saved?.id || selectedBatch?.id || option?.id || 'base';
    $('#renameCurrentTest').disabled=busy || loadingExample || (!!saved && !selectedBatch);
    $('#requestHeader').classList.toggle('inspecting-test',!!saved);
    $('#testName').style.width=Math.max(15,Math.min(28,$('#testName').value.length+3))+'ch';
    $('#backToDraft').hidden=!automatic || (!saved && !selectedCampaignId);$('#testLanguage').disabled=busy || loadingExample || !!saved;
    $('#testLanguage').hidden=!!saved;$('#savedTestLanguage').hidden=!saved;
    if(saved)$('#savedTestLanguage').textContent=saved.input.language.toUpperCase();
    $('#testRepeats').hidden=!!saved;$('#savedTestRepeats').hidden=!saved;
    if(saved){$('#savedTestRepeats').textContent=saved.requested+'×';$('#savedTestRepeats').title=saved.requested+' execuções solicitadas neste teste';$('#automationCount').hidden=true;}
    $('#savedQuestions').hidden=!saved;$('#questionsInputPanel .editable-code').hidden=!!saved;$('#applyQuestions').hidden=!!saved;
    if(saved)C.highlight($('#savedQuestions'),JSON.stringify(saved.input.config.questions,null,2));
    if(!automatic){renderOptions();C.refreshEditors();return;}
    $('#autoStateEditor').readOnly=busy || loadingExample || !!saved;
    const editorKey=saved?'result:'+saved.id:'draft:'+(option?.id || 'base');
    const text=entryText({batch:saved,option});
    if(displayedEditorKey!==editorKey || document.activeElement!==$('#autoStateEditor') || saved)$('#autoStateEditor').value=text;
    displayedEditorKey=editorKey;$('#autoStateEditor').title=saved?'State original de '+E.testName(saved):option?'Variação de '+optionField(option):'State original compartilhado pelas variações';
    C.refreshEditors();C.markStateField(saved?'':option?.focusField || '');
    renderOptions();
  }
  function automationControls() {
    const active=page==='automated';
    $('#automationSetup').hidden=!active;$('#manualState').hidden=active;$('#manualStateCodeView').hidden=active;$('#automationCount').hidden=!active;
    $('#stateError').hidden=active;
    if(active){
      if(!busy){
        try{
          currentPlan=planned();$('#automationCount').textContent=currentPlan.count+(currentPlan.count===1?' teste · ':' testes · ')+currentPlan.calls+(currentPlan.calls===1?' chamada':' chamadas');
          $('#automationError').textContent='';$('#autoStateEditor').removeAttribute('aria-invalid');
        }catch(error){
          currentPlan=null;const empty=!$('#manualState').value.trim() && !$('#questionEditor').value.trim() && !optionsForField().some(option=>option.stateSource?.trim() || option.text?.trim());
          $('#automationError').textContent=empty?'':editorError || error.message;$('#autoStateEditor').setAttribute('aria-invalid',String(!empty));
          $('#automationCount').textContent='';$('#runTest').disabled=true;
        }
      }else $('#automationCount').textContent=campaign?campaign.completed+'/'+campaign.calls+' chamadas':'';
      $('#runTest').textContent=busy?'Executando…':'Executar rodada';
      if((selectedBatch || selectedCampaignId) && !busy){$('#runTest').disabled=true;$('#runTest').title='Volte ao rascunho para executar uma nova rodada.';}
    }
    syncRequestEditor();
  }
  function sourceFormat(raw) { return /^[{\["]/.test(raw.trim())?'json':'text'; }
  function updateOptionState(option,raw) {
    option.stateSource=raw;option.stateFormat=sourceFormat(raw);
    try {
      const value=E.parseState(raw,option.stateFormat),field=optionField(option);
      option.state=E.clone(value);
      option.text=field==='current_utterance' && typeof value?.current_utterance==='string'?value.current_utterance:
        field==='recent_context' && Array.isArray(value?.recent_context)?value.recent_context.join('\n'):raw;
      delete option.editor;return '';
    }catch(error){option.editor=raw;return error.message;}
  }
  function focusVariant(option) {
    const view=testView==='stacked'?stackEditors.get(option.id):null,input=view?.input || $('#autoStateEditor');
    input.focus();
    const key=JSON.stringify(option.focusField),offset=input.value.indexOf(key);
    if(offset>=0) {
      const colon=input.value.indexOf(':',offset+key.length);let start=colon+1;
      while(/\s/.test(input.value[start] || '') && start<input.value.length)start++;
      if(input.value[start]==='"')start++;
      input.setSelectionRange(start,start);
      const row=(view?.node || $('#autoStateCodeView')).querySelector('.variation-focus');
      if(row)input.scrollTop=Math.max(0,row.offsetTop-24);
    }
  }
  for(const button of document.querySelectorAll('[data-add-field]'))button.addEventListener('click',()=>{
    if(busy || loadingExample || selectedCampaignId || optionsForField().length+(includeBase?1:0)>=50)return;
    const field=button.dataset.addField,source=activeOption(),raw=entryText({option:source});
    const labels=E.clone(source?.expected || expected);
    if($('#autoField').value!=='mixed') {
      const prior=$('#autoField').value;
      optionGroups.mixed=prior==='fixed'?[]:optionsForField().map(option=>({...E.clone(option),field:option.field || prior}));
      $('#autoField').value='mixed';
    }
    const option={id:uuid(),field,focusField:field,text:'',expected:labels};
    updateOptionState(option,raw);optionGroups.mixed.push(option);selectDraftOption(option.id);focusVariant(option);
  });
  function editStateVariant(raw,option) {
    if(busy || selectedBatch || selectedCampaignId)return;
    selectedOptionId=option?.id || null;editorError='';
    if(!option){$('#manualState').value=raw;stateFormat=sourceFormat(raw);$('#stateFormat').value=stateFormat;}
    else editorError=updateOptionState(option,raw);
    dirty();
  }
  $('#autoStateEditor').addEventListener('input',()=>editStateVariant($('#autoStateEditor').value,activeOption()));
  function selectedSavedInput() {
    return page==='automated' ? selectedBatch || (selectedCampaignId && data.batches.find(item=>item.automation?.campaignId===selectedCampaignId)) : null;
  }
  function forkSavedInput(saved,target) {
    if(!saved || busy || loadingExample || page!=='automated')return;
    selectedCampaignId=null;campaignSelection=null;campaignOutcome=null;displayedEditorKey=null;currentPlan=null;editorError='';
    fillInput({...E.clone(saved.input),name:'',expected:E.clone(E.expectedFor(saved))});
    $('#testRepeats').value=String(saved.requested);
    setAutomationOptions({field:'fixed',options:[],includeBase:true,selectedOptionId:null});
    $('#autoStateView').value='variants';inputTab=target;closeVariantMenu();renderInputTabs();dirty();saveDrafts();message('');
    const editor=target==='questions'?$('#questionEditor'):testView==='stacked'?stackEditors.get('base')?.input:$('#autoStateEditor');
    editor?.focus({preventScroll:true});
  }
  $('#autoStateEditor').addEventListener('focus',()=>forkSavedInput(selectedSavedInput(),'state'));
  $('#savedQuestions').tabIndex=0;
  $('#savedQuestions').title='Clique para editar uma cópia. O teste salvo não será alterado.';
  $('#savedQuestions').addEventListener('click',()=>forkSavedInput(selectedSavedInput(),'questions'));
  $('#savedQuestions').addEventListener('keydown',event=>{
    if(event.key==='Enter' || event.key===' '){event.preventDefault();forkSavedInput(selectedSavedInput(),'questions');}
  });
  $('#backToDraft').addEventListener('click',()=>{displayedEditorKey=null;closeVariantMenu();dirty();});
  $('#renameCurrentTest').addEventListener('click',()=>{if(busy)return;originalName=$('#testName').value;nameEditing=true;$('#testName').readOnly=false;$('#testName').focus();$('#testName').select();});
  function finishName(cancelled=false) {
    if(!nameEditing)return;nameEditing=false;$('#testName').readOnly=true;
    if(cancelled){$('#testName').value=originalName;controls();return;}
    const name=$('#testName').value.trim();if(!name || name.length>100){$('#testName').value=originalName;message('Use um nome de 1 a 100 caracteres.',true);controls();return;}
    if(selectedBatch){try{const id=selectedBatch.id;commitChange(next=>E.renameBatch(next,id,name));}catch(error){message(error.message,true);}}
    else if(activeOption()){activeOption().name=name;dirty();}
    else {$('#testName').value=name;if(page==='automated')baseName=name;dirty();}
  }
  $('#testName').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();finishName(event.key==='Escape');}});
  $('#testName').addEventListener('blur',()=>finishName());
  $('#testVariantMenu').addEventListener('keydown',event=>{if(event.key==='Escape'){closeVariantMenu();$('#addTestVariation').focus();}});
  document.addEventListener('pointerdown',event=>{if(!$('#automationNavigator').contains(event.target))closeVariantMenu();});
  $('#testRepeats').addEventListener('change',()=>{if(!busy)dirty();});
  async function runAutomation() {
    if(busy || loadingExample) return;
    let activeBatch=null;
    try {
      ensureApplied(); const plan=planned();
      if(storageBlocked) throw Error('Libere o armazenamento antes de executar uma rodada.');
      if(data.batches.length+plan.count>2000) throw Error('A rodada ultrapassaria o limite de 2.000 testes salvos.');
      if(!window.confirm('Executar a rodada '+plan.round+'?\n'+plan.count+' cenários × '+plan.repeats+' repetições = '+plan.calls+' chamadas'+(C.getProvider()==='official'?' à API Jev oficial (consome créditos).':'.')+'\nSerá enviado o State completo de cada teste com as Questions aplicadas.')) return;
      localStorage.setItem(identityKey,JSON.stringify(plan.registry));
      localStorage.setItem('norte.automation.round',String(plan.round));
      campaign={id:uuid(),round:plan.round,calls:plan.calls,completed:0};
      selectedCampaignId=campaign.id;campaignSelection=null;
      const provider=C.getProvider();busy=true;cancel=false;comparing=false;checkedTests.clear(); message('');controls();
      for(const item of plan.items) {
        if(cancel) break;
        const batch={id:uuid(),createdAt:now(),provider,origin:'automation',input:E.clone(item.input),requested:plan.repeats,status:'running',runs:[],automation:{campaignId:campaign.id,round:plan.round,field:plan.field,optionId:item.optionId,variant:item.variant,questionVariant:item.questionVariant,label:item.label,questionLabel:item.questionLabel,totalScenarios:plan.count,totalCalls:plan.calls}};
        activeBatch=batch;data.batches.push(batch);selectedBatch=batch;selectedRun=-1;
        if(!persist()) throw Error('Não foi possível salvar a rodada. Nenhuma próxima chamada será enviada.');
        controls();refreshPreview();renderLibrary();
        for(let index=1;index<=batch.requested && !cancel;index++) {
          const startedAt=now();
          try {const output=await C.requestTest(E.request(batch.input),provider);E.validateOutput(output,batch.input);batch.runs.push({index,startedAt,finishedAt:now(),status:'done',output:E.clone(output)});}
          catch(error){batch.runs.push({index,startedAt,finishedAt:now(),status:'error',error:String(error.message).slice(0,3000)});if(error.stopBatch)cancel=true;}
          campaign.completed++;
          if(!persist()){cancel=true;message('Armazenamento cheio. Rodada interrompida; exporte o CSV antes de liberar espaço.',true);}
          controls();refreshPreview();renderLibrary();
        }
        batch.status=batch.runs.length===batch.requested?'done':'cancelled';batch.finishedAt=now();
        if(!persist()) cancel=true;
        activeBatch=null;
      }
    } catch(error){message(error.message,true);}
    finally {
      if(activeBatch?.status==='running'){activeBatch.status='cancelled';activeBatch.finishedAt=now();persist();}
      if(campaign){campaignOutcome={id:campaign.id,text:(cancel || activeBatch?'Interrompida':'Concluída')+' · rodada '+campaign.round+' · '+campaign.completed+'/'+campaign.calls+' chamadas'};$('#automationCount').title=campaignOutcome.text;}
      if(campaign && !campaignSelection){selectedBatch=null;selectedRun=-1;}
      busy=false;cancel=false;campaign=null;controls();refreshPreview();renderLibrary();
    }
  }
  function refreshPreview() {
    if (!manualMode) return;
    let state;
    try { state = readState(); } catch (_) { state = ''; }
    const run = selectedBatch?.runs[selectedRun];
    const status = busy ? selectedBatch ? 'Executando ' + Math.min(selectedBatch.runs.length + 1, selectedBatch.requested) + '/' + selectedBatch.requested + (cancel ? ' · interrompendo após esta chamada' : '') : 'Lote excluído em outra aba · interrompendo' : run?.status === 'error' ? run.error : '';
    const automated=page==='automated' && selectedBatch;
    const option=activeOption(),plannedOption=option && currentPlan?.items.find(item=>item.optionId===option.id);
    C.setManualPreview({ state:automated?selectedBatch.input.state:plannedOption?plannedOption.input.state:state, config:automated?selectedBatch.input.config:null, output: run?.status === 'done' ? run.output : null, aggregate: selectedBatch && selectedRun === -1 ? E.aggregate(selectedBatch) : null, status:campaign?'Rodada '+campaign.round+' · '+campaign.completed+'/'+campaign.calls+' chamadas'+(cancel?' · interrompendo':''):automated && campaignOutcome?.id===selectedBatch.automation?.campaignId ? [campaignOutcome.text,status].filter(Boolean).join(' · ') : status });
    renderSummary();
    renderComparison();
    renderCampaign();
    syncRequestEditor();
  }
  function runAppearance(batch,run,number) {
    if(run?.status==='error')return {status:'error',symbol:'!',label:'Erro na API'};
    if(run?.status==='done'){
      const expectations=E.expectedFor(batch),verdict=E.evaluateRun(run.output.response.answers,expectations);
      if(!verdict.total)return {status:'unscored',symbol:'○',label:'Sem critérios esperados'};
      if(verdict.passes)return {status:'passed',symbol:'✓',label:'Passou'};
      const failures=Object.entries(expectations).map(([id,value])=>E.evaluateAnswer(run.output.response.answers[id],value)).filter(value=>!value.passes);
      const low=failures.some(value=>value.reason==='low-probability'),wrong=failures.some(value=>value.reason!=='low-probability');
      return {status:'failed',symbol:'×',label:'Falhou · '+(wrong && low?'resposta diferente e confiança insuficiente':low?'confiança insuficiente':'resposta diferente')};
    }
    if(batch?.status==='running' && number===batch.runs.length+1)return {status:'running',symbol:'◌',label:'Em execução'};
    if(batch && batch.status!=='running')return {status:'not-run',symbol:'–',label:'Não realizada'};
    return {status:'pending',symbol:'○',label:'Aguardando execução'};
  }
  function resultHeading(node,title='Testes',caption='') {
    const heading=el('div','test-results-heading');heading.append(el('h2','',title));
    if(caption)heading.append(el('span','result-provider',caption));
    node.append(heading);
  }
  function runSelectors(batch,runIndex,onSelect,scenario=false) {
    const buttons=el('div','test-run-selectors');buttons.setAttribute('role','group');buttons.setAttribute('aria-label','Execuções do teste');
    const summary=el('button','text-button'+(runIndex<0?' selected':''),'Resumo');summary.type='button';summary.setAttribute('aria-pressed',String(runIndex<0));
    if(scenario)summary.dataset.scenarioRun='-1';else summary.dataset.action='view-summary';
    summary.title='Resumo das execuções deste teste';summary.addEventListener('click',()=>onSelect(-1));buttons.append(summary);
    const count=batch?.requested || Number($('#testRepeats').value);
    for(let number=1;number<=count;number++){
      const index=batch?.runs.findIndex(run=>run.index===number) ?? -1,run=batch?.runs[index];
      if(run?.status==='deleted')continue;
      const appearance=runAppearance(batch,run,number),button=el('button','text-button execution-tab'+(run && index===runIndex?' selected':''));
      button.type='button';button.dataset.status=appearance.status;button.setAttribute('aria-pressed',String(!!run && index===runIndex));
      if(scenario)button.dataset.scenarioRun=String(index<0?number-1:index);else button.dataset.run=String(number);
      const icon=el('span','execution-symbol',appearance.symbol);icon.setAttribute('aria-hidden','true');
      button.append(icon,document.createTextNode('Execução '+number));
      button.title='Execução '+number+' · '+appearance.label+(run?.status==='done'?' · '+E.seconds(run.output.latencyMs):'');
      button.setAttribute('aria-label',button.title);button.disabled=!run || !['done','error'].includes(run.status);
      button.addEventListener('click',()=>onSelect(index));buttons.append(button);
    }
    return buttons;
  }
  function renderSummary() {
    const node=$('#testSummary');node.replaceChildren();node.hidden=!manualMode;
    if(!manualMode)return;
    resultHeading(node,'Testes',selectedBatch?E.batchLabel(selectedBatch):'');
    node.append(runSelectors(selectedBatch,selectedRun,index=>{selectedRun=index;refreshPreview();}));
    if(!selectedBatch)return;
    const stats=E.summarize(selectedBatch),line=el('div','test-summary-line'),run=selectedBatch.runs[selectedRun];
    if(selectedRun<0){
      if(stats.evaluatedRuns)line.append(el('span','test-pass-summary '+(stats.passedRuns===stats.evaluatedRuns?'match':'mismatch'),stats.passedRuns+'/'+stats.evaluatedRuns+' execuções aprovadas'));
      if(stats.comparisons)line.append(el('span',stats.passes===stats.comparisons?'match':'mismatch',stats.passes+'/'+stats.comparisons+' critérios passaram'));
      if(stats.latencyMs!==null){const timing=el('span','batch-timing','Média '+E.seconds(stats.latencyMs));timing.title='Mínimo '+E.seconds(stats.latencyMinMs)+' · máximo '+E.seconds(stats.latencyMaxMs)+' · total '+E.seconds(stats.latencyTotalMs);line.append(timing);}
      if(stats.failed)line.append(el('span','error',stats.failed+' erro(s) de API'));
      if(!stats.count && !stats.failed)line.append(el('span','','Aguardando resultados'));
    }else if(run){
      if(run.status==='done'){
        const verdict=E.evaluateRun(run.output.response.answers,E.expectedFor(selectedBatch));
        if(verdict.total)line.append(el('span','run-verdict '+(verdict.passes?'match':'mismatch'),runAppearance(selectedBatch,run,run.index).label+' · '+verdict.passed+'/'+verdict.total));
        line.append(el('span','run-timing',E.seconds(run.output.latencyMs)));
      }else line.append(el('span','run-timing error','Erro na API'));
      const remove=el('button','text-button delete-test','Excluir execução '+run.index);remove.type='button';remove.disabled=busy || selectedBatch.status==='running';remove.dataset.action='delete-run';
      remove.addEventListener('click',()=>{const id=selectedBatch.id,index=run.index;if(!confirm('Excluir a execução '+index+'? Ela sairá das médias e do CSV.\nEsta exclusão não pode ser desfeita.'))return;try{commitChange(next=>E.removeRun(next.batches.find(batch=>batch.id===id),index));message('');}catch(error){message('Não foi possível excluir: '+error.message,true);}});
      line.append(remove);
    }
    if(['cancelled','interrupted'].includes(selectedBatch.status))line.append(el('span','','Interrompido'));
    node.append(line);
  }
  function currentExpected() { return selectedBatch?E.expectedFor(selectedBatch):activeOption()?.expected || expected; }
  function changeExpected(id,entry,batchId=null) {
    if(busy)return;
    const update=values=>{const next={...values};delete next[id];if(entry)Object.defineProperty(next,id,{value:entry,enumerable:true,writable:true,configurable:true});return next;};
    try {
      const target=batchId?data.batches.find(batch=>batch.id===batchId):selectedBatch;
      if(target) {
        const targetId=target.id;
        commitChange(next=>{const item=next.batches.find(batch=>batch.id===targetId);E.updateExpected(next,targetId,update(E.expectedFor(item)));});
        const saved=data.batches.find(batch=>batch.id===targetId);
        if(page==='manual')expected=E.clone(E.expectedFor(saved));
        else {
          const plannedItem=currentPlan?.items.find(item=>item.optionId===saved.automation?.optionId && A.canonical(E.request(item.input))===A.canonical(E.request(saved.input)));
          const option=plannedItem && optionsForField().find(option=>option.id===plannedItem.optionId);
          if(option){option.expected=E.clone(E.expectedFor(saved));controls();}
        }
      } else if(activeOption()) {activeOption().expected=update(activeOption().expected);dirty();}
      else {expected=update(expected);dirty();}
      message('');
    }catch(error){message('Não foi possível salvar o esperado: '+error.message,true);refreshPreview();}
  }
  function decorateRow(row, id, q, answer, context={batch:selectedBatch,runIndex:selectedRun}) {
    const batch=context.batch,values=batch?E.expectedFor(batch):currentExpected();
    const readonly = context.editable===false || busy || loadingExample || (page==='automated' && !batch && !includeBase && $('#autoStateView').value==='variants' && $('#autoField').value!=='fixed' && !activeOption());
    row.classList.add('manual-answer');
    row.classList.add('test-answer');
    if(batch)row.dataset.resultBatch=batch.id;
    if (!answer) row.classList.add('without-answer');
    const settings = el('div', 'expected-settings');
    const label = el('label', 'expected-control');
    const select = el('select', 'expected-select'); select.setAttribute('aria-label', 'Resultado esperado para ' + id); select.dataset.expected = id;
    select.append(new Option('Esperado: —', ''));
    const choices = q.type === 'noul' ? [['false', 'false'], ['true', 'true']] : Object.entries(q.criteria).map(([key, description]) => [key, q.type === 'score' ? 'Nível ' + key : key, description]);
    for (const [value, text, description] of choices) { const option = new Option(text, value); option.title = description || q.criteria?.[value] || text; select.append(option); }
    select.value = values[id] ? String(values[id].value) : ''; select.disabled = readonly;
    label.style.setProperty('--expected-color', '#b6cde2');
    label.classList.toggle('has-expected', !!values[id]);
    select.title = 'Esperado · ' + q.type + (values[id] ? ': ' + (q.criteria?.[select.value] || select.value) : '') + '. ' + (q.type === 'score' ? 'Compara o nível mais provável, não a média arredondada. Empates divergem.' : q.type === 'noul' ? 'Compara true/false com limiar de 50%; não é um percentual esperado.' : 'Classe que você espera, sem enviar a resposta ao modelo.');
    select.addEventListener('click', event => event.stopPropagation());
    select.addEventListener('change', () => {
      changeExpected(id,select.value===''?null:{...values[id],type:q.type,value:q.type==='score'?Number(select.value):q.type==='noul'?select.value==='true':select.value},batch?.id);
      focusExpected(id,batch?.id,'expected');
    });
    label.append(select);
    const thresholdLabel = el('label', 'expected-threshold'); thresholdLabel.title = thresholdHint;
    const threshold = el('input', 'expected-probability-input'); threshold.type = 'number'; threshold.min = '0'; threshold.max = '100'; threshold.step = 'any'; threshold.inputMode = 'decimal';
    threshold.dataset.minProbability = id; threshold.setAttribute('aria-label', 'Probabilidade mínima para ' + id + ' (%)');
    threshold.placeholder = '—'; threshold.value = values[id]?.minProbability == null ? '' : Number((values[id].minProbability * 100).toFixed(10));
    threshold.disabled = readonly || !values[id];
    threshold.addEventListener('click', event => event.stopPropagation());
    threshold.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); threshold.dispatchEvent(new Event('change')); } });
    threshold.addEventListener('change', () => {
      if (!values[id] || busy) return;
      if (!threshold.checkValidity()) {
        threshold.reportValidity(); message('Use uma probabilidade mínima entre 0% e 100%.', true);
        threshold.value = values[id].minProbability == null ? '' : values[id].minProbability * 100; return;
      }
      const updated = { ...values[id] }; delete updated.minProbability;
      if (threshold.value !== '') updated.minProbability = Number(threshold.value) / 100;
      changeExpected(id,updated,batch?.id);
      focusExpected(id,batch?.id,'minProbability');
    });
    thresholdLabel.append(el('span', '', 'Conf. mín. ≥'), threshold, el('span', '', '%'));
    thresholdLabel.addEventListener('click', event => event.stopPropagation());
    settings.append(el('span','comparison-label','Esperado'),label, thresholdLabel);
    const primitive = row.querySelector('.primitive-type'); primitive.remove();
    row.querySelector('.answer-breakdown').prepend(primitive);
    const pair=el('div','test-result-pair'),obtained=el('div','obtained-settings');
    const comparison=batch?E.questionComparison(batch,id,context.runIndex):null;
    const actual=comparison?.actual;
    obtained.append(el('span','comparison-label',context.runIndex<0 && comparison?.count>1?'Obtido · resumo':'Obtido'));
    const result=el('strong','obtained-value',!comparison?.count?'—':actual===null?'Sem consenso':q.type==='score'?'Nível '+actual:String(actual));result.dataset.resultValue=id;
    result.classList.toggle('answer-pending',!comparison?.count);
    const confidence=el('span','obtained-confidence',comparison?.probability==null?'Confiança —':(comparison.count>1?'Conf. média ':'Confiança ')+percent(comparison.probability));confidence.dataset.resultProbability=id;confidence.title='Probabilidade da resposta exibida; não é o campo confidence da API. No resumo, média dessa probabilidade entre as execuções.';
    obtained.append(result,confidence);
    if(comparison?.varied)obtained.append(el('small','result-varied','Respostas variaram'));
    let reason=comparison?.reason || 'pending';
    if(reason==='pending' && batch && batch.status!=='running')reason=batch.runs[context.runIndex]?.status==='error' || (context.runIndex<0 && batch.runs.some(run=>run.status==='error'))?'api-error':'no-result';
    const text=({pending:'Aguardando execução','no-result':'Sem resultado','api-error':'Não avaliado · falha na API',unscored:'Sem esperado',pass:'Passou','wrong-value':'Falhou · resposta diferente','low-probability':'Falhou · resposta correta, confiança insuficiente','mixed-failure':'Falhou · respostas diferentes e confiança insuficiente'})[reason];
    const status=el('span','expected-verdict '+(reason==='pass'?'match':['pending','unscored','api-error','no-result'].includes(reason)?'neutral':'mismatch'),text+(comparison?.count>1 && values[id]?' · '+comparison.passed+'/'+comparison.count:''));
    status.dataset.verdict=reason;
    if(comparison)status.title=comparison.wrongValue+' resposta(s) diferente(s); '+comparison.lowProbability+' resposta(s) correta(s) abaixo do limite. A aprovação é por execução, não pela média.';
    pair.append(settings,obtained,status);row.querySelector('.answer-value').replaceWith(pair);
  }
  function focusExpected(id,batchId,field) {
    const host=selectedCampaignId && !comparing?$('#campaignOutput'):$('#classificationResults');
    [...host.querySelectorAll('input,select')].find(control=>control.dataset[field]===id && (!batchId || control.closest('[data-result-batch]')?.dataset.resultBatch===batchId))?.focus({preventScroll:true});
  }
  function renderComparison() {
    const node = $('#testComparison'), items = checkedBatches();
    if (!items.length) comparing = false;
    const visible = manualMode && comparing;
    const host = $('#workspace-classifier');
    const changed = host.classList.contains('comparing-tests') !== visible;
    host.classList.toggle('comparing-tests', visible);
    node.hidden = !visible; $('#singleTestOutput').hidden = visible || !!(manualMode && selectedCampaignId);
    if (changed) NorteLayout.refresh();
    if (!visible) { node.replaceChildren(); return; }
    const open = new Set([...node.querySelectorAll('details[open]')].map(detail => JSON.stringify([detail.closest('[data-comparison-id]').dataset.comparisonId, detail.dataset.question ?? null])));
    node.replaceChildren();
    const heading = el('div', 'comparison-heading');
    const close = el('button', 'text-button', '← Voltar'); close.type = 'button'; close.id = 'closeTestComparison';
    close.addEventListener('click', () => { comparing = false; refreshPreview(); $('#compareTests').focus(); });
    heading.append(close, el('span', '', items.length + ' testes · médias por teste'));
    node.append(heading);
    const columns = el('div', 'comparison-columns');
    for (const item of items) {
      const column = el('article', 'comparison-column'); column.dataset.comparisonId = item.id;
      column.setAttribute('aria-label', E.testName(item) + ' · ' + item.input.language.toUpperCase());
      const info = el('header', 'comparison-info');
      const title = el('div', 'comparison-title');
      const view = el('button', 'text-button', 'Ver'); view.type = 'button'; view.dataset.action = 'inspect-comparison';
      view.setAttribute('aria-label', 'Ver execuções de ' + E.testName(item));
      view.addEventListener('click', () => viewBatch(item));
      title.append(el('h3', '', E.testName(item)), el('span', 'test-language', item.input.language.toUpperCase()), view);
      info.append(title, el('small', '', new Date(item.createdAt).toLocaleString('pt-BR') + ' · ' + E.batchLabel(item)));
      const state = el('details', 'comparison-state'); state.open = open.has(JSON.stringify([item.id, null]));
      state.append(el('summary', '', E.stateText(item.input.state)), el('p', '', E.stateText(item.input.state))); info.append(state);
      const stats = E.summarize(item), aggregate = E.aggregate(item);
      const metrics = el('div', 'comparison-metrics');
      metrics.append(el('span', '', stats.count + '/' + item.requested + ' execuções válidas'), el('span', 'comparison-time', 'Média ' + E.seconds(stats.latencyMs)));
      if (stats.latencyMs !== null) metrics.append(el('span', '', E.seconds(stats.latencyMinMs) + '–' + E.seconds(stats.latencyMaxMs)));
      if (stats.consistency !== null) metrics.append(el('span', '', percent(stats.consistency) + ' consistência'));
      if (stats.comparisons) metrics.append(el('span', stats.passes === stats.comparisons ? 'match' : 'mismatch', stats.passes + '/' + stats.comparisons + ' perguntas passaram'), el('span', 'test-pass-summary', stats.passedRuns + '/' + stats.evaluatedRuns + ' execuções aprovadas'));
      if (stats.failed) metrics.append(el('span', 'error', stats.failed + ' falha(s)'));
      if (!aggregate) metrics.append(el('span', '', 'Sem resultados válidos'));
      info.append(metrics); column.append(info);
      for (const [id, q] of Object.entries(item.input.config.questions)) {
        const row = C.renderRow(id, q, aggregate?.answers[id]);
        row.open = open.has(JSON.stringify([item.id, id]));
        decorateRow(row,id,q,aggregate?.answers[id],{batch:item,runIndex:-1,editable:false});column.append(row);
      }
      columns.append(column);
    }
    node.append(columns);
  }
  function stateDescription(state) { return typeof state==='object' && !Array.isArray(state) && typeof state.current_utterance==='string'?state.current_utterance:E.stateText(state); }
  function campaignStats(items) {
    const totals={count:0,requested:0,passes:0,comparisons:0,matches:0,errors:0,totalMs:0};
    for(const item of items){const stats=E.summarize(item);totals.count+=stats.count;totals.requested+=item.requested;totals.passes+=stats.passes;totals.comparisons+=stats.comparisons;totals.matches+=stats.matches;totals.errors+=stats.failed;totals.totalMs+=stats.latencyTotalMs || 0;}
    return totals;
  }
  function viewCampaign(id) {
    if(busy)return;selectedCampaignId=id;campaignSelection=null;selectedBatch=null;selectedRun=-1;comparing=false;
    controls();refreshPreview();
  }
  function selectCampaignTest(id) {
    if(busy)return;
    const batch=data.batches.find(item=>item.id===id);if(!batch)return;
    stackCollapsed.delete(id);
    selectedCampaignId=batch.automation?.campaignId || null;campaignSelection=id;selectedBatch=batch;selectedRun=scenarioRuns.get(id) ?? -1;
    if(selectedRun>=0 && batch.runs[selectedRun]?.status==='deleted')selectedRun=-1;
    comparing=false;inputTab='state';displayedEditorKey=null;renderInputTabs();controls();refreshPreview();
    if(testView==='stacked')stackEditors.get(id)?.node.scrollIntoView({block:'nearest'});
  }
  function openCampaignQuestion(batch,id) {
    if(busy)return;
    scenarioRuns.set(batch.id,-1);selectCampaignTest(batch.id);
    const row=[...$('#campaignOutput').querySelectorAll('.answer-row')].find(node=>node.dataset.question===id && node.dataset.resultBatch===batch.id);
    if(!row)return;row.open=true;row.classList.add('question-target');
    const summary=row.querySelector('summary');summary?.focus({preventScroll:true});row.scrollIntoView({block:'start'});
  }
  function compactValue(value,q) { return value===null || value===undefined?'Variou':q.type==='score'?'Nível '+value:String(value); }
  function renderCampaignOverview(host,items) {
    const tools=el('div','overview-tools'),hint=el('small','','Resposta e confiança avaliadas separadamente, por execução.');
    const expand=el('button','text-button','Expandir todos'),collapse=el('button','text-button','Recolher todos');expand.type=collapse.type='button';
    expand.dataset.overviewExpandAll='';collapse.dataset.overviewCollapseAll='';
    expand.addEventListener('click',()=>{items.forEach(item=>overviewCollapsed.delete(item.id));renderCampaign();});
    collapse.addEventListener('click',()=>{items.forEach(item=>overviewCollapsed.add(item.id));renderCampaign();});
    tools.append(hint,expand,collapse);host.append(tools);
    for(const [index,item]of items.entries()) {
      const section=el('section','overview-test'),header=el('div','overview-test-header'),toggle=el('button','text-button overview-expand'),link=el('button','text-button overview-test-link','Teste '+(index+1)+' · '+E.testName(item));
      section.dataset.overviewGroup=item.id;toggle.type=link.type='button';link.dataset.overviewTest=item.id;
      header.append(toggle,link);
      const stats=E.summarize(item),checks=Object.entries(item.input.config.questions).map(([id,q])=>({id,q,...E.questionChecks(item,id)}));
      header.append(el('span','overview-time',E.seconds(stats.latencyMs)));
      const verdicts=el('div','overview-verdicts');
      function resultLink(text,className,kind) {
        const button=el('button','overview-result-link '+className,text);button.type='button';button.disabled=busy;
        button.dataset.overviewResult=item.id;button.dataset.resultKind=kind;button.title='Abrir resultados de '+E.testName(item);
        button.setAttribute('aria-label',text+' · abrir resultados de '+E.testName(item));
        button.addEventListener('click',()=>selectCampaignTest(item.id));verdicts.append(button);
      }
      resultLink(stats.comparisons?stats.passes+'/'+stats.comparisons+' passaram':'Sem avaliação',stats.comparisons?(stats.passes===stats.comparisons?'match':'mismatch'):'overview-neutral','approval');
      const wrong=checks.reduce((n,c)=>n+c.evaluated-c.matches,0),low=checks.reduce((n,c)=>n+(c.confident===null?0:c.evaluated-c.confident),0);
      if(wrong)resultLink('Resposta: '+wrong+' divergência(s)','mismatch','answer');
      if(low)resultLink('Confiança: '+low+' abaixo do mínimo','mismatch','confidence');
      const unscored=checks.filter(c=>c.expected===undefined).length;
      if(unscored)resultLink(unscored+' sem esperado','overview-neutral','unscored');
      if(stats.failed)resultLink(stats.failed+' erro(s) de API · não avaliados','mismatch','error');
      header.append(verdicts);section.append(header);
      const table=el('table','overview-questions'),head=el('thead',''),tr=el('tr',''),body=el('tbody','');table.id='overview-'+item.id;
      for(const text of ['Pergunta','Obtido','Resposta','Confiança']){const th=el('th','',text);th.scope='col';tr.append(th);}head.append(tr);table.append(head,body);
      for(const check of checks) {
        const row=el('tr','');row.dataset.overviewQuestion=check.id;row.dataset.overviewBatch=item.id;
        const question=el('td',''),button=el('button','text-button overview-question-link',check.id);button.type='button';button.disabled=busy;
        button.title='Abrir '+check.id+' em '+E.testName(item);button.addEventListener('click',()=>openCampaignQuestion(item,check.id));question.append(button);
        const obtained=el('td','',check.count?compactValue(check.actual,check.q):'—');obtained.dataset.check='obtained';
        if(check.expected!==undefined)obtained.append(el('small','','Esp. '+compactValue(check.expected,check.q)));
        const result=el('td',''),confidence=el('td','');result.dataset.check='answer';confidence.dataset.check='confidence';
        function status(cell,passed,total,singularPass,singularFail) {
          cell.className=passed===total?'match':'mismatch';cell.dataset.verdict=passed===total?'passed':'failed';
          cell.textContent=(passed===total?'✓ ':'× ')+(total===1?(passed?singularPass:singularFail):passed+'/'+total);
          cell.title=passed+' de '+total+' execuções atenderam este critério';
        }
        if(!check.evaluated){
          result.className=confidence.className='overview-neutral';result.dataset.verdict=confidence.dataset.verdict='unscored';
          result.textContent=check.expected===undefined?'Sem esperado':'Sem resultado';confidence.textContent='—';
        }else{
          status(result,check.matches,check.evaluated,'Certa','Difere');
          if(check.minimum===null){confidence.className='overview-neutral';confidence.dataset.verdict='unscored';confidence.textContent='Sem mínimo';}
          else{status(confidence,check.confident,check.evaluated,'Atingiu','Baixa');confidence.append(el('small','','≥ '+Math.round(check.minimum*100)+'%'));confidence.title+=' · probabilidade da resposta esperada ≥ '+percent(check.minimum);}
        }
        for(const cell of [obtained,result,confidence]) {
          const value=el('button','overview-value-link');value.type='button';value.disabled=busy;
          value.title=(cell.title?cell.title+' · ':'')+'Abrir '+check.id+' em '+E.testName(item);
          const label=cell===obtained?'Obtido':cell===result?'Resposta':'Confiança';
          value.setAttribute('aria-label',label+': '+cell.textContent+' · abrir '+check.id+' em '+E.testName(item));
          value.append(...cell.childNodes);cell.append(value);
          value.addEventListener('click',()=>openCampaignQuestion(item,check.id));
        }
        row.append(question,obtained,result,confidence);body.append(row);
      }
      function disclosure() {
        const open=!overviewCollapsed.has(item.id);table.hidden=!open;toggle.textContent=open?'⌄':'›';toggle.setAttribute('aria-expanded',String(open));
        toggle.setAttribute('aria-label',(open?'Recolher':'Expandir')+' perguntas de '+E.testName(item));toggle.setAttribute('aria-controls',table.id);
        link.setAttribute('aria-expanded',String(open));link.setAttribute('aria-controls',table.id);link.title=(open?'Recolher':'Expandir')+' perguntas';
      }
      function toggleQuestions() { if(overviewCollapsed.has(item.id))overviewCollapsed.delete(item.id);else overviewCollapsed.add(item.id);disclosure(); }
      toggle.dataset.overviewToggle=item.id;toggle.addEventListener('click',toggleQuestions);link.addEventListener('click',toggleQuestions);disclosure();
      section.append(table);host.append(section);
    }
  }
  function renderCampaign() {
    const host=$('#campaignOutput'),items=data.batches.filter(item=>item.automation?.campaignId===selectedCampaignId);
    const visible=manualMode && !comparing && !!selectedCampaignId && items.length>0;
    host.hidden=!visible;
    if(!visible){if(!comparing)$('#singleTestOutput').hidden=false;host.replaceChildren();return;}
    $('#singleTestOutput').hidden=true;
    const opened=new Set([...host.querySelectorAll('.answer-row[open]')].map(row=>row.dataset.resultBatch+':'+row.dataset.question));
    host.replaceChildren();
    const batch=items.find(item=>item.id===campaignSelection),tabs=el('div','campaign-test-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Testes da rodada');
    const summary=el('button','text-button'+(!batch?' selected':''),'Resumo');summary.type='button';summary.dataset.campaignSummary='';summary.disabled=busy;summary.setAttribute('role','tab');summary.setAttribute('aria-selected',String(!batch));summary.addEventListener('click',()=>{campaignSelection=null;selectedBatch=null;selectedRun=-1;controls();refreshPreview();});tabs.append(summary);
    items.forEach((item,index)=>{
      const tab=el('button','text-button'+(batch?.id===item.id?' selected':''),'Teste '+(index+1));tab.type='button';tab.dataset.resultTest=item.id;tab.title=E.testName(item);tab.disabled=busy;
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(batch?.id===item.id));tab.setAttribute('aria-label','Teste '+(index+1)+' · '+E.testName(item));
      tab.addEventListener('click',()=>selectCampaignTest(item.id));tabs.append(tab);
    });
    resultHeading(host);host.append(tabs);
    if(!batch) {
      const totals=campaignStats(items),stats=el('div','campaign-overview-stats');
      stats.append(el('span','','R'+String(items[0].automation.round).padStart(3,'0')+' · '+items.length+' testes'),el('span','',totals.count+' execuções'));
      if(totals.comparisons)stats.append(el('span',totals.passes===totals.comparisons?'match':'mismatch',totals.passes+'/'+totals.comparisons+' passaram'));
      if(totals.errors)stats.append(el('span','error',totals.errors+' falhas de API'));
      host.append(stats);
      renderCampaignOverview(host,items);return;
    }
    const panel=el('section','campaign-result');panel.dataset.scenarioId=batch.id;panel.setAttribute('aria-label',E.testName(batch));
    const stats=E.summarize(batch),runIndex=selectedRun,bar=runSelectors(batch,runIndex,index=>{selectedRun=index;scenarioRuns.set(batch.id,index);refreshPreview();},true);
    bar.prepend(el('span','result-test-name',E.testName(batch)));
    const run=batch.runs[runIndex];bar.append(el('span','result-time',E.seconds(runIndex<0?stats.latencyMs:run?.output?.latencyMs)));panel.append(bar);
    if(runIndex>=0){const remove=el('button','text-button delete-test','Excluir execução '+run.index);remove.type='button';remove.dataset.action='delete-scenario-run';remove.disabled=busy || batch.status==='running';remove.addEventListener('click',()=>{if(!confirm('Excluir esta execução? Esta exclusão não pode ser desfeita.'))return;try{commitChange(next=>E.removeRun(next.batches.find(item=>item.id===batch.id),run.index));}catch(error){message(error.message,true);}});bar.append(remove);}
    if(run?.status==='error')panel.append(el('p','output-status error',run.error));
    else if(runIndex<0 && stats.failed)panel.append(el('p','output-status error',stats.failed+' falha(s) de API · não avaliadas como respostas'));
    const answers=runIndex<0?E.aggregate(batch)?.answers:run?.output?.response.answers;
    for(const [id,q]of Object.entries(batch.input.config.questions)){
      const row=C.renderRow(id,q,answers?.[id]);decorateRow(row,id,q,answers?.[id],{batch,runIndex});row.open=opened.has(batch.id+':'+id);panel.append(row);
    }
    host.append(panel);
  }
  function renderCampaignLibrary(node,items) {
    const table=el('table','test-table'),head=el('thead',''),header=el('tr','');
    const cell=el('th','test-select-cell'),all=el('input','test-checkbox');all.type='checkbox';all.id='selectAllTests';all.setAttribute('aria-label','Selecionar todas as rodadas');
    all.addEventListener('change',()=>{checkedTests.clear();if(all.checked)items.forEach(item=>checkedTests.add(item.id));selectionChanged();});cell.append(all);header.append(cell);
    for(const label of ['Rodada','Cenários','Execuções','Aprovação','Tempo médio','']){const th=el('th','',label);th.scope='col';header.append(th);}head.append(header);table.append(head);
    const tbody=el('tbody','');
    for(const group of E.campaignGroups(items).reverse()) {
      const row=el('tr','');row.dataset.campaignId=group.id;
      const selectCell=el('td','test-select-cell'),check=el('input','test-checkbox');check.type='checkbox';check.dataset.selectCampaign=group.id;check.setAttribute('aria-label','Selecionar rodada '+group.round);
      check.addEventListener('change',()=>{for(const item of group.members)if(check.checked)checkedTests.add(item.id);else checkedTests.delete(item.id);selectionChanged();});selectCell.append(check);row.append(selectCell);
      const name=el('td','test-case-name','R'+String(group.round).padStart(3,'0'));name.append(el('small','',new Date(group.createdAt).toLocaleString('pt-BR')));row.append(name);
      const totals=campaignStats(group.members),planned=Math.max(...group.members.map(item=>item.automation.totalScenarios));
      row.append(el('td','',group.members.length+(group.members.length!==planned?'/'+planned:'')),el('td','',totals.count+'/'+totals.requested+(totals.errors?' · '+totals.errors+' falhas':'')),el('td',totals.comparisons && totals.passes!==totals.comparisons?'mismatch':'',totals.comparisons?totals.passes+'/'+totals.comparisons:'—'),el('td','',E.seconds(totals.count?totals.totalMs/totals.count:null)));
      const actions=el('td','test-row-actions'),view=el('button','text-button','Ver rodada'),remove=el('button','text-button delete-test','Excluir');view.type=remove.type='button';view.dataset.action='view-campaign';remove.dataset.action='delete-campaign';view.disabled=remove.disabled=busy;
      view.addEventListener('click',()=>viewCampaign(group.id));
      remove.addEventListener('click',()=>{if(!confirm('Excluir esta rodada e seus '+group.members.length+' cenários? Esta exclusão não pode ser desfeita.'))return;try{commitChange(next=>{for(const item of group.members)E.removeItem(next,'batches',item.id);});}catch(error){message(error.message,true);}});
      actions.append(view,remove);row.append(actions);tbody.append(row);
    }
    table.append(tbody);node.append(table);selectionControls();
  }
  function viewBatch(item) {
    if (busy) return;
    comparing = false;selectedCampaignId=null;
    if(item.origin==='automation')navigate('automated');
    else loadInput({ ...item.input, name: E.testName(item), expected:E.expectedFor(item) });
    selectedCampaignId=null;
    selectedBatch = item; selectedRun = -1; refreshPreview(); message('');
    if(page==='manual')$('#testRepeats').value=String(item.requested);
  }
  function loadInput(value) {
    if (busy) { message('Interrompa o lote antes de carregar outro teste.', true); return; }
    navigate(true);
    fillInput(value); refreshPreview(); controls();
  }
  function fillInput(value) {
    $('#testName').value = value.name; $('#testLanguage').value = value.language; writeState(value.state);
    expected = E.clone(value.expected); selectedBatch = null; selectedRun = -1;
    C.loadTestConfig(value.config);
  }
  function ensureApplied() { if (!$('#applyQuestions').disabled) throw Error('Aplique as alterações de Questions antes de executar.'); }
  function blankInput() {
    expected={};selectedBatch=null;selectedRun=-1;selectedCampaignId=null;campaignSelection=null;campaignOutcome=null;
    editorError='';displayedEditorKey=null;currentPlan=null;nameEditing=false;stackCollapsed.clear();
    $('#testName').value='';$('#testLanguage').value='en';$('#testRepeats').value='1';writeState('');
    C.loadDraftConfig({model:'jev-latest',questions:{}},'');
    setAutomationOptions({field:'fixed',options:[],selectedOptionId:null,includeBase:true});$('#autoStateView').value='variants';
  }
  $('#newTestCase').addEventListener('click',()=>{
    if(busy || loadingExample)return;blankInput();inputTab='state';closeVariantMenu();renderInputTabs();dirty();message('');
  });
  $('#clearTestDraft').addEventListener('click',()=>{
    if(busy || loadingExample || page!=='automated')return;
    const populated=$('#manualState').value.trim() || $('#questionEditor').value.trim() || optionsForField().length || selectedSavedInput();
    if(populated && !window.confirm('Limpar State, Questions e variações para começar do zero?\nOs testes salvos no histórico não serão excluídos.'))return;
    blankInput();checkedTests.clear();inputTab='state';closeVariantMenu();renderInputTabs();dirty();message('');saveDrafts();
    const editor=testView==='stacked'?stackEditors.get('base')?.input:$('#autoStateEditor');editor?.focus();
  });
  $('#runTest').addEventListener('click', async () => {
    if (busy) return;
    if (page==='automated') { await runAutomation(); return; }
    try {
      ensureApplied(); const value = input(); E.validateInput(value);
      const identities=readIdentities(),identity=A.identify(value,identities);
      if(/^(JEV-\d+-U\d+-C\d+|Protótipo)/.test(value.name) || !$('#testName').value.trim())value.name=identity.name;
      localStorage.setItem(identityKey,JSON.stringify(identities));
      if (data.batches.length >= 2000) throw Error('Limite de 2.000 lotes neste navegador. Exporte o CSV antes de excluir testes antigos.');
      const batch = { id: uuid(), caseId: null, provider: C.getProvider(), createdAt: now(), input: E.clone(value), requested: Number($('#testRepeats').value), status: 'running', runs: [] };
      if (![1, 4, 10].includes(batch.requested)) throw Error('Número de execuções inválido.');
      data.batches.push(batch); selectedBatch = batch; selectedRun = -1; busy = true; cancel = false; comparing = false;
      activateLog(); message(''); persist(); controls(); renderLibrary(); refreshPreview();
      for (let index = 1; index <= batch.requested && !cancel; index++) {
        const startedAt = now();
        try {
          const output = await C.requestTest(E.request(batch.input), batch.provider);
          E.validateOutput(output, batch.input);
          batch.runs.push({ index, startedAt, finishedAt: now(), status: 'done', output: E.clone(output) });
        } catch (error) { batch.runs.push({ index, startedAt, finishedAt: now(), status: 'error', error: String(error.message).slice(0, 3000) }); if (error.stopBatch) cancel = true; }
        persist(); refreshPreview(); renderLibrary();
      }
      batch.status = cancel && batch.runs.length < batch.requested ? 'cancelled' : 'done'; batch.finishedAt = now();
      persist();
    } catch (error) { message(error.message, true); }
    finally { busy = false; cancel = false; controls(); refreshPreview(); renderLibrary(); }
  });
  $('#cancelTest').addEventListener('click', () => { cancel = true; controls(); refreshPreview(); });
  $('#saveLiveResult').addEventListener('click', () => {
    const current = C.getVisibleResult(); if (!current?.output) return;
    if (data.batches.length >= 2000) { activateLog('tests'); message('Limite de 2.000 lotes. Exporte o CSV antes de excluir testes antigos.', true); return; }
    const language = $('#language').value.split('-')[0];
    const value = { name: $('#meetingName').value || 'Da reunião', language: E.languages.includes(language) ? language : 'pt', state: current.request.state, config: { model: current.request.model, questions: current.request.questions }, expected: {} };
    const batch = { id: uuid(), caseId: null, createdAt: now(), input: E.clone(value), requested: 1, status: 'done', origin: 'meeting', runs: [{ index: 1, status: 'done', startedAt: now(), finishedAt: now(), output: E.clone(current.output) }] };
    data.batches.push(batch); persist(); renderLibrary(); message('');
    window.dispatchEvent(new CustomEvent('norte:notice', { detail: 'Resultado salvo em Manual → Testes.' }));
  });
  function nameControl(item, host) {
    const button = el('button', 'test-name-button'); button.type = 'button'; button.disabled = busy || item.status === 'running';
    button.dataset.action = 'rename-batch'; button.title = 'Renomear teste';
    button.setAttribute('aria-label', 'Renomear teste ' + E.testName(item));
    button.append(el('span', '', E.testName(item)));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'm12 4 4 4M4 12l9-9a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2l-9 9-5 1z'); svg.append(path); button.append(svg);
    button.addEventListener('click', () => {
      const form = el('form', 'test-name-form'), editor = el('input', 'test-name-input');
      editor.value = E.testName(item); editor.maxLength = 100; editor.required = true; editor.setAttribute('aria-label', 'Novo nome do teste');
      const save = el('button', 'text-button', '✓'), cancelEdit = el('button', 'text-button', '×');
      save.type = 'submit'; save.setAttribute('aria-label', 'Salvar nome'); cancelEdit.type = 'button'; cancelEdit.setAttribute('aria-label', 'Cancelar edição do nome');
      const restore = () => { form.replaceWith(button); button.focus(); };
      cancelEdit.addEventListener('click', restore);
      editor.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); } });
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          commitChange(next => E.renameBatch(next, item.id, editor.value));
          if (page==='manual' && selectedBatch?.id === item.id) $('#testName').value = E.testName(selectedBatch);
          message('');
          [...$('#testLibrary').querySelectorAll('[data-test-id]')].find(row => row.dataset.testId === item.id)?.querySelector('[data-action=rename-batch]')?.focus();
        } catch (error) { message('Não foi possível renomear: ' + error.message, true); editor.focus(); }
      });
      form.append(editor, save, cancelEdit); button.replaceWith(form); editor.focus(); editor.select();
    });
    host.append(button);
  }
  function renderLibrary() {
    syncSelection(); selectionControls();
    const node = $('#testLibrary'); node.replaceChildren();
    // Legacy cases stay in backups/storage; only executed tests appear in this UI.
    const items = visibleBatches();
    if (!items.length) { node.append(el('p', 'test-empty', 'Nenhuma execução salva.')); return; }
    if(page==='automated'){renderCampaignLibrary(node,items);return;}
    const table = el('table', 'test-table'); table.setAttribute('aria-label', 'Comparação de testes');
    const header = el('tr', '');
    const selection = el('th', 'test-select-cell'); selection.scope = 'col';
    const all = el('input', 'test-checkbox'); all.type = 'checkbox'; all.id = 'selectAllTests';
    all.setAttribute('aria-label', 'Selecionar todos os testes');
    all.addEventListener('change', () => {
      checkedTests.clear(); if (all.checked) items.forEach(item => checkedTests.add(item.id)); selectionChanged();
    });
    selection.append(all); header.append(selection);
    const columns = ['Teste', 'Idioma', 'Execuções', 'Esperado', 'Consistência', 'Tempo médio', ''];
    for (const title of columns) { const th = el('th', '', title); th.scope = 'col'; header.append(th); }
    const head = el('thead', ''); head.append(header); table.append(head);
    const body = el('tbody', '');
    [...items].reverse().forEach(item => {
      const row = el('tr', ''); row.dataset.testId = item.id;
      const cell = el('td', 'test-select-cell'), check = el('input', 'test-checkbox');
      check.type = 'checkbox'; check.dataset.selectTest = item.id;
      check.setAttribute('aria-label', 'Selecionar teste ' + E.testName(item));
      check.addEventListener('change', () => { if (check.checked) checkedTests.add(item.id); else checkedTests.delete(item.id); selectionChanged(); });
      cell.append(check); row.append(cell);
      const name = el('td', 'test-case-name'); nameControl(item, name);
      name.append(el('small', '', new Date(item.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',second:'2-digit' }) + ' · ' + E.batchLabel(item)+(item.automation?' · R'+String(item.automation.round).padStart(3,'0'):''))); name.title = E.stateText(item.input.state);
      row.append(name, el('td', 'test-language', item.input.language.toUpperCase()));
      {
        const stats = E.summarize(item);
        const removed = item.runs.filter(run => run.status === 'deleted').length;
        row.append(el('td', '', stats.count + '/' + item.requested + (stats.failed ? ' · ' + stats.failed + ' falha(s)' : '') + (removed ? ' · ' + removed + ' excluída(s)' : '') + (item.status === 'running' ? ' …' : ['cancelled', 'interrupted'].includes(item.status) ? ' · interrompido' : '')),
          el('td', stats.comparisons && stats.passes < stats.comparisons ? 'mismatch' : '', stats.comparisons ? stats.passes + '/' + stats.comparisons : '—'),
          el('td', '', stats.consistency === null ? '—' : percent(stats.consistency)), el('td', '', E.seconds(stats.latencyMs)));
        row.cells[4].title = 'Perguntas que passaram (resposta + probabilidade mínima) / comparações, excluindo erros da API e campos sem esperado.';
        row.cells[5].title = 'Frequência da combinação de respostas mais comum neste lote; consistência não significa acerto.';
      }
      const action = el('td', ''), button = el('button', 'text-button', 'Ver');
      button.disabled = busy; button.dataset.action = 'view-batch';
      button.addEventListener('click', () => viewBatch(item));
      const remove = el('button', 'text-button delete-test', 'Excluir');
      remove.disabled = busy || item.status === 'running'; remove.dataset.action = 'delete-batch';
      remove.setAttribute('aria-label', 'Excluir teste ' + E.testName(item));
      remove.addEventListener('click', () => deleteBatch(item));
      action.classList.add('test-row-actions'); action.append(button, remove); row.append(action); body.append(row);
    });
    table.append(body); node.append(table); selectionControls();
  }
  function download(contents, filename, type) {
    const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('#exportTestsCsv').addEventListener('click', () => download(E.csv(data), 'norte-comparacao.csv', 'text/csv;charset=utf-8'));
  function importArchive(source) {
    if(busy)return;
    try {
      const imported = E.validateArchive(source);
      const merged = E.clone(data);
      const remap = new Map();
      for (const collection of ['cases', 'batches']) for (const source of imported[collection]) {
        const item = E.clone(source);
        const collision = [...merged.cases, ...merged.batches].find(existing => existing.id === item.id);
        if (collision && JSON.stringify(collision) === JSON.stringify(item)) continue;
        // Import is an explicit restore, using fresh IDs so deletion markers remain valid.
        if (collision || ['cases', 'batches'].some(name => merged.deleted?.[name]?.includes(item.id))) { const previousId = item.id; item.id = uuid(); remap.set(previousId, item.id); }
        if (collection === 'batches') { item.caseId = remap.get(item.caseId) || item.caseId; if (item.status === 'running') item.status = 'interrupted'; }
        merged[collection].push(item);
      }
      if (merged.cases.length > 500 || merged.batches.length > 2000) throw Error('O backup excede o limite de casos ou lotes; nada foi importado.');
      data = E.validateArchive(merged);
      persist(); renderLibrary(); message('');
    } catch (error) { message(error.message, true); }
  }
  window.addEventListener('storage', event => {
    if (event.key !== key || !event.newValue || storageBlocked) return;
    try {
      data = E.mergeArchives(E.validateArchive(JSON.parse(event.newValue)), data);
      // Idempotent union propagates tombstones when two tabs save concurrently.
      if (JSON.stringify(data) !== localStorage.getItem(key)) persist();
      syncSelection(); refreshPreview(); renderLibrary(); controls();
    } catch (_) { storageError(); }
  });
  function saveDrafts() {
    if(['manual','automated'].includes(page)) drafts[page]=captureDraft();
    try { sessionStorage.setItem('norte.lab.drafts.v1',JSON.stringify(drafts)); } catch(_){storageError();}
  }
  try {
    const saved=JSON.parse(sessionStorage.getItem('norte.lab.drafts.v1') || '{}');
    for(const name of ['manual','automated']) {
      const d=saved[name];if(!d)continue;
      if(typeof d.text!=='string' || typeof d.editor!=='string' || typeof d.name!=='string' || d.text.length>256000 || d.editor.length>256000 || !['text','json'].includes(d.format) || !E.languages.includes(d.language) || !['1','4','10'].includes(d.repeats) || !d.automation)continue;
      E.validateDraftConfig(d.config); E.validateExpected(d.expected,d.config.questions);drafts[name]=d;
    }
  } catch(_){}
  window.addEventListener('pagehide',()=>{saveDrafts();persist();});
  window.NorteLab = { decorateRow, snapshot: () => E.clone(data), isRunning: () => busy,
    importArchive,
    // Data-only entrypoint for regression tests / old exported single tests; no JSON toolbar.
    loadJSON(source) { if(busy)throw Error('Interrompa a execução.');const value=parsedInput(E.parseRequest(source));E.validateInput(value);loadInput(value); },
    draft:()=>E.clone(captureDraft())
  };
  renderLibrary(); controls();
})();
