/* Local, source-grounded minutes and review comments. No remote inference or telemetry. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorteMinutes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const VERSION = 1, KEY = 'norte.memory-v2.minutes-feedback.v1.';
  const TYPE = {observation:'Observação',hypothesis:'Hipótese',test_proposal:'Teste proposto',test_result:'Resultado relatado',decision:'Decisão relatada',requirement:'Requisito',other:'Outro registro'};
  const MATCH = {exact:'configuração compatível',partial:'configuração parcialmente descrita',mismatch:'configurações diferentes',ambiguous:'configuração ambígua',not_applicable:'comparação de configuração não se aplica'};
  const REL = {tests:'investiga',results_in:'produz resultado',result_of:'resultado de',repeats:'repete',supports:'dá suporte a',contradicts:'contradiz',supersedes:'substitui',clarifies:'esclarece',addresses:'aborda',implements:'implementa',constrains:'restringe',explains:'explica',resolves:'resolve',depends_on:'depende de',affects:'afeta',based_on:'baseia-se em',related_to:'relação direta contextual',proposes_test_for:'propõe teste para',test_result_of:'resultado de teste',retest_of:'repetição de teste',updates:'atualiza'};
  const copy = value => JSON.parse(JSON.stringify(value));
  function stable(value) {
    if (Array.isArray(value)) return '['+value.map(stable).join(',')+']';
    if (value && typeof value === 'object') return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  // A deterministic content identity, not a security hash or a signature.
  function fingerprint(value) {
    const s=stable(value);let a=2166136261,b=2246822519;
    for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),3266489917);}
    return 'mn1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function relationSource(r) {return r.source_event_id || r.source_id || r.event_id;}
  function relationTarget(r) {return r.target_event_id || r.target_id;}
  function eventProjection(e) {return {event_id:e.event_id,chunk_id:e.chunk_id,thread_id:e.thread_id || null,type:e.type,text:String(e.text || ''),status:e.status || null};}
  function lifecycleFor(run) {
    if (root.NorteTypedRelations?.lifecycle) return root.NorteTypedRelations.lifecycle(run);
    if (typeof require === 'function') { try { return require('./typed-relations.js').lifecycle(run); } catch (_) { /* Lifecycle unavailable: keep pending. */ } }
    return null;
  }
  function buildDocument(run, lifecycle = lifecycleFor(run)) {
    if (!run || !Array.isArray(run.meeting_events)) throw Error('Não há uma memória disponível para gerar a ata.');
    const events=run.meeting_events.map(eventProjection), eventMap=new Map(events.map(e=>[e.event_id,e]));
    if(new Set(events.map(e=>e.event_id)).size!==events.length)throw Error('A memória contém identificadores de evento duplicados.');
    const relations=(run.meeting_relations || []).filter(r=>r.relation_type && r.relation_type!=='none').map(copy);
    const worker=run.typed_relation_worker;
    const outputs=[...(run.records || []).flatMap(record=>[record.storeOutput,record.typeOutput]),...(run.thread_worker?.jobs || []).flatMap(job=>(job.parts || []).map(part=>part.output)),...(worker?.jobs || []).flatMap(job=>(job.parts || []).map(part=>part.output))];
    const modelIds=[...new Set(outputs.map(output=>output?.response?.model).filter(model=>typeof model==='string'&&model))].sort();
    const source={provider:run.provider || null,model_ids:modelIds,chunk_questions:run.questions?copy(run.questions):null,chunk_question_version:run.questionVersion || null,thread_config:run.thread_worker?.config?copy(run.thread_worker.config):null,thread_question_version:run.thread_worker?.version || null,run_id:run.id || run.run_id || null,batch_id:run.batch?.batch_id || run.batch_id || null,created_at:run.createdAt || null,events,relations,run_status:run.status || null,relation_status:worker?.status || null,relation_schema_version:worker?.schemaVersion || null,question_version:worker?.version || worker?.config?.questionVersion || worker?.questionVersion || null,relation_config:worker?.config?copy(worker.config):null,classification_audit:(worker?.jobs || []).map(job=>({event_id:job.event_id,chunk_id:job.chunk_id,thread_id:job.thread_id,status:job.status,reason:job.reason || null,results:copy(job.results || [])}))};
    const id=fingerprint(source), blocks=[], threads=[];
    const add=(block)=>{blocks.push(block);return block;};
    const common=(id,text,kind,eventIds=[],relationIds=[])=>({id,text,kind,event_ids:eventIds,relation_ids:relationIds});
    add(common('scope','Ata de revisão produzida a partir dos eventos retidos e das relações classificadas. As falas abaixo são transcrições do input; decisões relatadas não comprovam consenso nem aprovação. Participantes e data da reunião não foram informados.','scope'));
    if(run.status!=='done')add(common('warning:incomplete','Execução incompleta: esta ata representa somente os dados disponíveis.','warning'));
    if(!worker || worker.status!=='done')add(common('warning:relations','Classificação de relações incompleta ou ausente. Ausência de aresta não significa ausência de relação ou resolução de uma pendência.','warning'));
    // Conservative fallback: a proposed test remains pending unless the relation
    // lifecycle, backed by a qualifying result edge, explicitly updates it.
    const lifecycleEvents=Array.isArray(lifecycle?.events)?lifecycle.events:Object.values(lifecycle?.events || lifecycle || {});
    const stateMap=new Map(lifecycleEvents.map(s=>[s.event_id,s]));
    const sourceThreads=run.meeting_threads || [];
    const threadOrder=[...new Set([...sourceThreads.map(t=>t.thread_id),...events.map(e=>e.thread_id)].filter(Boolean))];
    if(events.some(e=>!e.thread_id))threadOrder.push(null);
    for(const threadId of threadOrder){
      const group=events.filter(e=>e.thread_id===threadId);if(!group.length)continue;
      const sourceTitle=sourceThreads.find(t=>t.thread_id===threadId)?.title;
      const thread={id:threadId,title:threadId?(typeof sourceTitle==='string'&&sourceTitle.trim()?sourceTitle:'Discussão '+threadId):'Pontos sem assunto definido',blocks:[],relations:[]};threads.push(thread);
      const sections=[
        ['discussion','Tópicos de discussão e observações'],
        ['hypotheses','Hipóteses em investigação'],
        ['decisions','Decisões registradas'],
        ['requirements','Requisitos e critérios'],
        ['tested','Testes realizados e resultados'],
        ['followups','Follow-ups e pendências'],
        ['history','Histórico de registros substituídos'],
        ['other','Outros registros']
      ].map(([id,title])=>({id,title,blocks:[]}));
      thread.sections=sections;
      for(const e of group){
          const state=stateMap.get(e.event_id);
          const b=common('event:'+e.event_id,e.text,'event',[e.event_id]);
          Object.assign(b,{thread_id:threadId,type:e.type,label:(TYPE[e.type]||e.type)+' · '+e.event_id+' · '+(e.chunk_id || 'sem chunk'),lifecycle:state?copy(state):null});
          const completed=['completed','closed','result_reported','resolved'].includes(state?.status);
          const sectionId=state?.status==='superseded'?'history':
            e.type==='test_proposal'?(completed?'tested':'followups'):
            ({observation:'discussion',hypothesis:'hypotheses',decision:'decisions',requirement:'requirements',test_result:'tested'}[e.type] || 'other');
          b.section_id=sectionId;
          const details=[];
          if(e.type==='hypothesis'||e.type==='test_proposal'||state?.status==='superseded')details.push(stateText(state?.status || (e.type==='test_proposal'?'pending':'open'),e.type));
          const evidence={supported:'Evidência de suporte; hipótese não comprovada',challenged:'Evidência contrária; hipótese requer revisão',mixed:'Evidências conflitantes; revisão necessária'}[state?.evidence_state];
          if(evidence)details.push(evidence);
          if(state?.review_required)details.push('Revisão necessária');
          if(state?.reasons?.length)details.push(...state.reasons);
          b.detail=[...new Set(details)].join(' · ');
          thread.blocks.push(add(b));
          sections.find(section=>section.id===sectionId).blocks.push(b);
      }
      thread.sections=sections.filter(section=>section.blocks.length);
      for(let i=0;i<relations.length;i++){
        const r=relations[i],from=eventMap.get(relationSource(r)),to=eventMap.get(relationTarget(r));
        if(!from || !to || from.thread_id!==threadId)continue;
        const rid=r.relation_id || r.id || 'R'+String(i+1).padStart(3,'0');
        const status=r.configuration_match?'; '+(MATCH[r.configuration_match]||r.configuration_match):'';
        const text=from.event_id+' → '+to.event_id+': '+(REL[r.relation_type]||r.relation_type)+status+(r.review_state==='needs_review'?'; revisão necessária':'')+'.';
        thread.relations.push(add({...common('relation:'+rid,text,'relation',[from.event_id,to.event_id],[rid]),thread_id:threadId,relation:copy(r)}));
      }
    }
    const pending=[];
    for(const event of events){
      const state=stateMap.get(event.event_id);
      if(event.type==='test_proposal'){
        const status=state?.status || 'pending';
        pending.push(add({...common('followup:'+event.event_id,event.event_id+': '+stateText(status,event.type)+(state?.reasons?.length?' — '+state.reasons.join('; '):''),'followup',[event.event_id],state?.relation_ids || state?.evidence_relation_ids || []),status,lifecycle:state?copy(state):null}));
      } else if(event.type==='hypothesis'){
        const status=state?.status || 'open';
        pending.push(add({...common('followup:'+event.event_id,event.event_id+': '+stateText(status,event.type)+(state?.reasons?.length?' — '+state.reasons.join('; '):''),'followup',[event.event_id],state?.relation_ids || state?.evidence_relation_ids || []),status,lifecycle:state?copy(state):null}));
      }
      if(state?.review_required || ['supported','challenged','mixed'].includes(state?.evidence_state)){
        const evidence={supported:'evidência de suporte',challenged:'evidência contrária',mixed:'evidências conflitantes'}[state.evidence_state];
        pending.push(add({...common('evidence:'+event.event_id,event.event_id+': '+(evidence || 'revisão necessária')+(state.reasons?.length?' — '+state.reasons.join('; '):'')+'. Não implica validação definitiva.','warning',[event.event_id],state.relation_ids||[]),lifecycle:copy(state)}));
      }
      if(!event.thread_id)pending.push(add(common('unassigned:'+event.event_id,event.event_id+': tema ainda sem atribuição.','warning',[event.event_id])));
    }
    const warnings=[];
    for(const job of worker?.jobs || []){
      if(['error','interrupted','queued','running'].includes(job.status)){
        const failed=(job.parts || []).filter(p=>p.error).map(p=>p.error);
        warnings.push(add(common('job-review:'+job.event_id,job.event_id+': classificação de relações '+({error:'com erro',interrupted:'interrompida',queued:'ainda na fila',running:'em andamento'}[job.status])+'. Os pares sem resposta não foram considerados relações ausentes.'+(failed.length?' '+[...new Set(failed)].join('; '):''),'warning',[job.event_id])));
      }
      for(const r of job.results || [])if(r.relation_type==='none'&&r.review_state==='needs_review'){
        warnings.push(add(common('negative-review:'+job.event_id+':'+r.target_event_id,job.event_id+' → '+r.target_event_id+': o modelo escolheu none com confiança insuficiente. Não foi criada uma relação; essa ausência precisa de revisão.','warning',[job.event_id,r.target_event_id])));
      }
    }
    for(const [i,item] of (Array.isArray(lifecycle?.warnings)?lifecycle.warnings:[]).entries()){
      const text=typeof item==='string'?item:item.message || item.reason || stable(item);
      warnings.push(add(common('review:'+i,text,'warning',item.event_ids||[],item.relation_ids||[])));
    }
    for(const [i,r] of relations.entries()){
      if(r.review_state==='needs_review'||r.configuration_match==='mismatch'||r.configuration_match==='ambiguous'){
        const rid=r.relation_id || r.id || 'R'+String(i+1).padStart(3,'0');
        warnings.push(add(common('match-review:'+rid,rid+': '+(MATCH[r.configuration_match]||'vínculo com confiança insuficiente')+'. Este vínculo exige revisão antes de concluir equivalência de testes/configurações.','warning',[relationSource(r),relationTarget(r)].filter(Boolean),[rid])));
      }
    }
    return {schema_version:VERSION,presentation:'thread_sections',id,title:'Ata de reunião',batch_id:source.batch_id,source,blocks,threads,pending,warnings,lifecycle:lifecycle?copy(lifecycle):null,metrics:{events:events.length,threads:threads.filter(t=>t.id).length,relations:relations.length}};
  }
  function stateText(status,type){
    const labels={active:'registrado; sem conclusão de validação',pending:'sem resultado compatível associado',open:type==='hypothesis'?'hipótese em aberto':'em aberto',closed:'resultado compatível associado; aprovação não inferida',completed:'resultado compatível associado; aprovação não inferida',reported:'resultado relatado',result_reported:'resultado compatível associado; aprovação não inferida',superseded:'substituído por registro posterior',supported:'há evidência de suporte; não equivale a comprovação',contradicted:'há evidência contrária; revisar hipótese',conflicted:'evidências conflitantes; revisão necessária',review_required:'revisão necessária',resolved:'resolução indicada pelas relações; revisar evidências'};
    return labels[status] || status;
  }
  function makeAnchor(doc,blockId,start=0,end){
    const block=doc.blocks.find(b=>b.id===blockId);if(!block)throw Error('Trecho não encontrado nesta ata.');
    const stop=end===undefined?block.text.length:end;
    if(!Number.isInteger(start)||!Number.isInteger(stop)||start<0||stop<=start||stop>block.text.length)throw Error('Seleção inválida.');
    return {block_id:block.id,start,end:stop,offset_unit:'utf16',quote:block.text.slice(start,stop),block_text:block.text,event_ids:[...block.event_ids],relation_ids:[...block.relation_ids]};
  }
  function validateComment(doc,comment){
    if(!comment || typeof comment.id!=='string' || !comment.id || comment.id.length>120 || comment.schema_version!==VERSION || typeof comment.author!=='string' || comment.author.length>120 || !['note','question','correction'].includes(comment.category) || !Number.isFinite(Date.parse(comment.created_at)) || !Number.isFinite(Date.parse(comment.updated_at)) || (comment.status==='resolved'&&!Number.isFinite(Date.parse(comment.resolved_at))) || comment.run_fingerprint!==doc.id || typeof comment.text!=='string' || !comment.text.trim() || comment.text.length>10000 || !['open','resolved'].includes(comment.status))return false;
    try{const a=makeAnchor(doc,comment.anchor?.block_id,comment.anchor?.start,comment.anchor?.end);return stable(a)===stable(comment.anchor);}catch(_){return false;}
  }
  function createComment(doc,anchor,text,{author='',category='note',now=new Date().toISOString(),id}={}){
    const content=String(text||'').trim();if(!content||content.length>10000)throw Error('Escreva um comentário de até 10.000 caracteres.');
    if(!['note','question','correction'].includes(category))throw Error('Categoria de comentário inválida.');
    const result={schema_version:VERSION,id:id || root.crypto?.randomUUID?.() || 'feedback-'+Date.now()+'-'+Math.random().toString(16).slice(2),run_fingerprint:doc.id,anchor:copy(anchor),text:content,author:String(author).trim().slice(0,120),category,status:'open',created_at:now,updated_at:now,resolved_at:null};
    if(!validateComment(doc,result))throw Error('O comentário não corresponde à fonte desta ata.');
    return result;
  }
  function exportFeedback(doc,comments,now=new Date().toISOString()){
    const valid=comments.filter(c=>validateComment(doc,c));
    return {schema_version:VERSION,exported_at:now,run_fingerprint:doc.id,provenance:{source:'user_review_of_meeting_minutes',storage:'browser_local_only',offset_unit:'utf16',automatic_training:false,ai_outputs_unchanged:true,feedback_is_verified_ground_truth:false},source_snapshot:copy(doc.source),document_structure:{presentation:doc.presentation,threads:doc.threads.map(thread=>({thread_id:thread.id,title:thread.title,block_ids:thread.blocks.map(block=>block.id),sections:thread.sections.map(section=>({id:section.id,title:section.title,block_ids:section.blocks.map(block=>block.id)}))}))},document_blocks:doc.blocks.map(b=>({id:b.id,text:b.text,event_ids:b.event_ids,relation_ids:b.relation_ids})),comments:copy(valid)};
  }
  let session=null, scriptPromise=null, fontPromise=null;
  function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
  function button(text,action,cls=''){const b=el('button','mn-button '+cls,text);b.type='button';b.addEventListener('click',action);return b;}
  function notify(message,isError=false){if(session){session.notice.textContent=message;session.notice.className='mn-notice'+(isError?' mn-error':'');}}
  function readComments(doc){
    try{const raw=localStorage.getItem(KEY+doc.id);if(!raw)return [];const parsed=JSON.parse(raw);if(parsed.run_fingerprint!==doc.id||!Array.isArray(parsed.comments))throw Error('Formato inválido.');const valid=parsed.comments.filter(c=>validateComment(doc,c));if(valid.length!==parsed.comments.length)notify('Alguns comentários não correspondem mais ao trecho original e não foram aplicados.',true);return valid;}
    catch(_){notify('Não foi possível ler os comentários salvos neste navegador.',true);return [];}
  }
  function persist(){try{localStorage.setItem(KEY+session.doc.id,JSON.stringify({schema_version:VERSION,run_fingerprint:session.doc.id,comments:session.comments}));return true;}catch(_){notify('O navegador não conseguiu salvar os comentários. Exporte o feedback JSON para preservá-los.',true);return false;}}
  function selectAnchor(anchor){session.anchor=anchor;session.anchorLabel.textContent='Comentando: “'+anchor.quote+'”';session.composer.hidden=false;session.textarea.focus();}
  function selectionAnchor(){
    const selection=root.getSelection?.();if(!selection || selection.isCollapsed || !selection.rangeCount)return null;
    const range=selection.getRangeAt(0),container=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
    const node=container.closest?.('.mn-text[data-block-id]');if(!node||!session.dialog.contains(node))return null;
    const prefix=range.cloneRange();prefix.selectNodeContents(node);prefix.setEnd(range.startContainer,range.startOffset);
    const start=prefix.toString().length;
    try{return makeAnchor(session.doc,node.dataset.blockId,start,start+range.toString().length);}catch(_){return null;}
  }
  function renderBlock(block){
    const article=el('li','mn-block mn-'+block.kind);article.dataset.blockId=block.id;
    const p=el('p','mn-text',block.text);p.dataset.blockId=block.id;article.append(p);
    if(block.detail)article.append(el('p','mn-state',block.detail));
    const b=button('Comentar trecho',()=>{const anchor=session.selected?.block_id===block.id?session.selected:makeAnchor(session.doc,block.id);selectAnchor(anchor);},'mn-comment-button');b.dataset.commentBlock=block.id;article.append(b);
    return article;
  }
  function renderComments(){
    const box=session.commentList;box.replaceChildren();session.count.textContent=session.comments.filter(c=>c.status==='open').length+' comentários abertos';
    if(!session.comments.length)box.append(el('p','mn-muted','Selecione palavras de uma fala e clique em “Comentar trecho”, ou comente o bloco inteiro.'));
    for(const comment of session.comments){
      const card=el('article','mn-comment '+(comment.status==='resolved'?'mn-resolved':''));card.dataset.commentId=comment.id;
      card.append(el('div','mn-comment-meta',(comment.author||'Autor não informado')+' · '+({note:'Nota',question:'Dúvida',correction:'Correção sugerida'}[comment.category]||'Nota')+' · '+(comment.status==='resolved'?'Resolvido':'Aberto')));
      card.append(button('“'+comment.anchor.quote+'”',()=>{
        const target=[...session.dialog.querySelectorAll('.mn-text')].find(n=>n.dataset.blockId===comment.anchor.block_id);if(!target)return;
        target.scrollIntoView({block:'center',behavior:'smooth'});target.closest('.mn-block').classList.add('mn-highlight');setTimeout(()=>target.closest('.mn-block')?.classList.remove('mn-highlight'),1800);
      },'mn-quote'));
      card.append(el('p','mn-comment-content',comment.text));
      card.append(button(comment.status==='resolved'?'Reabrir':'Marcar resolvido',()=>{comment.status=comment.status==='resolved'?'open':'resolved';comment.updated_at=new Date().toISOString();comment.resolved_at=comment.status==='resolved'?comment.updated_at:null;persist();renderComments();},'mn-small'));
      box.append(card);
    }
  }
  function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(run){
    const doc=buildDocument(run);if(session?.dialog){session.dialog.close();session.dialog.remove();}
    const dialog=el('dialog','mn-dialog');dialog.id='mnDialog';dialog.setAttribute('aria-labelledby','mnTitle');
    const head=el('header','mn-header'),title=el('h2','',doc.title);title.id='mnTitle';head.append(title);
    const actions=el('div','mn-actions');
    actions.append(button('Baixar PDF',async()=>{const active=session;active.pdf.disabled=true;notify('Preparando o PDF local…');try{await downloadPDF(active.doc);if(session===active)notify('PDF gerado. Os comentários podem ser exportados separadamente.');}catch(error){if(session===active)notify('PDF não gerado: '+error.message,true);}finally{active.pdf.disabled=false;}},'mn-primary'));
    actions.firstChild.id='mnPDF';
    actions.append(button('Exportar feedback JSON',()=>{download('feedback-'+(doc.batch_id||'reuniao')+'.json',JSON.stringify(exportFeedback(doc,session.comments),null,2),'application/json');notify('Feedback exportado com os trechos de origem. Nenhuma previsão foi alterada.');}));
    actions.append(button('Fechar',()=>dialog.close()));head.append(actions);dialog.append(head);
    const notice=el('p','mn-notice');notice.setAttribute('role','status');dialog.append(notice);
    const layout=el('div','mn-layout'),paper=el('main','mn-paper');
    for(const thread of doc.threads){const section=el('section','mn-thread');section.append(el('h3','',thread.title));for(const group of thread.sections){const subsection=el('section','mn-section');subsection.dataset.sectionId=group.id;subsection.append(el('h4','',group.title));const list=el('ul','mn-topics');for(const b of group.blocks)list.append(renderBlock(b));subsection.append(list);section.append(subsection);}paper.append(section);}
    if(!doc.metrics.events)paper.append(el('p','','Nenhum evento foi retido nesta execução.'));
    const aside=el('aside','mn-sidebar');aside.append(el('h3','','Comentários'));const count=el('p','mn-muted');aside.append(count);
    aside.append(el('p','mn-local-note','Comentários salvos neste navegador. Exporte o feedback para compartilhá-los. Eles não alteram os registros originais da reunião.'));
    const composer=el('form','mn-composer');composer.hidden=true;const anchorLabel=el('p','mn-anchor-label');composer.append(anchorLabel);
    const author=el('input');author.placeholder='Seu nome (opcional)';author.maxLength=120;author.setAttribute('aria-label','Seu nome, opcional');composer.append(author);
    const category=el('select');category.setAttribute('aria-label','Tipo de comentário');for(const [v,t] of [['note','Nota'],['question','Dúvida'],['correction','Correção sugerida']]){const o=el('option','',t);o.value=v;category.append(o);}composer.append(category);
    const textarea=el('textarea');textarea.placeholder='Escreva o comentário ou a correção sugerida…';textarea.maxLength=10000;textarea.rows=4;textarea.required=true;textarea.setAttribute('aria-label','Comentário');textarea.id='mnCommentText';composer.append(textarea);
    const submit=el('button','mn-button mn-primary','Salvar comentário');submit.type='submit';composer.append(submit);composer.append(button('Cancelar',()=>{composer.hidden=true;session.anchor=null;}));
    composer.addEventListener('submit',event=>{event.preventDefault();try{session.comments.push(createComment(doc,session.anchor,textarea.value,{author:author.value,category:category.value}));const saved=persist();textarea.value='';composer.hidden=true;session.anchor=null;renderComments();if(saved)notify('Comentário salvo neste navegador.');}catch(error){notify(error.message,true);}});
    aside.append(composer);const commentList=el('div','mn-comments');aside.append(commentList);layout.append(paper,aside);dialog.append(layout);document.body.append(dialog);
    session={doc,dialog,notice,commentList,comments:[],anchor:null,selected:null,composer,textarea,anchorLabel,count,pdf:actions.firstChild};session.comments=readComments(doc);renderComments();
    paper.addEventListener('mouseup',()=>{session.selected=selectionAnchor();});paper.addEventListener('keyup',()=>{session.selected=selectionAnchor();});
    dialog.addEventListener('close',()=>{dialog.remove();if(session?.dialog===dialog)session=null;});dialog.showModal();return doc;
  }
  function loadPDF(){
    if(root.jspdf?.jsPDF)return Promise.resolve(root.jspdf.jsPDF);
    if(!scriptPromise)scriptPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/minutes/jspdf-4.2.1.umd.min.js';script.onload=()=>root.jspdf?.jsPDF?resolve(root.jspdf.jsPDF):reject(Error('Biblioteca PDF indisponível.'));script.onerror=()=>reject(Error('Não foi possível carregar a biblioteca PDF local.'));document.head.append(script);}).catch(e=>{scriptPromise=null;throw e;});
    return scriptPromise;
  }
  async function loadFont(){
    if(!fontPromise)fontPromise=fetch('vendor/minutes/DejaVuSans-2.37.ttf').then(async r=>{if(!r.ok)throw Error('Fonte Unicode local indisponível.');const bytes=new Uint8Array(await r.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}).catch(e=>{fontPromise=null;throw e;});
    return fontPromise;
  }
  function pdfPlan(doc){
    const threads=(doc.threads||[]).map((thread,index)=>{
      const explicit=String(thread.id||'').startsWith('topic:')||thread.id==='warnings';
      const id=explicit?thread.id:'topic:'+(thread.id||index+1);
      const title=explicit||/^\d+\.\s/.test(thread.title)?thread.title:(index+1)+'. '+thread.title;
      const sections=(thread.sections||[]).map((section,sectionIndex)=>({...section,
        id:section.id?.startsWith('section:')?section.id:'section:'+(thread.id||index+1)+':'+(section.id||sectionIndex+1),
        title:section.title&&(section.id?.startsWith('section:')||/^\d+\.\d+(?:\.\d+)*\s/.test(section.title))?section.title:section.title?(index+1)+'.'+(sectionIndex+1)+' '+section.title:'',
        blocks:(section.blocks||[]).map(block=>({...block,anchor_id:block.anchor_id||(String(block.id||'').startsWith('event:')?block.id:undefined)}))
      }));
      return {...thread,id,title,sections};
    });
    const declared=new Set(['contents']);
    for(const thread of threads){declared.add(thread.id);for(const section of thread.sections){declared.add(section.id);for(const block of section.blocks){if(block.anchor_id)declared.add(block.anchor_id);for(const alias of block.anchor_aliases||[])declared.add(alias);}}}
    const contents=(doc.contents||threads.filter(t=>t.id!=='warnings').map(t=>({title:t.title,target_id:t.id}))).map((item,index)=>{
      if(typeof item!=='string')return {...item};
      const target=threads.find(t=>t.title===item||t.title.replace(/^\d+\.\s/,'')===item)||threads[index];
      return {title:target?.title||item,target_id:target?.id};
    });
    return {threads,contents,declared};
  }
  async function createPDF(doc){
    const [PDF,font]=await Promise.all([loadPDF(),loadFont()]);
    const pdf=new PDF({unit:'mm',format:'a4',compress:true});
    pdf.addFileToVFS('DejaVuSans.ttf',font);pdf.addFont('DejaVuSans.ttf','DejaVu','normal');pdf.setFont('DejaVu');
    pdf.setProperties({title:doc.title,subject:'Ata de reunião organizada por discussão',creator:'Norte'});
    const palette={background:[4,17,30],panel:[7,29,50],line:[42,68,92],blue:[98,170,255],text:[224,237,249],muted:[159,186,210],amber:[229,185,95],green:[80,203,160],red:[237,123,139],gray:[133,153,172]};
    const margin=18,top=34,plan=pdfPlan(doc),anchors=new Map(),links=[];
    let width=174,pageWidth=210,pageHeight=297,bottom=275,y=top,orientation='portrait';
    const pageNumber=()=>pdf.internal.getCurrentPageInfo().pageNumber;
    const geometry=()=>{pageWidth=pdf.internal.pageSize.getWidth();pageHeight=pdf.internal.pageSize.getHeight();width=pageWidth-margin*2;bottom=pageHeight-22;};
    const setText=color=>pdf.setTextColor(...color);
    const validate=text=>{
      const value=String(text),missing=[...new Set([...value].filter(ch=>!(/\s/u.test(ch))&&(ch.codePointAt(0)>65535||!pdf.getFont().metadata.cmap?.unicode?.codeMap?.[ch.codePointAt(0)])))];
      if(missing.length)throw Error('A fonte PDF não cobre estes caracteres: '+missing.slice(0,8).join(' ')+'. A ata no navegador preserva o texto; use uma fonte com cobertura adequada antes de exportar.');
      return value;
    };
    const anchor=(id,at=y-4)=>{if(id&&!anchors.has(id))anchors.set(id,{page:pageNumber(),top:Math.max(0,at),height:pageHeight});};
    const linkRect=(target,x,at,w,h)=>{if(target&&plan.declared.has(target)&&w>0&&h>0)links.push({target,page:pageNumber(),x,y:at,w,h});};
    const page=()=>{
      pdf.setFillColor(...palette.background);pdf.rect(0,0,pageWidth,pageHeight,'F');
      pdf.setFillColor(...palette.panel);pdf.rect(0,0,pageWidth,23,'F');
      pdf.setDrawColor(...palette.line);pdf.setLineWidth(.25);pdf.line(margin,23,pageWidth-margin,23);
      pdf.setFontSize(10);setText(palette.blue);pdf.text('NORTE',margin,14);
      pdf.setFontSize(8);setText(palette.muted);pdf.text('ATA DE REUNIÃO',pageWidth-margin,14,{align:'right'});y=top;
    };
    const nextPage=(layout=orientation)=>{orientation=layout;pdf.addPage('a4',orientation);geometry();page();};
    const setLayout=layout=>{if(layout!==orientation)nextPage(layout);};
    const reserve=height=>{if(y+Math.min(height,bottom-top)>bottom)nextPage();};
    const stateColor=status=>['conflict','error'].includes(status)?palette.red:status==='completed'?palette.green:['pending','review','blocked'].includes(status)?palette.amber:status==='superseded'?palette.gray:palette.blue;
    // Link spans are disjoint: an unknown [ID] never inherits a surrounding link.
    const richLine=(text,x,baseline,size,color=palette.text,target)=>{
      pdf.setFontSize(size);setText(color);pdf.text(text,x,baseline);
      const h=size*.42,segments=[];let cursor=0;
      for(const match of text.matchAll(/\[([^\]\n]+)\]/g)){
        if(match.index>cursor)segments.push({start:cursor,end:match.index,target});
        const ids=[...match[1].matchAll(/[^,;\s]+/g)];
        if(ids.length===1){segments.push({start:match.index,end:match.index+match[0].length,target:plan.declared.has('event:'+ids[0][0])?'event:'+ids[0][0]:null,reference:true});}
        else for(const id of ids)segments.push({start:match.index+1+id.index,end:match.index+1+id.index+id[0].length,target:plan.declared.has('event:'+id[0])?'event:'+id[0]:null,reference:true});
        cursor=match.index+match[0].length;
      }
      if(cursor<text.length)segments.push({start:cursor,end:text.length,target});
      for(const segment of segments){
        if(!segment.target||!plan.declared.has(segment.target))continue;
        const part=text.slice(segment.start,segment.end),left=x+pdf.getTextWidth(text.slice(0,segment.start)),w=pdf.getTextWidth(part);
        if(segment.reference){pdf.setDrawColor(...palette.blue);pdf.setLineWidth(.12);pdf.line(left,baseline+.5,left+w,baseline+.5);}
        linkRect(segment.target,left,baseline-h,w,h+1.3);
      }
    };
    const marker=(kind,status,x,baseline)=>{
      if(kind==='none')return;
      const color=kind==='done'?palette.green:kind==='todo'&&!['conflict','error'].includes(status)?palette.amber:kind==='bullet'?palette.text:stateColor(status);
      pdf.setDrawColor(...color);pdf.setFillColor(...color);pdf.setLineWidth(.3);
      if(kind==='todo'||kind==='done'){
        const size=2.8,at=baseline-2.5;pdf.roundedRect(x,at,size,size,.35,.35,'S');
        if(kind==='done'){pdf.setLineWidth(.42);pdf.line(x+.55,at+1.4,x+1.15,at+2);pdf.line(x+1.15,at+2,x+2.3,at+.7);}
      }else pdf.circle(x+1,baseline-1.05,.55,'F');
    };
    const warningTargets=ids=>(ids||[]).map(id=>'warning:'+id).filter(id=>plan.declared.has(id));
    const warningMarks=(targets,x,baseline)=>{
      for(const [index,target] of targets.slice(0,5).entries()){
        const left=x+index*5,at=baseline-3;pdf.setDrawColor(...palette.amber);pdf.setLineWidth(.27);
        pdf.triangle(left,at+3,left+1.65,at,left+3.3,at+3,'S');pdf.line(left+1.65,at+.9,left+1.65,at+1.9);pdf.setFillColor(...palette.amber);pdf.circle(left+1.65,at+2.45,.13,'F');
        linkRect(target,left-.5,at-.5,4.3,4);
      }
      if(targets.length>5){pdf.setFontSize(7);setText(palette.amber);const text='+'+(targets.length-5);pdf.text(text,x+25,baseline);linkRect(plan.declared.has('warnings')?'warnings':targets[5],x+25,baseline-3,pdf.getTextWidth(text),4);}
    };
    const paragraph=(text,size=10,gap=3,options={})=>{
      const {depth=0,color=palette.text,marker:kind='none',status='registered',anchor_id,anchor_aliases=[],link_to,warning_ids=[]}=options;
      const nesting=Math.min(Math.max(depth,0),8)*5,indent=(kind==='none'?0:5)+nesting,warnings=warningTargets(warning_ids),warningWidth=warnings.length?Math.min(warnings.length,5)*5+(warnings.length>5?8:0)+3:0;
      pdf.setFontSize(size);const lines=pdf.splitTextToSize(validate(text),width-indent-warningWidth),lineHeight=size*.48;
      reserve(Math.min(lines.length,3)*lineHeight+gap);anchor(anchor_id);for(const alias of anchor_aliases)anchor(alias);
      for(let index=0;index<lines.length;index++){
        if(y+lineHeight>bottom)nextPage();
        if(index===0){marker(kind,status,margin+nesting,y);warningMarks(warnings,pageWidth-margin-warningWidth+3,y);}
        richLine(lines[index],margin+indent,y,size,color,link_to);y+=lineHeight;
      }
      y+=gap;
    };
    const table=value=>{
      const rows=Array.isArray(value)?value:value?.rows;if(!rows?.length)return;
      const headers=Array.isArray(value)?['Teste / acompanhamento','Resultado','Responsável / prazo']:value.headers;
      const columns=headers.length,weights=columns===3?[74,62,38]:Array(columns).fill(1),sum=weights.reduce((a,b)=>a+b,0),widths=weights.map(w=>width*w/sum),size=columns>3?7.5:8,lineHeight=columns>3?3.7:4,padding=3;
      const wrap=cells=>{pdf.setFontSize(size);return widths.map((w,i)=>pdf.splitTextToSize(validate(cells[i]??''),w-padding*2));};
      const heading=wrap(headers),headingLines=Math.max(...heading.map(lines=>lines.length)),headingHeight=headingLines*lineHeight+padding*2;
      const draw=(lines,offset,count,header=false)=>{
        const height=count*lineHeight+padding*2;let x=margin;
        for(let col=0;col<widths.length;col++){
          pdf.setDrawColor(...palette.line);pdf.setLineWidth(.2);pdf.line(x,y+height,x+widths[col],y+height);
          const segment=lines[col].slice(offset,offset+count);
          for(let line=0;line<segment.length;line++)richLine(segment[line],x+padding,y+padding+2.8+line*lineHeight,size,header?palette.blue:palette.text);
          x+=widths[col];
        }
        y+=height;
      };
      const header=()=>draw(heading,0,headingLines,true);
      reserve(headingHeight+14);header();
      rows.forEach(cells=>{
        const lines=wrap(cells),total=Math.max(...lines.map(cell=>cell.length)),fullHeight=total*lineHeight+padding*2;
        if(y+fullHeight>bottom&&fullHeight<=bottom-top-headingHeight){nextPage();header();}
        let offset=0;
        while(offset<total){
          if(bottom-y<padding*2+lineHeight){nextPage();header();}
          const count=Math.min(total-offset,Math.floor((bottom-y-padding*2)/lineHeight));
          draw(lines,offset,count);offset+=count;
          if(offset<total){nextPage();header();}
        }
      });y+=7;
    };
    geometry();page();paragraph(doc.title,22,5);
    if(doc.metadata){
      const meta=doc.metadata;
      if(meta.title&&meta.title!==doc.title)paragraph(meta.title,12,5);
      paragraph('Data: '+meta.date+'   ·   Horário: '+meta.time,9,3,{color:palette.muted});
      paragraph('Duração: '+meta.duration+'   ·   Participantes: em breve',9,7,{color:palette.muted});
    }
    if(plan.contents.length){
      paragraph('Sumário',12,4,{anchor_id:'contents'});
      for(const item of plan.contents)paragraph(item.title,9,2,{color:palette.muted,depth:item.level||0,link_to:item.target_id});
      y+=5;
    }
    if(doc.reviewLabel)paragraph(doc.reviewLabel,8,7,{color:doc.reviewLabel.includes('não validado')?palette.amber:palette.muted,link_to:plan.declared.has('warnings')?'warnings':undefined});
    pdf.setDrawColor(...palette.line);pdf.line(margin,y-2,pageWidth-margin,y-2);y+=8;
    for(const thread of plan.threads){
      setLayout('portrait');const warning=thread.id==='warnings'||thread.title.startsWith('⚠');
      reserve(24);paragraph(thread.title,13,6,{color:warning?palette.amber:palette.text,anchor_id:thread.id,warning_ids:thread.warning_ids});
      for(const section of thread.sections){
        setLayout(section.layout||'portrait');
        if(section.title){reserve(18);paragraph(section.title,10,4,{color:palette.text,anchor_id:section.id});}else anchor(section.id);
        for(const block of section.blocks){
          const status=block.status||block.lifecycle?.status||'registered';
          const kind=block.marker||((block.type==='test_proposal')?(status==='completed'?'done':'todo'):'bullet');
          if(block.keep_with_next)reserve(18);
          paragraph(block.text,9.5,block.detail?1:3,{marker:kind,status,depth:block.depth||0,color:warning?palette.muted:palette.text,anchor_id:block.anchor_id,anchor_aliases:block.anchor_aliases,link_to:block.link_to,warning_ids:block.warning_ids});
          if(block.detail)paragraph(block.detail,8,4,{depth:(block.depth||0)+1,color:['conflict','error','pending','review','completed'].includes(status)?stateColor(status):palette.muted});
        }
        table(section.table);
      }y+=7;
    }
    if(!doc.metrics.events)paragraph('Nenhum evento foi retido nesta execução.');
    const pages=pdf.getNumberOfPages();
    for(let p=1;p<=pages;p++){
      pdf.setPage(p);geometry();pdf.setDrawColor(...palette.line);pdf.setLineWidth(.25);pdf.line(margin,pageHeight-15,pageWidth-margin,pageHeight-15);
      pdf.setFontSize(7);const footer=pdf.splitTextToSize(validate(doc.title),width*.35)[0];setText(palette.muted);pdf.text(footer,margin,pageHeight-9);pdf.text(p+' / '+pages,pageWidth-margin,pageHeight-9,{align:'right'});
      if(anchors.has('contents')){const label='Voltar ao sumário',w=pdf.getTextWidth(label),x=(pageWidth-w)/2;setText(palette.blue);pdf.text(label,x,pageHeight-9);linkRect('contents',x,pageHeight-12,w,4);}
    }
    // jsPDF's XYZ helper converts `top` using the source page's height. FitH
    // accepts PDF points directly, so mixed-orientation targets use THEIR height.
    for(const link of links){
      const target=anchors.get(link.target);if(!target)continue;
      pdf.setPage(link.page);pdf.link(link.x,link.y,link.w,link.h,{pageNumber:target.page,magFactor:'FitH',top:(target.height-target.top)*pdf.internal.scaleFactor});
    }
    return pdf;
  }
  async function downloadPDF(doc){const pdf=await createPDF(doc);pdf.save('ata-'+String(doc.batch_id||'reuniao').replace(/[^a-zA-Z0-9_-]/g,'_')+'.pdf');return pdf;}
  return {VERSION,KEY,buildDocument,makeAnchor,createComment,validateComment,exportFeedback,fingerprint,open,pdfPlan,createPDF,downloadPDF};
});
