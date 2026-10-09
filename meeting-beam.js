/* Beam meetings extend the existing room: one transcript, memory and document. */
(function(root){
'use strict';
const copy=value=>JSON.parse(JSON.stringify(value));
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const fmt=value=>Number.isFinite(value)?Number(value.toPrecision(7)).toLocaleString('pt-BR',{maximumFractionDigits:7}):'indisponível';
function facts(data,commandId='manual'){
 const state=data.state,version=data.version||data.versions?.find(v=>v.id===data.currentId)||data.versions?.at(-1);
 if(!state)return [];
 const versionId=version?.id||data.currentId||'base',id='SIM-'+versionId;
 const engine=root.NorteBeamEngine,reactions=engine.calculate(copy(state)),results=reactions.valid?engine.structuralResults(copy(state),reactions):null;
 const supports=state.supports.map(p=>p.name+' '+({fixed:'engastado',pin:'articulado',roller:'rolete'})[p.type]+' em '+fmt(p.x)+' m').join('; ')||'sem apoios';
 const loads=state.loads.map(p=>p.name+': '+fmt(p.value)+(p.kind==='mass'?' kg':p.kind==='udl'?' N/m':p.kind==='moment'?' N·m':' N')+' em '+fmt(p.x)+' m'+(p.kind==='udl'?' até '+fmt(p.end)+' m':'')+(p.kind==='mass'?'':p.kind==='moment'?(p.direction===1?' anti-horário':' horário'):(p.direction===1?' para baixo':' para cima'))).join('; ')||'sem cargas';
 const section=state.section,material=state.material;
 const configuration='viga de '+fmt(state.L)+' m; apoios '+supports+'; cargas '+loads+'; massa própria aplicada '+fmt(state.mbar)+' kg; g '+fmt(state.g)+' m/s²; seção '+(section.shape==='i'?'I':'retangular')+' com largura '+fmt(section.b)+' m e altura '+fmt(section.h)+' m'+(section.shape==='i'?', alma '+fmt(section.tw)+' m e mesas '+fmt(section.tf)+' m':'')+'; material '+(engine.materialLibrary?.[material.key]?.name||material.key)+', E '+fmt(material.E/1e9)+' GPa, escoamento '+fmt(material.yield/1e6)+' MPa, densidade '+fmt(material.rho)+' kg/m³';
 const origin={version_id:versionId,command_id:commandId,state:copy(state),computed_at:new Date().toISOString()};
 const output=[{kind:'proposal',text:'Teste de simulação '+id+': calcular esforços, tensões e deslocamento para '+configuration+'.',simulation:{...origin,kind:'test_proposal'}}];
 if(!results){output.push({kind:'result',text:'A simulação '+id+' não produziu resultados válidos: '+reactions.error+'. Configuração: '+configuration+'.',simulation:{...origin,kind:'invalid_configuration'}});return output;}
 output.push({kind:'result',text:'Resultado calculado da simulação '+id+': esforço cortante máximo absoluto '+fmt(Math.abs(results.d.Vmax)/1000)+' kN; momento fletor máximo absoluto '+fmt(Math.abs(results.d.Mmax)/1000)+' kN·m; tensão normal máxima '+fmt(results.sigma/1e6)+' MPa; tensão de cisalhamento máxima '+fmt(results.tau/1e6)+' MPa; deslocamento máximo absoluto '+fmt(results.deflection.max*1000)+' mm. Reações: '+reactions.reactions.map(r=>r.name+' = '+fmt(r.R/1000)+' kN e '+fmt(r.M/1000)+' kN·m').join('; ')+'.'+(reactions.warning?' Atenção: '+reactions.warning+'.':'')+' Configuração: '+configuration+'.',simulation:{...origin,kind:'test_result'}});
 return output;
}
function create({getRun,save,notice,submit,submitFacts,canSubmit}){
 const $=id=>document.getElementById(id),panel=document.querySelector('.room-canvas-panel'),stage=document.querySelector('.room-canvas-stage'),view=document.querySelector('.room-view'),canvasTitle=view.querySelector('h2');
 const tabs=el('div','beam-room-tabs');tabs.id='beamRoomTabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Vistas da reunião');
 const host=el('section','beam-room-host');host.id='beamRoomHost';host.hidden=true;host.setAttribute('role','tabpanel');host.setAttribute('aria-label','Simulação da viga');
 const tabLabels={canvas:'Canvas',simulation:'Simulação',graphs:'Gráficos',results:'Resultados',calculations:'Cálculos'};
 let enabled=false,workspace=null,runId=null,tab='canvas',previousTab='canvas',processing=false,recorded=new Set(),lastHint='',dismissedHint='',openedTabs=new Set(Object.keys(tabLabels));
 const commandBar=el('form','beam-command-bar');commandBar.id='beamCommandForm';
 const label=el('label','room-visually-hidden','Pedido para a simulação');label.htmlFor='beamCommandText';
 const input=el('input','beam-command-input');input.id='beamCommandText';input.autocomplete='off';input.maxLength=1200;input.placeholder='Ex.: vamos simular uma viga · mude a força P1 para 12 kN';
 const send=el('button','compact-button','Enviar');send.type='submit';
 const close=el('button','text-button','Fechar');close.type='button';
 commandBar.append(label,input,send,close);commandBar.hidden=true;
 const feedback=el('div','beam-command-feedback');feedback.id='beamCommandFeedback';feedback.hidden=true;feedback.setAttribute('aria-live','polite');
 const feedbackText=el('span'),correct=el('button','text-button','Entendeu'),incorrect=el('button','text-button','Não era isso');correct.type=incorrect.type='button';
 let feedbackCommand=null;
 for(const [button,value] of [[correct,true],[incorrect,false]])button.onclick=()=>{root.NorteAI?.feedback(getRun(),feedbackCommand,value);feedbackText.textContent='Retorno registrado para melhorar a interpretação.';correct.hidden=incorrect.hidden=true;};
 feedback.append(feedbackText,correct,incorrect);
 const compose=el('button','text-button beam-compose-toggle','Escrever');compose.type='button';compose.id='beamComposeToggle';compose.setAttribute('aria-controls','beamCommandForm');compose.setAttribute('aria-expanded','false');compose.setAttribute('aria-label','Escrever um pedido para a simulação');
 document.querySelector('.room-view-options').prepend(compose);
 function composer(open){commandBar.hidden=!enabled||!open;compose.setAttribute('aria-expanded',String(open&&enabled));if(open&&enabled)input.focus();}
 compose.onclick=()=>composer(commandBar.hidden);close.onclick=()=>composer(false);input.onkeydown=event=>{if(event.key==='Escape')composer(false);};
 const hint=el('aside','beam-discussion-suggestion');hint.id='beamSimulationSuggestion';hint.hidden=true;hint.setAttribute('aria-label','Sugestão para testar a hipótese');
 const discover=el('aside','beam-discover');discover.id='beamDiscover';discover.hidden=true;
 const discoverCopy=el('div','beam-discover-copy');discoverCopy.append(el('strong','','Da conversa ao cálculo'),el('span','','Abra a simulação pelas abas ou diga “vamos simular uma viga”. Depois, peça alterações com suas palavras.'));
 const discoverOpen=el('button','compact-button','Abrir simulação');discoverOpen.type='button';discoverOpen.onclick=()=>showTab('simulation',{manual:true});
 discover.append(discoverCopy,discoverOpen);
 const hintCopy=el('div','beam-suggestion-copy'),hintTitle=el('strong','','Teste em discussão'),hintText=el('span','');hintText.setAttribute('aria-live','polite');hintCopy.append(hintTitle,hintText);
 const open=el('button','compact-button','Abrir simulação');open.type='button';open.onclick=()=>{dismissedHint=lastHint;showTab('simulation',{manual:true});};
 const dismiss=el('button','text-button beam-suggestion-dismiss','×');dismiss.type='button';dismiss.setAttribute('aria-label','Dispensar sugestão de simulação');dismiss.onclick=()=>{dismissedHint=lastHint;hint.hidden=true;};hint.append(hintCopy,open,dismiss);
 $('meetingPage').insertBefore(discover,$('roomWorkspace'));$('meetingPage').insertBefore(hint,$('roomWorkspace'));panel.append(host);view.prepend(tabs);$('meetingPage').insertBefore(commandBar,$('roomSessionBar'));$('meetingPage').insertBefore(feedback,$('roomSessionBar'));
 for(const [key,title] of Object.entries(tabLabels)){const b=el('button','beam-room-tab',title);b.type='button';b.id='beamTab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls',key==='canvas'?'roomCanvas':'beamRoomHost');b.onclick=()=>showTab(key,{manual:true});tabs.append(b);}
 tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const list=Object.keys(tabLabels).filter(key=>openedTabs.has(key)),index=list.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowRight'?1:-1)+list.length)%list.length;showTab(list[next]);$('beamTab-'+list[next]).focus();});
 function writeStatus(text,kind=''){if(kind==='review')notice(text);}
 function ensureWorkspace(){
  const run=getRun();if(!run||run.room_kind!=='beam')return null;
  if(workspace&&runId===run.id)return workspace;
  workspace?.destroy();runId=run.id;recorded=new Set(run.beam_recorded||[]);lastHint='';dismissedHint='';hint.hidden=true;
  // All capabilities are discoverable; preserve the user's selected view.
  const started=run.beam_started===true;
  tab=started&&Object.hasOwn(tabLabels,run.beam_view)?run.beam_view:'canvas';previousTab=started&&Object.hasOwn(tabLabels,run.beam_previous_view)?run.beam_previous_view:'canvas';
  openedTabs=new Set(Object.keys(tabLabels));
  workspace=root.NorteBeamWorkspace.mount(host,{data:run.beam_lab,onChange(data,detail){const current=getRun();if(current?.id!==runId)return;current.beam_lab=data;save();},onTabChange(next){if(next!==tab)showTab(next);},onRecord:async data=>{
   const key=data.version?.id||data.currentId;if(recorded.has(key)){writeStatus('Esta versão já foi registrada na reunião.');return false;}
   if(!await submitFacts(facts(data)))return false;
   recorded.add(key);getRun().beam_recorded=[...recorded];save();writeStatus('Resultado enviado para o mapa e a ata.');return true;
  }});
  run.beam_lab=workspace.snapshot();save();return workspace;
 }
 function showTab(next,{manual=false}={}){
  if(!Object.hasOwn(tabLabels,next))next='simulation';
  const run=getRun();if(enabled)ensureWorkspace();if(next!==tab)previousTab=tab;tab=next;openedTabs.add(tab);
  if(enabled){run.beam_view=tab;run.beam_previous_view=previousTab;run.beam_open_tabs=[...openedTabs];if(tab!=='canvas')run.beam_started=true;save();}
  for(const b of tabs.children){const key=b.id.slice('beamTab-'.length),selected=key===tab;b.hidden=!openedTabs.has(key);b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;}
  stage.hidden=enabled&&tab!=='canvas';host.hidden=!enabled||tab==='canvas';
  $('roomConnectionsToggle').hidden=enabled&&tab!=='canvas';view.querySelector('.room-topic-browser').hidden=enabled&&tab!=='canvas';
  if(enabled&&tab!=='canvas')workspace?.showTab(tab);
  if(enabled&&manual)root.NorteAI?.record({id:root.crypto.randomUUID(),session_id:run.id,kind:'intent',text:tabLabels[tab],intent:({simulation:'open_simulation',graphs:'show_graphs',results:'show_results',calculations:'show_calculations',canvas:'show_canvas'})[tab],status:'success',source:'ui',latency_ms:0,details:{trigger:'tab'}});
  refreshHintVisibility(run);
 }
 function activate(active,run){
  enabled=active;tabs.hidden=!active;compose.hidden=!active;if(!active){composer(false);feedback.hidden=true;}refreshHintVisibility(run);canvasTitle.hidden=active;panel.classList.toggle('has-beam',active);
  if(active){ensureWorkspace();showTab(tab);}else{stage.hidden=false;host.hidden=true;$('roomConnectionsToggle').hidden=false;view.querySelector('.room-topic-browser').hidden=false;}
 }
 function refreshHintVisibility(run){hint.hidden=!enabled||run?.id!==runId||!['draft','running'].includes(run?.status)||tab!=='canvas'||!lastHint||lastHint===dismissedHint;discover.hidden=!enabled||run?.id!==runId||tab!=='canvas'||run?.beam_started===true;}
 function suggestionFor(event){
  const text=String(event?.text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const target=/\bespessura\b/.test(text)?'a espessura':/\b(altura|largura|secao)\b/.test(text)?'a seção da viga':/\b(comprimento|tamanho)\b/.test(text)?'o comprimento da viga':/\b(forca|carga|carregamento)\b/.test(text)?'o carregamento':/\b(apoio|suporte|engaste)\b/.test(text)?'os apoios':'essa hipótese';
  return 'Para testar '+target+', peça, por exemplo: “vamos simular uma viga” ou use as abas acima.';
 }
 function update(run){
  if(!enabled||run?.id!==runId)return;
  const accepting=canSubmit?canSubmit():run.status==='draft'||run.status==='running';input.disabled=processing||!accepting;send.disabled=processing||!accepting;
  const events=root.NorteMeetingEvidence.project(run).run.meeting_events||[],candidate=[...events].reverse().find(e=>['hypothesis','test_proposal'].includes(e.type));
  const key=candidate?.event_id||'';if(key!==lastHint){lastHint=key;hint.dataset.eventId=key;hintText.textContent=key?suggestionFor(candidate):'';}refreshHintVisibility(run);
 }
 commandBar.onsubmit=async event=>{event.preventDefault();if(!input.value.trim()||processing)return;const text=input.value.trim();if(await submit(text)){input.value='';composer(false);}};
 async function handleCommand(text,{run,entry,sourceEntries=[entry],send:transport,provider,isActive}){
  const ws=ensureWorkspace();if(!ws)return null;
  // Ordinary meeting utterances continue through the original classifier.
  const origin=Date.parse(run.startedAt||run.createdAt),eventTime=item=>Number.isFinite(origin)&&Number.isFinite(item?.offsetMs)?origin+item.offsetMs:Date.parse(item?.receivedAt||'');
  const sourceIds=new Set(sourceEntries.map(item=>item.id)),lastSource=sourceEntries.at(-1)||entry,nowMs=eventTime(lastSource)||Date.now(),firstMs=eventTime(entry)||nowMs;
  // Recognition and model responses can arrive late. Resolve context by the
  // captured speech timeline, never by response/array arrival order.
  const auditTime=audit=>{
   if(Number.isFinite(audit.source_end_offset_ms)&&Number.isFinite(origin))return origin+audit.source_end_offset_ms;
   const source=run.transcript.find(item=>item.id===audit.chunk_id);return source?eventTime(source):Date.parse(audit.created_at||'');
  };
  const history=(run.beam_commands||[]).map((audit,index)=>({audit,index,at:auditTime(audit)})).filter(row=>Number.isFinite(row.at)&&row.at<=firstMs&&(!row.audit.speaker||!entry.speaker||row.audit.speaker===entry.speaker)).sort((a,b)=>a.at-b.at||a.index-b.index).map(row=>({...row.audit,created_at:new Date(row.at).toISOString()}));
  const lastCommand=[...history].reverse().find(c=>c.status==='applied'),last=history.at(-1),pendingAudit=last&&last.status!=='applied'?last:null;
  const recent=run.transcript.map((item,index)=>({item,index,at:eventTime(item)})).filter(({item,at})=>item.source!=='simulation'&&!sourceIds.has(item.id)&&['done','command'].includes(item.status)&&Number.isFinite(at)&&at<=firstMs).sort((a,b)=>a.at-b.at||a.index-b.index).slice(-6);
  const context={recentTranscript:recent.map(({item,at})=>({id:item.id,text:item.text,offsetMs:item.offsetMs,source:item.source,speaker:item.speaker,command_id:item.command?.id,created_at:new Date(at).toISOString()})),pendingAudit,lastCommand};
  const options={active:!!run.beam_started,activeTab:tab,simulationFocus:ws.snapshot().simulationFocus,previousTab,availableTabs:[...openedTabs],context,source:entry.source,speaker:entry.speaker,nowMs};
  const candidate=root.NorteBeamCommands.isCandidate?.(text,{...options,state:ws.snapshot().state});
  const guarded=root.NorteBeamCommands.interpret(text,{...options,state:ws.snapshot().state}).guarded;
  if(!guarded&&root.NorteAI?.possibleRequest(text))entry.ai_replay_state=copy(ws.snapshot().state);
  const recovery=!candidate&&!guarded?await root.NorteAI?.resolve(text,run.id):null;
  if(!isActive()||getRun()?.id!==run.id)return {consumed:true,status:'interrupted',message:'Comando interrompido.'};
  if(!candidate&&!recovery)return null;
  ws.flushPending();const before=ws.snapshot(),state=copy(before.state);processing=true;host.inert=true;update(run);writeStatus('Interpretando o comando…');
  let audit;
  try{
   audit=await root.NorteBeamCommands.process(recovery?'abrir simulação':text,{state,run,transport,provider,...options});
   if(recovery){audit.raw_text=text;audit.interpretation_source=recovery.source;audit.rule_id=recovery.rule_id||null;audit.normalizations.push({kind:'learned_intent',from:text,to:audit.interpreted_text,rule_id:audit.rule_id});if(audit.candidate)audit.candidate.raw_text=text;}
   audit.beam_state_before=state;
   if(!isActive()||getRun()?.id!==run.id)return {consumed:true,status:'interrupted',message:'Comando interrompido.'};
   if(!audit?.consumed)return null;
   audit.id='BC'+String((run.beam_commands?.length||0)+1).padStart(4,'0');audit.text=text;audit.chunk_id=entry.id;audit.created_at=new Date(nowMs).toISOString();audit.processed_at=new Date().toISOString();audit.speaker=entry.speaker;audit.source_entry_ids=[...sourceIds];audit.source_offset_ms=entry.offsetMs;audit.source_end_offset_ms=lastSource.offsetMs;
   if(audit.status==='proposed'){
    const newerApplied=(run.beam_commands||[]).some(command=>command.status==='applied'&&auditTime(command)>nowMs);
    if(newerApplied){audit.status='stale';audit.message='Esta fala chegou depois de uma alteração mais recente. Repita o pedido se ainda quiser aplicá-lo.';}
    else if(JSON.stringify(ws.snapshot().state)!==JSON.stringify(state)){audit.status='stale';audit.message='A configuração mudou durante o comando. Repita a instrução sobre a versão atual.';}
    else{
     ws.applyOperations(audit.operations.filter(o=>o.type!=='show_canvas'),{source:entry.source==='microphone'?'voice':'text',label:audit.interpreted_text||text,command_id:audit.id});
     const after=ws.snapshot(),changed=JSON.stringify(before.state)!==JSON.stringify(after.state);
     audit.status='applied';audit.message='Comando aplicado.';audit.version_id=after.currentId;
     if(changed||audit.operations.some(o=>o.type==='open_simulation')&&!recorded.has(after.currentId))audit.memory=facts(after,audit.id);
     const viewOp=[...audit.operations].reverse().find(o=>['show_canvas','show_graphs','show_results','show_calculations','compare','open_simulation','show_section'].includes(o.type));
     const next=viewOp?.type==='show_canvas'?'canvas':viewOp?.type==='show_graphs'||viewOp?.type==='compare'?'graphs':viewOp?.type==='show_results'?'results':viewOp?.type==='show_calculations'?'calculations':'simulation';showTab(next);
     if(audit.operations.some(o=>['change_section','show_section'].includes(o.type)))ws.showSection();
    }
   }
   (run.beam_commands||=[]).push(copy(audit));run.beam_lab=ws.snapshot();save();if(['applied','awaiting_continuation'].includes(audit.status))notice('');else writeStatus(audit.message||'Detalhe a instrução para continuar.','review');
   return audit;
  }catch(error){
   if(!isActive())return {consumed:true,status:'interrupted',message:'Comando interrompido.'};
   const failed={...audit,id:audit?.id||'BC'+String((run.beam_commands?.length||0)+1).padStart(4,'0'),text,chunk_id:entry.id,beam_state_before:state,consumed:true,status:'error',message:error.message};(run.beam_commands||=[]).push(copy(failed));save();writeStatus(error.message,'review');return failed;
  }finally{processing=false;host.inert=false;update(getRun());}
 }
 activate(false,null);
 function acknowledge(command,run){
  if(run?.id!==runId||!command?.id)return;
  feedbackCommand=command;feedback.hidden=!enabled;correct.hidden=incorrect.hidden=!root.NorteAI||command.status==='awaiting_continuation';feedbackText.textContent=command.status==='applied'?({open_simulation:'Simulação aberta.',show_graphs:'Gráficos abertos.',show_results:'Resultados abertos.',show_calculations:'Cálculos abertos.',show_canvas:'Canvas aberto.'})[command.operations?.[0]?.type]||'Alteração aplicada à viga.':command.message||'Pedido registrado.';
  if(command.memory_enqueued&&command.version_id){recorded.add(command.version_id);run.beam_recorded=[...recorded];}
  const saved=run.beam_commands?.find(c=>c.id===command.id);if(saved)Object.assign(saved,{memory_enqueued:command.memory_enqueued,memory_error:command.memory_error,message:command.message});
  if(command.memory_error)writeStatus(command.message,'review');save();
 }
 return {activate,update,handleCommand,acknowledge,showTab,snapshot:()=>workspace?.snapshot()};
}
root.NorteMeetingBeam={create,facts};
})(globalThis);
