const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),R=require('../relation-worker.js');
const fixture=require('./fixtures/memory-b001.json');
const positiveFixture=require('./fixtures/memory-b001-positive-relations.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const response=(request,answers)=>({request:clone(request),response:{model:'local-fixture',answers},provider:'official',latencyMs:1});
async function execute(batch=fixture,config=R.defaults,probabilities={}) {
  const run=F.createRun(batch,'official'),sent=[],relationSent=[];
  const worker=R.start(run,{config,send:async request=>{
    relationSent.push(clone(request));
    return response(request,Object.fromEntries(request.state.candidates.map(candidate=>[
      'has_relation__'+candidate.event_id,{type:'noul',noul:typeof probabilities==='function'?probabilities(request.state.current_event.chunk_id,candidate.chunk_id):probabilities[candidate.chunk_id]??.98}
    ])));
  }});
  await F.execute(run,{send:async request=>{
    sent.push(clone(request));
    const item=batch.cases.find(item=>item.current_utterance===request.state.current_utterance);
    return response(request,request.questions.should_store_memory
      ? {should_store_memory:{type:'noul',noul:item.expected_store_memory?.96:.03}}
      : {event_type:{type:'choice',choice:item.expected_event_type,confidence:.5,probabilities:Object.fromEntries(Object.keys(request.questions.event_type.criteria).map(type=>[type,type===item.expected_event_type?1:0]))}});
  },onChange:(_,change)=>{
    if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));
  }});
  worker.close();await worker.done;
  return {run,sent,relationSent};
}
const audit=(run,chunkId)=>R.auditJob(run,run.relation_worker.jobs.find(job=>job.event_id===run.meeting_events.find(event=>event.chunk_id===chunkId).event_id));

test('exact B001 input is accepted unchanged, including requirement and nested chunk-keyed expectations',()=>{
  const before=clone(fixture),valid=F.validateBatch(fixture);
  assert.deepEqual(valid,fixture);assert.notEqual(valid.expected_relations,fixture.expected_relations);
  assert.deepEqual(F.typesFor(),F.types);assert.ok(F.types.includes('requirement'));
  valid.expected_relations.C08.expected_candidates.push('C03');
  valid.expected_relations.C08.candidate_expectations.C04.has_relation=false;
  assert.deepEqual(fixture,before,'validation makes an independent copy');
  const custom=clone(F.questions);delete custom.event_type.criteria.requirement;
  assert.throws(()=>F.validateBatch(fixture,custom),/requirement.*não existe/,'custom contracts are never silently rewritten');
});

test('B001 compares every prior event: 55 questions, no self/future events or labels in requests',async()=>{
  const {run,sent,relationSent}=await execute();
  assert.equal(run.records.length,15);assert.equal(run.calls,26);assert.equal(run.meeting_events.length,11);
  assert.ok(run.records.every(record=>record.result.verdict==='pass'));
  assert.equal(run.meeting_events.find(event=>event.chunk_id==='C12').status,'active');
  assert.deepEqual(F.queues(run).ignored.map(item=>item.chunk_id),['C02','C05','C07','C11']);
  assert.deepEqual(run.raw_window.map(item=>item.chunk_id),run.batch.cases.map(item=>item.id));
  assert.equal(relationSent.length,10);assert.equal(relationSent.reduce((n,r)=>n+Object.keys(r.questions).length,0),55);
  assert.deepEqual(relationSent[3].state.candidates.map(event=>event.chunk_id),['C01','C03','C04','C06']);
  assert.deepEqual(Object.keys(relationSent[3].questions),['has_relation__E001','has_relation__E002','has_relation__E003','has_relation__E004']);
  for(const [i,req] of relationSent.entries()) assert.deepEqual(req.state.candidates.map(e=>e.event_id),run.meeting_events.slice(0,i+1).map(e=>e.event_id));
  const current=audit(run,'C08');assert.equal(current.current.event_id,'E005');
  assert.deepEqual(current.approved.map(pair=>pair.target.chunk_id),['C01','C03','C04','C06']);
  assert.deepEqual(current.rejected,[]);
  assert.ok(current.pairs.every(pair=>pair.expectedCandidateSource===null&&pair.filterTone===''));
  assert.deepEqual(current.positive.map(pair=>pair.resultTone),['fail','fail','pass','pass']);
  const later=audit(run,'C15');assert.equal(later.positive.length,10);
  assert.ok(later.pairs.every(pair=>pair.expectedCandidateSource===null&&pair.expectedRelation===false));
  assert.ok(later.positive.every(pair=>pair.resultTone==='fail'),'unlisted positives are false positives');
  for(const request of sent) assert.deepEqual(Object.keys(request.state),['current_utterance']);
  for(const request of [...sent,...relationSent]) assert.doesNotMatch(JSON.stringify(request),/expected_|candidate_expectations/);
  const restored=F.restore(clone(run));assert.deepEqual(restored.batch,fixture);
  assert.deepEqual(audit(restored,'C08'),current);
  const library=F.emptyLibrary();F.saveTest(library,fixture,run.questions,run);
  assert.deepEqual(F.validateLibrary(clone(library)).tests[0].batch,fixture);
});

test('old candidate rules and expected_candidates cannot limit new calls or create fake filter failures',async()=>{
  const config={...clone(R.defaults),candidate_rules:{test_result:[]}};
  const {run,relationSent}=await execute(fixture,config);
  assert.deepEqual(relationSent[3].state.candidates.map(event=>event.chunk_id),['C01','C03','C04','C06']);
  const view=audit(run,'C08');
  assert.ok(view.pairs.every(pair=>pair.expectedCandidate===null&&pair.filterTone===''&&!pair.blocked));
  assert.equal(view.rejected.length,0);assert.ok(view.pairs.every(pair=>pair.obtained===true));
});

test('nested relation expectations compare response and confidence separately; unlisted answers default to false in new runs',async()=>{
  const source=clone(fixture);
  source.expected_relations.C08.candidate_expectations.C04.has_relation=false;
  const {run}=await execute(source,R.defaults,{C04:.04,C06:.7});
  let view=audit(run,'C08');
  assert.equal(view.negative[0].resultTone,'pass');assert.equal(view.negative[0].probability,.96);
  assert.equal(view.positive.at(-1).resultTone,'warning');assert.equal(view.positive.at(-1).retained,false);
  run.batch.expected_relations.C08.candidate_expectations.C04.has_relation=true;
  assert.equal(audit(run,'C08').negative[0].resultTone,'fail');
  delete run.batch.expected_relations.C08.candidate_expectations.C06;
  view=audit(run,'C08');assert.equal(view.positive.at(-1).expectedRelation,false);assert.equal(view.positive.at(-1).matches,false);
  run.batch.expected_relations.C08={candidate_expectations:{C04:{has_relation:false}}};
  assert.ok(audit(run,'C08').pairs.every(pair=>pair.expectedCandidateSource===null));
  run.batch.expected_relations.C08={expected_candidates:[]};
  view=audit(run,'C08');assert.ok(view.approved.every(pair=>pair.filterTone===''));
  assert.ok(view.pairs.every(pair=>pair.expectedRelation===false));
  run.batch.expected_relations={};assert.ok(audit(run,'C08').pairs.every(pair=>pair.expectedCandidateSource===null));
});

test('nested schema rejects malformed booleans, IDs, duplicates, future/self targets and unknown keys',()=>{
  for(const bad of [null,true,'C08',{missing:{expected_candidates:[]}},{C08:null},{C08:[]},
    {C08:{extra:[]}},{C08:{expected_candidates:'C04'}},{C08:{expected_candidates:['C04','C04']}},
    {C08:{expected_candidates:['C08']}},{C08:{expected_candidates:['C12']}},{C08:{expected_candidates:['missing']}},
    {C08:{candidate_expectations:null}},{C08:{candidate_expectations:[]}},{C08:{candidate_expectations:{C04:{}}}},
    {C08:{candidate_expectations:{C04:{has_relation:'true'}}}},{C08:{candidate_expectations:{C04:{has_relation:null}}}},
    {C08:{candidate_expectations:{C04:{has_relation:true,score:1}}}},{C08:{candidate_expectations:{C04:true}}},
    {C08:{candidate_expectations:{C08:{has_relation:true}}}},{C08:{candidate_expectations:{C12:{has_relation:false}}}},
    {C08:{candidate_expectations:{missing:{has_relation:true}}}}]) {
    assert.throws(()=>F.validateBatch({...fixture,expected_relations:bad}),JSON.stringify(bad));
  }
  for(const value of [{},{C08:{}},{C08:{expected_candidates:[]}},{C08:{candidate_expectations:{}}}]) {
    assert.deepEqual(F.validateBatch({...fixture,expected_relations:value}).expected_relations,value);
  }
  const ids=JSON.parse('{"batch_id":"KEYS","cases":[{"id":"__proto__","current_utterance":"Candidate","expected_store_memory":true,"expected_event_type":"hypothesis"},{"id":"constructor","current_utterance":"Source","expected_store_memory":true,"expected_event_type":"test_result"}],"expected_relations":{"constructor":{"expected_candidates":["__proto__"],"candidate_expectations":{"__proto__":{"has_relation":true}}}}}');
  assert.deepEqual(F.validateBatch(ids),ids);
});

test('exact positive-only user input completes all 55 actual pairs by chunk ID, survives saves and exports without unknown verdicts',async()=>{
  const before=clone(positiveFixture);
  assert.deepEqual(F.validateBatch(positiveFixture),positiveFixture);
  const {run,sent,relationSent}=await execute(positiveFixture,R.defaults,(source,target)=>positiveFixture.expected_relations[source]?.[target]?.has_relation === true ? .98 : .03);
  const report=F.exportResults({run}),rows=report.question_results.filter(q=>q.worker==='relations');
  assert.equal(run.relation_worker.schemaVersion,3);assert.equal(rows.length,55);
  assert.equal(rows.filter(q=>q.expected===true).length,21);assert.equal(rows.filter(q=>q.expected===false).length,34);
  assert.ok(rows.every(q=>typeof q.expected==='boolean' && q.matches===true && q.verdict==='pass'));
  assert.equal(report.configuration.relation_expectation_policy,'positives_only');
  assert.ok(rows.every(q=>!['C02','C05','C07','C11'].includes(q.chunk_id)&&!['C02','C05','C07','C11'].includes(q.target_chunk_id)));
  assert.equal(rows.find(q=>q.chunk_id==='C03').expected,false,'empty source means all false');
  assert.ok(rows.filter(q=>q.chunk_id==='C12').every(q=>q.expected===false));
  assert.deepEqual(audit(run,'C08').pairs.map(p=>[p.target.chunk_id,p.expectedRelation]),[['C01',true],['C03',false],['C04',true],['C06',true]]);
  for(const request of [...sent,...relationSent]) assert.doesNotMatch(JSON.stringify(request),/expected_|candidate_expectations/);
  assert.deepEqual(F.restore(clone(run)),run);assert.deepEqual(report.input,positiveFixture);
  const library=F.emptyLibrary();F.saveTest(library,run.batch,run.questions,run);
  assert.deepEqual(F.validateLibrary(clone(library)).tests[0].batch,positiveFixture);
  assert.deepEqual(positiveFixture,before);
  const missing=clone(run);delete missing.batch.expected_relations.C15;
  assert.ok(audit(missing,'C15').pairs.every(p=>p.expectedRelation===false && typeof p.matches==='boolean'));
  delete missing.batch.expected_relations;
  assert.ok(missing.relation_worker.jobs.flatMap(job=>R.auditJob(missing,job).pairs).every(p=>p.expectedRelation===false && typeof p.matches==='boolean'));
});

test('direct maps reject malformed labels and invalid directions, accept explicit false and special chunk IDs',()=>{
  for(const group of [{C04:true},{C04:{}},{C04:{has_relation:'true'}},{C04:{has_relation:null}},{C04:{has_relation:true,extra:1}},{C08:{has_relation:true}},{C12:{has_relation:true}},{missing:{has_relation:true}},{candidate_expectations:{},C04:{has_relation:true}}]) {
    assert.throws(()=>F.validateBatch({...fixture,expected_relations:{C08:group}}));
  }
  const value={...fixture,expected_relations:{C08:{C04:{has_relation:false}}}};
  assert.deepEqual(F.validateBatch(value),value);
  const special={batch_id:'KEYS',cases:[{...fixture.cases[0],id:'__proto__'},{...fixture.cases[2],id:'constructor'}],expected_relations:JSON.parse('{"constructor":{"__proto__":{"has_relation":true}}}')};
  assert.deepEqual(F.validateBatch(special),special);assert.equal({}.has_relation,undefined);
});

test('false positives, false negatives and low confidence remain distinct in direct-map evaluation',async()=>{
  const {run}=await execute(positiveFixture,R.defaults,(source,target)=>source==='C08'?{C01:.04,C03:.98,C04:.7,C06:.99}[target]:.03);
  assert.deepEqual(audit(run,'C08').pairs.map(p=>p.resultTone),['fail','fail','warning','pass']);
});

test('historical v2 runs retain unknown labels while reruns use complete positive-only expectations',async()=>{
  const {run}=await execute();run.relation_worker.schemaVersion=2;
  const before=clone(run),restored=F.restore(run);
  assert.deepEqual(restored,run);assert.deepEqual(run,before);
  assert.deepEqual(audit(restored,'C08').pairs.map(p=>p.expectedRelation),[null,null,true,true]);
  assert.ok(audit(restored,'C15').pairs.every(p=>p.matches===null&&p.expectedRelation===null));
  assert.equal(F.exportResults({run:restored}).configuration.relation_expectation_policy,'explicit_pairs');
});

test('original seven-category runs without question snapshots still restore with their original contract',async()=>{
  const questions=clone(F.questions);delete questions.event_type.criteria.requirement;
  questions.event_type.criteria.other='Useful project memory not covered above, such as a requirement, unresolved question, risk, or proposed change without an explicit final decision.';
  const batch={batch_id:'LEGACY',cases:[{...fixture.cases[11],expected_event_type:'other'}]},run=F.createRun(batch,'official',.8,questions);
  await F.execute(run,{send:async request=>response(request,request.questions.should_store_memory
    ? {should_store_memory:{type:'noul',noul:.95}}
    : {event_type:{type:'choice',choice:'other',confidence:.5,probabilities:Object.fromEntries(Object.keys(questions.event_type.criteria).map(type=>[type,type==='other'?1:0]))}})});
  delete run.questions;
  const restored=F.restore(run);assert.deepEqual(restored.questions,questions);
  assert.equal(restored.records[0].result.verdict,'pass');assert.equal(restored.meeting_events[0].type,'other');
});
