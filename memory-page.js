/* UI for the isolated memory experiment; never writes to the speech ledger. */
(async () => {
  const isV2 = new URLSearchParams(location.search).get('profile') === 'memory-v2';
  if (isV2) {
    try {
      await import('./memory-storage.js?v=20261007-11');
      await import('./memory-v2.js?v=20261007-11');
      if (!window.NorteMemoryV2) throw Error('Configuração V2 indisponível.');
      await import('./typed-relations.js?v=20261007-11');
      await import('./typed-relations-page.js?v=20261007-11');
      await import('./meeting-commands.js?v=20261007-11');
      await import('./meeting-speech.js?v=20261007-11');
      await import('./meeting-session.js?v=20261007-11');
      await import('./meeting-evidence.js?v=20261007-11');
      await import('./meeting-state.js?v=20261007-11');
      await import('./meeting-review.js?v=20261007-11');
      await import('./meeting-hierarchy.js?v=20261007-11');
      await import('./meeting-minutes.js?v=20261007-11');
      await import('./meeting-amendments.js?v=20261007-11');
      await import('./meeting-document.js?v=20261007-11');
      await import('./gemini-minutes.js?v=20261007-11');
      const geminiStyle=document.createElement('link');geminiStyle.rel='stylesheet';geminiStyle.href='./gemini-minutes.css?v=20261007-11';document.head.append(geminiStyle);
      await import('./relation-map.js?v=20261007-11');
      if (!window.NorteTypedRelations || !window.NorteTypedRelationsPage || !window.NorteMinutes || !window.NorteRelationMap) throw Error('Etapa de relações ou ata indisponível.');
      const minutesStyle=document.createElement('link');minutesStyle.rel='stylesheet';minutesStyle.href='./meeting-minutes.css?v=20261007-11';document.head.append(minutesStyle);
      const mapStyle=document.createElement('link');mapStyle.rel='stylesheet';mapStyle.href='./relation-map.css?v=20261007-11';document.head.append(mapStyle);
    } catch (error) {
      const message = document.getElementById('mfNotice');
      message.textContent = 'Não foi possível carregar Memória V2. Recarregue a página. ' + error.message;
      message.hidden = false;
      for (const button of document.querySelectorAll('#memoryPage button')) button.disabled = true;
      return;
    }
  }
  const profile = isV2 ? window.NorteMemoryV2 : null;
  const storageKey = name => `norte.${name}.${isV2 ? 'v2' : 'v1'}`;
  const F = NorteMemoryFlow, C = NorteClassifier, E = NorteExperiments, R = NorteRelations, T = R.threads;
  const TR = isV2 ? window.NorteTypedRelations : null;
  const typedUI = isV2 ? window.NorteTypedRelationsPage : null;
  const $ = id => document.getElementById(id), key = storageKey('memory-flow');
  $('memoryPage').dataset.profile=isV2?'memory-v2':'memory';
  const defaultQuestions = profile?.questions || F.questions;
  const defaultThreadConfig = profile?.threadConfig || T.defaults;
  const defaultTypedConfig = TR?.defaults;
  const defaultExample = profile?.example || F.example;
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ''; if (text !== undefined) n.textContent = text; return n; };
  const percent = value => value == null ? '—' : (100 * value).toFixed(1) + '%';
  function copyButton(label, getText, kind='json') {
    const button=node('button','mf-copy',label);button.type='button';button.dataset.copy=kind;
    button.addEventListener('click',async event=>{
      event.stopPropagation();const text=getText();
      try {
        try { await navigator.clipboard.writeText(text); }
        catch (_) {
          const previous=document.activeElement,field=node('textarea','mf-copy-buffer');field.value=text;
          (button.closest('dialog') || $('memoryPage')).append(field);field.select();
          try { if(!document.execCommand('copy'))throw Error('Clipboard unavailable'); }
          finally { field.remove();previous?.focus({preventScroll:true}); }
        }
        button.textContent='Copiado';setTimeout(()=>button.textContent=label,1600);
      } catch (_) { button.textContent='Falha ao copiar';setTimeout(()=>button.textContent=label,2200); }
    });return button;
  }
  function jsonBlock(value) {
    const block=node('div','mf-json-block'),bar=node('div','mf-json-tools'),pre=node('pre','mf-json-readonly');
    const add=(label,data,kind)=>bar.append(copyButton(label,()=>JSON.stringify(data,null,2),kind));
    add('Copiar JSON',value,'json');
    const request=value?.model && value?.state && value?.questions ? value : value?.request || value?.output?.request;
    if(request) {
      if(request!==value)add('Copiar request',request,'request');
      if(request.state)add('Copiar state',request.state,'state');
      if(request.questions)add('Copiar questões',request.questions,'questions');
    }
    const response=value?.response || value?.output?.response;
    if(response)add('Copiar output',response,'output');
    const effective=value?.effectiveRequest || value?.output?.effectiveRequest;
    if(effective)add('Copiar request efetivo',effective,'effective-request');
    C.highlight(pre,JSON.stringify(value,null,2));block.append(bar,pre);return block;
  }
  const tones = { pass: '✓ Correto', fail: '× Divergência', warning: '! Correto · baixa confiança', error: '× Erro de execução', interrupted: 'Interrompido' };
  let batch = null, run = null, busy = false, cancel = false, selected = null, follow = true, inspectorKey = '', listKey = '';
  let autoFit = true, zoom = 1, storageBlocked = false;
  let layoutFrame = 0, edgesKey = '';
  const libraryKey = storageKey('memory-library');
  const memoryKey = storageKey('meeting-memory');
  let memoryRaw = null, memoryCheckpoint = null, memoryBlocked = false, memoryOwned = false, memoryProblem = '';
  const selectedTests=new Set();
  let library = F.emptyLibrary(), libraryBlocked = false, libraryBusy = false, savedId = null, historyOpen = false;
  let database=null, draftKey=key, draftRaw=null, migratedDraft=null, pendingPersist=null, persistJob=null, libraryRefresh=0;
  const tabKey=storageKey('memory-tab');
  let questionSet = E.clone(defaultQuestions), questionVersion = '', questionDraft = '', questionPending = false;
  let questionSaveMessage = '';
  // Secondary editor now configures threads; legacy relations are read-only history.
  let relationConfig = E.clone(defaultThreadConfig), relationVersion = '', relationDraft = '', relationPending = false, questionWorker = 'chunks';
  let typedConfig = defaultTypedConfig ? E.clone(defaultTypedConfig) : null, typedVersion = '', typedDraft = '', typedPending = false;
  let typedController = null, typedSelection = null, relationMap = null;
  const legacyRelations = () => !!run?.relation_worker && !run.thread_worker;
  const rawLimit = () => run && run.memorySchemaVersion!==2 ? 4 : 15;
  let relationController = null, relationFrame = 0;
  const pendingQuestions = () => questionPending || relationPending || typedPending;
  const relationQueueKeys = ['stream:relation_events','stream:relation_candidates','stream:relation_rejected','stream:relations','stream:relation_false'];
  const relationStages = { overview:'Evento',approved:'Aprovados pelo filtro',rejected:'Recusados pelo filtro',positive:'Tem relação · true',negative:'Não tem relação · false' };
  const relationQueueLabels = {'stream:relation_events':'meeting_events','stream:relation_candidates':'Aprovados · candidatos','stream:relation_rejected':'Recusados pelo filtro','stream:relations':'Tem relação · true','stream:relation_false':'Não tem relação · false'};
  const threadQueues = {mfNodeThreadContext:['stream:thread_context','State do Jev'],mfNodeThreads:['stream:meeting_threads','meeting_threads'],mfNodeMeetingRelations:['stream:meeting_relations','meeting_relations']};
  if (isV2) Object.assign(threadQueues,{mfNodeTypedPairs:['stream:typed_pairs','Pares da mesma thread'],mfNodeTypedAudit:['stream:typed_audit','Auditoria · sem aresta']});
  Object.assign(relationQueueLabels,Object.fromEntries(Object.values(threadQueues)));
  let relationSelection = null;
  const relationGroupsOpen = new Set();
  let panX = 0, panY = 0, drag = null;
  const collapsed = new Set();
  const queueDefaultHeight = 260, queueMinHeight = 120, queueMaxHeight = 720, queueCollapsedHeight = 42;
  let queueDrag = null;
  const expandedAnswers = new Set(), expandedCriteria = new Set(), expandedRaw = new Set();
  const currentTypes = () => F.typesFor(run?.questions || questionSet);
  const categoryKey = type => 'type:' + type;
  const memoryEdgeKey = type => 'memory:' + type;
  // Escape IDs without treating category text as a selector, HTML or CSS value.
  const typeId = type => type.replace(/[^a-zA-Z0-9_-]/g, char => '~' + char.charCodeAt(0).toString(16) + '~');
  const collapseKeys = () => ['ignore', ...currentTypes().map(categoryKey)];
  const allQueueKeys = () => [...collapseKeys(), 'stream:raw_window', 'stream:meeting_events', ...relationQueueKeys,...Object.values(threadQueues).map(q=>q[0])];
  function notice(text) { $('mfNotice').textContent = text; $('mfNotice').hidden = !text; }
  // Large snapshots belong in IndexedDB. local/sessionStorage keep only small
  // layout preferences and a per-tab draft identifier; V1 stays compatible.
  const storageMessage=error=>error?.name==='QuotaExceededError'
    ? 'O armazenamento do navegador ficou sem espaço. Os dados anteriores foram preservados; mantenha a aba aberta.'
    : 'Não foi possível gravar no armazenamento local. Os dados anteriores foram preservados. '+(error?.message || '');
  const validateCheckpoint=raw=>{
    const value=JSON.parse(raw);
    if(value?.schemaVersion!==1||!value.run)throw Error('Checkpoint inválido.');
    F.restore(value.run);
  };
  const validateDraft=raw=>{
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Rascunho inválido.');
    if(value.run)F.restore(value.run);if(value.batch)F.validateBatch(value.batch,null);
    if(value.questionSet)F.validateQuestions(value.questionSet);
    if(value.threadConfig)T.validateConfig(value.threadConfig);
    if(value.typedRelationConfig&&TR)TR.validateConfig(value.typedRelationConfig);
    if(value.collapsed!=null&&(!Array.isArray(value.collapsed)||value.collapsed.some(id=>typeof id!=='string')))throw Error('Listas recolhidas do rascunho inválidas.');
  };
  if(isV2){
    try{database=await window.NorteMemoryStorage.open();}
    catch(error){libraryBlocked=memoryBlocked=true;notice(storageMessage(error));}
  }
  try{
    const raw=database?await database.migrate(libraryKey,localStorage,value=>F.validateLibrary(JSON.parse(value))):localStorage.getItem(libraryKey);
    if(raw)library=F.validateLibrary(JSON.parse(raw));
  }catch(error){libraryBlocked=true;notice('Não foi possível ler ou migrar os testes salvos. O histórico original foi preservado. '+error.message);}
  try{
    memoryRaw=database?await database.migrate(memoryKey,localStorage,validateCheckpoint):localStorage.getItem(memoryKey);
    if(memoryRaw){validateCheckpoint(memoryRaw);memoryCheckpoint=JSON.parse(memoryRaw);memoryCheckpoint.run=F.restore(memoryCheckpoint.run);}
  }catch(error){
    memoryCheckpoint=null;memoryBlocked=true;
    memoryProblem='Não foi possível ler a memória salva. O registro original foi preservado; salve o teste para guardar os novos resultados. '+error.message;
    notice(memoryProblem);
  }
  if(database){
    try{
      const tabId=sessionStorage.getItem(tabKey)||crypto.randomUUID();draftKey=key+':'+tabId;
      // Migrate the old unscoped session key into this tab's durable draft.
      // The adapter only removes the legacy key after its transaction commits.
      const legacySession={getItem:()=>sessionStorage.getItem(key),removeItem:()=>sessionStorage.removeItem(key)};
      draftRaw=await database.migrate(draftKey,legacySession,validateDraft);
      sessionStorage.setItem(tabKey,tabId);
      migratedDraft=draftRaw?JSON.parse(draftRaw):null;
    }catch(error){storageBlocked=true;notice('Não foi possível recuperar o rascunho desta aba. O original foi preservado. '+error.message);}
  }
  function persistMemory() {
    if(memoryBlocked){if(run&&memoryProblem)notice(memoryProblem);return;}
    if(!run&&!memoryOwned)return;
    try{
      if(localStorage.getItem(memoryKey)!==memoryRaw){memoryBlocked=true;memoryProblem='Outra aba alterou a memória persistente. O conteúdo desta aba continua no rascunho; salve o teste antes de recarregar.';notice(memoryProblem);return;}
      const next=run?JSON.stringify({schemaVersion:1,run,selected,relationSelection,savedId}):null;
      if(next===memoryRaw)return;
      if(next)localStorage.setItem(memoryKey,next);else localStorage.removeItem(memoryKey);
      memoryRaw=next;memoryOwned=!!run;
    }catch(error){notice(storageMessage(error));}
  }
  function persist() {
    if(storageBlocked)return Promise.resolve(false);
    const draft=JSON.stringify({batch,run,selected,relationSelection,source:$('mfBatchJSON').value,questionSet,questionVersion,questionDraft,questionPending,threadConfig:relationConfig,threadVersion:relationVersion,threadDraft:relationDraft,threadPending:relationPending,typedRelationConfig:typedConfig,typedRelationVersion:typedVersion,typedRelationDraft:typedDraft,typedRelationPending:typedPending,savedId,historyOpen,collapsed:[...collapsed]});
    if(!isV2){persistMemory();try{sessionStorage.setItem(key,draft);return Promise.resolve(true);}catch(error){notice(storageMessage(error));return Promise.resolve(false);}}
    if(!database){notice('O armazenamento de resultados está indisponível. Mantenha esta aba aberta.');return Promise.resolve(false);}
    pendingPersist={draft,writeMemory:!!run||memoryOwned,memory:run?JSON.stringify({schemaVersion:1,run,selected,relationSelection,savedId}):null};
    if(!persistJob)persistJob=(async()=>{
      let ok=true;
      while(pendingPersist){
        const next=pendingPersist;pendingPersist=null;
        try{
          // The per-tab draft is written first, independently of shared recovery.
          if(next.draft!==draftRaw){
            if(!await database.compareAndSwap(draftKey,draftRaw,next.draft)){
              // A duplicated tab may inherit sessionStorage. Fork its draft
              // instead of overwriting the original tab's newer contents.
              const tabId=crypto.randomUUID(),forkKey=key+':'+tabId;
              await database.write(forkKey,next.draft);sessionStorage.setItem(tabKey,tabId);draftKey=forkKey;
            }
            draftRaw=next.draft;
          }
          if(!memoryBlocked&&next.writeMemory&&next.memory!==memoryRaw){
            if(await database.compareAndSwap(memoryKey,memoryRaw,next.memory)){memoryRaw=next.memory;memoryOwned=!!next.memory;}
            else{memoryBlocked=true;memoryProblem='Outra aba atualizou a recuperação compartilhada. O rascunho desta aba continua salvo separadamente.';notice(memoryProblem);}
          }
        }catch(error){ok=false;notice(storageMessage(error));}
      }
      return ok;
    })().finally(()=>{persistJob=null;});
    return persistJob;
  }
  async function refreshLibrary(){
    const revision=++libraryRefresh;
    try{const raw=await database.read(libraryKey),next=raw?F.validateLibrary(JSON.parse(raw)):F.emptyLibrary();if(revision===libraryRefresh){library=next;if(savedId&&!next.tests.some(test=>test.id===savedId))savedId=null;renderHistory();controls();}}
    catch(error){notice('Não foi possível atualizar o histórico desta aba. '+error.message);}
  }
  async function editLibrary(change, afterCommit) {
    if(libraryBlocked||isV2&&!database)throw Error('Histórico indisponível. Nenhum teste salvo foi substituído.');
    if(libraryBusy)throw Error('Aguarde o salvamento em andamento.');
    libraryBusy=true;controls();
    try{
      let result;
      if(database){
        result=await database.change(libraryKey,raw=>{
          const next=raw?F.validateLibrary(JSON.parse(raw)):F.emptyLibrary();
          const result=change(next);return {value:JSON.stringify(next),result:E.clone(result??null)};
        });
        await refreshLibrary();
      }else{
        const raw=localStorage.getItem(libraryKey),next=raw?F.validateLibrary(JSON.parse(raw)):F.emptyLibrary();
        result=E.clone(change(next)??null);localStorage.setItem(libraryKey,JSON.stringify(next));library=next;
      }
      if(afterCommit)await afterCommit(result);
      return result;
    }catch(error){throw Error(storageMessage(error));}
    finally{libraryBusy=false;controls();}
  }
  function matchingVersion() { return library.versions.find(v => F.stable(v.questions) === F.stable(questionSet)); }
  function versionLabel() {
    return matchingVersion()?.id || 'Q' + String(Math.max(0, ...library.versions.map(v => Number(v.id.slice(1)))) + 1).padStart(3, '0');
  }
  let hasSavedDraft = false;
  try {
    const session = database ? migratedDraft : JSON.parse(sessionStorage.getItem(key) || 'null');
    const saved = session || (memoryCheckpoint ? { run: memoryCheckpoint.run, selected: memoryCheckpoint.selected, relationSelection:memoryCheckpoint.relationSelection, savedId: memoryCheckpoint.savedId,
      source: JSON.stringify(memoryCheckpoint.run.batch, null, 2) } : null);
    hasSavedDraft = !!saved;
    if (saved) {
      batch = saved.batch ? F.validateBatch(saved.batch, null) : null;
      run = saved.run ? F.restore(saved.run) : null;
      memoryOwned = !!run && run.createdAt === memoryCheckpoint?.run.createdAt;
      if (run) batch = run.batch;
      questionSet = F.validateQuestions(run?.questions || saved.questionSet || defaultQuestions);
      questionVersion = run?.questionVersion || saved.questionVersion || '';
      questionDraft = typeof saved.questionDraft === 'string' ? saved.questionDraft : '';
      questionPending = saved.questionPending === true || saved.questionPending === undefined && !!questionDraft;
      relationConfig = T.validateConfig(run?.thread_worker?.config || saved.threadConfig || defaultThreadConfig);
      relationVersion = run?.thread_worker?.version || saved.threadVersion || '';
      relationDraft = typeof saved.threadDraft === 'string' ? saved.threadDraft : '';
      relationPending = saved.threadPending === true;
      if (TR) {
        typedConfig = TR.validateConfig(run?.typed_relation_worker?.config || saved.typedRelationConfig || defaultTypedConfig);
        typedVersion = run?.typed_relation_worker?.version || saved.typedRelationVersion || '';
        typedDraft = typeof saved.typedRelationDraft === 'string' ? saved.typedRelationDraft : '';
        typedPending = saved.typedRelationPending === true;
      }
      savedId = library.tests.some(t => t.id === saved.savedId) ? saved.savedId : null;
      historyOpen = saved.historyOpen === true;
      for (const id of saved.collapsed || []) {
        const restored = collapseKeys().includes(id) ? id : categoryKey(id);
        if (collapseKeys().includes(restored)) collapsed.add(restored);
      }
      selected = batch?.cases.some(item => item.id === saved.selected) ? saved.selected : batch?.cases[0]?.id;
      if (saved.relationSelection && Object.hasOwn(relationStages,saved.relationSelection.stage) && run?.meeting_events.some(event=>event.event_id===saved.relationSelection.eventId && event.chunk_id===selected)) { relationSelection=E.clone(saved.relationSelection); follow=false; }
      $('mfBatchJSON').value = typeof saved.source === 'string' ? saved.source : '';
      if (run?.status === 'interrupted') notice('A rodada foi interrompida ao sair. Resultados concluídos preservados; nenhuma chamada foi retomada.');
    }
  } catch (_) { storageBlocked = true; notice('Não foi possível ler a rodada salva. O conteúdo anterior não foi apagado; carregar um novo lote o substituirá.'); }
  if (profile && !hasSavedDraft && !storageBlocked && !memoryBlocked) {
    batch = F.validateBatch(E.clone(defaultExample), questionSet);
    selected = batch.cases[0]?.id || null;
    $('mfBatchJSON').value = JSON.stringify(batch, null, 2);
  }
  questionVersion = matchingVersion()?.id || '';
  $('mfBatchJSON').placeholder = JSON.stringify({ batch_id: 'B01', cases: [defaultExample.cases[0]] }, null, 2);
  const editors = {
    mfBatchJSON: C.codeEditor($('mfBatchJSON'), $('mfBatchHighlight')),
    mfQuestionJSON: C.codeEditor($('mfQuestionJSON'), $('mfQuestionHighlight'))
  };
  async function saveCurrent(allowQuestionDraft = false) {
    if (!batch) throw Error('Carregue um input antes de salvar.');
    if (pendingQuestions() && !allowQuestionDraft) throw Error('Salve ou descarte as alterações nas questões primeiro.');
    if (savedId) return savedId;
    const test = await editLibrary(data => F.saveTest(data, batch, questionSet, run, legacyRelations()?run.relation_worker.config:relationConfig,typedConfig),async test=>{
      savedId = test.id; questionVersion = test.questionVersion;
      if (run) run.questionVersion = questionVersion;
      relationVersion = test.threadVersion || '';
      if (run?.thread_worker) run.thread_worker.version = relationVersion;
      typedVersion = test.typedRelationVersion || '';
      if (run?.typed_relation_worker) run.typed_relation_worker.version = typedVersion;
      await persist(); renderHistory();
    });
    return test.id;
  }
  function makeDraft() {
    if (busy) return;
    run = null; savedId = null; relationSelection=null; typedSelection=null;
    inspectorKey = ''; render(); persist();
  }
  let confirmResolve = null;
  function askSave(message, deleting = false) {
    if (confirmResolve) return Promise.resolve('cancel');
    $('mfConfirmTitle').textContent=deleting?'Excluir teste':'Alterações não salvas';
    $('mfConfirmDialog').querySelector('[data-mf-confirm="cancel"]').textContent=deleting?'Cancelar':'Continuar editando';
    const action=$('mfConfirmDialog').querySelector('[data-mf-confirm="discard"]');
    action.textContent=deleting?'Excluir':'Descartar'; action.classList.toggle('mf-danger',deleting);
    $('mfConfirmDialog').querySelector('[data-mf-confirm="save"]').hidden=deleting;
    $('mfConfirmMessage').textContent = message; $('mfConfirmDialog').showModal();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function finishConfirm(choice) {
    const resolve = confirmResolve; confirmResolve = null; $('mfConfirmDialog').close(); resolve?.(choice);
  }
  async function guardWork(onlyResults = false) {
    if(libraryBusy)return false;
    if (!batch || savedId || onlyResults && !run?.records.length) return true;
    const choice = await askSave('Este teste ainda não foi salvo. Deseja guardá-lo antes de continuar?');
    if (choice === 'cancel') return false;
    if (choice === 'save') await saveCurrent(true);
    return true;
  }
  let destinationsKey = '';
  function queuePreference(id) {
    const value = uiPrefs.queueLayouts?.[id];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  const defaultQueueHeight = id => id.startsWith('stream:') ? 320 : queueDefaultHeight;
  function queueHeight(id, expanded = false) {
    if (!expanded && collapsed.has(id)) return queueCollapsedHeight;
    const value = queuePreference(id).height;
    return Number.isFinite(value) ? clamp(value, queueMinHeight, queueMaxHeight) : defaultQueueHeight(id);
  }
  function rememberQueue(id, changes) {
    if (!uiPrefs.queueLayouts || typeof uiPrefs.queueLayouts !== 'object' || Array.isArray(uiPrefs.queueLayouts)) uiPrefs.queueLayouts = {};
    uiPrefs.queueLayouts[id] = { ...queuePreference(id), ...changes };
  }
  function restoreQueueStates() {
    for (const id of allQueueKeys()) {
      const closed = queuePreference(id).collapsed;
      if (closed !== false) collapsed.add(id);
      else collapsed.delete(id);
    }
  }
  function addQueueResizer(card, id, label) {
    const handle = node('div', 'mf-queue-resize'); handle.dataset.queueResize = id; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Altura da lista ' + label);
    handle.setAttribute('aria-controls', card.querySelector('.mf-queue').id);
    handle.setAttribute('aria-valuemin', queueMinHeight); handle.setAttribute('aria-valuemax', queueMaxHeight);
    handle.title = 'Arraste para ajustar a altura · ↑/↓ para ajustar pelo teclado · duplo clique para restaurar';
    card.append(handle);
  }
  function sizeQueues() {
    for (const handle of $('mfScene').querySelectorAll('[data-queue-resize]')) {
      const id = handle.dataset.queueResize, height = queueHeight(id);
      handle.closest('.mf-node').style.height = height + 'px'; handle.hidden = collapsed.has(id);
      handle.setAttribute('aria-valuenow', String(Math.round(queueHeight(id, true))));
      handle.setAttribute('aria-valuetext', Math.round(queueHeight(id, true)) + ' pixels');
    }
  }
  function syncDestinations() {
    const types = currentTypes(), signature = JSON.stringify(types);
    if (signature === destinationsKey) return;
    destinationsKey = signature;
    const existing = new Map([...$('mfDestinations').children].map(card => [card.dataset.category, card]));
    for (const [index, type] of types.entries()) {
      let card = existing.get(type); existing.delete(type);
      if (!card) {
        const id = typeId(type);
        card = node('article', 'mf-node mf-destination'); card.id = 'mfNode-' + id; card.dataset.category = type;
        const header = node('header'), toggle = node('button', 'mf-disclosure', '▾ ' + type);
        toggle.type = 'button'; toggle.dataset.collapse = categoryKey(type); toggle.title = type;
        toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-controls', 'mfQueue-' + id); header.append(toggle);
        const count = node('span', 'mf-queue-count', '0'); count.id = 'mfCount-' + id; header.append(count);
        const list = node('ol', 'mf-queue'); list.id = 'mfQueue-' + id;
        card.append(header, list);
        addQueueResizer(card, categoryKey(type), type);
      }
      card.style.gridRow = String(index + 1); $('mfDestinations').append(card);
    }
    for (const card of existing.values()) card.remove();
    for (const key of collapsed) if (!allQueueKeys().includes(key)) collapsed.delete(key);
    restoreQueueStates();
    edgesKey = ''; autoFit = true;
  }
  function recordFor(id) { return run?.records.find(record => record.id === id); }
  function processingRecord() { return run?.records.find(record => record.status === 'running') || run?.records.findLast(record => record.status !== 'queued'); }
  function toneFor(record) { return record?.result?.verdict || (record?.status === 'running' ? 'active' : record?.status || 'queued'); }
  function select(id, automatic = false) {
    typedSelection = null;
    relationSelection = null;
    selected = id;
    if (!automatic) follow = recordFor(id)?.status === 'running';
    render(); persist();
  }
  function selectRelation(eventId,stage='overview',targetId=null) {
    typedSelection = null;
    const event=run?.meeting_events.find(event=>event.event_id===eventId); if (!event) return;
    selected=event.chunk_id; follow=false; relationSelection={eventId,stage,targetId}; inspectorKey='';
    if (uiPrefs.inspectorHidden) { uiPrefs.inspectorHidden=false; applyUI(); saveUI(); }
    render(); persist();
    if (targetId) requestAnimationFrame(()=>{
      const row=[...$('mfInspector').querySelectorAll('[data-relation-target], [data-thread-target]')].find(row=>(row.dataset.relationTarget || row.dataset.threadTarget)===targetId);
      if (row) { row.open=true; row.scrollIntoView({block:'nearest'}); }
    });
  }
  function selectTypedRelation(eventId,targetId) {
    const event=run?.meeting_events.find(event=>event.event_id===eventId);if(!event)return;
    selected=event.chunk_id;follow=false;relationSelection=null;typedSelection={eventId,targetId};inspectorKey='';
    if(uiPrefs.inspectorHidden){uiPrefs.inspectorHidden=false;applyUI();saveUI();}
    render();persist();
    requestAnimationFrame(()=>{
      const row=[...$('mfInspector').querySelectorAll('[data-typed-target]')].find(r=>r.dataset.typedTarget===targetId);
      if(row){row.open=true;row.scrollIntoView({block:'nearest'});}
    });
  }
  function renderTypedRelations() {
    if(typedUI&&!legacyRelations())typedUI.render({run,selection:typedSelection,onSelect:selectTypedRelation});
  }
  function controls() {
    $('mfRun').disabled = busy || libraryBusy || !batch || !C.isAvailable() || document.body.dataset.page !== 'memory' || pendingQuestions();
    $('mfRun').textContent = run?.records.length ? 'Executar novamente' : 'Executar fluxo';
    $('mfRun').title = 'De 1 a 2 chamadas por chunk, mais consultas de threads'+(isV2?' e relações entre eventos da mesma thread':'')+'. Pode consumir créditos. Só entra no histórico ao clicar em Salvar.';
    for (const id of ['mfPaste', 'mfLoad', 'mfClear', 'mfSaveUtterance']) $(id).disabled = busy || libraryBusy;
    $('mfSaveTest').disabled = busy || libraryBusy || !batch || !!savedId || pendingQuestions() || libraryBlocked;
    $('mfSaveTest').textContent = libraryBusy ? 'Salvando…' : savedId ? 'Salvo' : 'Salvar';
    $('mfQuestions').disabled=libraryBusy;
    $('mfBatchJSON').readOnly=busy||libraryBusy;$('mfQuestionJSON').readOnly=busy||libraryBusy;
    questionTools();
    $('mfQuestions').textContent = 'Questões';
    $('mfQuestions').title = pendingQuestions() ? 'Há alterações não salvas.' : 'Editar questões dos chunks, threads'+(isV2?' e relações':'');
    $('mfMinutes').hidden = !isV2;
    $('mfMinutes').disabled = busy || !run?.meeting_events.length || !window.NorteGeminiMinutes;
    $('mfTypedQuestions').hidden = !isV2;
    $('mfStop').hidden = !busy; $('mfStop').disabled = cancel;
    $('mfStop').textContent = cancel ? 'Interrompendo…' : 'Interromper';
    $('mfBurstToggle').disabled = busy;
    $('mfBurstToggle').setAttribute('aria-checked', String(uiPrefs.fastMode === true));
    $('mfModeLabel').textContent = uiPrefs.fastMode ? 'Rajada' : 'Passo a passo';
    $('mfBurstToggle').title = busy ? 'O modo fica fixo durante a execução. Altere antes da próxima rodada.' : uiPrefs.fastMode
      ? 'Rajada: até 4 chunks chegam a cada 120 ms. Classificação em fila, sem pausas visuais; a velocidade depende da API.'
      : 'Passo a passo: um chunk por vez, com pausas para acompanhar o caminho. Ative para simular chegadas rápidas em rajada.';
  }
  function renderChunks() {
    const signature = JSON.stringify(batch?.cases || []);
    if (signature !== listKey) {
      listKey = signature; $('mfChunks').replaceChildren();
      if (!batch) $('mfChunks').append(node('li', 'mf-empty', 'Abra Input JSON para adicionar seus chunks.'));
      for (const item of batch?.cases || []) {
        const li = node('li'), button = node('button', 'mf-chunk'); button.type = 'button'; button.dataset.chunk = item.id;
        const header = node('span', 'mf-chunk-heading'); header.append(node('strong', '', item.id), node('span', 'mf-chunk-status'));
        button.append(header, node('span', 'mf-input-label', 'current_utterance'), node('span', 'mf-chunk-preview', item.current_utterance));
        button.addEventListener('click', () => select(item.id)); li.append(button); $('mfChunks').append(li);
      }
    }
    for (const button of $('mfChunks').querySelectorAll('[data-chunk]')) {
      const record = recordFor(button.dataset.chunk), tone = toneFor(record);
      button.querySelector('strong').title = chunkMetadata(button.dataset.chunk, record);
      button.dataset.tone = tone; button.classList.toggle('is-selected', button.dataset.chunk === selected);
      button.classList.toggle('is-current', record?.status === 'running');
      button.setAttribute('aria-current', button.dataset.chunk === selected ? 'true' : 'false');
      button.querySelector('.mf-chunk-status').textContent = record?.status === 'running' ? (record.stage === 'type' ? 'Tipo…' : 'Filtro…') : record?.status === 'queued' ? 'Na fila' : tones[tone] || 'Aguardando';
      if (busy && follow && button.dataset.chunk === selected) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function renderQueues() {
    syncDestinations();
    const { memory, ignored } = F.queues(run, questionSet);
    function fill(list, items, kind = '') {
      if (!items.length) {
        delete list.dataset.selected;
        if (!list.querySelector('.mf-empty-queue')) list.replaceChildren(node('li', 'mf-empty-queue', 'Nenhum chunk'));
        return;
      }
      list.querySelector('.mf-empty-queue')?.remove();
      const existing = new Map([...list.querySelectorAll('[data-record]')].map(button => [button.dataset.record, button]));
      let reveal = null;
      for (const [index, item] of items.entries()) {
        let button = existing.get(item.id); existing.delete(item.id);
        if (!button) {
          const li = node('li'); button = node('button', 'mf-queue-item'); button.type = 'button'; button.dataset.record = item.id;
          button.append(node('span', 'mf-queue-id'), node('span', 'mf-queue-text', (kind ? 'Input: ' : '') + item.text));
          if (kind) button.append(node('span', 'mf-stream-meta'));
          button.addEventListener('click', () => kind==='relation-events' ? selectRelation(item.event_id) : select(item.id)); li.append(button); list.append(li);
          if (busy) li.classList.add('mf-arriving');
        }
        button.querySelector('.mf-queue-id').textContent = kind.endsWith('events') ? `${item.event_id} · ${item.id} · ${item.type}` : `${index + 1} · ${item.id}`;
        if (kind) {
          const meta = button.querySelector('.mf-stream-meta');
          meta.textContent = kind.endsWith('events') ? `${item.timestamp} · ${item.status}`+(Object.hasOwn(item,'thread_id')?' · '+(item.thread_id || 'pendente'):'') : item.timestamp;
          button.title = 'Input · current_utterance\n' + item.text + '\n' + JSON.stringify(item, null, 2);
        } else button.title = chunkMetadata(item.id, recordFor(item.id));
        // A map queue is a shared collection, not the selected chunk's verdict.
        // Keep unrelated entries neutral; their own results remain in inspection.
        button.dataset.tone = item.id === selected ? item.verdict : '';
        button.classList.toggle('is-selected', item.id === selected);
        button.classList.toggle('is-current', recordFor(item.id)?.status === 'running');
        button.setAttribute('aria-current', String(item.id === selected));
        if (kind && item.id === selected && list.dataset.selected !== selected) reveal = button;
        if (busy && follow && item.id === selected) {
          // Follow the new entry inside its FIFO only; never scroll the canvas/page.
          const entry = button.getBoundingClientRect(), viewport = list.getBoundingClientRect();
          const scale = Number($('mfScene').dataset.scale) || 1;
          if (entry.bottom > viewport.bottom) list.scrollTop += (entry.bottom - viewport.bottom) / scale;
          else if (entry.top < viewport.top) list.scrollTop -= (viewport.top - entry.top) / scale;
        }
      }
      for (const button of existing.values()) button.parentElement.remove();
      if (kind && !items.some(item => item.id === selected)) delete list.dataset.selected;
      if (reveal) requestAnimationFrame(() => {
        if (!reveal.isConnected || reveal.dataset.record !== selected || !list.clientHeight) return;
        const entry = reveal.getBoundingClientRect(), viewport = list.getBoundingClientRect();
        const scale = Number($('mfScene').dataset.scale) || 1;
        if (entry.top < viewport.top || entry.height > viewport.height) list.scrollTop += (entry.top - viewport.top) / scale;
        else if (entry.bottom > viewport.bottom) list.scrollTop += (entry.bottom - viewport.bottom) / scale;
        list.dataset.selected = selected;
      });
    }
    fill($('mfIgnoreQueue'), ignored); $('mfIgnoreCount').textContent = ignored.length;
    for (const type of currentTypes()) { fill($('mfQueue-' + typeId(type)), memory[type]); $('mfCount-' + typeId(type)).textContent = memory[type].length; }
    const events = run?.meeting_events || [], recent = run?.raw_window || [];
    const graphItem = item => ({ ...item, id: item.chunk_id, verdict: toneFor(recordFor(item.chunk_id)) });
    fill($('mfGraphRawQueue'), recent.map(graphItem), 'raw'); $('mfGraphRawCount').textContent = recent.length + '/' + rawLimit();
    fill($('mfGraphEventsQueue'), events.map(graphItem), 'events'); $('mfGraphEventsCount').textContent = events.length;
    fill($('mfRelationEvents'), events.map(graphItem), 'relation-events'); $('mfRelationEventsCount').textContent=events.length;
    $('mfRawSelection').textContent = selected && !recent.some(item => item.chunk_id === selected)
      ? selected + (recordFor(selected) ? ' · fora da janela atual' : ' · ainda não recebido') : '';
    for (const button of $('mfScene').querySelectorAll('[data-collapse], [data-stream-collapse]')) {
      const id = button.dataset.collapse || button.dataset.streamCollapse, closed = collapsed.has(id), card = button.closest('.mf-node');
      button.textContent = (closed ? '▸ ' : '▾ ') + (relationQueueLabels[id] || (id === 'ignore' ? 'Ignore' : id.startsWith('stream:') ? id.slice(7) : card.dataset.category));
      button.setAttribute('aria-expanded', String(!closed)); card.classList.toggle('is-collapsed', closed);
      card.querySelector('.mf-queue').hidden = closed;
      if (closed && id.startsWith('stream:')) delete card.querySelector('.mf-queue').dataset.selected;
    }
    const allClosed = collapseKeys().every(key => collapsed.has(key));
    $('mfCollapseAll').textContent = allClosed ? 'Expandir listas' : 'Recolher listas';
    $('mfScene').classList.toggle('all-collapsed', allClosed);
    sizeQueues();
  }
  let memorySelection = '', memoryRunIdentity = '';
  function relationJob() {
    const event = run?.meeting_events.find(event => event.chunk_id === selected);
    return (run?.thread_worker || run?.relation_worker)?.jobs.find(job => job.event_id === event?.event_id);
  }
  const relationAuditCache = new WeakMap();
  function auditFor(job) {
    if (!job || !run) return null;
    const stamp=JSON.stringify([job.status,job.parts.map(part=>[part.status,part.error]),job.error]);
    const cached=relationAuditCache.get(job);
    if (cached?.run===run && cached.stamp===stamp && cached.scores===job.scores) return cached.audit;
    const audit=R.auditJob(run,job); relationAuditCache.set(job,{run,stamp,scores:job.scores,audit}); return audit;
  }
  function pairTone(pair,stage) { return ['approved','rejected'].includes(stage) ? pair.filterTone : pair.resultTone; }
  const relationToneText={pass:'✓ Correto',fail:'× Divergência',error:'× Erro',warning:'! Baixa confiança',active:'Processando'};
  const threadActions={create_new_thread:'Criar thread',reactivate_thread:'Reativar thread',keep_active_thread:'Continuar thread ativa',assignment_pending:'Atribuição pendente'};
  const threadReasons={first_event:'Primeiro evento',belongs:'Continuidade',no_archive_match:'Nenhuma arquivada compatível',reopened:'Thread reativada',uncertain_active:'Thread ativa incerta',uncertain_archive:'Arquivada incerta',conflicting_archives:'Mais de uma arquivada compatível',low_confidence_active:'Thread ativa: confiança < 80%',low_confidence_archive:'Arquivada: confiança < 80%',missing_active_response:'Thread ativa sem resposta válida',missing_archive_response:'Arquivada sem resposta válida'};
  function threadEntry(event,active=false,tone='') {
    const li=node('li'),button=node('button','mf-queue-item');button.type='button';button.dataset.threadEvent=event.event_id;
    button.append(node('span','mf-queue-id',event.event_id+' · '+event.chunk_id+' · '+event.type),node('span','mf-queue-text','Input: '+event.text));
    button.title=JSON.stringify(event,null,2);button.classList.toggle('is-selected',active);button.dataset.tone=active?tone:'';
    button.addEventListener('click',()=>selectRelation(event.event_id));li.append(button);return li;
  }
  const threadDisclosures=new Map();
  function renderThreadCollection(list, sidebar=false) {
    const threads=run?.meeting_threads || [],events=run?.meeting_events || [],jobs=run?.thread_worker?.jobs || [];
    const pending=events.filter(event=>Object.hasOwn(event,'thread_id') && event.thread_id===null);
    const signature=JSON.stringify([run?.createdAt,threads,events,jobs.map(j=>[j.event_id,j.status,j.result,j.error]),selected]);
    if(list.dataset.signature===signature)return;
    const archiveQueries=sidebar?null:$('mfNodeThreadArchive'),scroll=list.scrollTop;
    list.dataset.signature=signature;list.replaceChildren();
    function disclosure(id,label,count,open) {
      const details=node('details','mf-thread-group'),summary=node('summary'),children=node('ol','mf-relation-children');
      const key=list.id+':'+run?.createdAt+':'+id;details.dataset.threadGroup=id;
      details.open=threadDisclosures.has(key)?threadDisclosures.get(key):open;
      summary.append(node('span','',label),node('span','mf-group-count',String(count)));
      details.append(summary,children);
      details.addEventListener('toggle',()=>{if(details.isConnected)threadDisclosures.set(key,details.open);});
      return {details,children};
    }
    for(const [status,label] of [['active','Ativas'],['archived','Arquivadas']]) {
      const entries=threads.filter(thread=>thread.status===status),group=disclosure(status,label,entries.length,status==='active');
      const li=node('li');li.append(group.details);list.append(li);
      for(const thread of entries) {
        const row=node('li'),details=node('details','mf-relation-group');details.dataset.thread=thread.thread_id;
        const key=list.id+':'+run.createdAt+':'+thread.thread_id;
        details.open=threadDisclosures.get(key) || false;
        details.addEventListener('toggle',()=>{if(details.isConnected)threadDisclosures.set(key,details.open);});
        const title=thread.title || events.find(event=>event.event_id===thread.created_by_event_id)?.text || thread.thread_id;
        const summary=node('summary');summary.append(node('strong','',thread.thread_id),node('span','',thread.status),node('span','mf-group-count',String(thread.anchor_event_ids.length)));summary.title=title;
        const children=node('ol','mf-relation-children');
        for(const id of thread.anchor_event_ids) {
          const event=events.find(e=>e.event_id===id);if(!event)continue;
          const job=jobs.find(j=>j.event_id===id),audit=job?T.audit(run,job):null;
          children.append(threadEntry(event,event.chunk_id===selected,audit?.tone));
        }
        details.append(summary,node('p','mf-thread-title',title),copyButton('Copiar thread',()=>JSON.stringify(thread,null,2),'thread'),children);row.append(details);group.children.append(row);
      }
      if(!entries.length)group.children.append(node('li','mf-empty-queue','Nenhuma thread '+(status==='active'?'ativa':'arquivada')));
      if(status==='archived' && archiveQueries)group.details.append(archiveQueries);
    }
    const group=disclosure('unassigned','Sem atribuição',pending.length,true),li=node('li');
    if(!sidebar){group.details.id='mfNodeThreadPending';group.children.id='mfThreadPending';group.details.querySelector('.mf-group-count').id='mfThreadPendingCount';}
    group.details.title='Eventos aguardando atribuição: thread_id permanece null. Este grupo não é uma thread.';
    for(const event of pending) {
      const job=jobs.find(j=>j.event_id===event.event_id),audit=job?T.audit(run,job):null;
      const entry=threadEntry(event,event.chunk_id===selected,audit?.tone);
      entry.firstChild.append(node('span','mf-stream-meta',job?.error || threadReasons[job?.result?.reason] || 'Aguardando classificação'));
      group.children.append(entry);
    }
    if(!pending.length)group.children.append(node('li','mf-empty-queue','Nenhum evento pendente'));
    li.append(group.details);list.append(li);list.scrollTop=scroll;
  }
  function renderThreads() {
    const worker=run?.thread_worker,jobs=worker?.jobs || [],processing=jobs.find(j=>j.status==='running');
    // Selection never follows a different worker behind the user's back.
    const job=relationJob(),audit=job?T.audit(run,job):null,events=run?.meeting_events || [],threads=run?.meeting_threads || [];
    $('mfScene').dataset.relationMode='threads';
    $('mfRelationHeading').querySelector('h3').textContent='Thread worker';
    for(const id of ['mfNodeRelationFilter','mfNodeRelationCandidates','mfNodeRelationRejected','mfNodeHasRelation','mfNodeRelations','mfNodeRelationFalse'])$(id).hidden=true;
    for(const n of $('mfScene').querySelectorAll('.mf-thread-node'))n.hidden=false;
    $('mfNodeRelationEvents').style.gridColumn='1';
    $('mfRelationProgress').textContent=worker?`${processing?.event_id || '—'} · ${jobs.filter(j=>j.status==='queued').length} na fila · ${worker.calls} chamadas${run.status==='done'&&worker.status==='running'?' · chunks concluídos':''}`:'Fila independente';
    const active=job?.parts.find(p=>p.stage==='active'),archives=job?.parts.filter(p=>p.stage==='archive') || [];
    const activeResponse=audit?.responses.find(r=>r.part.stage==='active'),archiveResponses=audit?.responses.filter(r=>r.part.stage==='archive') || [];
    $('mfThreadActiveValue').textContent=activeResponse?.actual?`${job.active_thread_id} · ${activeResponse.actual} · ${percent(activeResponse.probability)}`:active?.status==='running'?'Consultando…':job?.result?.reason==='first_event'?'Sem thread ativa · primeira atribuição':job?.status==='queued'?'Na fila':'Aguardando evento';
    const archiveList=$('mfThreadArchiveCandidates'),archiveSignature=JSON.stringify([job?.event_id,worker?.schemaVersion,job?.result,archives.map(p=>[p.status,p.error,p.output])]);
    if(archiveList.dataset.signature!==archiveSignature) {
      const scroll=archiveList.scrollTop;archiveList.dataset.signature=archiveSignature;archiveList.replaceChildren();
      for(const part of archives)for(const id of part.candidate_ids) {
        const r=archiveResponses.find(r=>r.target_thread_id===id),li=node('li'),button=node('button','mf-queue-item');button.type='button';button.dataset.archiveThread=id;
        button.append(node('span','mf-queue-id',id),node('span','mf-queue-text',r?.actual || part.error || (part.status==='running'?'Consultando…':'Aguardando')),node('span','mf-stream-meta','Confiança '+percent(r?.probability)));
        button.dataset.tone=r?.tone || '';button.title='belongs_to_archive_thread__'+id;button.addEventListener('click',()=>selectRelation(job.event_id,'overview',id));li.append(button);archiveList.append(li);
      }
      if(!archives.length) {
        const message=worker?.schemaVersion>=4
          ? job?.result?.route==='active'?'Dispensadas · belongs ≥ 80%':job?.result?'Nenhuma thread arquivada disponível nesta etapa':'Consultadas quando a ativa não confirmar belongs ≥ 80%'
          : job?.result?.reason==='no_archive_match'?'Nenhuma thread arquivada disponível nesta etapa':job?.result?.reason==='low_confidence_active'?'Não consultadas nesta execução histórica · confiança < 80%':'Somente após does_not_belong'+(worker?.schemaVersion===1?'':' ≥ 80%');
        archiveList.append(node('li','mf-empty-queue',message));
      }
      archiveList.scrollTop=scroll;
    }
    $('mfThreadArchiveCount').textContent=archives.reduce((n,p)=>n+p.candidate_ids.length,0);
    $('mfThreadAssignmentValue').textContent=job?.result?`${job.event_id} → ${job.result.thread_id || 'null'}\n${threadActions[audit.action]}${job.result.route==='pending'?' · '+threadReasons[job.result.reason]:''}`:job?.status==='error'?job.error:job?.status==='interrupted'?'Interrompido':job?'Aguardando respostas':'Aguardando evento';
    const context=$('mfThreadContext'),state=active?.request?.state;
    const contextSignature=JSON.stringify([job?.event_id,job?.recent_context,state]);
    if(context.dataset.signature!==contextSignature) {
      context.dataset.signature=contextSignature;context.replaceChildren();
      if(state) {
        const tools=node('li','mf-json-tools');
        tools.append(copyButton('Copiar state',()=>JSON.stringify(state,null,2),'state'),copyButton('Copiar request',()=>JSON.stringify(active.request,null,2),'request'));
        context.append(tools);
      }
      const chunks=state?.recent_context || (job?.recent_context || []).map(c=>typeof c==='string'?T.chunkFor(run,c):c);
      const anchors=state?.active_thread?.events || state?.active_thread?.anchors || [];
      context.append(node('li','mf-empty-queue','1 · recent_context · '+chunks.length+' / '+(worker?.schemaVersion>=5?8:5)+' anteriores'));
      for(const c of chunks){const li=node('li','mf-context-entry');li.append(node('strong','',c.chunk_id+(c.timestamp?' · '+c.timestamp:'')),node('p','',c.text));li.title=JSON.stringify(c,null,2);context.append(li);}
      context.append(node('li','mf-empty-queue','2 · '+(job?.active_thread_id || 'Sem thread ativa')+' · '+anchors.length+' eventos'));
      for(const event of anchors)context.append(threadEntry(event));
      context.append(node('li','mf-empty-queue','3 · current_event'));
      if(audit)context.append(threadEntry(state?.current_event || audit.event));
      $('mfThreadContextCount').textContent=chunks.length+' + '+anchors.length+' + '+(job?1:0);
    }
    renderThreadCollection($('mfThreads'));
    $('mfThreadsCount').textContent=threads.length;
    const edgeTones={},tone=audit?.tone || '';
    $('mfNodeRelationEvents').dataset.routeTone='';
    for(const id of ['mfNodeThreadContext','mfNodeThreadActive','mfNodeThreadAssignment'])$(id).dataset.tone='';
    if(job && job.status!=='queued') {
      edgeTones.thread_context=tone; $('mfNodeRelationEvents').dataset.routeTone=tone;$('mfNodeThreadContext').dataset.tone=tone;
      if(active){edgeTones.thread_active=activeResponse?.tone || (active.status==='running'?'active':'');$('mfNodeThreadActive').dataset.tone=edgeTones.thread_active;}
      if(job.result) {
        // This is the processing sequence; the decision and its cause stay in the cards.
        edgeTones.thread_decision=tone;edgeTones.thread_save=tone;
        $('mfNodeThreadAssignment').dataset.tone=tone;
      }
    }
    $('mfScene').dataset.relationEdgeTones=JSON.stringify(edgeTones);$('mfScene').dataset.relationPath=JSON.stringify(Object.keys(edgeTones));
  }
  function threadDetails(panel) {
    const event=run?.meeting_events.find(e=>e.chunk_id===selected);if(!event)return;
    const section=node('section','mf-relation-results');section.id='mfThreadDetails';section.dataset.assignmentState=event.thread_assignment_state || '';
    const job=relationJob(),audit=job?T.audit(run,job):null;
    section.append(node('h3','',`Thread · ${event.event_id} → ${event.thread_id || 'pendente'}`));
    if(!audit){section.append(node('p','','Worker de threads não executado neste snapshot.'));panel.append(section);return;}
    const route=node('p','mf-thread-route',(threadActions[audit.action] || ({queued:'Na fila',running:'Processando',error:'Erro',interrupted:'Interrompido'})[job.status])+(job.result?' · '+threadReasons[job.result.reason]:''));route.dataset.tone=audit.tone;section.append(route);
    const activeResponse=audit.responses.find(response=>response.part.stage==='active');
    if(job.result?.reason==='low_confidence_active' && activeResponse) {
      section.append(node('p','mf-answer-note',`O Jev respondeu ${activeResponse.actual} com ${percent(activeResponse.probability)}. O limite para atribuir ou trocar de thread é ${percent(T.assignmentThreshold)}. O evento fica pendente e sua fala continua disponível no contexto dos próximos eventos.`));
    }
    function comparisonRow(id,label,expected,actual,matches,applicable=true) {
      const row=node('details','mf-answer');row.dataset.threadQuestion=id;
      rememberDisclosure(row,expandedAnswers,'thread:'+event.event_id+':'+id);
      const summary=node('summary','mf-answer-summary'),key=node('span','mf-answer-key',label),badge=node('span','mf-answer-verdict',matches===null?applicable?'Aguardando':'Sem gabarito':matches?'✓ Resposta correta':'× Divergência');badge.dataset.tone=matches===null?'':matches?'pass':'fail';key.append(badge);summary.append(key);
      for(const [title,value] of [['Esperado: ',applicable?expected:'Não informado'],['Obtido: ',actual]]) {
        const part=node('span','mf-answer-comparison'),line=node('span','mf-answer-value-line'),val=node('strong','mf-answer-value',value===null?'null':typeof value==='object'?JSON.stringify(value):String(value));val.dataset.tone=matches===null?'':matches?'pass':'fail';line.append(node('span','mf-answer-label',title),val);part.append(line);summary.append(part);
      }
      row.append(summary);return row;
    }
    for(const check of audit.checks) {
      const row=comparisonRow(check.key,check.key.replace('expected_',''),check.expected,check.actual,check.matches);
      const notes={expected_active_thread_id:'Thread ativa antes de processar este evento.',expected_archive_results:'Comparação completa por ID: {} espera nenhuma consulta arquivada; a ordem das chaves não altera o resultado.',expected_action:'Nome da ação comparado exatamente com expected_action do input.'};
      const note=notes[check.key] || 'Validação da etapa informada no gabarito do chunk.';
      row.firstChild.title=note;row.append(node('p','mf-answer-note',note));section.append(row);
    }
    for(const r of audit.responses) {
      const row=comparisonRow(r.id,r.id,r.expected,r.actual,r.matches,r.expected!==null),summary=row.firstChild;
      row.dataset.threadTarget=r.target_thread_id;if(relationSelection?.targetId===r.target_thread_id)row.open=true;
      const comparisons=summary.querySelectorAll('.mf-answer-comparison');
      comparisons[0].append(node('span','mf-answer-minimum','Confiança ≥ 80%'));
      const confidence=node('span','mf-answer-confidence','Confiança '+percent(r.probability));confidence.dataset.tone=r.probability===null?'':r.probability<.8?'warning':'pass';comparisons[1].append(confidence);
      const content=node('div','mf-answer-content');content.append(node('p','mf-answer-instructions',r.definition.instructions));
      const answer=r.part.output?.response.answers[r.id];
      for(const [value,description] of Object.entries(r.definition.criteria).sort(([a],[b])=>(answer?.probabilities[b] || 0)-(answer?.probabilities[a] || 0))) {
        const option=node('div','mf-distribution-option'),head=node('div','mf-distribution-heading');head.append(node('span','mf-distribution-name',value),probabilityIndicator(answer?.probabilities[value] ?? null));option.append(head,node('p','mf-criterion',description));content.append(option);
      }
      if(r.part.error)content.append(node('p','mf-execution-error',r.part.error));
      const sent=node('details','mf-answer-raw'),payload=jsonBlock(r.part.request);sent.dataset.threadRequest=r.id;rememberDisclosure(sent,expandedRaw,'thread-request:'+event.event_id+':'+r.id);sent.append(node('summary','',r.part.attempted?'JSON enviado ao Jev':'JSON preparado para o Jev'),payload);content.append(sent);
      const raw=node('details','mf-answer-raw'),pre=jsonBlock(r.part);rememberDisclosure(raw,expandedRaw,'thread:'+event.event_id+':'+r.id);raw.append(node('summary','','JSON da chamada e resposta'),pre);content.append(raw);row.append(content);section.append(row);
    }
    if(job.error)section.append(node('p','mf-execution-error',job.error));
    for(const part of job.parts.filter(p=>p.error&&!p.request))section.append(node('p','mf-execution-error',part.error));
    const raw=node('details','mf-answer-raw'),pre=jsonBlock({event,expected:audit.expectedSpec,job});rememberDisclosure(raw,expandedRaw,'thread-job:'+event.event_id);raw.append(node('summary','','Referências e execução completa'),pre);section.append(raw);panel.append(section);
  }
  function renderRelations() {
    if(!legacyRelations()){renderThreads();renderTypedRelations();return;}
    for(const n of $('mfScene').querySelectorAll('.mf-typed-node'))n.hidden=true;
    $('mfRelationsPanel').hidden=true;
    for(const n of $('mfScene').querySelectorAll('.mf-thread-node'))n.hidden=true;
    for(const id of ['mfNodeHasRelation','mfNodeRelations','mfNodeRelationFalse'])$(id).hidden=false;
    $('mfRelationHeading').querySelector('h3').textContent='Relation worker · histórico';
    const worker=run?.relation_worker, jobs=worker?.jobs || [], processing=jobs.find(job=>job.status==='running');
    const filtered=R.isFiltered(worker);
    $('mfScene').dataset.relationMode=filtered?'legacy_filter':'all_previous';
    for (const id of ['mfNodeRelationFilter','mfNodeRelationCandidates','mfNodeRelationRejected']) $(id).hidden=!filtered;
    $('mfNodeRelationEvents').style.gridColumn=filtered?'1':'1 / 3';
    $('mfNodeHasRelation').style.gridColumn=filtered?'4':'3';
    for (const id of ['mfNodeRelations','mfNodeRelationFalse']) $(id).style.gridColumn=filtered?'5':'4 / 6';
    const job=follow && processing ? processing : relationJob(), audit=auditFor(job);
    const queued=jobs.filter(job=>job.status==='queued').length;
    $('mfRelationProgress').textContent=worker ? `${processing?.event_id || audit?.current.event_id || '—'} · ${queued} na fila interna · ${worker.calls} chamadas · ${jobs.filter(j=>j.status==='error').length} erros${run.status==='done'&&worker.status==='running'?' · chunks concluídos; relações continuam':''}` : 'Entrada sincronizada · fila interna independente';
    function fillGroups(list,stage,countId) {
      const isFilter=stage==='approved'||stage==='rejected';
      const groups=jobs.map(auditFor).filter(audit=>audit && (isFilter || audit.job.candidate_ids.length));
      const existing=new Map([...list.children].filter(li=>li.dataset.groupEvent).map(li=>[li.dataset.groupEvent,li]));
      list.querySelector('.mf-empty-queue')?.remove();
      let total=0;
      for (const group of groups) {
        const pairs=group[stage], event=group.current, active=event.event_id===audit?.current.event_id;
        total+=pairs.length;
        let li=existing.get(event.event_id); existing.delete(event.event_id);
        if (!li) {
          li=node('li'); li.dataset.groupEvent=event.event_id;
          const detail=node('details','mf-relation-group'); detail.dataset.relationEvent=event.event_id; detail.dataset.relationStage=stage;
          const summary=node('summary'), title=node('strong','',event.event_id), verdict=node('span','mf-group-verdict'), count=node('span','mf-group-count');
          summary.append(title,verdict,count);
          const children=node('ol','mf-relation-children'); detail.append(summary,children); li.append(detail); list.append(li);
          summary.addEventListener('click',()=>selectRelation(event.event_id,stage));
          detail.addEventListener('toggle',()=>{
            if (!detail.isConnected) return;
            const key=run?.createdAt+':'+stage+':'+event.event_id;
            detail.open?relationGroupsOpen.add(key):relationGroupsOpen.delete(key);
            renderRelations();
          });
        }
        const detail=li.firstElementChild, key=run.createdAt+':'+stage+':'+event.event_id;
        detail.open=relationGroupsOpen.has(key);
        detail.classList.toggle('is-selected',active);
        const tone=R.combinedTone(pairs.map(pair=>pairTone(pair,stage)));
        detail.dataset.tone=tone;
        const verdict=detail.querySelector('.mf-group-verdict');
        verdict.textContent=relationToneText[tone] || (pairs.length?'Não avaliado':'');
        verdict.dataset.tone=tone;
        verdict.dataset.relationVerdict=isFilter?'filter':'response';
        verdict.title=isFilter?'Comparação com o gabarito, quando informado; senão, conformidade com a regra configurada.':run.relation_worker.schemaVersion>=3?'Gabarito: relações listadas são positivas; pares não listados têm esperado false.':'Acerto só é avaliado quando has_relation está informado no gabarito deste par.';
        detail.querySelector('.mf-group-count').textContent=String(pairs.length);
        const children=detail.querySelector('.mf-relation-children');
        const signature=JSON.stringify([detail.open,pairs.map(pair=>[pair.target.event_id,pairTone(pair,stage),pair.obtained,pair.probability,pair.retained]),group.job.status]);
        if (children.dataset.signature!==signature) {
          children.dataset.signature=signature; children.replaceChildren();
          if (detail.open) {
            for (const pair of pairs) {
              const entry=node('li'), button=node('button','mf-queue-item'); button.type='button'; button.dataset.targetEvent=pair.target.event_id;
              const heading=node('span','mf-queue-id'), marker=node('span','',relationToneText[pairTone(pair,stage)] || 'Não avaliado');
              marker.dataset.tone=pairTone(pair,stage);
              heading.append(document.createTextNode(pair.target.event_id+' · '),marker);
              if (!isFilter) heading.append(document.createTextNode(' · '+String(pair.obtained)+' · '+percent(pair.probability)));
              button.append(heading,node('span','mf-queue-text',pair.target.type+' · '+pair.target.status));
              button.title=pair.target.text;
              button.addEventListener('click',()=>selectRelation(event.event_id,stage,pair.target.event_id)); entry.append(button); children.append(entry);
            }
            if (!pairs.length) children.append(node('li','mf-empty-queue',isFilter?'Nenhum evento neste grupo':group.job.status==='running'||group.job.status==='queued'?'Aguardando respostas':group.job.status==='error'?'Erro; veja os detalhes':'Nenhuma resposta neste grupo'));
          }
        }
      }
      for (const li of existing.values()) li.remove();
      if (!groups.length) list.append(node('li','mf-empty-queue',isFilter?'Aguardando eventos':'Nenhuma consulta de relações'));
      $(countId).textContent=total;
      $(countId).title=groups.length+' eventos de entrada · '+total+' pares neste grupo';
    }
    if (filtered) {
      fillGroups($('mfRelationCandidates'),'approved','mfRelationCandidateCount');
      fillGroups($('mfRelationRejected'),'rejected','mfRelationRejectedCount');
    } else { $('mfRelationCandidates').replaceChildren(); $('mfRelationRejected').replaceChildren(); }
    fillGroups($('mfRelations'),'positive','mfRelationsCount');
    fillGroups($('mfRelationFalse'),'negative','mfRelationFalseCount');
    $('mfRelationRule').textContent=audit ? `${audit.current.event_id} · ${audit.approved.length} aprovados · ${audit.rejected.length} recusados` : 'Regras editáveis em Questões → Relações';
    $('mfRelationValue').textContent=job ? `${job.event_id} · ${job.status==='running'?'Consultando…':job.status==='skipped'?'Sem eventos anteriores':job.status==='error'?'Erro de execução':job.status==='interrupted'?'Interrompido':job.status==='queued'?'Na fila':audit.positive.length+' true · '+audit.negative.length+' false'}` : 'Uma questão por evento anterior';
    const filterTone=R.combinedTone(audit?.pairs.map(pair=>pair.filterTone)||[]);
    const responseTone=job?.status==='running'?'active':R.combinedTone(audit?.pairs.filter(pair=>pair.candidate).map(pair=>pair.resultTone)||[]);
    $('mfNodeRelationFilter').dataset.tone=filterTone;
    $('mfNodeHasRelation').dataset.tone=responseTone;
    $('mfNodeRelationEvents').dataset.routeTone=filtered?filterTone:responseTone;
    const edgeTones={};
    if (audit) {
      if (filtered) {
        edgeTones.relation_filter=filterTone;
        if (audit.approved.length) edgeTones.relation_candidates=R.combinedTone(audit.approved.map(pair=>pair.filterTone));
        if (audit.rejected.length) edgeTones.relation_rejected=R.combinedTone(audit.rejected.map(pair=>pair.filterTone));
      }
      if (job.parts.length) edgeTones.relation_call=responseTone;
      if (audit.positive.length) edgeTones.relation_store=R.combinedTone(audit.positive.map(pair=>pair.resultTone));
      if (audit.negative.length) edgeTones.relation_false=R.combinedTone(audit.negative.map(pair=>pair.resultTone));
    }
    $('mfScene').dataset.relationEdgeTones=JSON.stringify(edgeTones);
    $('mfScene').dataset.relationPath=JSON.stringify(Object.keys(edgeTones));
  }
  function relationPairDetails(audit,pair,stage) {
    const filter=stage==='approved'||stage==='rejected', target=pair.target;
    const expected=filter?pair.expectedCandidate:pair.expectedRelation, obtained=filter?pair.candidate:pair.obtained;
    const matched=filter?pair.filterMatches:pair.matches, tone=pairTone(pair,stage);
    const row=node('details','mf-answer'); row.dataset.relationTarget=target.event_id;
    rememberDisclosure(row,expandedAnswers,'relation:'+audit.current.event_id+':'+stage+':'+target.event_id);
    if (relationSelection?.targetId===target.event_id) row.open=true;
    const summary=node('summary','mf-answer-summary'), key=node('span','mf-answer-key',filter?'candidate__'+target.event_id:'has_relation__'+target.event_id);
    const verdict=node('span','mf-answer-verdict',relationToneText[tone] || (obtained===null?'Sem resposta':'Não avaliado'));
    verdict.dataset.tone=tone; verdict.dataset.relationVerdict=filter?'filter':'response'; key.append(verdict);
    for (const [label,value,actual] of [['Esperado: ',expected,false],['Obtido: ',obtained,true]]) {
      const comparison=node('span','mf-answer-comparison'), line=node('span','mf-answer-value-line');
      const val=node('strong','mf-answer-value',value===null?(actual?'Não consultado':'Não informado'):String(value));
      val.dataset.tone=matched===null?'':matched?'pass':'fail'; line.append(node('span','mf-answer-label',label),val);
      const note=node('span',actual?'mf-answer-confidence':'mf-answer-minimum',filter?(actual?'Filtro determinístico':pair.expectedCandidateSource==='rule'?'Pela regra configurada':'Gabarito do lote'):actual?'Confiança '+percent(pair.probability):'Confiança > '+percent(R.threshold));
      if (!filter && pair.probability!==null) note.dataset.tone=pair.lowConfidence?'warning':'pass';
      note.title=filter?'Este filtro não usa IA; não há probabilidade a inventar.':'P(resposta obtida). false usa 1 − P(true). Relações só são guardadas com P(true) > 80%.';
      comparison.append(line,note); summary.append(comparison);
    }
    summary.prepend(key); row.append(summary);
    const content=node('div','mf-answer-content');
    content.append(node('p','mf-answer-instructions',target.event_id+' · '+target.type+' · '+target.status),node('span','mf-input-label','Input · current_utterance'),node('p','mf-inspector-text',target.text));
    if (filter) {
      const rules=run.relation_worker.config.candidate_rules[audit.current.type] || [];
      content.append(node('p','mf-answer-note','Regra para '+audit.current.type+': '+(rules.length?rules.map(rule=>rule.type+'/'+rule.status).join(', '):'nenhuma. Todos os anteriores são recusados.')));
      content.append(node('p','mf-answer-note','Esperado pela regra: '+pair.ruleExpected+' · Selecionado pelo filtro: '+pair.candidate));
      if (pair.expectedRelation!==null) content.append(node('p',pair.blocked?'mf-execution-error':'mf-answer-note','has_relation esperado: '+pair.expectedRelation+(pair.blocked?' · Relação esperada bloqueada pelo filtro; Jev não foi consultado.':'')));
    } else {
      const template=run.relation_worker.config.questions.has_relation;
      content.append(node('p','mf-answer-instructions',template.instructions.replaceAll('{{candidate_id}}',target.event_id)));
      if (pair.obtained!==null) {
        content.append(node('p','mf-answer-note',pair.retained?'Relação retida em relations.':'Não passa pelo corte P(true) > 80%; não foi guardada em relations.'));
        for (const [value,p] of [['false',1-pair.probabilityTrue],['true',pair.probabilityTrue]]) {
          const option=node('div','mf-distribution-option'); option.dataset.boolean=value;
          const head=node('div','mf-distribution-heading'); head.append(node('span','mf-distribution-name',value),probabilityIndicator(p));
          option.append(head,node('p','mf-criterion',(template.criteria?.[value] || '').replaceAll('{{candidate_id}}',target.event_id))); content.append(option);
        }
      } else content.append(node('p',pair.part?.status==='error'?'mf-execution-error':'mf-answer-note',pair.part?.error || (pair.candidate?'Ainda sem resposta; não equivale a false.':'Não consultado: recusado pelo filtro.')));
    }
    if (pair.part) {
      const raw=node('details','mf-answer-raw'),pre=jsonBlock(pair.part);
      raw.append(node('summary','','JSON da chamada e resposta')); raw.append(pre);
      rememberDisclosure(raw,expandedRaw,'relation:'+audit.current.event_id+':'+target.event_id);content.append(raw);
    }
    row.append(content);return row;
  }
  function relationDetails(panel,standalone=false) {
    if(!legacyRelations())return threadDetails(panel);
    const job=relationJob(), audit=auditFor(job);
    const event=run?.meeting_events.find(event=>event.chunk_id===selected);if (!event) return;
    const section=node('section','mf-relation-results');section.id='mfRelationDetails';
    section.append(node('h3','',`Relações · ${event.event_id} → candidatos anteriores`));
    if (!audit) { section.append(node('p','','Worker não executado neste snapshot.')); panel.append(section);return; }
    const requestedStage=standalone?relationSelection.stage:'overview';
    const stage=!audit.filtered && ['approved','rejected'].includes(requestedStage)?'overview':requestedStage, tabs=node('nav','mf-relation-tabs');tabs.setAttribute('aria-label','Etapa do evento');
    for (const [key,label] of Object.entries(relationStages)) {
      if (!audit.filtered && ['approved','rejected'].includes(key)) continue;
      const button=node('button','',label+(key==='overview'?'':' ('+audit[key].length+')'));button.type='button';button.setAttribute('aria-pressed',String(stage===key));button.addEventListener('click',()=>selectRelation(event.event_id,key));tabs.append(button);
    }
    section.append(tabs);
    if (stage==='overview') {
      section.append(node('p','',`${audit.filtered?audit.approved.length+' aprovados · '+audit.rejected.length+' recusados':audit.pairs.length+' eventos anteriores'} · ${audit.positive.length} true · ${audit.negative.length} false · ${audit.pending.length} sem resposta`));
      for (const pair of audit.pairs.filter(pair=>pair.candidate || pair.blocked)) section.append(relationPairDetails(audit,pair,'overview'));
    } else {
      if (!audit[stage].length) section.append(node('p','','Nenhum evento neste grupo.'));
      for (const pair of audit[stage]) section.append(relationPairDetails(audit,pair,stage));
    }
    if (job.error) section.append(node('p','mf-execution-error',job.error));
    if (audit.pending.some(pair=>pair.part?.status==='error')) section.append(node('p','mf-execution-error','Há consultas com erro. Veja Evento → candidatos sem resposta; nenhum erro é tratado como false.'));
    panel.append(section);
  }
  function renderMemories() {
    const events = run?.meeting_events || [], recent = run?.raw_window || [];
    if (memoryRunIdentity !== (run?.createdAt || '')) {
      memoryRunIdentity = run?.createdAt || ''; memorySelection = '';
      $('mfMeetingEvents').replaceChildren(); $('mfRawWindow').replaceChildren();
    }
    $('mfEventsCount').textContent = events.length;
    $('mfRawCount').textContent = recent.length + '/' + rawLimit();
    function fill(list, entries, isEvents) {
      const existing = new Map([...list.querySelectorAll('[data-memory-chunk]')].map(button => [button.dataset.memoryChunk, button]));
      let reveal = null;
      list.querySelector('.mf-empty')?.remove();
      for (const item of entries) {
        let button = existing.get(item.chunk_id); existing.delete(item.chunk_id);
        const added = !button;
        if (!button) {
          const li = node('li', 'mf-memory-row'); button = node('button', 'mf-memory-item'); button.type = 'button';
          const detail = node('div', 'mf-memory-detail'); detail.id = list.id + '-detail-' + typeId(item.chunk_id); detail.hidden = true;
          button.dataset.memoryChunk = item.chunk_id;
          button.setAttribute('aria-controls', detail.id); button.setAttribute('aria-expanded', 'false');
          button.addEventListener('click', () => {
            detail.hidden = !detail.hidden; button.setAttribute('aria-expanded', String(!detail.hidden));
            select(item.chunk_id);
          });
          li.append(button, detail); list.append(li);
        }
        const detail = button.nextElementSibling;
        const signature = JSON.stringify(item);
        if (button.dataset.signature !== signature) {
          button.dataset.signature = signature; button.replaceChildren(); detail.replaceChildren();
          const heading = node('span', 'mf-memory-heading');
          if (isEvents) { button.dataset.eventId = item.event_id; heading.append(node('strong', '', item.event_id)); }
          heading.append(node('span', '', item.chunk_id));
          if (isEvents) { heading.append(node('span', 'mf-memory-type', item.type));if(Object.hasOwn(item,'thread_id'))heading.append(node('span','',item.thread_id || 'pendente')); }
          heading.append(node('span', 'mf-memory-status'));
          const preview = node('span', 'mf-memory-preview');
          preview.append(node('span', 'mf-memory-preview-label', 'Input: '), document.createTextNode(item.text));
          button.append(heading, preview);
          detail.append(node('span', 'mf-input-label', 'Input · current_utterance'), node('p', 'mf-memory-text', item.text));
          const metadata = node('dl', 'mf-memory-metadata');
          for (const key of isEvents ? ['event_id','chunk_id','timestamp','type','status','thread_id',...(Object.hasOwn(item,'thread_assignment_state')?['thread_assignment_state']:[])] : ['chunk_id','timestamp']) {
            const value = node('dd', '', item[key] ?? 'pendente');
            value.title = String(item[key]); metadata.append(node('dt', '', key), value);
          }
          detail.append(metadata, copyButton('Copiar JSON',()=>JSON.stringify(item,null,2)), node('span', 'mf-verdict'));
          button.title = item.chunk_id + ' · ' + item.timestamp + ' · Clique para expandir os detalhes';
        }
        const record = recordFor(item.chunk_id), tone = toneFor(record), active = item.chunk_id === selected;
        button.dataset.tone = tone; button.classList.toggle('is-selected', active);
        button.classList.toggle('is-current', record?.status === 'running');
        button.setAttribute('aria-current', String(active));
        const status = tones[tone] || (record?.status === 'running' ? 'Classificando…' : record?.status === 'queued' ? 'Na fila' : 'Recebido');
        const marker = button.querySelector('.mf-memory-status'); marker.dataset.tone = tone;
        marker.textContent = ({pass:'✓',fail:'×',error:'×',warning:'!'})[tone] || '…';
        marker.setAttribute('aria-label', status); marker.title = status;
        const verdict = detail.querySelector('.mf-verdict'); verdict.dataset.tone = tone; verdict.textContent = status;
        if (active && (memorySelection !== selected || added && follow)) reveal = button;
      }
      for (const button of existing.values()) button.parentElement.remove();
      if (!entries.length) list.append(node('li', 'mf-empty', isEvents ? 'Nenhum evento armazenado.' : 'Aguardando chunks.'));
      if (reveal && (isEvents || !events.some(event=>event.chunk_id===selected))) requestAnimationFrame(() => {
        if (!reveal.isConnected || reveal.dataset.memoryChunk !== selected || !list.clientHeight) return;
        // Collections share one natural-flow scroll container.
        const sidebar=$('mfMemories'),card=reveal.getBoundingClientRect(),bounds=sidebar.getBoundingClientRect();
        if(card.top<bounds.top)sidebar.scrollTop+=card.top-bounds.top;
        else if(card.bottom>bounds.bottom)sidebar.scrollTop+=card.bottom-bounds.bottom;
      });
    }
    fill($('mfMeetingEvents'), events, true); fill($('mfRawWindow'), recent, false);
    renderThreadCollection($('mfMemoryThreads'),true);
    $('mfMemoryThreadsCount').textContent=run?.meeting_threads?.length || 0;
    if ($('mfMemories').offsetHeight) memorySelection = selected || '';
  }
  function pathFor(record) {
    if (!record || record.status === 'queued' || !record.storeOutput && !record.processingStartedAt && record.stage === 'queued') return [];
    const path = ['input'];
    if (record.storeOutput && !E.predicted(record.storeOutput.response.answers.should_store_memory)) path.push('no');
    else if (record.typeStartedAt || record.typeOutput || record.status === 'running' && record.stage === 'type') path.push('yes');
    if (record.result?.store) path.push(categoryKey(record.result.type), memoryEdgeKey(record.result.type));
    return path;
  }
  function diagram() {
    const item = batch?.cases.find(item => item.id === selected), record = recordFor(selected), result = record?.result;
    $('mfViewing').textContent = item ? `${item.id} · ${record?.status === 'running' ? 'ao vivo' : record?.status === 'queued' ? 'recebido · na fila' : record ? 'caminho percorrido' : 'ainda não executado'}` : 'Caminho do chunk';
    const gate = record?.storeOutput?.response.answers.should_store_memory, type = record?.typeOutput?.response.answers.event_type;
    $('mfStoreValue').textContent = gate ? `${E.predicted(gate)} · ${percent(E.probabilityOf(gate, E.predicted(gate)))}` : record?.stage === 'store' && busy ? 'Consultando…' : 'Guardar na memória?';
    $('mfTypeValue').textContent = type ? `${type.choice} · ${percent(type.probabilities[type.choice])}` : gate && !E.predicted(gate) ? 'Não consultado' : record?.stage === 'type' && record.status === 'running' ? 'Consultando…' : 'Somente se guardar';
    const reached = new Set(pathFor(record).length ? ['mfNodeStore'] : []);
    if (gate && !E.predicted(gate)) reached.add('mfNodeIgnore');
    else if (pathFor(record).includes('yes')) reached.add('mfNodeType');
    if (result?.store) reached.add('mfNode-' + typeId(result.type));
    const tone = toneFor(record);
    for (const n of $('mfScene').querySelectorAll('.mf-node')) n.dataset.tone = reached.has(n.id) ? tone : '';
    $('mfNodeChunk').dataset.routeTone = record ? tone : '';
    $('mfScene').dataset.path = JSON.stringify(pathFor(record)); $('mfScene').dataset.tone = tone;
    $('mfScene').dataset.delivering = busy && record?.status === 'done' && processingRecord()?.id === selected ? memoryEdgeKey(result?.type) : '';
    scheduleCanvasLayout();
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function scheduleCanvasLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; layoutCanvas(); });
  }
  function layoutCanvas() {
    if ($('memoryPage').hidden || $('mfCanvas').hidden) return;
    const canvas = $('mfCanvas'), stage = $('mfStage'), scene = $('mfScene');
    // CSS zoom reflows intrinsic sizes. Keep a natural-size grid and scale it only
    // for painting, inside a stage with explicit scroll bounds. The viewport is
    // independent from that stage, so fitting cannot toggle its own scrollbars.
    canvas.dataset.fit = String(autoFit);
    const types = currentTypes();
    // Keep room for the gate/Ignore branch even with only two destinations.
    scene.style.setProperty('--mf-gate-row', types.length < 7 ? '1 / 3' : '2 / 4');
    scene.style.setProperty('--mf-ignore-row', types.length < 7 ? '3 / 5' : '5 / 8');
    const rows = Array.from({ length: Math.max(4, types.length) }, (_, index) =>
      index < types.length ? queueHeight(categoryKey(types[index])) : queueCollapsedHeight);
    // Ignore is independently resizable even when the adjacent categories are
    // collapsed. Reserve its actual height instead of clipping it to their rows.
    const ignoreStart = types.length < 7 ? 2 : 4, ignoreEnd = types.length < 7 ? 4 : 7;
    const gap = parseFloat(getComputedStyle(scene).rowGap) || 12;
    const available = rows.slice(ignoreStart, ignoreEnd).reduce((sum, height) => sum + height, 0) + gap * (ignoreEnd-ignoreStart-1);
    rows[ignoreEnd-1] += Math.max(0, queueHeight('ignore') - available);
    // Stream nodes share the gate's center, but their independent heights must
    // not clip above/below the grid or stretch the compact category rows.
    const gateStart = types.length < 7 ? 0 : 1, gateEnd = types.length < 7 ? 2 : 3;
    const gateCenter = rows.slice(0,gateStart).reduce((sum,h) => sum+h,0) + gap*gateStart
      + (rows.slice(gateStart,gateEnd).reduce((sum,h) => sum+h,0) + gap*(gateEnd-gateStart-1))/2;
    const streamHeight = Math.max(queueHeight('stream:raw_window'),queueHeight('stream:meeting_events'));
    const contentHeight = rows.reduce((sum,h) => sum+h,0) + gap*(rows.length-1);
    scene.style.paddingTop = Math.max(20,20+streamHeight/2-gateCenter) + 'px';
    scene.style.paddingBottom = Math.max(20,20+gateCenter+streamHeight/2-contentHeight) + 'px';
    sizeQueues();
    const filtered=R.isFiltered(run?.relation_worker);
    const relationTop=Math.max(120,filtered?queueHeight('stream:relation_candidates'):0,queueHeight('stream:relations'));
    const relationBottom=Math.max(filtered?queueHeight('stream:relation_rejected'):0,queueHeight('stream:relation_false'),queueHeight('stream:relation_events')-relationTop-gap);
    $('mfRelationHeading').style.gridRow = String(rows.length+1);
    for (const n of $('mfScene').querySelectorAll('.mf-relation-node')) {
      n.style.gridRow=['mfNodeRelationEvents','mfNodeRelationFilter',...(!filtered?['mfNodeHasRelation']:[])].includes(n.id)?(rows.length+2)+' / '+(rows.length+4):String(rows.length+(['mfNodeRelationRejected','mfNodeRelationFalse'].includes(n.id)?3:2));
    }
    let lowerRows=[relationTop,relationBottom];
    if(!legacyRelations()) {
      const top=Math.max(140,queueHeight('stream:thread_context'),queueHeight('stream:relation_events'),queueHeight('stream:meeting_threads'),$('mfNodeThreadActive').offsetHeight,$('mfNodeThreadAssignment').offsetHeight);
      lowerRows=[top,queueHeight('stream:meeting_relations')];const start=rows.length+2;
      for(const id of ['mfNodeRelationEvents','mfNodeThreadContext','mfNodeThreadActive','mfNodeThreadAssignment','mfNodeThreads'])$(id).style.gridRow=String(start);
      $('mfNodeMeetingRelations').style.gridRow=String(start+1);
      if(isV2) {
        const relationHeight=Math.max(160,queueHeight('stream:typed_pairs'),queueHeight('stream:meeting_relations'),$('mfNodeTypedType').offsetHeight,$('mfNodeTypedMatch').offsetHeight);
        lowerRows=[top,60,relationHeight,queueHeight('stream:typed_audit')];
        $('mfTypedHeading').style.gridRow=String(start+1);
        for(const id of ['mfNodeTypedPairs','mfNodeTypedType','mfNodeTypedMatch','mfNodeMeetingRelations'])$(id).style.gridRow=String(start+2);
        $('mfNodeTypedAudit').style.gridRow=String(start+3);$('mfNodeTypedAudit').style.gridColumn='2';
      }
    }
    const template = [...rows,60,...lowerRows].map(height => height + 'px').join(' ');
    if (scene.style.gridTemplateRows !== template) scene.style.gridTemplateRows = template;
    const width = Math.max(1160, Math.floor(canvas.getBoundingClientRect().width)) + 'px';
    if (scene.style.width !== width) scene.style.width = width;
    const naturalWidth = scene.offsetWidth, naturalHeight = scene.offsetHeight;
    if (!naturalWidth || !naturalHeight || canvas.clientWidth < 5 || canvas.clientHeight < 5) return;
    if (autoFit) zoom = Math.floor(Math.min(1, (canvas.clientWidth - 4) / naturalWidth, (canvas.clientHeight - 4) / naturalHeight) * 10000) / 10000;
    const transform = `scale(${zoom})`;
    if (scene.style.transform !== transform) scene.style.transform = transform;
    const stageWidth = Math.ceil(naturalWidth * zoom) + 'px', stageHeight = Math.ceil(naturalHeight * zoom) + 'px';
    if (stage.style.width !== stageWidth) stage.style.width = stageWidth;
    if (stage.style.height !== stageHeight) stage.style.height = stageHeight;
    if (autoFit) { panX = (canvas.clientWidth - naturalWidth * zoom) / 2; panY = (canvas.clientHeight - naturalHeight * zoom) / 2; }
    stage.style.transform = `translate(${panX}px, ${panY}px)`;
    canvas.dataset.panX = String(panX); canvas.dataset.panY = String(panY);
    scene.dataset.scale = String(zoom);
    $('mfZoomValue').textContent = Math.round(zoom * 100) + '%'; $('mfFit').setAttribute('aria-pressed', String(autoFit));
    drawEdges();
  }
  function zoomAt(next, x, y) {
    const canvas = $('mfCanvas'); x ??= canvas.clientWidth / 2; y ??= canvas.clientHeight / 2;
    next = Math.max(.12, Math.min(2.5, next));
    const ratio = next / zoom;
    panX = x - (x - panX) * ratio; panY = y - (y - panY) * ratio;
    autoFit = false; zoom = next; layoutCanvas();
  }
  function drawEdges() {
    if ($('memoryPage').hidden) return;
    const scene = $('mfScene'), svg = $('mfEdges'), bounds = scene.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scale = bounds.width / scene.offsetWidth;
    const active = JSON.parse(scene.dataset.path || '[]');
    const connections = [['input','mfNodeChunk','mfNodeStore'], ['yes','mfNodeStore','mfNodeType'], ['no','mfNodeStore','mfNodeIgnore'],
      ...currentTypes().map(type => [categoryKey(type),'mfNodeType','mfNode-' + typeId(type)]),
      ...currentTypes().map(type => [memoryEdgeKey(type),'mfNode-' + typeId(type),'mfNodeMeetingEvents']),
      ...(!legacyRelations()?[
        ['thread_context','mfNodeRelationEvents','mfNodeThreadContext'],['thread_active','mfNodeThreadContext','mfNodeThreadActive'],
        ['thread_decision','mfNodeThreadActive','mfNodeThreadAssignment'],
        ['thread_save','mfNodeThreadAssignment','mfNodeThreads'],
        ...(isV2?[
          ['typed_candidates','mfNodeThreads','mfNodeTypedPairs'],['typed_type','mfNodeTypedPairs','mfNodeTypedType'],
          ['typed_match','mfNodeTypedType','mfNodeTypedMatch'],['typed_save','mfNodeTypedMatch','mfNodeMeetingRelations'],['typed_none','mfNodeTypedType','mfNodeTypedAudit']
        ]:[])
      ]:[...(R.isFiltered(run?.relation_worker)?[
        ['relation_filter','mfNodeRelationEvents','mfNodeRelationFilter'],
        ['relation_candidates','mfNodeRelationFilter','mfNodeRelationCandidates'],['relation_rejected','mfNodeRelationFilter','mfNodeRelationRejected'],
        ['relation_call','mfNodeRelationCandidates','mfNodeHasRelation']]:[['relation_call','mfNodeRelationEvents','mfNodeHasRelation']]),
      ['relation_store','mfNodeHasRelation','mfNodeRelations'],['relation_false','mfNodeHasRelation','mfNodeRelationFalse']])];
    const segments = connections.map(([id, from, to]) => {
      const a = $(from).getBoundingClientRect(), b = $(to).getBoundingClientRect(), vertical = id === 'no'||id==='typed_none'||id==='typed_candidates';
      const x1 = ((vertical ? a.left + a.width / 2 : a.right) - bounds.left) / scale, y1 = ((vertical ? a.bottom : a.top + a.height / 2) - bounds.top) / scale;
      const x2 = ((vertical ? b.left + b.width / 2 : b.left) - bounds.left) / scale, y2 = ((vertical ? b.top : b.top + b.height / 2) - bounds.top) / scale;
      let route=null,label=null;
      if(id==='typed_candidates') {
        const lane=(a.bottom-bounds.top)/scale+26;
        route=`M${x1},${y1} L${x1},${lane} L${x2},${lane} L${x2},${y2}`;
      }

      return { id, vertical, x1, y1, x2, y2, route, label };
    });
    const relationEdgeTones = {...JSON.parse(scene.dataset.relationEdgeTones || '{}'),...JSON.parse(scene.dataset.typedEdgeTones || '{}')};
    const gatedThreads=run?.thread_worker?.schemaVersion!==1;
    const key = JSON.stringify([scene.offsetWidth, scene.offsetHeight, active, scene.dataset.tone, relationEdgeTones, scene.dataset.delivering, gatedThreads, matchMedia('(prefers-reduced-motion: reduce)').matches,
      segments.map(s => [s.id,s.route,s.label,...[s.x1, s.y1, s.x2, s.y2].map(n => Math.round(n * 100) / 100)])]);
    if (key === edgesKey) return;
    edgesKey = key;
    svg.setAttribute('viewBox', `0 0 ${scene.offsetWidth} ${scene.offsetHeight}`);
    svg.querySelector('g')?.remove(); const group = document.createElementNS(svgNS, 'g'); svg.append(group);
    for (const { id, vertical, x1, y1, x2, y2, route, label:routeLabel } of segments) {
      const path = document.createElementNS(svgNS, 'path'); path.dataset.edge = id.startsWith('type:') ? id.slice(5) : id;
      path.dataset.connection = id;
      if (id.startsWith('type:') || id.startsWith('memory:')) path.dataset.category = id.slice(id.indexOf(':')+1);
      path.setAttribute('d', route || (vertical ? `M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}` : `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`));
      path.setAttribute('class', 'mf-edge'); path.setAttribute('marker-end','url(#mfArrow)');
      path.dataset.tone = id.startsWith('relation_') || id.startsWith('thread_') || id.startsWith('typed_') ? relationEdgeTones[id] || '' : active.includes(id) ? scene.dataset.tone : ''; group.append(path);
      const delivering = id === scene.dataset.delivering && active.includes(id);
      if ((path.dataset.tone === 'active' || delivering) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const packet = document.createElementNS(svgNS, 'circle'), motion = document.createElementNS(svgNS, 'animateMotion');
        packet.setAttribute('r', '3.5'); packet.setAttribute('fill', delivering ? ({pass:'#5adab2',fail:'#ff8497',warning:'#e6c061'})[scene.dataset.tone] || '#b3ddff' : '#b3ddff');
        motion.setAttribute('path', path.getAttribute('d')); motion.setAttribute('dur', delivering ? '.4s' : '.55s'); motion.setAttribute('repeatCount', delivering ? '1' : 'indefinite'); motion.setAttribute('fill', 'freeze');
        packet.append(motion); group.append(packet);
      }
      const labels={yes:'true',no:'false',relation_store:'true',relation_false:'false',typed_match:'≠ none',typed_none:'none / sem resposta'};
      if (routeLabel || Object.hasOwn(labels,id)) {
        const label = document.createElementNS(svgNS, 'text'); label.textContent = routeLabel?.text || labels[id];
        label.setAttribute('x', routeLabel?.x ?? x1 + 8); label.setAttribute('y', routeLabel?.y ?? (vertical ? (y1+y2)/2 : y1-10));
        label.setAttribute('text-anchor', routeLabel?.anchor || (routeLabel?'middle':'start')); label.setAttribute('class', 'mf-edge-label'); group.append(label);
      }
    }
  }
  function chunkMetadata(id, record) {
    return `chunk_id: ${id}\ntype: ${record?.result?.type ?? 'null'}\ntimestamp: ${record?.timestamp || '—'}`;
  }
  function rememberDisclosure(details, keys, id) {
    details.open = keys.has(id);
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      details.open ? keys.add(id) : keys.delete(id);
      $('mfInspector').closest('.mf-main').classList.toggle('has-expanded-answer', expandedAnswers.size > 0);
    });
  }
  function probabilityIndicator(probability) {
    const group = node('span', 'mf-probability'), ring = node('span', 'mf-probability-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.setProperty('--probability', String(probability ?? 0));
    group.append(node('span', '', percent(probability)), ring);
    group.title = probability == null ? 'Ainda sem resposta' : 'Probabilidade desta resposta: ' + percent(probability);
    return group;
  }
  function answerDetails(id, item, record) {
    const isGate = id === 'should_store_memory', q = (run?.questions || questionSet)[id];
    const output = isGate ? record?.storeOutput : record?.typeOutput, answer = output?.response.answers[id];
    const gate = record?.storeOutput?.response.answers.should_store_memory;
    const skipped = !isGate && gate && !E.predicted(gate);
    const expected = isGate ? item.expected_store_memory : item.expected_event_type;
    const applicable = isGate || item.expected_store_memory;
    const obtained = answer ? E.predicted(answer) : null;
    const probability = answer ? E.probabilityOf(answer, obtained) : null;
    const threshold = run?.threshold ?? .8;
    const low = applicable && probability !== null && probability + 1e-12 < threshold;
    const matched = answer && applicable ? obtained === expected : null;
    let validation = 'Aguardando', tone = '';
    if (!applicable) validation = 'Não se aplica';
    else if (answer) { validation = matched ? '✓ Resposta correta' : isGate ? '× Filtro divergente' : '× Tipo divergente'; tone = matched ? 'pass' : 'fail'; }
    else if (skipped) { validation = 'Não passou pelo filtro'; tone = 'fail'; }
    else if (record?.status === 'error') { validation = 'Erro de execução'; tone = 'error'; }
    else if (record?.status === 'interrupted') validation = 'Interrompido';
    const row = node('details', 'mf-answer'); row.dataset.question = id;
    rememberDisclosure(row, expandedAnswers, id);
    const summary = node('summary', 'mf-answer-summary'), key = node('span', 'mf-answer-key', id);
    const wanted = node('span', 'mf-answer-comparison'), actual = node('span', 'mf-answer-comparison');
    const verdict = node('span', 'mf-answer-verdict', validation); verdict.dataset.tone = tone; if (tone) verdict.tabIndex = 0;
    key.append(verdict);
    const wantedLine = node('span', 'mf-answer-value-line'), actualLine = node('span', 'mf-answer-value-line');
    const wantedValue = node('strong', 'mf-answer-value', applicable ? String(expected) : 'Não validar');
    const actualValue = node('strong', 'mf-answer-value', answer ? String(obtained) : skipped ? 'Não consultado' : '—');
    wantedValue.dataset.tone = actualValue.dataset.tone = matched === null ? '' : matched ? 'pass' : 'fail';
    wantedLine.append(node('span', 'mf-answer-label', 'Esperado: '), wantedValue);
    actualLine.append(node('span', 'mf-answer-label', 'Obtido: '), actualValue);
    const minimum = node('span', 'mf-answer-minimum', applicable ? 'Confiança ≥ ' + percent(threshold) : 'Confiança: não validar');
    const confidence = node('span', 'mf-answer-confidence', 'Confiança ' + percent(probability));
    const confidenceTone = !applicable || probability === null ? '' : low ? 'warning' : 'pass';
    minimum.dataset.tone = confidence.dataset.tone = confidenceTone;
    minimum.title = 'Requisito mínimo de probabilidade para a resposta obtida.';
    confidence.title = probability === null ? 'Ainda sem resposta' : `Probabilidade da resposta obtida; mínimo exigido: ${percent(threshold)}. Avaliada separadamente do acerto da resposta.`;
    if (confidenceTone) confidence.tabIndex = 0;
    wanted.append(wantedLine, minimum); actual.append(actualLine, confidence);
    summary.append(key, wanted, actual); row.append(summary);
    const content = node('div', 'mf-answer-content');
    content.append(node('p', 'mf-answer-instructions', q.instructions));
    if (!answer) {
      const message = skipped ? 'Não consultado: o filtro respondeu false.' : record?.error || (record?.status === 'queued' ? 'Recebido, aguardando na fila de processamento.' : record?.status === 'running' ? 'Aguardando resposta.' : 'Ainda sem resposta.');
      content.append(node('p', 'mf-answer-note', message));
    }
    // No invented zeroes for questions that have not been called.
    const entries = isGate ? [['false', q.criteria?.false || 'false'], ['true', q.criteria?.true || 'true']] : Object.entries(q.criteria);
    const probabilityOf = value => !answer ? null : isGate ? value === 'true' ? answer.noul : 1 - answer.noul : answer.probabilities[value];
    if (!isGate && answer) entries.sort((a,b) => probabilityOf(b[0]) - probabilityOf(a[0]));
    const distribution = node('div', 'mf-distribution');
    distribution.setAttribute('aria-label', 'Probabilidades das respostas');
    for (const [value, description] of entries) {
      const option = node(isGate ? 'div' : 'details', 'mf-distribution-option'); option.dataset.value = value;
      option.classList.toggle('is-obtained', !!answer && String(obtained) === value);
      if (isGate) option.dataset.boolean = value;
      const heading = node(isGate ? 'div' : 'summary', 'mf-distribution-heading');
      heading.append(node('span', 'mf-distribution-name', value), probabilityIndicator(probabilityOf(value)));
      const criterion = node('p', 'mf-criterion', description);
      option.append(heading, criterion);
      if (!isGate) { heading.title = description; rememberDisclosure(option, expandedCriteria, id + ':' + value); }
      distribution.append(option);
    }
    content.append(distribution);
    if (answer) {
      if (answer.confidence !== undefined) {
        const apiConfidence = node('p', 'mf-answer-note', 'Confidence (API): ' + percent(answer.confidence));
        apiConfidence.title = 'Campo confidence da API; diferente da probabilidade da classe obtida exibida acima.';
        content.append(apiConfidence);
      }
      const raw = node('details', 'mf-answer-raw'), pre = jsonBlock(output);
      rememberDisclosure(raw, expandedRaw, id);
      raw.append(node('summary', '', 'JSON da chamada e resposta'), node('p', 'mf-answer-note', `Modelo: ${output.response.model} · ${E.seconds(output.latencyMs)} · ${run?.questionVersion || questionVersion}`), pre);
      content.append(raw);
    }
    row.append(content); return row;
  }
  function inspect() {
    const item = batch?.cases.find(item => item.id === selected), record = recordFor(selected);
    const typedJob=run?.typed_relation_worker?.jobs.find(job=>job.chunk_id===selected);
    const signature = JSON.stringify([item, record, busy, run?.questions || questionSet,relationJob(),relationSelection,typedJob,typedSelection]); if (signature === inspectorKey) return; inspectorKey = signature;
    const panel = $('mfInspector'), view=relationSelection?JSON.stringify(relationSelection):selected, scroll = panel.dataset.view === view ? panel.scrollTop : 0;
    panel.dataset.view=view || '';
    panel.replaceChildren(); panel.dataset.chunk = selected || '';
    panel.closest('.mf-main').classList.toggle('has-expanded-answer', !!item && expandedAnswers.size > 0);
    if (!item) { panel.append(node('p', 'mf-empty', 'Selecione um chunk para inspecionar o caminho e comparar as respostas.')); return; }
    if(typedSelection&&typedUI) {
      const header=node('header');header.append(node('strong','',typedSelection.eventId+' → '+typedSelection.targetId));
      const back=node('button','','Ver chunk '+item.id);back.type='button';back.addEventListener('click',()=>select(item.id));header.append(back);panel.append(header,node('p','mf-inspector-text',item.current_utterance));
      typedUI.inspect({run,panel,eventId:typedSelection.eventId,targetId:typedSelection.targetId,jsonBlock});panel.scrollTop=scroll;return;
    }
    if (relationSelection) {
      const event=run?.meeting_events.find(event=>event.event_id===relationSelection.eventId);
      if (event) {
        const header=node('header');header.append(node('strong','',event.event_id+' · '+event.type+' · '+event.status));
        const back=node('button','','Ver chunk '+event.chunk_id);back.type='button';back.addEventListener('click',()=>select(event.chunk_id));
        const hide=node('button','mf-panel-toggle');hide.type='button';hide.dataset.panelToggle='inspectorHidden';decoratePanelToggle(hide);
        header.append(back,hide);panel.append(header,node('span','mf-input-label','Input · current_utterance'),node('p','mf-inspector-text',event.text));
        relationDetails(panel,true);panel.scrollTop=scroll;return;
      }
    }
    const header = node('header'), title = node('strong', '', item.id), badge = node('span', 'mf-verdict');
    title.title = chunkMetadata(item.id, record); title.tabIndex = 0;
    badge.dataset.tone = toneFor(record); badge.textContent = tones[toneFor(record)] || (record?.status === 'queued' ? 'Na fila' : record ? 'Em execução' : 'Aguardando');
    badge.tabIndex = 0;
    const edit = node('button', '', 'Editar input'); edit.type = 'button'; edit.disabled = busy;
    edit.addEventListener('click', () => { if (busy) return; $('mfUtteranceEdit').value = item.current_utterance; $('mfUtteranceError').textContent = ''; openMemoryDialog('mfInputEditDialog'); });
    const hide = node('button', 'mf-panel-toggle'); hide.type = 'button'; hide.dataset.panelToggle = 'inspectorHidden'; decoratePanelToggle(hide);
    header.append(title, badge, edit, hide); panel.append(header, node('span', 'mf-input-label', 'Input · current_utterance'), node('p', 'mf-inspector-text', item.current_utterance));
    for (const id of ['should_store_memory', 'event_type']) panel.append(answerDetails(id, item, record));
    if (record?.error) panel.append(node('p', 'mf-execution-error', record.error + ' Nenhum evento foi adicionado a meeting_events.'));
    relationDetails(panel);
    if(typedJob&&typedUI)typedUI.inspect({run,panel,eventId:typedJob.event_id,jsonBlock});
    panel.scrollTop = scroll;
  }
  const batchLabel = value => /^B\d+$/i.test(value) ? 'B' + String(Number(value.slice(1))).padStart(3, '0') : value.replace(/\s+/g, '_');
  const testLabel = test => test.id + '_' + batchLabel(test.batch.batch_id);
  function stat(text, tone = '') {
    const span = node('span', 'mf-stat', text); span.dataset.tone = tone;
    if (tone) span.tabIndex = 0;
    return span;
  }
  function resultStats(host, testRun) {
    const correct = testRun.records.filter(r => r.result?.correct).length;
    const divergent = testRun.records.filter(r => r.result && !r.result.correct).length;
    const errors = testRun.records.filter(r => r.status === 'error').length;
    host.append(stat(correct + ' corretos', 'pass'), stat(divergent + ' divergentes', divergent ? 'fail' : ''));
    if (errors) host.append(stat(errors + (errors === 1 ? ' erro de execução' : ' erros de execução'), 'error'));
    if(testRun.thread_worker) {
      const audits=testRun.thread_worker.jobs.map(job=>T.audit(testRun,job)),right=audits.filter(a=>a.matches===true).length,wrong=audits.filter(a=>a.matches===false).length;
      host.append(stat('Threads:'),stat(right+' corretas','pass'),stat(wrong+' divergentes',wrong?'fail':''));
      const failed=audits.filter(a=>a.tone==='error').length;if(failed)host.append(stat(failed+' erros','error'));
    }
    if(testRun.typed_relation_worker&&typedUI) {
      const values=typedUI.stats(testRun);host.append(stat('Relações:'),stat(values.right+' corretas',values.right?'pass':''),stat(values.wrong+' divergentes',values.wrong?'fail':''));
      if(values.unscored)host.append(stat(values.unscored+' sem gabarito'));
      if(values.missing)host.append(stat(values.missing+' gabaritos não processados','warning'));
      if(values.review)host.append(stat(values.review+' para revisar','warning'));
      if(values.errors)host.append(stat(values.errors+' erros','error'));
    }
  }
  function render() {
    controls(); $('mfBatchName').textContent = batch ? (savedId ? savedId + '_' : '') + batchLabel(batch.batch_id) : 'Nenhum lote';
    const completed = run?.records.filter(record => record.status === 'done').length || 0;
    const errors = run?.records.filter(record => record.status === 'error').length || 0;
    const progress = $('mfProgress'); progress.replaceChildren();
    if (run) {
      progress.append(stat(`${completed+errors}/${batch.cases.length} processados`)); resultStats(progress, run);
      progress.append(stat(`${run.calls} chamadas`));
      const queued = run.records.filter(record => record.status === 'queued').length;
      if (queued) progress.append(stat(`${queued} na fila`));
      if (['stopped','interrupted'].includes(run.status)) progress.append(stat('Interrompido'));
    } else progress.textContent = batch ? `${batch.cases.length} chunks` : 'Cole um JSON para começar';
    renderChunks(); renderQueues(); renderMemories(); diagram(); renderRelations(); inspect(); renderHistory(); relationMap?.render(run);
    if (tooltipTarget && !tooltipTarget.isConnected) hideVerdictTooltip();
  }
  function renderHistory() {
    $('mfHistory').hidden = !historyOpen; $('mfHistoryToggle').setAttribute('aria-expanded', String(historyOpen));
    $('mfHistoryDivider').hidden = !historyOpen; $('memoryPage').classList.toggle('has-history', historyOpen);
    const body = $('mfTestRows'); body.replaceChildren();
    for (const test of [...library.tests].reverse()) {
      const row = node('tr'); row.dataset.savedTest = test.id; row.classList.toggle('is-selected', test.id === savedId);
      row.tabIndex = busy ? -1 : 0; row.setAttribute('aria-label', 'Abrir ' + testLabel(test)); row.setAttribute('aria-disabled', String(busy));
      row.addEventListener('click', () => openTest(test.id));
      row.addEventListener('keydown', event => { if (event.target === row && ['Enter',' '].includes(event.key)) { event.preventDefault(); openTest(test.id); } });
      const selection=node('td','mf-test-select'),checkbox=node('input');checkbox.type='checkbox';checkbox.dataset.selectTest=test.id;
      checkbox.checked=selectedTests.has(test.id);checkbox.disabled=busy || libraryBlocked;checkbox.setAttribute('aria-label','Selecionar '+testLabel(test));
      selection.addEventListener('click',event=>event.stopPropagation());
      checkbox.addEventListener('change',()=>{checkbox.checked?selectedTests.add(test.id):selectedTests.delete(test.id);updateHistorySelection();});
      selection.append(checkbox);row.append(selection);
      row.append(node('td', '', testLabel(test)), node('td', '', test.questionVersion+(test.threadVersion?' / '+test.threadVersion:test.relationVersion?' / '+test.relationVersion:'')+(test.typedRelationVersion?' / '+test.typedRelationVersion:'')), node('td', '', String(test.batch.cases.length)));
      const result = node('td', 'mf-result-stats');
      if (test.run) resultStats(result, test.run); else result.textContent = 'Não executado';
      row.append(result);
      const time = node('td', '', new Date(test.createdAt).toLocaleString('pt-BR')); row.append(time);
      const actions=node('td','mf-test-actions'), remove=node('button','mf-danger','Excluir');
      remove.type='button'; remove.dataset.deleteTest=test.id; remove.disabled=busy || libraryBlocked;
      remove.setAttribute('aria-label','Excluir '+testLabel(test));
      remove.addEventListener('click',event=>{event.stopPropagation();deleteSavedTest(test.id);});
      for(const format of ['json','csv']) {
        const download=node('button','','Baixar '+format.toUpperCase());download.type='button';download.dataset.exportTest=test.id;download.dataset.mfExport=format;
        download.setAttribute('aria-label','Baixar '+testLabel(test)+' em '+format.toUpperCase());
        download.addEventListener('click',event=>{event.stopPropagation();exportSavedTest(test.id,format);});actions.append(download);
      }
      actions.append(remove); row.append(actions);
      body.append(row);
    }
    if (!library.tests.length) { const row = node('tr'), cell = node('td', 'mf-empty', 'Nenhum teste salvo.'); cell.colSpan = 7; row.append(cell); body.append(row); }
    updateHistorySelection();
  }
  function updateHistorySelection() {
    const ids=new Set(library.tests.map(test=>test.id));
    for(const id of selectedTests)if(!ids.has(id))selectedTests.delete(id);
    const count=selectedTests.size,all=$('mfSelectAllTests');
    all.checked=ids.size>0 && count===ids.size;all.indeterminate=count>0 && count<ids.size;all.disabled=!ids.size || busy || libraryBlocked;
    $('mfSelectedTestsCount').textContent=count+' selecionado'+(count===1?'':'s');
    $('mfDeleteSelectedTests').disabled=!count || busy || libraryBlocked;
    for(const row of $('mfTestRows').querySelectorAll('[data-saved-test]')) {
      const checked=selectedTests.has(row.dataset.savedTest);row.classList.toggle('is-checked',checked);row.querySelector('[data-select-test]').checked=checked;
    }
  }
  const deleteSavedTest=id=>deleteSavedTests([id]);
  async function deleteSavedTests(ids) {
    if (busy || libraryBusy || libraryBlocked) return;
    const tests=library.tests.filter(test=>ids.includes(test.id));if(!tests.length)return;
    const label=tests.length===1?testLabel(tests[0]):tests.length+' testes selecionados ('+tests.map(test=>test.id).join(', ')+')';
    const choice=await askSave('Excluir '+label+' do histórico? Esta ação não pode ser desfeita. As versões de questões serão mantidas; se um teste excluído estiver aberto, seu conteúdo continuará como rascunho.',true);
    if(choice!=='discard' || busy || libraryBusy || libraryBlocked)return;
    try {
      await editLibrary(data=>{for(const test of tests)F.deleteTest(data,test.id);});
      if(tests.some(test=>test.id===savedId))savedId=null;
      for(const test of tests)selectedTests.delete(test.id);
      render();persist();notice(tests.length===1?testLabel(tests[0])+' excluído do histórico.':tests.length+' testes excluídos do histórico.');
    } catch(error){notice('Não foi possível excluir: '+error.message);}
  }
  async function openTest(id) {
    if (busy || libraryBusy) return false;
    try {
      if (pendingQuestions()) { openQuestions(); return false; }
      if (!await guardWork()) return false;
      const test = library.tests.find(t => t.id === id); if (!test) return false;
      batch = E.clone(test.batch); run = test.run ? F.restore(test.run) : null; savedId = id;
      questionVersion = test.questionVersion; questionSet = E.clone(library.versions.find(v => v.id === questionVersion).questions); questionDraft = ''; questionPending = false;
      relationVersion = test.threadVersion || '';
      relationConfig = T.validateConfig(run?.thread_worker?.config || library.threadVersions.find(v=>v.id===relationVersion)?.config || defaultThreadConfig);
      relationDraft = ''; relationPending = false;
      if (TR) {
        typedVersion = test.typedRelationVersion || '';
        typedConfig = TR.validateConfig(run?.typed_relation_worker?.config || library.typedRelationVersions?.find(v=>v.id===typedVersion)?.config || defaultTypedConfig);
        typedDraft=''; typedPending=false; typedSelection=null;
      }
      selected = batch.cases[0]?.id; relationSelection=null; follow = false; inspectorKey = ''; autoFit = true;
      $('mfBatchJSON').value = JSON.stringify(batch, null, 2); render(); persist(); return true;
    } catch (error) { notice(error.message); return false; }
  }
  async function load(value) {
    if (busy || libraryBusy) return false;
    const valid = F.validateBatch(value, questionSet); if (!await guardWork(true)) return false;
    if (storageBlocked && !window.confirm('Substituir o registro desta página que não pôde ser lido? Os outros testes não serão alterados.')) return false;
    storageBlocked = false;
    batch = valid; run = null; savedId = null; selected = batch.cases[0].id; relationSelection=null; follow = true; notice('');
    $('mfBatchJSON').value = JSON.stringify(batch, null, 2); render(); persist(); return true;
  }
  function questionTools() {
    const relations = questionWorker === 'relations', typed = questionWorker === 'typed-relations';
    $('mfRestoreQuestions').hidden=!isV2;$('mfRestoreQuestions').disabled=busy||libraryBusy;
    for(const id of ['mfChunkQuestions','mfRelationQuestions','mfTypedQuestions'])$(id).disabled=libraryBusy;
    $('mfRestoreQuestions').title='Coloca o padrão revisado desta aba no editor. Use Salvar versão para aplicá-lo; o histórico permanece preservado.';
    $('mfTypedArchitecture').hidden=!typed;
    $('mfChunkQuestions').setAttribute('aria-pressed',String(!relations&&!typed)); $('mfRelationQuestions').setAttribute('aria-pressed',String(relations)); $('mfTypedQuestions').setAttribute('aria-pressed',String(typed));
    if (typed) {
      const versions=library.typedRelationVersions || [], saved=versions.find(v=>F.stable(v.config)===F.stable(typedConfig));
      $('mfQuestionId').textContent=saved?.id || 'TRQ'+String(Math.max(0,...versions.map(v=>Number(v.id.slice(3))))+1).padStart(3,'0');
      $('mfQuestionJSON').readOnly=busy||libraryBusy;document.querySelector('[data-mf-format="mfQuestionJSON"]').disabled=busy||libraryBusy;
      $('mfSaveQuestions').disabled=busy || libraryBusy || libraryBlocked || !typedPending&&!!saved;
      $('mfSaveQuestions').textContent=questionSaveMessage&&!typedPending?'Salvo':'Salvar versão';
      $('mfQuestionStatus').textContent=busy?'Em execução':typedPending?'Alterações não salvas':questionSaveMessage || 'Relação direta → comparação condicional de configuração';
      $('mfQuestionStatus').classList.toggle('is-saved',!!questionSaveMessage&&!typedPending);return;
    }
    if (relations) {
      const saved = library.threadVersions.find(v=>F.stable(v.config)===F.stable(relationConfig));
      const label = saved?.id || 'TQ'+String(Math.max(0,...library.threadVersions.map(v=>Number(v.id.slice(2))))+1).padStart(3,'0');
      $('mfQuestionId').textContent = label;
      $('mfQuestionJSON').readOnly = busy||libraryBusy; document.querySelector('[data-mf-format="mfQuestionJSON"]').disabled = busy||libraryBusy;
      $('mfSaveQuestions').disabled = busy || libraryBusy || libraryBlocked || !relationPending && !!saved;
      $('mfSaveQuestions').textContent = questionSaveMessage && !relationPending ? 'Salvo' : 'Salvar versão';
      $('mfQuestionStatus').textContent = busy ? 'Em execução' : relationPending ? 'Alterações não salvas' : questionSaveMessage || (legacyRelations()?'Threads para a próxima execução':saved?'Versão salva':'Thread ativa + threads arquivadas');
      $('mfQuestionStatus').classList.toggle('is-saved',!!questionSaveMessage && !relationPending); return;
    }
    $('mfQuestionId').textContent = versionLabel();
    $('mfQuestionJSON').readOnly = busy||libraryBusy;
    document.querySelector('[data-mf-format="mfQuestionJSON"]').disabled = busy||libraryBusy;
    $('mfSaveQuestions').disabled = busy || libraryBusy || libraryBlocked || !questionPending && !!matchingVersion();
    $('mfSaveQuestions').textContent = questionSaveMessage && !questionPending ? 'Salvo' : 'Salvar versão';
    $('mfQuestionStatus').textContent = busy ? 'Em execução' : questionPending ? 'Alterações não salvas' : questionSaveMessage || (matchingVersion() ? 'Versão salva' : 'Ainda não salvo');
    $('mfQuestionStatus').classList.toggle('is-saved', !!questionSaveMessage && !questionPending);
  }
  const dialogBaselines = new Map();
  const dialogInputs = { mfQuestionsDialog: 'mfQuestionJSON', mfInputDialog: 'mfBatchJSON', mfInputEditDialog: 'mfUtteranceEdit' };
  function openMemoryDialog(id) {
    dialogBaselines.set(id, $(dialogInputs[id]).value); $(id).showModal();
  }
  function openQuestions() {
    if (relationPending && !questionPending) questionWorker = 'relations';
    if (typedPending && !questionPending && !relationPending) questionWorker='typed-relations';
    questionSaveMessage = '';
    $('mfQuestionJSON').value = questionEditorValue();
    $('mfQuestionError').textContent = ''; questionTools(); openMemoryDialog('mfQuestionsDialog'); editors.mfQuestionJSON.refresh();
  }
  async function saveQuestionDraft() {
    if (busy || libraryBusy) return false;
    try {
      if (questionWorker === 'typed-relations') {
        const parsed=TR.validateConfig(JSON.parse($('mfQuestionJSON').value)),changed=F.stable(parsed)!==F.stable(typedConfig);
        if(changed&&!await guardWork(true))return false;
        const version=await editLibrary(data=>F.addTypedRelationVersion(data,parsed));
        typedConfig=E.clone(version.config);typedVersion=version.id;typedDraft='';typedPending=false;
        questionSaveMessage='✓ Versão '+version.id+' salva';
        $('mfQuestionJSON').value=JSON.stringify(typedConfig,null,2);editors.mfQuestionJSON.refresh();
        if(changed)makeDraft();
        $('mfQuestionError').textContent='';dialogBaselines.set('mfQuestionsDialog',$('mfQuestionJSON').value);
        questionTools();render();persist();return true;
      }
      if (questionWorker === 'relations') {
        const parsed = T.validateConfig(JSON.parse($('mfQuestionJSON').value),relationConfig), changed = F.stable(parsed)!==F.stable(relationConfig);
        if (changed && !await guardWork(true)) return false;
        const version = await editLibrary(data=>F.addThreadVersion(data,parsed));
        relationConfig = E.clone(version.config); relationVersion = version.id; relationDraft=''; relationPending=false;
        questionSaveMessage='✓ Versão '+version.id+' salva';
        $('mfQuestionJSON').value=JSON.stringify(relationConfig,null,2); editors.mfQuestionJSON.refresh();
        if (changed) makeDraft();
        $('mfQuestionError').textContent=''; dialogBaselines.set('mfQuestionsDialog',$('mfQuestionJSON').value);
        questionTools(); render(); persist(); return true;
      }
      const parsed = F.validateQuestions(JSON.parse($('mfQuestionJSON').value)), changed = F.stable(parsed) !== F.stable(questionSet);
      if (changed && !await guardWork(true)) return false;
      const version = await editLibrary(data => F.addVersion(data, parsed));
      questionSet = E.clone(version.questions); questionVersion = version.id; questionDraft = ''; questionPending = false;
      questionSaveMessage = '✓ Versão ' + version.id + ' salva';
      if (changed) makeDraft();
      if (changed && batch) {
        try { F.validateBatch(batch, questionSet); notice(''); }
        catch (error) { notice(error.message); }
      }
      $('mfQuestionError').textContent = ''; dialogBaselines.set('mfQuestionsDialog', $('mfQuestionJSON').value);
      questionTools(); render(); persist(); return true;
    } catch (error) { $('mfQuestionError').textContent = error instanceof SyntaxError ? 'JSON incompleto. Corrija antes de salvar.' : error.message; return false; }
  }
  $('mfQuestionJSON').addEventListener('input', () => {
    if (busy||libraryBusy) return;
    questionSaveMessage = '';
    if(questionWorker==='typed-relations') {
      typedDraft=$('mfQuestionJSON').value;
      try{typedPending=F.stable(TR.validateConfig(JSON.parse(typedDraft)))!==F.stable(typedConfig);}catch(_){typedPending=true;}
      questionTools();controls();persist();return;
    }
    if (questionWorker === 'relations') {
      relationDraft = $('mfQuestionJSON').value;
      try { relationPending=F.stable(T.validateConfig(JSON.parse(relationDraft),relationConfig))!==F.stable(relationConfig); } catch (_) { relationPending=true; }
      questionTools(); controls(); persist(); return;
    }
    questionDraft = $('mfQuestionJSON').value;
    try { questionPending = F.stable(JSON.parse(questionDraft)) !== F.stable(questionSet); } catch (_) { questionPending = true; }
    questionTools(); controls(); persist();
  });
  $('mfSaveQuestions').addEventListener('click', saveQuestionDraft);
  function questionEditorValue() {
    if(questionWorker==='typed-relations')return typedPending?typedDraft:JSON.stringify(typedConfig,null,2);
    return questionWorker==='relations'?relationPending?relationDraft:JSON.stringify(relationConfig,null,2):questionPending?questionDraft:JSON.stringify(questionSet,null,2);
  }
  function switchQuestionWorker(worker) {
    if(libraryBusy)return;
    questionWorker=worker; questionSaveMessage='';
    $('mfQuestionJSON').value=questionEditorValue();
    $('mfQuestionError').textContent=''; questionTools(); editors.mfQuestionJSON.refresh();
  }
  $('mfChunkQuestions').addEventListener('click',()=>switchQuestionWorker('chunks'));
  $('mfRelationQuestions').addEventListener('click',()=>switchQuestionWorker('relations'));
  $('mfTypedQuestions').addEventListener('click',()=>switchQuestionWorker('typed-relations'));
  $('mfRestoreQuestions').addEventListener('click',()=>{
    if(!isV2||busy||libraryBusy)return;
    const defaults=questionWorker==='typed-relations'?defaultTypedConfig:questionWorker==='relations'?defaultThreadConfig:defaultQuestions;
    $('mfQuestionJSON').value=JSON.stringify(defaults,null,2);$('mfQuestionJSON').dispatchEvent(new Event('input',{bubbles:true}));editors.mfQuestionJSON.refresh();
    $('mfQuestionError').textContent='';
  });
  for (const button of document.querySelectorAll('[data-mf-format]')) button.addEventListener('click', () => {
    const input = $(button.dataset.mfFormat); if (input.readOnly) return;
    try { input.value = JSON.stringify(JSON.parse(input.value), null, 2); input.dispatchEvent(new Event('input')); editors[input.id].refresh(); }
    catch (_) { $(input.id === 'mfBatchJSON' ? 'mfInputError' : 'mfQuestionError').textContent = 'JSON inválido; confira aspas, vírgulas e chaves.'; }
  });
  async function applyUtterance() {
    if (busy || libraryBusy) return false;
    try {
      const next = E.clone(batch), item = next.cases.find(c => c.id === selected); item.current_utterance = $('mfUtteranceEdit').value; F.validateBatch(next, null);
      if (F.stable(next) !== F.stable(batch) && !await guardWork(true)) return false;
      const id = selected; makeDraft(); batch = next; selected = id; $('mfBatchJSON').value = JSON.stringify(batch, null, 2);
      inspectorKey = ''; render(); persist(); return true;
    } catch (error) { $('mfUtteranceError').textContent = error.message; return false; }
  }
  $('mfSaveUtterance').addEventListener('click', async () => { if (await applyUtterance()) $('mfInputEditDialog').close(); });
  async function applyInput() {
    try { return await load(JSON.parse($('mfBatchJSON').value)); }
    catch (error) { $('mfInputError').textContent = error instanceof SyntaxError ? 'JSON inválido. Confira aspas, vírgulas e chaves.' : error.message; return false; }
  }
  async function requestDialogClose(dialog) {
    if(libraryBusy)return;
    if (dialog.id === 'mfConfirmDialog') { finishConfirm('cancel'); return; }
    const input = $(dialogInputs[dialog.id]);
    const dirty = dialog.id === 'mfQuestionsDialog' ? pendingQuestions() : input.value !== dialogBaselines.get(dialog.id);
    if (dirty) {
      const answer = await askSave('Há alterações não salvas. Deseja salvá-las antes de fechar?');
      if (answer === 'cancel') return;
      if (answer === 'save') {
        let ok = true;
        if (dialog.id === 'mfQuestionsDialog') {
          for (const worker of ['chunks','relations',...(isV2?['typed-relations']:[])]) {
            if (worker==='chunks' ? questionPending : worker==='relations'?relationPending:typedPending) { switchQuestionWorker(worker); if (!await saveQuestionDraft()) { ok=false; break; } }
          }
        } else ok = await (dialog.id === 'mfInputDialog' ? applyInput() : applyUtterance());
        if (!ok) return;
      } else {
        input.value = dialogBaselines.get(dialog.id) || '';
        if (dialog.id === 'mfQuestionsDialog') { questionDraft = ''; questionPending = false; relationDraft=''; relationPending=false; typedDraft='';typedPending=false; controls(); }
        persist();
      }
    }
    dialog.close();
  }
  for (const dialog of document.querySelectorAll('.mf-dialog')) {
    const outside = event => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
    let downOutside = false;
    dialog.addEventListener('pointerdown', event => { downOutside = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => { if (downOutside && event.target === dialog && outside(event)) requestDialogClose(dialog); downOutside = false; });
    dialog.addEventListener('cancel', event => { event.preventDefault(); requestDialogClose(dialog); });
  }
  for (const button of document.querySelectorAll('[data-mf-confirm]')) button.addEventListener('click', () => finishConfirm(button.dataset.mfConfirm));
  $('mfSaveTest').addEventListener('click', async () => { try { await saveCurrent(); historyOpen = true; render(); persist(); } catch (error) { notice('Não foi possível salvar: ' + error.message); } });
  function exportSavedTest(id,format) {
    const test=library.tests.find(test=>test.id===id);if(!test)return;
    try {
      const report=F.exportResults({batch:test.batch,run:test.run,testId:test.id,
        questions:library.versions.find(version=>version.id===test.questionVersion)?.questions,questionVersion:test.questionVersion,
        threadConfig:library.threadVersions.find(version=>version.id===test.threadVersion)?.config,threadVersion:test.threadVersion,
        relationConfig:library.relationVersions.find(version=>version.id===test.relationVersion)?.config,relationVersion:test.relationVersion});
      const contents=format==='json'?JSON.stringify(report,null,2):F.resultsCsv(report);
      const url=URL.createObjectURL(new Blob([contents],{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}));
      const link=node('a');link.href=url;link.download=F.exportFilename(report,format);document.body.append(link);
      try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch(error){notice('Não foi possível exportar: '+error.message);}
  }
  $('mfSelectAllTests').addEventListener('change',event=>{
    selectedTests.clear();if(event.target.checked)for(const test of library.tests)selectedTests.add(test.id);updateHistorySelection();
  });
  $('mfDeleteSelectedTests').addEventListener('click',()=>deleteSavedTests([...selectedTests]));
  $('mfHistoryToggle').addEventListener('click', () => { historyOpen = !historyOpen; renderHistory(); persist(); });
  $('mfClear').addEventListener('click', async () => {
    if (busy) return;
    try {
      if (!await guardWork()) return;
      questionDraft = ''; questionPending = false;
      relationDraft=''; relationPending=false;
      typedDraft='';typedPending=false;typedSelection=null;
      batch = null; run = null; savedId = null; selected = null; relationSelection=null; follow = true; autoFit = true;
      $('mfBatchJSON').value = ''; notice(''); render(); persist();
    } catch (error) { notice(error.message); }
  });
  $('mfPaste').addEventListener('click', () => { $('mfInputError').textContent = ''; if (batch) $('mfBatchJSON').value = JSON.stringify(batch, null, 2); openMemoryDialog('mfInputDialog'); editors.mfBatchJSON.refresh(); $('mfBatchJSON').focus(); });
  $('mfQuestions').addEventListener('click', openQuestions);
  $('mfMinutes').addEventListener('click',()=>{if(!busy&&run&&window.NorteGeminiMinutes)window.NorteGeminiMinutes.open(run);});
  $('mfZoomIn').addEventListener('click', () => zoomAt(zoom * 1.2));
  $('mfZoomOut').addEventListener('click', () => zoomAt(zoom / 1.2));
  $('mfFit').addEventListener('click', () => { autoFit = true; layoutCanvas(); });
  $('mfScene').addEventListener('click', event => {
    const button = event.target.closest('[data-collapse], [data-stream-collapse]'); if (!button) return;
    const id = button.dataset.collapse || button.dataset.streamCollapse;
    // Opening a list should reveal it at the current zoom. Fit remains an
    // explicit way to see the entire graph after its footprint grows.
    if (collapsed.has(id)) autoFit = false;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    rememberQueue(id, { collapsed: collapsed.has(id) }); saveUI();
    renderQueues(); scheduleCanvasLayout(); persist();
  });
  $('mfCollapseAll').addEventListener('click', () => {
    const keys = collapseKeys(), all = keys.every(key => collapsed.has(key));
    for (const id of keys) { if (all) collapsed.delete(id); else collapsed.add(id); }
    if (all) autoFit = false;
    for (const id of keys) rememberQueue(id, { collapsed: collapsed.has(id) }); saveUI();
    renderQueues(); scheduleCanvasLayout(); persist();
  });
  $('mfCanvas').addEventListener('wheel', event => {
    if (queueDrag) { event.preventDefault(); return; }
    if (event.target.closest('.mf-queue') && !event.ctrlKey) return;
    event.preventDefault(); const rect = $('mfCanvas').getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    zoomAt(zoom * Math.exp(-Math.max(-300, Math.min(300, delta)) * .002), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  $('mfCanvas').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, .mf-queue, .mf-queue-resize')) return;
    autoFit = false; drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY };
    $('mfCanvas').setPointerCapture(event.pointerId); $('mfCanvas').classList.add('is-dragging'); event.preventDefault();
  });
  $('mfCanvas').addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    panX = drag.panX + event.clientX - drag.x; panY = drag.panY + event.clientY - drag.y; scheduleCanvasLayout();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('mfCanvas').addEventListener(name, () => { drag = null; $('mfCanvas').classList.remove('is-dragging'); });
  $('mfCanvas').addEventListener('keydown', event => {
    if (event.target !== $('mfCanvas')) return;
    const offsets = { ArrowLeft: [45,0], ArrowRight: [-45,0], ArrowUp: [0,45], ArrowDown: [0,-45] };
    if (offsets[event.key]) { event.preventDefault(); autoFit = false; panX += offsets[event.key][0]; panY += offsets[event.key][1]; layoutCanvas(); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(zoom * 1.2); }
    if (event.key === '-') { event.preventDefault(); zoomAt(zoom / 1.2); }
    if (event.key === '0') { event.preventDefault(); autoFit = true; layoutCanvas(); }
  });
  for (const button of document.querySelectorAll('[data-mf-close]')) button.addEventListener('click', () => requestDialogClose(button.closest('dialog')));
  $('mfLoad').addEventListener('click', async () => { if (await applyInput()) $('mfInputDialog').close(); });
  $('mfStop').addEventListener('click', () => { cancel = true; relationController?.stop(); typedController?.stop(); controls(); notice('Interrupção solicitada. Chamadas em andamento serão concluídas, sem iniciar outras.'); });
  $('mfRun').addEventListener('click', async () => {
    if (busy || libraryBusy || !batch || !C.isAvailable() || document.body.dataset.page !== 'memory') return;
    try {
      if (pendingQuestions()) { openQuestions(); return; }
      if (!await guardWork(true)) return;
      relationConfig=T.currentConfig(relationConfig);
      relationVersion=library.threadVersions.find(v=>F.stable(v.config)===F.stable(relationConfig))?.id || '';
      if(TR){typedConfig=TR.validateConfig(typedConfig);typedVersion=library.typedRelationVersions?.find(v=>F.stable(v.config)===F.stable(typedConfig))?.id||'';}
      run = F.createRun(batch, C.getProvider(), .8, questionSet, questionVersion || null); savedId = null;
    } catch (error) { notice('Não foi possível iniciar: ' + error.message); return; }
    busy = true; cancel = false; follow = true; relationSelection=null; typedSelection=null; notice('');
    const executionMode = uiPrefs.fastMode ? 'burst' : 'step';
    const haltWorkers=error=>{
      cancel=true;relationController?.stop();typedController?.stop();controls();
      notice('Execução interrompida: '+error.message+' Novas chamadas foram suspensas.');
    };
    const enqueueSettledRelations=()=>{
      if(!typedController||cancel)return;
      const jobs=run.thread_worker.jobs;
      while(run.typed_relation_worker.jobs.length<jobs.length){
        const next=jobs[run.typed_relation_worker.jobs.length];
        if(!['done','error','interrupted'].includes(next.status))break;
        const event=run.meeting_events.find(e=>e.event_id===next.event_id);
        if(!typedController.enqueue(event))break;
      }
    };
    relationController = T.start(run, { ...(isV2 ? { schemaVersion: 5 } : {}), config: relationConfig, version: relationVersion || null,
      send: async (request, provider) => {
        try { return await C.requestRelation(request, provider); }
        catch (error) {if(error.stopBatch)haltWorkers(error);throw error;}
      },
      onChange: () => {
        enqueueSettledRelations();
        if (relationFrame) return;
        relationFrame=requestAnimationFrame(()=>{ relationFrame=0; renderQueues(); renderMemories(); renderRelations(); inspect(); relationMap?.render(run); scheduleCanvasLayout(); persist(); });
      }
    });
    if(TR){
      typedController=TR.start(run,{streaming:true,config:typedConfig,version:typedVersion||null,
        send:async(request,provider)=>{
          try{return await C.requestTypedRelation(request,provider);}
          catch(error){if(error.stopBatch)haltWorkers(error);throw error;}
        },
        onChange:()=>{render();persist();}
      });
      // Handle failures immediately while chunks are still running, and keep
      // the original rejected promise available for the final await.
      typedController.done.catch(haltWorkers);
    }
    window.dispatchEvent(new CustomEvent('norte:memory-running')); render();
    try {
      await F.execute(run, {
        mode: executionMode,
        send: async (request, provider) => {
          // A short minimum dwell makes each real routing step visible, not a simulated model result.
          try {
            if (executionMode === 'burst') return await C.requestTest(request, provider);
            const [output] = await Promise.all([C.requestTest(request, provider), new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550))]);
            return output;
          } catch(error){if(error.stopBatch)haltWorkers(error);throw error;}
        },
        shouldStop: () => cancel,
        onChange: async (_, change) => {
          if (change.phase === 'complete' && change.record?.result?.store) {
            const event = run.meeting_events.find(event=>event.chunk_id===change.record.id);
            if (event) relationController.enqueue(event);
          }
          const current = change.record; if (follow && current) selected = current.id;
          render(); persist();
          if (executionMode === 'step' && change.phase === 'complete' && current?.status === 'done' && run.status === 'running') await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450));
        }
      });
      if (cancel || run.status !== 'done') relationController.stop();
      relationController.close();
      await relationController.done;
      enqueueSettledRelations();
      if(cancel||run.status!=='done')typedController?.stop();
      typedController?.close();
      if(typedController)await typedController.done;
    } catch (error) { run.status = 'interrupted'; notice('Execução interrompida: ' + error.message); }
    finally {
      relationController?.stop(); relationController?.close();
      if (relationController) await relationController.done;
      typedController?.stop();typedController?.close();
      if(typedController)try{await typedController.done;}catch(error){notice('Execução interrompida: '+error.message);}
      typedController=null;
      relationController=null;
      if (relationFrame) { cancelAnimationFrame(relationFrame); relationFrame=0; }
      busy = false; render(); persist(); window.dispatchEvent(new CustomEvent('norte:memory-running'));
    }
  });
  // Layout preferences are independent from explicit question/test saving.
  const uiKey = storageKey('memory-ui');
  let uiPrefs = {}, questionsSizing = false;
  try { uiPrefs = JSON.parse(localStorage.getItem(uiKey) || '{}') || {}; } catch (_) { /* Invalid layout preferences do not affect test data. */ }
  if (typeof uiPrefs !== 'object' || Array.isArray(uiPrefs)) uiPrefs = {};
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function saveUI() {
    try { localStorage.setItem(uiKey, JSON.stringify(uiPrefs)); } catch (_) { notice('Não foi possível guardar o tamanho dos painéis neste navegador.'); }
  }
  const panelViews = {
    chunksHidden: { id: 'mfSidebar', divider: 'mfSidebarDivider', label: 'chunks', side: 'left' },
    inspectorHidden: { id: 'mfInspector', divider: 'mfInspectorDivider', label: 'detalhes do teste', side: 'bottom' },
    memoriesHidden: { id: 'mfMemories', divider: 'mfMemoryDivider', label: 'memórias', side: 'right' }
  };
  function decoratePanelToggle(button) {
    const key = button.dataset.panelToggle, panel = panelViews[key], closed = uiPrefs[key] === true;
    button.title = (closed ? 'Mostrar ' : 'Esconder ') + panel.label;
    button.setAttribute('aria-label', button.title); button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', String(!closed));
    if (button.firstElementChild) return;
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
    const border = document.createElementNS(svgNS, 'rect');
    for (const [key, value] of Object.entries({x:2,y:3,width:16,height:14,rx:2})) border.setAttribute(key, value);
    const pane = document.createElementNS(svgNS, 'path');
    pane.setAttribute('d', panel.side === 'bottom' ? 'M2 12h16' : panel.side === 'left' ? 'M7 3v14' : 'M13 3v14');
    const chevron = document.createElementNS(svgNS, 'path'); chevron.classList.add('mf-panel-chevron');
    chevron.setAttribute('d', panel.side === 'bottom' ? 'm8 7 2 2 2-2' : panel.side === 'left' ? 'm12 7-3 3 3 3' : 'm8 7 3 3-3 3');
    svg.append(border, pane, chevron); button.append(svg);
  }
  function applyUI() {
    for (const [key, id, property, min, max, unit] of [
      ['historyHeight','memoryPage','--mf-history-height',12,65,'%'],
      ['inspectorHeight','mfInspector','--mf-inspector-height',15,75,'%'],
      ['sidebarWidth','mfChunks','--mf-sidebar-width',150,500,'px'],
      ['memoryWidth','mfMemories','--mf-memory-width',240,500,'px']
    ]) {
      const target = key === 'inspectorHeight' ? $(id).closest('.mf-main') : ['sidebarWidth','memoryWidth'].includes(key) ? $(id).closest('.mf-workspace') : $(id);
      if (Number.isFinite(uiPrefs[key])) target.style.setProperty(property, clamp(uiPrefs[key], min, max) + unit);
      else target.style.removeProperty(property);
    }
    for (const [key, panelId, listId, toggleId, label] of [
      ['eventsCollapsed','mfEventsPanel','mfMeetingEvents','mfEventsToggle','meeting_events'],
      ['threadsCollapsed','mfThreadsPanel','mfMemoryThreads','mfThreadsToggle','meeting_threads'],
      ['relationsCollapsed','mfRelationsPanel','mfMemoryRelations','mfRelationsToggle','meeting_relations'],
      ['rawCollapsed','mfRawPanel','mfRawWindow','mfRawToggle','raw_window']
    ]) {
      const closed = uiPrefs[key] === true;
      $(panelId).classList.toggle('is-collapsed', closed); $(listId).hidden = closed;
      $(toggleId).textContent = (closed ? '▸ ' : '▾ ') + label; $(toggleId).setAttribute('aria-expanded', String(!closed));
    }
    const workspace = $('mfMemories').closest('.mf-workspace');
    for (const [key, panel] of Object.entries(panelViews)) {
      const closed = uiPrefs[key] === true;
      $(panel.id).hidden = closed; $(panel.divider).hidden = closed;
      workspace.classList.toggle(key, closed);
    }
    $('mfInspector').closest('.mf-main').classList.toggle('inspector-hidden', uiPrefs.inspectorHidden === true);
    for (const button of $('memoryPage').querySelectorAll('[data-panel-toggle]')) decoratePanelToggle(button);
    const size = uiPrefs.questionsSize;
    if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
      $('mfQuestionsDialog').style.width = clamp(size.width,320,2400) + 'px';
      $('mfQuestionsDialog').style.height = clamp(size.height,300,1600) + 'px';
    }
  }
  function setupDivider(id, panelId, parentSelector, key, axis, min, max, direction = 1) {
    const handle = $(id), panel = $(panelId), parent = panel.closest(parentSelector);
    let moving = null;
    const current = () => axis === 'x' ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height / parent.getBoundingClientRect().height * 100;
    const set = value => {
      uiPrefs[key] = clamp(value,min,max); applyUI(); handle.setAttribute('aria-valuenow', String(Math.round(uiPrefs[key])));
    };
    handle.setAttribute('aria-valuemin',min); handle.setAttribute('aria-valuemax',max);
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      moving = { id:event.pointerId, start:axis === 'x' ? event.clientX : event.clientY, value:current(), height:parent.getBoundingClientRect().height };
      handle.setPointerCapture(event.pointerId); document.body.dataset.resizing = axis; event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!moving || moving.id !== event.pointerId) return;
      const delta = (axis === 'x' ? event.clientX : event.clientY) - moving.start;
      set(moving.value + (axis === 'x' ? direction * delta : -delta / moving.height * 100));
    });
    const end = () => { if (!moving) return; moving = null; delete document.body.dataset.resizing; saveUI(); };
    for (const event of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(event,end);
    handle.addEventListener('keydown', event => {
      const delta = axis === 'x' ? {ArrowLeft:-20*direction,ArrowRight:20*direction} : {ArrowUp:3,ArrowDown:-3};
      if (delta[event.key]) { event.preventDefault(); set(current()+delta[event.key]); saveUI(); }
    });
    handle.addEventListener('dblclick', () => { delete uiPrefs[key]; applyUI(); saveUI(); });
  }
  applyUI();
  $('mfBurstToggle').addEventListener('click', () => {
    if (busy) return;
    uiPrefs.fastMode = uiPrefs.fastMode !== true; saveUI(); controls();
  });
  $('memoryPage').addEventListener('click', event => {
    const button = event.target.closest('[data-panel-toggle]'); if (!button) return;
    const key = button.dataset.panelToggle; if (!panelViews[key]) return;
    uiPrefs[key] = uiPrefs[key] !== true; applyUI(); saveUI(); renderMemories(); scheduleCanvasLayout();
    if (uiPrefs[key] && !button.closest('.mf-panel-tools')) {
      $('memoryPage').querySelector(`.mf-panel-tools [data-panel-toggle="${key}"]`).focus();
    }
  });
  restoreQueueStates();
  addQueueResizer($('mfNodeIgnore'), 'ignore', 'Ignore');
  addQueueResizer($('mfNodeChunk'), 'stream:raw_window', 'raw_window');
  addQueueResizer($('mfNodeMeetingEvents'), 'stream:meeting_events', 'meeting_events');
  for (const [id,key] of [['mfNodeRelationEvents','stream:relation_events'],['mfNodeRelationCandidates','stream:relation_candidates'],['mfNodeRelationRejected','stream:relation_rejected'],['mfNodeRelations','stream:relations'],['mfNodeRelationFalse','stream:relation_false']]) addQueueResizer($(id),key,relationQueueLabels[key]);
  for(const [id,[key,label]] of Object.entries(threadQueues))addQueueResizer($(id),key,label);
  function changeQueueHeight(id, height) {
    rememberQueue(id, { height: Math.round(clamp(height, queueMinHeight, queueMaxHeight)), collapsed: false });
    sizeQueues(); scheduleCanvasLayout();
  }
  $('mfScene').addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-queue-resize]');
    if (!handle || event.button !== 0 || queueDrag) return;
    const id = handle.dataset.queueResize;
    // Work in scene pixels and freeze the camera: auto-fit would otherwise undo
    // the visual size increase on each pointer movement.
    autoFit = false;
    queueDrag = { handle, id, pointerId: event.pointerId, y: event.clientY, height: queueHeight(id, true), scale: zoom };
    handle.setPointerCapture(event.pointerId); handle.classList.add('is-resizing');
    document.body.dataset.resizing = 'y'; event.preventDefault(); event.stopPropagation();
  });
  $('mfScene').addEventListener('pointermove', event => {
    if (!queueDrag || queueDrag.pointerId !== event.pointerId) return;
    changeQueueHeight(queueDrag.id, queueDrag.height + (event.clientY - queueDrag.y) / queueDrag.scale);
    event.stopPropagation();
  });
  const finishQueueResize = event => {
    if (!queueDrag || queueDrag.pointerId !== event.pointerId) return;
    const { handle } = queueDrag; queueDrag = null;
    handle.classList.remove('is-resizing'); delete document.body.dataset.resizing; saveUI();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('mfScene').addEventListener(name, finishQueueResize);
  $('mfScene').addEventListener('keydown', event => {
    const handle = event.target.closest('[data-queue-resize]'); if (!handle) return;
    const id = handle.dataset.queueResize, step = event.shiftKey ? 60 : 20;
    const heights = { ArrowUp: queueHeight(id, true)-step, ArrowDown: queueHeight(id, true)+step, Home: queueMinHeight, End: queueMaxHeight };
    if (!Object.hasOwn(heights, event.key)) return;
    event.preventDefault(); event.stopPropagation(); autoFit = false; changeQueueHeight(id, heights[event.key]); saveUI();
  });
  $('mfScene').addEventListener('dblclick', event => {
    const handle = event.target.closest('[data-queue-resize]'); if (!handle) return;
    event.preventDefault(); event.stopPropagation(); autoFit = false;
    changeQueueHeight(handle.dataset.queueResize, defaultQueueHeight(handle.dataset.queueResize)); saveUI();
  });
  setupDivider('mfHistoryDivider','mfHistory','.memory-page','historyHeight','y',12,65);
  setupDivider('mfInspectorDivider','mfInspector','.mf-main','inspectorHeight','y',15,75);
  setupDivider('mfSidebarDivider','mfChunks','.mf-workspace','sidebarWidth','x',150,500);
  setupDivider('mfMemoryDivider','mfMemories','.mf-workspace','memoryWidth','x',240,500,-1);
  for (const [id, key] of [['mfEventsToggle','eventsCollapsed'],['mfThreadsToggle','threadsCollapsed'],['mfRelationsToggle','relationsCollapsed'],['mfRawToggle','rawCollapsed']]) $(id).addEventListener('click', () => {
    uiPrefs[key] = uiPrefs[key] !== true; applyUI(); saveUI(); renderMemories();
  });
  for(const id of ['mfBatchJSON','mfQuestionJSON','mfUtteranceEdit']) {
    const field=$(id);field.closest('dialog').querySelector('footer').prepend(copyButton(id==='mfUtteranceEdit'?'Copiar input':'Copiar JSON',()=>field.value,'editor'));
  }
  const questionsDialog = $('mfQuestionsDialog');
  questionsDialog.addEventListener('pointerdown', event => {
    const r = questionsDialog.getBoundingClientRect();
    questionsSizing = event.clientX >= r.right-22 && event.clientX <= r.right && event.clientY >= r.bottom-22 && event.clientY <= r.bottom;
  });
  function rememberQuestionSize() {
    if (!questionsSizing || !questionsDialog.open) return;
    const r = questionsDialog.getBoundingClientRect(); uiPrefs.questionsSize = {width:Math.round(r.width),height:Math.round(r.height)}; saveUI();
  }
  const questionResize = new ResizeObserver(rememberQuestionSize); questionResize.observe(questionsDialog);
  for (const event of ['pointerup','mouseup']) window.addEventListener(event, () => { rememberQuestionSize(); questionsSizing = false; });
  let tooltipTarget = null;
  const tooltipSelector = '.mf-verdict, .mf-chunk-status, .mf-memory-status, .mf-answer-verdict, .mf-answer-confidence[data-tone], .mf-stat[data-tone], .mf-group-verdict';
  function hideVerdictTooltip() {
    tooltipTarget?.removeAttribute('aria-describedby'); tooltipTarget = null; $('mfVerdictTooltip').hidden = true;
  }
  function showVerdictTooltip(target) {
    const tone = target.dataset.tone || target.closest('[data-tone]')?.dataset.tone;
    if (!['pass','fail','warning','error'].includes(tone)) { hideVerdictTooltip(); return; }
    tooltipTarget = target;
    const tip = $('mfVerdictTooltip'), rect = target.getBoundingClientRect();
    $('mfTooltipPass').textContent = target.classList.contains('mf-answer-confidence')
      ? `Confiança atende ao mínimo de ${percent(run?.threshold ?? .8)}. Isso não significa que a resposta esteja correta.`
      : 'Correto: resposta igual ao esperado.';
    $('mfTooltipConfidence').textContent = `Confiança abaixo do mínimo de ${percent(run?.threshold ?? .8)}, avaliada separadamente do acerto da resposta.`;
    if(target.closest('#mfThreadDetails')) {
      if(target.classList.contains('mf-answer-confidence'))$('mfTooltipPass').textContent='Probabilidade da resposta obtida ≥ 80%. Isso não significa que a resposta esteja correta.';
      $('mfTooltipConfidence').textContent=run?.thread_worker?.schemaVersion>=2?'Probabilidade da resposta obtida < 80%: atribuição pendente, sem criar ou trocar de thread. Divergência do gabarito continua vermelha.':'Histórico: confiança abaixo de 80% era apenas um alerta, sem bloquear a atribuição.';
    }
    if (target.dataset.relationVerdict || target.closest('[data-relation-target]')) {
      const filter=target.dataset.relationVerdict==='filter';
      $('mfTooltipPass').textContent=filter?'Filtro conforme o gabarito informado ou, na ausência dele, a regra configurada.':run?.relation_worker?.schemaVersion>=3?'Resposta igual ao gabarito do par. Pares não listados têm esperado false.':'Resposta igual ao gabarito do par. Sem gabarito, a resposta não é marcada como correta.';
      $('mfTooltipConfidence').textContent=filter?'Filtro determinístico: não utiliza IA nem tem porcentagem de confiança.':'Confiança da resposta obtida não supera 80%. Erros de resposta continuam vermelhos, mesmo com confiança alta.';
    }
    tip.hidden = false; target.setAttribute('aria-describedby',tip.id);
    tip.style.left = clamp(rect.left,8,Math.max(8,innerWidth-tip.offsetWidth-8))+'px';
    tip.style.top = (rect.bottom+tip.offsetHeight+12 < innerHeight ? rect.bottom+8 : Math.max(8,rect.top-tip.offsetHeight-8))+'px';
  }
  $('memoryPage').addEventListener('pointerover', event => { const target = event.target.closest(tooltipSelector); if (target) showVerdictTooltip(target); });
  $('memoryPage').addEventListener('pointerout', event => { if (tooltipTarget && !tooltipTarget.contains(event.relatedTarget)) hideVerdictTooltip(); });
  $('memoryPage').addEventListener('focusin', event => { const target = event.target.closest(tooltipSelector); if (target) showVerdictTooltip(target); });
  $('memoryPage').addEventListener('focusout', hideVerdictTooltip);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') hideVerdictTooltip(); });
  window.addEventListener('resize', hideVerdictTooltip);
  window.addEventListener('norte:model-status', controls);
  window.addEventListener('norte:page-changed', render);
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();});
  if(database){database.subscribe(changed=>{if(changed===libraryKey)refreshLibrary();});window.addEventListener('focus',refreshLibrary);}
  window.addEventListener('storage', event => {
    if (database || event.key !== libraryKey || !event.newValue) return;
    try { library = F.validateLibrary(JSON.parse(event.newValue)); renderHistory(); } catch (_) { notice('Outra aba alterou o histórico com dados inválidos. Nada foi sobrescrito.'); }
  });
  window.addEventListener('beforeunload', event => { if (busy || libraryBusy || persistJob || pendingQuestions() || batch && !savedId) { event.preventDefault(); event.returnValue = ''; } });
  if(isV2){
    relationMap=window.NorteRelationMap.create($('mfRelationMap'),{onSelect:eventId=>{
      const event=run?.meeting_events.find(e=>e.event_id===eventId);
      if(event){selected=event.chunk_id;follow=false;inspect();renderChunks();persist();}
    }});
    $('mfViewTabs').hidden=false;
    const setView=kind=>{
      const map=kind==='relations';uiPrefs.memoryView=map?'relations':'canvas';
      $('mfCanvas').hidden=map;$('mfRelationMap').hidden=!map;
      $('mfViewCanvas').setAttribute('aria-selected',String(!map));$('mfViewRelations').setAttribute('aria-selected',String(map));
      $('mfViewCanvas').tabIndex=map?-1:0;$('mfViewRelations').tabIndex=map?0:-1;
      $('memoryPage').classList.toggle('has-relation-map',map);
      relationMap.setVisible(map);relationMap.render(run);if(!map)scheduleCanvasLayout();saveUI();
    };
    $('mfViewCanvas').addEventListener('click',()=>setView('canvas'));
    $('mfViewRelations').addEventListener('click',()=>setView('relations'));
    $('mfViewTabs').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const map=event.key==='End'||event.key!=='Home'&&uiPrefs.memoryView!=='relations';setView(map?'relations':'canvas');$(map?'mfViewRelations':'mfViewCanvas').focus();}});
    setView(uiPrefs.memoryView||'canvas');
  }
  const resize = new ResizeObserver(scheduleCanvasLayout); resize.observe($('mfScene')); resize.observe($('mfCanvas'));
  window.NorteMemoryPage = { flushStorage:()=>persist(), isRunning: () => busy, snapshot: () => E.clone({ profile: isV2 ? 'memory-v2' : 'memory', batch, run, selected, follow, queues: F.queues(run, questionSet),
    meeting_events: run?.meeting_events || [], raw_window: run?.raw_window || [], meeting_threads:run?.meeting_threads || [],meeting_relations:run?.meeting_relations || [],relations: run?.relations || [], relationSelection, typedSelection,typedRelationConfig:typedConfig,typedRelationVersion:typedVersion,threadConfig:relationConfig,threadVersion:relationVersion,relationConfig, relationVersion, questionVersion, questionSet, library, savedId, collapsed: [...collapsed] }) };
  render();
})();
