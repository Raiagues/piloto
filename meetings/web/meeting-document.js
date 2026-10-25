/* Shared, source-preserving structure for the meeting preview and its PDF. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NorteMeetingDocument=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const eventText=event=>String(event?.display_text||event?.text||event?.event?.display_text||event?.event?.text||'');
const eventId=event=>event?.event_id||event?.id||event?.event?.event_id||'';
const topicEntries=topic=>topic.history?.events||Object.values(topic.current||{}).flat();
const unique=entries=>{const seen=new Set();return (entries||[]).filter(entry=>{const id=eventId(entry);if(seen.has(id||entry))return false;seen.add(id||entry);return true;});};
const referenceLabel=entry=>String(entry?.ref_label||entry?.event?.ref_label||('Ref. '+String(typeof entry==='string'?entry:eventId(entry)).replace(/^E0*(?=\d)/,'')));
function meetingURL(run,origin){
  const id=run?.id||run?.run_id;if(!id||!origin)return '';
  try{const base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)return '';const url=new URL(run.integrated_norte?'/meeting/'+encodeURIComponent(id):'/',base.origin);url.searchParams.set('meeting',String(id));url.hash=run.room_kind==='beam'?'simulacao':'reuniao';return url.href;}catch(_){return '';}
}
function eventURL(base,id){
  if(!base||!id)return '';
  try{const baseURL=new URL(base);if(!['http:','https:'].includes(baseURL.protocol)||baseURL.username||baseURL.password||!baseURL.searchParams.get('meeting'))return '';const meeting=baseURL.searchParams.get('meeting'),path='/meeting/'+encodeURIComponent(meeting),url=new URL(baseURL.pathname===path?path:'/',baseURL.origin);url.searchParams.set('meeting',meeting);url.searchParams.set('event',String(id));url.hash=baseURL.hash==='#simulacao'?'simulacao':'reuniao';return url.href;}catch(_){return '';}
}
function topicHeading(topic,index=0){
  const ordinal=index+1,title=String(topic.title||'').trim();
  if(topic.untitled||!title||/^Assunto\s+\d+\s*[·:]\s*sem título$/i.test(title))return 'Assunto '+ordinal+': sem título';
  return 'Assunto '+ordinal+': '+title;
}
function sectionsForTopic(topic,ordinal=1){
  const current=topic.current||{},all=unique([...topicEntries(topic),...Object.values(current).flat()]).filter(entry=>entry.current!==false),open=current.open_points||[];
  let context=unique([...all.filter(entry=>['observation','context'].includes(entry.type)),...open.filter(entry=>['observation','context'].includes(entry.type)),...(current.requirements||[])]);
  if(topic.summary?.text){
    const covered=new Set(topic.summary.event_ids||[]),aliases=context.filter(entry=>covered.has(eventId(entry))).map(entry=>'event:'+eventId(entry));
    context=[{id:'summary:'+(topic.thread_id||topic.id||'unassigned'),type:'summary',text:topic.summary.text,event_ids:[...covered],anchor_aliases:aliases},...context.filter(entry=>!covered.has(eventId(entry)))];
  }
  const hypotheses=unique([...all.filter(entry=>entry.type==='hypothesis'),...open.filter(entry=>entry.type==='hypothesis')]);
  const questions=open.filter(entry=>!['observation','context','hypothesis'].includes(entry.type));
  const tests=(current.tests||[]).filter(entry=>entry.type==='test_proposal'&&entry.completed);
  const results=unique([...all.filter(entry=>entry.type==='test_result'),...(current.tests||[]).filter(entry=>entry.type==='test_result')]);
  const pendingTests=(current.tests||[]).filter(entry=>entry.type==='test_proposal'&&!entry.completed);
  const tables=topicTables(topic);
  const groups=[['context','Contexto e requisitos',context,'context'],['hypotheses','Hipóteses',hypotheses,'open_points'],['tests','Testes realizados',tests,'tests'],['results','Resultados',results,'results'],['decisions','Decisões',current.decisions,'decisions'],['actions','Pendências',unique([...(current.actions||[]),...pendingTests,...questions]),'actions']];
  const assigned=new Set();
  for(const group of groups)group[2]=unique(group[2]).filter(entry=>{
    const id=eventId(entry);if(entry.current===false||assigned.has(id))return false;
    assigned.add(id);for(const covered of entry.event_ids||[])assigned.add(covered);return true;
  });
  // Unclassified current records stay visible without inferring a task or status.
  groups[0][2].push(...all.filter(entry=>!assigned.has(eventId(entry))));
  return groups.map(([key,label,entries,source_key],index)=>({
    kind:key==='context'?'context':'current',key,source_key,id:'section:'+(topic.thread_id||topic.id||'unassigned')+':'+key,
    title:ordinal+'.'+(index+1)+' '+label,label,entries:entries||[],tables:key==='results'?tables:[]
  })).filter(section=>section.entries.length||section.tables.length);
}
function topicTables(topic){
  const entries=new Map(topicEntries(topic).filter(entry=>entry.current!==false).map(entry=>[eventId(entry),entry]));
  const normalize=value=>String(value).replace(/\s+/g,' ').trim();
  if(!Array.isArray(topic.tables)||topic.tables.length>3)return [];
  return topic.tables.flatMap((table,index)=>{
    if(!table||typeof table.title!=='string'||!table.title.trim()||table.title.length>80||!Array.isArray(table.columns)||table.columns.length<2||table.columns.length>5||!table.columns.every(value=>typeof value==='string'&&value.trim()&&value.length<=80)||!Array.isArray(table.rows)||!table.rows.length||table.rows.length>16)return [];
    if(new Set(table.columns.map(value=>normalize(value).toLowerCase())).size!==table.columns.length)return [];
    const rows=[],seen=new Set();
    for(const row of table.rows){
      const entry=entries.get(row?.event_id),original=normalize(entry?.text||entry?.event?.text||'');
      if(!entry||!Array.isArray(row.cells)||row.cells.length!==table.columns.length||!row.cells.every(cell=>typeof cell==='string'&&cell.length<=120&&(!normalize(cell)||original.includes(normalize(cell))))||!row.cells.some(cell=>normalize(cell)))return [];
      const key=JSON.stringify([row.event_id,row.cells.map(normalize)]);if(seen.has(key))return [];seen.add(key);
      rows.push({event_id:row.event_id,cells:[...row.cells.map(cell=>normalize(cell)||'—'),referenceLabel(entry)],anchor_id:'event:'+row.event_id,reference:referenceLabel(entry)});
    }
    return [{id:'table:'+(topic.thread_id||topic.id||'unassigned')+':'+index,title:normalize(table.title),headers:[...table.columns,'Referência'],rows}];
  });
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
function briefReasons(entry){
  const links=entry.relations||[],items=[],seen=new Set();
  const add=(text,ids=[])=>{const event_ids=[...new Set(ids.filter(id=>id&&id!==eventId(entry)))];const key=text+'|'+event_ids.join(',');if(!seen.has(key)){seen.add(key);items.push({text,event_ids});}};
  const contradictory=links.filter(link=>link.type==='contradicts'&&link.confirmed!==false&&link.usable!==false&&link.event_current!==false);
  for(const link of contradictory)add(link.event?.type==='requirement'?'Contradiz requisito':entry.type==='requirement'?'Evidência contrária ao requisito':'Evidência contrária ao registro',[link.event_id||eventId(link.event)]);
  const incompatible=links.filter(link=>link.confirmed!==false&&['result_of','supports','contradicts'].includes(link.type)&&['mismatch','partial','ambiguous'].includes(link.configuration_match));
  for(const link of incompatible)add({mismatch:'Configuração diferente da referência',partial:'Configuração descrita apenas parcialmente',ambiguous:'Configuração ambígua; falta confirmar'}[link.configuration_match],[link.event_id||eventId(link.event)]);
  for(const alert of entry.alerts||[]){
    if(['result_configuration','evidence_configuration','configuration_ambiguous'].includes(alert.code)&&!incompatible.length)add(alert.code==='configuration_ambiguous'?'Configuração ambígua; falta confirmar':'Configuração não equivalente à referência',alert.event_ids||[]);
    if(alert.code==='contradicted'&&!contradictory.length)add('Evidência contrária ao registro',alert.event_ids||[]);
    if(alert.code==='mixed_evidence')add('Evidências apontam conclusões opostas',alert.event_ids||[]);
    if(alert.code==='retired_rationale')add('Justificativa substituída; revisar decisão',alert.event_ids||[]);
  }
  return items;
}
function displayStatus(entry,section){return entry.status==='open'&&(section==='actions'||entry.type==='test_proposal')?'pending':entry.status;}
function completionDetails(entry){
  if(!entry.completed||!entry.completion)return [];
  const completion=entry.completion,rawDate=String(completion.performed_at||''),date=rawDate.replace(/^(\d{4})-(\d{2})-(\d{2})(?:T)?/,'$3/$2/$1 ' ).trim();
  const outcome={passed:'Sim',failed:'Não',unassessed:'Não avaliado'}[completion.outcome];
  return [{label:'Feito',text:completion.performed},{label:'Data',text:date},{label:'Atendeu ao esperado',text:outcome}].filter(item=>item.text);
}
function entryBlocks(entry,section,warningIds=()=>[],depth=0,meeting_url=''){
  const id=eventId(entry),warnings=warningIds(id);
  const links=entryLinks(entry,section),blocks=[];
  if(entry.type==='summary')return [{text:eventText(entry),depth,event_ids:entry.event_ids||[],anchor_id:id,anchor_aliases:entry.anchor_aliases||[],marker:'bullet'}];
  blocks.push({text:eventText(entry),depth,event_ids:[id],anchor_id:'event:'+id,link_to:'event:'+id,external_url:eventURL(meeting_url,id),reference_label:referenceLabel(entry),status:displayStatus(entry,section),marker:'bullet',keep_with_next:!!links.length,warning_ids:warnings,anchor_aliases:warnings.map(id=>'warning:'+id)});
  if(section==='results'&&(entry.standalone||entry.unknown_test))blocks.push({text:'Teste de origem não identificado',depth:depth+1,status:'review',marker:'none'});
  for(const detail of completionDetails(entry))blocks.push({text:detail.label+': '+detail.text,depth:depth+1,marker:'bullet',status:displayStatus(entry,section)});
  if(entry.pending_confirmed&&entry.post_meeting_note)blocks.push({text:'Falta validar: '+entry.post_meeting_note,depth:depth+1,marker:'bullet',status:'pending'});
  const reasons=briefReasons(entry);
  for(const reason of reasons){
    const ids=reason.event_ids,refs=ids.map(eid=>referenceLabel([...(entry.relations||[]),...links].find(link=>(link.event_id||eventId(link.event))===eid)?.event||eid));
    blocks.push({text:reason.text+(refs.length?' · '+refs.join(', '):''),depth:depth+1,marker:'none',status:'conflict',detail_reason:true,link_to:ids[0]?'event:'+ids[0]:undefined,external_url:eventURL(meeting_url,ids[0])});
  }
  for(const link of links){const linkedId=eventId(link.event);if(link.type==='contradicts'&&reasons.some(reason=>reason.event_ids.includes(linkedId)))continue;blocks.push({
    text:linkLabel(link)+': '+referenceLabel(link.event),depth:depth+1,event_ids:[linkedId],link_to:'event:'+linkedId,external_url:eventURL(meeting_url,linkedId),
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
    sections:sectionsForTopic(topic,index+1).map(section=>({id:section.id,title:section.title,kind:section.kind,tables:section.tables.map(table=>({...table,rows:table.rows.map(row=>({...row,external_url:eventURL(doc.meeting_url,row.event_id)}))})),
      blocks:section.entries.flatMap(entry=>entryBlocks(entry,section.source_key,warningIds,0,doc.meeting_url))}))
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
  for(const thread of threads)for(const section of thread.sections)for(const table of section.tables)for(const row of table.rows){if(canonical.has(row.anchor_id))delete row.anchor_id;else canonical.set(row.anchor_id,row);}
  return {title:doc.title||'Ata de reunião',presentation:'current_only',metadata:doc.metadata,meeting_url:doc.meeting_url,
    contents:threads.map(thread=>({title:thread.title,target_id:thread.id})),threads,
    metrics:{events:doc.event_count??canonical.size},batch_id:doc.batch_id||'reuniao'};
}
return {sectionsForTopic,topicHeading,eventId,eventText,topicEntries,topicTables,entryLinks,linkLabel,linkAnnotation,briefReasons,referenceLabel,meetingURL,eventURL,displayStatus,completionDetails,entryBlocks,pdfDocument};
});
