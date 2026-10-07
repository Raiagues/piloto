/* Shared, source-preserving structure for the meeting preview and its PDF. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NorteMeetingDocument=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const eventText=event=>String(event?.text||event?.event?.text||'');
const eventId=event=>event?.event_id||event?.id||event?.event?.event_id||'';
const topicEntries=topic=>topic.history?.events||Object.values(topic.current||{}).flat();
const unique=entries=>{const seen=new Set();return (entries||[]).filter(entry=>{const id=eventId(entry);if(seen.has(id||entry))return false;seen.add(id||entry);return true;});};
function topicHeading(topic,index=0){
  const ordinal=index+1,title=String(topic.title||'').trim();
  if(topic.untitled||!title||/^Assunto\s+\d+\s*[·:]\s*sem título$/i.test(title))return 'Assunto '+ordinal+': sem título';
  return 'Assunto '+ordinal+': '+title;
}
function sectionsForTopic(topic,ordinal=1){
  const current=topic.current||{},all=topicEntries(topic).filter(entry=>entry.current!==false),open=current.open_points||[];
  let context=unique([...all.filter(entry=>['observation','context'].includes(entry.type)),...open.filter(entry=>['observation','context'].includes(entry.type)),...(current.requirements||[])]);
  if(topic.summary?.text){
    const covered=new Set(topic.summary.event_ids||[]),aliases=context.filter(entry=>covered.has(eventId(entry))).map(entry=>'event:'+eventId(entry));
    context=[{id:'summary:'+(topic.thread_id||topic.id||'unassigned'),type:'summary',text:topic.summary.text,event_ids:[...covered],anchor_aliases:aliases},...context.filter(entry=>!covered.has(eventId(entry)))];
  }
  const hypotheses=unique([...all.filter(entry=>entry.type==='hypothesis'),...open.filter(entry=>entry.type==='hypothesis')]);
  const questions=open.filter(entry=>!['observation','context','hypothesis'].includes(entry.type));
  const tests=(current.tests||[]).filter(entry=>entry.completed||entry.type==='test_result');
  const pendingTests=(current.tests||[]).filter(entry=>entry.type==='test_proposal'&&!entry.completed);
  const groups=[['context','',context,'context'],['hypotheses','Hipóteses',hypotheses,'open_points'],['tests','Testes',tests,'tests'],['decisions','Concluído',current.decisions,'decisions'],['actions','Em aberto',unique([...(current.actions||[]),...pendingTests,...questions]),'actions']];
  let numbered=0;
  return groups.filter(([, ,entries])=>entries?.length).map(([key,label,entries,source_key])=>({
    kind:key==='context'?'context':'current',key,source_key,id:'section:'+(topic.thread_id||topic.id||'unassigned')+':'+key,
    title:label?ordinal+'.'+(++numbered)+' '+label:'',label,entries
  }));
}
function entryLinks(entry,section){
  const relations=entry.relations||[],outgoing=type=>relations.filter(link=>link.type===type&&link.direction==='outgoing');
  const requirements=relations.filter(link=>link.event?.type==='requirement'&&['tests','supports','contradicts','depends_on','affects','based_on','constrains','implements'].includes(link.type));
  const lists=section==='decisions'?[entry.evidence,entry.dependencies,outgoing('affects')]:section==='tests'?[outgoing('tests'),entry.results,entry.dependencies,requirements]:section==='actions'?[entry.dependencies,requirements]:section==='context'?[entry.evidence,entry.dependencies]:[entry.tests,entry.evidence,entry.dependencies,requirements];
  const seen=new Set();return lists.flatMap(list=>list||[]).filter(link=>{
    const key=link.type+'|'+(link.event_id||eventId(link.event));
    if(seen.has(key)||!link.event||link.event_current===false&&!(section==='decisions'&&link.type==='based_on'))return false;
    if(link.type==='result_of'&&(!link.confirmed||!link.compatible||link.usable===false))return false;
    seen.add(key);return true;
  });
}
function linkLabel(link){
  const outgoing=link.direction==='outgoing';
  if(link.type==='tests')return outgoing?'Investiga':'Teste';
  if(link.type==='affects')return outgoing?'Consequência':link.event?.type==='requirement'?'Requisito':'Influência';
  if(link.type==='depends_on')return outgoing?'Depende de':'É dependência de';
  if(link.type==='constrains')return outgoing?'Restringe':'Restrição';
  if(link.type==='supports')return outgoing?'Dá suporte a':'Evidência de suporte';
  if(link.type==='contradicts')return outgoing?'Contradiz':'Evidência contrária';
  if(link.type==='implements')return outgoing?'Implementa':'Implementado por';
  return {based_on:'Base da decisão',result_of:'Resultado',supersedes:'Substitui',related_to:'Referência'}[link.type]||'Referência';
}
function linkAnnotation(link){
  // Diagnostics stay in the review controls. They are not prose in the minutes.
  return '';
}
function displayStatus(entry,section){return entry.status==='open'&&(section==='actions'||entry.type==='test_proposal')?'pending':entry.status;}
function completionDetails(entry){
  if(!entry.completed||!entry.completion)return [];
  const completion=entry.completion,rawDate=String(completion.performed_at||''),date=rawDate.replace(/^(\d{4})-(\d{2})-(\d{2})(?:T)?/,'$3/$2/$1 ' ).trim();
  const outcome={passed:'Sim',failed:'Não',unassessed:'Não avaliado'}[completion.outcome];
  return [{label:'Feito',text:completion.performed},{label:'Data',text:date},{label:'Atendeu ao esperado',text:outcome}].filter(item=>item.text);
}
function entryBlocks(entry,section,warningIds=()=>[],depth=0){
  const id=eventId(entry),warnings=warningIds(id),task=entry.type==='test_proposal'||section==='actions'&&entry.type!=='other';
  const links=entryLinks(entry,section),blocks=[];
  if(entry.type==='summary')return [{text:eventText(entry),depth,event_ids:entry.event_ids||[],anchor_id:id,anchor_aliases:entry.anchor_aliases||[],marker:'bullet'}];
  if(section==='tests'&&entry.type==='test_result'){
    blocks.push({text:'Teste desconhecido',depth,status:'review',marker:'bullet',keep_with_next:true,warning_ids:warnings,anchor_aliases:warnings.map(id=>'warning:'+id)});
    blocks.push({text:eventText(entry),depth:depth+1,event_ids:[id],anchor_id:'event:'+id,link_to:'event:'+id,status:displayStatus(entry,section),marker:'bullet'});
  }else blocks.push({text:eventText(entry),depth,event_ids:[id],anchor_id:'event:'+id,link_to:'event:'+id,status:displayStatus(entry,section),marker:task?(entry.completed?'done':'todo'):'bullet',keep_with_next:!!links.length,warning_ids:warnings,anchor_aliases:warnings.map(id=>'warning:'+id)});
  for(const detail of completionDetails(entry))blocks.push({text:detail.label+': '+detail.text,depth:depth+1,marker:'bullet',status:displayStatus(entry,section)});
  if(entry.pending_confirmed&&entry.post_meeting_note)blocks.push({text:'Falta validar: '+entry.post_meeting_note,depth:depth+1,marker:'bullet',status:'pending'});
  for(const link of links){const linkedId=eventId(link.event);blocks.push({
    text:linkLabel(link)+': '+eventText(link.event),depth:depth+1,event_ids:[linkedId],anchor_id:'event:'+linkedId,link_to:'event:'+linkedId,
    status:link.event_status||'registered',marker:'bullet',warning_ids:warningIds(linkedId),anchor_aliases:warningIds(linkedId).map(id=>'warning:'+id)
  });}
  return blocks;
}
function pdfDocument(doc,reviewed={}){
  const issues=(doc.issues||[]).filter(issue=>issue.code==='orphan_result'||issue.code==='unconfirmed_test');
  const printableIssues=issues.filter(issue=>!issue.resolved||issue.code==='orphan_result'&&['unknown','acknowledge_unknown'].includes(issue.disposition));
  const warningIds=id=>printableIssues.filter(issue=>issue.event_id===id).map(issue=>issue.id);
  const threads=(doc.topics||[]).map((topic,index)=>({
    id:'topic:'+(topic.thread_id||topic.id||'unassigned'),title:topicHeading(topic,index),
    sections:sectionsForTopic(topic,index+1).map(section=>({id:section.id,title:section.title,kind:section.kind,
      blocks:section.entries.flatMap(entry=>entryBlocks(entry,section.source_key,warningIds))}))
  }));
  // A source quoted in several places has one canonical destination: its main
  // entry, ahead of evidence quotes. Visible text never needs technical IDs.
  const canonical=new Map();
  for(const thread of threads)for(const section of thread.sections)for(const block of section.blocks){
    if(!block.anchor_id)continue;
    const previous=canonical.get(block.anchor_id);
    if(!previous||(block.depth||0)<(previous.depth||0))canonical.set(block.anchor_id,block);
  }
  for(const thread of threads)for(const section of thread.sections)for(const block of section.blocks){
    if(block.anchor_id&&canonical.get(block.anchor_id)!==block)delete block.anchor_id;
    // The canonical item is already at its destination; references remain links.
    else if(block.anchor_id===block.link_to)delete block.link_to;
  }
  return {title:doc.title||'Tópicos discutidos',presentation:'current_only',metadata:doc.metadata,
    contents:threads.map(thread=>({title:thread.title,target_id:thread.id})),threads,
    metrics:{events:doc.event_count??canonical.size},batch_id:doc.batch_id||'reuniao'};
}
return {sectionsForTopic,topicHeading,eventId,eventText,topicEntries,entryLinks,linkLabel,linkAnnotation,displayStatus,completionDetails,entryBlocks,pdfDocument};
});
