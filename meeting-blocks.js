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
 function create({getRun,onUpdate=()=>{},onSave=()=>{},onStatus=()=>{},fetch:requestFetch=root.fetch.bind(root),delay=30000}={}){
  let timer=null,busy=false,stopped=false,lastId=null,lastSignature=null,lastStatus='ready';
  const later=(ms=delay)=>{if(!timer&&!stopped)timer=setTimeout(()=>{timer=null;refresh();},ms);};
  async function request(path,body){
   const response=await requestFetch('/api/ai/blocks/'+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'Não foi possível revisar os blocos.');return data;
  }
  function apply(data,id,before){const run=getRun();if(!run||run.id!==id||signature(run)!==before)return false;run.block_review=data.review;onUpdate();lastStatus=data.status;onStatus(data.status);return true;}
  async function refresh(){
   const run=getRun();if(stopped||!run?.id||busy)return;
   if(root.document?.hidden){later(30000);return;}
   busy=true;const id=run.id,before=signature(run);
   try{const data=await request('review',{session_id:id});if(apply(data,id,before)){lastId=id;lastSignature=before;}else lastSignature=null;}
   catch(_){lastStatus='error';onStatus('error');}
   finally{busy=false;if(lastStatus!=='ready'&&lastStatus!=='disabled'||signature(getRun())!==before)later(lastStatus==='pending'?5000:60000);}
  }
  function saved(run){if(stopped||run?.id!==getRun()?.id||!run?.meeting_events?.length)return;if(lastId!==run.id||lastSignature!==signature(run))later();}
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
  function edit(kind,id){
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
 return {create,valid,signature};
});
