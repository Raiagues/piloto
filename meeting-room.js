/* An additional page inside the existing Norte shell. Dependencies load on first visit. */
(function(){
let boot;
function openPage(){
 if(boot)return boot;
 boot=(async function(){
 const dependencies=[
  ['NorteMemoryStorage','memory-storage.js?v=20261007-11'],
  ['NorteMemoryV2','memory-v2.js?v=20261007-11'],
  ['NorteTypedRelations','typed-relations.js?v=20261007-11'],
  ['NorteMeetingCommands','meeting-commands.js?v=20261007-11'],
  ['NorteMeetingSession','meeting-session.js?v=20261007-11'],
  ['NorteMeetingSpeech','meeting-speech.js?v=20261007-11'],
  ['NorteMeetingEvidence','meeting-evidence.js?v=20261007-11'],
  ['NorteMeetingState','meeting-state.js?v=20261007-11'],
  ['NorteMeetingReview','meeting-review.js?v=20261007-11'],
  ['NorteMeetingHierarchy','meeting-hierarchy.js?v=20261007-11'],
  ['NorteMeetingCanvas','meeting-canvas.js?v=20261007-11'],
  ['NorteMinutes','meeting-minutes.js?v=20261007-11'],
  ['NorteMeetingAmendments','meeting-amendments.js?v=20261007-11'],
  ['NorteMeetingDocument','meeting-document.js?v=20261007-11'],
  ['NorteGeminiMinutes','gemini-minutes.js?v=20261007-11']
 ];
 // Signed in: meetings live in the account (server database) instead of this browser.
 if(document.body.dataset.auth==='on')dependencies.push(['NorteRemoteStorage','remote-storage.js?v=20261007-11']);
 for(const [name,file] of dependencies){if(!window[name])await import('./'+file);if(!window[name])throw Error('Não foi possível carregar a página de reunião.');}
 for(const file of ['meeting-minutes.css?v=20261007-11','gemini-minutes.css?v=20261007-11']){
  if(![...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href.endsWith(file))){const link=document.createElement('link');link.rel='stylesheet';link.href='./'+file;document.head.append(link);}
 }
 await initialize();
 })().catch(error=>{boot=null;for(const id of ['roomNotice','roomLibraryNotice']){const notice=document.getElementById(id);if(notice){notice.hidden=false;notice.textContent=error.message+' Reabra esta página para tentar novamente.';}}});
 return boot;
}
window.addEventListener('norte:page-changed',event=>{if(['meeting','beam'].includes(event.detail.page))openPage();});
if(['meeting','beam'].includes(document.body.dataset.page))openPage();
async function initialize(){
'use strict';
const $=id=>document.getElementById(id),Session=NorteMeetingSession;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const button=(label,fn,cls='compact-button')=>{const n=el('button',cls,label);n.type='button';n.onclick=fn;return n;};
let current=null,controller=null,mode=null,ready=false,provider='official',starting=false,closing=false,renaming=null,db=null,saveTimer=null,saveQueue=Promise.resolve(),renderFrame=0,lastTranscript='',history=[],view='library',initialized=false;
let recognition=null,listening=false,micPaused=false,ledger=null,consumed=new Set(),micEnd=null,restartTimer=null,recognitionErrors=0,micStopping=false,stopPromise=null;
let recognitionWindow=null,recognitionDeadline=null;
let beamIntegration=null,beamBoot=null;
async function ensureBeam(){
 if(beamIntegration)return beamIntegration;
 if(!beamBoot)beamBoot=(async()=>{
  for(const file of ['beam-engine.js','beam-commands.js','beam-workspace.js','meeting-beam.js'])await import('./'+file+'?v=20261007-11');
  for(const file of ['beam-workspace.css','meeting-beam.css']){const link=document.createElement('link');link.rel='stylesheet';link.href='./'+file+'?v=20261007-11';document.head.append(link);}
  beamIntegration=NorteMeetingBeam.create({getRun:()=>current,save:saveSoon,notice,canSubmit:()=>current?.status==='draft'||!!controller?.accepting,submitFacts:async facts=>{
   if(current?.status==='draft'&&!await begin('text'))return false;
   if(!controller?.accepting){notice('Esta reunião já foi encerrada. Crie uma nova reunião para registrar outras simulações.');return false;}
   try{return controller.appendFacts(facts);}catch(error){notice(cleanError(error));return false;}
  },submit:async(text,meta={})=>{
   if(current?.status==='draft'&&!await begin('text'))return false;
   if(!controller?.accepting){notice('Esta reunião já foi encerrada. Crie uma nova reunião para registrar outras simulações.');return false;}
   appendTurn({text,segmentId:'beam:'+crypto.randomUUID(),...meta},meta.source||'typed');return true;
  }});
  return beamIntegration;
 })().catch(error=>{beamBoot=null;throw error;});
 return beamBoot;
}
const roomKind=()=>document.body.dataset.page==='beam'?'beam':'meeting';
const finishHome=$('roomFinish').parentElement;
const INDEX='norte.meeting-room.index.v2',MIGRATED='norte.meeting-room.library-reset.v2';
const inAccount=document.body.dataset.auth==='on',savedWhere=inAccount?'na sua conta':'no navegador';
const saveKey=id=>'norte.meeting-room.session.v2.'+id;
const cleanError=e=>String(e?.message||e||'Não foi possível concluir a operação.').replace(/Gemini(?: Pro)?|TypeSafe|Jev(?: oficial)?/gi,'serviço');
const canvas=NorteMeetingCanvas.create({canvas:$('roomCanvas'),board:$('roomBoard'),onRename:renameTopic,onInspect:inspectEvidence});
NorteLayout.bind({id:'#roomTranscriptDivider',host:'#roomWorkspace',property:'--room-canvas-height',initial:()=>roomKind()==='beam'?78:70,axis:()=> 'y',min:25,max:85,pixels:()=>[200,100],gutter:12});
function notice(message=''){for(const id of ['roomNotice','roomLibraryNotice']){const target=$(id);if(target){target.textContent=message;target.hidden=!message;}}}
async function checkHealth(){try{const r=await fetch('/api/health',{signal:AbortSignal.timeout(5000)});const data=await r.json();ready=!!data.ready;provider=data.provider||'official';if(!ready)notice('A conexão de processamento não está pronta. Confira o serviço antes de começar.');}catch(_){ready=false;notice('Não foi possível conectar. Verifique se o serviço está aberto.');}controls();return ready;}
async function send(request,requestProvider,lane){
 const classifier=window.NorteClassifier;
 try{
  if(lane==='threads')return await classifier.requestRelation(request,requestProvider);
  if(lane==='relations')return await classifier.requestTypedRelation(request,requestProvider);
  return await classifier.requestTest(request,requestProvider);
 }catch(error){
  if(error.name==='TimeoutError'||error.name==='TypeError')throw Object.assign(Error('A conexão de processamento foi interrompida. As falas recebidas foram preservadas.'),{stopBatch:true});
  throw error;
 }
}
// This one-time reset is limited to the former meeting page. Laboratory and
// memory snapshots share the database and must never be cleared here.
async function resetLegacyMeetings(){
 if(await db.read(MIGRATED))return;
 await new Promise((resolve,reject)=>{
  const request=indexedDB.open('norte-memory',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{
   const connection=request.result,tx=connection.transaction('records','readwrite'),store=tx.objectStore('records');
   tx.oncomplete=()=>{connection.close();resolve();};
   tx.onabort=tx.onerror=()=>{connection.close();reject(tx.error||Error('Não foi possível preparar a lista de reuniões.'));};
   const cursor=store.openCursor();
   cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;const key=String(item.key);if(key==='norte.meeting-room.current.v1'||key==='norte.meeting-room.index.v1'||key.startsWith('norte.meeting-room.session.v1.'))item.delete();item.continue();};
   store.put(new Date().toISOString(),MIGRATED);
  };
 });
}
function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>save(),250);}
function save(){
 clearTimeout(saveTimer);
 if(!current)return saveQueue.then(()=>true);
 if(!db){notice('Não foi possível salvar '+savedWhere+'. A reunião continuará aberta para você baixar a ata.');return Promise.resolve(false);}
 const snapshot=JSON.stringify(current),item={id:current.id,title:current.title,date:current.createdAt,startedAt:current.startedAt,status:current.status,points:current.meeting_events.length,room_kind:current.room_kind||'meeting'};
 $('roomSave').textContent='Salvando…';
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  await db.write(saveKey(item.id),snapshot);
  history=await db.change(INDEX,raw=>{let list=raw?JSON.parse(raw):[];list=[item,...list.filter(x=>x.id!==item.id)].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));return {value:JSON.stringify(list),result:list};});
  renderLibrary();$('roomSave').textContent=inAccount?'Salvo na sua conta':'Salvo neste navegador';return true;
 }).catch(error=>{$('roomSave').textContent='Falha ao salvar';notice((inAccount?cleanError(error)+' ':'Não foi possível salvar no navegador. ')+'Baixe a ata antes de fechar a página.');return false;});
 return saveQueue;
}
function renderLibrary(){
 const list=$('roomLibraryList'),fragment=document.createDocumentFragment();
 const visibleHistory=history.filter(item=>(item.room_kind||'meeting')===roomKind());
 for(const item of visibleHistory){
  const row=el('tr','room-library-row');row.dataset.meetingId=item.id;
  const name=el('td','room-meeting-name'),open=button(item.title,()=>openMeeting(item.id),'room-open-meeting');open.dataset.meetingId=item.id;name.append(open);if(item.points)name.append(el('small','room-meeting-meta',item.points+(item.points===1?' registro':' registros')));
  const date=el('td','room-library-date',new Date(item.date).toLocaleString('pt-BR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}));
  const status=el('td','room-meeting-status'),label=el('span','room-library-badge',({draft:'Não iniciada',done:'Concluída',interrupted:'Interrompida'})[item.status]||'Em andamento');label.dataset.status=item.status;status.append(label);
  const actions=el('td','room-library-actions'),action=button('Abrir',()=>openMeeting(item.id));action.setAttribute('aria-label','Abrir '+item.title);actions.append(action);
  row.append(name,date,status,actions);fragment.append(row);
 }
 list.replaceChildren(fragment);$('roomLibraryEmpty').hidden=!!visibleHistory.length;
 const table=list.closest('table');if(table)table.hidden=!visibleHistory.length;
 $('roomLibraryCount').textContent=visibleHistory.length+(visibleHistory.length===1?' reunião':' reuniões');
}
function renderView(){
 const finish=$('roomFinish'),finishTarget=roomKind()==='beam'?document.querySelector('.room-recording-controls'):finishHome;
 if(finish.parentElement!==finishTarget){if(finishTarget===finishHome)finishTarget.insertBefore(finish,$('roomStop'));else finishTarget.append(finish);}
 const visible=['meeting','beam'].includes(document.body.dataset.page),room=visible&&view==='room'&&(current?.room_kind||'meeting')===roomKind();
 $('roomLibraryHeader').querySelector('h1').textContent=roomKind()==='beam'?'Simulação de vigas':'Reuniões';
 $('roomLibrary').querySelector('h2').textContent=roomKind()==='beam'?'Reuniões com simulação':'Todas as reuniões';
 renderLibrary();
 beamIntegration?.activate(room&&roomKind()==='beam',current);
 if(room&&roomKind()==='beam'&&!beamIntegration)ensureBeam().then(()=>{renderView();render();}).catch(error=>notice(cleanError(error)));
 $('roomLibrary').hidden=!visible||room;$('roomLibraryHeader').hidden=!visible||room;
 $('meetingPage').hidden=!room;$('meetingHeader').hidden=!room;
 $('roomCreateMenu').hidden=true;$('roomNew').setAttribute('aria-expanded','false');
 window.NorteLayout?.refresh();
}
function snapshot(){return current?JSON.parse(JSON.stringify(current)):null;}
function statusText(){
 if(!current||current.status==='draft')return 'Ainda não iniciada';
 if(closing||(controller&&!current.finishedAt&&current.status!=='running'))return 'Concluindo os últimos registros…';
 if(current.status==='done')return 'Reunião concluída';
 if(current.status==='interrupted')return 'Reunião preservada · confira as pendências';
 if(listening)return 'Gravando reunião';
 if(mode==='live')return micPaused?'Gravação pausada':'Reunião em andamento';
 if(mode==='text')return 'Reunião em andamento';
 const done=current.transcript.filter(t=>['done','command','error'].includes(t.status)).length;
 return 'Construindo mapa · '+done+' de '+current.transcript.length+' falas';
}
let reportedRunning=false;
const isRunning=()=>starting||closing||micStopping||!!recognition||listening||!!controller&&!current?.finishedAt;
function controls(){
 const running=isRunning();
 if(running!==reportedRunning){reportedRunning=running;window.dispatchEvent(new CustomEvent('norte:meeting-running',{detail:{running}}));}
 const active=!!controller&&!current?.finishedAt,draft=current?.status==='draft';
 $('roomImport').disabled=running||!draft;
 $('roomLive').disabled=!current||starting||closing||micStopping||(!draft&&!active)||active&&!['live','text'].includes(mode);
 $('roomLiveLabel').textContent=micStopping?'Pausando…':listening?'Pausar gravação':active&&mode==='live'?'Retomar gravação':current&&!draft&&!active?'Reunião encerrada':'Iniciar gravação';
 $('roomLive').classList.toggle('is-recording',listening);$('roomLive').setAttribute('aria-pressed',String(listening));
 $('roomMinutes').disabled=!current?.meeting_events.length||active||closing;
 $('roomNew').disabled=running||!initialized;$('roomCreateInstant').disabled=running||!initialized;$('roomBack').disabled=running;
 $('roomStarted').textContent=!current?.startedAt?'Ainda não iniciada':(current.finishedAt?'Realizada em ':'Iniciada às ')+new Date(current.startedAt).toLocaleString('pt-BR',current.finishedAt?{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}:{hour:'2-digit',minute:'2-digit'});
 $('roomSessionBar').hidden=!current||roomKind()==='beam'&&(!active||['live','text'].includes(mode));$('roomStatus').textContent=statusText();$('roomPulse').classList.toggle('listening',listening);
 $('roomMic').hidden=true;
 $('roomFinish').hidden=!active||!['live','text'].includes(mode);$('roomFinish').disabled=closing;
 $('roomStop').hidden=!active||['live','text'].includes(mode);$('roomStop').disabled=closing;
 const canType=!!controller?.accepting||roomKind()==='beam'&&draft&&!starting&&!closing;
 $('roomSend').disabled=!canType;$('roomText').disabled=!canType;
 $('roomLanguage').disabled=listening||closing;
 updateTimer();
}
function updateTimer(){
 const start=Date.parse(current?.startedAt),end=current?.finishedAt?Date.parse(current.finishedAt):Date.now();
 const seconds=Number.isFinite(start)?Math.max(0,Math.floor((end-start)/1000)):0;
 $('roomTimer').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
}
function renderBoard(){
 const projection=canvas.render(current),count=current?.meeting_events.length||0,hasTopics=!!projection.topics.length;
 $('roomWelcome').hidden=hasTopics;$('roomBoard').hidden=!hasTopics;
 $('roomCounts').textContent=projection.topics.length+(projection.topics.length===1?' assunto':' assuntos');$('roomCounts').disabled=!projection.topics.length;
 renderTopics(projection);
 renderAttention(projection.state||(current?NorteMeetingState.build(current):null));
}
let attentionSignature='';
function focusEntry(id,topicId){
 canvas.focusTopic(topicId);
 const card=[...$('roomBoard').querySelectorAll('[data-event-id]')].find(n=>n.dataset.eventId===id);
 const details=card?.closest('.mc-topic-details');if(details)details.open=true;
 if(card)requestAnimationFrame(()=>card.scrollIntoView({block:'nearest',inline:'nearest'}));
 card?.classList.add('room-highlight');setTimeout(()=>card?.classList.remove('room-highlight'),1600);
}
function renderAttention(state){
 const alerts=state?.alerts||[],pending=state?.pending||[];
 const signature=JSON.stringify([current?.id,alerts,pending.map(e=>[e.id,e.text,e.status,e.reasons,e.topic_id]),state?.topics.map(t=>[t.id,t.title])]);
 if(signature===attentionSignature)return;attentionSignature=signature;
 const stack=$('roomAlerts');stack.replaceChildren();stack.hidden=!alerts.length;
 const topicName=id=>state?.topics.find(t=>t.id===id)?.title||'Assunto sem título';
 const explain=(entry,issues)=>{if(entry)focusEntry(entry.id,entry.topic_id);inspectEvidence({eventIds:[...new Set([entry?.id,...issues.flatMap(i=>i.event_ids||[])].filter(Boolean))],relationIds:[...new Set(issues.flatMap(i=>i.relation_ids||[]))],issues});};
 if(alerts.length){
  const list=el('details','room-alert-list');list.open=true;
  list.append(el('summary','room-alert-heading',alerts.length+(alerts.length===1?' atenção necessária':' atenções necessárias')));
  const items=el('div','room-alert-items');
  for(const alert of alerts){
   const affected=(alert.event_ids||[]).map(id=>state.byId[id]).filter(Boolean),entry=affected.find(e=>e.status===alert.kind)||affected[0],item=button('',()=>explain(entry,[alert]),'room-alert-item');item.dataset.kind=alert.kind;item.title=alert.message;
   const copy=el('span','room-alert-copy');copy.append(el('small','',entry?topicName(entry.topic_id):'Dependência'),el('span','',entry?.text||alert.message));
   item.append(copy,el('span','room-alert-status',({conflict:'Conflito',error:'Erro',review:'Revisar',pending:'Pendente'})[alert.kind]||'Revisar'));items.append(item);
  }
  list.append(items);stack.append(list);
 }
 const pendingPanel=$('roomPending');pendingPanel.hidden=!pending.length;
 $('roomPendingCount').textContent='Informações pendentes · '+pending.length;
 const pendingList=$('roomPendingList');pendingList.replaceChildren();
 for(const entry of pending){
  const item=button('',()=>explain(entry,entry.alerts?.length?entry.alerts:entry.reasons.map(message=>({message,event_ids:[entry.id],relation_ids:[]}))),'room-pending-item');
  item.append(el('small','',topicName(entry.topic_id)),el('span','',entry.text),el('small','room-pending-reason',entry.reasons[0]||'Ainda sem fechamento registrado.'));pendingList.append(item);
 }
}
let topicsSignature='';
function renderTopics(projection){
 const signature=JSON.stringify(projection.topics);if(signature===topicsSignature)return;topicsSignature=signature;
 const menu=$('roomTopicsMenu'),expanded=new Set([...menu.querySelectorAll('details[open]')].map(d=>d.dataset.key));menu.replaceChildren();
 for(const [index,topic] of projection.topics.entries()){
  const detail=el('details','room-topic-menu-entry');detail.dataset.key=topic.id||'pending';detail.open=expanded.has(detail.dataset.key);
  const name=current?.topic_titles?.[topic.id]||current?.meeting_threads.find(t=>t.thread_id===topic.id)?.title||'Assunto '+(index+1)+' · sem título';
  const heading=el('summary','',name);detail.append(heading);detail.addEventListener('mouseenter',()=>detail.open=true);
  for(const [key,label] of [['problems','Problema'],['hypotheses','Hipóteses'],['tests','Testes']]){
   const group=el('details','room-topic-menu-group');group.dataset.key=detail.dataset.key+':'+key;group.open=expanded.has(group.dataset.key);group.append(el('summary','',label));group.addEventListener('mouseenter',()=>group.open=true);
   const nodes=topic.columns?.[key]||[];
   if(!nodes.length)group.append(el('p','room-topic-menu-empty','Nenhum registro.'));
   const add=node=>{group.append(button(node.text,()=>{canvas.focusTopic(topic.id);$('roomTopicsMenu').hidden=true;$('roomCounts').setAttribute('aria-expanded','false');const card=[...$('roomBoard').querySelectorAll('[data-event-id]')].find(n=>n.dataset.eventId===node.id);card?.classList.add('room-highlight');setTimeout(()=>card?.classList.remove('room-highlight'),1600);},'room-topic-menu-point'));for(const child of node.children||[])add(child);};
   nodes.forEach(add);detail.append(group);
  }
  menu.append(detail);
 }
}
function inspectEvidence(detail={}){
 const run=detail.run||current;if(!run)return;
 const ids=detail.eventIds||[detail.event_id].filter(Boolean),relationIds=detail.relationIds||[detail.relation_id].filter(Boolean);
 const relations=(run.meeting_relations||[]).filter(r=>relationIds.includes(r.relation_id)),relation=relations[0];
 for(const edge of relations)for(const id of [edge.source_event_id,edge.target_event_id])if(id&&!ids.includes(id))ids.push(id);
 const dialog=el('dialog','room-dialog room-diagnostics');dialog.setAttribute('aria-label','Detalhes da classificação');
 const header=el('header');header.append(el('h2','',relation?'Detalhes da dependência':detail.issues?.length||detail.warning?'Ponto em acompanhamento':'Detalhes do registro'),button('Fechar',()=>dialog.close()));dialog.append(header);
 for(const issue of detail.issues||[detail.warning].filter(Boolean))dialog.append(el('p','',issue.message||String(issue)));
 const records=(run.records||[]).filter(r=>(run.meeting_events||[]).some(e=>ids.includes(e.event_id)&&e.chunk_id===r.id));
 for(const event of (run.meeting_events||[]).filter(e=>ids.includes(e.event_id))){const quote=el('blockquote','',event.text);quote.append(el('small','room-diagnostic-id',event.event_id));dialog.append(quote);}
 const logs={records,thread_jobs:(run.thread_worker?.jobs||[]).filter(j=>ids.includes(j.event_id)),...(relationIds.length?{relations,relation_jobs:(run.typed_relation_worker?.jobs||[]).filter(j=>relations.some(r=>r.source_event_id===j.event_id)||relationIds.some(id=>id.startsWith('MR_'+j.event_id+'_')))}:{})};
 const disclosure=el('details','room-diagnostic-log');disclosure.append(el('summary','','Explorar classificação e respostas'),el('pre','',JSON.stringify(logs,null,2)));dialog.append(disclosure);
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
function transcriptTurns(){
 const entries=[...(current?.transcript||[]).filter(entry=>entry.source!=='simulation'),...(current?.speech_ledger?.records||[]).filter(r=>r.status==='unconfirmed').map(r=>({id:'UNCONFIRMED-'+r.id,text:r.text,speaker:r.speaker,offsetMs:r.startMs,status:'unconfirmed',error:'Fala não confirmada pelo microfone; não entrou no mapa.'}))].sort((a,b)=>(a.offsetMs??Infinity)-(b.offsetMs??Infinity));
 const turns=[];
 for(const entry of entries){
  const sourceKey=entry.segmentId||entry.id;
  for(const [index,text] of NorteMeetingSpeech.split(entry.text,{preserveCommands:false}).entries()){
   const count=text.trim().split(/\s+/).length;let turn=turns.at(-1);
   // Simulator speech keeps each idea visible; other meetings may group short sentences.
   if(roomKind()==='beam'||!turn||turn.sourceKey!==sourceKey||turn.wordCount+count>18||turn.command||entry.command?.consumed){turn={key:entry.id+':'+index,sourceKey,entries:[],text:[],wordCount:0,speaker:entry.speaker||'',offsetMs:entry.offsetMs,notes:[],command:!!entry.command?.consumed};turns.push(turn);}
   turn.entries.push(entry.id);turn.text.push(text);turn.wordCount+=count;
   if(entry.error)turn.notes.push(cleanError(entry.error));
   if(entry.command?.consumed&&entry.command.message&&!entry.command.renamed&&!['applied','conversation'].includes(entry.command.status))turn.notes.push(cleanError(entry.command.message));
  }
 }
 return turns;
}
function renderTranscript(){
 const turns=transcriptTurns(),key=JSON.stringify(turns);if(key===lastTranscript)return;lastTranscript=key;
 const list=$('roomTranscript'),scroller=list.closest('.room-transcript-scroll'),follow=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<70;
 const expanded=new Set([...list.querySelectorAll('details[open]')].map(node=>node.closest('[data-source-id]').dataset.sourceId));
 const fragment=document.createDocumentFragment();
 for(const turn of turns){
  const row=el('article','room-speech');row.dataset.sourceId=turn.key;
  const time=el('time','room-speech-time',NorteMemoryFlow.elapsedTimestamp(turn.offsetMs));time.title='Horário da fala';
  if(Number.isFinite(turn.offsetMs))time.dateTime='PT'+(turn.offsetMs/1000).toFixed(3)+'S';
  const body=el('div','room-speech-body');if(turn.speaker)body.append(el('span','room-speech-speaker',turn.speaker));body.append(el('p','room-speech-text',turn.text.join(' ')));
  if(turn.notes.length){const notes=el('details','room-speech-notes');notes.open=expanded.has(turn.key);notes.append(el('summary','','Ver observação'));for(const note of new Set(turn.notes))notes.append(el('p','',note));body.append(notes);}
  row.append(time,body);fragment.append(row);
 }
 list.replaceChildren(fragment);$('roomTranscriptEmpty').hidden=!!turns.length;$('roomTranscriptCount').textContent=turns.length+(turns.length===1?' fala':' falas');if(follow)scroller.scrollTop=scroller.scrollHeight;
}
function appendTurn(entry,source){
 for(const part of NorteMeetingSpeech.entries(entry,source)){
  const {text,...meta}=part;controller.append(text,meta);
 }
}

function render(){renderFrame=0;renderBoard();renderTranscript();controls();beamIntegration?.update(current);}
function changed(run,change){current=run;if(change.phase==='command')beamIntegration?.acknowledge(change.command,run);if(change.phase==='command'&&change.command?.message){if(change.command.status==='applied')notice('');else if(change.command.renamed)window.dispatchEvent(new CustomEvent('norte:notice',{detail:change.command.message}));else notice(change.command.message);}if(change.phase==='error'||change.phase==='stopped')notice(cleanError(change.error||run.error||'Um trecho não pôde ser processado. A transcrição foi preservada.'));if(change.phase==='stopped'&&listening)stopMic();if(!renderFrame)renderFrame=requestAnimationFrame(render);saveSoon();}
function draft(title='Nova reunião'){
 const stamp=new Date().toISOString(),id=crypto.randomUUID();
 return {room_kind:roomKind(),schemaVersion:1,liveSchemaVersion:1,memorySchemaVersion:2,id,title,provider,threshold:.6,questions:NorteMemoryFlow.validateQuestions(NorteMemoryV2.questions),questionVersion:'memory-v2',createdAt:stamp,startedAt:null,status:'draft',batch:{batch_id:id,cases:[]},records:[],calls:0,meeting_events:[],meeting_threads:[],meeting_relations:[],raw_window:[],transcript:[],topic_titles:{},meeting_commands:[]};
}
async function createInstant(){
 if(isRunning()||!initialized)return;
 starting=true;controls();
 try{
  if(current&&!await save())return;
  current=draft();controller=null;mode=null;closing=false;lastTranscript='';canvas.reset();
  $('roomTitle').value=current.title;$('roomImportText').value='';$('roomFile').value='';$('roomFileLabel').textContent='Selecionar arquivo';$('roomImportError').textContent='';filename='transcricao.txt';
  view='room';notice('');transcriptPanel(true);renderView();render();await save();$('roomTitle').focus();
 }finally{starting=false;controls();}
}
async function openMeeting(id){
 if(isRunning()||!db)return false;
 starting=true;controls();
 try{
  if(current&&!await save())return false;
  const raw=await db.read(saveKey(id));if(!raw)throw Error('Não foi possível encontrar esta reunião.');
  const saved=Session.restore(JSON.parse(raw));
  current=saved;controller=null;mode=current.input_mode||null;lastTranscript='';canvas.reset();
  $('roomTitle').value=current.title;view='room';transcriptPanel(true);renderView();
  notice(current.status==='interrupted'?'Esta reunião foi interrompida. Os registros recebidos foram preservados; gere a ata com os avisos de revisão.':'');render();return true;
 }catch(error){notice(cleanError(error));return false;}
 finally{starting=false;controls();}
}
async function showLibrary(){
 if(isRunning())return false;
 starting=true;controls();
 try{
  if(current&&!await save())return false;
  view='library';notice('');renderLibrary();renderView();return true;
 }finally{starting=false;controls();}
}
async function begin(nextMode){
 if(isRunning()||current?.status!=='draft')return false;
 starting=true;controls();
 if(!await checkHealth()){starting=false;controls();return false;}
 const previous=current;
 try{
  notice('');mode=nextMode;lastTranscript='';canvas.reset();closing=false;
  if(previous.room_kind==='beam')await ensureBeam();
  controller=Session.create({provider,title:$('roomTitle').value.trim()||'Nova reunião',send,onChange:changed,commandHandler:previous.room_kind==='beam'?beamIntegration.handleCommand:null});
  current=controller.run;
  current.room_kind=previous.room_kind||'meeting';for(const key of ['beam_started','beam_open_tabs','beam_previous_view'])if(previous[key]!==undefined)current[key]=previous[key];if(previous.beam_view)current.beam_view=previous.beam_view;if(previous.beam_recorded)current.beam_recorded=previous.beam_recorded;if(previous.beam_lab)current.beam_lab=previous.beam_lab;if(previous.beam_commands)current.beam_commands=previous.beam_commands;
  current.id=previous.id;current.batch.batch_id=previous.id;current.createdAt=previous.createdAt;current.input_mode=nextMode;
  return true;
 }catch(error){controller=null;current=previous;notice(cleanError(error));return false;}
 finally{starting=false;render();saveSoon();}
}
function renameTopic(id,title){renaming=id;$('roomRenameValue').value=current?.topic_titles?.[id]||current?.meeting_threads.find(t=>t.thread_id===id)?.title||'';const n=Number(id.replace(/\D/g,''));$('roomRenameHint').textContent='Por voz: “Norte, o assunto '+n+' é [nome do assunto]”.';$('roomRenameDialog').showModal();$('roomRenameValue').focus();}
$('roomRenameForm').onsubmit=e=>{e.preventDefault();const name=$('roomRenameValue').value.trim();if(!name||!current||!renaming)return;current.topic_titles||={};current.topic_titles[renaming]=name;for(const t of current.meeting_threads)if(t.thread_id===renaming)t.title=name;current.title_edits||=[];current.title_edits.push({thread_id:renaming,title:name,source:'manual',at:new Date().toISOString()});$('roomRenameDialog').close();render();saveSoon();};$('roomRenameCancel').onclick=()=>$('roomRenameDialog').close();
function transcriptPanel(open){$('meetingPage').classList.toggle('has-transcript',open);$('roomTranscriptPanel').hidden=!open;if($('roomTranscriptDivider'))$('roomTranscriptDivider').hidden=!open;$('roomTranscriptToggle').setAttribute('aria-expanded',String(open));window.NorteLayout?.refresh();}
$('roomTranscriptToggle').onclick=()=>transcriptPanel($('roomTranscriptPanel').hidden);
$('roomTitle').onchange=()=>{if(current){current.title=$('roomTitle').value.trim()||'Nova reunião';saveSoon();}};
$('roomMinutes').onclick=()=>{if(current)NorteGeminiMinutes.open(current,{autoGenerate:false,onExplore:inspectEvidence,onUpdate:async run=>{if(current?.id!==run.id)return;current=run;controller=null;render();await save();}});};
$('roomImport').onclick=()=>{$('roomImportDialog').showModal();$('roomImportText').focus();};$('roomImportClose').onclick=()=>$('roomImportDialog').close();let filename='transcricao.txt';
async function loadFile(file){if(!file)return;if(file.size>2_000_000){$('roomImportError').textContent='O arquivo é grande demais. Use uma transcrição de até 500 mil caracteres.';return;}try{const text=await file.text();Session.parseTranscriptEntries(text,file.name);filename=file.name;$('roomImportText').value=text;$('roomFileLabel').textContent=file.name;$('roomImportError').textContent='';}catch(e){$('roomImportError').textContent=cleanError(e);}}
$('roomImportText').oninput=()=>{filename='transcricao.txt';$('roomImportError').textContent='';};
$('roomFile').onchange=()=>loadFile($('roomFile').files[0]);$('roomDrop').ondragover=e=>{e.preventDefault();};$('roomDrop').ondrop=e=>{e.preventDefault();loadFile(e.dataTransfer.files[0]);};
$('roomImportForm').onsubmit=async e=>{e.preventDefault();let parts;try{parts=Session.parseTranscriptEntries($('roomImportText').value,filename);}catch(error){$('roomImportError').textContent=cleanError(error);return;}$('roomImportSubmit').disabled=true;try{if(!await begin('import'))return;for(const part of parts)appendTurn(part,'import');current.import_filename=filename;$('roomImportDialog').close();await controller.close();await save();}catch(error){notice(cleanError(error));controller?.stop(error);}finally{$('roomImportSubmit').disabled=false;render();}};
$('roomTextForm').onsubmit=async e=>{e.preventDefault();const text=$('roomText').value;if(!text.trim())return;if(current?.status==='draft'&&roomKind()==='beam'&&!await begin('text'))return;if(!controller?.accepting)return;try{appendTurn({text,segmentId:'typed:'+crypto.randomUUID()},'typed');$('roomText').value='';}catch(error){notice(cleanError(error));}};
function elapsed(){return Math.max(0,Date.now()-Date.parse(current?.startedAt||new Date().toISOString()));}
function ingestSpeech(event){if(!ledger||!current)return;ledger.ingest(event.results,event.resultIndex,elapsed(),$('roomLanguage').value);for(const [index,record] of ledger.records.entries()){if(record.status!=='final'||consumed.has(record.id))continue;consumed.add(record.id);try{if(controller?.accepting){const previous=ledger.records[index-1],continues=previous?.status==='final'&&previous.speaker===record.speaker&&record.startMs-previous.endMs<2000;appendTurn({text:record.text,sourceText:record.text,sourceId:record.id,segmentId:'microphone:'+ledger.sessionId+':'+record.id,offsetMs:record.startMs,speaker:record.speaker,...(continues?{speechContext:NorteMeetingSpeech.boundedContext(previous.text)}:{})},'microphone');}else{current.transcript.push({id:'AUDIO-'+record.id,text:record.text,source:'microphone',segmentId:'microphone:'+ledger.sessionId+':'+record.id,speaker:record.speaker,receivedAt:new Date().toISOString(),offsetMs:record.startMs,status:'interrupted',error:'Fala preservada após a interrupção; não foi processada.'});if(!renderFrame)renderFrame=requestAnimationFrame(render);}}catch(error){notice(cleanError(error));stopMic();break;}}
 const interim=ledger.records.filter(r=>r.status==='interim').map(r=>r.text).join(' ');$('roomInterim').textContent=interim.trim().split(/\s+/u).slice(-18).join(' ');current.speech_ledger=ledger.snapshot();saveSoon();}
function launchRecognition(){if(!listening||micStopping||recognition)return;const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;const instance=new Recognition();recognition=instance;instance.lang=$('roomLanguage').value;instance.continuous=true;instance.interimResults=true;ledger.beginRun();
 const capture=new NorteWindows.CaptureWindow({onBoundary:()=>{
  if(instance!==recognition)return;
  // Keep accepting the final result after stop; never promote an interim guess.
  recognitionDeadline=setTimeout(()=>{if(instance!==recognition)return;try{instance.abort();}catch(_){}setTimeout(()=>{if(instance===recognition)instance.onend();},0);},6000);
  try{instance.stop();}catch(_){instance.onend();}
 }});recognitionWindow=capture;
 instance.onstart=()=>{if(instance!==recognition)return;if(capture.startedAt===null)capture.start();};
 instance.onspeechstart=()=>{if(instance===recognition)ledger.speechStart(elapsed());};instance.onresult=event=>{if(instance!==recognition)return;recognitionErrors=0;ingestSpeech(event);};
 instance.onspeechend=()=>{if(instance===recognition)capture.speechEnd();};
 instance.onerror=event=>{if(instance!==recognition||event.error==='no-speech'||(event.error==='aborted'&&micStopping))return;recognitionErrors++;listening=false;micPaused=true;notice(({ 'not-allowed':'O microfone não foi autorizado. Permita o acesso no navegador ou importe uma transcrição.','audio-capture':'Não foi possível acessar o microfone. Confira o dispositivo.','network':'A transcrição perdeu a conexão. Você pode retomar o microfone ou continuar por texto.','service-not-allowed':'Este navegador não autorizou a transcrição. Use um navegador compatível ou importe o texto.'})[event.error]||'A captura de fala foi interrompida. Você pode retomar o microfone.');controls();};
 instance.onend=()=>{if(instance!==recognition)return;capture.end();clearTimeout(recognitionDeadline);recognitionDeadline=null;recognitionWindow=null;ledger.finishRun();if(current){current.speech_ledger=ledger.snapshot();saveSoon();}$('roomInterim').textContent='';recognition=null;if(!renderFrame)renderFrame=requestAnimationFrame(render);micEnd?.();micEnd=null;if(listening&&controller?.accepting)restartTimer=setTimeout(()=>launchRecognition(),0);controls();};
 try{instance.start();capture.start();}catch(error){capture.end();listening=false;micPaused=true;recognition=null;recognitionWindow=null;notice('Não foi possível iniciar o microfone. Você pode importar a transcrição.');controls();}
}
function stopMic(){
 if(stopPromise)return stopPromise;
 listening=false;micPaused=true;clearTimeout(restartTimer);
 if(!recognition){controls();return Promise.resolve();}
 micStopping=true;controls();const instance=recognition;
 stopPromise=new Promise(resolve=>{
  let timer,ended=false;
  const done=()=>{if(ended)return;ended=true;clearTimeout(timer);micEnd=null;resolve();};
  micEnd=done;
  timer=setTimeout(()=>{try{instance.abort();}catch(_){}if(recognition===instance){ledger.finishRun();current.speech_ledger=ledger.snapshot();recognition=null;saveSoon();}notice('A captura demorou a encerrar. Falas sem confirmação permanecem no registro de áudio.');done();},6000);
  try{if(recognitionWindow)recognitionWindow.request('manual');else instance.stop();}catch(_){if(recognition===instance){ledger.finishRun();current.speech_ledger=ledger.snapshot();recognition=null;saveSoon();}done();}
 }).finally(()=>{micStopping=false;stopPromise=null;controls();});
 return stopPromise;
}
async function toggleRecording(){
 if(micStopping||closing||starting)return;
 if(controller?.accepting&&mode==='text'){
  if(!window.SpeechRecognition&&!window.webkitSpeechRecognition){notice('Este navegador não oferece transcrição por voz. Continue por texto ou use um navegador compatível.');return;}
  mode='live';current.input_mode='live';ledger=new NorteTranscript.Ledger();consumed=new Set();
 }
 if(listening){await stopMic();controls();return;}
 if(controller?.accepting&&mode==='live'){notice('');listening=true;micPaused=false;launchRecognition();controls();return;}
 if(!(window.SpeechRecognition||window.webkitSpeechRecognition)){notice('A fala ao vivo não está disponível neste navegador. Use Chrome com microfone habilitado ou importe uma transcrição.');return;}
 if(!await begin('live'))return;
 ledger=new NorteTranscript.Ledger();consumed=new Set();listening=true;micPaused=false;launchRecognition();controls();
}
$('roomLive').onclick=toggleRecording;$('roomMic').onclick=toggleRecording;
$('roomFinish').onclick=async()=>{if(!controller||closing)return;closing=true;controls();try{await stopMic();await controller.close();await save();}catch(error){notice(cleanError(error));controller?.stop(error);}finally{closing=false;render();}};
$('roomStop').onclick=async()=>{if(!controller||closing)return;closing=true;controls();try{controller.stop();await controller.done;await save();}finally{closing=false;render();}};
$('roomConnectionsToggle').onclick=()=>{const visible=!canvas.getConnectionsVisible();canvas.setConnectionsVisible(visible);$('roomConnectionsToggle').setAttribute('aria-pressed',String(visible));};
$('roomCounts').onclick=()=>{const open=$('roomTopicsMenu').hidden;$('roomTopicsMenu').hidden=!open;$('roomCounts').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',event=>{if(!event.target.closest('.room-topic-browser')){$('roomTopicsMenu').hidden=true;$('roomCounts').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('roomTopicsMenu').hidden=true;$('roomCounts').setAttribute('aria-expanded','false');}});
function zoomLabel(){ $('roomZoom').textContent=Math.round(canvas.getZoom()*100)+'%'; }
$('roomCanvas').addEventListener('norte:canvas-zoom',zoomLabel);
$('roomZoomIn').onclick=()=>{canvas.setZoom(canvas.getZoom()+.1);zoomLabel();};
$('roomZoomOut').onclick=()=>{canvas.setZoom(canvas.getZoom()-.1);zoomLabel();};
$('roomFit').onclick=()=>{canvas.fit();zoomLabel();};
$('roomNew').onclick=()=>{$('roomCreateMenu').hidden=!$('roomCreateMenu').hidden;$('roomNew').setAttribute('aria-expanded',String(!$('roomCreateMenu').hidden));if(!$('roomCreateMenu').hidden)$('roomCreateInstant').focus();};
$('roomCreateInstant').onclick=createInstant;$('roomBack').onclick=showLibrary;
document.addEventListener('click',event=>{if(!$('roomCreateMenu').hidden&&!$('roomCreateMenu').contains(event.target)&&!$('roomNew').contains(event.target)){$('roomCreateMenu').hidden=true;$('roomNew').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('roomCreateMenu').hidden){$('roomCreateMenu').hidden=true;$('roomNew').setAttribute('aria-expanded','false');$('roomNew').focus();}});
window.addEventListener('norte:page-changed',renderView);
window.addEventListener('beforeunload',e=>{if(isRunning()){e.preventDefault();e.returnValue='';}save();});
setInterval(()=>{if(current&&view==='room')controls();},1000);
window.NorteMeetingRoom={isRunning,snapshot,whenIdle:()=>controller?.done||Promise.resolve(current),flushStorage:save,ready:()=>ready,view:()=>(current?.room_kind||'meeting')===roomKind()?view:'library',openMeeting,showLibrary};
controls();
if(inAccount)$('roomSave').textContent='Na sua conta';
try{db=inAccount?await NorteRemoteStorage.open():await NorteMemoryStorage.open();if(!inAccount)await resetLegacyMeetings();history=JSON.parse(await db.read(INDEX)||'[]');}catch(error){notice(cleanError(error));}
initialized=true;renderLibrary();transcriptPanel(true);renderView();render();zoomLabel();await checkHealth();
}
})();
