/* Current meeting state and its explicit revision history. No text is rewritten. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NorteMeetingState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const labels={open:'Em aberto',registered:'Registrado',completed:'Concluído',review:'Revisar',conflict:'Conflito',error:'Erro',superseded:'Substituído'};
const sourceId=r=>r.source_event_id||r.source_id||r.event_id;
const targetId=r=>r.target_event_id||r.target_id;
const unique=items=>[...new Set(items)];
const isQuestion=e=>e.type==='other'&&(e.is_question===true||e.subtype==='question'||/\?\s*$/.test(String(e.text||'')));
const isAction=e=>['action','task','action_item','follow_up'].includes(e.type)||(e.type==='other'&&(e.is_action===true||['action','task','action_item','follow_up'].includes(e.subtype)));
const isWork=e=>e.type==='test_proposal'||isAction(e);
const assertion=e=>['decision','observation','test_result','requirement'].includes(e.type);
function evidenceApi(){
  if(root.NorteMeetingEvidence?.project)return root.NorteMeetingEvidence;
  if(typeof require==='function')return require('./meeting-evidence.js');
  throw Error('A projeção de evidências da reunião não está disponível.');
}
function build(source){
  if(!source||!Array.isArray(source.meeting_events))throw Error('A memória precisa conter meeting_events.');
  const Evidence=evidenceApi(),projection=Evidence.project(source),run=projection.run;
  const original=new Map(),positions=new Map();
  for(const [index,event] of source.meeting_events.entries()){
    if(typeof event.event_id!=='string'||!event.event_id||original.has(event.event_id))throw Error('Identificador de evento ausente ou repetido.');
    original.set(event.event_id,event);positions.set(event.event_id,index);
  }
  const events=run.meeting_events.map(event=>{const raw=original.get(event.event_id);return raw&&raw.thread_id===event.thread_id?raw:event;}),byId=Object.create(null),alerts=[],alertIds=new Set();
  for(const event of events)byId[event.event_id]={
    id:event.event_id,event,type:event.type,text:String(event.text||''),topic_id:event.thread_id||null,
    status:'registered',state_label:labels.registered,reasons:[],alerts:[],relation_ids:[],relations:[],
    completed:false,resolved:false,current:true,blocked:false,blocked_by:[],ambiguous:false,
    evidence:[],results:[],tests:[],dependencies:[],evidence_state:'unassessed',standalone:false
  };
  const entries=events.map(e=>byId[e.event_id]),flags=new Map(entries.map(n=>[n.id,{review:false,error:false,conflict:false,retired:false}]));
  const reason=(node,message)=>{if(node&&!node.reasons.includes(message))node.reasons.push(message);};
  const alert=(code,message,eventIds=[],relationIds=[],kind='review')=>{
    const ids=unique(eventIds.filter(id=>byId[id])),rids=unique(relationIds.filter(Boolean));
    const id=code+':'+ids.join(',')+':'+rids.join(',');if(alertIds.has(id))return;
    alertIds.add(id);const item={id,code,kind,message,event_ids:ids,relation_ids:rids};alerts.push(item);
    const changesState=kind==='conflict'||['classification','unassigned','replacement_cycle','replacement_branch','dependency_pending'].includes(code);
    for(const eid of ids){const node=byId[eid];node.alerts.push(item);reason(node,message);if(changesState)flags.get(eid)[kind==='error'?'error':kind==='conflict'?'conflict':'review']=true;}
    return item;
  };
  for(const node of entries){
    for(const issue of projection.diagnostics?.events?.[node.id]||[])alert('classification',issue.message,[node.id],[],issue.kind==='error'?'error':'pending');
    if(!node.topic_id&&!node.alerts.length)alert('unassigned','Este registro ainda precisa ser associado a um assunto.',[node.id],[],'pending');
  }
  const normalized=[],rawRelations=source.meeting_relations||[],rawRelationSet=new Set(rawRelations),rawRelationById=new Map(rawRelations.filter(r=>r.relation_id).map(r=>[r.relation_id,r]));
  for(const [index,projected] of (run.meeting_relations||[]).entries()){
    if(!projected?.relation_type||projected.relation_type==='none')continue;
    const relation=rawRelationSet.has(projected)?projected:rawRelationById.get(projected.relation_id)||projected;
    const a=byId[sourceId(relation)],b=byId[targetId(relation)];if(!a||!b)continue;
    const id=relation.relation_id||relation.id||'relation-'+index;
    const confidence=relation.review_state==='confirmed'&&!relation.error&&Evidence.relationPasses(relation.relation_probability)&&Evidence.relationPasses(relation.match_probability);
    const sameTopic=!!a.topic_id&&a.topic_id===b.topic_id;
    const match=relation.configuration_match??null;
    const compatible=match==='exact'||match==='not_applicable'||match==null&&relation.configuration_applicable===false;
    const edge={id,relation,source:a,target:b,type:relation.relation_type,same_topic:sameTopic,confirmed:confidence&&sameTopic,compatible,configuration_match:match};
    const link=(counterpart,direction)=>({relation,relation_id:id,event:counterpart.event,event_id:counterpart.id,type:edge.type,direction,configuration_match:match,confirmed:edge.confirmed,compatible,usable:false});
    edge.out=link(b,'outgoing');edge.in=link(a,'incoming');a.relations.push(edge.out);b.relations.push(edge.in);
    a.relation_ids.push(id);b.relation_ids.push(id);normalized.push(edge);
    if(!sameTopic)alert('cross_topic','O vínculo envolve assuntos diferentes ou ainda sem assunto definido.',[a.id,b.id],[id]);
    else if(!confidence)alert(relation.error?'relation_error':'relation_uncertain',relation.error?'Não foi possível concluir a classificação deste vínculo.':'O vínculo ainda não está confirmado para atualizar o estado.',[a.id,b.id],[id],relation.error?'error':'review');
    else if(match==='ambiguous')alert('configuration_ambiguous','A configuração deste vínculo é ambígua; nenhuma conclusão foi aplicada.',[a.id,b.id],[id]);
  }
  const confirmed=normalized.filter(e=>e.confirmed),replacement=confirmed.filter(e=>e.type==='supersedes'&&(e.compatible||['partial','mismatch'].includes(e.configuration_match)));
  const adjacency=new Map(),newer=new Map(),older=new Map();
  for(const edge of replacement){
    for(const [a,b] of [[edge.source.id,edge.target.id],[edge.target.id,edge.source.id]]){if(!adjacency.has(a))adjacency.set(a,new Set());adjacency.get(a).add(b);}
    if(!newer.has(edge.target.id))newer.set(edge.target.id,new Set());newer.get(edge.target.id).add(edge.source.id);
    if(!older.has(edge.source.id))older.set(edge.source.id,new Set());older.get(edge.source.id).add(edge.target.id);
  }
  const changes=[],visited=new Set(),chronological=ids=>unique(ids).sort((a,b)=>positions.get(a)-positions.get(b)).map(id=>byId[id].event);
  for(const id of adjacency.keys()){
    if(visited.has(id))continue;const members=[],stack=[id];
    while(stack.length){const next=stack.pop();if(visited.has(next))continue;visited.add(next);members.push(next);for(const neighbor of adjacency.get(next)||[])stack.push(neighbor);}
    const memberSet=new Set(members),edges=replacement.filter(e=>memberSet.has(e.source.id)&&memberSet.has(e.target.id));
    const heads=members.filter(eid=>!newer.get(eid)?.size),roots=members.filter(eid=>!older.get(eid)?.size);
    const done=new Set(),visiting=new Set();let cycle=false;
    const visit=eid=>{if(visiting.has(eid)){cycle=true;return;}if(done.has(eid))return;visiting.add(eid);for(const old of older.get(eid)||[])visit(old);visiting.delete(eid);done.add(eid);};
    for(const eid of members)visit(eid);
    const branched=heads.length!==1;
    const ambiguous=cycle||branched;
    if(cycle){
      for(const eid of members){byId[eid].ambiguous=true;byId[eid].current=false;}
      alert('replacement_cycle','As substituições formam um ciclo; não há um estado atual seguro para este item.',members,edges.map(e=>e.id));
    }else{
      for(const eid of members)if(newer.get(eid)?.size){flags.get(eid).retired=true;byId[eid].current=false;reason(byId[eid],'Este registro foi substituído explicitamente por '+[...newer.get(eid)].join(', ')+'.');}
      if(branched){for(const eid of heads)byId[eid].ambiguous=true;alert('replacement_branch','Há versões concorrentes deste item; nenhuma foi escolhida como a única vigente.',heads,edges.map(e=>e.id));}
    }
    const steps=unique(edges.map(e=>e.source.id));
    const rationale=confirmed.filter(e=>e.type==='based_on'&&steps.includes(e.source.id)).map(e=>e.target.id);
    const consequences=confirmed.filter(e=>e.type==='affects'&&steps.includes(e.source.id)).map(e=>e.target.id);
    changes.push({id:'change:'+chronological(members).map(e=>e.event_id).join(':'),topic_id:byId[id].topic_id,item:chronological(roots.length?roots:members),before:chronological(members.filter(eid=>!heads.includes(eid))),change:chronological(steps),current:cycle?[]:chronological(heads),reason:chronological(rationale),consequences:chronological(consequences),relation_ids:unique([...edges.map(e=>e.id),...confirmed.filter(e=>steps.includes(e.source.id)&&['based_on','affects'].includes(e.type)).map(e=>e.id)]),ambiguous,reasons:ambiguous?[cycle?'Substituições circulares.':'Versões concorrentes; estado atual não é único.']:[]});
  }
  const resultParents=new Map();
  for(const edge of confirmed)if(edge.type==='result_of'&&edge.source.type==='test_result'&&isWork(edge.target.event)&&edge.configuration_match==='exact'&&edge.source.current&&!edge.source.ambiguous){
    if(!resultParents.has(edge.source.id))resultParents.set(edge.source.id,new Set());resultParents.get(edge.source.id).add(edge.target.id);
  }
  const ambiguousResults=new Set([...resultParents].filter(([,parents])=>parents.size>1).map(([id])=>id));
  for(const id of ambiguousResults){const matches=confirmed.filter(e=>e.source.id===id&&e.type==='result_of'&&e.configuration_match==='exact');alert('result_attribution','Este resultado aponta para mais de um teste; confirme qual execução ele relata.',[id,...resultParents.get(id)],matches.map(e=>e.id));}
  for(const edge of normalized){
    const {source:a,target:b}=edge;
    const active=edge.confirmed&&a.current&&!a.ambiguous;
    edge.out.usable=edge.in.usable=active&&edge.compatible&&b.current&&!b.ambiguous&&!(edge.type==='result_of'&&ambiguousResults.has(a.id));
    if(!edge.same_topic)continue;
    if(edge.confirmed&&edge.type==='supersedes'&&!replacement.includes(edge))alert('replacement_configuration','A substituição não tem identidade suficientemente definida para atualizar a versão vigente.',[a.id,b.id],[edge.id]);
    if(edge.type==='depends_on')a.dependencies.push(edge.out);
    if(edge.type==='based_on'&&a.type==='decision'){
      a.evidence.push(edge.out);
      if(a.current&&edge.confirmed&&(!b.current||b.ambiguous))alert('retired_rationale','A decisão cita uma justificativa substituída ou sem versão atual única; confira sua validade.',[a.id,b.id],[edge.id]);
    }
    if(edge.type==='tests')b.tests.push(edge.in);
    if(['supports','contradicts'].includes(edge.type))b.evidence.push(edge.in);
    if(edge.type==='result_of'&&a.type==='test_result'&&isWork(b.event)){
      b.results.push(edge.in);
      if(!edge.confirmed||ambiguousResults.has(a.id))continue;
      if(!a.current||a.ambiguous){if(b.current)alert('retired_result','O resultado associado foi substituído ou está em revisão; ele não conclui o trabalho atual.',[a.id,b.id],[edge.id]);continue;}
      if(edge.configuration_match==='exact'){
        if(b.current&&!b.ambiguous){b.completed=true;reason(b,'Execução relatada com resultado direto na configuração correspondente; aprovação não foi inferida.');}
      }else alert('result_configuration','O resultado não confirma execução na configuração planejada ('+(edge.configuration_match||'não informada')+').',[a.id,b.id],[edge.id]);
    }
    if(!active||!['supports','contradicts'].includes(edge.type)||!assertion(a.event))continue;
    if(!edge.compatible){alert('evidence_configuration','A evidência usa uma configuração não equivalente; ela não altera a conclusão vigente.',[a.id,b.id],[edge.id]);continue;}
    const next=edge.type==='supports'?'supported':'challenged';
    b.evidence_state=b.evidence_state==='unassessed'?next:b.evidence_state===next?next:'mixed';
  }
  for(const node of entries){
    if(!node.current)continue;
    if(node.evidence_state==='mixed')alert('mixed_evidence','Há evidências em sentidos opostos para este registro; é necessária uma decisão explícita.',[node.id],node.evidence.filter(l=>l.usable).map(l=>l.relation_id),'conflict');
    else if(node.evidence_state==='challenged'){
      if(node.type==='requirement'||node.type==='observation'||node.type==='decision')alert('contradicted','Há evidência direta que contradiz este registro.',[node.id],node.evidence.filter(l=>l.type==='contradicts'&&l.usable).map(l=>l.relation_id),'conflict');
      else reason(node,'Há evidência contrária; a hipótese não foi encerrada automaticamente.');
    }else if(node.evidence_state==='supported')reason(node,'Há evidência de suporte; isso não equivale a comprovação ou aprovação.');
  }
  const dependencyEdges=confirmed.filter(e=>e.type==='depends_on');
  const satisfied=node=>node.current&&!node.ambiguous&&!flags.get(node.id).conflict&&!flags.get(node.id).error&&(node.completed||node.resolved);
  const unmet=node=>dependencyEdges.filter(e=>e.source===node&&(!e.compatible||!satisfied(e.target)));
  const resolutions=confirmed.filter(e=>e.compatible&&e.source.current&&!e.source.ambiguous&&(
    e.source.type==='decision'&&(['resolves','resolves_issue','rejects'].includes(e.type)&&['observation','hypothesis','requirement'].includes(e.target.type)||e.type==='contradicts'&&e.target.type==='hypothesis')||
    isQuestion(e.target.event)&&assertion(e.source.event)&&['answers','clarifies','resolves'].includes(e.type)
  ));
  // Resolution dependencies may themselves resolve later in the same snapshot.
  for(let pass=0;pass<entries.length;pass++){
    let changed=false;
    for(const edge of resolutions){const node=edge.target;if(node.current&&!node.ambiguous&&!node.resolved&&!flags.get(node.id).conflict&&!unmet(edge.source).length){node.resolved=true;reason(node,'Encerramento explicitamente registrado por '+edge.source.id+'; não implica comprovação técnica.');changed=true;}}
    if(!changed)break;
  }
  for(const node of entries){
    if(!node.current)continue;
    const waiting=unmet(node);
    node.blocked_by=unique(waiting.map(e=>e.target.id));node.blocked=node.blocked_by.length>0;
    if(node.blocked)alert('dependency_pending','Depende de '+node.blocked_by.join(', ')+', ainda sem conclusão válida.',[node.id],waiting.map(e=>e.id),'pending');
  }
  for(const job of run.typed_relation_worker?.jobs||[]){
    if(!byId[job.event_id])continue;
    if(['error','interrupted'].includes(job.status))alert('processing',job.status==='error'?'A análise dos vínculos deste registro terminou com erro.':'A análise dos vínculos deste registro foi interrompida.',[job.event_id],[],job.status==='error'?'error':'pending');
    for(const result of job.results||[])if(result.relation_type==='none'&&result.review_state==='needs_review')alert('negative_uncertain','A ausência de vínculo ainda precisa de conferência.',[job.event_id,result.target_event_id]);
  }
  for(const node of entries){
    const state=flags.get(node.id),baseOpen=isWork(node.event)||['hypothesis','observation'].includes(node.type)||isQuestion(node.event);
    node.status=state.retired?'superseded':state.error?'error':state.conflict?'conflict':state.review||node.ambiguous||node.blocked?'review':node.completed||node.resolved?'completed':baseOpen?'open':'registered';
    node.state_label=labels[node.status];
    node.standalone=node.type==='test_result'&&(ambiguousResults.has(node.id)||!normalized.some(e=>e.same_topic&&e.type==='result_of'&&e.source===node&&isWork(e.target.event)));
    if(node.status==='open')reason(node,node.type==='test_proposal'?'Ainda não há resultado direto na configuração correspondente para este teste.':node.type==='hypothesis'?'A hipótese continua em aberto, sem encerramento explícito.':node.type==='observation'?'Este problema ainda não tem resolução explicitamente vinculada.':isQuestion(node.event)?'Esta pergunta ainda não tem uma resposta diretamente vinculada.':'Ainda não há conclusão explicitamente registrada para esta ação.');
    node.relation_ids=unique(node.relation_ids);
  }
  for(const node of entries)for(const link of node.relations){const counterpart=byId[link.event_id];link.event_status=counterpart.status;link.event_current=counterpart.current;}
  const threadOrder=unique([...(run.meeting_threads||[]).map(t=>t.thread_id),...events.map(e=>e.thread_id||null)]);
  const topics=threadOrder.map((id,index)=>{
    const group=entries.filter(n=>n.topic_id===(id||null));if(!group.length)return null;
    const current=group.filter(n=>n.current),thread=(run.meeting_threads||[]).find(t=>t.thread_id===id),explicit=run.topic_titles?.[id]||thread?.title;
    return {id:id||null,title:typeof explicit==='string'&&explicit.trim()?explicit.trim():id?'Assunto '+(index+1)+' · sem título':'Pontos a organizar',
      current:{decisions:current.filter(n=>n.type==='decision'),actions:current.filter(n=>isWork(n.event)&&!n.completed&&!n.resolved),open_points:current.filter(n=>(['hypothesis','observation'].includes(n.type)||isQuestion(n.event))&&!n.resolved),requirements:current.filter(n=>n.type==='requirement'),tests:current.filter(n=>n.type==='test_proposal'||n.type==='test_result'&&n.standalone)},
      history:{events:group,changes:changes.filter(change=>change.topic_id===(id||null))},alerts:alerts.filter(item=>item.event_ids.some(eid=>byId[eid].topic_id===(id||null)))};
  }).filter(Boolean);
  const pending=entries.filter(n=>(n.current||n.ambiguous)&&(['open','review','conflict','error'].includes(n.status)||n.blocked));
  return {topics,byId,alerts,pending,excluded:projection.excluded||[],metrics:{topics:topics.length,events:entries.length,current_events:entries.filter(n=>n.current).length,pending:pending.length,completed:entries.filter(n=>n.status==='completed').length,conflicts:entries.filter(n=>n.status==='conflict').length,reviews:entries.filter(n=>n.status==='review').length,errors:entries.filter(n=>n.status==='error').length,superseded:entries.filter(n=>n.status==='superseded').length,changes:changes.length,excluded:(projection.excluded||[]).length}};
}
return {build,labels};
});
