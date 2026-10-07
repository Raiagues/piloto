#!/usr/bin/env node
'use strict';
// Uses application workers. Ground truth stays in the evaluator, never in API requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads,TR=require('../typed-relations.js'),V=require('../memory-v2.js');
const {assertNoExpected,summarize:summarizeUpstream}=require('./verify-memory-v2.cjs');
const root=path.resolve(__dirname,'..'),clone=v=>JSON.parse(JSON.stringify(v));
function options(argv){
 const out={url:'http://localhost:8000',isolated:false};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--isolated')out.isolated=true;else if(arg==='--help')out.help=true;
  else if(['--batch','--output','--url','--questions','--from-run'].includes(arg)){if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error(arg+' requires a value.');out[arg.slice(2)]=argv[++i];}
  else throw Error('Unknown option: '+arg);
 }
 const url=new URL(out.url);if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw Error('--url must point to the local Norte server, e.g. http://localhost:8000.');out.url=url.origin;
 if(out.isolated&&out['from-run'])throw Error('--isolated and --from-run are mutually exclusive.');return out;
}
function isolatedRun(batch){
 const run=F.createRun(batch,'official',.8,V.questions,'memory-v2-annotated-upstream');run.status='done';run.upstream_origin='annotated_fixture';
 for(const item of run.batch.cases){if(!item.expected_store_memory)continue;
  const spec=run.batch.expected_threads?.[item.id];if(!spec||!Object.hasOwn(spec,'expected_thread_id'))throw Error('Isolated evaluation requires explicit expected_thread_id (or null) for '+item.id+'.');
  const event={event_id:'E'+String(run.meeting_events.length+1).padStart(3,'0'),chunk_id:item.id,type:item.expected_event_type,text:item.current_utterance,thread_id:spec.expected_thread_id,thread_assignment_state:spec.expected_thread_id?'assigned':'pending',status:['hypothesis','test_proposal'].includes(item.expected_event_type)?'open':'active'};run.meeting_events.push(event);
 }
 const ids=[...new Set(run.meeting_events.map(e=>e.thread_id).filter(Boolean))];run.meeting_threads=ids.map(id=>({thread_id:id,status:id===ids.at(-1)?'active':'archived',event_ids:run.meeting_events.filter(e=>e.thread_id===id).map(e=>e.event_id)}));return run;
}
function lifecycleChecks(run,fixture){
 const checks=fixture.review_notes?.lifecycle_checkpoints || fixture.lifecycle_checkpoints || [];
 const positions=new Map(run.batch.cases.map((c,i)=>[c.id,i]));
 return checks.map(check=>{
  const cutoff=positions.get(check.after_chunk),target=run.meeting_events.find(e=>e.chunk_id===check.target_chunk);
  if(cutoff===undefined)throw Error('Unknown lifecycle checkpoint after_chunk '+check.after_chunk);
  const events=run.meeting_events.filter(e=>positions.get(e.chunk_id)<=cutoff),ids=new Set(events.map(e=>e.event_id));
  const relations=(run.meeting_relations||[]).filter(r=>ids.has(r.source_event_id)&&ids.has(r.target_event_id));
  const actual=target&&ids.has(target.event_id)?TR.lifecycle({...run,meeting_events:events,meeting_relations:relations})[target.event_id]:null;
  const assertions=[];
  if(check.expected_test_state!==undefined)assertions.push({field:'status',expected:check.expected_test_state,actual:actual?.status??null,matches:actual?.status===check.expected_test_state});
  if(check.expected_evidence_state!==undefined)assertions.push({field:'evidence_state',expected:check.expected_evidence_state,actual:actual?.evidence_state??null,matches:actual?.evidence_state===check.expected_evidence_state});
  if(check.expected_review_reason){const expectedMatch=check.expected_review_reason.replace(/^configuration_/,'');const present=relations.some(r=>r.target_event_id===target?.event_id&&r.configuration_match===expectedMatch);assertions.push({field:'configuration_review',expected:check.expected_review_reason,actual:actual?.review_required&&present?check.expected_review_reason:null,matches:Boolean(actual?.review_required&&present)});}
  if(check.must_not_infer==='confirmed_cause')assertions.push({field:'no_confirmed_cause',expected:'open',actual:actual?.status??null,matches:actual?.status==='open'});
  if(check.must_not_infer==='permanently_closed_requirement')assertions.push({field:'no_permanent_requirement_closure',expected:'active',actual:actual?.status??null,matches:actual?.status==='active'});
  if(check.must_not_use_result_chunk){const disallowed=run.meeting_events.find(e=>e.chunk_id===check.must_not_use_result_chunk);const forbidden=relations.some(r=>r.source_event_id===disallowed?.event_id&&r.target_event_id===target?.event_id&&r.relation_type==='result_of');assertions.push({field:'no_stale_result',expected:false,actual:forbidden,matches:!forbidden});}
  return {...clone(check),event_id:target?.event_id || null,actual,assertions,matches:assertions.length?assertions.every(a=>a.matches):null};
 });
}
function summarize(run,fixture,{mode,journal=[],restored=false,fatal=null,upstream=null}={}){
 const relations=TR.summary(run),lifecycle=lifecycleChecks(run,fixture),complete=run.typed_relation_worker?.status==='done';
 const positive=relations.expectations.filter(x=>x.expected.relation_type!=='none'),negative=relations.expectations.filter(x=>x.expected.relation_type==='none');
 const counts=list=>({total:list.length,correct:list.filter(x=>x.matches===true).length,divergent:list.filter(x=>x.matches===false).length,not_processed:list.filter(x=>x.matches===null).length});
 const expectedPairs=relations.expected_pairs;
 const classificationsCorrect=complete&&expectedPairs>0&&relations.correct===expectedPairs&&!relations.errors&&restored&&!fatal&&lifecycle.every(c=>c.matches===true);
 const upstreamCorrect=mode==='isolated'?null:upstream?.classifications_correct??null;
 return {batch_id:run.batch.batch_id,mode,upstream_origin:mode==='isolated'?'human_annotations':'real_model_outputs',upstream_evaluated:mode!=='isolated',upstream,relation_status:run.typed_relation_worker?.status || null,
  question_version:run.typed_relation_worker?.version || null,recorded_requests:journal.length,no_expected_fields_in_requests:true,restore_verified:restored,fatal_error:fatal,
  relations,positive_pairs:counts(positive),negative_pairs:counts(negative),lifecycle_checkpoints:lifecycle,lifecycle_correct:lifecycle.filter(c=>c.matches===true).length,lifecycle_total:lifecycle.length,
  classifications_correct:classificationsCorrect,all_checks_passed:classificationsCorrect&&!relations.review&&(mode==='isolated'||upstreamCorrect===true)&&(!upstream||upstream.all_checks_passed),
  caution:mode==='isolated'?'Only relation inference is measured. Event retention, type and thread identities were supplied by reviewed annotations, not predicted by JEV.':'Relation performance depends on the upstream events and threads actually predicted by JEV.'};
}
async function main(){
 const args=options(process.argv.slice(2));if(args.help){console.log('Usage: node scripts/verify-typed-relations.cjs [--batch fixture.json] [--output artifact.json] [--isolated | --from-run artifact.json] [--questions config.json] [--url http://localhost:8000]\nDefault: real chunks + threads V2 + relations. --isolated: only relations are live; upstream is annotated. --from-run: verify and reuse actual upstream, then rerun relations. No automatic retries.');return;}
 const read=p=>JSON.parse(fs.readFileSync(path.resolve(p),'utf8'));
 const prior=args['from-run']?read(args['from-run']):null;
 if(prior&&(prior.evaluation?.mode==='isolated'||prior.run?.upstream_origin==='annotated_fixture'))throw Error('--from-run requires actual upstream model outputs; use --isolated for annotated fixtures.');
 let fixture=args.batch?read(args.batch):prior?.fixture || prior?.run?.batch || read(path.join(root,'tests/fixtures/typed-relations-curated.json'));
 const configFile=args.questions?read(args.questions):null,config=TR.validateConfig(configFile?.questions?configFile:configFile?{questions:configFile}:TR.defaults);
 const mode=args.isolated?'isolated':prior?'from-run':'end-to-end';let run;
 if(prior){
  assert.ok(prior.run,'Artifact must contain run.');run=F.restore(clone(prior.run));assert.equal(run.provider,'official');assert.equal(run.thread_worker?.schemaVersion,5,'The upstream run must use thread schema 5.');assert.equal(run.status,'done');assert.equal(run.thread_worker.status,'done');
  const originalInputs=run.batch.cases.map(({id,current_utterance})=>({id,current_utterance}));const reviewed=F.validateBatch(fixture,V.questions);assert.deepEqual(reviewed.cases.map(({id,current_utterance})=>({id,current_utterance})),originalInputs,'--batch may revise local expectations but cannot change inputs of a reused run.');
  run.batch=reviewed;delete run.typed_relation_worker;run.meeting_relations=[];run=F.restore(run);
 }else run=args.isolated?isolatedRun(fixture):F.createRun(fixture,'official',.8,V.questions,'memory-v2');
 const timestamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-'),output=path.resolve(args.output || path.join(root,'.runtime','typed-relations',timestamp+'-'+mode+'.json')),summaryOutput=output.replace(/\.json$/i,'')+'.summary.json';
 if(args['from-run']&&output===path.resolve(args['from-run']))throw Error('Use a new --output path to preserve the previous evidence.');fs.mkdirSync(path.dirname(output),{recursive:true});
 const journal=[],artifact={schemaVersion:1,source:'live-jev',evaluation:{mode,upstream_origin:args.isolated?'annotated_fixture':prior?'verified_prior_real_run':'live_jev',prior_artifact:args['from-run']?path.resolve(args['from-run']):null},server:args.url,options:args,fixture:clone(fixture),run,requests:journal};
 const persist=()=>fs.writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');let halt=false,worker=null,fatal=null,restored=false;
 const signalStop=()=>{halt=true;fatal='Interrupted by operator';worker?.stop();persist();};process.once('SIGINT',signalStop);process.once('SIGTERM',signalStop);
 const send=endpoint=>async request=>{
  assertNoExpected(request);assert.ok(!JSON.stringify(request).includes('lifecycle_checkpoints'),'Lifecycle expectations leaked to API.');
  const call={index:journal.length+1,endpoint,started_at:new Date().toISOString(),request:clone(request)};journal.push(call);persist();
  try{
   const response=await fetch(args.url+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':'official'},body:JSON.stringify(request),signal:AbortSignal.timeout(120000)});call.http_status=response.status;const raw=await response.text();
   try{call.response=JSON.parse(raw);}catch(_){call.raw_response=raw;throw Error('Invalid JSON from '+endpoint+' (HTTP '+response.status+')');}
   if(!response.ok)throw Error(endpoint+': HTTP '+response.status+': '+(call.response.error || response.statusText));assert.equal(call.response.provider,'official','Expected official JEV provider.');return clone(call.response);
  }catch(error){error.stopBatch=true;call.error=error.message;fatal=error.message;halt=true;worker?.stop();throw error;}
  finally{call.finished_at=new Date().toISOString();persist();}
 };
 console.log('Live JEV typed relations: '+run.batch.batch_id+'; mode '+mode+'.'+(args.isolated?' UPSTREAM IS ANNOTATED, NOT AI-PREDICTED.':''));
 try{
  const response=await fetch(args.url+'/api/health',{signal:AbortSignal.timeout(10000)});artifact.health=await response.json();assert.ok(response.ok&&artifact.health.provider==='official'&&artifact.health.ready,'Local server must have the official JEV API configured.');
  if(mode==='end-to-end'){
   worker=T.start(run,{config:V.threadConfig,schemaVersion:5,version:'memory-v2',send:send('/api/relations'),onChange:persist});
   try{await F.execute(run,{send:send('/api/classify'),shouldStop:()=>halt,onChange:(_,change)=>{if(change.phase==='complete'){if(change.record.result?.store)worker.enqueue(run.meeting_events.at(-1));console.log(change.record.id+': '+(change.record.result?.type || 'ignore')+' '+(change.record.result?.verdict || change.record.error));}persist();}});}
   finally{worker.close();await worker.done;worker=null;}
  }
  if(!halt){
   const logged=new Set();worker=TR.start(run,{config,version:args.questions?'TRQ-file:'+path.basename(args.questions):'TRQ-default',send:send('/api/typed-relations'),onChange:(_,change)=>{const job=change?.job;if(job&&['done','error','skipped','interrupted'].includes(job.status)&&!logged.has(job.event_id)){logged.add(job.event_id);console.log(job.event_id+': '+job.status+', '+job.results.length+'/'+job.candidate_ids.length+' pairs');}persist();}});await worker.done;worker=null;
  }
 }catch(error){fatal=error.message;halt=true;worker?.stop();}
 finally{
  worker?.close();if(worker)try{await worker.done;}catch(error){fatal=[fatal,error.message].filter(Boolean).join('; ');}
  try{
   if(mode==='isolated'){if(run.typed_relation_worker){const restoredWorker=TR.restore(clone(run.typed_relation_worker),run);assert.deepEqual(restoredWorker,run.typed_relation_worker);const recovered={...run,typed_relation_worker:restoredWorker,meeting_relations:[]};TR.syncMemory(recovered);assert.deepEqual(recovered.meeting_relations,run.meeting_relations);}}
   else{const recovered=F.restore(clone(run));assert.deepEqual(recovered.meeting_events,run.meeting_events);assert.deepEqual(recovered.meeting_threads,run.meeting_threads);assert.deepEqual(recovered.meeting_relations,run.meeting_relations);if(run.typed_relation_worker)assert.deepEqual(recovered.typed_relation_worker,run.typed_relation_worker);assert.deepEqual(recovered.records.map(r=>r.result),run.records.map(r=>r.result));}
   for(const call of journal)assertNoExpected(call.request);restored=true;
  }catch(error){fatal=[fatal,'Restore assertion: '+error.message].filter(Boolean).join('; ');}
  let upstream=null;if(mode!=='isolated')upstream=summarizeUpstream(run,mode==='from-run'?prior.requests || []:journal.filter(r=>r.endpoint!=='/api/typed-relations'),restored,fatal);
  const summary=summarize(run,fixture,{mode,journal,restored,fatal,upstream});artifact.summary=summary;persist();fs.writeFileSync(summaryOutput,JSON.stringify(summary,null,2)+'\n');
  console.log('Relations '+summary.relations.correct+'/'+summary.relations.expected_pairs+'; positive '+summary.positive_pairs.correct+'/'+summary.positive_pairs.total+'; negative '+summary.negative_pairs.correct+'/'+summary.negative_pairs.total+'; review '+summary.relations.review+'; lifecycle '+summary.lifecycle_correct+'/'+summary.lifecycle_total+'; restore '+(restored?'OK':'FAILED')+'.');console.log('Run: '+output+'\nSummary: '+summaryOutput);if(fatal)console.error(fatal);process.exitCode=summary.all_checks_passed?0:1;
  process.removeListener('SIGINT',signalStop);process.removeListener('SIGTERM',signalStop);
 }
}
if(require.main===module)main().catch(error=>{console.error(error.stack || error.message);process.exitCode=1;});
module.exports={options,isolatedRun,lifecycleChecks,summarize,assertNoExpected};
