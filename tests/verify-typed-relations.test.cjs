const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../scripts/verify-typed-relations.cjs'),TR=require('../typed-relations.js');
const fixture=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'fixtures/typed-relations-curated.json')));
test('CLI confines network to local official proxy and keeps evaluation modes explicit',()=>{
 assert.equal(R.options(['--isolated']).isolated,true);assert.equal(R.options(['--from-run','x.json'])['from-run'],'x.json');
 for(const args of [['--isolated','--from-run','x'],['--url','https://example.com'],['--url','http://user:pass@localhost:8000'],['--url','http://localhost:8000/elsewhere'],['--url','http://localhost:8000/?x=1'],['--batch']])assert.throws(()=>R.options(args));
});
test('isolated upstream is marked annotated and sends only source events to relations',()=>{
 const run=R.isolatedRun(fixture);assert.equal(run.upstream_origin,'annotated_fixture');assert.equal(run.records.length,0);assert.equal(run.calls,0);assert.equal(run.meeting_events.length,fixture.cases.length);
 for(const event of run.meeting_events){for(const part of TR.plan(run,event,TR.candidatesFor(run,event),'relation_type',TR.defaults)){assert.ok(part.request,part.error);R.assertNoExpected(part.request);assert.equal(JSON.stringify(part.request).includes('review_notes'),false);}}
 const summary=R.summarize(run,fixture,{mode:'isolated',restored:true});assert.equal(summary.upstream_evaluated,false);assert.equal(summary.classifications_correct,false);assert.equal(summary.relations.not_processed,summary.relations.expected_pairs);
});
test('isolated evaluator refuses implicit thread labels',()=>{
 const batch=structuredClone(fixture);delete batch.expected_threads.F01.expected_thread_id;assert.throws(()=>R.isolatedRun(batch));
});
test('lifecycle checkpoints see only chronological prefix, never future relations',()=>{
 const run=R.isolatedRun(fixture),proposal=run.meeting_events.find(e=>e.chunk_id==='F04'),result=run.meeting_events.find(e=>e.chunk_id==='F05');
 run.meeting_relations=[{relation_id:'R1',source_event_id:result.event_id,target_event_id:proposal.event_id,relation_type:'result_of',configuration_match:'exact',configuration_applicable:true,relation_probability:.99,match_probability:.99,review_state:'confirmed'}];
 const subset={review_notes:{lifecycle_checkpoints:[{after_chunk:'F04',target_chunk:'F04',expected_test_state:'open'},{after_chunk:'F05',target_chunk:'F04',expected_test_state:'completed'}]}};
 const checks=R.lifecycleChecks(run,subset);assert.ok(checks.every(c=>c.matches));assert.equal(checks[0].actual.status,'open');assert.equal(checks[1].actual.status,'completed');
});
test('CLI transport integration: local fixtures, full upstream, isolated mode, prior-run reuse and fatal response without retry',async()=>{
 const http=require('node:http'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'norte-typed-cli-')),calls=[];let fail=false;
 const batch={batch_id:'CLI-FIXTURE',cases:[{id:'C1',current_utterance:'The motor is vibrating.',expected_store_memory:true,expected_event_type:'observation'},{id:'C2',current_utterance:'The motor housing is steel.',expected_store_memory:true,expected_event_type:'observation'}],expected_threads:{C1:{expected_action:'create_new_thread',expected_thread_id:'T001'},C2:{expected_active_thread_id:'T001',expected_active_result:'belongs',expected_action:'keep_active_thread',expected_thread_id:'T001'}},expected_typed_relations:{C2:{C1:{relation_type:'none'}}}};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/health')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({provider:'official',ready:true}));
  let raw='';for await(const part of req)raw+=part;const request=JSON.parse(raw);R.assertNoExpected(request);calls.push(req.url);
  if(fail)return res.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'fixture quota failure'}));
  const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
   if(q.type==='noul')return [id,{type:'noul',noul:.97}];
   const choice=id==='event_type'?'observation':id.startsWith('relation_type__')?'none':'belongs',keys=Object.keys(q.criteria);return [id,{type:'choice',choice,confidence:.97,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?.97:.03/(keys.length-1)]))}];
  }));res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({request,response:{model:'local-fixture-not-real-AI',answers},provider:'official',latencyMs:1}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const invoke=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/verify-typed-relations.cjs'),'--url',url,...args],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.once('error',reject);child.once('exit',code=>resolve({code,output}));});
 try{
  const fixturePath=path.join(dir,'batch.json');await fsp.writeFile(fixturePath,JSON.stringify(batch));
  const full=path.join(dir,'full.json'),first=await invoke(['--batch',fixturePath,'--output',full]);assert.equal(first.code,0,first.output);const a=JSON.parse(await fsp.readFile(full));assert.equal(a.summary.all_checks_passed,true);assert.equal(a.summary.upstream.chunks.matches,2);assert.equal(a.summary.upstream.threads.matches,2);assert.equal(a.summary.relations.correct,1);assert.equal(a.summary.restore_verified,true);
  calls.length=0;const reused=await invoke(['--from-run',full,'--output',path.join(dir,'reused.json')]);assert.equal(reused.code,0,reused.output);assert.deepEqual(calls,['/api/typed-relations']);
  calls.length=0;const isolated=path.join(dir,'isolated.json'),second=await invoke(['--batch',fixturePath,'--isolated','--output',isolated]);assert.equal(second.code,0,second.output);assert.deepEqual(calls,['/api/typed-relations']);assert.equal(JSON.parse(await fsp.readFile(isolated)).summary.upstream_evaluated,false);
  const rejectIsolated=await invoke(['--from-run',isolated,'--output',path.join(dir,'bad.json')]);assert.equal(rejectIsolated.code,1);assert.match(rejectIsolated.output,/actual upstream model outputs/);
  calls.length=0;fail=true;const failed=path.join(dir,'failed.json'),third=await invoke(['--batch',fixturePath,'--isolated','--output',failed]);assert.equal(third.code,1);assert.equal(calls.length,1);const failure=JSON.parse(await fsp.readFile(failed));assert.equal(failure.requests.length,1);assert.equal(failure.requests[0].http_status,429);assert.match(failure.summary.fatal_error,/fixture quota failure/);assert.equal(failure.summary.all_checks_passed,false);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fsp.rm(dir,{recursive:true,force:true});}
});
