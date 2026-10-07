const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow'),T=require('../relation-worker').threads;
const {clone,chunkOutput,response}=require('./fixtures/thread-scenarios.cjs');
const batch=require('./fixtures/memory-b001-continuity.json');

async function execute(probability=.86) {
  const run=F.createRun(batch,'official'),sent=[];let time=Date.parse('2030-01-01T00:00:00Z');
  const worker=T.start(run,{send:async req=>{
    sent.push(clone(req));
    return response(req,{belongs_to_active_thread:req.state.current_event.chunk_id==='C12'?'uncertain':'belongs'},probability);
  }});
  await F.execute(run,{now:()=>time,send:async req=>{time+=1200;return chunkOutput(req,batch);},onChange:(_,change)=>{
    if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));
  }});
  worker.close();await worker.done;return {run,sent};
}

test('C12 wire payload resolves the five prior chunks and all seven thread events in full, with receipt times',async()=>{
  const {run,sent}=await execute(),req=sent.find(r=>r.state.current_event.chunk_id==='C12'),state=req.state;
  assert.deepEqual(Object.keys(state),['current_event','recent_context','active_thread']);
  assert.deepEqual(state.recent_context.map(c=>c.chunk_id),['C07','C08','C09','C10','C11']);
  assert.deepEqual(state.recent_context,state.recent_context.map(c=>run.raw_window.find(raw=>raw.chunk_id===c.chunk_id)));
  assert.equal(state.recent_context.at(-1).text,'I will reconnect in one minute.');
  assert.ok(state.recent_context.every(c=>/^\d{2}:\d{2}:\d{2}$/.test(c.timestamp)));
  assert.notEqual(state.recent_context[0].timestamp,state.recent_context.at(-1).timestamp);
  const event=run.meeting_events.find(e=>e.event_id==='E008');
  assert.deepEqual(state.current_event,{...event,chunk:run.raw_window.find(c=>c.chunk_id==='C12')});
  assert.equal(state.active_thread.thread_id,'T001');
  assert.deepEqual(state.active_thread.events,run.meeting_events.slice(0,7).map(event=>({...event,chunk:run.raw_window.find(c=>c.chunk_id===event.chunk_id)})));
  assert.equal(state.active_thread.anchor_event_ids,undefined);
  assert.equal(state.active_thread.anchors,undefined);
  assert.equal(state.active_thread.title,undefined);
  assert.equal(JSON.stringify(req).includes('expected_'),false);
  assert.deepEqual(req.questions.belongs_to_active_thread,T.defaults.questions.belongs_to_active_thread);
  assert.match(req.questions.belongs_to_active_thread.criteria.uncertain,/isolated requirements/);
  const job=run.thread_worker.jobs.find(j=>j.chunk_id==='C12');
  assert.deepEqual(job.recent_context,['C07','C08','C09','C10','C11']);
  assert.deepEqual(job.parts[0].request,req,'the audit keeps the exact wire request');
  assert.equal(job.result.reason,'uncertain_active');assert.equal(job.result.thread_id,null);
  assert.equal(job.parts.length,1);assert.equal(run.meeting_threads.length,1);
  assert.deepEqual(Object.keys(run.meeting_threads[0]).sort(),['thread_id','status','created_by_event_id','anchor_event_ids'].sort());
  assert.equal(run.meeting_threads[0].anchor_event_ids.includes('E008'),false);
  const after=sent.find(r=>r.state.current_event.chunk_id==='C13');
  assert.equal(after.state.recent_context.at(-1).chunk_id,'C12','pending chunks stay in the conversation');
  assert.equal(after.state.active_thread.events.some(e=>e.event_id==='E008'),false,'pending events are not thread members');
  assert.equal(after.state.current_event.thread_id,null,'later assignments must not leak into the saved request');
  assert.ok(run.thread_worker.jobs.filter(job=>job.chunk_id!=='C13').every(job=>T.audit(run,job).matches));
  const action=T.audit(run,run.thread_worker.jobs.find(job=>job.chunk_id==='C13')).checks.find(check=>check.key==='expected_action');
  assert.deepEqual(action,{key:'expected_action',expected:'assign_active_thread',actual:'keep_active_thread',matches:false});
  assert.deepEqual(F.restore(clone(run)).thread_worker,run.thread_worker);
  const report=F.exportResults({run});
  assert.deepEqual(report.question_results.find(q=>q.worker==='threads'&&q.chunk_id==='C12').request,req);
});

test('legacy v2 calls restore byte-for-byte; default upgrade is limited to new executions',()=>{
  const saved=clone(require('./fixtures/memory-threads-v2.json')),before=JSON.stringify(saved);
  const restored=F.restore(saved);
  assert.equal(restored.thread_worker.schemaVersion,2);
  assert.deepEqual(restored.thread_worker,saved.thread_worker);
  assert.equal(JSON.stringify(saved),before);
  const config=T.currentConfig(restored.thread_worker.config);
  assert.deepEqual(config,T.defaults);
  assert.notDeepEqual(config,restored.thread_worker.config);
  const custom=clone(restored.thread_worker.config);custom.questions.belongs_to_active_thread.instructions+=' Custom instructions.';
  assert.deepEqual(T.currentConfig(custom).questions.belongs_to_active_thread,custom.questions.belongs_to_active_thread);
});

test('the supplied pending-event rubric and the previous default upgrade only by exact match',()=>{
  for(const question of require('./fixtures/thread-continuity-previous-questions.json')) {
    const config={questions:{...clone(T.defaults.questions),belongs_to_active_thread:clone(question)}},before=clone(config);
    assert.deepEqual(T.currentConfig(config),T.defaults);
    assert.deepEqual(config,before,'saved question versions must not change');
    config.questions.belongs_to_active_thread.criteria.belongs+=' Preserve my custom rule.';
    assert.deepEqual(T.currentConfig(config),config,'unrelated custom edits remain user-owned');
  }
});

test('pending C13 remains in C14 context without being inserted into active_thread.events',async()=>{
  const run=F.createRun(batch,'official');
  const worker=T.start(run,{send:async req=>{
    const id=req.state.current_event.chunk_id;
    return response(req,{belongs_to_active_thread:id==='C12'?'uncertain':'belongs'},id==='C13'?.78:.94);
  }});
  await F.execute(run,{send:async req=>chunkOutput(req,batch),onChange:(_,change)=>{
    if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));
  }});
  worker.close();await worker.done;
  const c13=run.thread_worker.jobs.find(job=>job.chunk_id==='C13'),c14=run.thread_worker.jobs.find(job=>job.chunk_id==='C14');
  assert.equal(c13.result.reason,'low_confidence_active');
  const state=c14.parts[0].request.state;
  assert.equal(state.recent_context.at(-1).chunk_id,'C13');
  assert.equal(state.recent_context.at(-1).text,batch.cases.find(item=>item.id==='C13').current_utterance);
  assert.equal(state.active_thread.events.some(event=>event.chunk_id==='C13'),false);
  assert.equal(c14.result.thread_id,'T001');
  assert.equal(T.assignmentThreshold,.8,'the fix must not lower the confidence gate');
  assert.equal(c13.parts[0].output.response.answers.belongs_to_active_thread.probabilities.belongs,.78);
  assert.deepEqual(F.restore(clone(run)).thread_worker,run.thread_worker);
});

test('missing chunk IDs and tampered expanded events are rejected, never shortened or guessed',async()=>{
  const {run}=await execute();
  const unknown=clone(run);unknown.thread_worker.jobs[1].recent_context=['C999'];
  assert.throws(()=>F.restore(unknown),/contexto/);
  assert.throws(()=>T.chunkFor(run,'C999'),/Chunk ausente/);
  for(const field of ['timestamp','status','text','thread_id']) {
    const corrupt=clone(run);corrupt.thread_worker.jobs[1].parts[0].request.state.active_thread.events[0][field]='corrupted';
    assert.throws(()=>F.restore(corrupt),/snapshot/);
  }
  const corrupt=clone(run);corrupt.thread_worker.jobs[1].parts[0].request.state.current_event.chunk.text='corrupted';
  assert.throws(()=>F.restore(corrupt),/snapshot/);
});
