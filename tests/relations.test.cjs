const {test}=require('node:test'),assert=require('node:assert/strict');
const {setTimeout:sleep}=require('node:timers/promises');
const R=require('../relation-worker.js'),F=require('../memory-flow.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const event=(n,type='test_proposal',status='open',text='Event '+n)=>({event_id:'E'+String(n).padStart(3,'0'),chunk_id:'C'+n,timestamp:'00:00:01',type,status,text,store_confidence:.91,type_confidence:.99});
const output=(request,p=.98)=>({request:clone(request),response:{model:'fixture',answers:Object.fromEntries(Object.keys(request.questions).map((key,i)=>[key,{type:'noul',noul:Array.isArray(p)?p[i]:p,confidence:.01}]))},latencyMs:1,provider:'official'});
async function until(check){for(let i=0;i<200;i++){if(check())return;await sleep(5);}throw Error('Timed out');}

test('new configuration compares every prior type/status; legacy rules remain readable only for archives',()=>{
  const previous=[event(1),event(2,'decision','closed'),event(3,'hypothesis','open'),event(4,'requirement','active'),event(5,'test_proposal','closed')];
  assert.deepEqual(R.candidatesFor(event(6,'test_result','active'),previous,R.defaults),previous);
  assert.deepEqual(R.candidatesFor(event(6,'decision','active'),previous,R.defaults),previous);
  const config={...clone(R.defaults),candidate_rules:{decision:[{type:'requirement',status:'active'}]}};
  R.validateConfig(config);assert.deepEqual(R.candidatesFor(event(6,'decision','active'),previous,config).map(e=>e.event_id),['E004']);
  assert.throws(()=>R.validateConfig({...config,threshold:.2}));
  config.questions.has_relation.instructions='No target';assert.throws(()=>R.validateConfig(config),/candidate_id/);
});

test('one dynamic noul per candidate, full semantic State, consistent source to target, strict >80%',async()=>{
  const run={provider:'official'},sent=[];
  const worker=R.start(run,{send:async request=>{sent.push(request);return output(request,[.98,.91,.8,.04]);}});
  const events=[event(1),event(2,'hypothesis'),event(3,'requirement','active'),event(4),event(5,'test_result','active')];
  events.forEach(worker.enqueue);events.forEach(worker.enqueue);worker.close();await worker.done;
  assert.equal(run.relation_worker.status,'done');assert.equal(sent.length,4);assert.equal(run.relation_worker.jobs.length,5);
  const request=sent[3];assert.deepEqual(Object.keys(request.questions),['has_relation__E001','has_relation__E002','has_relation__E003','has_relation__E004']);
  assert.equal(request.state.current_event.text,'Event 5');assert.equal(request.state.candidates[0].status,'open');
  assert.deepEqual(Object.keys(request.state.current_event),['event_id','chunk_id','timestamp','type','text','status']);
  assert.ok(request.questions.has_relation__E002.instructions.includes('candidate E002'));
  assert.ok(!JSON.stringify(request).includes('confidence'));assert.ok(!JSON.stringify(request).includes('{{candidate_id}}'));
  assert.deepEqual(run.relations.filter(r=>r.source_event_id==='E005'),[
    {relation_id:'R006',source_event_id:'E005',target_type:'meeting_event',target_id:'E001',relation_confidence:.98},
    {relation_id:'R007',source_event_id:'E005',target_type:'meeting_event',target_id:'E002',relation_confidence:.91}
  ]);
  const restored=R.restore(run.relation_worker,events);assert.deepEqual(R.relationsFor(restored.jobs),run.relations);
  worker.stop();assert.equal(run.relation_worker.status,'done','cleanup never changes a completed worker to stopped');
});

test('large candidate sets split by question/state/byte limits without dropping or truncating any candidate',()=>{
  const current=event(80,'test_result','active'),events=Array.from({length:70},(_,i)=>event(i+1));
  const parts=R.plan(current,events,R.defaults);assert.deepEqual(parts.map(p=>p.request.state.candidates.length),[32,32,6]);
  assert.deepEqual(parts.flatMap(p=>p.request.state.candidates.map(e=>e.event_id)),events.map(e=>e.event_id));
  const long=events.slice(0,8).map(e=>({...e,text:'á'.repeat(5000)})),split=R.plan(current,long,R.defaults);
  assert.ok(split.length>1);assert.ok(split.every(p=>JSON.stringify(p.request.state).length<=16000));
  assert.deepEqual(split.flatMap(p=>p.request.state.candidates).map(e=>e.text),long.map(e=>e.text));
  const oversized=R.plan({...current,text:'x'.repeat(15900)},[event(1)],R.defaults);
  assert.equal(oversized[0].status,'error');assert.equal(oversized[0].request,undefined);assert.equal(oversized[0].candidate_id,'E001');
});

test('held relation requests cannot stall chunk processing or change candidate snapshots; FIFO consumes all work',async()=>{
  const types=['test_proposal','test_result','hypothesis','test_result'];
  const batch={batch_id:'B',cases:types.map((type,i)=>({id:'C'+(i+1),current_utterance:'Chunk '+i,expected_store_memory:true,expected_event_type:type}))};
  const run=F.createRun(batch,'official');let release,active=0,peak=0;
  const worker=R.start(run,{send:async req=>{peak=Math.max(peak,++active);await new Promise(resolve=>release=resolve);active--;return output(req);}});
  await F.execute(run,{mode:'burst',send:async req=>{
    await sleep(3);const i=Number(req.state.current_utterance.slice(-1));
    const answers=req.questions.should_store_memory?{should_store_memory:{type:'noul',noul:.9}}:{event_type:{type:'choice',choice:types[i],confidence:.99,probabilities:Object.fromEntries(F.types.map(t=>[t,t===types[i]?1:0]))}};
    return {request:req,response:{model:'fixture',answers},latencyMs:3};
  },onChange:(_,change)=>{if(change.phase==='complete'&&change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));}});
  assert.equal(run.status,'done');assert.equal(run.calls,8);assert.equal(run.meeting_events.length,4);
  assert.equal(run.relation_worker.jobs[1].status,'running');assert.equal(run.relation_worker.jobs[3].status,'queued');
  assert.deepEqual(run.relation_worker.jobs[1].candidate_ids,['E001'],'later arrivals never enter an older job');
  assert.deepEqual(worker.pending,['E003','E004']);
  const recovered=F.restore(clone(run));assert.equal(recovered.relation_worker.status,'interrupted');
  assert.equal(recovered.relation_worker.jobs[1].status,'interrupted');assert.equal(recovered.relation_worker.jobs[3].status,'interrupted');
  assert.deepEqual(F.restore(recovered).relation_worker,recovered.relation_worker,'recovery is idempotent');
  worker.close();release();await until(()=>run.relation_worker.calls===2);release();await until(()=>run.relation_worker.calls===3);release();await worker.done;
  assert.equal(peak,1);assert.equal(worker.pending.length,0);assert.equal(run.relations.length,6);
  const archive=F.emptyLibrary();F.saveTest(archive,batch,run.questions,run);
  const reloaded=F.validateLibrary(archive);assert.equal(reloaded.tests[0].relationVersion,'RQ001');
  assert.deepEqual(reloaded.tests[0].run.relations,run.relations);
  const corrupted=clone(run);corrupted.relations.push({source_event_id:'invented'});assert.deepEqual(F.restore(corrupted).relations,run.relations);
  corrupted.relation_worker.jobs[1].candidate_ids.push('E003');assert.throws(()=>F.restore(corrupted),/Candidatos/);
});

test('only the first event skips inference because there are no previous events',async()=>{
  const run={provider:'official'};let calls=0;
  const worker=R.start(run,{send:async()=>{calls++;throw Error('Unexpected');}});
  worker.enqueue(event(1,'test_result','active'));worker.close();await worker.done;
  assert.equal(calls,0);assert.deepEqual(run.relation_worker.jobs.map(j=>j.reason),['no_previous_events']);
  assert.deepEqual(run.relations,[]);
});

test('stop finishes only the in-flight part and interrupts the internal FIFO without retry',async()=>{
  const run={provider:'official'};let release,calls=0;
  const worker=R.start(run,{send:async req=>{calls++;await new Promise(r=>release=r);return output(req);}});
  const events=[event(1),event(2,'test_result','active'),event(3,'test_result','active')];events.forEach(worker.enqueue);
  await until(()=>calls===1);worker.stop();release();worker.close();await worker.done;
  assert.equal(calls,1);assert.equal(run.relation_worker.status,'stopped');assert.equal(run.relation_worker.jobs[2].status,'interrupted');
  assert.equal(run.relations.length,1);assert.deepEqual(worker.pending,[]);R.restore(run.relation_worker,events);
});

test('malformed and fatal responses never create relations, retry, or modify meeting events',async()=>{
  for(const fatal of [false,true]){
    const events=[event(1),event(2,'test_result','active'),event(3,'test_result','active')],before=clone(events),run={provider:'official',meeting_events:events};let calls=0;
    const worker=R.start(run,{send:async req=>{calls++;if(fatal)throw Object.assign(Error('Quota'),{stopBatch:true});const bad=output(req);bad.request.state.current_event.event_id='wrong';return bad;}});
    events.forEach(worker.enqueue);worker.close();await worker.done;
    assert.equal(calls,fatal?1:2);assert.deepEqual(run.relations,[]);assert.deepEqual(events,before);
    assert.equal(run.relation_worker.jobs[1].status,'error');R.restore(run.relation_worker,events);
  }
});

test('relation versions stay independent, explicit, immutable, and backwards compatible',()=>{
  const library=F.emptyLibrary(),config=clone(R.defaults);
  assert.equal(F.addRelationVersion(library,config).id,'RQ001');assert.equal(F.addRelationVersion(library,config).id,'RQ001');
  config.questions.has_relation.instructions+=' Be strict.';assert.equal(F.addRelationVersion(library,config).id,'RQ002');
  assert.equal(library.versions.length,0);assert.equal(library.tests.length,0);assert.notEqual(library.relationVersions[0].config.questions.has_relation.instructions,config.questions.has_relation.instructions);
  const legacy={schemaVersion:1,versions:[],tests:[]};assert.deepEqual(F.validateLibrary(legacy).relationVersions,[]);assert.equal(legacy.relationVersions,undefined);
});

test('optional expected relations validate directed unique chunk pairs and never enter either worker State',async()=>{
  const batch={batch_id:'B',cases:[{id:'C1',current_utterance:'Test it',expected_store_memory:true,expected_event_type:'test_proposal'},{id:'C2',current_utterance:'It failed',expected_store_memory:true,expected_event_type:'test_result'}],expected_relations:[{source_chunk_id:'C2',target_chunk_id:'C1',expected_candidate:true,expected_has_relation:false}]};
  const valid=F.validateBatch(batch);assert.deepEqual(valid.expected_relations,batch.expected_relations);
  assert.deepEqual(Object.keys(F.request(valid.cases[1],'store').state),['current_utterance']);
  const run=F.createRun(batch,'official'),sent=[];
  const controller=R.start(run,{send:async request=>{sent.push(request);return output(request);}});
  await F.execute(run,{send:async request=>{
    const type=request.state.current_utterance==='Test it'?'test_proposal':'test_result';
    return {request,response:{model:'fixture',answers:request.questions.should_store_memory?{should_store_memory:{type:'noul',noul:1}}:{event_type:{type:'choice',choice:type,confidence:1,probabilities:Object.fromEntries(F.types.map(t=>[t,t===type?1:0]))}}},latencyMs:1};
  },onChange:(_,change)=>{if(change.phase==='complete'&&change.record.result.store)controller.enqueue(run.meeting_events.at(-1));}});
  controller.close();await controller.done;assert.equal(sent.length,1);assert.ok(!JSON.stringify(sent).includes('expected'));
  assert.equal(R.auditJob(run,run.relation_worker.jobs[1]).positive[0].resultTone,'fail');
  const library=F.emptyLibrary();F.saveTest(library,batch,run.questions,run);
  assert.deepEqual(F.validateLibrary(library).tests[0].batch.expected_relations,batch.expected_relations);
  assert.deepEqual(F.restore(run).batch.expected_relations,batch.expected_relations);
  const pair=batch.expected_relations[0];
  for(const bad of [null,[pair,pair],[{...pair,target_chunk_id:'missing'}],[{...pair,target_chunk_id:'C2'}],[{...pair,source_chunk_id:'C1',target_chunk_id:'C2'}],[{...pair,expected_candidate:'true'}],[{...pair,unexpected:true}],[{source_chunk_id:'C2',target_chunk_id:'C1'}]])assert.throws(()=>F.validateBatch({...batch,expected_relations:bad}));
  const legacy={...batch};delete legacy.expected_relations;assert.equal(F.validateBatch(legacy).expected_relations,undefined);
});

test('per-source groups include every prior event, including closed decisions, without filter verdicts',async()=>{
  const events=[event(1),event(2,'decision','closed'),event(3,'hypothesis'),event(4,'requirement','active'),event(5,'test_result','active')];
  const run={provider:'official',meeting_events:events,batch:{expected_relations:[]}};
  const worker=R.start(run,{send:async request=>output(request,[.98,.7,.03,.02])});events.forEach(worker.enqueue);worker.close();await worker.done;
  events.push(event(6));
  const before=clone(run),audit=R.auditJob(run,run.relation_worker.jobs[4]);
  assert.deepEqual(audit.approved.map(p=>p.target.event_id),['E001','E002','E003','E004']);
  assert.deepEqual(audit.rejected,[]);assert.equal(audit.pairs.length,4);assert.equal(audit.filtered,false);
  assert.ok(audit.pairs.every(pair=>pair.filterMatches===null&&pair.expectedCandidateSource===null));
  assert.equal(audit.positive.length,2);assert.equal(audit.negative.length,2);
  assert.equal(audit.positive[0].resultTone,'fail','unlisted positive is a false positive');
  assert.equal(audit.positive[1].resultTone,'fail');assert.equal(audit.positive[1].retained,false);
  assert.equal(audit.negative[0].probability,.97);assert.equal(audit.negative[0].resultTone,'pass');
  assert.deepEqual(run,before,'auditing is read-only');
  const first=R.auditJob(run,run.relation_worker.jobs[0]);assert.deepEqual(first.pairs,[]);
});

test('colors distinguish relation answers and confidence while obsolete candidate expectations are ignored',async()=>{
  const events=[event(1),event(2,'hypothesis'),event(3,'requirement','active'),event(4,'decision','active'),event(5,'test_result','active')];
  const labels=[{source_chunk_id:'C5',target_chunk_id:'C1',expected_has_relation:true},{source_chunk_id:'C5',target_chunk_id:'C2',expected_candidate:false,expected_has_relation:true},{source_chunk_id:'C5',target_chunk_id:'C3',expected_has_relation:true},{source_chunk_id:'C5',target_chunk_id:'C4',expected_has_relation:true}];
  const run={provider:'official',meeting_events:events,batch:{expected_relations:labels}};
  const worker=R.start(run,{send:async request=>output(request,[.98,.8,.02,.99])});events.forEach(worker.enqueue);worker.close();await worker.done;
  const audit=R.auditJob(run,run.relation_worker.jobs[4]);
  assert.deepEqual(audit.approved.map(p=>p.resultTone),['pass','warning','fail','pass']);
  assert.equal(audit.approved[1].filterTone,'');assert.equal(audit.approved[1].obtained,true);assert.equal(audit.approved[1].retained,false);
  assert.equal(audit.rejected.length,0);assert.ok(audit.pairs.every(pair=>!pair.blocked));
  assert.equal(R.combinedTone(audit.pairs.map(p=>p.resultTone)),'fail');
  assert.equal(R.combinedTone(['pass','']), '','unlabeled results never become an all-green group');
  assert.equal(R.combinedTone(['pass','warning']),'warning');
});

test('queued, interrupted and failed relation pairs never masquerade as false answers',async()=>{
  const events=[event(1),event(2,'test_result','active')],run={provider:'official',meeting_events:events};let release;
  const worker=R.start(run,{send:async()=>{await new Promise(resolve=>release=resolve);throw Error('fixture failure');}});events.forEach(worker.enqueue);
  await until(()=>!!release);
  let audit=R.auditJob(run,run.relation_worker.jobs[1]);assert.equal(audit.pending.length,1);assert.equal(audit.negative.length,0);
  release();worker.close();await worker.done;
  audit=R.auditJob(run,run.relation_worker.jobs[1]);assert.equal(audit.pending[0].resultTone,'error');assert.equal(audit.negative.length,0);
});

test('legacy filtered snapshots retain exact requests/results on restore, but reruns strip old rules',async()=>{
  const saved=require('./fixtures/memory-relations-v1.json'),before=clone(saved),restored=F.restore(saved);
  assert.deepEqual(restored.relation_worker,saved.relation_worker);assert.deepEqual(saved,before);
  assert.equal(R.isFiltered(restored.relation_worker),true);
  const audit=R.auditJob(restored,restored.relation_worker.jobs[2]);
  assert.deepEqual(audit.approved.map(p=>p.target.event_id),['E001']);assert.deepEqual(audit.rejected.map(p=>p.target.event_id),['E002']);
  assert.equal(F.exportResults({run:restored}).filter_results.length,3);
  const run={provider:'official'},sent=[];
  const worker=R.start(run,{config:saved.relation_worker.config,version:'RQ001',send:async req=>{sent.push(req);return output(req);}});
  restored.meeting_events.forEach(worker.enqueue);worker.close();await worker.done;
  assert.equal(run.relation_worker.schemaVersion,3);assert.equal(run.relation_worker.version,null);
  assert.equal(Object.hasOwn(run.relation_worker.config,'candidate_rules'),false);
  assert.equal(sent.length,2);assert.deepEqual(sent[1].state.candidates.map(e=>e.event_id),['E001','E002']);
  assert.throws(()=>R.restore({...run.relation_worker,config:saved.relation_worker.config},restored.meeting_events),/candidate_rules/);
});

test('all-prior runtime splits calls at API limits without omitting or repeating any pair',async()=>{
  const events=Array.from({length:35},(_,i)=>event(i+1,i%2?'custom_type':'decision',i%3?'closed':'active'));
  const run={provider:'official'},sent=[];
  const worker=R.start(run,{send:async req=>{sent.push(req);return output(req,.02);}});
  events.forEach(worker.enqueue);worker.close();await worker.done;
  assert.equal(sent.reduce((n,req)=>n+Object.keys(req.questions).length,0),35*34/2);
  assert.ok(sent.every(req=>Object.keys(req.questions).length<=32));
  for(const [i,job] of run.relation_worker.jobs.entries()) {
    assert.deepEqual(job.parts.flatMap(part=>part.request.state.candidates.map(c=>c.event_id)),events.slice(0,i).map(e=>e.event_id));
  }
  assert.deepEqual(run.relation_worker.jobs.at(-1).parts.map(part=>part.request.state.candidates.length),[32,2]);
  assert.doesNotThrow(()=>R.restore(run.relation_worker,events));
});
