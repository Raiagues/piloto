const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:sleep}=require('node:timers/promises');
const S=require('../meeting-session.js'),V=require('../memory-v2.js'),C=require('../meeting-commands.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function reply(req,choices){return {request:clone(req),provider:'official',latencyMs:1,response:{model:'fixture',answers:Object.fromEntries(Object.entries(req.questions).map(([id,q])=>{
 const value=typeof choices==='function'?choices(id,q):choices[id];
 return [id,q.type==='noul'?{type:'noul',noul:value? .97:.03}:{type:'choice',choice:value,confidence:.12,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===value?.97:.03/(Object.keys(q.criteria).length-1)]))}];
}))}};}
function fixture(req,provider,lane){
 assert.equal(provider,'official','every lane uses the provider string, including commands');
 assert.ok(!JSON.stringify(req).includes('expected_'),'meeting requests never contain fixture labels');
 const text=req.state.current_utterance||req.state.utterance||'';
 if(lane==='commands')return reply(req,{command_type:/^Norte/i.test(text)?/renomeie|título/.test(text)?'rename_topic':'other_command':'conversation'});
 if(lane==='chunks')return reply(req,req.questions.should_store_memory?{should_store_memory:!/^Ignorar/.test(text)}:{event_type:/^HIP/.test(text)?'hypothesis':/^TESTE/.test(text)?'test_proposal':/^RESULTADO/.test(text)?'test_result':'observation'});
 if(lane==='threads')return reply(req,()=> 'belongs');
 if(lane==='relations')return reply(req,(id)=>{
  if(id.startsWith('configuration_match'))return 'exact';
  const candidate=req.state.candidates.find(c=>c.event_id===id.split('__')[1]),current=req.state.current_event;
  return current.type==='test_result'&&candidate.type==='test_proposal'?'result_of':current.type==='test_proposal'&&candidate.type==='hypothesis'?'tests':current.type==='hypothesis'&&candidate.type==='observation'?'related_to':'none';
 });
 throw Error('Unknown lane '+lane);
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('simulation extension keeps commands separate and classifies computed facts even during import closure',async()=>{
 const seen=[],s=S.create({send:fixture,commandHandler:async(text,{entry})=>{
  seen.push(text);if(!/^Norte, simule/.test(text))return null;
  return {consumed:true,status:'applied',memory:[{kind:'proposal',text:'TESTE simulação SIM-1, viga de 6 m com 10 kN na ponta.',simulation:{version_id:'V1',kind:'test_proposal'}},{kind:'result',text:'RESULTADO simulação SIM-1, viga de 6 m com 10 kN na ponta: 60 kNm.',simulation:{version_id:'V1',kind:'test_result'}}]};
 }});
 s.append('Norte, simule a viga.');s.append('HIP mudar a altura reduz a tensão.');
 const run=await s.close();assert.equal(run.status,'done');assert.equal(run.records.length,3);assert.deepEqual(run.meeting_events.map(e=>e.type),['test_proposal','test_result','hypothesis']);
 assert.equal(seen.length,2,'computed output must never become another operational command');
 assert.equal(run.transcript.filter(e=>e.source==='simulation').length,2);assert.equal(new Set(run.transcript.map(e=>e.id)).size,4);
 assert.equal(run.transcript.find(e=>e.simulation?.kind==='test_result').simulation.version_id,'V1');assert.equal(S.restore(run).meeting_events.length,3);
 assert.deepEqual(run.transcript.map(e=>e.source),['text','simulation','simulation','text'],'computed results appear beside their command even when later imported speech is already queued');
 assert.equal(run.transcript[0].command.memory_enqueued,true);
});
test('a simulation command does not wait for unrelated topic classification while a rename still does',async()=>{
 const gate=deferred();let topicWaiting=false,simulationRouted=false;
 const session=S.create({send:async(req,provider,lane)=>{
  if(lane==='threads'&&!topicWaiting){topicWaiting=true;await gate.promise;}
  return fixture(req,provider,lane);
 },commandHandler:async text=>{
  if(text==='Norte, simule a viga.'){simulationRouted=true;return {consumed:true,status:'applied'};}
  return null;
 }});
 session.append('O suporte deforma.');session.append('HIP a rigidez explica a deformação.');
 await until(()=>topicWaiting);
 session.append('Norte, simule a viga.');
 try{
  await until(()=>simulationRouted);
  assert.equal(session.run.transcript[2].status,'command');
  session.append('Norte, renomeie o assunto 1 para Rigidez');
  await until(()=>session.run.transcript[3].status==='processing');
  assert.equal(session.run.topic_titles.T001,undefined,'rename still needs settled topic identities');
 }finally{gate.resolve();}
 const run=await session.close();assert.equal(run.status,'done');assert.equal(run.topic_titles.T001,'Rigidez');
 assert.equal(run.records.length,2);assert.ok(run.transcript.slice(2).every(entry=>entry.status==='command'));
});
test('command extensions receive every capture source and original timing after a classification backlog',async()=>{
 let clock=Date.parse('2026-10-07T12:00:00Z');const routed=[];
 const session=S.create({now:()=>clock,send:fixture,commandHandler:async(text,{sourceEntries})=>{
  routed.push({text,sources:clone(sourceEntries),routedAt:clock});
  sourceEntries[0].text='Do not mutate the raw recording.';
  return {consumed:true,status:'applied'};
 }});
 const first='Beleza eu quero reduzir de',second='para 5 metros';
 session.append(first,{source:'microphone',speaker:'Você',offsetMs:63000,sourceId:'capture-63'});
 clock+=5000;session.append(second,{source:'microphone',speaker:'Você',offsetMs:68000,sourceId:'capture-68'});
 clock+=90000;
 const run=await session.close();assert.equal(routed.length,1);assert.equal(routed[0].text,first+' '+second);
 assert.deepEqual(routed[0].sources.map(entry=>entry.offsetMs),[63000,68000]);
 assert.deepEqual(routed[0].sources.map(entry=>entry.sourceId),['capture-63','capture-68']);
 assert.deepEqual(routed[0].sources.map(entry=>entry.receivedAt),['2026-10-07T12:00:00.000Z','2026-10-07T12:00:05.000Z']);
 assert.ok(routed[0].sources.every(entry=>Date.parse(entry.receivedAt)<routed[0].routedAt));
 assert.deepEqual(run.transcript.map(entry=>entry.text),[first,second]);assert.equal(run.records.length,0);
 assert.ok(run.transcript.every(entry=>entry.status==='command'));
});
test('an unfinished beam length command never absorbs a subsequent force instruction',async()=>{
 const routed=[],session=S.create({send:fixture,commandHandler:async text=>{routed.push(text);return {consumed:true,status:'awaiting_continuation'};}});
 const texts=['eu quero reduzir o tamanho da viga de 5 m para','eu quero reduzir a força P1 de 10 Kg','é 5 Kilo newtons'];
 texts.forEach((text,index)=>session.append(text,{source:'microphone',speaker:'Você',offsetMs:73000+index*5000}));
 const run=await session.close();assert.deepEqual(routed,texts);assert.deepEqual(run.transcript.map(entry=>entry.text),texts);
 assert.ok(run.transcript.every(entry=>entry.status==='command'));assert.equal(run.records.length,0);
});
test('manual simulation registration is atomic and retains version provenance',async()=>{
 const s=S.create({send:fixture});
 assert.throws(()=>s.appendFacts([{text:'TESTE válido.'},{text:''}]),/vazio/);assert.equal(s.run.transcript.length,0);
 s.appendFacts([{kind:'proposal',text:'TESTE simulação manual.',simulation:{version_id:'V003',state:{L:4}}},{kind:'result',text:'RESULTADO simulação manual: 40 kNm.',simulation:{version_id:'V003',state:{L:4}}}]);
 const run=await s.close();assert.equal(run.status,'done');assert.equal(run.transcript.length,2);assert.ok(run.transcript.every(e=>e.source==='simulation'&&e.speaker==='Simulação'&&e.simulation.version_id==='V003'));
 assert.deepEqual(S.restore(run).transcript.map(e=>e.simulation),run.transcript.map(e=>e.simulation));assert.throws(()=>s.appendFacts([{text:'Depois de encerrar.'}]),/encerrada/);
});
test('cancelling a simulation command prevents a late proposal and computed facts from entering memory',async()=>{
 const gate=deferred();let entered=false,alive;
 const s=S.create({send:fixture,commandHandler:async(text,{isActive})=>{entered=true;await gate.promise;alive=isActive();return {consumed:true,status:'proposed',memory:[{kind:'result',text:'RESULTADO tardio.'}]};}});
 s.append('Norte, simule a viga.');await until(()=>entered);s.stop();gate.resolve();const run=await s.done;
 assert.equal(alive,false);assert.equal(run.records.length,0);assert.equal(run.transcript.length,1);assert.equal(run.transcript[0].status,'interrupted');
});
async function until(check){for(let i=0;i<1000;i++){if(check())return;await sleep(2);}throw Error('Timed out');}
test('TXT and JSON retain decimals, abbreviations and source text without importing labels',()=>{
 assert.deepEqual(S.parseTranscript('O suporte tem 3.5 mm. O Dr. João pediu outro teste. Temperatura: 24,5 °C.'),['O suporte tem 3.5 mm.','O Dr. João pediu outro teste.','Temperatura: 24,5 °C.']);
 assert.deepEqual(S.parseTranscript(JSON.stringify({cases:[{id:'A',current_utterance:'Massa 2.5 kg.',expected_event_type:'fake',expected_store_memory:true},{id:'B',current_utterance:'Outro teste.'}]}),'cases.json'),['Massa 2.5 kg.','Outro teste.']);
 assert.deepEqual(S.parseTranscript(JSON.stringify({segments:[{text:'Parcial',status:'interim'},{text:'Final.',status:'final'},'Texto direto.']}),'test.json'),['Final.','Texto direto.']);
 assert.deepEqual(S.parseTranscript('{"transcript":"Texto final."}','test.json'),['Texto final.']);
 assert.deepEqual(S.parseTranscript('\uFEFF{"fullText":"Amostra 3.5 mm."}','test.json'),['Amostra 3.5 mm.']);
 for(const input of ['null','[null]','{"segments":[42]}','{"segments":[{}]}'])assert.throws(()=>S.parseTranscript(input,'bad.json'),/JSON|trecho/);
 const command='Norte, renomeie o assunto 1 para '+Array(130).fill('Título').join(' ');assert.deepEqual(S.split(command),[command]);
});
test('SRT and VTT remove timestamps, IDs and metadata while retaining spoken numeric lines',()=>{
 const srt='1\r\n00:00:01,000 --> 00:00:04,000\r\nO suporte mede 3.5 mm.\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n10\r\n';
 assert.deepEqual(S.parseTranscript(srt,'meeting.srt'),['O suporte mede 3.5 mm.','10']);
 const vtt='WEBVTT\nKind: captions\nLanguage: pt\n\nNOTE anotação privada\nNão é uma fala.\n\nSTYLE\n::cue { color: red; }\n\ncue-alpha\n00:01.000 --> 00:02.000 align:start\n<v João>Sensor &amp; suporte 4.5 mm.</v>\n\ncue-beta\n00:02.000 --> 00:03.000\nNorte, renomeie o assunto 1 para Testes\n';
 assert.deepEqual(S.parseTranscript(vtt,'meeting.vtt'),['Sensor & suporte 4.5 mm.','Norte, renomeie o assunto 1 para Testes']);
 assert.throws(()=>S.parseTranscript('WEBVTT\n\nNOTE só metadados','meeting.vtt'),/Não há falas/);
});
test('stream accepts and drains more than 100 chunks without dropping source, memory or worker jobs',async()=>{
 const sent=[],s=S.create({send:async(...args)=>{sent.push(clone(args));return fixture(...args);}});
 const utterances=Array.from({length:125},(_,i)=>'Medida '+(i+1)+'.');for(const text of utterances)s.append(text);
 assert.equal(s.run.transcript.length,125);assert.ok(s.pending>100);
 const r=await s.close();assert.equal(r.status,'done',r.error);assert.equal(r.records.length,125);assert.equal(r.meeting_events.length,125);
 assert.deepEqual(r.batch.cases.map(c=>c.current_utterance),utterances);assert.deepEqual(r.meeting_events.map(e=>e.text),utterances);
 assert.equal(r.thread_worker.jobs.length,125);assert.equal(r.typed_relation_worker.jobs.length,125);assert.equal(r.thread_worker.status,'done');assert.equal(r.typed_relation_worker.status,'done');
 assert.equal(r.meeting_commands.length,125);assert.equal(r.calls,250);assert.equal(r.raw_window.length,15);assert.ok(r.transcript.every(t=>t.status==='done'));
 assert.deepEqual(r.questions,V.questions);assert.equal(r.thread_worker.schemaVersion,5);assert.equal(r.typed_relation_worker.schemaVersion,3);assert.ok(!JSON.stringify(r.batch).includes('expected_'));
 assert.ok(sent.some(([, ,lane])=>lane==='relations'));assert.equal(s.accepting,false);assert.throws(()=>s.append('Depois de encerrar.'),/encerrada/);
 const restored=S.restore(r);assert.equal(restored.meeting_events.length,125);assert.deepEqual(restored.meeting_events,r.meeting_events);
});
test('close waits for pending thread and relation calls and retains nested semantic edges',async()=>{
 const threadGate=deferred(),relationGate=deferred();let threadStarted=false,relationStarted=false,complete=false;
 const s=S.create({send:async(req,provider,lane)=>{if(lane==='threads'&&!threadStarted){threadStarted=true;await threadGate.promise;}if(lane==='relations'&&!relationStarted){relationStarted=true;await relationGate.promise;}return fixture(req,provider,lane);}});
 for(const text of ['O suporte deforma.','HIP a espessura é a causa.','TESTE vamos testar 4 mm.','RESULTADO 4 mm excedeu o limite.'])s.append(text);
 const closing=s.close().then(r=>{complete=true;return r;});await until(()=>threadStarted);assert.equal(complete,false);assert.equal(s.run.status,'running');threadGate.resolve();await until(()=>relationStarted);assert.equal(complete,false);relationGate.resolve();
 const r=await closing;assert.equal(r.status,'done');assert.equal(r.meeting_relations.length,3);assert.deepEqual(new Set(r.meeting_relations.map(e=>e.relation_type)),new Set(['related_to','tests','result_of']));
 assert.deepEqual(S.restore(r).meeting_relations,r.meeting_relations);
});
test('commands wait for topics, stay outside memories, and renamed titles survive later worker synchronization and restore',async()=>{
 const s=S.create({send:async(...args)=>fixture(...args)});
 for(const text of ['O suporte deforma.','Norte, mude o título da thread 1 para Deformação do suporte','HIP a espessura é a causa.','TESTE vamos testar 4 mm.','Norte, corrija o resultado.','RESULTADO o suporte excedeu o limite.'])s.append(text);
 const r=await s.close();assert.equal(r.status,'done');assert.equal(r.records.length,4);assert.equal(r.meeting_events.length,4);assert.equal(r.transcript.filter(e=>e.status==='command').length,2);
 assert.ok(r.meeting_events.every(e=>!e.text.startsWith('Norte')));assert.equal(r.meeting_threads[0].title,'Deformação do suporte');assert.equal(r.topic_titles.T001,'Deformação do suporte');
 assert.equal(r.meeting_commands.find(c=>c.renamed).chunk_id,'S0002');assert.equal(r.meeting_commands.at(-2).status,'unsupported');
 const restored=S.restore(r);assert.equal(restored.meeting_threads[0].title,'Deformação do suporte');assert.deepEqual(restored.meeting_commands,r.meeting_commands);assert.deepEqual(restored.records.map(x=>x.result),r.records.map(x=>x.result));
});
test('command service failure is visible and never becomes project memory; next conversation still works',async()=>{
 const s=S.create({send:async(req,provider,lane)=>{if(lane==='commands'&&req.state.utterance.startsWith('Norte'))throw Error('Temporary failure');return fixture(req,provider,lane);}});
 for(const text of ['O suporte deforma.','Norte, renomeie o assunto 1 para Outro título','TESTE vamos testar 4 mm.'])s.append(text);
 const r=await s.close();assert.equal(r.records.length,2);assert.equal(r.meeting_commands[1].status,'classification_error');assert.equal(r.meeting_commands[1].consumed,true);assert.equal(r.topic_titles.T001,undefined);assert.ok(!r.meeting_events.some(e=>e.text.startsWith('Norte')));
});
test('fatal command error preserves queued transcript without sending it to the memory classifier',async()=>{
 const lanes=[],s=S.create({send:async(req,provider,lane)=>{lanes.push(lane);throw Object.assign(Error('Unavailable'),{stopBatch:true});}});
 s.append('Norte, renomeie o assunto 1 para Outro título');s.append('O suporte deforma.');
 const r=await s.close();assert.equal(r.status,'interrupted');assert.equal(r.records.length,0);assert.equal(r.meeting_events.length,0);assert.deepEqual(lanes,['commands']);assert.ok(r.transcript.every(e=>e.status==='interrupted'));assert.equal(r.error,'Unavailable');
 assert.equal(S.restore(r).status,'interrupted');
});
test('stop discards an in-flight command response and cannot rename after the meeting was stopped',async()=>{
 const gate=deferred();let waiting=false;const s=S.create({send:async(req,provider,lane)=>{if(lane==='commands'&&req.state.utterance.startsWith('Norte')){waiting=true;await gate.promise;}return fixture(req,provider,lane);}});
 s.append('O suporte deforma.');s.append('Norte, renomeie o assunto 1 para Não aplicar');await until(()=>waiting);s.stop();gate.resolve();const r=await s.done;
 assert.equal(r.status,'interrupted');assert.equal(r.topic_titles.T001,undefined);assert.equal(r.meeting_commands.at(-1).renamed,false);assert.equal(r.records.length,1);
});
test('failed type classification leaves no partial memory and a later successful chunk retains correct IDs',async()=>{
 const s=S.create({send:async(req,provider,lane)=>{if(lane==='chunks'&&req.questions.event_type&&req.state.current_utterance==='Fala com falha.')throw Error('Type service unavailable');return fixture(req,provider,lane);}});
 s.append('Fala com falha.');s.append('O suporte deforma.');const r=await s.close();assert.equal(r.status,'interrupted');assert.equal(r.records[0].status,'error');assert.equal(r.meeting_events.length,1);assert.equal(r.meeting_events[0].event_id,'E001');assert.equal(r.meeting_events[0].chunk_id,'C0002');
 assert.deepEqual(S.restore(r).meeting_events,r.meeting_events);
});
test('wrong-provider response stops processing before creating or mutating meeting memory',async()=>{
 const s=S.create({send:async(...args)=>({...fixture(...args),provider:'local'})});s.append('O suporte deforma.');const r=await s.close();assert.equal(r.status,'interrupted');assert.equal(r.meeting_events.length,0);assert.equal(r.records.length,0);
});
test('explicit timestamp and speaker prefixes are removed only for command routing, while original transcript is retained',async()=>{
 const s=S.create({send:async(...args)=>fixture(...args)}),source='[00:12] João: Norte, mude o título da thread 1 para Deformação';
 s.append('O suporte deforma.');s.append(source);s.append('00:15 Maria: Norte, renomeie o assunto 1 para Ensaios de deformação');
 const r=await s.close();assert.equal(r.topic_titles.T001,'Ensaios de deformação');assert.equal(r.transcript[1].text,source);assert.equal(r.records.length,1);assert.equal(r.meeting_commands[1].text,'Norte, mude o título da thread 1 para Deformação');
 assert.deepEqual(S.parseTranscript(source),[source]);
});
test('restoring an in-flight snapshot preserves source and completed evidence without resuming classification',async()=>{
 const gate=deferred();let entered=false,calls=0;const s=S.create({send:async(req,provider,lane)=>{calls++;if(lane==='chunks'){entered=true;await gate.promise;}return fixture(req,provider,lane);}});
 s.append('O suporte deforma.');s.append('O sensor aquece.');await until(()=>entered);const saved=clone(s.run),before=calls,restored=S.restore(saved);
 assert.equal(restored.status,'interrupted');assert.equal(restored.records[0].status,'interrupted');assert.ok(restored.transcript.every(t=>t.status==='interrupted'));assert.equal(restored.meeting_events.length,0);assert.equal(calls,before);assert.equal(saved.status,'running');
 s.stop();gate.resolve();await s.done;
});
test('restore rebuilds memory from verified outputs and rejects mismatched or duplicate source records',async()=>{
 const s=S.create({send:async(...args)=>fixture(...args)});s.append('O suporte deforma.');s.append('Ignorar comentário social.');const saved=await s.close();
 const forged=clone(saved);forged.meeting_events[0].text='Forged projection';forged.meeting_events.push({event_id:'E999',text:'Invented'});assert.deepEqual(S.restore(forged).meeting_events,saved.meeting_events);
 for(const mutate of [
  r=>r.batch.cases[0].current_utterance='Different source',
  r=>r.records[1].id=r.records[0].id,
  r=>r.transcript[1].id=r.transcript[0].id,
  r=>r.records[0].storeOutput.provider='local',
  r=>delete r.records[0].storeOutput
 ]){const bad=clone(saved);mutate(bad);assert.throws(()=>S.restore(bad));}
});

test('structured TXT entries retain complete turns and remove only explicit timestamp and speaker metadata',()=>{
 const source='[00:00:10] Ana Costa: O suporte tem 3.5 mm. O Dr. João pediu outro teste.\n[02:15,250] Temperatura 24,5 °C.\n09:01:02 Bruno: Vamos verificar o sensor.\nTemperatura: 24,5 °C.';
 const entries=S.parseTranscriptEntries(source);
 assert.equal(entries.length,4);
 assert.deepEqual(entries[0],{text:'O suporte tem 3.5 mm. O Dr. João pediu outro teste.',sourceText:source.split('\n')[0],offsetMs:10000,speaker:'Ana Costa',segmentId:'line-0001'});
 assert.equal(entries[1].offsetMs,135250);assert.equal(entries[1].speaker,undefined);
 assert.equal(entries[2].offsetMs,32462000);assert.equal(entries[2].speaker,'Bruno');assert.equal(entries[2].text,'Vamos verificar o sensor.');
 assert.equal(entries[3].text,'Temperatura: 24,5 °C.');assert.equal(entries[3].speaker,undefined);assert.equal(entries[3].offsetMs,undefined);
 assert.equal(S.parseTranscriptEntries('(00:12) João: Norte, renomeie o assunto 1 para Testes')[0].text,'Norte, renomeie o assunto 1 para Testes');
 for(const source of ['[00:60] Uma fala.','[01:60:00] Uma fala.','00:00:61 Uma fala.','[00:01.1234] Uma fala.','[00:01]'])assert.throws(()=>S.parseTranscriptEntries(source),/Horário|horário/);
 assert.equal(S.parseTranscriptEntries('[25:00:00] Reunião longa.')[0].offsetMs,90000000,'elapsed source time can exceed one calendar day');
});

test('structured captions preserve cue timing, original source and voice while keeping a whole cue together',()=>{
 const srt='cue-one\n00:00:01,125 --> 00:00:04,000\nO suporte mede 3.5 mm.\nO teste ainda está pendente.\n\n2\n00:00:04,000 --> 00:00:05,000\n10';
 const entries=S.parseTranscriptEntries(srt,'meeting.srt');
 assert.equal(entries.length,2);assert.equal(entries[0].offsetMs,1125);assert.equal(entries[0].text,'O suporte mede 3.5 mm. O teste ainda está pendente.');assert.equal(entries[0].sourceText,srt.split('\n\n')[0]);assert.equal(entries[0].sourceId,'cue-one');assert.equal(entries[1].text,'10');
 const vtt='WEBVTT\n\nNOTE não é fala\nAnotação.\n\nalpha\n00:01.250 --> 00:03.000 align:start\n<v Ana &amp; Bruno>Sensor &amp; suporte 4.5 mm. Precisamos verificar.</v>';
 const entry=S.parseTranscriptEntries(vtt,'meeting.vtt')[0];
 assert.equal(entry.offsetMs,1250);assert.equal(entry.speaker,'Ana & Bruno');assert.equal(entry.segmentId,'alpha');assert.equal(entry.text,'Sensor & suporte 4.5 mm. Precisamos verificar.');assert.match(entry.sourceText,/<v Ana/);
 assert.throws(()=>S.parseTranscriptEntries('1\n00:00:60,000 --> 00:01:01,000\nTexto','invalid.srt'),/Horário/);
 assert.throws(()=>S.parseTranscriptEntries('1\n00:01:00,000 --> 00:00:01,000\nTexto','invalid.srt'),/precede/);
});

test('structured JSON prefers original ledger records and imports only source metadata without fixture labels',()=>{
 const records=[{id:'run-1:0',text:'O suporte tem 3.5 mm. Vamos testar.',startMs:1234.5,speaker:'João',status:'final',expected_event_type:'hypothesis'},{id:'run-1:1',text:'Texto parcial.',startMs:5000,status:'interim'}];
 const entries=S.parseTranscriptEntries(JSON.stringify({records,segments:[{text:'Este segmento duplicaria a origem.',status:'final'}]}),'ledger.json');
 assert.equal(entries.length,1);assert.deepEqual(entries[0],{text:records[0].text,sourceText:records[0].text,offsetMs:1234.5,speaker:'João',sourceId:'run-1:0',segmentId:'run-1:0'});
 assert.ok(!JSON.stringify(entries).includes('expected_'));
 assert.equal(S.parseTranscriptEntries(JSON.stringify({cases:[{id:4,current_utterance:'[00:10] Ana: Fala única. Outra frase.',expected_store_memory:false}]}),'cases.json')[0].sourceId,'4');
 for(const value of [-1,Number.MAX_SAFE_INTEGER+1,'1200'])assert.throws(()=>S.parseTranscriptEntries(JSON.stringify([{text:'Fala.',offsetMs:value}]),'bad.json'),/milissegundos/);
 assert.throws(()=>S.parseTranscriptEntries(JSON.stringify([{text:'Fala.',speaker:42}]),'bad.json'),/speaker/);
});

test('append retains source timestamps and speakers separately from arrival time and all model inputs',async()=>{
 const sources=S.parseTranscriptEntries('[00:05] Ana: O suporte deforma. Precisamos medir 3.5 mm.\n[00:20] Bruno: Norte, mude o título da thread 1 para Deformação');
 const sent=[],clock=Date.parse('2026-10-07T12:00:00Z'),s=S.create({now:()=>clock,send:async(...args)=>{sent.push(clone(args));return fixture(...args);}});
 for(const entry of sources)s.append(entry.text,{source:'import',...entry,expected_event_type:'fake'});
 const run=await s.close();
 assert.equal(run.transcript.length,2);assert.equal(run.records.length,1);assert.equal(run.topic_titles.T001,'Deformação');
 assert.equal(run.transcript[0].text,sources[0].text);assert.equal(run.transcript[0].sourceText,sources[0].sourceText);assert.equal(run.transcript[0].speaker,'Ana');assert.equal(run.transcript[0].offsetMs,5000);assert.equal(run.records[0].receivedOffsetMs,5000);assert.equal(run.transcript[0].receivedAt,'2026-10-07T12:00:00.000Z');
 assert.equal(run.transcript[1].offsetMs,20000);assert.equal(run.transcript[1].status,'command');
 for(const [request] of sent){const serialized=JSON.stringify(request.state);assert.ok(!serialized.includes('[00:05]'));assert.ok(!serialized.includes('[00:20]'));assert.ok(!serialized.includes('"speaker"'));assert.ok(!serialized.includes('expected_event_type'));}
 assert.deepEqual(S.restore(run).transcript,run.transcript);
 for(const mutate of [r=>r.transcript[0].offsetMs=-1,r=>r.transcript[0].speaker={},r=>r.transcript[0].segmentId='a'.repeat(257),r=>r.transcript[0].sourceText=42]){const bad=clone(run);mutate(bad);assert.throws(()=>S.restore(bad));}
});

test('optional source metadata accepts absent values but rejects invalid values before queueing',async()=>{
 const s=S.create({send:async(...args)=>fixture(...args)});
 for(const meta of [{offsetMs:NaN},{offsetMs:Infinity},{offsetMs:-.1},{offsetMs:'12'},{speaker:5},{sourceText:''},{sourceId:'a'.repeat(257)},{segmentId:[]}])assert.throws(()=>s.append('O suporte deforma.',meta));
 assert.equal(s.run.transcript.length,0);
 s.append('O suporte deforma.',{offsetMs:undefined,speaker:undefined,sourceText:undefined,sourceId:undefined,segmentId:undefined});
 const run=await s.close();assert.equal(run.transcript.length,1);assert.equal(run.transcript[0].speaker,undefined);assert.equal(S.restore(run).transcript.length,1);
});

test('cancellation settles every worker without waiting for an outstanding transport and ignores its late result',async()=>{
 for(const blockedLane of ['commands','chunks','threads','relations']){
  const gate=deferred();let entered=false;
  const session=S.create({send:async(req,provider,lane)=>{
   if(lane===blockedLane&&!entered){entered=true;await gate.promise;}
   return fixture(req,provider,lane);
  }});
  for(const text of ['O suporte deforma.','HIP a rigidez explica a deformação.','TESTE testar o suporte.'])session.append(text);
  await until(()=>entered);session.stop();
  const result=await Promise.race([session.done,sleep(300).then(()=>null)]);
  if(!result){gate.resolve();await session.done;assert.fail(blockedLane+' cancellation waited for the remote response');}
  assert.equal(result.status,'interrupted',blockedLane);assert.equal(session.accepting,false);assert.equal(session.pending,0);assert.ok(result.transcript.every(entry=>!['processing','queued'].includes(entry.status)),blockedLane);
  const before=JSON.stringify(result);gate.resolve();await sleep(10);assert.equal(JSON.stringify(result),before,blockedLane+' mutated after cancellation');assert.doesNotThrow(()=>S.restore(result),blockedLane);
 }
});

test('a seeded session appends through the normal workers without replaying or mutating completed evidence',async()=>{
 const original=S.create({send:async(...args)=>fixture(...args)});
 for(const text of ['O suporte deforma.','HIP a rigidez explica a deformação.','TESTE testar o suporte.'])original.append(text);
 const seed=await original.close(),before=clone(seed),calls=[];
 const session=S.create({seed,provider:'official',send:async(...args)=>{calls.push(clone(args));return fixture(...args);}});
 session.append('RESULTADO o ensaio excedeu o limite.',{source:'review',sourceId:'C0003',sourceText:'TESTE testar o suporte.'});
 const result=await session.close();assert.equal(result.id,seed.id);assert.equal(result.startedAt,seed.startedAt);assert.deepEqual(seed,before);
 assert.deepEqual(result.records.slice(0,3),seed.records);assert.deepEqual(result.transcript.slice(0,3),seed.transcript);assert.deepEqual(result.thread_worker.jobs.slice(0,3),seed.thread_worker.jobs);assert.deepEqual(result.typed_relation_worker.jobs.slice(0,3),seed.typed_relation_worker.jobs);
 assert.equal(result.records.length,4);assert.equal(result.transcript.at(-1).id,'S0004');assert.equal(result.meeting_events.at(-1).event_id,'E004');assert.equal(result.meeting_events.at(-1).thread_id,'T001');
 assert.equal(calls.filter(([, ,lane])=>lane==='chunks').length,2);assert.ok(calls.filter(([, ,lane])=>lane==='chunks').every(([req])=>req.state.current_utterance.startsWith('RESULTADO')));assert.ok(calls.filter(([, ,lane])=>['threads','relations'].includes(lane)).every(([req])=>req.state.current_event.event_id==='E004'));
 assert.ok(result.meeting_relations.some(edge=>edge.source_event_id==='E004'&&edge.target_event_id==='E003'&&edge.relation_type==='result_of'));assert.deepEqual(S.restore(result).meeting_events,result.meeting_events);assert.deepEqual(S.restore(result).meeting_relations,result.meeting_relations);
});

test('opening and closing a seeded session never resends old transcript or previous worker jobs',async()=>{
 const original=S.create({send:async(...args)=>fixture(...args)});original.append('O suporte deforma.');original.append('HIP a carga explica.');const seed=await original.close();let calls=0;
 const resumed=S.create({seed,provider:'official',send:async()=>{calls++;throw Error('Old work was replayed');}}),result=await resumed.close();assert.equal(calls,0);assert.deepEqual(result.transcript,seed.transcript);assert.deepEqual(result.records,seed.records);assert.deepEqual(result.meeting_events,seed.meeting_events);assert.deepEqual(result.meeting_relations,seed.meeting_relations);assert.doesNotThrow(()=>S.restore(result));assert.throws(()=>S.create({seed,provider:'local',send:async()=>{}}),/mesmo provedor/);
});

test('seeded recovery preserves interrupted source entries and processes only the new clarification',async()=>{
 const gate=deferred();let entered=false;const original=S.create({send:async(req,provider,lane)=>{if(lane==='chunks'){entered=true;await gate.promise;}return fixture(req,provider,lane);}});
 original.append('A fala interrompida.');original.append('Outra fala que não foi processada.');await until(()=>entered);original.stop();const seed=await original.done;gate.resolve();await sleep(5);const before=clone(seed),calls=[];
 const recovery=S.create({seed,provider:'official',send:async(...args)=>{calls.push(clone(args));return fixture(...args);}});recovery.append('O suporte deforma sob 20 N.',{source:'review',sourceId:'S0002',sourceText:'Outra fala que não foi processada.'});const result=await recovery.close();
 assert.deepEqual(seed,before);assert.deepEqual(result.transcript.slice(0,2),seed.transcript);assert.deepEqual(result.records.slice(0,1),seed.records);assert.equal(result.records.length,2);assert.equal(result.meeting_events.length,1);assert.equal(result.meeting_events[0].chunk_id,'C0002');assert.ok(calls.every(([req])=>!(req.state.current_utterance||'').includes('A fala interrompida')));assert.doesNotThrow(()=>S.restore(result));
});

test('short capture windows keep their timestamps while an unfinished numeric proposal becomes one classified record',async()=>{
 const calls=[],session=S.create({send:async(...args)=>{calls.push(clone(args));return fixture(...args);}});
 const first='Beleza então vamos tentar fazer a espessura então de 10',second='para 15 MM';
 session.append(first,{source:'microphone',speaker:'Ana',offsetMs:52000,sourceId:'capture-10',segmentId:'window-10',sourceText:first});
 await until(()=>session.run.transcript[0].status==='processing');
 assert.equal(session.run.records.length,0,'an unfinished value waits for its adjacent capture window');
 assert.equal(calls.length,0);
 session.append(second,{source:'microphone',speaker:'Ana',offsetMs:57000,sourceId:'capture-11',segmentId:'window-11',sourceText:second});
 const run=await session.close(),restored=S.restore(run);
 assert.equal(run.status,'done');assert.equal(run.transcript.length,2);assert.equal(run.records.length,1);
 assert.deepEqual(run.transcript.map(entry=>entry.text),[first,second]);assert.deepEqual(run.transcript.map(entry=>entry.offsetMs),[52000,57000]);
 assert.deepEqual(run.transcript.map(entry=>entry.sourceId),['capture-10','capture-11']);assert.deepEqual(run.transcript.map(entry=>entry.segmentId),['window-10','window-11']);
 assert.ok(run.transcript.every(entry=>entry.status==='done'&&entry.chunk_id==='C0001'));
 assert.equal(run.batch.cases[0].current_utterance,first+' '+second);assert.deepEqual(run.batch.cases[0].source_entry_ids,['S0001','S0002']);
 assert.deepEqual(calls.filter(([, ,lane])=>lane==='chunks').map(([request])=>request.state.current_utterance),[first+' '+second,first+' '+second]);
 assert.equal(run.meeting_events[0].text,first+' '+second);assert.equal(run.meeting_events[0].chunk_id,'C0001');
 assert.deepEqual(restored.batch.cases[0].source_entry_ids,['S0001','S0002']);assert.deepEqual(restored.transcript,run.transcript);assert.deepEqual(restored.meeting_events,run.meeting_events);
});

test('semantic grouping never crosses a speaker, long gap, source boundary or explicit new intent',async()=>{
 const first='Vamos tentar fazer a espessura de 10';
 for(const variant of [
  {name:'speaker',text:'para 15 MM',meta:{speaker:'Bruno',offsetMs:5000}},
  {name:'gap',text:'para 15 MM',meta:{speaker:'Ana',offsetMs:14000}},
  {name:'source',text:'para 15 MM',meta:{speaker:'Ana',offsetMs:5000,source:'import'}},
  {name:'new intent',text:'Ah não eu acho que precisamos aumentar a espessura.',meta:{speaker:'Ana',offsetMs:5000}},
  {name:'command',text:'Norte, mostre os gráficos.',meta:{speaker:'Ana',offsetMs:5000}}
 ]){
  const session=S.create({send:fixture});
  session.append(first,{source:'microphone',speaker:'Ana',offsetMs:0});session.append(variant.text,{source:'microphone',...variant.meta});
  const run=await session.close();assert.equal(run.batch.cases[0].current_utterance,first,variant.name);
  assert.equal(run.batch.cases.some(item=>item.source_entry_ids?.length),false,variant.name);
  assert.deepEqual(run.transcript.map(entry=>entry.text),[first,variant.text],variant.name);
  if(variant.name==='command'){assert.equal(run.records.length,1);assert.equal(run.transcript[1].status,'command');}
  else {assert.equal(run.records.length,2,variant.name);assert.equal(run.batch.cases[1].current_utterance,variant.text,variant.name);}
 }
});

test('closing a pending unfinished window flushes exactly its spoken text without waiting for a fabricated continuation',async()=>{
 const session=S.create({send:fixture}),text='Ela estava mostrando uma tensão máxima de';
 session.append(text,{source:'microphone',speaker:'Ana',offsetMs:11000});await until(()=>session.run.transcript[0].status==='processing');
 assert.equal(session.run.records.length,0);
 const run=await Promise.race([session.close(),sleep(300).then(()=>null)]);
 assert.ok(run,'closing should release the pending speech wait immediately');assert.equal(run.status,'done');assert.equal(run.records.length,1);
 assert.equal(run.batch.cases[0].current_utterance,text);assert.equal(run.transcript[0].text,text);assert.equal(run.transcript[0].status,'done');assert.equal(run.transcript[0].chunk_id,'C0001');
});

test('stopping during a continuation wait cancels all short windows without sending incomplete facts',async()=>{
 const calls=[],session=S.create({send:async(...args)=>{calls.push(args);return fixture(...args);}});
 session.append('Vamos tentar fazer a espessura de 10',{source:'microphone',speaker:'Ana',offsetMs:0});
 await until(()=>session.run.transcript[0].status==='processing');
 session.append('para',{source:'microphone',speaker:'Ana',offsetMs:5000});await until(()=>session.run.transcript[1].status==='processing');
 session.stop();const run=await Promise.race([session.done,sleep(300).then(()=>null)]);
 assert.ok(run);assert.equal(run.status,'interrupted');assert.equal(calls.length,0);assert.equal(run.records.length,0);assert.equal(session.pending,0);
 assert.ok(run.transcript.every(entry=>entry.status==='interrupted'));assert.deepEqual(S.restore(run).transcript,run.transcript);
 assert.throws(()=>session.append('15 MM'),/encerrada/);
});

test('bounded continuation context belongs only to adjacent speech by the same speaker and source',async()=>{
 const sent=[],session=S.create({send:async(...args)=>{sent.push(clone(args));return fixture(...args);}});
 const rows=[
  ['A viga de referência tem espessura de 10 mm.',{source:'microphone',speaker:'Ana',offsetMs:0}],
  ['Precisamos comparar uma configuração maior.',{source:'microphone',speaker:'Ana',offsetMs:5000}],
  ['Eu ainda discordo dessa comparação.',{source:'microphone',speaker:'Bruno',offsetMs:10000}],
  ['A carga continua em 10 kN.',{source:'microphone',speaker:'Bruno',offsetMs:15000}],
  ['Agora vou falar de outro ensaio.',{source:'microphone',speaker:'Bruno',offsetMs:30000}],
  ['Uma fala importada separada.',{source:'import',speaker:'Bruno',offsetMs:35000}]
 ];
 for(const [text,meta] of rows)session.append(text,meta);
 const run=await session.close();assert.equal(run.records.length,rows.length);
 assert.equal(run.batch.cases[1].speech_context,rows[0][0]);assert.equal(run.batch.cases[3].speech_context,rows[2][0]);
 for(const index of [0,2,4,5])assert.equal(run.batch.cases[index].speech_context,undefined,'context leaked into '+index);
 for(const [request,,lane] of sent)if(lane==='chunks'&&request.state.current_utterance===rows[1][0]){
  assert.deepEqual(request.state.speech_context,{preceding_words:rows[0][0],purpose:'resolve_continuation_only'});
  assert.equal(request.state.current_utterance,rows[1][0]);
 }
 assert.deepEqual(S.restore(run).batch.cases,run.batch.cases);
});

test('cancelling a joined window during command routing settles every original source row',async()=>{
 const gate=deferred();let routing=false;const session=S.create({send:fixture,commandHandler:async()=>{routing=true;await gate.promise;return null;}});
 session.append('Vamos tentar fazer a espessura de 10',{source:'microphone',speaker:'Ana',offsetMs:0});
 session.append('para 15 MM',{source:'microphone',speaker:'Ana',offsetMs:5000});await until(()=>routing);
 session.stop();gate.resolve();const run=await session.done;
 assert.equal(run.status,'interrupted');assert.equal(run.records.length,0);assert.equal(run.transcript.length,2);
 assert.ok(run.transcript.every(entry=>entry.status==='interrupted'),'every capture row in the grouped unit must be interrupted');
 assert.deepEqual(S.restore(run).transcript,run.transcript);
});

test('restore rejects forged grouped-window provenance instead of silently detaching a classified fact from its sources',async()=>{
 const session=S.create({send:fixture});session.append('Vamos tentar fazer a espessura de 10',{source:'microphone',speaker:'Ana',offsetMs:0});session.append('para 15 MM',{source:'microphone',speaker:'Ana',offsetMs:5000});
 const saved=await session.close();assert.deepEqual(saved.batch.cases[0].source_entry_ids,['S0001','S0002']);
 for(const mutate of [
  run=>run.batch.cases[0].source_entry_ids=['S0001','S9999'],
  run=>run.batch.cases[0].source_entry_ids=['S0001','S0001'],
  run=>run.batch.cases[0].source_entry_ids=['S0002','S0001'],
  run=>run.transcript[1].chunk_id='C9999',
  run=>run.transcript[1].text='para 150 MM'
 ]){const corrupt=clone(saved);mutate(corrupt);assert.throws(()=>S.restore(corrupt),'the grouped source audit must match the recorded fact');}
});

// Speech continuation gate (live microphone): Jev decides whether to wait for the rest.
function gated(unfinished,{fail=null,seen=[],joins=()=>false,pairs=[],completes=()=>false,commands=[]}={}){
 return (req,provider,lane)=>{
  if(lane!=='speech')return fixture(req,provider,lane);
  assert.ok(!JSON.stringify(req).includes('expected_'));
  if(req.questions.command_completion){
   assert.deepEqual(Object.keys(req.questions),['command_completion']);commands.push(req.state);
   const p=completes(req.state.current_utterance,req.state.next_utterance)?.97:.03;
   return {request:clone(req),provider:'official',latencyMs:1,response:{model:'fixture',answers:{command_completion:{type:'choice',choice:p>.5?'completes':'separate',confidence:.5,probabilities:{completes:p,separate:1-p}}}}};
  }
  if(req.questions.speech_join){
   assert.deepEqual(Object.keys(req.questions),['speech_join']);pairs.push(req.state);if(fail)throw fail;
   const p=joins(req.state.current_utterance,req.state.next_utterance)?.95:.05;
   return {request:clone(req),provider:'official',latencyMs:1,response:{model:'fixture',answers:{speech_join:{type:'choice',choice:p>.5?'same_point':'separate',confidence:.5,probabilities:{same_point:p,separate:1-p}}}}};
  }
  assert.deepEqual(Object.keys(req.questions),['speech_status']);
  seen.push(req.state);if(fail)throw fail;
  const p=unfinished(req.state.current_utterance)?.92:.08;
  return {request:clone(req),provider:'official',latencyMs:1,response:{model:'fixture',answers:{speech_status:{type:'choice',choice:p>.5?'unfinished':'finished',confidence:.5,probabilities:{finished:1-p,unfinished:p}}}}};
 };
}
const fast={waitMs:120,maxWaitMs:400,pauseMs:6000};
test('an announced test result waits for the speaker and becomes one chunk with its outcome',async()=>{
 const seen=[],s=S.create({send:gated(text=>/validou$/.test(text),{seen}),continuation:fast});
 s.append('RESULTADO a gente testou e validou',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 await sleep(40);assert.equal(s.run.records.length,0,'still waiting for the outcome');
 s.append('a viga de 13 cm passou no ensaio de tensão',{source:'microphone',speaker:'Ana',offsetMs:3800,endOffsetMs:6000});
 const run=await s.close();
 assert.equal(run.records.length,1);assert.equal(run.batch.cases[0].current_utterance,'RESULTADO a gente testou e validou a viga de 13 cm passou no ensaio de tensão');
 assert.deepEqual(run.batch.cases[0].source_entry_ids,['S0001','S0002']);
 assert.deepEqual(run.records[0].segmentation.checks.map(c=>[c.wait,c.merged??null]),[[true,true],[false,null]]);
 assert.equal(seen[0].current_utterance,'RESULTADO a gente testou e validou');assert.equal(seen[1].current_utterance,run.batch.cases[0].current_utterance);
 assert.equal(run.meeting_events[0].type,'test_result');
});
test('a finished piece is processed at once and keeps the previous piece only as context',async()=>{
 const seen=[],s=S.create({send:gated(()=>false,{seen}),continuation:fast});
 s.append('o teste de carga deu 12 mm de deslocamento',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 s.append('alguém pode compartilhar a tela',{source:'microphone',speaker:'Ana',offsetMs:3500,endOffsetMs:5000});
 const run=await s.close();
 assert.equal(run.records.length,2);assert.equal(seen[1].previous_context,'o teste de carga deu 12 mm de deslocamento');
});
test('the gate never merges a new command, a long pause or another speaker',async()=>{
 for(const [text,meta] of [['Norte, abra a simulação',{speaker:'Ana',offsetMs:3500}],['a viga passou',{speaker:'Ana',offsetMs:20000}],['a viga passou',{speaker:'Bruno',offsetMs:3500}]]){
  const s=S.create({send:gated(()=>true),continuation:fast});
  s.append('então o resultado foi',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
  s.append(text,{source:'microphone',...meta,endOffsetMs:meta.offsetMs+1500});
  const run=await s.close();
  assert.equal(run.batch.cases[0].current_utterance,'então o resultado foi',text+' '+meta.speaker);
 }
});
test('an unfinished piece without a continuation is processed after the wait instead of being lost',async()=>{
 const s=S.create({send:gated(()=>true),continuation:fast});
 s.append('a gente vai tentar fazer',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 const started=Date.now();await sleep(300);assert.equal(s.run.records.length,1,'processed after waitMs');assert.ok(Date.now()-started<400);
 const run=await s.close();assert.equal(run.records[0].segmentation.checks[0].merged,false);
});
test('ongoing unconfirmed speech keeps the wait open until the continuation arrives',async()=>{
 const s=S.create({send:gated(text=>/foi$/.test(text)),continuation:fast});
 s.append('o resultado do ensaio de fadiga foi',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 for(let i=0;i<5;i++){await sleep(60);s.heard();}
 assert.equal(s.run.records.length,0,'speech in progress: no cut after waitMs');
 s.append('aprovado com 2 milhões de ciclos',{source:'microphone',speaker:'Ana',offsetMs:3400,endOffsetMs:6000});
 const run=await s.close();assert.equal(run.batch.cases[0].current_utterance,'o resultado do ensaio de fadiga foi aprovado com 2 milhões de ciclos');
});
test('a failed continuation check never blocks or drops the piece',async()=>{
 const s=S.create({send:gated(()=>true,{fail:Error('rede instável')}),continuation:fast});
 s.append('a gente decidiu usar aço A36',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 const run=await s.close();assert.equal(run.status,'done');assert.equal(run.records.length,1);assert.equal(run.records[0].segmentation.checks[0].error,'rede instável');
});
test('typed and imported text never pay for the speech check',async()=>{
 const seen=[],s=S.create({send:gated(()=>true,{seen}),continuation:fast});
 s.append('texto digitado completo');s.append('linha importada',{source:'import'});
 await s.close();assert.equal(seen.length,0);
});
test('a complete-looking piece is joined when the next piece completes it (pair check)',async()=>{
 const pairs=[],s=S.create({send:gated(()=>false,{joins:(a,b)=>/^que é/.test(b),pairs}),continuation:fast});
 s.append('e isso tá acima do limite que a gente definiu',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 s.append('que é 200 megapascal com o fator de segurança',{source:'microphone',speaker:'Ana',offsetMs:3600,endOffsetMs:6000});
 s.append('beleza',{source:'microphone',speaker:'Ana',offsetMs:6500,endOffsetMs:7000});
 const run=await s.close();
 assert.deepEqual(run.batch.cases.map(c=>c.current_utterance),['e isso tá acima do limite que a gente definiu que é 200 megapascal com o fator de segurança','beleza']);
 assert.deepEqual(pairs.map(p=>p.next_utterance),['que é 200 megapascal com o fator de segurança','beleza']);
 assert.equal(pairs[1].current_utterance,'que é 200 megapascal com o fator de segurança','the pair check compares the latest piece');assert.equal(pairs[1].previous_context,'e isso tá acima do limite que a gente definiu');
 assert.deepEqual(run.records[0].segmentation.checks.map(c=>[c.kind||'status',c.join??c.wait,c.merged??null]),[['status',false,null],['join',true,true],['status',false,null],['join',false,null]]);
});
test('a finished piece followed by silence is processed without waiting',async()=>{
 const pairs=[],s=S.create({send:gated(()=>false,{pairs}),continuation:{...fast,waitMs:5000,maxWaitMs:9000}});
 s.append('a gente decidiu usar aço A36',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 await sleep(80);assert.equal(s.run.records.length,1,'no wait when nobody is talking');assert.equal(pairs.length,0);await s.close();
});
test('while the speaker keeps talking, the next piece is checked before cutting',async()=>{
 const pairs=[],s=S.create({send:gated(()=>false,{joins:()=>true,pairs}),continuation:fast});
 s.heard();s.append('eu acho que o problema é a altura da seção',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 for(let i=0;i<3;i++){await sleep(50);s.heard();}
 assert.equal(s.run.records.length,0,'waits for the piece being spoken');
 s.append('ela tá baixa demais pra esse comprimento',{source:'microphone',speaker:'Ana',offsetMs:3300,endOffsetMs:5000});
 const run=await s.close();assert.equal(run.batch.cases[0].current_utterance,'eu acho que o problema é a altura da seção ela tá baixa demais pra esse comprimento');assert.equal(pairs.length,1);
});
test('commands to Norte are never extended or absorbed by the pair check',async()=>{
 const pairs=[],s=S.create({send:gated(()=>false,{joins:()=>true,pairs}),continuation:fast});
 s.append('só uma dúvida e se a gente usasse alumínio',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 s.append('norte usa alumínio 6061',{source:'microphone',speaker:'Ana',offsetMs:3300,endOffsetMs:5000});
 s.append('então fica assim',{source:'microphone',speaker:'Ana',offsetMs:5300,endOffsetMs:6000});
 const run=await s.close();
 assert.equal(run.transcript.find(t=>t.text==='norte usa alumínio 6061').chunk_id,undefined,'the command is routed on its own');
 assert.ok(!run.batch.cases.some(c=>/norte usa/.test(c.current_utterance)));assert.ok(!pairs.some(p=>/norte/.test(p.current_utterance+p.next_utterance)));
});
test('a command said in two parts takes only its missing value, never the conversation after it',async()=>{
 const commands=[],s=S.create({send:gated(text=>/para$/.test(text),{joins:()=>true,completes:(a,b)=>/centímetros$/.test(b),commands}),continuation:fast});
 s.append('norte muda a altura da seção para',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:2500});
 s.append('30 centímetros',{source:'microphone',speaker:'Ana',offsetMs:3000,endOffsetMs:3800});
 s.append('norte usa aço',{source:'microphone',speaker:'Ana',offsetMs:5000,endOffsetMs:6000});
 s.append('então fica o aço mesmo',{source:'microphone',speaker:'Ana',offsetMs:6300,endOffsetMs:7500});
 const run=await s.close();
 const [first,value,steel,remark]=run.transcript;
 assert.equal(first.status,'command');assert.equal(value.status,'command');assert.equal(first.command,value.command,'one instruction');
 assert.equal(steel.status,'command');assert.notEqual(remark.status,'command','a remark after a complete command stays conversation');
 assert.ok(run.batch.cases.some(c=>c.current_utterance==='então fica o aço mesmo'));
 assert.deepEqual(commands.map(c=>c.next_utterance),['30 centímetros']);
});
test('a finished point is not extended by a piece that opens a new point',async()=>{
 const seen=[],pairs=[],s=S.create({send:gated(text=>/foi$/.test(text),{seen,joins:()=>true,pairs}),continuation:fast});
 s.append('a temperatura não pode passar de 80 graus',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 s.append('e o resultado da última medição foi',{source:'microphone',speaker:'Ana',offsetMs:3300,endOffsetMs:5000});
 s.append('72 graus depois de 40 minutos',{source:'microphone',speaker:'Ana',offsetMs:5300,endOffsetMs:7000});
 const run=await s.close();
 assert.deepEqual(run.batch.cases.map(c=>c.current_utterance),['a temperatura não pode passar de 80 graus','e o resultado da última medição foi 72 graus depois de 40 minutos']);
 assert.equal(pairs.length,0,'no pair check against an open opener');assert.equal(run.records[0].segmentation.checks.at(-1).opens,true);
});
test('a dependent continuation that is complete still goes to the pair check',async()=>{
 const pairs=[],s=S.create({send:gated(()=>false,{joins:(a,b)=>/^e ver/.test(b),pairs}),continuation:fast});
 s.append('a gente pode testar aumentar a altura de 24 pra 30 centímetros',{source:'microphone',speaker:'Ana',offsetMs:1000,endOffsetMs:3000});
 s.append('e ver o que acontece com a tensão',{source:'microphone',speaker:'Ana',offsetMs:3300,endOffsetMs:5000});
 const run=await s.close();assert.equal(run.batch.cases[0].current_utterance,'a gente pode testar aumentar a altura de 24 pra 30 centímetros e ver o que acontece com a tensão');
});
test('a meeting with pieces joined by the continuation check restores, and tampering is still rejected',async()=>{
 const s=S.create({send:gated(text=>!/fim$/.test(text)),continuation:fast});
 const pieces=['então o problema','que a gente viu','na semana passada era','a tensão no engaste passando de 250 megapascal fim'];
 pieces.forEach((text,i)=>s.append(text,{source:'microphone',speaker:'Ana',offsetMs:1000+i*4000,endOffsetMs:3500+i*4000}));
 const run=await s.close();assert.equal(run.batch.cases[0].source_entry_ids.length,4,'more pieces than the old three-window rule');
 const saved=clone(run);assert.equal(S.restore(clone(saved)).batch.cases[0].current_utterance,pieces.join(' '));
 for(const mutate of [r=>{r.records[0].segmentation.checks.forEach(c=>delete c.merged);},r=>{r.transcript[3].text='outro texto';},r=>{r.transcript[1].speaker='Bruno';}]){
  const corrupt=clone(saved);mutate(corrupt);assert.throws(()=>S.restore(corrupt));
 }
});
