const {test}=require('node:test'),assert=require('node:assert/strict'),{setTimeout:sleep}=require('node:timers/promises');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads;
const {requested,scenario,threadOutput,chunkOutput,response,clone}=require('./fixtures/thread-scenarios.cjs');
async function until(check){for(let i=0;i<300;i++){if(check())return;await sleep(3);}throw Error('Timed out');}
async function execute(batch=requested,send=threadOutput,config=T.defaults){
  const run=F.createRun(batch,'official'),requests=[];
  const worker=T.start(run,{config,send:async req=>{requests.push(clone(req));return send(req);}});
  await F.execute(run,{mode:'burst',wait:async()=>{},send:async req=>chunkOutput(req,batch),onChange:(_,c)=>{if(c.phase==='complete'&&c.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
  worker.close();await worker.done;return {run,requests};
}
test('exact structured expected_threads is accepted unchanged, without fixed chunk/event IDs',()=>{
  assert.deepEqual(F.validateBatch(requested),requested);
  const renamed=clone(scenario);assert.doesNotThrow(()=>F.validateBatch(renamed));
  for(const invalid of [{unknown:'T001'},{C01:{}},{C01:{expected_archive_result:'belongs'}},{C01:{expected_action:'random'}},{C01:{expected_active_result:true}},{C01:{expected_thread_id:4}},{C01:{expected_archive_match:null,expected_archive_result:'belongs'}}])assert.throws(()=>F.validateBatch({...requested,expected_threads:invalid}));
  assert.doesNotThrow(()=>F.validateBatch({...requested,expected_threads:{C01:'T001',C03:null}}));
});
test('provided choice templates are editable and preserve exact criteria, accepting the raw question dictionary',()=>{
  const fixture=require('./fixtures/active-thread-base.json');
  assert.deepEqual(T.defaults.questions.belongs_to_active_thread,fixture.questions.belongs_to_active_thread);
  const config=clone(T.defaults);config.questions.belongs_to_active_thread.instructions='Edited active prompt';config.questions.belongs_to_archive_thread.criteria.belongs='Edited archive criterion';
  assert.deepEqual(T.validateConfig(config.questions),config);
  assert.deepEqual(T.validateConfig({belongs_to_active_thread:config.questions.belongs_to_active_thread},T.defaults).questions.belongs_to_archive_thread,T.defaults.questions.belongs_to_archive_thread);
  assert.deepEqual(T.validateConfig({questions:{belongs_to_archive_thread:config.questions.belongs_to_archive_thread}},T.defaults).questions.belongs_to_archive_thread,config.questions.belongs_to_archive_thread);
  for(const mutate of [q=>delete q.belongs_to_archive_thread,q=>q.belongs_to_active_thread.type='noul',q=>q.belongs_to_active_thread.criteria.extra='Extra']){const q=clone(config.questions);mutate(q);assert.throws(()=>T.validateConfig(q));}
});
test('user example creates, continues and reactivates threads with every assigned event as an anchor',async()=>{
  const {run,requests}=await execute();
  assert.equal(run.thread_worker.calls,11);assert.equal(run.calls,26);assert.equal(requests.length,11);
  assert.deepEqual(run.meeting_threads.map(t=>[t.thread_id,t.status,t.anchor_event_ids]),[
    ['T001','active',['E001','E002','E003','E004','E005','E006','E007','E009','E010','E011']],['T002','archived',['E008']]
  ]);
  assert.equal(run.meeting_threads[0].title,undefined);
  assert.equal(run.meeting_threads[0].created_by_event_id,'E001');
  assert.equal(run.meeting_events.find(e=>e.chunk_id==='C12').thread_id,'T002');assert.deepEqual(run.meeting_relations,[]);
  assert.equal(run.relation_worker,undefined);assert.equal(run.relations,undefined);
  assert.ok(run.meeting_events.every(e=>!Object.hasOwn(e,'store_confidence')&&!Object.hasOwn(e,'type_confidence')));
  assert.ok(requests.every(r=>!JSON.stringify(r).match(/confidence|expected_|has_relation/)));
  assert.deepEqual(requests.find(r=>r.state.current_event.chunk_id==='C15').state.active_thread.events.map(e=>e.event_id),['E001','E002','E003','E004','E005','E006','E007','E009','E010']);
  for(const job of run.thread_worker.jobs){const a=T.audit(run,job);assert.equal(a.matches,true,job.chunk_id);assert.ok(a.checks.every(c=>c.matches===true));assert.ok(a.responses.every(r=>r.matches===true));}
  assert.deepEqual(run.raw_window.map(c=>c.chunk_id),requested.cases.map(c=>c.id));
});
test('same numeric wording stays in its active subject, explicit return evaluates all archives in one request',async()=>{
  const {run,requests}=await execute(scenario),events=Object.fromEntries(run.meeting_events.map(e=>[e.chunk_id,e]));
  assert.equal(events.test_bracket.text,events.test_sensor.text);assert.equal(events.test_bracket.thread_id,'T001');assert.equal(events.test_sensor.thread_id,'T002');assert.equal(events.return.thread_id,'T001');
  const call=requests.find(r=>r.state.current_event.chunk_id==='return'&&r.state.candidate_threads);
  assert.deepEqual(Object.keys(call.questions),['belongs_to_archive_thread__T001','belongs_to_archive_thread__T002']);
  assert.deepEqual(call.state.candidate_threads.map(t=>t.events.map(e=>e.chunk_id)),[['bracket','cause','test_bracket'],['sensor','sensor_cause','test_sensor']]);
  assert.ok(call.questions.belongs_to_archive_thread__T002.instructions.includes('thread_id "T002"'));
  assert.equal(events.ambiguous.thread_id,null);assert.equal(events.archive_uncertain.thread_id,null);assert.equal(events.archive_conflict.thread_id,null);
  assert.equal(run.meeting_threads.length,3);assert.equal(run.meeting_threads.find(t=>t.thread_id==='T001').status,'active');
  assert.equal(requests.filter(r=>r.state.current_event.chunk_id==='ambiguous').length,2,'uncertain queries the existing archives before remaining pending');
  assert.ok(run.thread_worker.jobs.every(j=>T.audit(run,j).matches));
});
test('context freezes last five prior received chunks including ignored utterances; secondary backlog never blocks chunks',async()=>{
  const batch=clone(requested);for(let i=16;i<=23;i++)batch.cases.push({id:'C'+i,current_utterance:'Filler '+i,expected_store_memory:false,expected_event_type:null});
  const run=F.createRun(batch,'official');let release,calls=0;
  const worker=T.start(run,{send:async req=>{if(++calls===1)await new Promise(r=>release=r);return threadOutput(req);}});
  await F.execute(run,{mode:'burst',wait:async()=>{},send:async req=>{await sleep(1);return chunkOutput(req,batch);},onChange:(_,c)=>{if(c.phase==='complete'&&c.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
  assert.equal(run.status,'done');assert.equal(run.thread_worker.jobs[1].status,'running');assert.equal(run.thread_worker.jobs.at(-1).status,'queued');
  assert.deepEqual(run.raw_window.map(c=>c.chunk_id),batch.cases.slice(-15).map(c=>c.id));
  const job=run.thread_worker.jobs.find(j=>j.chunk_id==='C08');assert.deepEqual(job.recent_context,['C03','C04','C05','C06','C07']);
  const restored=F.restore(clone(run));assert.equal(restored.thread_worker.status,'interrupted');assert.equal(restored.meeting_threads[0].anchor_event_ids.length,1);
  assert.deepEqual(F.restore(clone(restored)).thread_worker,restored.thread_worker);
  worker.close();release();await worker.done;
  assert.deepEqual(job.parts[0].request.state.recent_context,job.recent_context.map(id=>T.chunkFor(run,id)));
  assert.ok(!JSON.stringify(job.parts[0].request.state).includes('Filler 23'));
});
test('structured gabarito audits each stage independently even when the final thread ID matches',async()=>{
  const {run}=await execute();const job=run.thread_worker.jobs.find(j=>j.chunk_id==='C13');
  for(const wrong of [{expected_active_result:'belongs'},{expected_action:'create_new_thread'},{expected_archive_match:'T999'},{expected_archive_result:'does_not_belong'}]) {
    const changed=clone(run);Object.assign(changed.batch.expected_threads.C13,wrong);const a=T.audit(changed,changed.thread_worker.jobs.find(j=>j.chunk_id==='C13'));assert.equal(a.actual,'T001');assert.equal(a.matches,false);assert.equal(a.tone,'fail');assert.ok(a.checks.some(c=>c.matches===false));
  }
  delete run.batch.expected_threads.C13;const unknown=T.audit(run,job);assert.equal(unknown.matches,null);assert.equal(unknown.tone,'');
  const low=await execute(requested,req=>{const out=threadOutput(req);const a=Object.values(out.response.answers)[0];for(const k of Object.keys(a.probabilities))a.probabilities[k]=k===a.choice?.7:.15;return out;});
  assert.equal(T.audit(low.run,low.run.thread_worker.jobs[1]).tone,'fail','expected assignment is a mismatch when confidence leaves it pending');
  assert.equal(low.run.meeting_events[1].thread_id,null);
  assert.equal(low.run.meeting_events[1].thread_assignment_state,'pending');
  assert.equal(low.run.meeting_threads.length,1);
  assert.deepEqual(low.run.meeting_threads[0].anchor_event_ids,['E001']);
});
test('manual saved versions, thread state, prompts, scores and step gabarito survive restore and JSON/CSV export',async()=>{
  const {run}=await execute(),library=F.emptyLibrary(),test=F.saveTest(library,run.batch,run.questions,run);
  assert.equal(test.threadVersion,'TQ001');assert.equal(library.relationVersions.length,0);const restored=F.validateLibrary(clone(library)).tests[0].run;
  assert.deepEqual(restored.meeting_threads,run.meeting_threads);assert.deepEqual(restored.meeting_events,run.meeting_events);
  const forged=clone(restored);forged.meeting_events[0].thread_id='T999';forged.meeting_threads[0].title='Forged';assert.deepEqual(F.restore(forged).meeting_threads,run.meeting_threads);
  const altered=clone(restored);altered.thread_worker.jobs[1].parts[0].request.state.active_thread.events[0].text='Forged';assert.throws(()=>F.restore(altered),/snapshot/);
  const wrong=clone(restored);wrong.thread_worker.jobs[1].result.thread_id='T999';assert.throws(()=>F.restore(wrong),/respostas/);
  const report=F.exportResults({run:restored,testId:test.id});assert.equal(report.thread_assignments.length,11);assert.equal(report.summary.thread_calls,11);assert.equal(report.configuration.raw_window_limit,15);assert.equal(report.thread_question_version,'TQ001');
  assert.ok(report.question_results.filter(q=>q.worker==='threads').every(q=>q.matches===true&&q.request&&q.output));
  const assignment=report.thread_assignments.find(a=>a.chunk_id==='C13');assert.equal(assignment.action,'reactivate_thread');assert.equal(assignment.checks.length,5);
  const csv=F.resultsCsv(report);for(const label of ['thread_assignment','thread_call','thread_job','TQ001','belongs_to_archive_thread__T001','reactivate_thread'])assert.ok(csv.includes(label));
});
test('large archived sets batch by real API limits, keeping all anchor texts; oversized threads fail visibly',()=>{
  const event={event_id:'E999',chunk_id:'C999',text:'New event',type:'observation',status:'active'};
  const archives=Array.from({length:70},(_,i)=>({thread_id:'T'+String(i+1).padStart(3,'0'),status:'archived',anchor_event_ids:['E'+i],anchors:[{event_id:'E'+i,text:'Full anchor '+i,type:'observation'}]}));
  const plan=T.plan(event,[],archives,T.defaults,'archive');assert.equal(plan.length,3);assert.deepEqual(plan.flatMap(p=>p.candidate_ids),archives.map(t=>t.thread_id));
  const oversized=T.plan(event,[],[{...archives[0],anchors:[{event_id:'E1',text:'a'.repeat(16000)}]}],T.defaults,'active');assert.equal(oversized[0].status,'error');assert.equal(oversized[0].request,undefined);assert.match(oversized[0].error,/Nenhum anchor/);
});
test('errors and stop cannot produce assignments, spawn new threads or retry; saved partial execution remains inspectable',async()=>{
  for(const stop of [false,true]) {
    const run=F.createRun(scenario,'official');let release;
    const worker=T.start(run,{send:async()=>{if(stop)await new Promise(r=>release=r);throw Error('Fixture failure');}});
    await F.execute(run,{mode:'burst',wait:async()=>{},send:async req=>chunkOutput(req,scenario),onChange:(_,c)=>{if(c.phase==='complete'&&c.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
    worker.close();if(stop){await until(()=>!!release);worker.stop();release();}await worker.done;
    assert.equal(run.meeting_threads.length,1);assert.equal(run.meeting_threads[0].anchor_event_ids.length,1);assert.ok(run.meeting_events.slice(1).every(e=>e.thread_id===null));
    assert.equal(run.thread_worker.calls,stop?1:run.meeting_events.length-1);assert.doesNotThrow(()=>F.restore(clone(run)));
  }
});
