// Explicit opt-in: exercises the exact reported transcript against the local
// configured Jev proxy. No credentials are read or printed by this script.
if(!process.argv.includes('--run-live')){console.log('Use --run-live para validar a transcrição com a API configurada.');process.exit(0);}
const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const Session=require('../meeting-session.js'),Speech=require('../meeting-speech.js'),Evidence=require('../meeting-evidence.js');
const fixture=require('./fixtures/meeting-thickness-fragments.json'),calls=[];
async function send(request,provider,lane){
 const endpoint=lane==='threads'?'/api/relations':lane==='relations'?'/api/typed-relations':'/api/classify';
 for(let i=0;i<60;i++){
  const response=await fetch('http://127.0.0.1:8000'+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':provider},body:JSON.stringify(request),signal:AbortSignal.timeout(35000)});
  if(response.status===429){await new Promise(resolve=>setTimeout(resolve,250));continue;}
  const output=await response.json();if(!response.ok)throw Error(output.error||'HTTP '+response.status);
  calls.push({lane,questions:Object.keys(request.questions),latencyMs:output.latencyMs});return output;
 }throw Error('Proxy ocupado.');
}
(async()=>{
 const session=Session.create({send,title:fixture.title});
 for(const entry of fixture.transcript)for(const part of Speech.entries(entry,'import'))session.append(part.text,{...part,source:'import'});
 const run=await session.close(),projected=Evidence.project(run),events=projected.run.meeting_events;
 await fs.mkdir('.runtime',{recursive:true});await fs.writeFile('.runtime/meeting-thickness-live.json',JSON.stringify({run,calls,projected},null,2));
 const rows=events.map(event=>{const r=run.records.find(r=>r.id===event.chunk_id);return {type:event.type,text:event.text,store:r.result.storeProbability,typeConfidence:r.result.typeProbability,topic:event.thread_id};});
 console.log(JSON.stringify({status:run.status,calls:calls.length,retained:events.length,events:rows,excluded:projected.excluded.map(x=>({text:x.text,reason:x.reason_code,probabilities:x.probabilities})),report:'.runtime/meeting-thickness-live.json'},null,2));
 assert.equal(run.status,'done');
 assert.ok(events.some(e=>e.type==='hypothesis'&&/espessura/.test(e.text)),'thickness hypothesis must be retained');
 assert.ok(events.some(e=>e.type==='test_proposal'&&/10 mm para 9 mm/i.test(e.text)),'conversational 10→9 proposal must be retained');
 assert.ok(events.some(e=>e.type==='test_proposal'&&/de 10 para 15 MM/i.test(e.text)),'split 10→15 proposal must be retained');
 assert.ok(!events.some(e=>e.type==='test_result'&&/10.*15/.test(e.text)),'a proposal must not become a completed result');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
