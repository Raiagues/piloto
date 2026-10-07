// Scheduling/integrity tests with controlled transports; no model accuracy claims.
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads,TR=require('../typed-relations.js'),V=require('../memory-v2.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const within=p=>Promise.race([p,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Timed out waiting for incremental processing')),3000);t.unref();})]);
function reply(request,winners){return {request:clone(request),provider:'official',latencyMs:1,response:{model:'fixture',answers:Object.fromEntries(Object.entries(request.questions).map(([id,q])=>[id,q.type==='noul'?{type:'noul',noul:.99}:{type:'choice',choice:winners[id],confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===winners[id]?1:0]))}]))}};}
const batch={batch_id:'STREAM',cases:[
 {id:'P',current_utterance:'Run trial P with the 4 mm bracket.',expected_store_memory:true,expected_event_type:'test_proposal'},
 {id:'R',current_utterance:'Trial P with the 4 mm bracket completed successfully.',expected_store_memory:true,expected_event_type:'test_result'},
 {id:'B',current_utterance:'The bracket drawing is revision A.',expected_store_memory:true,expected_event_type:'observation'}],expected_threads:{P:'T001',R:'T001',B:'T001'}};
function typedReply(req){return reply(req,Object.fromEntries(Object.keys(req.questions).map(id=>[id,id.startsWith('configuration_match')?'exact':req.state.current_event.chunk_id==='R'?'result_of':'none'])));}

test('relations become visible while a later chunk waits; streaming sends identical semantic requests to batch processing and snapshots restore',async()=>{
 const run=F.createRun(batch,'official',.8,V.questions),late=deferred(),lateEntered=deferred(),edgeReady=deferred(),requests=[];let typed;
 const enqueue=()=>{if(!typed)return;while(run.typed_relation_worker.jobs.length<run.thread_worker.jobs.length){const j=run.thread_worker.jobs[run.typed_relation_worker.jobs.length];if(!['done','error','interrupted'].includes(j.status))break;if(!typed.enqueue(run.meeting_events.find(e=>e.event_id===j.event_id)))break;}};
 const threads=T.start(run,{schemaVersion:5,config:V.threadConfig,send:async req=>reply(req,Object.fromEntries(Object.keys(req.questions).map(id=>[id,'belongs']))),onChange:enqueue});
 typed=TR.start(run,{streaming:true,send:async req=>{requests.push(clone(req));return typedReply(req);},onChange:()=>{if(run.meeting_relations.some(e=>e.review_state==='confirmed'))edgeReady.resolve();}});
 const chunks=F.execute(run,{mode:'burst',wait:async()=>{},send:async req=>{
  const c=batch.cases.find(c=>c.current_utterance===req.state.current_utterance);
  if(c.id==='B'&&req.questions.should_store_memory){lateEntered.resolve();await late.promise;}
  return reply(req,{event_type:c.expected_event_type});
 },onChange:(_,change)=>{if(change.phase==='complete'&&change.record.result?.store)threads.enqueue(run.meeting_events.at(-1));}});
 try{
  await within(Promise.all([lateEntered.promise,edgeReady.promise]));
  assert.equal(run.status,'running');assert.equal(run.thread_worker.status,'running');assert.equal(run.typed_relation_worker.status,'running');
  assert.equal(run.meeting_relations.length,1);assert.equal(run.meeting_relations[0].configuration_match,'exact');assert.equal(run.meeting_events.length,2);
  const partial=F.restore(clone(run));assert.equal(partial.typed_relation_worker.status,'interrupted');assert.equal(partial.typed_relation_worker.input_closed,false);assert.deepEqual(partial.meeting_relations,run.meeting_relations);
  assert.ok(requests.every(r=>!JSON.stringify(r).includes('revision A')),'a future blocked chunk never reaches relation context');
 }finally{late.resolve();}
 await chunks;threads.close();await threads.done;enqueue();typed.close();await typed.done;
 assert.equal(run.typed_relation_worker.schemaVersion,3);assert.equal(run.typed_relation_worker.status,'done');assert.equal(run.typed_relation_worker.input_closed,true);
 const restored=F.restore(clone(run));assert.deepEqual(restored.typed_relation_worker,run.typed_relation_worker);assert.deepEqual(restored.meeting_relations,run.meeting_relations);
 const same=clone(run);delete same.typed_relation_worker;same.meeting_relations=[];const batchRequests=[];
 await TR.start(same,{send:async req=>{batchRequests.push(clone(req));return typedReply(req);}}).done;
 assert.deepEqual(requests,batchRequests);assert.deepEqual(same.meeting_relations,run.meeting_relations);
});

function pendingRun(){return {status:'running',provider:'official',batch:{expected_typed_relations:{}},meeting_events:[{event_id:'E1',chunk_id:'A',type:'observation',text:'First issue',thread_id:null},{event_id:'E2',chunk_id:'B',type:'observation',text:'Second issue',thread_id:null}],meeting_relations:[],thread_worker:{status:'running',jobs:[{event_id:'E1',status:'running'},{event_id:'E2',status:'queued'}]}};}

test('stream enforces finalized thread assignment and chronological input; duplicate enqueue cannot bill twice',async()=>{
 const run=pendingRun();let calls=0;const stream=TR.start(run,{streaming:true,send:async()=>{calls++;throw Error('No assigned thread should call the model');}});
 assert.throws(()=>stream.enqueue(run.meeting_events[1]),/ordem/);assert.throws(()=>stream.enqueue(run.meeting_events[0]),/atribuição/);
 run.thread_worker.jobs[0].status='done';assert.equal(stream.enqueue(run.meeting_events[0]),true);assert.equal(stream.enqueue(run.meeting_events[0]),false);
 run.thread_worker.jobs[1].status='error';stream.enqueue(run.meeting_events[1]);run.status='done';run.thread_worker.status='done';stream.close();await stream.done;
 assert.equal(calls,0);assert.deepEqual(run.typed_relation_worker.jobs.map(j=>j.reason),['thread_pending','thread_pending']);assert.deepEqual(TR.restore(clone(run.typed_relation_worker),run),run.typed_relation_worker);
});

test('idle stop resolves without retry and a prefix snapshot never fabricates jobs for unsettled future events',async()=>{
 const run=pendingRun();const stream=TR.start(run,{streaming:true,send:async()=>assert.fail('No transport during idle wait')});
 run.thread_worker.jobs[0].status='done';stream.enqueue(run.meeting_events[0]);
 await new Promise(r=>setImmediate(r));assert.equal(run.typed_relation_worker.jobs[0].status,'skipped');
 const before=TR.restore(clone(run.typed_relation_worker),run);assert.equal(before.jobs.length,1);assert.equal(before.status,'interrupted');
 stream.stop();await within(stream.done);assert.equal(run.typed_relation_worker.status,'stopped');assert.equal(stream.enqueue(run.meeting_events[1]),false);
 assert.equal(TR.restore(clone(run.typed_relation_worker),run).jobs.length,1);
 const forged=clone(run.typed_relation_worker);forged.status='done';forged.input_closed=true;assert.throws(()=>TR.restore(forged,run),/incompatível/);
});

test('closing before all events arrive is an explicit worker error, not a successful empty execution',async()=>{
 const run=pendingRun();const stream=TR.start(run,{streaming:true,send:async()=>assert.fail('No transport')});stream.close();
 await assert.rejects(stream.done,/antes de receber/);assert.equal(run.typed_relation_worker.status,'error');assert.match(TR.restore(clone(run.typed_relation_worker),run).error,/antes de receber/);
});
