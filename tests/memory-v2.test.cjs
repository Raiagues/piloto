const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads,V=require('../memory-v2.js');
const {response,chunkOutput,clone}=require('./fixtures/thread-scenarios.cjs');

async function execute(batch,answer=()=>['belongs',.94]) {
  const run=F.createRun(batch,'official',.8,V.questions),requests=[];
  const worker=T.start(run,{config:V.threadConfig,schemaVersion:5,send:async request=>{
    requests.push(clone(request));const [choice,p]=answer(request);
    return response(request,Object.fromEntries(Object.keys(request.questions).map(key=>[key,choice])),p);
  }});
  await F.execute(run,{mode:'burst',wait:async()=>{},send:async request=>chunkOutput(request,batch),onChange:(_,change)=>{
    if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));
  }});
  worker.close();await worker.done;return {run,requests};
}

test('V2 exposes a reviewed sample and explicit changes without altering the original labels',()=>{
  const original=require('./fixtures/memory-b002-original.json'),reviewed=require('./fixtures/memory-b002-reviewed.json');
  assert.deepEqual(V.example,reviewed);F.validateBatch(V.example,V.questions);T.validateConfig(V.threadConfig);
  assert.equal(original.expected_threads.C13.expected_action,'assign_active_thread');
  assert.equal(reviewed.expected_threads.C13.expected_action,'keep_active_thread');
  for(const fixture of [original,reviewed])assert.equal(fixture.cases.find(c=>c.id==='C38').expected_event_type,'observation');
  assert.equal(Object.keys(V.questions.event_type.criteria).length,7);
});

test('V2 archive questions remain valid after the required candidate identifier is expanded',()=>{
  const E=require('../experiments.js');
  const req=T.request({event_id:'E003',type:'observation',text:'Return to the first investigation.'},[],[{thread_id:'T001',events:[{event_id:'E001',type:'observation',text:'The first investigation.'}]}],V.threadConfig,'archive');
  assert.doesNotThrow(()=>E.validateConfig(req));
  assert.ok(req.questions.belongs_to_archive_thread__T001.instructions.includes('T001'));
  assert.ok(req.questions.belongs_to_archive_thread__T001.instructions.length<=1500);
});

test('V2 sends semantic history and eight previous utterances, without future, routing state or expected labels',async()=>{
  const batch={batch_id:'EVIDENCE',cases:Array.from({length:12},(_,i)=>({id:'x'+i,current_utterance:'Project fact '+i,expected_store_memory:true,expected_event_type:'observation'}))};
  const {run,requests}=await execute(batch);
  assert.equal(run.thread_worker.schemaVersion,5);
  for(const req of requests) {
    const index=Number(req.state.current_event.chunk_id.slice(1));
    assert.deepEqual(req.state.recent_context.map(c=>c.chunk_id),batch.cases.slice(Math.max(0,index-8),index).map(c=>c.id));
    assert.equal(req.state.active_thread.events.length,index,'all established history remains available');
    assert.equal(req.state.active_thread.events[0].text,'Project fact 0');
    for(const e of [req.state.current_event,...req.state.active_thread.events])assert.deepEqual(Object.keys(e),['event_id','chunk_id','type','text']);
    assert.equal(req.state.active_thread.status,undefined);
    assert.doesNotMatch(JSON.stringify(req),/expected_|thread_assignment_state|"chunk":|"status":/);
  }
  assert.deepEqual(F.restore(clone(run)).thread_worker,run.thread_worker);
  assert.deepEqual(F.restore(clone(run)).meeting_threads,run.meeting_threads);
});

test('V2 preserves uncertainty and confidence gates; later continuation cannot rewrite a pending event',async()=>{
  const batch={batch_id:'PENDING',cases:['initial','ambiguous','continuation','weak'].map(id=>({id,current_utterance:id,expected_store_memory:true,expected_event_type:'observation'})),expected_threads:{ambiguous:null,continuation:'T001',weak:null}};
  const {run,requests}=await execute(batch,req=>req.state.current_event.chunk_id==='ambiguous'?['uncertain',.95]:['belongs',req.state.current_event.chunk_id==='weak'?.79:.94]);
  assert.deepEqual(run.meeting_events.map(e=>e.thread_id),['T001',null,'T001',null]);
  const continuation=requests.find(r=>r.state.current_event.chunk_id==='continuation');
  assert.equal(continuation.state.recent_context.at(-1).text,'ambiguous');
  assert.deepEqual(continuation.state.active_thread.events.map(e=>e.chunk_id),['initial']);
  assert.equal(run.thread_worker.jobs.at(-1).result.reason,'low_confidence_active');
  const library=F.emptyLibrary();F.saveTest(library,batch,V.questions,run,V.threadConfig);
  assert.doesNotThrow(()=>F.validateLibrary(clone(library)));
  const report=F.exportResults({run});assert.equal(report.summary.pending_assignments,2);
  assert.equal(report.configuration.thread_context_limit,8);
  const corrupted=clone(run);corrupted.thread_worker.jobs[1].result={thread_id:'T001',route:'active',reason:'belongs'};
  assert.throws(()=>F.restore(corrupted),/respostas/);
});

test('V2 expectation edits do not affect model requests or assignments',async()=>{
  const cases=['one','two','three'].map(id=>({id,current_utterance:id,expected_store_memory:true,expected_event_type:'observation'}));
  const batch={batch_id:'LABELS',cases};
  const a=await execute(batch),b=await execute({...batch,expected_threads:{one:'T099',two:null,three:'T088'}});
  const semantic=req=>({...req,state:{...req.state,recent_context:req.state.recent_context.map(({timestamp,...chunk})=>chunk)}});
  assert.deepEqual(a.requests.map(semantic),b.requests.map(semantic));
  assert.deepEqual(a.run.meeting_events.map(e=>e.thread_id),b.run.meeting_events.map(e=>e.thread_id));
  assert.ok(b.run.thread_worker.jobs.every(job=>T.audit(b.run,job).matches===false));
});
