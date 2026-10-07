const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads;
const input=require('./fixtures/memory-b001-thread-results.json');
const {scenario,clone,threadOutput,chunkOutput}=require('./fixtures/thread-scenarios.cjs');
async function execute(batch=input,send=threadOutput){
  const run=F.createRun(batch,'official'),requests=[],now=()=>Date.parse('2030-01-01T00:00:00Z');
  const worker=T.start(run,{now,send:async req=>{requests.push(clone(req));return send(req);}});
  await F.execute(run,{now,mode:'burst',wait:async()=>{},send:async req=>chunkOutput(req,batch),onChange:(_,c)=>{if(c.phase==='complete'&&c.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
  worker.close();await worker.done;return {run,requests};
}
const audit=(run,id)=>T.audit(run,run.thread_worker.jobs.find(j=>j.chunk_id===id));
const check=(a,key)=>a.checks.find(c=>c.key===key);

test('exact input with active-thread IDs, archive-result maps, keep action and relation labels is preserved',()=>{
  const before=clone(input),validated=F.validateBatch(input);
  assert.deepEqual(validated,input);assert.deepEqual(input,before);assert.notEqual(validated,input);
  assert.deepEqual(validated.expected_threads.C12.expected_archive_results,{});
  assert.deepEqual(validated.expected_threads.C13.expected_archive_results,{T001:'belongs'});
  assert.equal(validated.expected_threads.C03.expected_action,'keep_active_thread');
  assert.deepEqual(validated.expected_relations,input.expected_relations);
  assert.doesNotThrow(()=>F.validateBatch({...input,expected_threads:{C01:{expected_active_thread_id:null,expected_archive_results:{}}}}));
});
test('new expectation fields reject invalid IDs/results without weakening the old formats',()=>{
  for(const spec of [
    {expected_active_thread_id:1},{expected_active_thread_id:'E001'},{expected_archive_results:null},{expected_archive_results:[]},
    {expected_archive_results:true},{expected_archive_results:{C01:'belongs'}},{expected_archive_results:{T001:true}},
    {expected_archive_results:{T001:'yes'}},{expected_archive_results:{T001:null}},{expected_archive_results:{T001:{result:'belongs'}}},
    {expected_action:'keep_thread'},{expected_archive_result:'belongs'},{wrong_field:'value'}
  ])assert.throws(()=>F.validateBatch({...input,expected_threads:{C03:spec}}));
  for(const spec of ['T001',null,{expected_action:'assign_active_thread',expected_thread_id:'T001'},{expected_archive_match:'T001',expected_archive_result:'belongs'}])assert.doesNotThrow(()=>F.validateBatch({...input,expected_threads:{C03:spec}}));
});
test('active ID checks use the pre-assignment snapshot and action names must match literally',async()=>{
  const {run,requests}=await execute();assert.equal(requests.length,11);assert.equal(run.calls,26);
  assert.equal(run.meeting_threads.find(t=>t.status==='active').thread_id,'T001');
  const back=audit(run,'C13');assert.deepEqual(check(back,'expected_active_thread_id'),{key:'expected_active_thread_id',expected:'T002',actual:'T002',matches:true});
  assert.deepEqual(check(back,'expected_archive_results').actual,{T001:'belongs'});
  assert.deepEqual(check(audit(run,'C12'),'expected_archive_results').actual,{});
  for(const job of run.thread_worker.jobs){const a=T.audit(run,job);assert.equal(a.matches,true,job.chunk_id);assert.ok(a.checks.every(c=>c.matches===true));assert.ok(a.responses.every(r=>r.matches===true));}
  const keep=check(audit(run,'C03'),'expected_action');assert.equal(keep.expected,'keep_active_thread');assert.equal(keep.actual,'keep_active_thread');assert.equal(keep.matches,true);
  const legacy=clone(run);legacy.batch.expected_threads.C03.expected_action='assign_active_thread';assert.equal(check(audit(legacy,'C03'),'expected_action').matches,false);
  assert.equal(legacy.batch.expected_threads.C03.expected_action,'assign_active_thread','the input is never rewritten to agree with the result');
  assert.equal(F.exportResults({run}).thread_assignments.find(job=>job.chunk_id==='C03').action,'keep_active_thread');
  assert.equal(run.relation_worker,undefined);assert.deepEqual(run.meeting_relations,[]);
  assert.ok(requests.every(r=>!JSON.stringify(r).match(/expected_|has_relation/)));
});
test('wrong active ID, archive choices, missing/extra archive IDs fail even with a correct final assignment',async()=>{
  const {run}=await execute();
  for(const patch of [
    {expected_active_thread_id:'T001'}, {expected_archive_results:{T001:'does_not_belong'}},
    {expected_archive_results:{}}, {expected_archive_results:{T001:'belongs',T009:'does_not_belong'}},
    {expected_action:'keep_active_thread'}
  ]) {
    const changed=clone(run);Object.assign(changed.batch.expected_threads.C13,patch);
    const a=audit(changed,'C13');assert.equal(a.actual,'T001');assert.equal(a.matches,false);assert.equal(a.tone,'fail');assert.ok(a.checks.some(c=>c.matches===false));
    if(patch.expected_archive_results?.T001==='does_not_belong')assert.equal(a.responses.find(r=>r.part.stage==='archive').matches,false);
  }
});
test('archive maps compare by thread ID regardless of key order and accept uncertain/conflicting results',async()=>{
  const batch=clone(scenario);
  batch.expected_threads.return={expected_active_thread_id:'T003',expected_active_result:'does_not_belong',expected_archive_results:{T002:'does_not_belong',T001:'belongs'},expected_action:'reactivate_thread',expected_thread_id:'T001'};
  batch.expected_threads.archive_uncertain={expected_archive_results:{T003:'does_not_belong',T002:'uncertain'},expected_action:'assignment_pending',expected_thread_id:null};
  batch.expected_threads.archive_conflict={expected_archive_results:{T003:'belongs',T002:'belongs'},expected_action:'assignment_pending',expected_thread_id:null};
  const {run}=await execute(batch);
  for(const id of ['return','archive_uncertain','archive_conflict']){const a=audit(run,id);assert.equal(a.matches,true);assert.equal(check(a,'expected_archive_results').matches,true);assert.ok(a.responses.every(r=>r.matches===true||r.matches===null));}
  assert.deepEqual(Object.keys(check(audit(run,'return'),'expected_archive_results').actual),['T001','T002']);
});
test('labels cannot affect prompts, candidate threads, decisions or call counts',async()=>{
  const baseline=await execute(),batch=clone(input);delete batch.expected_relations;
  batch.expected_threads={C03:{expected_active_thread_id:'T999',expected_action:'create_new_thread'},C13:{expected_archive_results:{}}};
  const changed=await execute(batch);assert.deepEqual(changed.requests,baseline.requests);
  assert.deepEqual(changed.run.meeting_events,baseline.run.meeting_events);assert.deepEqual(changed.run.meeting_threads,baseline.run.meeting_threads);
  assert.equal(audit(changed.run,'C03').matches,false);assert.equal(audit(changed.run,'C13').matches,false);
});
test('explicit save/reload and JSON/CSV retain the original new gabarito and per-question expected values',async()=>{
  const {run}=await execute(),library=F.emptyLibrary(),saved=F.saveTest(library,input,run.questions,run);
  const restored=F.validateLibrary(clone(library)).tests[0].run;assert.deepEqual(restored.batch,input);
  const report=F.exportResults({run:restored,testId:saved.id});assert.deepEqual(report.input,input);
  const source=report.thread_assignments.find(a=>a.chunk_id==='C13');assert.ok(source.checks.every(c=>c.matches===true));
  assert.deepEqual(source.expected.expected_archive_results,{T001:'belongs'});
  const answer=report.question_results.find(q=>q.chunk_id==='C13'&&q.question_id==='belongs_to_archive_thread__T001');assert.equal(answer.expected,'belongs');assert.equal(answer.matches,true);
  assert.equal(report.summary.relation_calls,0);assert.equal(report.configuration.relation_worker,null);
  const csv=F.resultsCsv(report);for(const value of ['expected_active_thread_id','expected_archive_results','keep_active_thread','thread_check'])assert.ok(csv.includes(value));
  assert.ok(csv.includes('{""T001"":""belongs""}'));assert.ok(!csv.includes('[object Object]'));
});
test('unfinished or failed archive queries do not become a successful empty-map comparison',async()=>{
  const {run}=await execute(input,req=>{if(req.state.candidate_threads)throw Error('Fixture archive failure');return threadOutput(req);});
  const a=audit(run,'C13');assert.equal(a.tone,'error');assert.equal(a.matches,null);assert.equal(check(a,'expected_archive_results').matches,null);
  assert.doesNotThrow(()=>F.restore(clone(run)));
});
