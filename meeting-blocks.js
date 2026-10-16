/* Editorial overlays: original evidence and classifications are never edited. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteMeetingBlocks=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 function signature(run){return JSON.stringify([run?.id,run?.meeting_events,run?.topic_titles,run?.meeting_threads]);}
 function valid(entry,run,kind,id){
  if(!entry||typeof entry.text!=='string'||!Array.isArray(entry.basis)||!entry.basis.length)return false;
  const events=run.meeting_events||[];
  if(!entry.basis.every(b=>events.some(e=>e.event_id===b.id&&e.text===b.text&&(e.type||'')===b.type&&e.thread_id===b.thread_id)))return false;
  if(kind==='title')return events.filter(e=>e.thread_id===id&&e.text?.trim()).length===entry.basis.length;
  const event=events.find(e=>e.event_id===id);
  if(!event||entry.source!==event.text)return false;
  const group=events.filter(e=>e.thread_id===event.thread_id&&e.text?.trim()),index=group.indexOf(event);
  return JSON.stringify(group.slice(Math.max(0,index-2),index+1).map(e=>e.event_id))===JSON.stringify(entry.basis.map(b=>b.id));
 }
 function manual(run,id){const entry=run?.block_edits?.[id],event=run?.meeting_events?.find(e=>e.event_id===id);if(!entry||!event||entry.source!==event.text)return null;if(entry.restore===true)return {...entry,text:event.text};return typeof entry.text==='string'&&entry.text.trim()&&entry.text.length<=240?entry:null;}
 function create({getRun,automatic=true,onUpdate=()=>{},onSave=()=>{},onStatus=()=>{},fetch:requestFetch=root.fetch.bind(root),delay=30000}={}){
  let timer=null,busy=false,stopped=false,lastId=null,lastSignature=null,lastStatus='ready';
  const later=(ms=delay)=>{if(!timer&&!stopped)timer=setTimeout(()=>{timer=null;refresh();},ms);};
  async function request(path,body){
   const response=await requestFetch('/api/ai/blocks/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível revisar os blocos.');return data;
  }
  function apply(data,id,before){const run=getRun();if(!run||run.id!==id||signature(run)!==before)return false;run.block_review=data.review;onUpdate();lastStatus=data.status;onStatus(data.status);return true;}
  async function refresh(){
   const run=getRun();if(!automatic||stopped||!run?.id||busy)return;
   if(root.document?.hidden){later(30000);return;}
   busy=true;const id=run.id,before=signature(run);
   try{const data=await request('review',{session_id:id});if(apply(data,id,before)){lastId=id;lastSignature=before;}else lastSignature=null;}
   catch(_){lastStatus='error';onStatus('error');}
   finally{busy=false;if(lastStatus!=='ready'&&lastStatus!=='disabled'||signature(getRun())!==before)later(lastStatus==='pending'?5000:60000);}
  }
  function saved(run){if(!automatic||stopped||run?.id!==getRun()?.id||!run?.meeting_events?.length)return;if(lastId!==run.id||lastSignature!==signature(run))later();}
  async function feedback(kind,id,action,text){
   const run=getRun(),entry=run?.block_review?.[kind==='title'?'titles':'blocks']?.[id];
   if(!valid(entry,run,kind,id))throw Error('O registro mudou. Aguarde a revisão antes de corrigir.');
   const before=signature(run),session=run.id;
   const data=await request('feedback',{session_id:session,kind,id,key:entry.key,version:entry.version,action,...(text===undefined?{}:{text})});
   if(apply(data,session,before)&&kind==='title'&&action!=='restore'){
    // A human-approved title is now explicit; later speech cannot replace it.
    const current=getRun(),title=action==='correct'?text:entry.text;current.topic_titles||={};current.topic_titles[id]=title;
    for(const thread of current.meeting_threads||[])if(thread.thread_id===id)thread.title=title;
    current.title_edits||=[];current.title_edits.push({thread_id:id,title,source:'manual',at:new Date().toISOString()});onUpdate();await onSave();
   }
   return data;
  }
  function editManual(id){
   const run=getRun(),event=run?.meeting_events?.find(e=>e.event_id===id);if(!event)return;
   const session=run.id,source=event.text,doc=root.document,dialog=doc.createElement('dialog');dialog.className='room-block-dialog';
   const make=(tag,text)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
   const form=make('form'),heading=make('h2','Editar texto do bloco'),label=make('label','Resumo para exibição'),input=make('textarea'),status=make('p'),actions=make('div');
   heading.id='blockEditHeading';dialog.setAttribute('aria-labelledby',heading.id);input.value=manual(run,id)?.text||(valid(run.block_review?.blocks?.[id],run,'block',id)?run.block_review.blocks[id].text:event.summary_source===source&&event.summary_origin==='prepared_example'?event.summary:source);input.rows=3;input.maxLength=240;input.required=true;label.append(input);status.setAttribute('role','status');
   const save=make('button','Salvar resumo');save.type='submit';const restore=make('button','Usar original');restore.type='button';const close=make('button','Cancelar');close.type='button';close.onclick=()=>dialog.close();
   async function apply(reset){const current=getRun();if(current?.id!==session||!current.meeting_events.some(e=>e.event_id===id&&e.text===source)){status.textContent='O registro mudou. Feche e abra novamente.';return;}
    if(!reset&&(!input.value.trim()||input.value.trim().length>240)){status.textContent='Escreva um resumo de até 240 caracteres.';return;}
    const previous=current.block_edits;current.block_edits={...previous};if(reset)current.block_edits[id]={restore:true,source,at:new Date().toISOString()};else current.block_edits[id]={text:input.value.trim(),source,at:new Date().toISOString()};
    save.disabled=restore.disabled=true;try{if(await onSave()===false)throw Error('Não foi possível salvar. Tente novamente.');onUpdate();dialog.close();}catch(error){current.block_edits=previous;status.textContent=error.message;save.disabled=restore.disabled=false;}
   }
   form.onsubmit=e=>{e.preventDefault();void apply(false);};restore.onclick=()=>void apply(true);actions.append(save,restore);if(valid(run.block_review?.blocks?.[id],run,'block',id)){const assess=make('button','Avaliar sugestão da IA');assess.type='button';assess.onclick=()=>{dialog.close();review('block',id);};actions.append(assess);}actions.append(close);form.append(heading,make('p','Escreva o ponto principal em uma frase. A fala original, os valores e a classificação permanecem nos detalhes.'),make('blockquote',source),label,status,actions);dialog.append(form);doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();input.focus();
  }
  function edit(kind,id){if(kind==='block')editManual(id);else review(kind,id);}
  function review(kind,id){
   const run=getRun(),entry=run?.block_review?.[kind==='title'?'titles':'blocks']?.[id];if(!valid(entry,run,kind,id))return;
   const session=run.id,version=entry.version,doc=root.document,dialog=doc.createElement('dialog');dialog.className='room-block-dialog';
   const make=(tag,text)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
   const form=make('form'),heading=make('h2',kind==='title'?'Revisar título':'Revisar síntese'),original=make('blockquote',entry.source),label=make('label','Texto para exibição'),input=make('textarea'),status=make('p'),actions=make('div');
   heading.id='blockReviewHeading';dialog.setAttribute('aria-labelledby',heading.id);input.value=entry.text;input.rows=5;input.maxLength=kind==='title'?90:entry.source.length;label.append(input);status.setAttribute('role','status');
   const close=make('button','Fechar');close.type='button';close.className='compact-button';close.onclick=()=>dialog.close();
   const buttons=[];
   for(const [action,text]of [['accept','Está bom'],['correct','Salvar correção'],['restore','Usar original']]){
    const button=make('button',text);button.type='button';button.className='compact-button';buttons.push(button);
    button.onclick=async()=>{if(getRun()?.id!==session||getRun()?.block_review?.[kind==='title'?'titles':'blocks']?.[id]?.version!==version){status.textContent='O registro mudou. Feche e abra novamente.';return;}
     buttons.forEach(b=>b.disabled=true);try{await feedback(kind,id,action,action==='correct'?input.value.trim():undefined);dialog.close();}catch(error){status.textContent=error.message;buttons.forEach(b=>b.disabled=false);}};actions.append(button);
   }
   form.onsubmit=e=>e.preventDefault();actions.append(close);form.append(heading,make('p','Fala original preservada. Sua avaliação ajuda a revisar conteúdos iguais no mesmo contexto.'),original,label,status,actions);dialog.append(form);doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();input.focus();
  }
  return {saved,refresh,feedback,edit,stop(){stopped=true;clearTimeout(timer);timer=null;}};
 }
 return {create,valid,signature,manual};
});
