const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../experiments.js');
const prototypeTest = require('./fixtures/prototype-v1.json');
const prototypeRequest = {model:prototypeTest.model,state:prototypeTest.state,questions:prototypeTest.questions};
test('legacy prototype retains all eight expected answers and acceptance thresholds', () => {
  const parsed=E.parseRequest(JSON.stringify(prototypeTest));
  assert.deepEqual(parsed,prototypeTest);
  assert.deepEqual(Object.keys(parsed.expected),Object.keys(parsed.questions));
  assert.deepEqual(Object.fromEntries(Object.entries(parsed.expected).map(([id,e])=>[id,e.value])),{
    meaningful_event:true,event_type:'test_proposal',decision_is_final:false,test_is_proposed:true,project_impact:2,commitment_level:2,affected_area:'design',requires_followup:true
  });
  for(const e of Object.values(parsed.expected)) assert.ok(e.minProbability>=.5 && e.minProbability<1);
  const input={name:parsed.name,language:parsed.language,state:parsed.state,config:{model:parsed.model,questions:parsed.questions},expected:parsed.expected};
  assert.deepEqual(E.request(input),prototypeRequest);
  assert.deepEqual(E.exportTest(input),parsed);
});
test('full prototype request preserves structured State and all eight Questions', () => {
  const parsed = E.parseRequest(JSON.stringify(prototypeRequest));
  assert.deepEqual(parsed, prototypeRequest);
  assert.equal(Object.keys(parsed.questions).length, 8);
  const value = {name:'Prototype',language:'en',state:parsed.state,config:{model:parsed.model,questions:parsed.questions},expected:{}};
  E.validateInput(value);
  assert.deepEqual(E.request(value), prototypeRequest);
  parsed.state.current_utterance = 'Edited';
  assert.notEqual(prototypeRequest.state.current_utterance, 'Edited');
});
test('State parsing distinguishes literal text from JSON and rejects invalid structured values', () => {
  assert.equal(E.parseState('{"literal":true}'),'{"literal":true}');
  assert.deepEqual(E.parseState('{"literal":true}', 'json'),{literal:true});
  assert.deepEqual(E.parseState('["Context","Current"]','json'),['Context','Current']);
  assert.equal(E.parseState('"text"','json'),'text');
  for(const source of ['{','null','true','42','{}','[]']) assert.throws(()=>E.parseState(source,'json'));
  for(const state of [{bad:NaN},{bad:undefined},new Date(),{text:'a'.repeat(16000)}]) assert.throws(()=>E.validateState(state));
  let nested={a:1}; for(let i=0;i<17;i++) nested={a:nested};
  assert.throws(()=>E.validateState(nested));
  assert.throws(()=>E.parseRequest('{'));
  assert.throws(()=>E.parseRequest(JSON.stringify({...prototypeRequest,unknown:{}})));
});
test('manual JSON accepts typed/shorthand expectations and metadata without leaking them to Jev', () => {
  const expected = {meaningful_event:true,event_type:'test_proposal',decision_is_final:false,project_impact:0};
  const parsed = E.parseRequest(JSON.stringify({...prototypeRequest,name:'Prototype EN',language:'en',expected}));
  assert.deepEqual(parsed.expected, {
    meaningful_event:{type:'noul',value:true},event_type:{type:'choice',value:'test_proposal'},decision_is_final:{type:'noul',value:false},project_impact:{type:'score',value:0}
  });
  const input={name:parsed.name,language:parsed.language,state:parsed.state,config:{model:parsed.model,questions:parsed.questions},expected:parsed.expected};
  assert.deepEqual(E.request(input),prototypeRequest);
  assert.deepEqual(E.parseRequest(JSON.stringify(E.exportTest(input))),parsed);
  for(const expected of [null,[],{missing:true},{meaningful_event:'true'},{event_type:'invalid'},{project_impact:4},{project_impact:1.2},{meaningful_event:{type:'score',value:1}},{meaningful_event:{type:'noul',value:true,extra:1}}]) {
    assert.throws(()=>E.parseRequest(JSON.stringify({...prototypeRequest,expected})));
  }
  for(const metadata of [{name:''},{name:' '.repeat(10)},{name:'a'.repeat(101)},{language:'de'}]) assert.throws(()=>E.parseRequest(JSON.stringify({...prototypeRequest,...metadata})));
  assert.deepEqual(E.parseRequest(JSON.stringify({...prototypeRequest,expected:{}})).expected,{});
  assert.equal(Object.hasOwn(E.parseRequest(JSON.stringify(prototypeRequest)),'expected'),false);
});
test('renaming changes only display metadata and round-trips through backup and CSV', () => {
  const original=batch(), archive={schemaVersion:1,cases:[],batches:[E.clone(original)]};
  E.renameBatch(archive,original.id,'  Revised title  ');
  const renamed=archive.batches[0];
  assert.equal(E.testName(renamed),'Revised title');
  assert.deepEqual(renamed.input,original.input);
  assert.deepEqual(renamed.runs,original.runs);
  assert.deepEqual(E.validateArchive(archive),archive);
  assert.match(E.csv(archive),/Revised title/);
  const time=renamed.nameUpdatedAt;
  E.renameBatch(archive,original.id,'Newest title');
  assert.ok(Date.parse(renamed.nameUpdatedAt)>Date.parse(time));
  for(const name of ['','  ','x'.repeat(101)]) assert.throws(()=>E.renameBatch(archive,original.id,name));
  assert.throws(()=>E.renameBatch(archive,'missing','Title'));
  renamed.status='running'; assert.throws(()=>E.renameBatch(archive,original.id,'Title'));
});
test('confidence thresholds use P(expected), including false, never confidence or weighted score', () => {
  const no={type:'noul',value:false,minProbability:.85};
  assert.equal(E.evaluateAnswer({type:'noul',noul:.15},no).passes,true,'inclusive decimal boundary');
  assert.equal(E.evaluateAnswer({type:'noul',noul:.3},no).reason,'low-probability');
  assert.equal(E.evaluateAnswer({type:'noul',noul:.9},no).reason,'wrong-value');
  const choice={type:'choice',choice:'yes',probabilities:{yes:.6,no:.4},confidence:1};
  assert.equal(E.evaluateAnswer(choice,{type:'choice',value:'yes',minProbability:.8}).passes,false);
  assert.equal(E.evaluateAnswer({...choice,confidence:0},{type:'choice',value:'yes',minProbability:.6}).passes,true);
  const score={type:'score',score:1.6,probabilities:{0:.05,1:.3,2:.65},confidence:1};
  assert.equal(E.evaluateAnswer(score,{type:'score',value:2,minProbability:.7}).reason,'low-probability');
  assert.equal(E.evaluateAnswer({...score,score:.8},{type:'score',value:2,minProbability:.65}).passes,true,'weighted mean is not the selected level');
  const tied={type:'score',score:1,probabilities:{0:.5,1:0,2:.5},confidence:1};
  assert.equal(E.evaluateAnswer(tied,{type:'score',value:2,minProbability:0}).passes,false);
  assert.equal(E.evaluateAnswer(choice,{type:'choice',value:'no',minProbability:0}).passes,false,'low threshold cannot approve a wrong answer');
  assert.equal(E.evaluateAnswer({type:'noul',noul:1},{type:'noul',value:true,minProbability:1}).passes,true);
  assert.equal(E.evaluateAnswer(choice,{type:'choice',value:'yes'}).passes,true,'old expectations retain label-only evaluation');
  assert.equal(E.evaluateAnswer(choice,undefined),null);
});
test('saved expected corrections update metrics and CSV without rewriting any model input or output',()=>{
  const original=batch(),data={schemaVersion:1,cases:[],batches:[E.clone(original)]};
  const labels={tipo:{type:'choice',value:'outro',minProbability:.6}};
  E.updateExpected(data,'b1',labels);
  const corrected=data.batches[0];assert.deepEqual(corrected.input,original.input);assert.deepEqual(corrected.runs,original.runs);
  assert.deepEqual(E.expectedFor(corrected),labels);assert.deepEqual(E.request(corrected.input),E.request(original.input));
  const stats=E.summarize(corrected);assert.equal(stats.comparisons,3);assert.equal(stats.passes,1);assert.equal(stats.passedRuns,1);
  assert.match(E.csv(data),/"tipo","choice","outro"/);assert.deepEqual(E.validateArchive(data),data);
  const time=corrected.expectedUpdatedAt;E.updateExpected(data,'b1',{});assert.ok(corrected.expectedUpdatedAt>time);
  assert.equal(E.summarize(corrected).evaluatedRuns,0);assert.deepEqual(E.expectedFor(corrected),{});
  assert.equal(original.input.expected.tipo.value,'decisao');
});
test('saved expected corrections survive stale-tab merges, deletion and latest rename independently',()=>{
  const initial={schemaVersion:1,cases:[],batches:[batch()]},corrected=E.clone(initial),renamed=E.clone(initial);
  E.updateExpected(corrected,'b1',{contexto:{type:'noul',value:true,minProbability:.8}});
  E.renameBatch(renamed,'b1','Renamed after correction');E.removeRun(renamed.batches[0],2);
  for(const [a,b]of [[corrected,renamed],[renamed,corrected]]) {
    const merged=E.mergeArchives(E.clone(a),E.clone(b));E.validateArchive(merged);
    assert.deepEqual(E.expectedFor(merged.batches[0]),corrected.batches[0].expectedOverride);
    assert.equal(E.testName(merged.batches[0]),'Renamed after correction');assert.equal(merged.batches[0].runs[1].status,'deleted');
    assert.deepEqual(merged.batches[0].input,initial.batches[0].input);
  }
  const cleared=E.clone(corrected);E.updateExpected(cleared,'b1',{});
  assert.deepEqual(E.expectedFor(E.mergeArchives(cleared,corrected).batches[0]),{});
  const deleted=E.clone(initial);E.removeItem(deleted,'batches','b1');assert.equal(E.mergeArchives(deleted,corrected).batches.length,0);
});
test('invalid expected corrections are rejected atomically and never allowed while running',()=>{
  const data={schemaVersion:1,cases:[],batches:[batch()]},before=E.clone(data);
  for(const values of [{missing:{type:'noul',value:true}},{tipo:{type:'choice',value:'invalid'}},{contexto:{type:'noul',value:true,minProbability:2}},null]) {
    assert.throws(()=>E.updateExpected(data,'b1',values));assert.deepEqual(data,before);
  }
  assert.throws(()=>E.updateExpected(data,'unknown',{}));data.batches[0].status='running';assert.throws(()=>E.updateExpected(data,'b1',{}));
  const invalid=E.clone(before);invalid.batches[0].expectedOverride={};assert.throws(()=>E.validateArchive(invalid));
});
test('invalid thresholds reject the whole test; zero and legacy absence round-trip', () => {
  for(const minProbability of [null,NaN,Infinity,-.1,1.01,'0.85',true]) {
    const value=input();value.expected.tipo.minProbability=minProbability;assert.throws(()=>E.validateInput(value));
  }
  const value=input();value.expected.contexto.minProbability=0;
  assert.equal(E.parseRequest(JSON.stringify(E.exportTest(value))).expected.contexto.minProbability,0);
  assert.equal(Object.hasOwn(E.exportTest(value).expected.tipo,'minProbability'),false);
});
test('pass rates evaluate each run independently; agreement, errors, deletion and means stay distinct', () => {
  const b=batch();b.input.expected.tipo.minProbability=.75;b.input.expected.relevancia.minProbability=.7;b.input.expected.contexto.minProbability=.8;
  b.runs[0].output.response.answers.contexto.noul=.1;
  b.runs[1].output.response.answers.contexto.noul=.3;
  b.runs[2].output.response.answers.contexto.noul=.1;
  const stats=E.summarize(b);
  assert.equal(stats.matches,8);assert.equal(stats.passes,7);assert.equal(stats.comparisons,9);
  assert.equal(stats.evaluatedRuns,3);assert.equal(stats.passedRuns,1);assert.equal(stats.failed,1);
  assert.equal(stats.metrics.contexto.passes,2);assert.equal(stats.metrics.contexto.matches,3);
  assert.ok(stats.metrics.contexto.expectedProbabilityMean>.8,'a passing average must not hide one failed run');
  const archive={schemaVersion:1,cases:[],batches:[b]};assert.deepEqual(E.validateArchive(archive),archive);
  assert.equal(E.evaluateRun(b.runs[1].output.response.answers,b.input.expected).passes,false);
  assert.equal(E.evaluateRun(b.runs[0].output.response.answers,{}).passes,null);
  const csv=E.csv(archive);assert.match(csv,/"min_probability","expected_probability","passes","run_passes"/);
  E.removeRun(b,2);assert.equal(E.summarize(b).metrics.contexto.passes,2);assert.equal(E.summarize(b).metrics.contexto.count,2);
});
test('rename metadata merges independently of run progress, stale tabs and deletion', () => {
  const original={schemaVersion:1,cases:[],batches:[batch()]}, renamed=E.clone(original), id=original.batches[0].id;
  E.renameBatch(renamed,id,'Renamed');
  // The older-named version may have more execution progress.
  renamed.batches[0].runs.pop(); renamed.batches[0].status='interrupted';
  for(const [a,b] of [[renamed,original],[original,renamed]]) {
    const merged=E.mergeArchives(E.clone(a),E.clone(b));
    assert.equal(E.testName(merged.batches[0]),'Renamed');
    assert.deepEqual(merged.batches[0].runs,original.batches[0].runs);
    assert.deepEqual(merged.batches[0].input,original.batches[0].input);
  }
  const removed=E.clone(original); E.removeItem(removed,'batches',id);
  assert.equal(E.mergeArchives(removed,renamed).batches.length,0);
  const bad=E.clone(original); bad.batches[0].displayName='Partial metadata'; assert.throws(()=>E.validateArchive(bad));
});
test('Noul criteria accept only true/false text descriptions without weakening other contracts', () => {
  for(const criteria of [{true:'Yes'},{false:'No'},{true:'Yes',false:'No'}]) E.validateConfig({model:'jev-latest',questions:{q:{type:'noul',instructions:'Question?',criteria}}});
  for(const criteria of [{},[],{yes:'Wrong key'},{true:true},{false:'a'.repeat(801)}]) assert.throws(()=>E.validateConfig({model:'jev-latest',questions:{q:{type:'noul',instructions:'Question?',criteria}}}));
});
test('provider labels retain local history and official provenance without rewriting responses', () => {
  const b=batch();
  assert.equal(E.batchLabel(b),'jevos · local');
  const official=E.clone(b);
  official.provider='official';
  for(const run of official.runs.filter(r=>r.output)){run.output.provider='official';run.output.response.model='jev-1.13.0';}
  assert.equal(E.batchLabel(official),'Jev oficial');
  assert.match(E.csv({batches:[b,official]}),/"official","jev-1.13.0"/);
  assert.match(E.csv({batches:[b,official]}),/"local","jevos-v3"/);
  b.runs[0].output.provider='official'; b.runs[0].output.response.model='jev-1.13.0';
  assert.equal(E.batchLabel(b),'Provedores mistos');
  assert.equal(E.aggregate(b),null);
});
test('structured States survive archives and CSV without becoming object-object', () => {
  const b=batch(); b.input.state=E.clone(prototypeRequest.state);
  b.runs.filter(r=>r.output).forEach(r=>r.output.request.state=E.clone(b.input.state));
  const archive={schemaVersion:1,cases:[],batches:[b]};
  assert.deepEqual(E.validateArchive(JSON.parse(JSON.stringify(archive))),archive);
  assert.ok(E.sameState(E.aggregate(b).request.state,b.input.state));
  assert.match(E.csv(archive),/recent_context/); assert.doesNotMatch(E.csv(archive),/\[object Object\]/);
  const changed=E.clone(b.input); changed.state.current_utterance='Different';
  assert.throws(()=>E.validateOutput(b.runs[0].output,changed));
});
const input = () => ({ name:'Caso PT', language:'pt', state:'Vamos usar a dimensão nova.', config:{model:'jev-latest',questions:{
  tipo:{type:'choice',instructions:'Intent?',criteria:{decisao:'Decision',outro:'Other'}},
  relevancia:{type:'score',instructions:'Relevance?',criteria:['Low','Medium','High']},
  contexto:{type:'noul',instructions:'Missing context?'}
}}, expected:{tipo:{type:'choice',value:'decisao'},relevancia:{type:'score',value:2},contexto:{type:'noul',value:false}} });
function output(value, decision = true, score = 1.6, noul = .2) {
  return { request:E.request(value), latencyMs:100, response:{model:'jevos-v3',answers:{
    tipo:{type:'choice',choice:decision?'decisao':'outro',probabilities:{decisao:decision?.8:.3,outro:decision?.2:.7},confidence:.5},
    relevancia:{type:'score',score,probabilities:{0:.1,1:.2,2:.7},confidence:.5},contexto:{type:'noul',noul}
  }} };
}
function batch() {
  const value=input(); return {id:'b1',createdAt:new Date().toISOString(),input:E.clone(value),requested:4,status:'done',runs:[
    {index:1,status:'done',output:output(value)}, {index:2,status:'done',output:output(value)},
    {index:3,status:'done',output:output(value,false,1.8,.8)}, {index:4,status:'error',error:'offline'}
  ]};
}
test('expected answers and language metadata are never included in model input', () => {
  const value=input(); E.validateInput(value);
  assert.deepEqual(Object.keys(E.request(value)), ['model','state','questions']);
  assert.equal(E.request(value).expected, undefined);
  const frozen=E.clone(value); value.state='Edited'; value.expected.tipo.value='outro';
  assert.equal(frozen.state,'Vamos usar a dimensão nova.'); assert.equal(frozen.expected.tipo.value,'decisao');
});
test('means, ranges and matches exclude failures and do not equate consistency with correctness', () => {
  const result=E.summarize(batch());
  assert.equal(result.count,3); assert.equal(result.failed,1); assert.equal(result.comparisons,9); assert.equal(result.matches,7);
  assert.equal(result.consistency,2/3); assert.equal(result.metrics.tipo.matches,2);
  assert.ok(Math.abs(result.metrics.relevancia.mean - 5/3) < 1e-12);
  assert.equal(result.metrics.relevancia.min,1.6); assert.equal(result.metrics.relevancia.max,1.8);
  const wrong=batch(); wrong.input.expected.tipo.value='outro'; wrong.runs=wrong.runs.slice(0,2);
  assert.equal(E.summarize(wrong).consistency,1); assert.equal(E.summarize(wrong).metrics.tipo.matches,0);
});
test('undefined expectations have no denominator; score compares modal level rather than rounded average', () => {
  const b=batch(); b.input.expected={}; const result=E.summarize(b);
  assert.equal(result.comparisons,0); assert.equal(result.matches,0); assert.equal(result.metrics.tipo.matches,null);
  assert.equal(E.predicted({type:'score',score:.9,probabilities:{0:.45,1:.2,2:.35}}),0);
  assert.equal(E.predicted({type:'score',score:1,probabilities:{0:.5,1:0,2:.5}}),null);
  assert.equal(E.predicted({type:'noul',noul:.5}),true);
});
test('archive roundtrips preserve language, exact prompts, expected answers and independent real runs', () => {
  const b=batch(); const archive={schemaVersion:1,cases:[{id:'c1',createdAt:b.createdAt,input:input()}],batches:[b]};
  assert.deepEqual(E.validateArchive(JSON.parse(JSON.stringify(archive))), archive);
  for(const language of ['pt','en','fr','es']) { const value=input();value.language=language;E.validateInput(value); }
  const imported=E.validateArchive(archive); imported.batches[0].input.config.questions.tipo.instructions='Changed';
  assert.equal(archive.batches[0].input.config.questions.tipo.instructions,'Intent?');
});
test('invalid expectations, out-of-range responses, wrong state and tampered archives are rejected', () => {
  const value=input(); value.expected.contexto.value='false'; assert.throws(()=>E.validateInput(value));
  const good=input(); const response=output(good); response.request.state='Another text'; assert.throws(()=>E.validateOutput(response,good));
  const b=batch();b.runs[0].output.response.answers.contexto.noul=1.01;
  assert.throws(()=>E.validateArchive({schemaVersion:1,cases:[],batches:[b]}));
  const valid=batch(); valid.runs[0].output.response.answers.tipo.choice='unknown';
  assert.throws(()=>E.validateOutput(valid.runs[0].output,valid.input));
});
test('CSV exports each execution and expected values while escaping spreadsheet formulas', () => {
  const b=batch(); b.input.name=' =SUM(1,2)'; b.input.state='A "quoted" text';
  const text=E.csv({batches:[b]}); assert.match(text, /' =SUM\(1,2\)/); assert.match(text, /A ""quoted"" text/);
  assert.equal(text.split('\r\n').length,13); assert.match(text,/"false"/); assert.match(text,/"offline"/);
});
test('merging another tab retains its tests without breaking an in-flight batch reference', () => {
  const first=batch(), second=batch(); second.id='b2';second.status='running';second.runs=[];
  const stored={schemaVersion:1,cases:[],batches:[first]}, current={schemaVersion:1,cases:[],batches:[second]};
  const merged=E.mergeArchives(stored,current);
  assert.equal(merged.batches.length,2);assert.equal(merged.batches[1],second);
  second.runs.push({index:1,status:'done',output:output(second.input)});
  assert.equal(merged.batches[1].runs.length,1);
  const stale=E.clone(first);stale.runs=[];
  assert.equal(E.mergeArchives(stored,{...current,batches:[stale]}).batches[0].runs.length,4);
});
test('deleting a case preserves its batch snapshot and old tabs cannot resurrect it', () => {
  const b=batch(), c={id:'c1',createdAt:b.createdAt,input:input()}; b.caseId=c.id;
  const data={schemaVersion:1,cases:[c],batches:[b]}, stale=E.clone(data);
  E.removeItem(data,'cases','c1');
  assert.equal(data.cases.length,0); assert.equal(data.batches.length,1);
  assert.deepEqual(data.batches[0].input,stale.batches[0].input);
  for(const merged of [E.mergeArchives(stale,data),E.mergeArchives(data,stale)]) {
    assert.equal(merged.cases.length,0); assert.equal(merged.batches.length,1);
    E.validateArchive(merged);
  }
});
test('deleting a batch removes its outputs without deleting the reusable case', () => {
  const b=batch(), c={id:'c1',createdAt:b.createdAt,input:input()};
  const data={schemaVersion:1,cases:[c],batches:[b]}, stale=E.clone(data);
  E.removeItem(data,'batches','b1');
  const merged=E.mergeArchives(data,stale);
  assert.deepEqual(merged.cases,[c]); assert.equal(merged.batches.length,0);
  assert.equal(E.csv(merged).split('\r\n').length,1); E.validateArchive(merged);
});
test('individual deletion removes actual output, updates statistics and CSV, and survives stale merges', () => {
  const b=batch(), data={schemaVersion:1,cases:[],batches:[b]}, stale=E.clone(data);
  E.removeRun(b,3);
  assert.deepEqual(b.runs[2],{index:3,status:'deleted'});
  assert.equal(E.summarize(b).count,2); assert.equal(E.summarize(b).matches,6);
  assert.equal(E.summarize(b).comparisons,6); assert.equal(E.summarize(b).consistency,1);
  assert.equal(E.csv(data).split('\r\n').length,10);
  for(const merged of [E.mergeArchives(data,E.clone(stale)),E.mergeArchives(E.clone(stale),data)]) {
    assert.deepEqual(merged.batches[0].runs[2],{index:3,status:'deleted'}); E.validateArchive(merged);
  }
  E.removeRun(b,1); E.removeRun(b,2); E.removeRun(b,4);
  assert.equal(E.summarize(b).count,0); assert.equal(E.summarize(b).latencyMs,null);
  assert.equal(E.csv(data).split('\r\n').length,1); E.validateArchive(data);
});
test('deletion rejects missing IDs and running batches; deleted archives cannot hide output data', () => {
  const b=batch(), data={schemaVersion:1,cases:[],batches:[b]};
  b.status='running'; assert.throws(()=>E.removeItem(data,'batches',b.id)); assert.throws(()=>E.removeRun(b,1));
  b.status='done'; assert.throws(()=>E.removeItem(data,'cases','missing')); assert.throws(()=>E.removeRun(b,8));
  E.removeRun(b,1); b.runs[0].output={secret:'must not remain'}; assert.throws(()=>E.validateArchive(data));
  delete b.runs[0].output; data.deleted={cases:[],batches:['b1']}; assert.throws(()=>E.validateArchive(data));
});
test('summary averages actual distributions and latency without creating or modifying a model run', () => {
  const b=batch(); b.runs[0].output.latencyMs=250; b.runs[1].output.latencyMs=750; b.runs[2].output.latencyMs=500;
  const frozen=JSON.stringify(b), result=E.aggregate(b), stats=E.summarize(b);
  assert.equal(result.kind,'aggregate'); assert.equal(result.count,3);
  assert.deepEqual(result.request,E.request(b.input)); assert.equal(result.answers.tipo.choice,'decisao');
  assert.ok(Math.abs(result.answers.tipo.probabilities.decisao - 1.9/3) < 1e-12);
  assert.ok(Math.abs(result.answers.contexto.noul - .4) < 1e-12);
  assert.ok(Math.abs(result.answers.relevancia.score - 5/3) < 1e-12);
  assert.equal(result.response,undefined); assert.equal(result.answers.tipo.confidence,undefined);
  assert.equal(stats.latencyMs,500); assert.equal(stats.latencyMinMs,250); assert.equal(stats.latencyMaxMs,750); assert.equal(stats.latencyTotalMs,1500);
  assert.equal(JSON.stringify(b),frozen);
  E.removeRun(b,3); assert.equal(E.aggregate(b).count,2); assert.equal(E.aggregate(b).answers.contexto.noul,.2);
});
test('summary handles empty batches and tied average distributions explicitly', () => {
  const b=batch();b.runs=b.runs.slice(0,2);
  for(const run of b.runs)run.output.response.answers.tipo.probabilities={decisao:.5,outro:.5};
  assert.equal(E.aggregate(b).answers.tipo.choice,null);
  b.runs=[{index:1,status:'error',error:'offline'},{index:2,status:'deleted'}];
  assert.equal(E.aggregate(b),null);assert.equal(E.summarize(b).latencyTotalMs,null);
});
test('UI and comparison export express model durations in seconds, not milliseconds', () => {
  assert.equal(E.seconds(619),'0,619 s');assert.equal(E.seconds(0),'0,000 s');assert.equal(E.seconds(null),'—');
  const data={batches:[batch()]}, exported=E.csv(data);
  assert.match(exported,/latency_seconds/);assert.doesNotMatch(exported,/latency_ms/);assert.match(exported,/"0.1"/);
  assert.equal(data.batches[0].runs[0].output.latencyMs,100,'raw stored measurement retains its original unit');
});
