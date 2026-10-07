const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),E=require('../experiments.js');
const item=(id,store=true,type='observation')=>({id,current_utterance:'Text '+id,expected_store_memory:store,expected_event_type:store?type:null});
const batch=cases=>({batch_id:'B01',cases});
function output(req,{store=.95,type='observation',probability=.94}={}) {
  const keys=req.questions.event_type?Object.keys(req.questions.event_type.criteria):[];
  const answers=req.questions.should_store_memory?{should_store_memory:{type:'noul',noul:store}}:{event_type:{type:'choice',choice:type,confidence:.2,probabilities:Object.fromEntries(keys.map(t=>[t,t===type?probability:(1-probability)/(keys.length-1)]))}};
  return {request:E.clone(req),response:{model:'fixture',answers},provider:'official',latencyMs:12};
}
test('batch validates complete unique IDs, booleans, null ignored types and resource limits',()=>{
  assert.equal(F.validateBatch(F.example).cases.length,9);
  for(const value of [null,{},batch([]),batch([item('C1'),item('C1')]),batch([{...item('C1'),current_utterance:''}]),batch([{...item('C1'),expected_store_memory:'true'}]),batch([{...item('C1',false),expected_event_type:'observation'}]),batch([item('C1',true,'none')]),batch(Array.from({length:101},(_,i)=>item(String(i))))])assert.throws(()=>F.validateBatch(value));
  assert.throws(()=>F.validateBatch(batch([{...item('C1'),current_utterance:'a'.repeat(16001)}])));
  const source=batch([{...item(' C1 '),extra:'Never send expected labels'}]);assert.deepEqual(Object.keys(F.validateBatch(source).cases[0]),['id','current_utterance','expected_store_memory','expected_event_type']);assert.equal(source.cases[0].id,' C1 ');
});
test('fixed questions are valid and request State never includes gabarito, IDs, queues or context',()=>{
  const c=item('C1');for(const stage of ['store','type']) {
    const req=F.request(c,stage);E.validateConfig(req);assert.deepEqual(Object.keys(req),['model','state','questions']);assert.deepEqual(req.state,{current_utterance:c.current_utterance});assert.equal(Object.keys(req.questions).length,1);
  }
  assert.throws(()=>F.request(c,'unknown'));
  F.questions.should_store_memory.instructions='Mutated public copy';assert.notEqual(F.request(c,'store').questions.should_store_memory.instructions,'Mutated public copy');
});
test('actual false skips type; true performs two calls serially; FIFO logs excluded from memory',async()=>{
  const cases=[item('C1'),item('C2',false),item('C3')],run=F.createRun(batch(cases),'official');let active=0,peak=0;const sent=[],stages=[];
  await F.execute(run,{send:async req=>{sent.push(E.clone(req));peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,2));active--;return output(req,{store:req.state.current_utterance==='Text C2'?.03:.95});},onChange:()=>stages.push(run.records.at(-1)?.stage)});
  assert.equal(peak,1);assert.equal(sent.length,5);assert.equal(run.calls,5);assert.equal(run.status,'done');assert.ok(stages.includes('type'));
  assert.equal(sent.filter(req=>req.state.current_utterance==='Text C2').length,1);
  const q=F.queues(run);assert.deepEqual(q.memory.observation.map(c=>c.id),['C1','C3']);assert.deepEqual(q.ignored.map(c=>c.id),['C2']);
  assert.equal(q.ignored[0].type,null);assert.equal(q.memory.observation[0].chunk_id,'C1');assert.match(q.memory.observation[0].timestamp,/^\d{2}:\d{2}:\d{2}$/);
  assert.equal(run.records[1].result.typeMatches,null);assert.ok(run.records.every(r=>r.result.verdict==='pass'));
});
test('route follows actual answers, red for wrong store or type, ignored expected type never validated',()=>{
  let c=item('C1'),gate=output(F.request(c,'store'),{store:.1});let r=F.evaluate(c,gate);assert.equal(r.destination,'ignore');assert.equal(r.verdict,'fail');
  c=item('C2',false);gate=output(F.request(c,'store'));r=F.evaluate(c,gate,output(F.request(c,'type'),{type:'decision'}));assert.equal(r.destination,'decision');assert.equal(r.storeMatches,false);assert.equal(r.typeMatches,null);assert.equal(r.verdict,'fail');
  c=item('C3',true,'test_proposal');r=F.evaluate(c,output(F.request(c,'store')),output(F.request(c,'type'),{type:'test_result'}));assert.equal(r.storeMatches,true);assert.equal(r.typeMatches,false);assert.equal(r.destination,'test_result');assert.equal(r.verdict,'fail');
});
test('correct but low P(actual) is amber, not a failed class; false uses 1-P(true)',()=>{
  const c=item('C1',false),r=F.evaluate(c,output(F.request(c,'store'),{store:.35}));assert.equal(r.storeProbability,.65);assert.equal(r.correct,true);assert.equal(r.verdict,'warning');
  const yes=item('C2');const gate=output(F.request(yes,'store'),{store:.8});
  assert.equal(F.evaluate(yes,gate,output(F.request(yes,'type'),{probability:.8})).verdict,'pass');
  assert.equal(F.evaluate(yes,gate,output(F.request(yes,'type'),{probability:.6})).verdict,'warning');
  assert.equal(F.evaluate(yes,gate,output(F.request(yes,'type'),{type:'other',probability:.6})).verdict,'fail');
});
test('API/malformed errors do not become Ignore or memory; no retries',async()=>{
  for(const mode of ['store','type','malformed']) {
    const run=F.createRun(batch([item('C1'),item('C2')]),'official');let calls=0;
    await F.execute(run,{send:async req=>{calls++;if(req.state.current_utterance==='Text C1' && (mode==='store'||mode==='type'&&req.questions.event_type))throw Error('Fixture error');if(mode==='malformed'&&req.state.current_utterance==='Text C1')return {};return output(req);}});
    assert.equal(run.records[0].status,'error');assert.equal(run.records[1].status,'done');assert.equal(F.queues(run).ignored.length,0);assert.deepEqual(F.queues(run).memory.observation.map(c=>c.id),['C2']);assert.equal(calls,mode==='type'?4:3);
  }
});
test('fatal API response stops batch and pause after gate never issues type request',async()=>{
  let run=F.createRun(batch([item('C1'),item('C2')]),'official');
  await F.execute(run,{send:async()=>{throw Object.assign(Error('Quota'),{stopBatch:true});}});assert.equal(run.status,'stopped');assert.equal(run.records.length,1);assert.equal(run.calls,1);
  run=F.createRun(batch([item('C1'),item('C2')]),'official');let stop=false;
  await F.execute(run,{send:async req=>{stop=true;return output(req);},shouldStop:()=>stop});assert.equal(run.calls,1);assert.equal(run.records[0].status,'interrupted');assert.equal(run.status,'stopped');assert.deepEqual(F.queues(run).memory.observation,[]);
  await assert.rejects(F.execute(run,{send:async req=>output(req)}),/nova rodada/);
});
test('restore recomputes verdicts from real outputs, preserves FIFO and never resumes a running request',async()=>{
  const run=F.createRun(batch([item('C1'),item('C2')]),'official');
  await F.execute(run,{send:async req=>output(req)});
  const copy=E.clone(run);copy.records[0].result={verdict:'fail'};const restored=F.restore(copy);assert.equal(restored.records[0].result.verdict,'pass');assert.deepEqual(F.queues(restored),F.queues(run));
  copy.status='running';copy.records[1]={id:'C2',stage:'store',status:'running'};const interrupted=F.restore(copy);assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.records[1].status,'interrupted');assert.equal(F.queues(interrupted).memory.observation.length,1);
  copy.records[0].storeOutput.request.state.current_utterance='tampered';assert.throws(()=>F.restore(copy),/corresponde/);
});
test('question versions deduplicate formatting/order changes and keep immutable snapshots',()=>{
  const lib=F.emptyLibrary(),q=F.request(item('x'),'store').questions.should_store_memory;
  const original={should_store_memory:q,event_type:F.request(item('x'),'type').questions.event_type};
  const first=F.addVersion(lib,original);assert.equal(first.id,'Q001');
  assert.equal(F.addVersion(lib,{event_type:original.event_type,should_store_memory:original.should_store_memory}).id,'Q001');
  const edited=E.clone(original);edited.should_store_memory.instructions+=' Save useful project background.';
  const second=F.addVersion(lib,edited);assert.equal(second.id,'Q002');assert.equal(lib.versions.length,2);
  edited.should_store_memory.instructions='Changed outside library';assert.notEqual(second.questions.should_store_memory.instructions,edited.should_store_memory.instructions);
  const diff=F.diffQuestions(first.questions,second.questions);assert.equal(diff.length,1);assert.equal(diff[0].path,'should_store_memory.instructions');
  assert.equal(F.addVersion(lib,original).id,'Q001');
});
test('custom questions are sent exactly and restored against their original snapshot',async()=>{
  const q={should_store_memory:F.request(item('x'),'store').questions.should_store_memory,event_type:F.request(item('x'),'type').questions.event_type};
  q.should_store_memory.instructions='Does this utterance contain lasting project information?';
  const run=F.createRun(batch([item('C1')]),'official',.8,q,'Q007'),sent=[];
  q.should_store_memory.instructions='Later edit';
  await F.execute(run,{send:async req=>{sent.push(req);return output(req);}});
  assert.equal(sent[0].questions.should_store_memory.instructions,'Does this utterance contain lasting project information?');
  assert.equal(F.restore(run).questionVersion,'Q007');assert.equal(F.restore(run).records[0].result.verdict,'pass');
  const wrong=E.clone(run);wrong.questions.should_store_memory.instructions='Different historical question';assert.throws(()=>F.restore(wrong));
});
test('saved tests retain input and question versions independently from later drafts',async()=>{
  const lib=F.emptyLibrary(),q={should_store_memory:F.request(item('x'),'store').questions.should_store_memory,event_type:F.request(item('x'),'type').questions.event_type};
  const source=batch([item('C1')]),run=F.createRun(source,'official',.8,q);
  await F.execute(run,{send:async req=>output(req)});
  const first=F.saveTest(lib,source,q,run);assert.equal(first.id,'T001');assert.equal(first.questionVersion,'Q001');
  source.cases[0].current_utterance='New text';q.event_type.instructions+=' Use a different rubric.';
  const second=F.saveTest(lib,source,q);assert.equal(second.id,'T002');assert.equal(second.questionVersion,'Q002');assert.equal(first.batch.cases[0].current_utterance,'Text C1');
  const saved=F.validateLibrary(JSON.parse(JSON.stringify(lib)));assert.equal(saved.tests[0].run.records[0].result.verdict,'pass');
  const tampered=E.clone(lib);tampered.tests[0].questionVersion='Q002';assert.throws(()=>F.validateLibrary(tampered),/versão/);
  assert.throws(()=>F.saveTest(lib,source,q,run),/mesma configuração/);
});
test('categories come from the saved choice criteria: additions, renames and removals',()=>{
  const q=E.clone(F.questions);q.event_type.criteria.risk='An unresolved project risk.';
  assert.deepEqual(F.typesFor(F.validateQuestions(q)),[...F.types,'risk']);
  const source=batch([item('C1',true,'risk')]);
  assert.equal(F.validateBatch(source,q).cases[0].expected_event_type,'risk');
  assert.throws(()=>F.validateBatch(source),/não existe/);
  assert.deepEqual(F.validateBatch(source,null),source,'incompatible local drafts remain recoverable');
  q.event_type.criteria={risk:'Risk',requirement:'Requirement'};
  assert.deepEqual(F.typesFor(F.validateQuestions(q)),['risk','requirement']);
  assert.deepEqual(Object.keys(F.queues(null,q).memory),['risk','requirement']);
  delete q.event_type.criteria.risk;q.event_type.criteria.constraint='Constraint';
  F.validateQuestions(q);
  assert.throws(()=>F.createRun(source,'official',.8,q),/risk.*Input JSON/);
  const lib=F.emptyLibrary();assert.throws(()=>F.saveTest(lib,source,q),/não existe/);assert.deepEqual(lib,F.emptyLibrary());
  assert.doesNotThrow(()=>F.createRun(batch([item('C2',false)]),'official',.8,q));
});
test('dynamic categories route actual answers into FIFO and keep independent archived snapshots',async()=>{
  const lib=F.emptyLibrary(),q=E.clone(F.questions);
  q.event_type.criteria={requirement:'Requirement',risk:'Risk'};
  const source=batch([item('C1',true,'requirement'),item('C2',true,'risk'),item('C3',false)]);
  const run=F.createRun(source,'official',.8,q);
  await F.execute(run,{send:async req=>output(req,{type:'requirement',store:req.state.current_utterance==='Text C3'?.05:.95})});
  assert.deepEqual(run.records.map(r=>r.result.verdict),['pass','fail','pass']);
  assert.deepEqual(F.queues(run).memory.requirement.map(c=>c.id),['C1','C2']);
  assert.deepEqual(F.queues(run).ignored.map(c=>c.id),['C3']);
  const saved=F.saveTest(lib,source,q,run);F.saveTest(lib,batch([item('OLD')]),F.questions);
  q.event_type.criteria={replacement:'Replacement',other:'Other'};F.addVersion(lib,q);
  const restored=F.validateLibrary(JSON.parse(JSON.stringify(lib)));
  assert.deepEqual(F.typesFor(restored.tests[0].run.questions),['requirement','risk']);
  assert.deepEqual(F.queues(F.restore(saved.run)),F.queues(run));
  assert.equal(restored.tests[1].questionVersion,'Q002');
  const tampered=E.clone(lib);tampered.tests[0].questionVersion='Q003';assert.throws(()=>F.validateLibrary(tampered));
});
test('custom category names are data, including names also used by the routing UI',async()=>{
  const q=E.clone(F.questions);q.event_type.criteria=JSON.parse('{"ignore":"Retained memory category","yes":"Yes class","no":"No class","__proto__":"Prototype name","risk / <new>":"Display as text"}');
  for(const type of F.typesFor(q)){
    const run=F.createRun(batch([item('C1',true,type)]),'official',.8,q);
    await F.execute(run,{send:async req=>output(req,{type})});
    assert.equal(run.records[0].result.verdict,'pass');
    assert.equal(F.queues(run).memory[type].length,1);assert.equal(F.queues(run).ignored.length,0);
    assert.doesNotThrow(()=>F.restore(run));
  }
});
test('dynamic routing retains the API choice limits and gate contract',()=>{
  const q=E.clone(F.questions);
  for(const count of [2,8,12]){q.event_type.criteria=Object.fromEntries(Array.from({length:count},(_,i)=>['type_'+i,'Criterion']));assert.equal(F.typesFor(F.validateQuestions(q)).length,count);}
  for(const count of [0,1,13]){q.event_type.criteria=Object.fromEntries(Array.from({length:count},(_,i)=>['type_'+i,'Criterion']));assert.throws(()=>F.validateQuestions(q),/2 a 12/);}
  q.event_type.criteria={a:'A',b:'B'};q.should_store_memory.type='choice';q.should_store_memory.criteria={true:'Yes',false:'No'};
  assert.throws(()=>F.validateQuestions(q),/should_store_memory \(noul\)/);
});
test('meeting_events persists accepted actual events while raw_window receives every chunk before classification',async()=>{
  const source=batch([item('C1'),item('C2',false),item('C3',false),item('C4'),item('C5'),item('C6',false)]);
  const run=F.createRun(source,'official'),frames=[];let clock=Date.parse('2030-01-01T00:00:00Z');
  await F.execute(run,{now:()=>clock,onChange:()=>frames.push(E.clone(run)),send:async req=>{
    const id=req.state.current_utterance.slice(5);
    assert.equal(run.raw_window.at(-1).chunk_id,id,'arrival enters raw_window before any API result');
    clock+=1000;
    if(id==='C4' || id==='C5'&&req.questions.event_type)throw Error('Fixture call failure');
    return output(req,{store:['C2','C6'].includes(id)?.05:.95,type:id==='C3'?'decision':'observation'});
  }});
  assert.equal(run.startedAt,'2030-01-01T00:00:00.000Z');
  assert.deepEqual(run.meeting_events,[
    {event_id:'E001',chunk_id:'C1',timestamp:'00:00:00',type:'observation',text:'Text C1',status:'active',thread_id:null},
    {event_id:'E002',chunk_id:'C3',timestamp:'00:00:03',type:'decision',text:'Text C3',status:'active',thread_id:null}
  ]);
  assert.deepEqual(run.raw_window.map(c=>c.chunk_id),source.cases.map(c=>c.id));
  assert.equal(run.raw_window.at(-1).timestamp,'00:00:08');
  assert.equal(run.records[0].timestamp,'2030-01-01T00:00:02.000Z','completion is not event arrival time');
  for(const frame of frames){
    assert.deepEqual(frame.raw_window.map(c=>c.chunk_id),frame.records.slice(-15).map(r=>r.id));
    assert.equal(frame.meeting_events.length,frame.records.filter(r=>r.status==='done'&&r.result.store).length);
  }
  assert.equal(F.queues(run).memory.decision[0].event_id,'E002');
  assert.equal(F.queues(run).memory.decision[0].status,'active');
  assert.equal(F.queues(run).memory.decision[0].verdict,'fail','wrongly accepted chunks are still memory with a failed verdict');
  assert.equal(F.queues(run).ignored.length,2);
  const saved=F.restore(E.clone(run));assert.deepEqual(saved.meeting_events,run.meeting_events);assert.deepEqual(saved.raw_window,run.raw_window);
});
test('event status is a system creation rule based on actual type, never wording, expectations or confidence',async()=>{
  const q=E.clone(F.questions);
  q.event_type.criteria={...q.event_type.criteria,requirement:'Requirement',risk:'Risk',['__proto__']:'Custom category'};
  const cases=F.typesFor(q).flatMap((type,index)=>[
    {...item('C'+index+'A',true,'observation'),current_utterance:`${index}: This is closed and already resolved.`,actualType:type},
    {...item('C'+index+'B',true,'test_proposal'),current_utterance:`${index}: This is still open and waiting.`,actualType:type}
  ]);
  const run=F.createRun(batch(cases),'official',.8,q),frames=[];
  await F.execute(run,{send:async req=>{
    const c=cases.find(c=>c.current_utterance===req.state.current_utterance);
    assert.deepEqual(Object.keys(req.state),['current_utterance']);
    assert.equal(Object.keys(req.questions).length,1,'no status question is sent to the model');
    return output(req,{type:c.actualType,store:c.id.endsWith('A')?.6:.99,probability:c.id.endsWith('A')?.55:.99});
  },onChange:()=>frames.push(E.clone(run.meeting_events))});
  const expected=cases.map(c=>['hypothesis','test_proposal'].includes(c.actualType)?'open':'active');
  assert.deepEqual(run.meeting_events.map(e=>e.status),expected);
  for(const frame of frames)assert.deepEqual(frame.map(e=>e.status),expected.slice(0,frame.length),'each published event has its status immediately and never changes during later arrivals');
  assert.equal(run.calls,cases.length*2,'status adds no model calls');
  assert.ok(run.records.every(r=>r.status==='done'),'record execution status remains separate');
  assert.ok(run.raw_window.every(c=>!Object.hasOwn(c,'status')),'raw chunks have no event lifecycle status');
  assert.ok(F.queues(run).memory.hypothesis.every(e=>e.status==='open'));
  assert.ok(F.queues(run).memory.requirement.every(e=>e.status==='active'));
  const lib=F.emptyLibrary();F.saveTest(lib,run.batch,q,run);
  const stored=JSON.parse(JSON.stringify(lib)),original=E.clone(stored);
  assert.deepEqual(F.validateLibrary(stored).tests[0].run.meeting_events,run.meeting_events);
  for(const e of stored.tests[0].run.meeting_events)delete e.status;
  assert.deepEqual(F.validateLibrary(stored).tests[0].run.meeting_events,run.meeting_events,'old saved tests gain initial statuses without rerunning inference');
  assert.ok(stored.tests[0].run.meeting_events.every(e=>!Object.hasOwn(e,'status')),'reading a legacy archive never mutates its source');
  const tampered=E.clone(run);for(const e of tampered.meeting_events)e.status='closed';
  assert.deepEqual(F.restore(tampered).meeting_events,run.meeting_events,'memory projection cannot invent system transitions');
  assert.deepEqual(F.restore(run).meeting_events,original.tests[0].run.meeting_events);
});
test('restoration upgrades legacy runs and rebuilds memory without trusting extra stored events',async()=>{
  const run=F.createRun(batch([item('C1'),item('C2',false)]),'official');
  await F.execute(run,{send:async req=>output(req,{store:req.state.current_utterance==='Text C2'?.01:.95})});
  const original=E.clone(run),legacy=E.clone(run);
  delete legacy.meeting_events;delete legacy.raw_window;delete legacy.startedAt;for(const record of legacy.records)delete record.receivedOffsetMs;
  assert.equal(F.restore(legacy).meeting_events.length,1);assert.equal(F.restore(legacy).raw_window.length,2);
  run.meeting_events.push({...run.meeting_events[0],event_id:'E999',chunk_id:'not-a-chunk'});run.raw_window=[];
  const restored=F.restore(run);assert.deepEqual(restored.meeting_events,original.meeting_events);assert.deepEqual(restored.raw_window,original.raw_window);
  const library=F.emptyLibrary();F.saveTest(library,original.batch,original.questions,original);
  const archived=F.validateLibrary(library).tests[0].run;assert.deepEqual(archived.meeting_events,original.meeting_events);
  const next=F.createRun(original.batch,'official');assert.deepEqual(next.meeting_events,[]);assert.deepEqual(next.raw_window,[]);
  assert.deepEqual(original.meeting_events,archived.meeting_events,'a new execution does not mutate the old memory');
});
test('interrupted chunks stay in raw_window but do not create partial memory events',async()=>{
  const run=F.createRun(batch([item('C1'),item('C2')]),'official');let stop=false;
  await F.execute(run,{send:async req=>{stop=true;return output(req);},shouldStop:()=>stop});
  assert.deepEqual(run.raw_window.map(c=>c.chunk_id),['C1']);assert.deepEqual(run.meeting_events,[]);
  const resumed=F.restore({...run,status:'running'});assert.equal(resumed.status,'interrupted');assert.equal(resumed.raw_window.length,1);
  assert.equal(F.elapsedTimestamp(92_950),'00:01:32');assert.equal(F.elapsedTimestamp(3_661_000),'01:01:01');
  assert.equal(F.elapsedTimestamp(-100),'00:00:00');
});
test('burst arrivals fill the raw FIFO while inference is pending, without losing the work queue',async()=>{
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  const entered=deferred(),release=deferred(),arrived=deferred();
  const cases=Array.from({length:9},(_,i)=>item('C'+(i+1),![1,8].includes(i)));
  const run=F.createRun(batch(cases),'official');let clock=Date.parse('2030-01-01T00:00:00Z'),active=0,peak=0;
  const sent=[],frames=[];
  const executing=F.execute(run,{mode:'burst',arrivalIntervalMs:1250,now:()=>clock,wait:async ms=>{clock+=ms;},
    onChange:(_,change)=>{frames.push({phase:change.phase,records:run.records.map(r=>r.status),events:run.meeting_events.length});if(run.records.length===9)arrived.resolve();},
    send:async req=>{sent.push(E.clone(req));peak=Math.max(peak,++active);try{
      if(sent.length===1){entered.resolve();await release.promise;}
      clock+=500;
      const c=cases.find(c=>c.current_utterance===req.state.current_utterance);
      if(c.id==='C7')throw Error('Fixture error');
      return output(req,{store:c.expected_store_memory?.95:.03});
    }finally{active--;}}
  });
  await Promise.all([entered.promise,arrived.promise]);
  assert.equal(run.executionMode,'burst');assert.equal(run.calls,1);
  assert.equal(run.records.filter(r=>r.status==='queued').length,8);
  assert.deepEqual(run.raw_window.map(r=>r.chunk_id),cases.map(c=>c.id));
  assert.deepEqual(run.meeting_events,[],'receipt never preemptively stores an event');
  assert.deepEqual(run.records.map(r=>r.receivedOffsetMs),[0,0,0,0,1250,1250,1250,1250,2500]);
  const interrupted=F.restore(E.clone(run));
  assert.equal(interrupted.executionMode,'burst');assert.equal(interrupted.status,'interrupted');
  assert.ok(interrupted.records.every(r=>r.status==='interrupted'));assert.deepEqual(interrupted.raw_window,run.raw_window);
  release.resolve();await executing;
  assert.equal(run.status,'done');assert.equal(peak,1,'arrival concurrency never floods the inference API');
  assert.equal(sent.length,15,'same conditional calls, with no drops or retries');
  assert.deepEqual(run.meeting_events.map(e=>e.chunk_id),['C1','C3','C4','C5','C6','C8']);
  assert.equal(run.records[6].status,'error');assert.equal(run.records[8].result.store,false);
  assert.equal(run.meeting_events[3].timestamp,'00:00:01','event timestamp is arrival, not delayed processing');
  assert.ok(Date.parse(run.records[4].processingStartedAt)>Date.parse(run.records[4].startedAt));
  assert.ok(frames.some(f=>f.phase==='arrivals'&&f.records.includes('running')&&f.records.includes('queued')));
  assert.deepEqual(F.restore(run).meeting_events,run.meeting_events);
  assert.ok(sent.every(req=>Object.keys(req.state).join()==='current_utterance'));
});
test('both execution modes preserve outputs, event order, conditional requests and archives',async()=>{
  const source=batch([item('C1'),item('C2',false),item('C3',true,'hypothesis')]),runs=[];
  for(const mode of ['step','burst']) {
    const run=F.createRun(source,'official');runs.push(run);
    await F.execute(run,{mode,now:()=>Date.parse('2030-01-01T00:00:00Z'),wait:async()=>{},send:async req=>output(req,{store:req.state.current_utterance==='Text C2'?.04:.97,type:req.state.current_utterance==='Text C3'?'hypothesis':'observation'})});
  }
  assert.deepEqual(runs[0].records,runs[1].records);assert.deepEqual(runs[0].meeting_events,runs[1].meeting_events);
  const lib=F.emptyLibrary();F.saveTest(lib,source,runs[1].questions,runs[1]);
  assert.equal(F.validateLibrary(lib).tests[0].run.executionMode,'burst');
  const legacy=E.clone(runs[0]);delete legacy.executionMode;assert.equal(F.restore(legacy).executionMode,'step');
  assert.throws(()=>F.restore({...legacy,executionMode:'unknown'}),/Modo/);
  await assert.rejects(F.execute(F.createRun(source,'official'),{mode:'unknown',send:async()=>assert.fail('no inference')}),/Modo/);
});
test('burst stop and quota errors interrupt queued arrivals without starting more paid calls',async()=>{
  for(const fatal of [false,true]) {
    const run=F.createRun(batch(Array.from({length:10},(_,i)=>item('C'+i))),'official');let stop=false,calls=0;
    await F.execute(run,{mode:'burst',arrivalIntervalMs:1,shouldStop:()=>stop,send:async req=>{
      calls++;
      if(fatal)throw Object.assign(Error('Quota'),{stopBatch:true});
      stop=true;return output(req);
    }});
    assert.equal(calls,1);assert.equal(run.status,'stopped');assert.equal(run.records.length,4);
    assert.ok(run.records.slice(1).every(r=>r.status==='interrupted'));
    assert.deepEqual(run.meeting_events,[]);assert.equal(run.raw_window.length,4);
    assert.ok(F.restore(run).records.every(r=>['error','interrupted'].includes(r.status)));
  }
});
test('arrival callback failures stop the burst producer and leave no stranded running records',async()=>{
  const run=F.createRun(batch(Array.from({length:10},(_,i)=>item('C'+i))),'official');
  await assert.rejects(F.execute(run,{mode:'burst',onChange:(_,change)=>{if(change.phase==='arrivals')throw Error('Fixture receipt failure');},send:async req=>output(req)}),/Fixture receipt failure/);
  assert.equal(run.status,'stopped');assert.ok(run.records.every(r=>r.status==='interrupted'));
  assert.equal(run.records.length,4);assert.equal(run.calls,0);
});
