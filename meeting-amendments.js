/* Human amendments are replayed over a derived view; extraction is never edited. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteMeetingAmendments=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const TYPES=new Set(['associate_result','acknowledge_unknown','complete_test','reopen_test','confirm_pending']);
const OUTCOMES=new Set(['passed','failed','unassessed']);
const clone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const sourceId=r=>r.source_event_id||r.source_id||r.event_id;
const targetId=r=>r.target_event_id||r.target_id;
const stateApi=()=>root.NorteMeetingState||(typeof require==='function'?require('./meeting-state.js'):null);
function text(value,label){if(typeof value!=='string'||!value.trim())throw Error(label+' é obrigatório.');if(value.trim().length>10000)throw Error(label+' é longo demais.');return value.trim();}
function date(value){const result=text(value,'A data da realização');if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(result)||!Number.isFinite(Date.parse(result)))throw Error('Informe uma data válida para a realização.');const day=result.slice(0,10);if(new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day)throw Error('Informe uma data válida para a realização.');return result;}
function node(state,id,type,allowUnassigned=false){const entry=state.byId[id];if(typeof id!=='string'||!entry||entry.type!==type||!entry.current||entry.ambiguous)throw Error(type==='test_proposal'?'Escolha um teste atual e confiável.':'Escolha um resultado atual e confiável.');if(!entry.topic_id&&!allowUnassigned)throw Error('Associe o registro a um assunto antes de revisá-lo.');return entry;}
function parents(state,id){return Object.values(state.byId).filter(n=>n.type==='test_proposal'&&n.current&&n.results.some(r=>r.event_id===id&&r.confirmed&&r.usable&&r.configuration_match==='exact'));}
function normalize(state,input){
 if(!input||!TYPES.has(input.type))throw Error('Tipo de revisão desconhecido.');
 const change={type:input.type};let result,test;
 if(['associate_result','acknowledge_unknown'].includes(input.type)){result=node(state,input.result_id,'test_result',input.type==='acknowledge_unknown');change.result_id=result.id;}
 if(input.type!=='acknowledge_unknown'){test=node(state,input.test_id,'test_proposal',input.type==='confirm_pending');change.test_id=test.id;}
 if(input.type==='associate_result'){
  if(result.topic_id!==test.topic_id)throw Error('O resultado e o teste precisam pertencer ao mesmo assunto.');
  const linked=parents(state,result.id);if(linked.length===1&&linked[0].id===test.id)throw Error('Este resultado já está associado a esse teste.');
 }
 if(input.type==='acknowledge_unknown'&&parents(state,result.id).length)throw Error('Este resultado já tem um teste associado.');
 if(input.type==='complete_test'){
  if(test.completed)throw Error('Este teste já foi concluído. Reabra-o antes de registrar outra realização.');
  change.performed=text(input.performed,'O relato do que foi feito');change.performed_at=date(input.performed_at);change.result=text(input.result,'O resultado');
  if(!OUTCOMES.has(input.outcome))throw Error('Informe se o resultado foi satisfatório, insatisfatório ou ainda não avaliado.');change.outcome=input.outcome;
 }
 if(['reopen_test','confirm_pending'].includes(input.type)){
  if(input.type==='reopen_test'&&!test.completed)throw Error('Este teste já está em aberto.');
  if(input.type==='confirm_pending'&&test.completed)throw Error('Reabra o teste para informar o que ainda falta validar.');
  change.note=text(input.note,'O que falta validar');
 }
 return change;
}
function sourceSnapshot(run,state,change){
 const ids=[change.result_id,change.test_id].filter(Boolean).sort(),raw=new Map((run.meeting_events||[]).map(e=>[e.event_id,e]));
 return {meeting_id:run.id||run.meeting_id||null,events:ids.map(id=>{const e=raw.get(id)||state.byId[id]?.event;return {event_id:id,type:e?.type,thread_id:e?.thread_id||null,chunk_id:e?.chunk_id||null,text:e?.text||'',source:e?.source||null};}),relations:(run.meeting_relations||[]).filter(r=>ids.includes(sourceId(r))||ids.includes(targetId(r))).map(r=>({id:r.relation_id||r.id||null,source:sourceId(r),target:targetId(r),type:r.relation_type,match:r.configuration_match??null,review_state:r.review_state??null,relation_probability:r.relation_probability??null,match_probability:r.match_probability??null})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
}
function summary(state,ids){return [...new Set(ids.filter(Boolean))].map(id=>{const n=state.byId[id];return n?{event_id:id,thread_id:n.topic_id,type:n.type,text:n.text,status:n.status,completed:n.completed,unknown_test:!!n.unknown_test,pending_confirmed:!!n.pending_confirmed,note:n.post_meeting_note||null,results:n.results.map(r=>({event_id:r.event_id,usable:r.usable,relation_id:r.relation_id})),parents:parents(state,id).map(p=>p.id),completion:n.completion?clone(n.completion):null}:null;}).filter(Boolean);}
function relation(result,test,edit){return {relation_id:'PM_REL_'+edit.id,source_event_id:result,target_event_id:test,relation_type:'result_of',configuration_match:'exact',configuration_applicable:true,relation_probability:1,match_probability:1,review_state:'confirmed',source:'post_meeting',post_meeting_edit_id:edit.id};}
function apply(source,edit,open,unknown,completions,retiredLinks,state){
 const change=edit.change||edit;
 if(change.type==='associate_result'){
  source.meeting_relations=(source.meeting_relations||[]).filter(r=>!(sourceId(r)===change.result_id&&r.relation_type==='result_of'));
  source.meeting_relations.push(relation(change.result_id,change.test_id,edit));open.delete(change.test_id);unknown.delete(change.result_id);
 }else if(change.type==='acknowledge_unknown')unknown.set(change.result_id,edit);
 else if(change.type==='complete_test'){
  const test=source.meeting_events.find(e=>e.event_id===change.test_id),id='PM_RESULT_'+edit.id;
  if(source.meeting_events.some(e=>e.event_id===id))throw Error('Identificador de resultado pós-reunião repetido.');
  source.meeting_events.push({event_id:id,thread_id:test.thread_id,type:'test_result',text:change.result,store_confidence:1,type_confidence:1,source:'post_meeting',post_meeting_edit_id:edit.id,performed:change.performed,performed_at:change.performed_at,outcome:change.outcome});
  (source.meeting_relations||(source.meeting_relations=[])).push(relation(id,change.test_id,edit));open.delete(change.test_id);completions.set(change.test_id,{performed:change.performed,performed_at:change.performed_at,result:change.result,outcome:change.outcome,event_id:id,edit_id:edit.id});
 }else {if(change.type==='reopen_test')for(const link of state.byId[change.test_id].results)if(link.usable&&link.confirmed&&link.configuration_match==='exact')retiredLinks.add(link.relation_id);open.set(change.test_id,edit);}
}
function refresh(state,open,unknown,completions,retiredLinks){
 const entries=Object.values(state.byId);
 for(const [id,completion] of completions)if(state.byId[id])state.byId[id].completion=clone(completion);
 for(const [id,edit] of unknown)if(state.byId[id]){state.byId[id].unknown_test=true;state.byId[id].post_meeting_edit_id=edit.id;}
 for(const [id,edit] of open){const n=state.byId[id];if(!n)continue;n.completed=false;n.resolved=false;n.pending_confirmed=true;n.post_meeting_note=(edit.change||edit).note;n.post_meeting_edit_id=edit.id;n.reasons=n.reasons.filter(r=>!r.startsWith('Execução relatada'));}
 for(const n of entries)for(const link of n.results)if(retiredLinks.has(link.relation_id)){link.usable=false;link.post_meeting_reopened=true;const counterpart=state.byId[link.event_id];for(const out of counterpart?.relations||[])if(out.relation_id===link.relation_id){out.usable=false;out.post_meeting_reopened=true;}}
 // Re-evaluate explicit resolutions as well as dependencies: reopening a test
 // must also stop a dependent decision from resolving a problem prematurely.
 const satisfied=n=>n?.current&&!n.ambiguous&&!['error','conflict'].includes(n.status)&&(n.completed||n.resolved);
 const waiting=n=>n.dependencies.filter(l=>l.confirmed&&(!l.compatible||!satisfied(state.byId[l.event_id])));
 const isQuestion=n=>n.type==='other'&&(n.event.is_question===true||n.event.subtype==='question'||/\?\s*$/.test(n.text));
 const resolutions=[];
 for(const n of entries){n.resolved=false;for(const link of n.relations){const target=state.byId[link.event_id];if(link.direction!=='outgoing'||!link.confirmed||!link.compatible||!n.current||n.ambiguous)continue;
  if(n.type==='decision'&&(['resolves','resolves_issue','rejects'].includes(link.type)&&['observation','hypothesis','requirement'].includes(target.type)||link.type==='contradicts'&&target.type==='hypothesis')||isQuestion(target)&&['decision','observation','test_result','requirement'].includes(n.type)&&['answers','clarifies','resolves'].includes(link.type))resolutions.push({source:n,target});
 }}
 for(let pass=0;pass<entries.length;pass++){let changed=false;for(const {source,target} of resolutions)if(target.current&&!target.ambiguous&&!target.resolved&&target.status!=='conflict'&&!waiting(source).length){target.resolved=true;changed=true;}if(!changed)break;}
 for(const n of entries){
  n.alerts=n.alerts.filter(a=>a.code!=='dependency_pending');
  const blocked=waiting(n);
  n.blocked_by=[...new Set(blocked.map(l=>l.event_id))];n.blocked=n.blocked_by.length>0;
  n.reasons=n.reasons.filter(r=>!r.startsWith('Depende de '));
  const classification=n.alerts.some(a=>['classification','unassigned','replacement_cycle','replacement_branch'].includes(a.code));
  if(n.current&&!['error','conflict'].includes(n.status)){
   const work=n.type==='test_proposal'||['action','task','action_item','follow_up'].includes(n.type)||n.event.is_action===true||['action','task','action_item','follow_up'].includes(n.event.subtype);
   const baseOpen=work||['hypothesis','observation'].includes(n.type)||n.type==='other'&&(n.event.is_question===true||n.event.subtype==='question'||/\?\s*$/.test(n.text));
   n.status=n.ambiguous||classification||n.blocked?'review':n.completed||n.resolved?'completed':baseOpen?'open':'registered';n.state_label=stateApi().labels[n.status];
  }
 }
 state.alerts=state.alerts.filter(a=>a.code!=='dependency_pending');
 for(const n of entries)if(n.blocked){const a={id:'dependency_pending:'+n.id+':human',code:'dependency_pending',kind:'pending',message:'Depende de '+n.blocked_by.join(', ')+', ainda sem conclusão válida.',event_ids:[n.id],relation_ids:n.dependencies.filter(l=>n.blocked_by.includes(l.event_id)).map(l=>l.relation_id)};n.alerts.push(a);n.reasons.push(a.message);state.alerts.push(a);}
 for(const n of entries){
  if(n.type==='test_result')n.standalone=unknown.has(n.id)||parents(state,n.id).length!==1&&!entries.some(t=>t.type==='test_proposal'&&t.current&&t.results.some(r=>r.event_id===n.id&&r.post_meeting_reopened));
  for(const link of n.relations){const other=state.byId[link.event_id];link.event_status=other.status;link.event_current=other.current;}
 }
 for(const topic of state.topics){const current=topic.history.events.filter(n=>n.current);topic.current.tests=current.filter(n=>n.type==='test_proposal'||n.type==='test_result'&&n.standalone);topic.current.actions=current.filter(n=>(n.type==='test_proposal'||['action','task','action_item','follow_up'].includes(n.type)||n.event.is_action===true||['action','task','action_item','follow_up'].includes(n.event.subtype))&&!n.completed&&!n.resolved);topic.current.open_points=current.filter(n=>(['hypothesis','observation'].includes(n.type)||isQuestion(n))&&!n.resolved);topic.alerts=state.alerts.filter(a=>a.event_ids.some(id=>state.byId[id]?.topic_id===topic.id));}
 state.entries=entries;state.pending=entries.filter(n=>(n.current||n.ambiguous)&&(['open','review','conflict','error'].includes(n.status)||n.blocked));
 for(const status of ['completed','conflicts','reviews','errors'])state.metrics[status]=entries.filter(n=>n.status===({conflicts:'conflict',reviews:'review',errors:'error'}[status]||status)).length;state.metrics.pending=state.pending.length;
 return state;
}
function issuesFor(state,unknown,open){const issues=[];
 for(const n of Object.values(state.byId))if(n.current){
  if(n.type==='test_result'&&n.standalone){const explicit=unknown.has(n.id);issues.push({id:'orphan_result:'+n.id,type:'orphan_result',code:'orphan_result',event_id:n.id,thread_id:n.topic_id,message:explicit?'Teste desconhecido.':'Este resultado não tem um teste associado. Escolha o teste ou confirme que ele é desconhecido.',resolved:explicit,disposition:explicit?'unknown':null});}
  if(n.type==='test_proposal'&&!n.completed){const explicit=open.has(n.id);issues.push({id:'unconfirmed_test:'+n.id,type:'unconfirmed_test',code:'unconfirmed_test',event_id:n.id,thread_id:n.topic_id,message:explicit?'Ainda falta validar: '+n.post_meeting_note:'Confirme se este teste continua em aberto ou registre o que foi realizado e o resultado.',resolved:explicit,disposition:explicit?'pending_confirmed':null});}
 }
 return issues;
}
function build(run){
 const api=stateApi();if(!api)throw Error('O estado da reunião não está disponível.');
 const source=clone(run),open=new Map(),unknown=new Map(),completions=new Map(),retiredLinks=new Set(),edits=[],invalid_edits=[],seen=new Set();let state=api.build(source);
 if(run.post_meeting_edits!=null&&!Array.isArray(run.post_meeting_edits))invalid_edits.push({id:null,type:null,code:'invalid_edit_collection',message:'O histórico de revisões salvo não tem um formato válido.'});
 for(const original of Array.isArray(run.post_meeting_edits)?run.post_meeting_edits:[]){
  try{
   if(!original||typeof original.id!=='string'||!/^PM\d{6,}$/.test(original.id)||seen.has(original.id))throw Error('Identificador de revisão ausente ou repetido.');seen.add(original.id);
   const change=normalize(state,original.change||original),expected=sourceSnapshot(run,state,change);
   if(!original.source_snapshot||JSON.stringify(expected)!==JSON.stringify(original.source_snapshot)){const err=Error('A extração original mudou desde esta revisão. Revise novamente o registro.');err.code='stale_source';throw err;}
   const edit={...clone(original),change};apply(source,edit,open,unknown,completions,retiredLinks,state);state=refresh(api.build(source),open,unknown,completions,retiredLinks);edits.push(edit);
  }catch(error){invalid_edits.push({id:original?.id||null,type:original?.change?.type||original?.type||null,code:error.code||'invalid_edit',message:error.message});}
 }
 state=refresh(state,open,unknown,completions,retiredLinks);
 return {state,issues:issuesFor(state,unknown,open),edits,invalid_edits};
}
function record(run,input){
 if(run.post_meeting_edits!=null&&!Array.isArray(run.post_meeting_edits))throw Error('O histórico de revisões salvo precisa ser recuperado antes de registrar uma nova alteração.');
 const before=build(run),change=normalize(before.state,input),used=new Set((run.post_meeting_edits||[]).map(e=>e?.id));let sequence=(run.post_meeting_edits||[]).length+1,id;
 do{id='PM'+String(sequence++).padStart(6,'0');}while(used.has(id));
 const affected=[change.result_id,change.test_id,...(change.result_id?parents(before.state,change.result_id).map(n=>n.id):[])],edit={id,type:change.type,change,created_at:new Date().toISOString(),actor:'user',source_snapshot:sourceSnapshot(run,before.state,change),before:summary(before.state,affected)};
 const candidate={...run,post_meeting_edits:[...(run.post_meeting_edits||[]),edit]},after=build(candidate);
 if(!after.edits.some(e=>e.id===id))throw Error(after.invalid_edits.find(e=>e.id===id)?.message||'Não foi possível aplicar esta revisão.');
 edit.after=summary(after.state,[...affected,...(change.type==='complete_test'?['PM_RESULT_'+id]:[])]);
 (run.post_meeting_edits||(run.post_meeting_edits=[])).push(edit);return clone(edit);
}
function exportAudit(run){const view=build(run);return {schema:'norte.post-meeting-amendments',schema_version:1,exported_at:new Date().toISOString(),source:{meeting_id:run.id||run.meeting_id||null,title:run.title||run.name||null,started_at:run.started_at||run.startedAt||null,ended_at:run.ended_at||run.endedAt||run.finishedAt||null,event_count:(run.meeting_events||[]).length,relation_count:(run.meeting_relations||[]).length},edits:clone(run.post_meeting_edits||[]),applied_edit_ids:view.edits.map(e=>e.id),invalid_edits:view.invalid_edits,issues:view.issues};}
function sourceFor(run){
 const view=build(run),entries=view.state.entries,relations=[],seen=new Set();
 for(const n of entries)for(const link of n.relations){if(link.direction!=='outgoing'||!link.confirmed||seen.has(link.relation_id)||link.type==='result_of'&&!link.usable)continue;seen.add(link.relation_id);relations.push({relation_id:link.relation_id,source_event_id:n.id,target_event_id:link.event_id,relation_type:link.type,configuration_match:link.configuration_match,configuration_applicable:link.relation.configuration_applicable,review_state:link.relation.review_state,relation_probability:link.relation.relation_probability,match_probability:link.relation.match_probability,usable:link.usable,source:link.relation.source||'extraction',post_meeting_edit_id:link.relation.post_meeting_edit_id||null});}
 return {events:entries.map(n=>({event_id:n.id,thread_id:n.topic_id,type:n.type,text:n.text,current:n.current,status:n.status,completed:n.completed,resolved:n.resolved,unknown_test:!!n.unknown_test,pending_confirmed:!!n.pending_confirmed,post_meeting_note:n.post_meeting_note||null,completion:n.completion?clone(n.completion):null,source:n.event.source||'extraction',post_meeting_edit_id:n.event.post_meeting_edit_id||n.post_meeting_edit_id||null,...(n.event.source==='post_meeting'?{performed:n.event.performed,performed_at:n.event.performed_at,outcome:n.event.outcome}:{})})),relations,edits:view.edits.map(edit=>({id:edit.id,created_at:edit.created_at,actor:edit.actor,change:clone(edit.change)}))};
}
return {build,record,export:exportAudit,source:sourceFor};
});
