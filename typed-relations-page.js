/* Presentation only: all relation decisions come from NorteTypedRelations snapshots. */
(() => {
  const $=id=>document.getElementById(id),openGroups=new Map();
  const n=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
  const pc=value=>value==null?'—':(100*value).toFixed(1)+'%';
  const lifecycleName={active:'ativo',open:'pendente',completed:'concluído',superseded:'substituído'};
  const statusNames={queued:'Na fila',running:'Consultando…',done:'Concluído',error:'Erro',interrupted:'Interrompido',skipped:'Sem pares'};
  function disclosure(key,label,count,initial=false) {
    const d=n('details','mf-relation-group'),summary=n('summary');d.dataset.typedGroup=key;d.open=openGroups.get(key)??initial;
    summary.append(n('strong','',label),n('span','mf-group-count',String(count)));d.append(summary);
    d.addEventListener('toggle',()=>{if(d.isConnected)openGroups.set(key,d.open);});return d;
  }
  function pairsFor(run) {
    return (run?.typed_relation_worker?.jobs||[]).flatMap(job=>{
      const audit=window.NorteTypedRelations.audit(run,job);
      return audit.pairs.map(pair=>({...pair,job,source:audit.event,target:pair.target||run.meeting_events.find(e=>e.event_id===pair.result?.target_event_id)}));
    });
  }
  const pairKey=pair=>pair.job.event_id+'→'+pair.target?.event_id;
  function pairButton(pair,selection,onSelect,edge=false) {
    const result=pair.result,button=n('button','mf-queue-item mf-typed-pair');button.type='button';button.dataset.typedPair=pairKey(pair);button.dataset.tone=pair.tone||'';
    button.classList.toggle('is-selected',selection?.eventId===pair.job.event_id&&selection?.targetId===pair.target?.event_id);
    button.append(n('span','mf-queue-id',pairKey(pair)),n('span','mf-queue-text',result?.relation_type||statusNames[pair.job.status]||pair.job.status));
    const match=result?.configuration_match,applicable=match&&match!=='not_applicable';
    button.append(n('span','mf-stream-meta',applicable?'match: '+match:result?.relation_type==='none'?'Nenhuma aresta':match==='not_applicable'?'Configuração: não aplicável':result?.relation_type?'Configuração: não determinada':''));
    if(result?.review_state==='needs_review'){const badge=n('span','mf-typed-status','Revisão necessária');badge.dataset.tone='warning';button.append(badge);}
    if(pair.matches===false){const badge=n('span','mf-typed-status','Divergência do gabarito');badge.dataset.tone='fail';button.append(badge);}
    if(pair.error||result?.error)button.append(n('span','mf-typed-status',pair.error||result.error));
    button.title=(pair.source?.text||'')+'\n→ '+(pair.target?.text||'');
    button.addEventListener('click',()=>onSelect(pair.job.event_id,pair.target?.event_id));return button;
  }
  function fillPairs(list,pairs,selection,onSelect,empty) {
    const scroll=list.scrollTop;list.replaceChildren();
    const threads=[...new Set(pairs.map(p=>p.job.thread_id))];
    for(const thread of threads) {
      const threadPairs=pairs.filter(p=>p.job.thread_id===thread),d=disclosure(list.id+':'+thread,thread,threadPairs.length,true),children=n('ol','mf-relation-children');
      for(const id of [...new Set(threadPairs.map(p=>p.job.event_id))]) {
        const sourcePairs=threadPairs.filter(p=>p.job.event_id===id),source=disclosure(list.id+':'+thread+':'+id,id,sourcePairs.length,selection?.eventId===id),rows=n('ol','mf-relation-children');
        source.append(n('p','mf-thread-title',sourcePairs[0].source?.text||''));
        for(const pair of sourcePairs){const li=n('li');li.append(pairButton(pair,selection,onSelect));rows.append(li);}
        source.append(rows);const li=n('li');li.append(source);children.append(li);
      }
      d.append(children);const li=n('li');li.append(d);list.append(li);
    }
    if(!pairs.length)list.append(n('li','mf-empty-queue',empty));list.scrollTop=scroll;
  }
  function render({run,selection,onSelect}) {
    const worker=run?.typed_relation_worker,pairs=pairsFor(run),jobs=worker?.jobs||[],selected=pairs.find(p=>p.job.event_id===selection?.eventId&&p.target?.event_id===selection?.targetId);
    const edges=pairs.filter(p=>p.result?.relation_type&&p.result.relation_type!=='none'),audit=pairs.filter(p=>!p.result||p.result.relation_type==='none');
    for(const el of document.querySelectorAll('.mf-typed-node'))el.hidden=false;
    $('mfRelationsPanel').hidden=false;$('mfNodeMeetingRelations').style.gridColumn='5';
    $('mfTypedProgress').textContent=worker?`${statusNames[worker.status]||worker.status} · ${pairs.length} pares · ${edges.length} arestas · ${worker.calls} chamadas`:'Depois das threads · origem mais recente → alvo anterior · sem pares entre threads';
    fillPairs($('mfTypedPairs'),pairs,selection,onSelect,worker?'Nenhum par elegível. Eventos sem thread não são comparados.':'Aguardando atribuição das threads.');
    fillPairs($('mfMeetingRelations'),edges,selection,onSelect,worker?'Nenhuma relação direta encontrada.':'Aguardando a etapa de relações.');
    fillPairs($('mfMemoryRelations'),edges,selection,onSelect,worker?'Nenhuma relação direta encontrada.':'Aguardando a etapa de relações.');
    fillPairs($('mfTypedAudit'),audit,selection,onSelect,'Nenhum par sem aresta.');
    $('mfTypedPairsCount').textContent=pairs.length;$('mfMeetingRelationsCount').textContent=edges.length;$('mfMemoryRelationsCount').textContent=edges.length;$('mfTypedAuditCount').textContent=audit.length;
    const skipped=jobs.filter(j=>j.reason==='thread_pending');
    if(skipped.length)$('mfTypedAudit').append(n('li','mf-empty-queue',skipped.length+' evento(s) sem thread: não comparados.'));
    $('mfTypedTypeValue').textContent=selected?.result?`${pairKey(selected)}\n${selected.result.relation_type} · ${pc(selected.result.relation_probability)}`:'Uma relação direta por par. none não cria aresta; compartilhar thread é insuficiente.';
    $('mfTypedMatchValue').textContent=selected?.result?.relation_type==='none'?'Ignorado: relation_type = none':selected?.result?.configuration_match?`${selected.result.configuration_match} · ${pc(selected.result.match_probability)}\nMismatch permanece registrado na aresta.`:'Relação ≠ none: comparar configuração. not_applicable mantém a aresta sem comparação.';
    const tones={};if(selected){tones.typed_candidates=selected.tone;tones.typed_type=selected.tone;if(selected.result?.relation_type==='none')tones.typed_none=selected.tone;else if(selected.result){tones.typed_match=selected.tone;tones.typed_save=selected.tone;}}
    $('mfScene').dataset.typedEdgeTones=JSON.stringify(tones);
    return pairs;
  }
  function inspect({run,panel,eventId,targetId,jsonBlock}) {
    const job=run?.typed_relation_worker?.jobs.find(j=>j.event_id===eventId);if(!job)return;
    const lifecycle=window.NorteTypedRelations.lifecycle(run);
    const section=n('section','mf-relation-results mf-typed-details');section.id='mfTypedDetails';
    section.append(n('h3','',`Relações · ${eventId} · ${job.thread_id||'thread pendente'}`));
    section.append(n('p','mf-typed-note','Origem mais recente → evento anterior da mesma thread. Relações, match e confiança são auditados separadamente. Nenhuma resposta é substituída pelo gabarito.'));
    section.append(n('p','mf-typed-note',run.typed_relation_worker.schemaVersion>=2?'Arquitetura 2: o tipo usa contexto da thread; match compara um único par, sem histórico nem outros candidatos. Parâmetros ausentes não são preenchidos com outros relatos.':'Arquitetura 1: snapshot anterior à comparação isolada de configuração. Consulte os requests originais abaixo para verificar o contexto recebido.'));
    const pairs=pairsFor(run).filter(pair=>pair.job===job||pair.job.event_id===eventId);
    const missing=window.NorteTypedRelations.summary(run).expectations.filter(expectation=>expectation.source===job.chunk_id&&!pairs.some(pair=>pair.target?.chunk_id===expectation.target));
    for(const expectation of missing)section.append(n('p','mf-execution-error',`Gabarito não processado: ${expectation.source} → ${expectation.target}. O par não foi comparado nesta execução; confira a retenção e a atribuição das threads.`));
    if(!pairs.length)section.append(n('p','',job.reason==='thread_pending'?'Sem atribuição de thread: relações não processadas.':'Nenhum evento anterior elegível na mesma thread.'));
    for(const pair of pairs) {
      const result=pair.result,row=disclosure('inspect:'+run.createdAt+':'+pairKey(pair),pairKey(pair),result?.relation_type||statusNames[job.status],pair.target?.event_id===targetId);row.dataset.typedTarget=pair.target?.event_id;
      row.append(n('p','mf-inspector-text',pair.target?.text||''));
      const targetState=lifecycle[pair.target?.event_id];
      if(targetState)row.append(n('p','mf-typed-note','Acompanhamento de '+pair.target.event_id+': '+(lifecycleName[targetState.status]||targetState.status)+(targetState.review_required?' · requer revisão':'')+'.'));
      const comparisons=n('div','mf-typed-comparison');
      comparisons.append(n('span','','Esperado: '+(pair.expected?JSON.stringify(pair.expected):'Sem gabarito')),n('span','','Obtido: '+(result?.relation_type||'Sem resposta')+' · match '+(result?.configuration_match??'—')));row.append(comparisons);
      const status=n('p','mf-typed-status',pair.matches===false?'Divergência do gabarito':pair.matches===true?'Classificação igual ao gabarito':'Sem avaliação por gabarito');status.dataset.tone=pair.tone||'';row.append(status);
      if(result)row.append(n('p','',`Confiança · relação ${pc(result.relation_probability)} · match ${pc(result.match_probability)} · ${result.review_state==='needs_review'?'revisão necessária':'confirmada'}`));
      if(result?.relation_type==='none')row.append(n('p','mf-typed-note','relation_type = none: nenhuma meeting_relation criada; configuration_match ignorado.'));
      else if(result?.configuration_match==='mismatch')row.append(n('p','mf-typed-note','A divergência de configuração está preservada na aresta. Ela não comprova que o teste anterior foi concluído na configuração solicitada.'));
      else if(result?.configuration_match==='not_applicable')row.append(n('p','mf-typed-note','Relação válida; comparação de configuração não se aplica.'));
      for(const part of [pair.part,pair.matchPart].filter(Boolean)) {
        const raw=n('details','mf-answer-raw');raw.append(n('summary','',`${part.stage} · ${part.attempted?'request enviado e resposta original':'request preparado'} · ${part.status}`),jsonBlock(part));row.append(raw);
        if(part.error)row.append(n('p','mf-execution-error',part.error));
      }
      if(result?.error)row.append(n('p','mf-execution-error',result.error));
      const raw=n('details','mf-answer-raw');raw.append(n('summary','','Resultado, gabarito e verificações'),jsonBlock({result,expected:pair.expected,checks:pair.checks}));row.append(raw);section.append(row);
    }
    if(job.error)section.append(n('p','mf-execution-error',job.error));
    const raw=n('details','mf-answer-raw');raw.append(n('summary','','Job completo · state, questões e respostas'),jsonBlock(job));section.append(raw);panel.append(section);
  }
  function stats(run) {
    const pairs=pairsFor(run),summary=window.NorteTypedRelations.summary(run);return{pairs:pairs.length,right:summary.correct,wrong:summary.divergent,missing:summary.not_processed,unscored:pairs.filter(p=>!p.expected).length,review:pairs.filter(p=>p.result?.review_state==='needs_review').length,errors:pairs.filter(p=>p.tone==='error').length};
  }
  window.NorteTypedRelationsPage={render,inspect,stats};
})();
