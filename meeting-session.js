/* Streaming meeting input over the same V2 contracts and independent workers. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require:null,root);if(typeof module==='object'&&module.exports)module.exports=api;else root.NorteMeetingSession=api;})(globalThis,function(require,root){
'use strict';
const E=require?require('./experiments.js'):root.NorteExperiments,F=require?require('./memory-flow.js'):root.NorteMemoryFlow,V=require?require('./memory-v2.js'):root.NorteMemoryV2,T=(require?require('./relation-worker.js'):root.NorteRelations).threads,TR=require?require('./typed-relations.js'):root.NorteTypedRelations;
const commands=()=>require?require('./meeting-commands.js'):root.NorteMeetingCommands;
const speech=()=>require?require('./meeting-speech.js'):root.NorteMeetingSpeech;
const copy=E.clone,MAX_CHUNKS=3000,MAX_TEXT=500000;
function commandText(text){
 // Timestamped speaker prefixes are transcript metadata, not spoken words.
 // Keep the untouched source in transcript; do not guess arbitrary name prefixes.
 const timestamp='(?:\\d{1,3}:)?\\d{1,2}:\\d{2}(?:[.,]\\d{1,3})?';
 const prefix=new RegExp('^\\s*(?:\\['+timestamp+'\\]|\\('+timestamp+'\\)|'+timestamp+')\\s*(?:[-–—]\\s*)?(?:[^:\\n]{1,80}:\\s*)?(Norte\\b[\\s\\S]*)$','i');
 return text.match(prefix)?.[1]||text;
}
function split(text){
 const parts=[];
 for(const line of text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
  // Never split commands into a command plus an accidental memory fragment.
  if(/^norte\b/i.test(commandText(line))){parts.push(line);continue;}
  // Slice at boundaries instead of matching sentence bodies: decimal points,
  // punctuation and everything before them must remain in the source text.
  const sentences=[];let start=0;
  for(const boundary of line.matchAll(/[.!?]+["”’)]?\s+(?=\p{Lu})/gu)){
   const prefix=line.slice(start,boundary.index),word=prefix.match(/([\p{L}.]+)$/u)?.[1]||'';
   if(boundary[0].startsWith('.')&&(/^(?:sr|sra|srta|dr|dra|prof|profa|eng|engª|etc|ex|art|fig|aprox|vs)$/iu.test(word)||/^(?:\p{Lu}|(?:\p{Lu}\.)+\p{Lu})$/u.test(word)))continue;
   const end=boundary.index+boundary[0].trimEnd().length;sentences.push(line.slice(start,end));start=boundary.index+boundary[0].length;
  }
  sentences.push(line.slice(start));
  for(const sentence of sentences){const words=sentence.trim().split(/\s+/);for(let i=0;i<words.length;i+=110)parts.push(words.slice(i,i+110).join(' '));}
 }
 return parts.filter(Boolean);
}
function parseTranscript(text,name='transcricao.txt'){
 if(typeof text!=='string'||!text.trim())throw Error('A transcrição está vazia.');
 if(text.length>MAX_TEXT)throw Error('A transcrição deve ter até 500 mil caracteres.');
 text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');let parts;
 if(/\.json$/i.test(name)||/^[\[{]/.test(text.trim())&&!/^\s*\[(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]/.test(text)){
  let data;try{data=JSON.parse(text);}catch(_){throw Error('O arquivo JSON não é válido.');}
  if(!data||typeof data!=='object')throw Error('JSON esperado: lista de falas, cases, records, segments ou fullText.');
  const records=Array.isArray(data)?data:data.cases||data.records||data.segments||data.transcript;
  if(Array.isArray(records))parts=records.flatMap(r=>{if(typeof r!=='string'&&(!r||typeof r!=='object'||Array.isArray(r)))throw Error('Cada trecho deve conter text ou current_utterance.');if(typeof r!=='string'&&r.status&&!['final','confirmed','done'].includes(r.status))return [];const value=typeof r==='string'?r:r.current_utterance??r.text??r.transcript;if(typeof value!=='string')throw Error('Cada trecho deve conter text ou current_utterance.');return split(value);});
  else if(typeof records==='string')parts=split(records);else if(typeof data.fullText==='string')parts=split(data.fullText);else throw Error('JSON esperado: lista de falas, cases, records, segments ou fullText.');
 }else if(/\.(srt|vtt)$/i.test(name)||/^WEBVTT/.test(text.trim())){
  parts=text.split(/\n\s*\n/).flatMap(block=>{const lines=block.trim().split('\n');if(/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))return [];const time=lines.findIndex(line=>/^\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}/.test(line));if(time<0)return [];const content=lines.slice(time+1).join(' ').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|nbsp|quot);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',nbsp:' ',quot:'"'})[key]);return split(content);});
 }else parts=split(text);
 if(!parts.length)throw Error('Não há falas confirmadas na transcrição.');
 if(parts.length>MAX_CHUNKS)throw Error('A transcrição excede 3.000 trechos; divida em reuniões menores.');
 return parts;
}
// Source timing and speakers belong to the transcript, never to model State.
// The legacy parseTranscript() remains available for callers expecting strings.
function timestampOffset(value){
 if(typeof value!=='string'||! /^(?:\d{1,3}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?$/.test(value))throw Error('Horário da transcrição inválido: '+value+'. Use HH:MM:SS ou MM:SS.');
 const parts=value.replace(',','.').split(':').map(Number),seconds=parts.pop(),minutes=parts.pop(),hours=parts.pop()||0;
 if(minutes>=60||seconds>=60)throw Error('Horário da transcrição inválido: minutos e segundos devem ser menores que 60.');
 return Math.round((hours*3600+minutes*60+seconds)*1000);
}
function transcriptMeta(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Metadados da transcrição inválidos.');
 const metadata={};
 for(const [key,limit] of [['sourceText',MAX_TEXT],['speaker',200],['sourceId',256],['segmentId',256],['speechContext',1600]]){
  if(value[key]===undefined||value[key]===null)continue;
  if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>limit)throw Error('Metadado '+key+' da transcrição inválido.');
  metadata[key]=value[key];
 }
 if(value.offsetMs!==undefined&&value.offsetMs!==null){
  if(typeof value.offsetMs!=='number'||!Number.isFinite(value.offsetMs)||value.offsetMs<0||value.offsetMs>Number.MAX_SAFE_INTEGER)throw Error('Horário da transcrição deve ser um número de milissegundos válido.');
  metadata.offsetMs=value.offsetMs;
 }
 return metadata;
}
function spokenEntry(original,metadata={}){
 if(typeof original!=='string'||!original.trim())throw Error('Cada trecho deve conter text ou current_utterance.');
 let text=original.trim(),timed=null,speaker;
 const prefix=text.match(/^(?:\[(\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.,]\d+)?)\]|\((\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.,]\d+)?)\)|(\d{1,3}:\d{1,2}(?::\d{1,2})?(?:[.,]\d+)?)(?=\s|$))\s*(?:[-–—]\s*)?([\s\S]*)$/);
 if(prefix){
  timed=timestampOffset(prefix[1]||prefix[2]||prefix[3]);text=prefix[4].trim();
  const named=text.match(/^([\p{L}\p{N}][\p{L}\p{N} ._'’–—-]{0,79}):\s*([\s\S]*)$/u);
  if(named){speaker=named[1].trim();text=named[2].trim();}
 }
 if(!text)throw Error('Um horário da transcrição está sem fala.');
 return {text,sourceText:original,...(timed!==null?{offsetMs:timed}:{}),...(speaker?{speaker}:{}),...transcriptMeta(metadata)};
}
function parseTranscriptEntries(text,name='transcricao.txt'){
 if(typeof text!=='string'||!text.trim())throw Error('A transcrição está vazia.');
 if(text.length>MAX_TEXT)throw Error('A transcrição deve ter até 500 mil caracteres.');
 text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');let entries;
 const plainLines=source=>source.split('\n').filter(line=>line.trim()).map((line,index)=>spokenEntry(line,{segmentId:'line-'+String(index+1).padStart(4,'0')}));
 const timedStart=/^\s*\[\d{1,3}:\d/.test(text);
 if(/\.json$/i.test(name)||/^[\[{]/.test(text.trim())&&!timedStart){
  let data;try{data=JSON.parse(text);}catch(_){throw Error('O arquivo JSON não é válido.');}
  if(!data||typeof data!=='object')throw Error('JSON esperado: lista de falas, cases, records, segments ou fullText.');
  const records=Array.isArray(data)?data:data.cases||data.records||data.segments||data.transcript;
  if(Array.isArray(records))entries=records.flatMap((record,index)=>{
   if(typeof record!=='string'&&(!record||typeof record!=='object'||Array.isArray(record)))throw Error('Cada trecho deve conter text ou current_utterance.');
   if(typeof record!=='string'&&record.status&&!['final','confirmed','done','command'].includes(record.status))return [];
   const original=typeof record==='string'?record:record.current_utterance??record.text??record.transcript;
   const metadata={segmentId:'record-'+String(index+1).padStart(4,'0')};
   if(typeof record!=='string'){
    const offset=record.offsetMs??record.startMs;
    if(offset!==undefined&&offset!==null)metadata.offsetMs=offset;
    else if(record.timestamp!==undefined&&record.timestamp!==null)metadata.offsetMs=timestampOffset(record.timestamp);
    for(const key of ['speaker','sourceText','sourceId','segmentId'])if(record[key]!==undefined&&record[key]!==null)metadata[key]=record[key];
    if(record.id!==undefined&&record.id!==null){
     const id=typeof record.id==='number'&&Number.isFinite(record.id)?String(record.id):record.id;
     metadata.sourceId??=id;
     if(record.segmentId===undefined||record.segmentId===null)metadata.segmentId=id;
    }
   }
   return [spokenEntry(original,metadata)];
  });
  else if(typeof records==='string')entries=plainLines(records);
  else if(typeof data.fullText==='string')entries=plainLines(data.fullText);
  else throw Error('JSON esperado: lista de falas, cases, records, segments ou fullText.');
 }else if(/\.(srt|vtt)$/i.test(name)||/^WEBVTT/.test(text.trim())){
  const decode=value=>value.replace(/&(amp|lt|gt|nbsp|quot);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',nbsp:' ',quot:'"'})[key]);
  entries=text.split(/\n\s*\n/).flatMap((block,index)=>{
   const lines=block.trim().split('\n');
   if(/^(?:WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))return [];
   const time=lines.findIndex(line=>line.includes('-->'));if(time<0)return [];
   const timing=lines[time].trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s|$)/);
   if(!timing)throw Error('Horário de legenda inválido.');
   const offsetMs=timestampOffset(timing[1]),endMs=timestampOffset(timing[2]);
   if(endMs<offsetMs)throw Error('O final da legenda precede seu início.');
   const raw=lines.slice(time+1).join(' '),voice=raw.match(/<v(?:\.[^\s>]+)*\s+([^>]+)>/i)?.[1];
   const content=decode(raw.replace(/<[^>]*>/g,''));
   if(!content.trim())return [];
   const sourceId=time?lines.slice(0,time).join(' ').trim():undefined;
   return [spokenEntry(content,{sourceText:block,offsetMs,segmentId:sourceId||'cue-'+String(index+1).padStart(4,'0'),...(sourceId?{sourceId}:{}),...(voice?{speaker:decode(voice).trim()}: {})})];
  });
 }else entries=plainLines(text);
 if(!entries.length)throw Error('Não há falas confirmadas na transcrição.');
 if(entries.length>MAX_CHUNKS)throw Error('A transcrição excede 3.000 trechos; divida em reuniões menores.');
 return entries;
}
function applyTitles(run){for(const t of run.meeting_threads)if(run.topic_titles?.[t.thread_id])t.title=run.topic_titles[t.thread_id];}
function create({provider='official',title='Nova reunião',send,onChange=()=>{},now=Date.now,seed=null,commandHandler=null}={}){
 if(typeof send!=='function')throw Error('Transporte da reunião ausente.');
 const stamp=new Date(now()).toISOString(),id=root.crypto?.randomUUID?.()||'meeting-'+now()+'-'+Math.random().toString(16).slice(2);
 const run=seed?restore(seed):{schemaVersion:1,liveSchemaVersion:1,memorySchemaVersion:2,id,title,provider,threshold:.6,questions:F.validateQuestions(V.questions),questionVersion:'memory-v2',createdAt:stamp,startedAt:stamp,status:'running',batch:{batch_id:id.slice(0,80),cases:[]},records:[],calls:0,meeting_events:[],meeting_threads:[],meeting_relations:[],raw_window:[],transcript:[],topic_titles:{},meeting_commands:[]};
 if(seed&&run.provider!==provider)throw Error('A revisão deve usar o mesmo provedor da reunião.');
 run.status='running';delete run.finishedAt;
 let queue=[],busy=false,closed=false,halted=false,finishing=false,thread,typed,resolveDone,threadWaiters=[],cancelCalls=new Set(),nextSpeech=null;
 const done=new Promise(resolve=>resolveDone=resolve);
 function notify(change={}){applyTitles(run);onChange(run,change);}
 function settled(){return run.thread_worker.jobs.every(j=>['done','error','interrupted'].includes(j.status));}
 function relay(){if(!typed||halted)return;const jobs=run.thread_worker.jobs;while(run.typed_relation_worker.jobs.length<jobs.length){const j=jobs[run.typed_relation_worker.jobs.length];if(!['done','error','interrupted'].includes(j.status))break;if(!typed.enqueue(run.meeting_events.find(e=>e.event_id===j.event_id)))break;}}
 function threadChange(){relay();if(settled()){for(const wake of threadWaiters.splice(0))wake();}notify({phase:'topics'});}
 function stop(error){if(halted)return;halted=true;closed=true;nextSpeech?.();run.status='interrupted';if(error)run.error=error.message||String(error);for(const entry of queue.splice(0)){entry.status='interrupted';entry.error='Trecho preservado; processamento interrompido.';}thread?.stop();typed?.stop();for(const cancel of cancelCalls)cancel();cancelCalls.clear();for(const wake of threadWaiters.splice(0))wake();notify({phase:'stopped'});finish();}
 const transport=lane=>async(request,selected=provider)=>{try{
  const requested=typeof selected==='object'&&selected!==null?selected.provider||provider:selected||provider;
  if(halted)throw Object.assign(Error('A reunião foi interrompida.'),{stopBatch:true});
  if(requested!==provider)throw Object.assign(Error('O provedor mudou durante a reunião.'),{stopBatch:true});
  let cancel;
  const cancelled=new Promise((_,reject)=>{cancel=()=>reject(Object.assign(Error('A reunião foi interrompida.'),{stopBatch:true}));cancelCalls.add(cancel);});
  let output;try{output=await Promise.race([Promise.resolve().then(()=>send(request,requested,lane)),cancelled]);}finally{cancelCalls.delete(cancel);}
  if(halted)throw Object.assign(Error('A reunião foi interrompida.'),{stopBatch:true});
  if(output?.provider!==provider)throw Object.assign(Error('A resposta veio de outro provedor.'),{stopBatch:true});
  return output;
 }catch(e){if(e.stopBatch)stop(e);throw e;}};
 thread=T.start(run,{schemaVersion:5,config:V.threadConfig,version:'memory-v2',send:transport('threads'),onChange:threadChange,resume:!!seed});
 typed=TR.start(run,{streaming:true,config:TR.defaults,version:'typed-v2',send:transport('relations'),onChange:()=>notify({phase:'relations'}),resume:!!seed});
 typed.done.catch(stop);
 async function finish(){if(finishing||busy||queue.length||!closed)return;finishing=true;
  try{thread.close();await thread.done;relay();run.status=halted?'interrupted':'finishing';typed.close();await typed.done;
   run.status=halted||run.records.some(r=>r.status==='error')||run.thread_worker.status!=='done'||run.thread_worker.jobs.some(j=>j.status==='error')||run.typed_relation_worker.status!=='done'?'interrupted':'done';
  }catch(e){run.error=e.message;run.status='interrupted';thread.stop();typed.stop();}
  run.finishedAt=new Date(now()).toISOString();try{notify({phase:'finished'});}finally{resolveDone(run);}
 }
 const adjacent=(a,b)=>a&&b&&a.source===b.source&&a.speaker===b.speaker&&b.offsetMs>=a.offsetMs&&b.offsetMs-a.offsetMs<=9000;
 async function nextWindow(){if(queue.length||closed||halted)return;await new Promise(resolve=>{const timer=setTimeout(finish,7000);function finish(){clearTimeout(timer);nextSpeech=null;resolve();}nextSpeech=finish;});}
 async function drain(){if(busy)return;busy=true;
  while(queue.length&&!halted){const entry=queue.shift(),sources=[entry];entry.status='processing';let utterance=entry.text;notify({phase:'input'});
   try{
    if(['microphone','import'].includes(entry.source))while(sources.length<3&&speech().unfinished(utterance)){
     await nextWindow();const next=queue[0];
     if(halted||!adjacent(sources.at(-1),next)||!speech().canContinue(utterance,next.text))break;
     sources.push(queue.shift());next.status='processing';utterance+=' '+next.text;
    }
    if(halted){for(const source of sources)source.status='interrupted';break;}
    const commandInput=commandText(utterance);
    // Simulation commands depend on their spoken context and current model,
    // not on a slower topic-classification response. Preserve the full capture
    // provenance so continuation expiry uses speech time rather than latency.
    const extension=commandHandler&&entry.source!=='simulation'?await commandHandler(commandInput,{run,entry,sourceEntries:sources.map(copy),send:transport('commands'),provider,isActive:()=>!halted}):null;
    if(halted){for(const source of sources)source.status='interrupted';break;}
    if(!extension?.consumed&&/^\s*norte\b/i.test(commandInput)&&!settled())await new Promise(resolve=>threadWaiters.push(resolve));
    if(halted){for(const source of sources)source.status='interrupted';break;}
    const command=extension?.consumed?extension:await commands().process(commandInput,{run,send:transport('commands'),chunkId:entry.id,source:entry.source,speaker:entry.speaker,nowMs:Date.parse(entry.receivedAt)});entry.command=command;
    if(halted){for(const source of sources)source.status='interrupted';break;}
    if(command.consumed){
     for(const source of sources){source.status='command';source.command=command;}
     // Computed simulation facts use the normal memory pipeline and retain
     // their origin. They may arrive while an imported transcript is closing.
     command.memory_enqueued=false;
     if(command.memory?.length){try{
      const generated=prepareFacts(command.memory,{offsetMs:entry.offsetMs,origin:entry.id});run.transcript.splice(run.transcript.indexOf(sources.at(-1))+1,0,...generated);queue.unshift(...generated);command.memory_enqueued=true;
     }catch(error){command.memory_error=error.message;command.message+=' Os resultados ficaram salvos na simulação, mas não entraram na ata: '+error.message;}}
     notify({phase:'command',command});continue;
    }
    if(halted){for(const source of sources)source.status='interrupted';break;}
    const item={id:'C'+String(run.records.length+1).padStart(4,'0'),current_utterance:utterance,...(entry.speechContext?{speech_context:entry.speechContext}:{}),...(sources.length>1?{source_entry_ids:sources.map(s=>s.id)}:{})};run.batch.cases.push(item);
    const record={id:item.id,status:'running',stage:'store',startedAt:entry.receivedAt,receivedOffsetMs:entry.offsetMs};run.records.push(record);for(const source of sources)source.chunk_id=item.id;
    try{
     const req=F.request(item,'store',run.questions);run.calls++;record.storeOutput=await transport('chunks')(req,provider);E.validateOutput(record.storeOutput,{state:req.state,config:req});
     const gate=record.storeOutput.response.answers.should_store_memory,store=E.predicted(gate);let type=null,typeProbability=null;
     if(store&&!halted){const req=F.request(item,'type',run.questions);run.calls++;record.stage='type';record.typeOutput=await transport('chunks')(req,provider);E.validateOutput(record.typeOutput,{state:req.state,config:req});type=E.predicted(record.typeOutput.response.answers.event_type);typeProbability=E.probabilityOf(record.typeOutput.response.answers.event_type,type);}
     if(halted){record.status='interrupted';for(const source of sources)source.status='interrupted';break;}
     record.result={store,type,storeProbability:E.probabilityOf(gate,store),typeProbability,destination:store?type:'ignore'};record.status='done';record.timestamp=new Date(now()).toISOString();record.stage=record.result.destination;for(const source of sources)source.status='done';
     Object.assign(run,F.memoryState(run));T.syncMemory(run);if(store)thread.enqueue(run.meeting_events.at(-1));notify({phase:'memory'});
    }catch(e){record.status='error';record.error=e.message;throw e;}
   }catch(e){for(const source of sources){source.status='error';source.error=e.message;}if(e.stopBatch)stop(e);notify({phase:'error',error:e});}
  }
  busy=false;finish();
 }
 function append(text,meta={}){
  if(closed||halted)throw Error('A entrada desta reunião já foi encerrada.');
  if(typeof text!=='string'||!text.trim())return false;
  E.validateState({current_utterance:text});
  const metadata=transcriptMeta(meta);
  if(run.transcript.length>=MAX_CHUNKS||run.transcript.reduce((n,x)=>n+x.text.length,0)+text.length>MAX_TEXT)throw Error('Limite da reunião atingido. Encerre e inicie uma nova reunião.');
  const entry={id:'S'+String(run.transcript.length+1).padStart(4,'0'),text:text.trim(),source:meta.source||'text',receivedAt:new Date(now()).toISOString(),offsetMs:Math.max(0,now()-Date.parse(stamp)),...metadata,status:'queued'};
  const previous=run.transcript.at(-1);
  if(['microphone','import'].includes(entry.source)&&adjacent(previous,entry)&&!speech().isCommand(previous.text)&&!previous.command?.consumed){
   entry.speechContext=speech().boundedContext([previous.speechContext,previous.text].filter(Boolean).join(' '));
  }
  run.transcript.push(entry);queue.push(entry);nextSpeech?.();notify({phase:'received'});queueMicrotask(drain);return true;
 }
 function prepareFacts(facts,meta={}){
  if(!Array.isArray(facts)||!facts.length||facts.length>20)throw Error('Forneça os registros calculados de uma simulação.');
  const generated=facts.map((fact,index)=>{
   if(!fact||typeof fact.text!=='string'||!fact.text.trim())throw Error('Um registro calculado está vazio.');
   E.validateState({current_utterance:fact.text});E.validateState({simulation:fact.simulation||{}});
   const id='S'+String(run.transcript.length+index+1).padStart(4,'0');
   return {id,text:fact.text.trim(),source:'simulation',speaker:'Simulação',receivedAt:new Date(now()).toISOString(),offsetMs:Number.isFinite(meta.offsetMs)?meta.offsetMs:Math.max(0,now()-Date.parse(run.startedAt||stamp)),status:'queued',simulation:copy(fact.simulation||{}),segmentId:'simulation:'+(meta.origin||id)+':'+(fact.kind||index)};
  });
  if(run.transcript.length+generated.length>MAX_CHUNKS||run.transcript.reduce((n,x)=>n+x.text.length,0)+generated.reduce((n,x)=>n+x.text.length,0)>MAX_TEXT)throw Error('O limite da transcrição foi atingido.');
  return generated;
 }
 function appendFacts(facts,meta={}){
  if(closed||halted)throw Error('A entrada desta reunião já foi encerrada.');
  const generated=prepareFacts(facts,meta);run.transcript.push(...generated);queue.push(...generated);notify({phase:'received'});queueMicrotask(drain);return true;
 }
 return {run,append,appendFacts,done,close(){closed=true;nextSpeech?.();notify({phase:'closing'});finish();return done;},stop, get accepting(){return !closed&&!halted;},get pending(){return queue.length+(busy?1:0);}};
}
function restore(saved){
 const run=copy(saved);
 if(!run||run.liveSchemaVersion!==1||!['official','local'].includes(run.provider)||!Array.isArray(run.records)||!Array.isArray(run.transcript)||!Array.isArray(run.batch?.cases)||run.records.length!==run.batch.cases.length||run.transcript.length>MAX_CHUNKS||run.records.length>MAX_CHUNKS)throw Error('Reunião salva inválida.');
 const sourceIds=new Set();let sourceLength=0;
 for(const entry of run.transcript){if(!entry||typeof entry.id!=='string'||sourceIds.has(entry.id)||typeof entry.text!=='string'||!entry.text.trim())throw Error('Origem da transcrição inválida.');sourceIds.add(entry.id);sourceLength+=entry.text.length;E.validateState({current_utterance:entry.text});transcriptMeta(entry);}
 if(sourceLength>MAX_TEXT)throw Error('A transcrição salva excede o limite da reunião.');
 run.questions=F.validateQuestions(run.questions);
 const recordIds=new Set();
 for(let i=0;i<run.records.length;i++){const r=run.records[i],item=run.batch.cases[i];if(!r||!item||typeof item.id!=='string'||r.id!==item.id||recordIds.has(r.id)||typeof item.current_utterance!=='string'||!item.current_utterance.trim()||!['done','error','interrupted','running','queued'].includes(r.status))throw Error('Origem da memória inválida.');recordIds.add(r.id);E.validateState({current_utterance:item.current_utterance});for(const stage of ['store','type']){const out=r[stage+'Output'];if(out){if(out.provider!==run.provider)throw Error('Provedor da memória inválido.');const request=F.request(item,stage,run.questions);E.validateOutput(out,{state:request.state,config:request});}}
  if(item.source_entry_ids!==undefined){
   const ids=item.source_entry_ids,positions=Array.isArray(ids)?ids.map(id=>run.transcript.findIndex(entry=>entry.id===id)):[];
   if(!Array.isArray(ids)||ids.length<2||ids.length>3||new Set(ids).size!==ids.length||positions.some((position,index)=>position<0||index&&position!==positions[index-1]+1))throw Error('Origem das janelas de fala inválida.');
   const sources=positions.map(position=>run.transcript[position]);
   if(sources.some((entry,index)=>entry.chunk_id!==item.id||!['microphone','import'].includes(entry.source)||index&&(entry.source!==sources[0].source||entry.speaker!==sources[0].speaker||entry.offsetMs<sources[index-1].offsetMs||entry.offsetMs-sources[index-1].offsetMs>9000))||sources.map(entry=>entry.text).join(' ')!==item.current_utterance)throw Error('Origem das janelas de fala não corresponde ao trecho classificado.');
  }
  if(r.status==='done'){if(!r.storeOutput)throw Error('Classificação de memória ausente.');const gate=r.storeOutput.response.answers.should_store_memory,store=E.predicted(gate);if(store&&!r.typeOutput)throw Error('Classificação do ponto ausente.');const answer=store?r.typeOutput.response.answers.event_type:null,type=store?E.predicted(answer):null;r.result={store,type,storeProbability:E.probabilityOf(gate,store),typeProbability:store?E.probabilityOf(answer,type):null,destination:store?type:'ignore'};}else if(['running','queued'].includes(r.status))r.status='interrupted';
 }
 Object.assign(run,F.memoryState(run));if(run.thread_worker){run.thread_worker=T.restore(run.thread_worker,run);T.syncMemory(run);}if(run.typed_relation_worker){run.typed_relation_worker=TR.restore(run.typed_relation_worker,run);TR.syncMemory(run);}
 if(['running','finishing'].includes(run.status))run.status='interrupted';for(const entry of run.transcript)if(['processing','queued'].includes(entry.status))entry.status='interrupted';applyTitles(run);return run;
}
return {create,restore,parseTranscript,parseTranscriptEntries,split,MAX_CHUNKS};
});
