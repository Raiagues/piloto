const {test}=require('node:test'),assert=require('node:assert/strict');
const TR=require('../typed-relations.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const curated=require('./fixtures/typed-relations-curated.json'),holdout=require('./fixtures/typed-relations-holdout.json');

function makeRun(rows,expected={}) {
  const cases=rows.map(([id,type,thread,text])=>({id,current_utterance:text||`Project statement ${id}`,expected_store_memory:true,expected_event_type:type}));
  const meeting_events=rows.map(([id,type,thread,text],i)=>({event_id:'E'+String(i+1).padStart(3,'0'),chunk_id:id,type,text:text||`Project statement ${id}`,status:'active',thread_id:thread,thread_assignment_state:thread?'assigned':'pending'}));
  return {status:'done',provider:'official',batch:{batch_id:'TYPED-UNIT',cases,expected_typed_relations:clone(expected)},meeting_events,meeting_relations:[],thread_worker:{status:'done'}};
}
function fromFixture(fixture) {
  return makeRun(fixture.cases.map(c=>[c.id,c.expected_event_type,fixture.expected_threads[c.id].expected_thread_id,c.current_utterance]),fixture.expected_typed_relations);
}
function output(req,decisions,probabilities={}) {
  const source=req.state.current_event.chunk_id;
  const answers=Object.fromEntries(Object.entries(req.questions).map(([id,q])=>{
    const [stage,targetId]=id.split('__'),target=req.state.candidates.find(c=>c.event_id===targetId).chunk_id;
    const label=decisions[source]?.[target] || {relation_type:'none'};
    const choice=label[stage],p=probabilities[source]?.[target]?.[stage]??.96;
    assert.ok(Object.hasOwn(q.criteria,choice),`Fixture has no valid ${stage} for ${source} -> ${target}`);
    const keys=Object.keys(q.criteria);
    return [id,{type:'choice',choice,confidence:p<.8?.999:.01,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?p:(1-p)/(keys.length-1)]))}];
  }));
  return {request:clone(req),response:{model:'fixture-only',answers},provider:'official',latencyMs:1};
}
async function execute(run,decisions={},options={}) {
  const sent=[],worker=TR.start(run,{config:options.config||TR.defaults,onChange:options.onChange,send:async req=>{
    sent.push(clone(req));
    if(options.send)return options.send(req,sent.length);
    return output(req,decisions,options.probabilities);
  }});
  await worker.done;return {run,sent,worker};
}
const idFor=(run,chunk)=>run.meeting_events.find(e=>e.chunk_id===chunk).event_id;
const edgeFor=(run,source,target)=>run.meeting_relations.find(e=>e.source_event_id===idFor(run,source)&&e.target_event_id===idFor(run,target));
const stateFor=(run,chunk)=>TR.lifecycle(run)[idFor(run,chunk)];
const label=(relation_type,configuration_match)=>({relation_type,...(configuration_match?{configuration_match}:{})});
const pair=(type='result_of',match='exact')=>({R:{P:label(type,match)}});
const two=()=>makeRun([['P','test_proposal','T1'],['R','test_result','T1']]);

test('editable contract has 12 directed types and 5 configuration labels; invalid or ambiguous schemas fail early',()=>{
  assert.equal(TR.types.length,12);assert.equal(TR.matches.length,5);
  assert.deepEqual(new Set(TR.types),new Set(['none','result_of','supports','contradicts','depends_on','affects','supersedes','repeats','related_to','tests','clarifies','based_on']));
  assert.deepEqual(new Set(TR.matches),new Set(['exact','partial','mismatch','ambiguous','not_applicable']));
  const custom=clone(TR.defaults);custom.questions.relation_type.instructions+=' Review candidate {{candidate_id}}.';custom.questions.configuration_match.criteria.partial='Edited partial criterion.';
  assert.deepEqual(TR.validateConfig(custom),custom);
  for(const mutate of [c=>delete c.questions.configuration_match,c=>c.questions.relation_type.type='noul',c=>delete c.questions.relation_type.criteria.none,c=>c.questions.configuration_match.criteria.extra='Other',c=>c.questions.relation_type.instructions='No candidate placeholder']){
    const bad=clone(custom);mutate(bad);assert.throws(()=>TR.validateConfig(bad));
  }
  const copy=TR.validateConfig(custom);copy.questions.relation_type.criteria.none='Changed';assert.notEqual(custom.questions.relation_type.criteria.none,'Changed');
});

test('pair expectations are explicit, chronological and optional; none never has a configuration answer',()=>{
  const run=two(),cases=run.batch.cases;
  for(const expected of [{R:{P:label('none')}},{P:{},R:{P:label('result_of','mismatch')}},{R:{P:label('result_of')}}])assert.deepEqual(TR.validateExpected(expected,cases),expected);
  for(const bad of [{R:{R:label('none')}},{P:{R:label('none')}},{unknown:{}},{R:{unknown:label('none')}},{R:{P:label('invented')}},{R:{P:label('none','exact')}},{R:{P:label('result_of','invented')}},{R:{P:{relation_type:'result_of',confidence:1}}}])assert.throws(()=>TR.validateExpected(bad,cases));
});

test('curated and independent holdout explicitly adjudicate every previous same-thread pair and cover the whole taxonomy',()=>{
  const seenTypes=new Set(),seenMatches=new Set();
  for(const fixture of [curated,holdout]) {
    TR.validateExpected(fixture.expected_typed_relations,fixture.cases);
    assert.deepEqual(Object.keys(fixture.expected_typed_relations),fixture.cases.map(c=>c.id));
    for(const [index,c]of fixture.cases.entries()){
      const tid=fixture.expected_threads[c.id].expected_thread_id;
      const earlier=fixture.cases.slice(0,index).filter(p=>fixture.expected_threads[p.id].expected_thread_id===tid).map(p=>p.id);
      assert.deepEqual(Object.keys(fixture.expected_typed_relations[c.id]),earlier,c.id);
      for(const e of Object.values(fixture.expected_typed_relations[c.id])){seenTypes.add(e.relation_type);if(e.relation_type!=='none'){assert.ok(e.configuration_match);seenMatches.add(e.configuration_match);}else assert.equal(e.configuration_match,undefined);}
    }
  }
  assert.deepEqual(seenTypes,new Set(TR.types));assert.deepEqual(seenMatches,new Set(TR.matches));
});

test('same-thread prior events are the only candidates; pending and first events call no model; none skips matching and creates no edge',async()=>{
  const run=makeRun([['A','observation','T1'],['B','observation','T2'],['U','requirement',null],['C','observation','T1'],['D','observation','T2']]);
  const {sent}=await execute(run);
  assert.equal(sent.length,2);assert.equal(run.typed_relation_worker.calls,2);assert.deepEqual(run.meeting_relations,[]);
  assert.deepEqual(run.typed_relation_worker.jobs.map(j=>j.status),['skipped','skipped','skipped','done','done']);
  assert.equal(run.typed_relation_worker.jobs[2].reason,'thread_pending');assert.equal(stateFor(run,'U').review_required,true);
  assert.deepEqual(sent.map(r=>[r.state.current_event.chunk_id,r.state.candidates.map(c=>c.chunk_id)]),[['C',['A']],['D',['B']]]);
  assert.deepEqual(sent.map(r=>r.state.thread_history.map(c=>c.chunk_id)),[['A'],['B']]);
  assert.ok(sent.every(r=>Object.keys(r.questions).every(key=>key.startsWith('relation_type__'))));
  const before=JSON.stringify(run.meeting_events);TR.syncMemory(run);TR.lifecycle(run);assert.equal(JSON.stringify(run.meeting_events),before,'projection never rewrites source events');
});

test('configuration is asked only for positive predictions and receives the predicted type, never ground truth or bookkeeping',async()=>{
  const run=makeRun([['P','test_proposal','T1'],['B','observation','T1'],['R','test_result','T1']],{R:{P:label('none'),B:label('supports','mismatch')}});
  run.batch.review_notes={secret:'never send this'};
  const {sent}=await execute(run,pair('result_of','exact'));
  const req=sent.find(r=>r.questions.configuration_match__E001);
  assert.deepEqual(req.state.candidates.map(c=>[c.chunk_id,c.relation_type]),[['P','result_of']]);
  assert.ok(sent.every(r=>!JSON.stringify(r).match(/expected_|review_notes|secret|thread_assignment_state|lifecycle|relation_probability/)));
  assert.equal(edgeFor(run,'R','P').relation_type,'result_of','contrary expectations never replace predictions');
  const audit=TR.audit(run,run.typed_relation_worker.jobs[2]);assert.equal(audit.matches,false);assert.equal(audit.pairs.find(p=>p.target.chunk_id==='P').tone,'fail');
  delete run.batch.expected_typed_relations;assert.equal(TR.audit(run,run.typed_relation_worker.jobs[2]).matches,null,'missing expectations are not implicit none or successes');
});

test('every positive prediction remains an edge; mismatch, partial, ambiguous, or inapplicable setup never completes a test',async()=>{
  for(const match of TR.matches){
    const run=two();await execute(run,pair('result_of',match));const edge=edgeFor(run,'R','P'),state=stateFor(run,'P');
    assert.ok(edge,match);assert.equal(edge.relation_type,'result_of');assert.equal(edge.configuration_match,match==='not_applicable'?null:match);assert.equal(edge.configuration_applicable,match!=='not_applicable');
    assert.equal(state.status,match==='exact'?'completed':'open',match);assert.equal(state.review_required,match!=='exact',match);
  }
});

test('lifecycle uses selected label probabilities at the inclusive 80% threshold, never the API confidence field',async()=>{
  for(const [rp,mp,closed]of [[.79,.96,false],[.96,.79,false],[.8,.8,true],[.96,.96,true]]){
    const run=two();await execute(run,pair(),{probabilities:{R:{P:{relation_type:rp,configuration_match:mp}}}});
    const edge=edgeFor(run,'R','P');assert.ok(edge,'low probability keeps the predicted non-none edge');
    assert.equal(edge.review_state,closed?'confirmed':'needs_review');assert.equal(stateFor(run,'P').status,closed?'completed':'open');
  }
  const run=two();await execute(run,{R:{P:label('none')}},{probabilities:{R:{P:{relation_type:.5}}}});assert.equal(run.meeting_relations.length,0);assert.equal(run.typed_relation_worker.calls,1);assert.equal(TR.audit(run,run.typed_relation_worker.jobs[1]).pairs[0].tone,'warning');
});

test('repeats does not consume an earlier result or close the newly requested execution',async()=>{
  const run=makeRun([['P','test_proposal','T1'],['R','test_result','T1'],['P2','test_proposal','T1']]);
  await execute(run,{R:{P:label('result_of','exact')},P2:{P:label('repeats','exact'),R:label('none')}});
  assert.equal(stateFor(run,'P').status,'completed');assert.equal(stateFor(run,'P2').status,'open');assert.equal(stateFor(run,'P2').relation_ids.length,0);
  assert.equal(edgeFor(run,'P2','R'),undefined);assert.equal(edgeFor(run,'P2','P').relation_type,'repeats');
});

test('hypotheses accumulate supportive and challenging evidence without becoming proven or closed; requirements likewise remain active',async()=>{
  for(const type of ['hypothesis','requirement']){
    const run=makeRun([['Q',type,'T1'],['R1','test_result','T1'],['R2','test_result','T1']]);
    await execute(run,{R1:{Q:label('supports','not_applicable')},R2:{Q:label('contradicts','not_applicable')}});
    const state=stateFor(run,'Q');assert.equal(state.status,type==='hypothesis'?'open':'active');assert.equal(state.evidence_state,'mixed');assert.equal(state.review_required,true);
  }
  const run=makeRun([['Q','requirement','T1'],['R','test_result','T1']]);await execute(run,{R:{Q:label('supports','mismatch')}});
  assert.equal(stateFor(run,'Q').evidence_state,'unassessed','a mismatched acceptance setup is not accepted as proof of compliance');assert.equal(stateFor(run,'Q').review_required,true);
});

test('explicit supersession differs from completion and may change setup; ambiguous identity or low probability blocks automatic supersession',async()=>{
  for(const [match,p,superseded]of [['exact',.96,true],['partial',.96,true],['mismatch',.96,true],['not_applicable',.96,true],['ambiguous',.96,false],['mismatch',.7,false]]){
    const run=makeRun([['P','test_proposal','T1'],['D','decision','T1']]);await execute(run,{D:{P:label('supersedes',match)}},{probabilities:{D:{P:{relation_type:p}}}});
    assert.ok(edgeFor(run,'D','P'));assert.equal(stateFor(run,'P').status,superseded?'superseded':'open',match+' '+p);
  }
  const run=makeRun([['P','test_proposal','T1'],['D','decision','T1'],['R','test_result','T1']]);await execute(run,{D:{P:label('supersedes','mismatch')},R:{P:label('result_of','exact')}});
  assert.equal(stateFor(run,'P').status,'superseded','a later result must not silently revive a superseded plan');
});

test('configuration transport failure preserves an already predicted edge, records error, and leaves its test open',async()=>{
  const run=two();let calls=0;
  await execute(run,pair(),{send:async req=>{calls++;if(Object.keys(req.questions)[0].startsWith('configuration_match'))throw Error('Simulated match outage');return output(req,pair());}});
  assert.equal(calls,2);assert.equal(run.typed_relation_worker.status,'error');assert.equal(run.meeting_relations.length,1);
  const edge=edgeFor(run,'R','P');assert.equal(edge.relation_type,'result_of');assert.equal(edge.configuration_match,null);assert.equal(edge.configuration_applicable,null);assert.equal(edge.review_state,'needs_review');assert.match(edge.error,/outage/);
  assert.equal(stateFor(run,'P').status,'open');assert.equal(TR.audit(run,run.typed_relation_worker.jobs[1]).pairs[0].tone,'error');
});

test('withdrawing a result removes its completion and evidential effects without inventing replacement outcomes',async()=>{
  const run=makeRun([['H','hypothesis','T1'],['P','test_proposal','T1'],['R','test_result','T1'],['FIX','observation','T1']]);
  await execute(run,{R:{P:label('result_of','exact'),H:label('supports','not_applicable')},FIX:{R:label('supersedes','not_applicable')}});
  assert.equal(stateFor(run,'R').status,'superseded');
  assert.equal(stateFor(run,'P').status,'open');assert.equal(stateFor(run,'P').review_required,true);
  assert.equal(stateFor(run,'H').evidence_state,'unassessed');assert.equal(stateFor(run,'H').review_required,true);
  assert.equal(run.meeting_relations.length,3,'historical edges remain visible for audit');
});

test('unprocessed expected pairs cannot disappear from evaluation when upstream threads separate them',async()=>{
  const run=makeRun([['P','test_proposal','T1'],['R','test_result','T2']],pair());await execute(run,{});
  const stats=TR.summary(run);assert.equal(stats.expected_pairs,1);assert.equal(stats.correct,0);assert.equal(stats.not_processed,1);
});

test('a chain of revisions never silently resurrects an old plan or withdrawn result',async()=>{
  const run=makeRun([['P','test_proposal','T1'],['R','test_result','T1'],['FIX','observation','T1'],['REVISED_FIX','observation','T1']]);
  await execute(run,{R:{P:label('result_of','exact')},FIX:{R:label('supersedes','not_applicable')},REVISED_FIX:{FIX:label('supersedes','not_applicable')}});
  assert.equal(stateFor(run,'R').status,'superseded');assert.equal(stateFor(run,'FIX').status,'superseded');
  assert.equal(stateFor(run,'P').status,'open','a revision of a correction is not evidence that the original test was performed');
});

test('fatal transport errors stop queued work without retries or fabricated negative edges',async()=>{
  const run=makeRun([['P','test_proposal','T1'],['R','test_result','T1'],['LATER','observation','T1']]);let calls=0;
  await execute(run,{}, {send:async()=>{calls++;throw Object.assign(Error('Quota exhausted'),{stopBatch:true});}});
  assert.equal(calls,1);assert.equal(run.typed_relation_worker.status,'stopped');assert.equal(run.typed_relation_worker.jobs[2].status,'interrupted');assert.deepEqual(run.meeting_relations,[]);
  const restored=TR.restore(clone(run.typed_relation_worker),run);assert.equal(restored.status,'stopped');assert.equal(calls,1,'restore never transports requests');
});

test('request and response snapshots survive restore; forged requests, cross-thread candidates, missing responses and false call counts are rejected',async()=>{
  const run=two();await execute(run,pair());const saved=clone(run.typed_relation_worker);
  assert.deepEqual(TR.restore(saved,run),saved);
  for(const corrupt of [s=>s.jobs[1].parts[0].request.state.current_event.text='Forged',s=>s.jobs[1].candidate_ids=['foreign'],s=>delete s.jobs[1].parts[0].output,s=>s.calls++,s=>s.jobs[1].parts[1].request.state.candidates[0].relation_type='none']){
    const broken=clone(saved);corrupt(broken);assert.throws(()=>TR.restore(broken,run));
  }
  const recovered=clone(run);recovered.typed_relation_worker=TR.restore(saved,recovered);recovered.meeting_relations=[{relation_type:'forged'}];TR.syncMemory(recovered);assert.deepEqual(recovered.meeting_relations,run.meeting_relations,'derived edges are rebuilt from recorded model outputs');
});

test('curated lifecycle checkpoints follow explicit model fixtures while evidence and all none pairs remain auditable',async()=>{
  for(const fixture of [curated,holdout]){
    const run=fromFixture(fixture);await execute(run,fixture.expected_typed_relations);
    const summary=TR.summary(run);const pairs=Object.values(fixture.expected_typed_relations).flatMap(Object.values);
    assert.equal(summary.expected_pairs,pairs.length);assert.equal(summary.classified,pairs.length);assert.equal(summary.correct,pairs.length);assert.equal(summary.divergent,0);assert.equal(summary.not_processed,0);assert.equal(summary.edges,pairs.filter(p=>p.relation_type!=='none').length);
    for(const cp of fixture.review_notes.lifecycle_checkpoints){
      const stop=fixture.cases.findIndex(c=>c.id===cp.after_chunk),cut=clone(run),allowed=new Set(run.meeting_events.slice(0,stop+1).map(e=>e.event_id));
      cut.meeting_events=cut.meeting_events.filter(e=>allowed.has(e.event_id));cut.meeting_relations=cut.meeting_relations.filter(e=>allowed.has(e.source_event_id));
      const state=stateFor(cut,cp.target_chunk);
      if(cp.expected_test_state)assert.equal(state.status,cp.expected_test_state,cp.after_chunk+' -> '+cp.target_chunk);
      if(cp.expected_evidence_state)assert.equal(state.evidence_state,cp.expected_evidence_state,cp.after_chunk+' -> '+cp.target_chunk);
      if(cp.expected_review_reason)assert.equal(state.review_required,true,cp.after_chunk+' -> '+cp.target_chunk);
    }
  }
});

test('callback failures never mark the worker done, preserve errors on restore, and count only transport invocations',async()=>{
  for(const phase of ['initial','pre_transport','post_result','final']){
    const run=two();let sent=0,raised=false;
    const worker=TR.start(run,{send:async request=>{sent++;return output(request,pair());},onChange:(_,change)=>{
      const w=run.typed_relation_worker,job=change.job;
      const atPhase=phase==='initial'?!job&&w.status==='running':phase==='pre_transport'?job?.parts.some(p=>p.status==='running'&&!p.attempted):phase==='post_result'?job?.parts.some(p=>p.status==='done'&&p.stage==='relation_type')&&!job.parts.some(p=>p.stage==='configuration_match'):!job&&w.status==='done';
      if(atPhase&&!raised){raised=true;throw Error('Callback failed: '+phase);}
    }});
    await assert.rejects(worker.done,new RegExp('Callback failed: '+phase));
    assert.equal(raised,true);assert.equal(run.typed_relation_worker.status,'error');assert.equal(run.typed_relation_worker.error,'Callback failed: '+phase);
    assert.equal(sent,{initial:0,pre_transport:0,post_result:1,final:2}[phase]);assert.equal(run.typed_relation_worker.calls,sent);
    assert.equal(run.typed_relation_worker.jobs.flatMap(j=>j.parts).filter(p=>p.attempted).length,sent);
    assert.deepEqual(TR.restore(clone(run.typed_relation_worker),run),run.typed_relation_worker);
    if(phase==='post_result'){assert.equal(run.meeting_relations.length,1);assert.equal(run.meeting_relations[0].review_state,'needs_review');assert.equal(stateFor(run,'P').status,'open');}
  }
});

test('persistent callback failure retains the first error instead of losing it during final notification',async()=>{
  const run=two();let notifications=0,sent=0;
  const worker=TR.start(run,{send:async()=>{sent++;throw Error('No call expected');},onChange:()=>{throw Error(++notifications===1?'Initial persistence failure':'Secondary cleanup failure');}});
  await assert.rejects(worker.done,/Initial persistence failure/);assert.equal(sent,0);assert.equal(notifications,2);
  assert.equal(run.typed_relation_worker.status,'error');assert.equal(run.typed_relation_worker.error,'Initial persistence failure');assert.equal(run.typed_relation_worker.jobs.every(j=>j.status==='interrupted'),true);
  assert.equal(TR.restore(clone(run.typed_relation_worker),run).error,'Initial persistence failure');
});

test('stop in the notification immediately before transport sends and counts no request',async()=>{
  const run=two();let worker,sent=0,stopped=false;
  worker=TR.start(run,{send:async request=>{sent++;return output(request,pair());},onChange:(_,change)=>{
    const part=change.job?.parts.find(p=>p.status==='running');
    if(part&&!stopped){assert.equal(part.attempted,undefined);assert.equal(run.typed_relation_worker.calls,0);stopped=true;worker.stop();}
  }});
  await worker.done;assert.equal(stopped,true);assert.equal(sent,0);assert.equal(run.typed_relation_worker.calls,0);assert.equal(run.typed_relation_worker.status,'stopped');
  assert.equal(run.typed_relation_worker.jobs[1].parts[0].status,'interrupted');assert.equal(run.typed_relation_worker.jobs[1].parts[0].attempted,undefined);
  assert.deepEqual(TR.restore(clone(run.typed_relation_worker),run),run.typed_relation_worker);assert.deepEqual(run.meeting_relations,[]);
});

test('restoration rejects a globally done worker with incomplete jobs, missing parts or a recorded worker error',async()=>{
  const run=two();await execute(run,pair());const saved=clone(run.typed_relation_worker);
  for(const corrupt of [
    s=>{s.jobs[1].status='interrupted';s.calls-=s.jobs[1].parts.filter(p=>p.attempted).length;s.jobs[1].parts=[];},
    s=>{s.calls--;s.jobs[1].parts.pop();},
    s=>{s.error='Final persistence failure';},
    s=>{s.jobs[1].parts[0].attempted='yes';}
  ]){const invalid=clone(saved);corrupt(invalid);assert.throws(()=>TR.restore(invalid,run));}
});

test('constructor and toString IDs are never inherited ground truth, while explicit own labels are evaluated',async()=>{
  for(const [source,target] of [['R','constructor'],['constructor','toString']]){
    const run=makeRun([[target,'observation','T1'],[source,'observation','T1']]);
    const decisions=Object.fromEntries([[source,Object.fromEntries([[target,label('none')]])]]);
    await execute(run,decisions);const job=run.typed_relation_worker.jobs[1];
    run.batch.expected_typed_relations={};assert.equal(TR.audit(run,job).pairs[0].expected,null);assert.equal(TR.audit(run,job).matches,null);assert.equal(TR.summary(run).expected_pairs,0);
    run.batch.expected_typed_relations=Object.fromEntries([[source,{}]]);assert.equal(TR.audit(run,job).pairs[0].expected,null);assert.equal(TR.audit(run,job).matches,null);
    run.batch.expected_typed_relations=Object.create(decisions);assert.equal(TR.audit(run,job).pairs[0].expected,null);assert.equal(TR.summary(run).expected_pairs,0);
    run.batch.expected_typed_relations=decisions;assert.equal(TR.audit(run,job).matches,true);assert.equal(TR.summary(run).correct,1);assert.deepEqual(TR.summary(run).expectations[0].actual,job.results[0]);
  }
});
