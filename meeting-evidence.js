/* Shared presentation boundary. Raw extraction and audit records remain intact. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteMeetingEvidence=api;})(globalThis,function(){
'use strict';
// Retaining a classified utterance is separate from trusting a semantic link.
// The presentation policy also applies to saved meetings without changing their
// extracted facts or upgrading uncertain topic/relationship classifications.
const threshold=.6,relationThreshold=.8;
const passes=value=>Number.isFinite(value)&&value>=threshold;
const relationPasses=value=>Number.isFinite(value)&&value>relationThreshold;
function project(source){
 if(source?._evidenceProjection)return {run:source,excluded:source._excluded||[],diagnostics:source._diagnostics||{events:{}}};
 const run=source||{},records=new Map((run.records||[]).map(r=>[r.id,r])),kept=[],excluded=[],seen=new Set(),events={};
 const recovered=new Set((run.review_recoveries||[]).filter(r=>{
  if(r.status!=='included')return false;
  const record=records.get(r.record_id),event=(run.meeting_events||[]).find(e=>e.event_id===r.event_id&&e.chunk_id===r.record_id);
  const entry=(run.transcript||[]).find(t=>t.source==='review'&&t.sourceId===r.source_id&&t.chunk_id===r.record_id&&t.segmentId==='review:'+r.id);
  const assignment=run.thread_worker?.jobs?.find(job=>job.event_id===event?.event_id);
  return !!entry&&!!event?.thread_id&&!String(assignment?.result?.reason||'').startsWith('low_confidence')&&record?.status==='done'&&record.result?.store===true&&passes(record.result.storeProbability)&&passes(record.result.typeProbability);
 }).map(r=>r.source_id));
 const exclude=(id,text,event,record,reason_code,reason,probabilities)=>{if(recovered.has(id)||seen.has(id))return;seen.add(id);excluded.push({id,text,event_id:event?.event_id,chunk_id:record?.id||event?.chunk_id,reason_code,reason,probabilities,record});};
 for(const event of run.meeting_events||[]){
  const record=records.get(event.chunk_id),p={store:record?.result?.storeProbability??event.store_confidence,type:record?.result?.typeProbability??event.type_confidence};
  const id=event.chunk_id||event.event_id;
  const assignment=run.thread_worker?.jobs?.find(j=>j.event_id===event.event_id);
  const assignmentPending=String(assignment?.result?.reason||'').startsWith('low_confidence');
  if(!passes(p.store)||!passes(p.type)||record&&record.status!=='done'){
   exclude(id,event.text,event,record,'confidence','A relevância ou a classificação deste trecho não atingiu 60% de confiança.',p);continue;
  }
  if(recovered.has(id))continue;
  kept.push(assignmentPending?{...event,thread_id:null,thread_assignment_state:'pending'}:{...event});
  const job=run.thread_worker?.jobs?.find(j=>j.event_id===event.event_id),issues=[];
  if(job?.status==='error')issues.push({id:'thread-error:'+event.event_id,message:job.error||'Não foi possível classificar o assunto deste registro.',kind:'error'});
  else if(assignmentPending)issues.push({id:'thread-pending:'+event.event_id,message:'Ainda falta confirmar a qual assunto esta fala se refere.',kind:'pending'});
  else if(!event.thread_id){
   issues.push({id:'thread-pending:'+event.event_id,message:job?.result?.reason?.includes('uncertain')?'Ainda não está claro a qual assunto esta fala se refere.':'A classificação do assunto deste registro está pendente.',kind:'pending'});
  }
  events[event.event_id]=issues;
 }
 for(const record of run.records||[]){
  if((run.meeting_events||[]).some(e=>e.chunk_id===record.id)||recovered.has(record.id))continue;
  const text=run.batch?.cases?.find(c=>c.id===record.id)?.current_utterance;if(!text)continue;
  const p={store:record.result?.storeProbability,type:record.result?.typeProbability};
  // A confidently irrelevant aside is available for correction too, but does
  // not pretend to have been rejected for low confidence.
  const failure=record.status!=='done',code=failure?'processing':record.result?.store===false&&passes(p.store)?'not_relevant':'confidence';
  exclude(record.id,text,null,record,code,failure?'Este trecho não concluiu a classificação.':code==='not_relevant'?'Este trecho foi considerado conversa sem conteúdo para a ata.':'A classificação deste trecho não atingiu 60% de confiança.',p);
 }
 for(const entry of run.transcript||[])if(!entry.chunk_id&&['interrupted','error','unconfirmed'].includes(entry.status)&&!entry.command?.consumed)exclude(entry.id,entry.text,null,null,'processing','Este trecho não concluiu a classificação.',{});
 const ids=new Set(kept.map(e=>e.event_id)),threadIds=new Set(kept.map(e=>e.thread_id).filter(Boolean));
 const relations=(run.meeting_relations||[]).filter(r=>ids.has(r.source_event_id||r.source_id)&&ids.has(r.target_event_id||r.target_id)&&relationPasses(r.relation_probability)&&(relationPasses(r.match_probability)||r.error||['pending','uncertain'].includes(r.review_state)||r.review_state==='needs_review'&&r.match_probability==null));
 const relationIds=new Set(relations.map(r=>r.relation_id));
 const eventTopics=new Map(kept.map(e=>[e.event_id,e.thread_id]));
 const filtered={...run,meeting_events:kept,meeting_threads:(run.meeting_threads||[]).filter(t=>threadIds.has(t.thread_id)).map(t=>({...t,title:run.topic_titles?.[t.thread_id]||t.title||'',anchor_event_ids:(t.anchor_event_ids||[]).filter(id=>eventTopics.get(id)===t.thread_id)})),meeting_relations:relations,
  ...(run.thread_worker?{thread_worker:{...run.thread_worker,jobs:(run.thread_worker.jobs||[]).filter(j=>ids.has(j.event_id))}}:{}),
  ...(run.typed_relation_worker?{typed_relation_worker:{...run.typed_relation_worker,jobs:(run.typed_relation_worker.jobs||[]).filter(j=>ids.has(j.event_id)).map(j=>({...j,results:(j.results||[]).filter(r=>relationIds.has('MR_'+j.event_id+'_'+r.target_event_id))}))}}:{}),
  _evidenceProjection:true,_excluded:excluded,_diagnostics:{events}};
 return {run:filtered,excluded,diagnostics:{events}};
}
return {project,threshold,passes,relationThreshold,relationPasses};
});
