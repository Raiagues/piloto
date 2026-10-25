/* Directed semantic edges. Predictions and immutable evidence, never expected labels, drive memory. */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./experiments.js') : root.NorteExperiments;
  const threshold = .8, token = '{{candidate_id}}';
  const defaults = {
    "questions": {
      "relation_type": {
        "type": "choice",
        "instructions": "Current event: {{current_type}}. Candidate {{candidate_id}}: {{candidate_type}}. Which DIRECT relationship does current_event assert toward candidate {{candidate_id}}? Read this pair, using thread_history only to resolve references. Do not turn shared subject, adjacency, background, or a possible technical connection into an edge. Do not infer a link solely from a path through another event. Resolve explicit references normally. Use the closest explicit referent: a result points to its proposal, not an earlier decision choosing that plan; a decision citing a measurement points to that result, not its proposal. Toward a decision, a proposal implementing it is related_to, not result_of. Proposals are not evidence or executed outcomes. A plan clarification does not recover conditions omitted from a result. A plan to evaluate one claim does not automatically evaluate every requirement of its subject. Prefer none when no direct statement links this candidate. Record the relationship asserted by the meeting, not whether the assertion is true. A report attributed to a named trial links to that trial even if its setup is uncertain. Resolve indirect references in context: a later rerun result can identify an earlier repeat request even without repeating its numeric settings. An alternative causal hypothesis can explain the established problem without repeating its subject.",
        "criteria": {
          "result_of": "The candidate represents a proposed test or action, NOT an earlier test result. The current event reports execution/outcome attributed to that specific plan/action. Explicit attribution establishes result_of even when the executed configuration is unresolved or differs; configuration is assessed separately. Two reports of the same trial are NOT result_of each other. A proposal is not an executed outcome. Use the applicable explicit proposal rather than an earlier planning decision.",
          "supports": "The current event explicitly supplies evidence strengthening the candidate hypothesis or claim, or reports satisfying the candidate requirement under its applicable conditions. Do not infer causal support solely from a successful test. A measured outcome is not a new requirement.",
          "contradicts": "The current event supplies evidence against the candidate claim or hypothesis, or reports violating the candidate requirement under its applicable conditions. A different experiment outcome does not invalidate the earlier measurement. Do not infer refutation of a broad causal possibility from an unsuccessful intervention alone.",
          "depends_on": "The current action, decision or conclusion explicitly requires the candidate or its resolution as a prerequisite. Temporal order, sharing a goal, and being a result of a test are insufficient.",
          "affects": "The current event asserts a causal influence or concrete impact on the property/state recorded by the candidate, even when both events are observations. For example, an identified mechanism changing the recorded position establishes an impact, not just shared subject. A tentative causal hypothesis is an explanation (related_to), not an established impact. A generic constraint with no identified consequence is insufficient.",
          "supersedes": "The current event replaces, cancels or corrects the candidate, directly or by explicitly implementing a stated replacement decision. A new proposal can replace an older plan with different settings. Another event documenting the same replacement does not invalidate this explicit link. Merely being newer or technically different is insufficient.",
          "repeats": "Requests or reports a new execution of an identified prior test/action. The candidate may be its proposal OR a result identifying that prior execution. An explicit reference to a named run or clearly resolved reference establishes the link; same parameters alone do not. A result of its own proposal is result_of, not repeats. New execution IDs need not change the setup.",
          "tests": "Proposes an investigation specifically to evaluate the candidate hypothesis, requirement or claim. The candidate is the claim being evaluated, not another test proposal. Shared measurement variables alone do not mean that every requirement is being tested; the purpose must be established.",
          "clarifies": "The current event directly resolves a missing referent, scope or meaning IN the candidate. Clarifying an intended plan parameter does not clarify the conditions actually executed in a separate result report, and cannot recover an unrecorded measurement. Mere background is insufficient.",
          "based_on": "The current decision or conclusion explicitly cites the candidate evidence or rationale as its basis. This records the stated rationale without endorsing its validity.",
          "related_to": "A hypothesis proposes an explanation for the candidate problem or failure, including failure reported as a test_result; use thread context to resolve the established problem even when the cause names another component. Also a proposal implements the candidate decision, or explicitly compares itself with the candidate plan. Comparing a plan does not also compare its result or parameter definition. Background, common subject or generic relevance alone are none.",
          "none": "No specific direct claim links this pair. Includes factual background, shared subject/parameters, mere relevance of a requirement, or a link to ANOTHER named event. Comparing a plan with a prior plan does not also link its past result or a parameter definition. A path through other events alone is insufficient."
        }
      },
      "configuration_match": {
        "type": "choice",
        "instructions": "Source type: {{current_type}}; candidate {{candidate_id}} type: {{candidate_type}}. The predicted {{relation_type}} link means: {{relation_definition}} For THIS purpose, does comparing configurations make sense? A general hypothesis or problem does not define a concrete setup to match: use not_applicable. Also use not_applicable for rationale citations, definitions, prerequisites and impacts. Otherwise compare only explicit subject and setup conditions in this pair. Missing execution settings stay missing; the plan cannot supply them. Outcomes, acceptance limits and statement types are not setup parameters. A repeat can change its run ID without changing setup.",
        "criteria": {
          "exact": "A setup comparison is needed. Both events identify the same subject and compatible explicit setup parameters/conditions. Trial IDs identify executions, not a changed setup when repetition is explicit. Outcomes and acceptance limits are not setup parameters.",
          "partial": "A setup comparison is needed. Its identity is clear, but one event omits a setup parameter or condition supplied by the other; nothing explicitly conflicts. Missing conditions cannot be assumed merely because a plan specified them. When the relationship resolves an indirect reference to this test, missing stated settings are partial rather than a new unknown identity.",
          "mismatch": "A setup comparison is needed. The pair has at least one explicitly conflicting version, component, subject identity or setup parameter/condition. A common test name does not override a different speed, load, temperature, thickness or other setup value.",
          "ambiguous": "A setup comparison is needed, but the setup identity itself is unresolved or has multiple plausible alternatives. This differs from details omitted in a reference that the supplied relationship has already linked to the candidate test.",
          "not_applicable": "The relationship does not require setup identity. Examples: a decision cites evidence as rationale (based_on), a definition clarifies intended meaning (clarifies), a task is a prerequisite (depends_on), something has an impact (affects), or a test/evidence concerns a general hypothesis. Shared names and values do not turn these roles into a setup comparison. result_of and repeats do require comparing the planned/performed action identity, even without numeric setup settings."
        }
      }
    }
  };
  const types = Object.keys(defaults.questions.relation_type.criteria), matches = Object.keys(defaults.questions.configuration_match.criteria);
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const fields = e => ({event_id:e.event_id,chunk_id:e.chunk_id,type:e.type,text:e.text});
  function validateConfig(value) {
    if (!value || Object.keys(value).join() !== 'questions') throw Error('Relações tipadas: use somente questions.');
    E.validateConfig({model:'jev-latest',questions:value.questions});
    if (Object.keys(value.questions).sort().join() !== 'configuration_match,relation_type') throw Error('Mantenha relation_type e configuration_match.');
    for (const [key,labels] of [['relation_type',types],['configuration_match',matches]]) {
      const q=value.questions[key];
      if (q.type!=='choice' || Object.keys(q.criteria).sort().join()!==[...labels].sort().join()) throw Error('Mantenha as categorias de '+key+'; as instruções e critérios são editáveis.');
      if (!q.instructions.includes(token)) throw Error('Inclua {{candidate_id}} nas instruções de '+key+'.');
    }
    return E.clone(value);
  }
  function validateExpected(value,cases) {
    if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('expected_typed_relations deve ser um mapa de pares explícitos.');
    const positions=new Map(cases.map((c,i)=>[c.id,i]));
    return Object.fromEntries(Object.entries(value).map(([source,group])=>{
      if (!positions.has(source) || !group || typeof group!=='object' || Array.isArray(group)) throw Error('Origem de relação esperada inválida.');
      return [source,Object.fromEntries(Object.entries(group).map(([target,label])=>{
        if (!positions.has(target) || positions.get(target)>=positions.get(source)) throw Error('A relação deve apontar para um chunk anterior existente.');
        if (!label || Object.keys(label).some(k=>!['relation_type','configuration_match'].includes(k)) || !types.includes(label.relation_type)) throw Error('relation_type esperado inválido.');
        if (label.relation_type==='none' && Object.hasOwn(label,'configuration_match') || label.configuration_match!==undefined && !matches.includes(label.configuration_match)) throw Error('configuration_match esperado inválido; none não tem comparação.');
        return [target,E.clone(label)];
      }))];
    }));
  }
  function candidatesFor(run,current) {
    const index=run.meeting_events.findIndex(e=>e.event_id===current.event_id);
    return current.thread_id ? run.meeting_events.slice(0,index).filter(e=>e.thread_id===current.thread_id) : [];
  }
  function request(run,current,candidates,stage,config,results=[],schemaVersion=2) {
    // All earlier events of this thread are evidence. Never add future events,
    // ground truth, predicted lifecycle or unrelated thread content.
    const history=candidatesFor(run,current);
    const isolated=stage==='configuration_match'&&schemaVersion>=2;
    if(isolated&&candidates.length!==1)throw Error('Cada comparação de configuração usa somente um par.');
    const relationType=isolated?results.find(r=>r.target_event_id===candidates[0].event_id)?.relation_type:null;
    const state={current_event:fields(current),...(!isolated?{thread_history:history.map(fields)}:{relation_type:relationType}),candidates:candidates.map(candidate=>({
      ...fields(candidate),...(stage==='configuration_match'?{relation_type:results.find(r=>r.target_event_id===candidate.event_id)?.relation_type}: {})
    }))};
    const questions=Object.fromEntries(candidates.map(c=>{
      const q=config.questions[stage];
      const predictedType=results.find(r=>r.target_event_id===c.event_id)?.relation_type;
      const expand=text=>text.replaceAll(token,c.event_id).replaceAll('{{current_type}}',current.type).replaceAll('{{candidate_type}}',c.type).replaceAll('{{relation_type}}',predictedType||'not_yet_classified').replaceAll('{{relation_definition}}',config.questions.relation_type.criteria[predictedType]||'not_yet_classified');
      return [stage+'__'+c.event_id,{type:'choice',instructions:expand(q.instructions),criteria:Object.fromEntries(Object.entries(q.criteria).map(([k,v])=>[k,expand(v)]))}];
    }));
    const req={model:'jev-latest',state,questions};
    E.validateState(state); E.validateConfig(req);
    if(new TextEncoder().encode(JSON.stringify(req)).length>64000)throw Error('A chamada de relações excede 64 KB.');
    return req;
  }
  function plan(run,current,candidates,stage,config,results=[],schemaVersion=2) {
    const parts=[];let group=[];
    const build=group=>request(run,current,group,stage,config,results,schemaVersion);
    const flush=()=>{if(group.length){parts.push({stage,candidate_ids:group.map(e=>e.event_id),request:build(group),status:'queued'});group=[];}};
    for(const candidate of candidates){
      try{build([...group,candidate]);group.push(candidate);}
      catch(_){flush();try{build([candidate]);group=[candidate];}catch(error){parts.push({stage,candidate_ids:[candidate.event_id],status:'error',error:'Par não enviado: '+error.message});}}
    }
    flush();return parts;
  }
  function resultsFor(job) {
    return job.candidate_ids.map(id=>{
      const typePart=job.parts.find(p=>p.stage==='relation_type'&&p.candidate_ids.includes(id)),matchPart=job.parts.find(p=>p.stage==='configuration_match'&&p.candidate_ids.includes(id));
      const a=typePart?.output?.response.answers['relation_type__'+id];
      if(!a)return null;
      const type=E.predicted(a),m=type!=='none'?matchPart?.output?.response.answers['configuration_match__'+id]:null;
      const rp=E.probabilityOf(a,type),match=m?E.predicted(m):null,mp=m?E.probabilityOf(m,match):null;
      const error=type!=='none' ? matchPart?.error || (matchPart?.status==='interrupted'?'Comparação interrompida.':null) : null;
      return {target_event_id:id,relation_type:type,configuration_match:match,relation_probability:rp,match_probability:mp,
        review_state:rp+1e-12>=threshold && (type==='none'||m&&mp+1e-12>=threshold)?'confirmed':'needs_review',...(error?{error}:{})};
    }).filter(Boolean);
  }
  function syncMemory(run) {
    const edges=[];
    for(const job of run.typed_relation_worker?.jobs || []){
      job.results=resultsFor(job);
      for(const r of job.results)if(r.relation_type!=='none')edges.push({relation_id:'MR_'+job.event_id+'_'+r.target_event_id,job_id:job.event_id,thread_id:job.thread_id,
        source_event_id:job.event_id,target_event_id:r.target_event_id,relation_type:r.relation_type,
        configuration_match:r.configuration_match==='not_applicable'?null:r.configuration_match,
        configuration_applicable:r.configuration_match===null?null:r.configuration_match!=='not_applicable',
        relation_probability:r.relation_probability,match_probability:r.match_probability,review_state:r.review_state,...(r.error?{error:r.error}:{})});
    }
    run.meeting_relations=edges;return edges;
  }
  function start(run,{config=defaults,version=null,send,onChange=()=>{},streaming=false,resume=false}) {
    if(run.typed_relation_worker&&!resume)throw Error('Crie uma nova rodada para executar novamente as relações.');
    if(!streaming&&(run.status==='running'||run.thread_worker?.status==='running'))throw Error('Aguarde chunks e threads terminarem ou use a fila contínua.');
    if(typeof send!=='function')throw Error('Informe o transporte das relações.');
    const worker=resume&&run.typed_relation_worker?restore(run.typed_relation_worker,run):{schemaVersion:streaming?3:2,config:validateConfig(config),version,status:'running',calls:0,jobs:[],...(streaming?{input_closed:false}:{})};
    worker.status='running';if(streaming)worker.input_closed=false;
    run.typed_relation_worker=worker;
    const makeJob=event=>({event_id:event.event_id,chunk_id:event.chunk_id,thread_id:event.thread_id || null,status:'queued',candidate_ids:candidatesFor(run,event).map(e=>e.event_id),parts:[],results:[]});
    if(!streaming)worker.jobs=run.meeting_events.map(makeJob);
    let stopped=false,failure=null,closed=!streaming,wake=null,cursor=resume?worker.jobs.length:0;
    const signal=()=>{if(wake){const resolve=wake;wake=null;resolve();}};
    function enqueue(event) {
      if(!streaming)throw Error('Esta rodada usa uma fila de relações já fechada.');
      if(worker.jobs.some(job=>job.event_id===event.event_id))return false;
      if(stopped||worker.status!=='running')return false;
      if(closed)throw Error('A entrada da fila de relações já foi encerrada.');
      const index=worker.jobs.length,current=run.meeting_events[index],threadJob=run.thread_worker?.jobs[index];
      if(!current||current.event_id!==event.event_id)throw Error('A fila de relações deve seguir a ordem de meeting_events.');
      if(!threadJob||threadJob.event_id!==current.event_id||!['done','error','interrupted'].includes(threadJob.status))throw Error('Aguarde a atribuição de thread deste evento antes das relações.');
      worker.jobs.push(makeJob(current));signal();return true;
    }
    const rememberFailure=error=>{
      if(!failure)failure=error instanceof Error?error:Error(String(error || 'Falha interna nas relações.'));
      worker.error=failure.message || 'Falha interna nas relações.';
    };
    const update=async(job)=>{syncMemory(run);await onChange(run,{phase:'typed_relations',job});};
    const done=(async()=>{
      try{
        await update();
        while(!stopped){
          if(cursor>=worker.jobs.length){
            if(closed)break;
            await new Promise(resolve=>{wake=resolve;});continue;
          }
          const job=worker.jobs[cursor++];
          const event=run.meeting_events.find(e=>e.event_id===job.event_id),candidates=candidatesFor(run,event);
          if(!job.thread_id||!candidates.length){job.status='skipped';job.reason=!job.thread_id?'thread_pending':'no_candidates';await update(job);continue;}
          job.status='running';job.startedAt=new Date().toISOString();
          for(const stage of ['relation_type','configuration_match']){
            if(stopped)break;
            const subset=stage==='relation_type'?candidates:candidates.filter(c=>job.results.some(r=>r.target_event_id===c.event_id&&r.relation_type!=='none'));
            const parts=plan(run,event,subset,stage,worker.config,job.results,worker.schemaVersion);job.parts.push(...parts);await update(job);
            for(const part of parts){
              if(stopped)break;if(part.status==='error')continue;
              // Notify/persist the planned call before transport. A callback may
              // fail or request stop here: neither is an attempted model call.
              part.status='running';await update(job);
              if(stopped)break;
              const outgoing=E.clone(part.request);
              part.attempted=true;worker.calls++;
              try{
                const output=await send(outgoing,run.provider);
                E.validateOutput(output,{state:part.request.state,config:{model:part.request.model,questions:part.request.questions}});
                part.output=output;part.status='done';
              }catch(error){part.status='error';part.error=error?.message||'Falha nas relações.';if(error?.stopBatch)stopped=true;}
              await update(job);
            }
          }
          job.status=stopped?'interrupted':job.parts.some(p=>p.status==='error')?'error':'done';job.finishedAt=new Date().toISOString();await update(job);
        }
        if(streaming&&!stopped&&worker.jobs.length!==run.meeting_events.length)throw Error('A fila de relações foi encerrada antes de receber todos os eventos.');
        if(streaming&&!stopped&&(run.status==='running'||run.thread_worker?.status==='running'))throw Error('A fila de relações foi encerrada enquanto chunks ou threads ainda recebiam eventos.');
      }catch(error){
        rememberFailure(error);
      }finally{
        for(const job of worker.jobs){if(['queued','running'].includes(job.status))job.status='interrupted';for(const p of job.parts)if(['queued','running'].includes(p.status))p.status='interrupted';}
        worker.status=failure?'error':stopped?'stopped':worker.jobs.some(j=>j.status==='error')?'error':worker.jobs.some(j=>j.status==='interrupted')?'interrupted':'done';
        worker.finishedAt=new Date().toISOString();
        try{await update();}catch(error){rememberFailure(error);worker.status='error';syncMemory(run);}
      }
      if(failure)throw failure;
      return run;
    })();
    return {done,enqueue,stop(){stopped=true;signal();},close(){closed=true;if(streaming)worker.input_closed=true;signal();},get pending(){return worker.jobs.filter(job=>job.status==='queued').map(job=>job.event_id);}};
  }
  function audit(run,job) {
    const event=run.meeting_events.find(e=>e.event_id===job.event_id);
    const pairs=job.candidate_ids.map(id=>{
      const target=run.meeting_events.find(e=>e.event_id===id),part=job.parts.find(p=>p.stage==='relation_type'&&p.candidate_ids.includes(id)),matchPart=job.parts.find(p=>p.stage==='configuration_match'&&p.candidate_ids.includes(id));
      const expectedMap=run.batch.expected_typed_relations;
      const targetMap=expectedMap&&Object.hasOwn(expectedMap,event.chunk_id)?expectedMap[event.chunk_id]:null;
      const result=job.results.find(r=>r.target_event_id===id)||null,expected=targetMap&&Object.hasOwn(targetMap,target.chunk_id)?targetMap[target.chunk_id]:null;
      const checks=expected?Object.entries(expected).map(([key,value])=>({key,expected:value,actual:result?.[key]??null,matches:result?result[key]===value:null})):[];
      const matched=!expected||!result?null:checks.every(c=>c.matches);
      const error=part?.error||matchPart?.error||null;
      return {target,part,matchPart,result,expected,checks,matches:matched,error,tone:error?'error':matched===false?'fail':result?.review_state==='needs_review'?'warning':matched===true?'pass':null};
    });
    return {event,job,pairs,matches:pairs.some(p=>p.matches===false)?false:pairs.some(p=>p.matches===true)?true:null,tone:pairs.some(p=>p.tone==='fail')?'fail':pairs.some(p=>p.tone==='warning')?'warning':null};
  }
  function summary(run) {
    const audits=(run.typed_relation_worker?.jobs||[]).map(job=>audit(run,job)),pairs=audits.flatMap(entry=>entry.pairs);
    const bySource=new Map(audits.map(entry=>[entry.event.chunk_id,new Map(entry.pairs.map(pair=>[pair.target.chunk_id,pair]))]));
    const expected=[];
    for(const [source,targets]of Object.entries(run.batch.expected_typed_relations||{}))for(const [target,label]of Object.entries(targets)){
      const pair=bySource.get(source)?.get(target);
      expected.push({source,target,expected:label,actual:pair?.result||null,matches:pair?.matches??null});
    }
    return {calls:run.typed_relation_worker?.calls||0,pairs:pairs.length,classified:pairs.filter(p=>p.result).length,edges:run.meeting_relations?.length||0,
      expected_pairs:expected.length,correct:expected.filter(p=>p.matches===true).length,divergent:expected.filter(p=>p.matches===false).length,not_processed:expected.filter(p=>p.matches===null).length,
      review:pairs.filter(p=>p.result?.review_state==='needs_review').length,errors:pairs.filter(p=>p.error).length,expectations:expected};
  }
  function lifecycle(run) {
    const states=Object.fromEntries((run.meeting_events||[]).map(e=>[e.event_id,{event_id:e.event_id,status:['hypothesis','test_proposal'].includes(e.type)?'open':'active',evidence_state:'unassessed',relation_ids:[],review_required:!e.thread_id,reasons:!e.thread_id?['Evento sem thread atribuída.']:[]} ]));
    const events=new Map((run.meeting_events||[]).map(e=>[e.event_id,e]));
    const edges=run.meeting_relations||[],retired=new Set();
    const confirmedEdge=edge=>edge.review_state==='confirmed'&&edge.relation_probability+1e-12>=threshold&&edge.match_probability+1e-12>=threshold;
    const validReplacement=edge=>confirmedEdge(edge)&&edge.relation_type==='supersedes'&&(edge.configuration_applicable===false||['exact','partial','mismatch'].includes(edge.configuration_match));
    // Resolve explicit revisions before using evidence. A withdrawn result must
    // not continue closing a test or supporting a hypothesis. No new semantic
    // edge is inferred through the correction.
    // Supersession is a historical transition. Replacing a replacement must not
    // silently revive an older plan or withdrawn result (A <- B <- C).
    for(const edge of edges)if(validReplacement(edge))retired.add(edge.target_event_id);
    for(const id of retired)if(states[id])states[id].status='superseded';
    for(const edge of edges){
      const source=events.get(edge.source_event_id),target=events.get(edge.target_event_id),state=states[edge.target_event_id];if(!source||!target||!state)continue;
      state.relation_ids.push(edge.relation_id);
      const confirmed=confirmedEdge(edge);
      if(retired.has(edge.source_event_id)){
        state.review_required=true;state.reasons.push('A fonte desta relação foi substituída; ela não sustenta conclusão ou evidência vigente.');continue;
      }
      if(!confirmed){state.review_required=true;state.reasons.push('Relação com classificação ou comparação ainda não confirmada.');continue;}
      if(edge.relation_type==='result_of'&&source.type==='test_result'&&target.type==='test_proposal'){
        if(edge.configuration_match==='exact'){if(state.status!=='superseded')state.status='completed';state.reasons.push('Resultado direto com configuração correspondente.');}
        else {state.review_required=true;state.reasons.push('Esta aresta não comprova execução na configuração solicitada.');}
      }
      if(edge.relation_type==='supersedes'){
        if(edge.configuration_applicable===false||['exact','partial','mismatch'].includes(edge.configuration_match)){state.status='superseded';state.reasons.push('Substituição explícita; alterações de configuração permanecem registradas.');}
        else{state.review_required=true;state.reasons.push('Substituição com identidade ambígua requer revisão.');}
      }
      if(['supports','contradicts'].includes(edge.relation_type)){
        if(edge.configuration_applicable&&edge.configuration_match!=='exact'){state.review_required=true;state.reasons.push('Evidência com configuração não equivalente requer revisão.');continue;}
        const next=edge.relation_type==='supports'?'supported':'challenged';state.evidence_state=state.evidence_state==='unassessed'?next:state.evidence_state===next?next:'mixed';
        if(state.evidence_state==='mixed'){state.review_required=true;state.reasons.push('Há evidências em sentidos diferentes; não há conclusão automática.');}
      }
    }
    return states;
  }
  function restore(saved,run) {
    if(!saved||![1,2,3].includes(saved.schemaVersion)||!Array.isArray(saved.jobs)||!['running','done','stopped','error','interrupted'].includes(saved.status))throw Error('Snapshot de relações tipadas inválido.');
    if(saved.error!==undefined&&(typeof saved.error!=='string'||!saved.error.trim()))throw Error('Erro do worker de relações inválido.');
    const config=validateConfig(saved.config),events=run.meeting_events;
    if(saved.schemaVersion===3){
      if(typeof saved.input_closed!=='boolean'||saved.jobs.length>events.length||saved.status==='done'&&(!saved.input_closed||saved.jobs.length!==events.length))throw Error('Fila contínua de relações incompatível com eventos.');
    }else if(saved.jobs.length!==events.length)throw Error('Fila de relações incompatível com eventos.');
    let calls=0;
    const jobs=saved.jobs.map((original,index)=>{
      const job=E.clone(original),event=events[index],candidates=candidatesFor(run,event);
      if(saved.schemaVersion===3){const threadJob=run.thread_worker?.jobs[index];if(!threadJob||threadJob.event_id!==event.event_id||!['done','error','interrupted'].includes(threadJob.status))throw Error('Relação anterior à atribuição de thread.');}
      if(job.event_id!==event.event_id||job.chunk_id!==event.chunk_id||job.thread_id!==(event.thread_id||null)||!same(job.candidate_ids,candidates.map(e=>e.event_id))||!Array.isArray(job.parts))throw Error('Candidatos de relação inválidos.');
      if(!['queued','running','done','skipped','error','interrupted'].includes(job.status))throw Error('Status de relação inválido.');
      const checked=[];let matchSeen=false;
      for(const part of job.parts){
        if(!['relation_type','configuration_match'].includes(part.stage)||!Array.isArray(part.candidate_ids)||!part.candidate_ids.length||!['queued','running','done','error','interrupted'].includes(part.status))throw Error('Chamada de relação inválida.');
        if(part.stage==='configuration_match')matchSeen=true;else if(matchSeen)throw Error('Ordem das etapas inválida.');
        const subset=part.candidate_ids.map(id=>candidates.find(c=>c.event_id===id));
        if(subset.some(e=>!e)||new Set(part.candidate_ids).size!==subset.length||checked.some(p=>p.stage===part.stage&&p.candidate_ids.some(id=>part.candidate_ids.includes(id))))throw Error('Par repetido ou fora da thread.');
        const previous=resultsFor({...job,parts:checked});
        if(part.stage==='configuration_match'&&subset.some(c=>!previous.some(r=>r.target_event_id===c.event_id&&r.relation_type!=='none')))throw Error('Comparação sem relação positiva.');
        let planned;try{planned=request(run,event,subset,part.stage,config,previous,saved.schemaVersion);}catch(error){if(part.request||part.attempted||part.status!=='error')throw error;}
        if(part.request&&!same(part.request,planned)||!part.request&&(planned||part.status!=='error'))throw Error('Request de relação adulterado.');
        if(part.attempted!==undefined&&typeof part.attempted!=='boolean')throw Error('Marcador de tentativa de relação inválido.');
        if(part.attempted)calls++;
        if(part.output){if(!part.attempted||part.status!=='done')throw Error('Resposta sem chamada concluída.');E.validateOutput(part.output,{state:planned.state,config:planned});}
        else if(part.status==='done')throw Error('Resposta de relação ausente.');
        if(['queued','running'].includes(part.status))part.status='interrupted';checked.push(part);
      }
      job.parts=checked;job.results=resultsFor(job);
      if(['queued','running'].includes(job.status))job.status='interrupted';
      if(job.status==='done'&&(!candidates.length||job.parts.some(p=>p.status!=='done')||job.results.length!==candidates.length||job.results.some(r=>r.relation_type!=='none'&&r.configuration_match===null)))throw Error('Relações concluídas incompletas.');
      if(job.status==='skipped'&&(candidates.length||job.parts.length||job.reason!==(event.thread_id?'no_candidates':'thread_pending')))throw Error('Relações ignoradas indevidamente.');
      return job;
    });
    if(saved.status==='done'&&(saved.error||jobs.some(job=>!['done','skipped'].includes(job.status))))throw Error('Worker de relações concluído contém trabalho incompleto ou erro.');
    if(saved.calls!==calls)throw Error('Contagem de chamadas de relação inválida.');
    return {schemaVersion:saved.schemaVersion,config,version:saved.version||null,status:saved.status==='running'?'interrupted':saved.status,calls,jobs,...(saved.schemaVersion===3?{input_closed:saved.input_closed}:{}),...(saved.error?{error:saved.error}:{}),...(saved.finishedAt?{finishedAt:saved.finishedAt}:{})};
  }
  const api={defaults:E.clone(defaults),types,matches,threshold,validateConfig,validateExpected,candidatesFor,request,plan,start,resultsFor,syncMemory,audit,summary,lifecycle,restore};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NorteTypedRelations=api;
})(typeof globalThis!=='undefined'?globalThis:this);
