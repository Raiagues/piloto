const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:sleep}=require('node:timers/promises');
const Review=require('../meeting-review.js'),Evidence=require('../meeting-evidence.js'),Session=require('../meeting-session.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function reply(request,select,probability=.97,provider='official'){
 return {request:clone(request),provider,latencyMs:1,response:{model:'fixture',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
  const choice=typeof select==='function'?select(id,q):select[id];
  return [id,q.type==='noul'?{type:'noul',noul:choice?probability:1-probability}:{type:'choice',choice,confidence:.12,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?probability:(1-probability)/(Object.keys(q.criteria).length-1)]))}];
 }))}};
}
function transport(request,provider,lane){
 assert.equal(provider,'official');assert.ok(!JSON.stringify(request).includes('expected_'));
 if(lane==='review')return reply(request,{missing_information:'sufficient'});
 if(lane==='commands')return reply(request,{command_type:'conversation'});
 if(lane==='chunks')return request.questions.should_store_memory?reply(request,{should_store_memory:!request.state.current_utterance.startsWith('Ignorar')}):reply(request,{event_type:request.state.current_utterance.startsWith('HIP')?'hypothesis':request.state.current_utterance.startsWith('TESTE')?'test_proposal':request.state.current_utterance.startsWith('RESULTADO')?'test_result':'observation'},request.state.current_utterance==='RESULTADO deu 40.'?.55:.97);
 if(lane==='threads')return reply(request,()=> 'belongs');
 if(lane==='relations')return reply(request,id=>{
  if(id.startsWith('configuration_match'))return 'exact';
  const target=request.state.candidates.find(candidate=>candidate.event_id===id.split('__')[1]);
  return request.state.current_event.type==='test_result'&&target.type==='test_proposal'?'result_of':request.state.current_event.type==='test_proposal'&&target.type==='hypothesis'?'tests':'none';
 });
 throw Error('Unknown lane '+lane);
}
async function meeting(){const session=Session.create({send:async(...args)=>transport(...args),now:()=>Date.parse('2026-10-07T12:00:00Z')});for(const text of ['A viga apresentou deformação.','HIP a carga explica o deslocamento.','TESTE medir L1 com 4 m e 10 kN.','RESULTADO deu 40.'])session.append(text,{source:'import'});return session.close();}
const excluded=run=>Evidence.project(run).excluded.find(item=>item.text==='RESULTADO deu 40.');

test('evidence includes exactly 60%, omits lower or missing probabilities, and keeps weak topic assignments visibly pending',()=>{
 const run={meeting_events:[...['A','B','C','D','E'].map((id,index)=>({event_id:id,chunk_id:'C'+id,text:'Fala '+id,type:'observation',thread_id:'T001',store_confidence:.95,type_confidence:[.599,.6,undefined,.99,.99][index]}))],meeting_threads:[{thread_id:'T001',anchor_event_ids:['A','B','C','D','E']}],thread_worker:{jobs:[{event_id:'D',status:'done',result:{reason:'low_confidence_active'}}]},meeting_relations:[{relation_id:'R',source_event_id:'B',target_event_id:'A',relation_probability:.99,match_probability:.99,review_state:'confirmed'}]};
 const before=clone(run),result=Evidence.project(run);assert.deepEqual(result.run.meeting_events.map(e=>e.event_id),['B','D','E']);assert.deepEqual(result.run.meeting_threads[0].anchor_event_ids,['B','E']);assert.equal(result.run.meeting_relations.length,0);assert.deepEqual(result.excluded.map(i=>i.event_id),['A','C']);assert.equal(result.run.meeting_events.find(e=>e.event_id==='D').thread_id,null);assert.equal(result.diagnostics.events.D[0].kind,'pending');assert.deepEqual(clone(run),before);
});

test('excluded item requests include every trusted memory once, no weak event or expected labels, and keep source plus feedback separate',async()=>{
 const run=await meeting(),item=excluded(run);run.batch.expected_threads={C0004:'secret label'};run.batch.cases[0].expected_event_type='secret';
 const requests=Review.requestsFor(run,item,'Foi L1, 4 metros, 10 kN e momento de 40 kN m.');
 assert.equal(requests.length,1);assert.deepEqual(requests[0].state.trusted_memory.map(e=>e.id),['E001','E002','E003']);assert.equal(requests[0].state.original_utterance,item.text);assert.match(requests[0].state.human_feedback,/Foi L1/);assert.ok(!JSON.stringify(requests).includes('secret'));assert.equal(requests[0].questions.missing_information.type,'choice');assert.ok(requests[0].questions.missing_information.criteria.execution_status);assert.ok(requests[0].questions.missing_information.criteria.test_identity);
});

test('review batches all trusted memories below the state limit',()=>{
 const run={meeting_events:Array.from({length:40},(_,i)=>({event_id:'E'+i,chunk_id:'C'+i,text:'Memória '+i+' '+('dado '.repeat(180)),type:'observation',thread_id:'T1',store_confidence:.99,type_confidence:.99})),meeting_threads:[{thread_id:'T1'}]};
 const requests=Review.requestsFor(run,{text:'Isto foi testado.'},'Qual configuração foi usada?');assert.ok(requests.length>1);assert.equal(requests.flatMap(r=>r.state.trusted_memory).length,40);assert.equal(new Set(requests.flatMap(r=>r.state.trusted_memory.map(m=>m.id))).size,40);for(const [index,r] of requests.entries()){assert.equal(r.state.memory_batch,index+1);assert.equal(r.state.memory_batches,requests.length);assert.ok(JSON.stringify(r.state).length<=16000);}
});

test('missing test identity asks the specific question, while uncertain classification asks for general details',async()=>{
 for(const [choice,p,wanted] of [['test_identity',.96,'test_identity'],['configuration',.8,'unclear'],['unclear',.97,'unclear']]){
  const run=await meeting(),before=clone(run.records),result=await Review.assess(run,excluded(run),'',{send:async(req,provider,lane)=>{assert.equal(provider,'official');assert.equal(lane,'review');return reply(req,{missing_information:choice},p);}});
  assert.equal(result.status,'needs_details');assert.deepEqual(result.missing,[wanted]);assert.equal(result.message,Review.missing[wanted]);assert.deepEqual(run.records,before);assert.equal(result.audit.calls.length,1);assert.equal(run.review_attempts.length,1);
 }
});

test('sufficient review reruns the normal workers, preserves originals and assigns the recovered result to its existing test',async()=>{
 const source=await meeting(),item=excluded(source),before=clone(source),calls=[];
 const result=await Review.recover(source,item,'No ensaio L1, com 4 m e 10 kN, a simulação resultou em 40 kN m.',{send:async(...args)=>{calls.push(clone(args));return transport(...args);}}),revised=result.run;
 assert.equal(result.status,'included',JSON.stringify(result));assert.equal(revised.id,source.id);assert.equal(revised.startedAt,source.startedAt);assert.equal(revised.finishedAt,source.finishedAt);assert.equal(revised.status,source.status);
 assert.deepEqual(source.records,before.records);assert.deepEqual(source.transcript,before.transcript);assert.deepEqual(revised.records.slice(0,4),before.records);assert.deepEqual(revised.transcript.slice(0,4),before.transcript);assert.equal(revised.records.length,5);assert.equal(revised.transcript.length,5);
 assert.equal(revised.transcript.at(-1).source,'review');assert.equal(revised.transcript.at(-1).sourceId,item.id);assert.equal(revised.transcript.at(-1).sourceText,item.text);assert.match(revised.transcript.at(-1).text,/Esclarecimento fornecido pelo participante:/);
 const addition=revised.meeting_events.at(-1);assert.equal(addition.event_id,'E005');assert.equal(addition.thread_id,'T001');assert.equal(addition.type,'test_result');assert.ok(revised.meeting_relations.some(r=>r.source_event_id===addition.event_id&&r.target_event_id==='E003'&&r.relation_type==='result_of'));
 assert.ok(calls.some(([, ,lane])=>lane==='review'));assert.ok(calls.some(([, ,lane])=>lane==='threads'));assert.ok(calls.some(([, ,lane])=>lane==='relations'));assert.equal(calls.filter(([, ,lane])=>lane==='chunks').length,2);assert.ok(calls.filter(([, ,lane])=>lane==='chunks').every(([r])=>r.state.current_utterance.includes('Esclarecimento')));
 assert.equal(Evidence.project(revised).excluded.some(e=>e.id===item.id),false);assert.equal(Evidence.project(revised).run.meeting_events.some(e=>e.event_id==='E004'),false);assert.ok(Evidence.project(revised).run.meeting_events.some(e=>e.event_id==='E005'));
 const restored=Session.restore(clone(revised));assert.deepEqual(restored.meeting_events,revised.meeting_events);assert.deepEqual(restored.meeting_relations,revised.meeting_relations);assert.deepEqual(restored.review_recoveries,revised.review_recoveries);assert.equal(Evidence.project(restored).excluded.some(e=>e.id===item.id),false);
 let duplicateCalls=0;await assert.rejects(()=>Review.recover(revised,item,'',{send:async()=>{duplicateCalls++;throw Error('Should not call');}}),/não está mais/);assert.equal(duplicateCalls,0);assert.equal(revised.records.length,5);
});

test('missing details stop before normal classification and retain all original data',async()=>{
 const run=await meeting(),before=clone(run),lanes=[];const result=await Review.recover(run,excluded(run),'',{send:async(req,provider,lane)=>{lanes.push(lane);return reply(req,{missing_information:'test_identity'});}});
 assert.equal(result.status,'needs_details');assert.deepEqual(lanes,['review']);assert.equal(result.run,run);assert.deepEqual(run.records,before.records);assert.deepEqual(run.transcript,before.transcript);assert.equal(run.review_recoveries,undefined);
});

test('a sufficient assessment does not override low confidence in the actual classification',async()=>{
 const run=await meeting(),item=excluded(run),result=await Review.recover(run,item,'',{send:async(...args)=>transport(...args)});
 assert.equal(result.status,'needs_details');assert.ok(Evidence.project(result.run).excluded.some(e=>e.id===item.id));assert.equal(Evidence.project(result.run).run.meeting_events.length,3);assert.equal(result.run.review_recoveries.at(-1).status,'needs_details');assert.doesNotThrow(()=>Session.restore(result.run));
});

test('wrong provider or malformed classifier responses leave evidence untouched and log an error audit',async()=>{
 for(const mode of ['provider','schema']){
  const run=await meeting(),before=clone(run.records);await assert.rejects(()=>Review.assess(run,excluded(run),'',{send:async req=>mode==='provider'?reply(req,{missing_information:'sufficient'},.97,'local'):{provider:'official',response:{answers:{}}}}));assert.deepEqual(run.records,before);assert.equal(run.review_attempts.at(-1).status,'error');
 }
});

test('only one source correction per meeting can run concurrently and a failure releases the lock',async()=>{
 const run=await meeting();run.records[0].result.typeProbability=.59;const items=Evidence.project(run).excluded;const first=items[0],second=items[1],gate=deferred();let started=false;
 const active=Review.recover(run,first,'',{send:async()=>{started=true;await gate.promise;throw Error('Offline');}});
 for(let i=0;!started&&i<100;i++)await sleep(1);assert.ok(started);await assert.rejects(()=>Review.recover(run,second,'',{send:async()=>{throw Error('Should not send');}}),/já está sendo analisada/);gate.resolve();await assert.rejects(()=>active,/Offline/);
 const follow=await Review.recover(run,second,'',{send:async req=>reply(req,{missing_information:'test_identity'})});assert.equal(follow.status,'needs_details');
});

test('a high-confidence contradiction in another memory batch blocks inclusion',async()=>{
 const run=await meeting();for(let i=0;i<30;i++)run.meeting_events.push({event_id:'X'+i,chunk_id:'X'+i,type:'observation',text:'Memória adicional '+('dado '.repeat(200)),thread_id:'T001',store_confidence:.99,type_confidence:.99});
 const result=await Review.assess(run,excluded(run),'',{send:async req=>reply(req,{missing_information:req.state.memory_batch===1?'sufficient':'contradiction'})});assert.equal(result.status,'needs_details');assert.deepEqual(result.missing,['contradiction']);assert.ok(result.audit.calls.length>1);
});

test('invalid or oversized feedback and stale source IDs never issue a classifier request',async()=>{
 const run=await meeting(),item=excluded(run);let calls=0;const send=async()=>{calls++;throw Error('Unexpected');};for(const feedback of [null,{},'x'.repeat(6001)])await assert.rejects(()=>Review.assess(run,item,feedback,{send}),/complemento/);await assert.rejects(()=>Review.assess(run,{id:'missing'},'',{send}),/não está mais/);assert.equal(calls,0);
});

test('a failed recovery before creating a record cannot reuse an older trusted record to claim inclusion',async()=>{
 const initial=await meeting(),continuation=Session.create({seed:initial,send:async(...args)=>transport(...args)});continuation.append('A deformação continua acima do limite.');const run=await continuation.close(),item=excluded(run),before=run.records.length;
 const result=await Review.recover(run,item,'O valor corresponde ao ensaio L1.',{send:async(req,provider,lane)=>lane==='commands'?{...transport(req,provider,lane),provider:'local'}:transport(req,provider,lane)});
 assert.equal(result.status,'needs_details');assert.equal(result.run.records.length,before);assert.ok(Evidence.project(result.run).excluded.some(e=>e.id===item.id));assert.equal(result.run.review_recoveries.at(-1).event_id,null);assert.equal(result.run.review_recoveries.at(-1).record_id??null,null);
});

test('forged or corrupt recovery metadata cannot hide source evidence without a corresponding trusted correction',async()=>{
 const original=await meeting(),item=excluded(original),forged=clone(original);
 forged.review_recoveries=[{id:'forged',source_id:item.id,status:'included',record_id:'C0001',event_id:'E001'}];
 assert.ok(Evidence.project(forged).excluded.some(e=>e.id===item.id));
 forged.review_recoveries=[{id:'forged',source_id:'C0001',status:'included',record_id:'C0002',event_id:'E002'}];
 assert.ok(Evidence.project(forged).run.meeting_events.some(e=>e.event_id==='E001'));
 const valid=(await Review.recover(original,item,'Foi o ensaio L1, executado com 4 m, 10 kN e resultado de 40 kN m.',{send:async(...args)=>transport(...args)})).run;
 assert.equal(Evidence.project(valid).excluded.some(e=>e.id===item.id),false);
 for(const mutate of [
  run=>run.review_recoveries[0].record_id='C0001',
  run=>run.review_recoveries[0].event_id='E001',
  run=>run.transcript.at(-1).sourceId='C0001',
  run=>run.transcript.at(-1).source='import',
  run=>run.transcript.at(-1).chunk_id='C0001',
  run=>run.records.at(-1).result.typeProbability=.59,
  run=>run.meeting_events.at(-1).thread_id=null,
  run=>run.thread_worker.jobs.at(-1).result.reason='low_confidence_active'
 ]){const corrupt=clone(valid);mutate(corrupt);assert.ok(Evidence.project(corrupt).excluded.some(e=>e.id===item.id),'bad metadata must keep original visible');}
});
