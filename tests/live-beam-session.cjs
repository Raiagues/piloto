// Explicit opt-in: uses the configured private proxy and real API credits.
if(!process.argv.includes('--run-live')){console.log('Use --run-live para validar com a API configurada.');process.exit(0);}
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const Session=require('../meeting-session.js'),Commands=require('../beam-commands.js'),Engine=require('../beam-engine.js');
global.NorteBeamEngine=Engine;require('../meeting-beam.js');
const copy=x=>JSON.parse(JSON.stringify(x)),calls=[];
let state=Engine.defaultState(),version=1;
async function send(request,provider,lane){
 const endpoint=lane==='threads'?'/api/relations':lane==='relations'?'/api/typed-relations':'/api/classify';
 for(let attempt=0;attempt<200;attempt++){
  const r=await fetch('http://127.0.0.1:8000'+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':provider},body:JSON.stringify(request),signal:AbortSignal.timeout(35000)});
  if(r.status===429){await new Promise(resolve=>setTimeout(resolve,100));continue;}
  const result=await r.json();if(!r.ok)throw Error(result.error||'Proxy '+r.status);calls.push({lane,latencyMs:result.latencyMs});return result;
 }throw Error('Proxy ocupado por tempo excessivo.');
}
(async()=>{
 const session=Session.create({provider:'official',title:'Validação real · viga em balanço',send,commandHandler:async(text,{run,entry,send:transport,isActive})=>{
  const audit=await Commands.process(text,{state,run,transport,provider:'official',active:true,source:entry.source});
  if(!isActive()||!audit.consumed)return audit;
  if(audit.status==='proposed'){
   state=Engine.applyOperations(state,audit.operations).state;
   audit.status='applied';audit.memory=NorteMeetingBeam.facts({state,version:{id:'V'+String(++version).padStart(3,'0')}},entry.id);
  }
  (run.beam_commands||=[]).push(copy(audit));return audit;
 }});
 // Reproduce the reported ASR spelling through the real command → memory → relation flow.
 session.append('muda essa força pra 12 km',{source:'microphone',speaker:'Você',offsetMs:0,sourceText:'muda essa força pra 12 km'});
 const run=await session.close();run.beam_lab={state};
 const filename=path.resolve('.runtime/beam-live-session.json');await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,JSON.stringify({run,calls},null,2));
 const projected=require('../meeting-evidence.js').project(run);
 console.log(JSON.stringify({status:run.status,commands:run.beam_commands?.map(a=>({status:a.status,message:a.message,classifications:a.classifications})),events:run.meeting_events.map(e=>({id:e.event_id,type:e.type})),trusted:projected.run.meeting_events.length,relations:run.meeting_relations.map(r=>({type:r.relation_type,configuration:r.configuration_match})),calls:calls.length,state:{L:state.L,M:Engine.structuralResults(state).d.Mmax},report:filename},null,2));
 assert.equal(run.beam_commands?.[0]?.status,'applied');assert.equal(state.L,6);assert.equal(state.loads[0].value,12000);assert.equal(Engine.structuralResults(state).d.Mmax,72000);
 assert.equal(run.transcript[0].text,'muda essa força pra 12 km');assert.ok(run.beam_commands[0].normalizations.some(n=>n.kind==='asr_unit'));
 assert.ok(run.meeting_events.some(e=>e.type==='test_proposal'));assert.ok(run.meeting_events.some(e=>e.type==='test_result'));assert.ok(projected.run.meeting_events.length>=2,'computed facts must cross the same confidence gate as meeting speech');
 assert.ok(run.meeting_relations.some(r=>r.relation_type==='result_of'),'the normal pipeline must link the computed result to its test');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
