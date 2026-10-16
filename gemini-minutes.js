(function(root){
'use strict';
const PREFIX='norte.gemini-minutes.v1.';
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn,cls='')=>{const n=el('button','gm-button '+cls,text);n.type='button';n.onclick=fn;return n;};
const plainWarning=text=>String(text||'').replace(/\s*A redação foi gerada por IA\.?/g,'').replace(/o modelo escolheu none com confiança insuficiente/gi,'não foi possível confirmar o vínculo com segurança');
function evidenceFor(run){
 const api=root.NorteMeetingEvidence||(typeof require==='function'?require('./meeting-evidence.js'):null);
 if(!api)throw Error('O filtro de confiabilidade da reunião não foi carregado. Atualize a página.');
 return api.project(run);
}
function explicitTitle(run,id,ordinal=1){
 const manual=String(run.topic_titles?.[id]||'').trim();if(manual)return manual;
 const suggestion=run.block_review?.titles?.[id],events=(run.meeting_events||[]).filter(e=>e.thread_id===id);
 if(suggestion?.text&&suggestion.basis?.length===events.length&&suggestion.basis.every(b=>events.some(e=>e.event_id===b.id&&e.text===b.text)))return suggestion.text;
 return 'Assunto '+ordinal+': sem título';
}
function topicHeading(topic,index){return presentation().topicHeading(topic,index);}
function meetingMetadata(run){
 const meta=run.meeting_metadata||{},imported=run.input_mode==='import',start=meta.started_at||(!imported?run.startedAt:null),end=meta.ended_at||(!imported?run.finishedAt:null);
 const date=Number.isFinite(Date.parse(start))?new Date(start):null;
 let duration=meta.duration_ms;
 if(!Number.isFinite(duration)&&Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end)))duration=Math.max(0,Date.parse(end)-Date.parse(start));
 if(!Number.isFinite(duration)&&run.input_mode==='import')duration=Math.max(0,...(run.transcript||[]).map(item=>Number(item.offsetMs)||0));
 const minutes=Number.isFinite(duration)?Math.floor(duration/60000):null,seconds=Number.isFinite(duration)?Math.floor(duration/1000)%60:null;
 return {title:String(meta.title||run.title||'Ata de reunião'),date:date?date.toLocaleDateString('pt-BR'):imported?'Não informada na transcrição':'Não informada',time:date?date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):imported?'Não informado na transcrição':'Não informado',duration:minutes!==null?(minutes>=60?Math.floor(minutes/60)+' h ':'')+(minutes%60)+' min'+(seconds?' '+seconds+' s':''):'Não informada',participants:(Array.isArray(meta.participants)?meta.participants.join(', '):String(meta.participants||'')).trim()||'Não informados'};
}
function api(name,file){const value=root[name]||(typeof require==='function'?require('./'+file):null);if(!value)throw Error('A revisão da ata ainda não foi carregada. Atualize a página.');return value;}
const amendments=()=>api('NorteMeetingAmendments','meeting-amendments.js');
const presentation=()=>api('NorteMeetingDocument','meeting-document.js');
function sourceFor(run){
 const trusted=evidenceFor(run).run,d=root.NorteMinutes.buildDocument(trusted),human=amendments().source?.(run),state=amendments().build(run).state;
 const events=(human?.events||d.source.events).filter(e=>state.byId[e.event_id]?.current!==false),ids=new Set(events.map(e=>e.event_id));
 const relations=(human?.relations||d.source.relations).filter(r=>ids.has(r.source_event_id||r.source_id)&&ids.has(r.target_event_id||r.target_id));
 return {run_id:d.source.run_id,batch_id:d.source.batch_id,events,relations,run_status:d.source.run_status,relation_status:d.source.relation_status,post_meeting_edits:[],extraction_warnings:[],threads:trusted.meeting_threads?.map((t,index)=>({thread_id:t.thread_id,title:explicitTitle(run,t.thread_id,index+1)}))||[]};
}
const currentSections=[['context','Contexto e requisitos'],['hypotheses','Hipóteses'],['tests','Testes realizados'],['results','Resultados'],['decisions','Decisões'],['actions','Pendências']];
const changeColumns=[['item','Item'],['before','Estado anterior'],['change','Mudança'],['current','Estado atual'],['reason','Motivo'],['consequences','Consequências']];
const eventText=event=>presentation().eventText(event),eventId=event=>presentation().eventId(event);
const entryLinks=(...args)=>presentation().entryLinks(...args),linkLabel=link=>presentation().linkLabel(link);
const sectionsForTopic=(...args)=>presentation().sectionsForTopic(...args),displayStatus=(...args)=>presentation().displayStatus(...args);
const pdfDocument=(...args)=>presentation().pdfDocument(...args);
function localDocument(run){
 const view=amendments().build(run),state=view.state;
 const topics=state.topics.map((t,index)=>({...t,thread_id:t.id||'unassigned',title:explicitTitle(run,t.id,index+1),untitled:explicitTitle(run,t.id,index+1)==='Assunto '+(index+1)+': sem título'}));
 const refs=new Map(Object.keys(state.byId).map((id,index)=>[id,'Ref. '+(index+1)]));
 const editor=api('NorteMeetingBlocks','meeting-blocks.js'),prepared=new Map((run.meeting_events||[]).flatMap(e=>{const manual=editor.manual(run,e.event_id),summary=manual?.text||(e.summary_source===e.text&&e.summary_origin==='prepared_example'?e.summary:null);return summary?[[e.event_id,{...e,summary}]]:[];}));
 const seen=new WeakSet(),label=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);const id=value.event_id||value.id;if(refs.has(id))value.ref_label=refs.get(id);const summary=prepared.get(id);if(summary&&value.text===summary.text)value.display_text=summary.summary;for(const child of Object.values(value)){if(Array.isArray(child))child.forEach(label);else if(child&&typeof child==='object')label(child);}};topics.forEach(label);
 const issues=view.issues||[],warnings=issues.map(issue=>({...issue,target_id:issue.event_id,event_ids:[issue.event_id],message:plainWarning(issue.message)}));
 return {title:'Tópicos discutidos',presentation:'current_only',topics,issues,warnings,invalid_edits:view.invalid_edits||[],mode:'local',meeting_url:presentation().meetingURL?.(run,root.location?.origin)||null,batch_id:run.batch?.batch_id||run.batch_id||'reuniao',event_count:state.metrics.events,metadata:meetingMetadata(run)};
}
function conciseText(text,source){
 if(typeof text!=='string'||!text.trim()||text.length>180||/[\r\n]/.test(text))return null;
 const values=s=>s.match(/\d+(?:[.,]\d+)*/g)||[],known=new Set(values(source));
 if(values(text).some(value=>!known.has(value)))return null;
 return text.trim();
}
const quoteText=text=>String(text).replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
function organizedDocument(run,result){
 const doc=localDocument(run),events=new Map(sourceFor(run).events.map(e=>[e.event_id,e]));
 for(const topic of doc.topics){
  const generated=(result.topics||[]).find(t=>(t.thread_id||'unassigned')===topic.thread_id),summary=generated?.summary;
  // Legacy introductions remain readable; new output edits each current point.
  if(!generated?.entries&&summary?.text&&summary.text.length<=400&&summary.event_ids?.length&&summary.event_ids.every(id=>events.has(id)&&(events.get(id).thread_id||'unassigned')===topic.thread_id)){topic.summary={text:summary.text,event_ids:[...summary.event_ids]};topic.history={...topic.history,summary:topic.summary};}
  const edits=new Map();
  for(const entry of generated?.entries||[]){const original=events.get(entry.event_id);if(!original||(original.thread_id||'unassigned')!==topic.thread_id)continue;const text=conciseText(entry.text,original.text);if(text)edits.set(entry.event_id,text);}
  const seen=new WeakSet(),apply=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);const id=value.event_id||value.id;if(edits.has(id)&&typeof value.text==='string'&&!api('NorteMeetingBlocks','meeting-blocks.js').manual(run,id))value.display_text=edits.get(id);for(const child of Object.values(value)){if(Array.isArray(child))child.forEach(apply);else if(child&&typeof child==='object')apply(child);}};apply(topic);
  topic.tables=[];
  for(const table of (generated?.tables||[]).slice(0,3)){
   if(typeof table.title!=='string'||table.title.length>100||!Array.isArray(table.columns)||!table.columns.length||table.columns.length>5||table.columns.some(c=>typeof c!=='string'||!c.trim()||c.length>60)||!Array.isArray(table.rows)||table.rows.length>16)continue;
   const rows=table.rows.filter(row=>{const source=events.get(row.event_id);return source&&(source.thread_id||'unassigned')===topic.thread_id&&Array.isArray(row.cells)&&row.cells.length===table.columns.length&&row.cells.every(cell=>typeof cell==='string'&&cell.length<=120&&(!cell.trim()||quoteText(source.text).includes(quoteText(cell))));});
   if(rows.length===table.rows.length&&rows.length)topic.tables.push({title:table.title,columns:[...table.columns],rows:rows.map(row=>({event_id:row.event_id,cells:[...row.cells]}))});
  }
 }
 doc.organization_diagnostics=(result.warnings||[]).map(w=>({...w,message:plainWarning(w.message)}));doc.mode='organized';return doc;
}
function warningIcon(){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 for(const [tag,attrs] of [['path',{d:'M12 3 22 21H2Z',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linejoin':'round'}],['path',{d:'M12 9v5',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round'}],['circle',{cx:'12',cy:'17.5',r:'1',fill:'currentColor'}]]){const child=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))child.setAttribute(key,value);svg.append(child);}return svg;
}
function open(run,options={}){
 const {autoGenerate=false,onUpdate,onExplore,readOnly=false}=options;
 if(readOnly)run=JSON.parse(JSON.stringify(run));
 const editsKey='norte.minutes-edits.v1.'+(run.id||run.run_id||root.NorteMinutes.fingerprint({events:run.meeting_events,relations:run.meeting_relations}));
 try{const saved=readOnly?null:JSON.parse(localStorage.getItem(editsKey)||'null');if(saved?.run_id===(run.id||run.run_id||null)&&Array.isArray(saved.edits)){const ids=new Set((run.post_meeting_edits||[]).map(e=>e.id));run.post_meeting_edits=[...(run.post_meeting_edits||[]),...saved.edits.filter(e=>!ids.has(e.id))];}}catch(_){}
 let source=sourceFor(run),sourceId=root.NorteMinutes.fingerprint(source),key=PREFIX+sourceId;
 const previous=document.querySelector('#gmDialog');if(previous){previous.close();previous.remove();}
 const dialog=el('dialog','gm-dialog');dialog.id='gmDialog';dialog.setAttribute('aria-labelledby','gmTitle');
 const documentPanel=el('div','gm-document'),header=el('header','gm-header'),title=el('h2','','Tópicos discutidos');title.id='gmTitle';header.append(title);
 const controls=el('div','gm-controls');header.append(controls);documentPanel.append(header);
 const notice=el('p','gm-notice');notice.setAttribute('role','status');documentPanel.append(notice);
 const paper=el('main','gm-paper'),aside=el('aside','gm-review');aside.hidden=true;aside.setAttribute('aria-label','Revisão do documento');documentPanel.append(paper);dialog.append(documentPanel,aside);document.body.append(dialog);
 let doc=null,reviewed={},controller=null,closed=false,reviewMode=null,recovering=false,railAnchor=null,exportRequested=false,exporting=false;
 const status=()=>{notice.textContent='';};
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify({sourceId,doc,reviewed,presentationVersion:10}));return true;}catch(_){notice.textContent='Não foi possível salvar esta ata no navegador. Exporte as correções para preservá-las.';return false;}};
 const persistEdits=()=>{try{localStorage.setItem(editsKey,JSON.stringify({run_id:run.id||run.run_id||null,edits:run.post_meeting_edits||[]}));return true;}catch(_){return false;}};
 const alignRail=()=>{if(aside.hidden||!railAnchor?.isConnected)return;const top=Math.max(0,Math.min(railAnchor.getBoundingClientRect().top-dialog.getBoundingClientRect().top,dialog.clientHeight-360));aside.style.setProperty('--gm-review-offset',top+'px');};
 const hideReview=()=>{aside.hidden=true;dialog.classList.remove('gm-review-open');reviewMode=null;railAnchor=null;paper.querySelectorAll('.gm-selected').forEach(n=>n.classList.remove('gm-selected'));};
 const openRail=(heading,anchor)=>{
  aside.hidden=false;dialog.classList.add('gm-review-open');aside.replaceChildren();const railHead=el('header','gm-review-header');railHead.append(el('h3','',heading),button('×',hideReview,'gm-close-review'));railHead.lastChild.setAttribute('aria-label','Fechar revisão');aside.append(railHead);
  paper.querySelectorAll('.gm-selected').forEach(n=>n.classList.remove('gm-selected'));
  railAnchor=anchor||null;if(anchor){anchor.classList.add('gm-selected');alignRail();requestAnimationFrame(alignRail);}else aside.style.setProperty('--gm-review-offset','0px');
 };
 paper.addEventListener('scroll',alignRail,{passive:true});window.addEventListener('resize',alignRail);
 const explore=w=>{
  if(onExplore)return onExplore({run,eventIds:w.event_ids||[],relationIds:w.relation_ids||[],warning:w});
  const log=el('dialog','gm-log-dialog'),head=el('header','gm-review-header');head.append(el('h3','','Detalhes do registro'),button('Fechar',()=>log.close()));log.append(head);
  const eventIds=new Set(w.event_ids||[]),view=amendments().build(run),events=[...eventIds].map(id=>view.state.byId[id]?.event||(run.meeting_events||[]).find(e=>e.event_id===id)).filter(Boolean),chunkIds=new Set(events.map(e=>e.chunk_id));
  const payload={warning:w,events,records:(run.records||[]).filter(r=>chunkIds.has(r.id)||chunkIds.has(r.chunk_id)),relations:(run.meeting_relations||[]).filter(r=>(w.relation_ids||[]).includes(r.relation_id)),thread_jobs:(run.thread_worker?.jobs||[]).filter(j=>eventIds.has(j.event_id)),relation_jobs:(run.typed_relation_worker?.jobs||[]).filter(j=>eventIds.has(j.event_id))};
  if(w.message)log.append(el('p','',plainWarning(w.message)));for(const event of events)log.append(el('blockquote','',event.text));
  if(document.body.dataset.role==='admin'){const details=el('details');details.append(el('summary','','Diagnóstico técnico'),el('pre','gm-log',JSON.stringify(payload,null,2)));log.append(details);}
  dialog.append(log);log.addEventListener('close',()=>log.remove());log.showModal();
 };
 function itemTopic(item){const ids=item.event_ids||[item.event_id];const event=(run.meeting_events||[]).find(e=>ids.includes(e.event_id)||item.chunk_id&&e.chunk_id===item.chunk_id);return doc.topics.find(t=>t.thread_id===event?.thread_id||t.thread_id===item.target_id)||null;}
 function reviewGroup(item,{direct=false,general='Documento'}={}){
  if(direct)return aside;const topic=itemTopic(item),id=topic?.thread_id||'unassigned';let group=[...aside.querySelectorAll('.gm-review-topic')].find(node=>node.dataset.topicId===id);
  if(!group){group=el('details','gm-review-topic');group.dataset.topicId=id;group.open=!aside.querySelector('.gm-review-topic');const heading=el('summary','',topic?.title||general);group.append(heading);aside.append(group);}return group;
 }
 function findEntry(id){return doc.topics.flatMap(topic=>topic.history?.events||[]).find(entry=>entry.id===id);}
 function entryAnchor(id){return paper.querySelector('[data-source-anchor="'+CSS.escape(String(id))+'"]')||paper.querySelector('[data-event-id="'+CSS.escape(String(id))+'"]');}
 function reviewNext(){
  const issue=doc.issues.find(item=>!item.resolved);if(!issue){hideReview();notice.textContent=exportRequested?'Os testes foram conferidos. Você já pode baixar o PDF.':'';return;}
  const anchor=entryAnchor(issue.event_id);anchor?.scrollIntoView({block:'center',behavior:'instant'});showReview(issue.event_id,anchor);
 }
 async function saveChange(change,message){
  if(recovering)return;recovering=true;const controls=[...aside.querySelectorAll('button,input,select,textarea')];controls.forEach(node=>node.disabled=true);
  try{
   amendments().record(run,change);const saved=persistEdits();let updateFailed=false;try{await onUpdate?.(run);}catch(_){updateFailed=true;}
   source=sourceFor(run);sourceId=root.NorteMinutes.fingerprint(source);key=PREFIX+sourceId;doc=localDocument(run);reviewed={};render();persist();
   if(exportRequested)reviewNext();else hideReview();notice.textContent=!saved||updateFailed?'A correção foi aplicada. Exporte as correções para garantir uma cópia; houve uma falha ao salvar.':message||'Correção salva.';
  }catch(error){const output=aside.querySelector('.gm-edit-message')||el('p','gm-edit-message');output.setAttribute('role','alert');output.textContent=error.message;if(!output.isConnected)aside.append(output);}
  finally{recovering=false;controls.filter(n=>n.isConnected).forEach(node=>node.disabled=false);}
 }
 function field(form,label,name,{type='textarea',required=true,placeholder=''}={}){
  const wrap=el('label','gm-edit-field'),caption=el('span','',label),input=el(type==='textarea'?'textarea':'input','gm-edit-input');
  input.name=name;input.required=required;if(type==='textarea'){input.rows=3;input.maxLength=6000;}else input.type=type;if(placeholder)input.placeholder=placeholder;wrap.append(caption,input);form.append(wrap);return input;
 }
 function completionForm(entry,anchor){
  reviewMode={type:'complete',target:entry.id};openRail('Registrar conclusão',anchor);aside.append(el('blockquote','gm-edit-quote',entry.text));
  const form=el('form','gm-test-form');form.dataset.editType='complete_test';field(form,'O que foi feito?','performed');field(form,'Data do teste','performed_at',{type:'date'});field(form,'Qual foi o resultado?','result');
  const wrap=el('label','gm-edit-field');wrap.append(el('span','','O teste atendeu ao esperado?'));const outcome=el('select','gm-edit-input');outcome.name='outcome';outcome.required=true;for(const [value,label]of [['','Selecione'],['passed','Sim'],['failed','Não'],['unassessed','Ainda não avaliado']]){const option=el('option','',label);option.value=value;wrap.append(outcome);outcome.append(option);}form.append(wrap);
  const save=el('button','gm-button gm-primary','Salvar conclusão');save.type='submit';form.append(save,el('p','gm-edit-message'));
  form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;const data=Object.fromEntries(new FormData(form));saveChange({type:'complete_test',test_id:entry.id,...data},'Conclusão registrada.');};aside.append(form);
 }
 function pendingForm(entry,anchor,reopening=false){
  reviewMode={type:'pending',target:entry.id};openRail(reopening?'Reabrir teste':'Confirmar em aberto',anchor);aside.append(el('blockquote','gm-edit-quote',entry.text));
  const form=el('form','gm-test-form');form.dataset.editType=reopening?'reopen_test':'confirm_pending';field(form,'O que falta validar?','note',{placeholder:'Descreva o que ainda precisa ser feito ou confirmado.'});
  const save=el('button','gm-button gm-primary',reopening?'Reabrir teste':'Confirmar em aberto');save.type='submit';form.append(save,el('p','gm-edit-message'));
  form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())saveChange({type:reopening?'reopen_test':'confirm_pending',test_id:entry.id,note:new FormData(form).get('note')},'Teste mantido em aberto.');};aside.append(form);
 }
 function associationForm(entry,anchor){
  reviewMode={type:'associate',target:entry.id};openRail('Associar resultado',anchor);aside.append(el('blockquote','gm-edit-quote',entry.text),el('p','gm-muted','Qual teste produziu este resultado?'));
  const form=el('form','gm-test-form');form.dataset.editType='associate_result';const wrap=el('label','gm-edit-field');wrap.append(el('span','','Teste deste assunto'));const select=el('select','gm-edit-input');select.name='test_id';select.required=true;select.setAttribute('aria-label','Teste associado ao resultado');const first=el('option','','Selecione o teste');first.value='';select.append(first);
  const tests=doc.topics.flatMap(topic=>topic.history?.events||[]).filter(item=>item.type==='test_proposal'&&item.current&&item.topic_id===entry.topic_id);
  for(const test of tests){const option=el('option','',test.text);option.value=test.id;select.append(option);}wrap.append(select);form.append(wrap);
  const save=el('button','gm-button gm-primary','Associar ao teste');save.type='submit';save.disabled=!tests.length;form.append(save,el('p','gm-edit-message'));form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())saveChange({type:'associate_result',result_id:entry.id,test_id:select.value},'Resultado associado ao teste.');};aside.append(form);
  if(!tests.length)aside.append(el('p','gm-muted','Não há um teste identificado neste assunto.'));
  aside.append(button('Manter teste desconhecido',()=>saveChange({type:'acknowledge_unknown',result_id:entry.id},'O resultado ficará identificado como teste desconhecido.'),'gm-text-action'));
 }
 function showReview(target,anchor){
  if(readOnly){if(target)explore({event_ids:[target]});return;}
  if(target===null){exportRequested=false;reviewNext();return;}
  const entry=findEntry(target);if(!entry)return;anchor=anchor||entryAnchor(target);
  if(entry.type==='test_result'){associationForm(entry,anchor);return;}
  if(entry.type==='test_proposal'){
   reviewMode={type:'test',target};openRail('Conferir teste',anchor);aside.append(el('blockquote','gm-edit-quote',entry.text));
   if(entry.completed){aside.append(el('p','gm-muted','Há um resultado associado a este teste.'),button('Reabrir para corrigir',()=>pendingForm(entry,anchor,true),'gm-primary'));}
   else{aside.append(el('p','gm-muted','Não encontramos uma conclusão associada. Este teste chegou a ser concluído?'),button('Registrar conclusão',()=>completionForm(entry,anchor),'gm-primary'),button('Confirmar em aberto',()=>pendingForm(entry,anchor),'gm-text-action'));}
   const issue=doc.issues.find(item=>item.event_id===entry.id);if(issue)aside.append(button('Explorar registros',()=>explore({...issue,event_ids:[entry.id]}),'gm-text-action'));return;
  }
 }
 function excludedItems(){return evidenceFor(run).excluded||[];}
 function clarificationFor(warning){
  const candidates=root.NorteMeetingReview?.candidates?.(run)||excludedItems();
  const relation=(run.meeting_relations||[]).find(r=>(warning.relation_ids||[]).includes(r.relation_id||r.id));
  const ids=[relation?.source_event_id||relation?.source_id,...(warning.event_ids||[])].filter(Boolean);
  return ids.map(id=>candidates.find(item=>item.event_id===id)).find(Boolean);
 }
 function showExcluded(selectedId=null,anchor){
  selectedId=typeof selectedId==='string'?selectedId:null;
  reviewMode={type:selectedId?'clarification':'excluded',selectedId};openRail(selectedId?'Esclarecer trecho':'Informações não incluídas',anchor);
  aside.append(el('p','gm-muted',selectedId?'Acrescente os detalhes que esclarecem este ponto. A nova informação será analisada e associada ao assunto antes de atualizar a ata.':'Estes trechos não entraram no documento. Você pode acrescentar detalhes e solicitar uma nova análise.'));
  const entries=selectedId?(root.NorteMeetingReview?.candidates?.(run)||excludedItems()).filter(item=>item.id===selectedId):excludedItems();
  if(!entries.length)aside.append(el('p','gm-muted','Não há informações excluídas por confiabilidade.'));
  for(const entry of entries){
   const card=el('article','gm-excluded-item');card.dataset.excludedId=entry.id||entry.event_id||entry.chunk_id;
   card.append(el('blockquote','',entry.text||entry.event?.text||entry.record?.text||''),el('p','gm-muted',entry.reason||entry.message||'Classificação ainda não confirmada.'));
   if(readOnly){reviewGroup(entry,{direct:!!selectedId,general:'Sem assunto confirmado'}).append(card);continue;}
   const input=el('textarea','gm-feedback');input.rows=3;input.maxLength=6000;input.placeholder=selectedId?'Explique a qual teste ou informação esta fala se refere e acrescente os detalhes necessários…':'Acrescente informações ou explique por que este trecho deve entrar na ata…';input.setAttribute('aria-label','Informações adicionais para o trecho');
   const message=el('p','gm-recovery-message');message.setAttribute('role','status');const actions=el('div','gm-recovery-actions');
   const assess=button(selectedId?'Analisar esclarecimento':'Analisar inclusão',async()=>{
    if(recovering)return;const api=root.NorteMeetingReview;if(!api?.assess){message.textContent='A revisão deste trecho ainda não está disponível.';return;}
    recovering=true;assess.disabled=true;include.disabled=true;message.textContent='Verificando o trecho com os registros da reunião…';
    try{const result=await api.assess(run,entry,input.value.trim());await onUpdate?.(run);if(closed)return;message.textContent=result.message||'Acrescente mais detalhes para esclarecer este trecho.';include.hidden=result.status!=='ready';include.disabled=result.status!=='ready';card._assessment=result;}
    catch(error){message.textContent='Não foi possível analisar o trecho agora. '+error.message;}
    finally{recovering=false;assess.disabled=false;}
   });
   const include=button(selectedId?'Aplicar esclarecimento':'Confirmar inclusão',async()=>{
    if(recovering)return;const api=root.NorteMeetingReview;if(!api?.recover)return;recovering=true;include.disabled=true;assess.disabled=true;input.disabled=true;message.textContent='Classificando e associando o trecho ao assunto…';
    try{const result=await api.recover(run,entry,input.value.trim());if(result?.run)run=result.run;else if(result?.meeting_events)run=result;await onUpdate?.(run);if(closed)return;if(result?.status==='needs_details'){message.textContent=result.message||'Acrescente mais detalhes para esclarecer o trecho.';include.hidden=true;return;}source=sourceFor(run);sourceId=root.NorteMinutes.fingerprint(source);key=PREFIX+sourceId;doc=localDocument(run);reviewed={};render();persist();if(selectedId){openRail('Esclarecimento aplicado');aside.append(el('p','gm-muted','O documento foi atualizado com as informações confirmadas.'),button('Voltar aos avisos',()=>showReview(null)));}else showExcluded();notice.textContent='Revisão aplicada. O documento foi atualizado com os registros confirmados.';}
    catch(error){message.textContent=(selectedId?'Não foi possível aplicar o esclarecimento. ':'Não foi possível incluir o trecho. ')+error.message;}
    finally{recovering=false;include.disabled=false;assess.disabled=false;input.disabled=false;}
   },'gm-primary');include.hidden=true;input.oninput=()=>{include.hidden=true;card._assessment=null;};actions.append(assess,include);card.append(input,message,actions);reviewGroup(entry,{direct:!!selectedId,general:'Sem assunto confirmado'}).append(card);
  }
 }
 const flag=(target,node)=>{const issue=doc.issues.find(item=>item.event_id===target&&(!item.resolved||item.code==='orphan_result'&&item.disposition==='unknown'));if(!issue)return;const b=button('',()=>showReview(target,node),'gm-flag');b.append(warningIcon());b.setAttribute('aria-label',issue.code==='orphan_result'?'Associar este resultado a um teste':'Confirmar a conclusão deste teste');b.title=issue.message;node.dataset.reviewTarget=target;node.append(b);};
 function reference(entry){const id=typeof entry==='string'?entry:eventId(entry),record=findEntry(id)||entry;const ref=button(presentation().referenceLabel(record),()=>explore({event_ids:[id]}),'gm-reference');ref.title='Ver registro completo na reunião';return ref;}
 function sourceQuote(event,host,{showFlag=true}={}){
  const text=el('p','gm-source-quote',eventText(event)),id=eventId(event),entry=findEntry(id);
  if(id){text.dataset.sourceAnchor=id;if(!paper.querySelector('#gmEvent-'+CSS.escape(id)))text.id='gmEvent-'+id;}
  if(entry&&['test_proposal','test_result'].includes(entry.type)){
   text.classList.add('gm-editable-quote');text.tabIndex=0;text.setAttribute('role','button');text.setAttribute('aria-label',(entry.type==='test_result'?'Revisar resultado: ':'Revisar teste: ')+eventText(event));
   text.onclick=event=>{if(!event.target.closest('button,a'))showReview(id,text);};text.onkeydown=event=>{if(event.target===text&&['Enter',' '].includes(event.key)){event.preventDefault();showReview(id,text);}};
  }
  if(id){text.append(document.createTextNode(' '),reference(event));if(showFlag)flag(id,text);}host.append(text);return text;
 }
 function currentEntry(entry,key,host){
  const item=el('li','gm-current-entry gm-outline-node gm-node-'+entry.type);item.dataset.eventId=entry.id;item.dataset.state=displayStatus(entry,key);
  const line=el('div','gm-entry-heading');
  if(entry.type==='test_proposal'){
   item.classList.add('gm-task-entry');const status=button(entry.completed?(readOnly?'Concluído':'Concluído · revisar'):(readOnly?'Pendente':'Pendente · revisar'),()=>showReview(entry.id,line),'gm-test-status');status.dataset.completed=String(!!entry.completed);status.setAttribute('aria-label','Revisar teste: '+entry.text);line.append(status);
  }
  if(entry.type==='test_result'&&entry.standalone){item.classList.add('gm-unknown-test');line.append(el('span','gm-unknown-label','Teste desconhecido'));const results=el('ul','gm-entry-evidence'),row=el('li','gm-evidence-link');sourceQuote(entry,row);results.append(row);item.append(line,results);}
  else{sourceQuote(entry,line);item.append(line);}
  if(entry.post_meeting_note)item.append(el('p','gm-user-note','Falta validar: '+entry.post_meeting_note));
  const completion=presentation().completionDetails(entry).filter(detail=>['Data','Atendeu ao esperado'].includes(detail.label));if(completion.length)item.append(el('p','gm-entry-state',completion.map(detail=>detail.label+': '+detail.text).join(' · ')));
  const reasons=presentation().briefReasons(entry);for(const reason of reasons){const note=el('p','gm-incompatibility',reason.text);for(const id of reason.event_ids||[])note.append(document.createTextNode(' '),reference(id));item.append(note);}
  const reasonIds=new Set(reasons.flatMap(reason=>reason.event_ids||[]));const links=entryLinks(entry,key).filter(link=>link.type!=='contradicts'||!reasonIds.has(link.event_id||eventId(link.event)));if(links.length){const refs=el('p','gm-entry-references');for(const link of links){const span=el('span','',linkLabel(link)+': ');span.append(reference(link.event));refs.append(span);}item.append(refs);}host.append(item);
 }
 function topicBody(topic,section,ordinal){
  const descriptors=sectionsForTopic(topic,ordinal),current=el('div','gm-current');
  for(const descriptor of descriptors){
   const group=el('section',descriptor.kind==='context'?'gm-context-section':'gm-current-section');group.dataset.section=descriptor.source_key;group.dataset.kind=descriptor.key;group.id=descriptor.id;if(descriptor.title)group.append(el('h4','',descriptor.title));
   const list=el('ul','gm-current-list'+(descriptor.source_key==='actions'?' gm-action-list':''));for(const entry of descriptor.entries||[])currentEntry(entry,descriptor.source_key,list);group.append(list);
   for(const data of descriptor.tables||[]){const wrap=el('div','gm-table-wrap'),table=el('table','gm-table gm-comparison-table');table.append(el('caption','',data.title));const head=el('thead'),heading=el('tr');for(const label of data.headers){const cell=el('th','',label);cell.scope='col';heading.append(cell);}head.append(heading);table.append(head);const body=el('tbody');for(const row of data.rows){const tr=el('tr');row.cells.forEach((value,index)=>{const td=el('td');if(index===row.cells.length-1)td.append(reference(row.event_id));else td.textContent=value||'—';tr.append(td);});body.append(tr);}table.append(body);wrap.append(table);group.append(wrap);}current.append(group);
  }
  if(!descriptors.length)current.append(el('p','gm-muted','Nenhum ponto atual confirmado neste assunto.'));section.append(current);
 }
 function render(){
  const scroll=paper.scrollTop;paper.replaceChildren();if(!doc)return;
  const meta=doc.metadata||meetingMetadata(run),info=el('header','gm-meeting-info');info.append(el('h1','',meta.title));
  const fields=el('dl','gm-meeting-fields');for(const [label,value] of [['Data',meta.date],['Horário',meta.time],['Duração',meta.duration],['Participantes',meta.participants]]){const group=el('div');group.append(el('dt','',label),el('dd','',value));fields.append(group);}info.append(fields);paper.append(info);
  const nav=el('nav','gm-contents');nav.setAttribute('aria-label','Sumário da ata');nav.append(el('h2','','Sumário'));const list=el('ol','gm-contents-list');for(const [index,t] of doc.topics.entries()){const item=el('li'),link=el('a','',topicHeading(t,index));link.href='#gmTopic'+index;link.onclick=e=>{e.preventDefault();paper.querySelector('#gmTopic'+index)?.scrollIntoView({block:'start',behavior:'smooth'});};item.append(link);list.append(item);}nav.append(list);paper.append(nav);
  const reviewActions=el('div','gm-document-actions'),pending=doc.issues.filter(issue=>!issue.resolved);if(pending.length&&!readOnly)reviewActions.append(button('Conferir testes · '+pending.length,()=>showReview(null)));reviewActions.append(button('Informações não incluídas'+(excludedItems().length?' · '+excludedItems().length:''),()=>showExcluded()));if(!readOnly)reviewActions.append(button('Exportar correções',exportCorrections));paper.append(reviewActions);
  for(const [index,t] of doc.topics.entries()){const section=el('section','gm-topic'),heading=el('h3','',topicHeading(t,index));section.id='gmTopic'+index;flag(t.thread_id,heading);section.append(heading);topicBody(t,section,index+1);paper.append(section);}
  if(!doc.topics.length)paper.append(el('p','gm-empty','A ata estará disponível quando houver pontos registrados na reunião.'));status();pdf.disabled=!!controller||exporting;generateButton.disabled=!!controller||exporting||!source.events.length;paper.scrollTop=scroll;if(doc.invalid_edits?.length)notice.textContent='Algumas correções anteriores precisam ser conferidas porque os registros de origem mudaram. Elas continuam disponíveis na exportação.';
 }
 async function generate(){if(readOnly)return false;if(controller||recovering||exporting)return false;controller=new AbortController();generateButton.disabled=true;pdf.disabled=true;localPDF.hidden=true;notice.textContent='Resumindo os tópicos e organizando os valores registrados…';dialog.setAttribute('aria-busy','true');const timer=setTimeout(()=>controller?.abort(),190000);
  try{source=sourceFor(run);const requestedId=root.NorteMinutes.fingerprint(source);const response=await fetch('/api/minutes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source}),signal:controller.signal});if(!response.ok){const error=Error('request');error.status=response.status;try{const details=await response.json();error.code=details.code;}catch(_){}throw error;}const result=await response.json();if(closed)return false;if(requestedId!==root.NorteMinutes.fingerprint(sourceFor(run))){notice.textContent='Os registros mudaram durante a organização. O documento atual foi preservado; organize novamente para incluir as alterações.';return false;}sourceId=requestedId;key=PREFIX+sourceId;doc=organizedDocument(run,result);reviewed={};hideReview();render();persist();generateButton.textContent='Organizar novamente';return true;}
  catch(e){if(!closed)notice.textContent=e.name==='AbortError'?'A organização demorou mais que o esperado. Tente novamente; seu documento atual foi preservado.':e.code==='busy'?'Uma organização ainda está em andamento. Aguarde um instante e tente novamente; seu documento atual continua disponível.':e.code==='timeout'?'A organização demorou mais que o esperado. Tente novamente; seu documento atual continua disponível.':e.code==='unavailable'?'O serviço está temporariamente indisponível. Tente novamente em instantes; seu documento atual continua disponível.':e.code==='daily_limit'?'O limite diário de organização de atas foi atingido. Seu documento continua disponível. Tente no próximo dia ou contate o administrador.':e.code==='configuration'?'O serviço de organização precisa ser configurado pelo administrador. Seu documento atual continua disponível.':e.status===429?'O serviço está temporariamente no limite. Tente organizar novamente em alguns minutos; seu documento atual continua disponível.':'Não foi possível organizar o documento agora. Tente novamente; seu documento atual continua disponível.';}
  finally{clearTimeout(timer);controller=null;generateButton.disabled=!source.events.length;pdf.disabled=false;dialog.removeAttribute('aria-busy');}
  return false;
 }
 function exportCorrections(){const payload=amendments().export(run),blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='correcoes-reuniao-'+String(run.id||'ata').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function download({local=false}={}){if(controller||recovering||exporting)return;const latest=sourceFor(run),latestId=root.NorteMinutes.fingerprint(latest);if(latestId!==sourceId){source=latest;sourceId=latestId;key=PREFIX+sourceId;doc=localDocument(run);reviewed={};render();persist();}doc=doc||localDocument(run);if(!readOnly&&doc.issues.some(issue=>!issue.resolved)){exportRequested=true;notice.textContent='Confira estes testes antes de baixar. Você pode corrigir os resultados ou confirmar o que continua em aberto.';reviewNext();return;}exportRequested=false;if(!readOnly&&!local&&doc.mode==='local'&&!await generate()){if(!closed){localPDF.hidden=false;notice.textContent+=' Você pode baixar a versão local, sem a síntese de IA.';}return;}if(closed)return;exporting=true;pdf.disabled=true;localPDF.disabled=true;generateButton.disabled=true;try{await root.NorteMinutes.downloadPDF(pdfDocument(doc,reviewed));status();}catch(e){notice.textContent='Falha ao exportar: '+e.message;}finally{exporting=false;pdf.disabled=false;localPDF.disabled=false;generateButton.disabled=!source.events.length;}}
 const generateButton=button('Resumir ata com IA',generate),pdf=button('Baixar PDF',()=>download(),'gm-primary'),localPDF=button('Baixar versão local',()=>download({local:true}));generateButton.id='gmOrganize';generateButton.title='Resume cada ponto e organiza tabelas com os valores registrados';pdf.id='gmPDF';pdf.disabled=true;localPDF.id='gmLocalPDF';localPDF.hidden=readOnly;generateButton.hidden=readOnly;
 controls.append(generateButton,pdf,localPDF,button('Fechar',()=>dialog.close()));
 dialog.addEventListener('close',()=>{closed=true;controller?.abort();window.removeEventListener('resize',alignRail);dialog.remove();});dialog.showModal();
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.presentationVersion===10&&saved?.sourceId===sourceId&&saved.doc?.topics&&saved.doc?.warnings){doc=saved.doc;doc.metadata=meetingMetadata(run);doc.meeting_url=presentation().meetingURL?.(run,root.location?.origin)||null;doc.topics=doc.topics.map((t,index)=>({...t,title:explicitTitle(run,t.thread_id,index+1),untitled:explicitTitle(run,t.thread_id,index+1)==='Assunto '+(index+1)+': sem título'}));doc.warnings=doc.warnings.map(w=>({...w,message:plainWarning(w.message)}));reviewed=saved.reviewed||{};if(doc.mode!=='local')generateButton.textContent='Organizar novamente';}}catch(_){}
 if(!doc||doc.mode==='local')doc=localDocument(run);render();persist();if(autoGenerate&&!readOnly&&doc.mode==='local')generate();return {dialog,get sourceId(){return sourceId;}};
}
root.NorteGeminiMinutes={open,sourceFor,pdfDocument,localDocument,organizedDocument,meetingMetadata,currentSections,changeColumns,sectionsForTopic};
})(globalThis);
