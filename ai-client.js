/* Account-scoped telemetry. Learning never holds the meeting response open. */
(function(root){
'use strict';
const queue=new Map(),seen=new Set();let timer=null,busy=false,failures=0;
const enabled=()=>root.document?.body.dataset.auth==='on';
const normalized=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
function possibleRequest(text){
 const value=normalized(text);
 return /\b(simula\w*|viga|calculo\w*|resultado\w*|grafico\w*|forca|carga|p\s*\d+|comprimento|secao)\b/.test(value)&&/\b(quero|queria|vamos|bora|abr\w*|abirr|mostr\w*|simula\w*|aument\w*|reduz\w*|diminu\w*|muda\w*|coloc\w*|bota\w*|altera\w*|pode|poderia)\b/.test(value);
}
function guarded(text){return /\b(nao|nunca|nem|talvez|disse|falou|exemplo|hipoteticamente|poderiamos)\b|^(se|quando|imagine|suponha)\b/.test(normalized(text))||/["“”]/.test(text);}
function schedule(){if(!timer&&queue.size&&failures<4)timer=setTimeout(()=>{timer=null;flush();},failures?Math.min(1000*2**failures,15000):500);}
function record(event){
 if(!enabled()||!event?.id||seen.has(event.id))return;
 seen.add(event.id);queue.set(event.id,{...event,text:String(event.text||'').slice(0,2000)});
 if(seen.size>6000)seen.delete(seen.values().next().value);
 if(queue.size>300)queue.delete(queue.keys().next().value);
 schedule();
}
async function flush(){
 if(!enabled()||busy||!queue.size)return false;busy=true;
 // Keep batches below the browser keepalive limit when leaving the page.
 const batch=[];let bytes=0;for(const row of queue.values()){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(batch.length&&(bytes+size>45000||batch.length>=20))break;batch.push(row);bytes+=size;}
 try{const response=await fetch('/api/ai/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),keepalive:true,signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('telemetry');for(const row of batch)queue.delete(row.id);failures=0;return true;}catch(_){failures++;return false;}finally{busy=false;schedule();}
}
function observe(run){
 if(!enabled()||!run?.id)return;
 for(const entry of run.transcript||[]){
  if(entry.source==='simulation'||!['done','command','error'].includes(entry.status))continue;
  const audit=entry.command,recorded=run.records?.find(row=>row.id===entry.chunk_id);
  if(audit?.source_entry_ids?.length&&audit.source_entry_ids[0]!==entry.id)continue;
  if(!audit?.consumed&&entry.chunk_id&&run.transcript.find(row=>row.chunk_id===entry.chunk_id)?.id!==entry.id)continue;
  if(audit?.status==='awaiting_continuation')continue;
  const text=audit?.text||run.batch?.cases?.find(row=>row.id===entry.chunk_id)?.current_utterance||entry.text,isIntent=!!audit?.consumed||possibleRequest(text)&&!guarded(text),success=audit?.status==='applied'||audit?.renamed;
  const status=isIntent?(success?'success':['error','classification_error'].includes(audit?.status)||entry.status==='error'?'error':'unrecognized'):entry.status==='error'?'error':'success';
  const details={audit_status:audit?.status||null,operations:(audit?.operations||[]).map(op=>op.type),interpretation_source:audit?.interpretation_source||audit?.routing||null,rule_id:audit?.rule_id||null,store:recorded?.result?.store??null};
  // Physical evidence is for the server's LOCAL replay only. ai_runtime's
  // external-review boundary explicitly rejects state/details fields.
  if(isIntent&&status!=='success'){
   const state=audit?.beam_state_before||entry.ai_replay_state;
   if(state&&JSON.stringify(state).length<2400)details.beam_state_before=state;
   else if(state)details.replay_omitted='state_too_large';
   details.issues=(audit?.issues||[]).slice(0,3);details.interpreted_text=String(audit?.interpreted_text||text).slice(0,600);
  }
  record({id:run.id+':'+entry.id,session_id:run.id,kind:isIntent?'intent':'classification',text,intent:audit?.operations?.[0]?.type||recorded?.result?.type||null,status,source:entry.source||'text',latency_ms:Math.min(3600000,Math.max(0,Date.parse(audit?.processed_at||recorded?.timestamp||entry.receivedAt)-Date.parse(entry.receivedAt)))||0,details});
 }
}
async function resolve(text,sessionId){
 if(!enabled()||guarded(text)||!possibleRequest(text)||/\d/.test(text))return null;
 try{const response=await fetch('/api/ai/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,session_id:sessionId,allow_model:true}),signal:AbortSignal.timeout(2500)});if(!response.ok)return null;const result=await response.json();return result.intent==='open_simulation'&&result.confidence>=.9?result:null;}catch(_){return null;}
}
function feedback(run,command,correct){
 const source=run?.transcript?.find(entry=>entry.command?.id===command?.id);if(!run||!source)return;
 record({id:root.crypto.randomUUID(),session_id:run.id,kind:'feedback',text:command.text||source.text,intent:command.operations?.[0]?.type||null,expected_intent:correct?command.operations?.[0]?.type||null:null,correct,status:'success',source:'feedback',details:{event_id:run.id+':'+source.id}});
 flush();
}
root.addEventListener('online',()=>{failures=0;schedule();});
root.addEventListener('pagehide',()=>{failures=0;flush();});
root.document?.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();else{failures=0;schedule();}});
root.NorteAI={record,observe,resolve,feedback,flush,possibleRequest,guarded};
})(globalThis);
