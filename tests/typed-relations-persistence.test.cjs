// Real chunk/thread/typed pipelines with local transport fixtures. No external API.
const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads,TR=require('../typed-relations.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const expected={P:{},R:{P:{relation_type:'result_of',configuration_match:'exact'}},AGAIN:{P:{relation_type:'repeats',configuration_match:'exact'},R:{relation_type:'repeats',configuration_match:'exact'}},BACKGROUND:{P:{relation_type:'none'},R:{relation_type:'none'},AGAIN:{relation_type:'none'}}};
function batch() {
  return {batch_id:'TYPED-PERSISTENCE',cases:[
    ['P','test_proposal','Run bracket trial R1 on unit B4 with a 4 mm wall under a 100 N load.'],
    ['R','test_result','R1 completed on unit B4 with a 4 mm wall under 100 N; deformation was 0.2 mm.'],
    ['AGAIN','test_proposal','Repeat R1 as R2 tomorrow on unit B4 with the same 4 mm wall and 100 N load.'],
    ['BACKGROUND','observation','The bracket drawing title is "Mount, B4".\nThe finish note says zinc.']
  ].map(([id,expected_event_type,current_utterance])=>({id,current_utterance,expected_store_memory:true,expected_event_type})),expected_threads:{P:'T001',R:'T001',AGAIN:'T001',BACKGROUND:'T001'},expected_typed_relations:clone(expected)};
}
function choice(question,winner,p=.96){const keys=Object.keys(question.criteria);return {type:'choice',choice:winner,confidence:p<.8?.99:.02,probabilities:Object.fromEntries(keys.map(key=>[key,key===winner?p:(1-p)/(keys.length-1)]))};}
function response(req,answers){return {request:clone(req),response:{model:'local-test-fixture',answers,usage:{fixture:true}},provider:'official',latencyMs:7};}
function typedReply(req) {
  return response(req,Object.fromEntries(Object.entries(req.questions).map(([id,q])=>{
    const [stage,eventId]=id.split('__'),source=req.state.current_event.chunk_id,target=req.state.candidates.find(c=>c.event_id===eventId).chunk_id;
    const wanted=expected[source][target][stage];
    return [id,choice(q,wanted,source==='AGAIN'&&target==='R'&&stage==='configuration_match'?.72:.96)];
  })));
}
async function classifiedRun(){
  const input=batch(),run=F.createRun(input,'official'),thread=T.start(run,{schemaVersion:5,send:async req=>response(req,Object.fromEntries(Object.entries(req.questions).map(([id,q])=>[id,choice(q,'belongs')])))});
  await F.execute(run,{mode:'burst',wait:async()=>{},send:async req=>{
    const c=input.cases.find(c=>c.current_utterance===req.state.current_utterance);
    return response(req,req.questions.should_store_memory?{should_store_memory:{type:'noul',noul:.98}}:{event_type:choice(req.questions.event_type,c.expected_event_type)});
  },onChange:(_,change)=>{if(change.phase==='complete'&&change.record.result?.store)thread.enqueue(run.meeting_events.at(-1));}});
  thread.close();await thread.done;assert.ok(run.meeting_events.every(e=>e.thread_id==='T001'));return run;
}
async function completedRun(config=TR.defaults){const run=await classifiedRun();await TR.start(run,{config,send:async req=>typedReply(req)}).done;return run;}
// Parse quoted, multiline CSV fields and the export BOM exactly.
function parseCsv(text){
  assert.equal(text.charCodeAt(0),0xfeff);const records=[];let row=[],cell='',quoted=false;
  for(let i=1;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'&&!quoted){row.push(cell);records.push(row);row=[];cell='';i++;}else cell+=c;}
  row.push(cell);records.push(row);const columns=records.shift();assert.ok(records.every(r=>r.length===columns.length));return records.map(r=>Object.fromEntries(columns.map((name,i)=>[name,r[i]])));
}

test('saving typed runs freezes chunk/thread/typed versions, deduplicates unchanged questions, and preserves earlier histories after edits',async()=>{
  const run=await completedRun(),library=F.emptyLibrary(),first=F.saveTest(library,run.batch,run.questions,run),saved=clone(first);
  assert.equal(first.questionVersion,'Q001');assert.equal(first.threadVersion,'TQ001');assert.equal(first.typedRelationVersion,'TRQ001');assert.equal(first.run.typed_relation_worker.version,'TRQ001');
  const second=F.saveTest(library,run.batch,run.questions,run);assert.equal(second.typedRelationVersion,'TRQ001');assert.equal(library.typedRelationVersions.length,1);
  const edited=clone(TR.defaults);edited.questions.configuration_match.criteria.partial+=' Preserve missing conditions for review.';
  const thirdRun=await completedRun(edited),third=F.saveTest(library,thirdRun.batch,thirdRun.questions,thirdRun);
  assert.equal(third.typedRelationVersion,'TRQ002');assert.equal(third.questionVersion,'Q001');assert.equal(third.threadVersion,'TQ001');
  assert.equal(library.versions.length,1);assert.equal(library.threadVersions.length,1);assert.equal(library.typedRelationVersions.length,2);
  run.meeting_relations[0].relation_type='forged';run.typed_relation_worker.config.questions.relation_type.criteria.none='Changed live draft';edited.questions.relation_type.criteria.none='Changed caller config';
  assert.deepEqual(library.tests[0],saved,'saved run and version are detached from live objects');
  const restored=F.validateLibrary(clone(library));assert.deepEqual(restored.tests[0],saved);assert.equal(restored.tests[2].run.typed_relation_worker.version,'TRQ002');
  const wrongVersion=clone(library);wrongVersion.tests[0].typedRelationVersion='TRQ999';assert.throws(()=>F.validateLibrary(wrongVersion),/Versão/);
  const wrongConfig=clone(library);wrongConfig.typedRelationVersions[0].config.questions.relation_type.criteria.none+=' Altered';assert.throws(()=>F.validateLibrary(wrongConfig),/versão/);
  const oldEmpty={schemaVersion:1,versions:[],relationVersions:[],threadVersions:[],tests:[]};assert.deepEqual(F.validateLibrary(oldEmpty).typedRelationVersions,[],'pre-typed libraries remain loadable');
});

test('F.restore rebuilds typed edges and lifecycle from immutable calls without accepting a forged derived projection',async()=>{
  const run=await completedRun(),before=clone(run),expectedLifecycle=TR.lifecycle(run),forged=clone(run);
  forged.meeting_relations=[{relation_id:'invented',relation_type:'supports'}];forged.meeting_events[0].status='superseded';
  const restored=F.restore(forged);assert.deepEqual(restored.meeting_relations,before.meeting_relations);assert.deepEqual(TR.lifecycle(restored),expectedLifecycle);
  assert.equal(restored.typed_relation_worker.schemaVersion,2);assert.deepEqual(restored.typed_relation_worker,before.typed_relation_worker);
  assert.equal(expectedLifecycle.E001.status,'completed');assert.equal(expectedLifecycle.E003.status,'open','two outgoing repeats edges do not complete the newly scheduled execution');
  assert.equal(before.meeting_relations.filter(r=>r.source_event_id==='E003').length,2,'repeat links to the proposal and identified earlier execution both survive');
  assert.equal(before.meeting_relations.find(r=>r.source_event_id==='E003'&&r.target_event_id==='E002').review_state,'needs_review');
  const altered=clone(before);altered.typed_relation_worker.jobs[1].parts[0].request.state.current_event.text='Forged request';assert.throws(()=>F.restore(altered),/adulterado/);
});

test('historical typed schema 1 snapshots retain their sent context while new schema 2 configuration calls stay isolated',async()=>{
  const run=await completedRun(),historical=clone(run);historical.typed_relation_worker.schemaVersion=1;
  for(const job of historical.typed_relation_worker.jobs){
    const current=historical.meeting_events.find(e=>e.event_id===job.event_id);
    for(const part of job.parts){
      const candidates=part.candidate_ids.map(id=>historical.meeting_events.find(e=>e.event_id===id));
      part.request=TR.request(historical,current,candidates,part.stage,historical.typed_relation_worker.config,job.results,1);
      if(part.output)part.output.request=clone(part.request);
    }
  }
  const restored=F.restore(historical);assert.equal(restored.typed_relation_worker.schemaVersion,1);assert.deepEqual(restored.typed_relation_worker,historical.typed_relation_worker);
  const oldMatches=restored.typed_relation_worker.jobs.flatMap(j=>j.parts).filter(p=>p.stage==='configuration_match');assert.ok(oldMatches.every(p=>Array.isArray(p.request.state.thread_history)));
  const newMatches=run.typed_relation_worker.jobs.flatMap(j=>j.parts).filter(p=>p.stage==='configuration_match');assert.ok(newMatches.every(p=>!Object.hasOwn(p.request.state,'thread_history')&&p.request.state.candidates.length===1));
  assert.equal(F.exportResults({run:restored}).configuration.typed_relation_policy.match_context,'all_previous_events_same_thread');assert.equal(F.exportResults({run}).configuration.typed_relation_policy.match_context,'isolated_pair_no_history');
});

test('JSON and CSV exports preserve typed versions, every pair including none, scores, exact requests, low-confidence review, and lifecycle',async()=>{
  const run=await completedRun(),library=F.emptyLibrary(),saved=F.saveTest(library,run.batch,run.questions,run),before=clone(saved.run);
  const report=F.exportResults({run:saved.run,testId:saved.id,typedRelationConfig:{},exportedAt:'2026-10-06T15:00:00.000Z'});
  assert.equal(report.typed_relation_question_version,'TRQ001');assert.deepEqual(report.configuration.typed_relation_worker,saved.run.typed_relation_worker.config);assert.deepEqual(report.execution,before);
  assert.equal(report.summary.typed_relations.expected_pairs,6);assert.equal(report.summary.typed_relations.correct,6);assert.equal(report.summary.typed_relations.edges,3);assert.equal(report.summary.typed_relations.review,1);assert.equal(report.summary.typed_relations.calls,6);
  assert.equal(report.typed_relation_results.length,6);assert.equal(report.typed_relation_results.filter(p=>p.actual.relation_type==='none').length,3);
  const questions=report.question_results.filter(q=>q.worker==='typed_relations');assert.equal(questions.length,9);assert.ok(questions.every(q=>q.request&&q.output&&q.matches===true));
  const warning=questions.find(q=>q.chunk_id==='AGAIN'&&q.target_chunk_id==='R'&&q.question_id.startsWith('configuration_match'));
  assert.equal(warning.probability_actual,.72);assert.equal(warning.api_confidence,.99);assert.equal(warning.confidence_passes,false);assert.equal(warning.verdict,'warning');
  assert.equal(report.event_lifecycle.E001.status,'completed');assert.equal(report.event_lifecycle.E003.status,'open');
  assert.ok(questions.every(q=>!JSON.stringify(q.request).includes('expected_')));
  const rows=parseCsv(F.resultsCsv(report)),metadata=JSON.parse(rows[0].details_json);
  assert.equal(metadata.typed_relation_question_version,'TRQ001');assert.deepEqual(metadata.execution.typed_relation_worker,before.typed_relation_worker);
  assert.equal(rows.filter(r=>r.record_type==='meeting_relation').length,3);assert.equal(rows.filter(r=>r.record_type==='typed_relation_audit').length,6);assert.equal(rows.filter(r=>r.record_type==='event_lifecycle').length,4);
  const typedRows=rows.filter(r=>r.record_type==='question'&&r.worker==='typed_relations');assert.equal(typedRows.length,9);
  const csvWarning=typedRows.find(r=>r.chunk_id==='AGAIN'&&r.target_chunk_id==='R'&&r.question_id.startsWith('configuration_match'));
  assert.deepEqual(JSON.parse(csvWarning.request_json),warning.request);assert.deepEqual(JSON.parse(csvWarning.response_json),warning.output.response);assert.deepEqual(JSON.parse(csvWarning.probabilities_json),warning.probabilities);assert.equal(csvWarning.confidence_passes,'false');
  const multiline=rows.find(r=>r.record_type==='chunk'&&r.chunk_id==='BACKGROUND');assert.equal(multiline.current_utterance,run.batch.cases[3].current_utterance);
  assert.deepEqual(saved.run,before,'exports are read-only');report.execution.meeting_relations[0].relation_type='mutated export';assert.deepEqual(saved.run,before);
});

test('stopping after relation type keeps the positive edge pending, saves it, and reloads without configuration calls or automatic retry',async()=>{
  const run=await classifiedRun();let controller,calls=0;
  controller=TR.start(run,{send:async req=>{calls++;assert.ok(Object.keys(req.questions).every(k=>k.startsWith('relation_type__')));return typedReply(req);},onChange:(_,change)=>{
    if(change.job?.results.some(r=>r.relation_type!=='none'))controller.stop();
  }});
  await controller.done;assert.equal(calls,1);assert.equal(run.typed_relation_worker.status,'stopped');assert.equal(run.meeting_relations.length,1);
  const edge=run.meeting_relations[0];assert.equal(edge.relation_type,'result_of');assert.equal(edge.configuration_match,null);assert.equal(edge.configuration_applicable,null);assert.equal(edge.review_state,'needs_review');assert.equal(TR.lifecycle(run).E001.status,'open');
  assert.ok(run.typed_relation_worker.jobs[2].status==='interrupted');
  const library=F.emptyLibrary(),saved=F.saveTest(library,run.batch,run.questions,run),restored=F.validateLibrary(clone(library)).tests[0].run;
  assert.equal(restored.typed_relation_worker.status,'stopped');assert.deepEqual(restored.meeting_relations,run.meeting_relations);assert.equal(calls,1);
  const report=F.exportResults({run:restored,testId:saved.id});assert.equal(report.execution.typed_relation_worker.status,'stopped');assert.equal(report.event_lifecycle.E001.status,'open');assert.equal(report.question_results.filter(q=>q.worker==='typed_relations').length,1);assert.equal(report.typed_relation_results[0].actual.configuration_match,null);
  assert.equal(parseCsv(F.resultsCsv(report)).filter(r=>r.record_type==='meeting_relation').length,1);
});

test('oversized semantic state fails visibly before transport, retains full evidence, and restores its unattempted errors',async()=>{
  // A worker-level boundary fixture: upstream assignments are already frozen.
  // Each source text fits the chunk contract; the complete pair/history does not.
  const textA='A vibration report '+ 'a'.repeat(8500),textB='A subsequent vibration observation '+ 'b'.repeat(3000);
  const run={provider:'official',status:'done',thread_worker:{status:'done'},batch:{batch_id:'TYPED-LIMIT',cases:[{id:'A',current_utterance:textA,expected_store_memory:true,expected_event_type:'observation'},{id:'B',current_utterance:textB,expected_store_memory:true,expected_event_type:'observation'}],expected_typed_relations:{A:{},B:{A:{relation_type:'none'}}}},meeting_events:[{event_id:'E001',chunk_id:'A',thread_id:'T1',type:'observation',text:textA},{event_id:'E002',chunk_id:'B',thread_id:'T1',type:'observation',text:textB}]};
  F.validateBatch(run.batch);let calls=0;await TR.start(run,{send:async()=>{calls++;throw Error('Should never send oversized state');}}).done;
  assert.equal(calls,0);assert.equal(run.typed_relation_worker.status,'error');assert.equal(run.typed_relation_worker.jobs[1].status,'error');
  const part=run.typed_relation_worker.jobs[1].parts[0];assert.equal(part.request,undefined);assert.equal(part.attempted,undefined);assert.match(part.error,/16\.000/);
  assert.equal(run.meeting_events[0].text,textA);assert.equal(run.meeting_events[1].text,textB);assert.deepEqual(run.meeting_relations,[]);
  const audit=TR.audit(run,run.typed_relation_worker.jobs[1]);assert.equal(audit.pairs[0].tone,'error');assert.equal(audit.pairs[0].result,null);assert.equal(TR.summary(run).not_processed,1,'failed preparation is not a fabricated correct none');
  assert.deepEqual(TR.restore(clone(run.typed_relation_worker),run),run.typed_relation_worker);assert.equal(calls,0);
});
