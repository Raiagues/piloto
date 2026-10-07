const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../memory-flow.js'),R=require('../relation-worker.js');
const batch=require('./fixtures/memory-b001.json'),clone=value=>JSON.parse(JSON.stringify(value));
const output=(request,answers)=>({request:clone(request),response:{model:'fixture',answers,usage:{fixture:true}},provider:'official',latencyMs:12});
const chunkOutput=request=>{
  const item=batch.cases.find(item=>item.current_utterance===request.state.current_utterance);
  return output(request,request.questions.should_store_memory
    ? {should_store_memory:{type:'noul',noul:item.expected_store_memory?.96:.03,confidence:.1}}
    : {event_type:{type:'choice',choice:item.expected_event_type,confidence:.2,probabilities:Object.fromEntries(Object.keys(request.questions.event_type.criteria).map(type=>[type,type===item.expected_event_type?1:0]))}});
};
async function completedRun(failRelations=false) {
  const run=F.createRun(batch,'official',.8,F.questions,'Q003');
  const worker=R.start(run,{version:'RQ002',send:async request=>{if(failRelations)throw Error('Relation API fixture failure');return output(request,Object.fromEntries(request.state.candidates.map((candidate,i)=>['has_relation__'+candidate.event_id,{type:'noul',noul:i%2?.04:.98,confidence:.01}])));}});
  await F.execute(run,{send:async request=>chunkOutput(request),onChange:(_,change)=>{if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
  worker.close();await worker.done;return run;
}
// Parse real quoted multiline CSV cells, not a split-on-comma approximation.
function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=1;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if(c==='\r'&&text[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else cell+=c;
  }
  row.push(cell);rows.push(row);const columns=rows.shift();
  assert.ok(rows.every(row=>row.length===columns.length));
  return rows.map(row=>Object.fromEntries(columns.map((key,i)=>[key,row[i]])));
}

test('JSON exports the complete frozen test, both workers, scores, filters, memories and exact original outputs without mutation',async()=>{
  const run=await completedRun(),before=clone(run),draft=clone(F.questions);draft.event_type.instructions='Unapplied draft';
  const report=F.exportResults({run,testId:'T009',batch:{},questions:draft,questionVersion:'Q999',relationConfig:{},exportedAt:'2026-10-04T17:00:00.000Z'});
  assert.equal(report.format,'norte.memory-results');assert.equal(report.test_id,'T009');
  assert.equal(report.question_version,'Q003');assert.equal(report.relation_question_version,'RQ002');
  assert.deepEqual(report.input,batch);assert.deepEqual(report.execution,run);
  assert.deepEqual(report.configuration.chunk_questions,run.questions);
  assert.deepEqual(report.configuration.relation_worker,run.relation_worker.config);
  assert.equal(report.summary.total_chunks,15);assert.equal(report.summary.chunk_calls,26);assert.equal(report.summary.relation_calls,10);
  assert.equal(report.summary.stored_events,11);assert.equal(report.summary.ignored_chunks,4);
  assert.equal(report.question_results.filter(q=>q.worker==='chunks').length,30);
  assert.equal(report.question_results.filter(q=>q.worker==='relations').length,55);
  assert.equal(report.filter_results.length,0);assert.equal(report.configuration.relation_candidate_scope,'all_previous_events');
  const gate=report.question_results.find(q=>q.chunk_id==='C02'&&q.question_id==='should_store_memory');
  assert.equal(gate.actual,false);assert.equal(gate.probability_actual,.97);assert.equal(gate.api_confidence,.1);
  assert.deepEqual(gate.probabilities,{true:.03,false:.97});assert.equal(gate.matches,true);
  const type=report.question_results.find(q=>q.chunk_id==='C02'&&q.question_id==='event_type');
  assert.equal(type.status,'not_consulted');assert.equal(type.actual,null);assert.equal(type.matches,null);assert.equal(type.probabilities,null);
  assert.equal(type.expected_applicable,false);assert.equal(type.output,null);assert.equal(type.request,null);
  const relations=report.question_results.filter(q=>q.worker==='relations'&&q.chunk_id==='C08');
  assert.deepEqual(relations.map(q=>q.verdict),['fail','pass','pass','fail']);assert.equal(relations[1].probability_actual,.96);
  assert.ok(report.question_results.filter(q=>q.worker==='relations'&&q.chunk_id==='C15').every(q=>typeof q.matches==='boolean'&&q.expected===false&&q.verdict!=='not_evaluated'));
  assert.deepEqual(report.input.expected_relations,batch.expected_relations,'obsolete filter labels stay preserved in the original input');
  assert.deepEqual(run,before);report.execution.records[0].storeOutput.response.answers.should_store_memory.noul=0;
  report.configuration.chunk_questions.event_type.instructions='Mutated export';assert.deepEqual(run,before);
});

test('CSV includes every input and question, complete score distributions, skipped calls, filters, event metadata and all original relation calls',async()=>{
  const run=await completedRun(),report=F.exportResults({run,testId:'T001'}),csv=F.resultsCsv(report),rows=parseCsv(csv);
  assert.equal(csv.charCodeAt(0),0xfeff);assert.ok(rows.every(row=>row.test_id==='T001'&&row.batch_id==='B001'));
  assert.equal(rows.filter(row=>row.record_type==='chunk').length,15);
  assert.equal(rows.filter(row=>row.record_type==='question').length,85);
  assert.equal(rows.filter(row=>row.record_type==='filter').length,0);
  assert.equal(rows.filter(row=>row.record_type==='meeting_event').length,11);
  assert.equal(rows.filter(row=>row.record_type==='raw_window').length,15);
  assert.equal(rows.filter(row=>row.record_type==='relation_job').length,11);
  assert.equal(rows.filter(row=>row.record_type==='relation_call').length,10);
  assert.ok(rows.filter(row=>row.record_type==='question'&&row.worker==='relations').every(row=>['true','false'].includes(row.expected)&&['true','false'].includes(row.matches)));
  const metadata=JSON.parse(rows[0].details_json);assert.deepEqual(metadata.input,batch);
  assert.deepEqual(metadata.configuration,report.configuration);assert.equal(metadata.execution.relation_worker.calls,10);
  const q=rows.find(row=>row.record_type==='question'&&row.chunk_id==='C12'&&row.question_id==='event_type');
  assert.equal(q.actual,'requirement');assert.equal(q.expected,'requirement');assert.equal(q.probability_actual,'1');assert.equal(q.api_confidence,'0.2');
  assert.deepEqual(JSON.parse(q.request_json),run.records[11].typeOutput.request);
  assert.deepEqual(JSON.parse(q.response_json),run.records[11].typeOutput.response);
  assert.deepEqual(JSON.parse(q.probabilities_json),run.records[11].typeOutput.response.answers.event_type.probabilities);
  const event=rows.find(row=>row.record_type==='meeting_event'&&row.chunk_id==='C12');
  assert.equal(JSON.parse(event.details_json).status,'active');assert.equal(event.event_type,'requirement');
  assert.equal(event.event_status,'active');assert.equal(event.store_confidence,'');assert.equal(event.type_confidence,'');
  const relation=rows.find(row=>row.record_type==='relation');assert.equal(relation.relation_id,'R001');assert.equal(relation.relation_confidence,'0.98');
  assert.deepEqual(JSON.parse(rows.find(row=>row.record_type==='relation_call').details_json),run.relation_worker.jobs[1].parts[0]);
});

test('drafts and interrupted/error runs export missing answers explicitly, with no model calls or automatic saves',async()=>{
  const planned=F.exportResults({batch,questions:F.questions,relationConfig:R.defaults});
  assert.equal(planned.status,'not_run');assert.equal(planned.execution,null);assert.equal(planned.question_results.length,30);
  assert.ok(planned.question_results.every(q=>q.output===null&&q.actual===null&&q.status==='not_run'));
  assert.deepEqual(planned.configuration.relation_worker,R.defaults);
  const run=F.createRun(batch,'official');let stopped=false;
  await F.execute(run,{send:async request=>chunkOutput(request),onChange:(_,change)=>{if(change.phase==='type')stopped=true;},shouldStop:()=>stopped});
  const report=F.exportResults({run});assert.equal(report.question_results[0].actual,true);
  assert.equal(report.question_results[1].status,'interrupted');assert.equal(report.question_results[1].probability_actual,null);
  assert.equal(report.summary.chunk_calls,1);assert.equal(report.question_results[2].status,'not_run');
  const failed=F.createRun({batch_id:'ERR',cases:[batch.cases[0]]},'official');
  await F.execute(failed,{send:async()=>{throw Error('API fixture failure');}});
  const rows=F.exportResults({run:failed}).question_results;
  assert.equal(rows[0].status,'error');assert.equal(rows[0].error,'API fixture failure');assert.equal(rows[0].actual,null);
  assert.equal(rows[1].status,'not_consulted');assert.equal(rows[1].actual,null);
  assert.throws(()=>F.exportResults({batch:null}));
  assert.throws(()=>F.exportResults({run:{...run,status:'running'}}),/Aguarde/);
  assert.throws(()=>F.exportResults({run:{...run,relation_worker:{status:'running'}}}),/Aguarde/);
});

test('CSV preserves accents, quotes and newlines; neutralizes spreadsheet formulas without altering the JSON snapshot',()=>{
  for(const text of ['=HYPERLINK("https://example.invalid")','  +SUM(1,2)','-1+2','@SUM(1,2)','\t=1+1','\r=1+1','Observação: "ação", teste\nsegunda linha']) {
    const input={batch_id:'../../B:001',cases:[{...batch.cases[0],id:'=ID',current_utterance:text}]};
    const report=F.exportResults({batch:input,exportedAt:'2026-10-04T17:00:00.000Z'}),row=parseCsv(F.resultsCsv(report)).find(row=>row.record_type==='chunk');
    assert.equal(row.current_utterance,text.startsWith('Observação')?text:"'"+text);assert.equal(row.chunk_id,"'=ID");
    assert.equal(JSON.parse(row.details_json).input.current_utterance,text);assert.equal(report.input.cases[0].current_utterance,text);
    const filename=F.exportFilename(report,'json');assert.match(filename,/^resultados_[a-zA-Z0-9_]+_20261004170000\.json$/);
  }
  assert.throws(()=>F.exportFilename({batch_id:'B'},'html'));
});

test('saved test exports keep their own question versions and complete response metadata after reload',async()=>{
  const run=await completedRun(),library=F.emptyLibrary();F.saveTest(library,batch,run.questions,run);
  const edited=clone(F.questions);edited.should_store_memory.instructions+=' Later change.';F.addVersion(library,edited);
  const saved=F.validateLibrary(clone(library)).tests[0],report=F.exportResults({run:saved.run,testId:saved.id,questions:edited});
  assert.equal(report.question_version,'Q001');assert.equal(report.relation_question_version,'RQ001');
  assert.deepEqual(report.configuration.chunk_questions,library.versions[0].questions);
  assert.deepEqual(report.execution,saved.run);
  assert.deepEqual(report.question_results[0].output.response.usage,{fixture:true});
  assert.ok(JSON.stringify(report,null,2).includes('\n  "format"'));
});

test('relation failures keep real error messages and candidate requests, never false answers or fabricated scores',async()=>{
  const run=await completedRun(true),report=F.exportResults({run});
  const rows=report.question_results.filter(q=>q.worker==='relations');assert.equal(rows.length,55);
  assert.ok(rows.every(q=>q.status==='error'&&q.verdict==='error'&&q.error==='Relation API fixture failure'));
  assert.ok(rows.every(q=>q.actual===null&&q.probability_actual===null&&q.matches===null&&q.retained===false));
  assert.deepEqual(rows[0].request,run.relation_worker.jobs[1].parts[0].request);
  assert.equal(report.execution.relations.length,0);assert.equal(report.summary.stored_events,11);
  const calls=parseCsv(F.resultsCsv(report)).filter(row=>row.record_type==='relation_call');
  assert.equal(calls.length,10);assert.ok(calls.every(row=>row.status==='error'&&row.response_json===''));
});

test('relation export keeps strict >80% retention separate from a matching boolean and the API confidence statistic',async()=>{
  const run=await completedRun(),job=run.relation_worker.jobs[4];
  job.parts[0].output.response.answers.has_relation__E003.noul=.8;
  job.scores=R.scoresFor(job);run.relations=R.relationsFor(run.relation_worker.jobs);
  const q=F.exportResults({run}).question_results.find(q=>q.chunk_id==='C08'&&q.question_id==='has_relation__E003');
  assert.equal(q.actual,true);assert.equal(q.expected,true);assert.equal(q.matches,true);
  assert.equal(q.probability_actual,.8);assert.equal(q.api_confidence,.01);assert.equal(q.confidence_operator,'>');
  assert.equal(q.confidence_passes,false);assert.equal(q.retained,false);assert.equal(q.verdict,'warning');
});
