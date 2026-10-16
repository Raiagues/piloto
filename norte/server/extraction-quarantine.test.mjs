import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemAiService, hydrateExtraction, validateExtractedSystem } from "./system-ai.mjs";
import { quarantineExtraction } from "./extraction-quarantine.mjs";

const project={id:"quarantine-project",name:"Mission Aurora",memoryRevision:1,context:{projectArtifactIds:["source"]}};
const text="Mission Aurora has a reviewed subsystem and one motor.";
const parsed=[{source:{artifactId:"source",artifactLabel:"Design",status:"parsed"},text}];
const artifact={id:"source",label:"Design",scope:"project",ownerId:project.id,url:`data:text/plain;base64,${Buffer.from(text).toString("base64")}`};
const raw=()=>({entities:[{id:"mission",name:"Mission Aurora",kind:"system",description:"Documented mission",source:"documented",confidence:1,evidenceRefs:["good"],properties:[{key:"mass",name:"Mass",value:42,unit:"kg",source:"documented",evidenceRefs:["good"]}]}],relations:[],requirements:[],evidence:[{id:"good",artifactId:"source",artifactLabel:"Design",excerpt:text,kind:"fact"}]});
const validate=(value)=>validateExtractedSystem(value,project,parsed,"test",{allowEmpty:true});
async function settled(service,id){for(let i=0;i<500;i++){const job=service.job(id,{scopeKey:"account"});if(!["queued","preparing","running"].includes(job.status))return job;await new Promise(r=>setTimeout(r,10));}throw Error("Job did not settle");}
const response=(value)=>new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(value)}]}}]}));

test("quarantine removes an unsupported property without altering a verified physical fact",()=>{
  const candidate=hydrateExtraction(raw(),project),original=JSON.stringify(candidate);
  const result=quarantineExtraction(candidate,validate);
  assert.equal(result.model.entities.length,1);
  assert.deepEqual(result.model.entities[0].properties,[]);
  assert.equal(result.review.needsReview,true);
  assert.deepEqual(result.review.omissions.map(o=>[o.kind,o.id]),[["property","mission:mass"]]);
  assert.equal(JSON.stringify(candidate),original);
});

test("quarantined absolute limits explain the condition error without rewriting their numbers",()=>{
  const candidate=raw();
  candidate.entities[0].properties=[{key:"maximum_operating_voltage",name:"Tensão operacional máxima",value:6,unit:"V",source:"documented",evidenceRefs:["limit"]}];
  candidate.evidence.push({id:"limit",artifactId:"source",artifactLabel:"Design",excerpt:"Maximum Operating Voltage 6.0 V",kind:"fact"});
  const sources=[{...parsed[0],text:`${text}\n30.1 Absolute Maximum Ratings*\nMaximum Operating Voltage 6.0 V\n30.2 DC Characteristics\nVCC 1.8 V to 5.5 V`}];
  const result=quarantineExtraction(hydrateExtraction(candidate,project),(value)=>validateExtractedSystem(value,project,sources,"test"));
  assert.deepEqual(result.model.entities[0].properties,[]);
  assert.equal(result.model.evidence.find(e=>e.id==="limit").excerpt,"Maximum Operating Voltage 6.0 V");
  assert.match(result.review.omissions[0].reason,/limite absoluto de dano/u);
  assert.equal(candidate.entities[0].properties[0].value,6);
});

test("a fabricated quote removes its dependent hierarchy, relations and requirements",()=>{
  const candidate=raw();candidate.entities[0].properties=[];
  candidate.evidence.push({id:"bad",artifactId:"source",artifactLabel:"Design",excerpt:"Invented subsystem statement.",kind:"fact"});
  candidate.entities.push({...candidate.entities[0],id:"sub",name:"Subsystem",kind:"subsystem",parentId:"mission",evidenceRefs:["bad"]},{...candidate.entities[0],id:"motor",name:"Motor",kind:"component",parentId:"sub"});
  candidate.relations.push({id:"rel",from:"mission",to:"motor",kind:"powers",label:"",source:"documented",confidence:1,evidenceRefs:["good"]});
  candidate.requirements.push({id:"req",title:"Motor check",statement:"Check motor",subsystemTags:[],reviewTags:[],evidenceRefs:["good"],relatedEntityIds:["motor"],relatedRelationIds:["rel"],properties:[]});
  const result=quarantineExtraction(hydrateExtraction(candidate,project),validate);
  assert.deepEqual(result.model.entities.map(e=>e.id),["mission"]);
  assert.deepEqual(result.model.relations,[]);assert.deepEqual(result.model.requirements,[]);
  assert.deepEqual(new Set(result.review.omissions.map(o=>o.kind)),new Set(["evidence","entity","relation","requirement"]));
  assert.deepEqual(result.model.evidence.map(e=>e.id),["good"]);
});

test("overlong citations require a contiguous full match before splitting or conservative quarantine",()=>{
  const first="Mission Aurora documented subsystem. ".repeat(220);
  const last="The reviewed source explicitly lists a motor. ".repeat(80);
  const sourceText=first+"SOURCE SENTENCE THAT MUST NOT BE REMOVED. "+last;
  const candidate=raw();candidate.entities[0].properties=[];candidate.evidence[0].excerpt=sourceText;
  const sources=[{...parsed[0],text:sourceText}];
  const check=(value)=>validateExtractedSystem(value,project,sources,"test",{allowEmpty:true});
  const faithful=check(hydrateExtraction(candidate,project));
  assert.ok(faithful.evidence.length>10);assert.ok(faithful.evidence.every(e=>e.excerpt.length<=600));
  candidate.evidence[0].excerpt=first+last;
  assert.throws(()=>check(hydrateExtraction(candidate,project)),{code:"SYSTEM_EVIDENCE_INVALID"});
  const quarantined=quarantineExtraction(hydrateExtraction(candidate,project),check);
  assert.deepEqual(quarantined.model.entities,[]);assert.equal(quarantined.review.needsReview,true);
  candidate.entities[0].unexpectedField=true;
  assert.throws(()=>quarantineExtraction(hydrateExtraction(candidate,project),check),{code:"SYSTEM_RESPONSE_INVALID"});
});

test("only two complete grounding failures permit quarantine, and cached omissions survive restart",async()=>{
  const cache=await mkdtemp(join(tmpdir(),"norte-quarantine-"));let calls=0;
  const options={apiKey:"test-only",extractionCacheDirectory:cache,maxContractAttempts:2,fetch:async()=>{calls++;return response(raw());}};
  try{
    const service=createSystemAiService(options);const initial=await service.start(project,[artifact],"en",{scopeKey:"account"});
    const job=await settled(service,initial.jobId);
    assert.equal(calls,2);assert.equal(job.status,"completed",JSON.stringify(job.error));assert.equal(job.progress.coverage,1);
    assert.equal(job.report.needsReview,true);assert.equal(job.report.omissions.length,1);assert.match(job.report.warnings.at(-1),/parte verificável/u);
    assert.deepEqual(job.result.entities[0].properties,[]);
    const restarted=createSystemAiService(options),next=await restarted.start(project,[artifact],"en",{scopeKey:"account"}),replay=await settled(restarted,next.jobId);
    assert.equal(calls,2);assert.equal(replay.progress.cachedChunks,1);assert.deepEqual(replay.report.omissions,job.report.omissions);
  }finally{await rm(cache,{recursive:true,force:true});}
});

test("after a schema retry, only the latest complete grounded candidate can be quarantined",async()=>{
  let calls=0;
  const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxContractAttempts:2,fetch:async()=>response(++calls===1?{entities:[]}:raw())});
  const initial=await service.start(project,[artifact],"en",{scopeKey:"account"}),job=await settled(service,initial.jobId);
  assert.equal(calls,2);assert.equal(job.status,"completed",JSON.stringify(job.error));assert.equal(job.report.needsReview,true);
  assert.deepEqual(job.result.entities[0].properties,[]);
});

test("separate context citations cannot be concatenated into fabricated documentary evidence",async()=>{
  const one="Mission Aurora is a satellite.",two="EPS is its documented power subsystem.";
  const sourceText=one+" This intervening source sentence cannot disappear. "+two;
  const original=raw();original.entities[0].properties=[];original.evidence[0].excerpt=one;
  original.entities.push({...original.entities[0],id:"eps",name:"EPS",kind:"subsystem",parentId:"mission",evidenceRefs:["second"]});
  original.evidence.push({...original.evidence[0],id:"second",excerpt:two});
  const stitched=raw();stitched.entities[0].properties=[];stitched.evidence[0].excerpt=one+"\n\n"+two;
  const documents=[{...artifact,url:`data:text/plain;base64,${Buffer.from(sourceText).toString("base64")}`},{...artifact,id:"continuation",url:`data:text/plain;base64,${Buffer.from("Continuation document. ".repeat(40)).toString("base64")}`}];
  const selected={...project,context:{projectArtifactIds:documents.map(d=>d.id)}};let calls=0;
  const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxContractAttempts:2,extractionConcurrency:1,fetch:async()=>response(++calls===1?original:stitched)});
  const initial=await service.start(selected,documents,"en",{scopeKey:"account"}),job=await settled(service,initial.jobId);
  assert.equal(calls,3);assert.equal(job.status,"completed",JSON.stringify(job.error));
  assert.equal(job.result.entities.length,2);assert.equal(job.report.needsReview,true);
  assert.ok(job.report.omissions.some(o=>o.kind==="evidence"&&o.id==="good"));
  assert.ok(job.result.evidence.every(e=>e.excerpt!==one+"\n\n"+two));
});

test("a single attempt, invalid schema and incomplete provider output never yield quarantine success",async()=>{
  for(const [attempts,fetch] of [[1,async()=>response(raw())],[2,async()=>response({entities:[]})],[2,async()=>new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:JSON.stringify(raw())}]}}]}))]]){
    const service=createSystemAiService({apiKey:"test-only",extractionCacheDirectory:"",maxContractAttempts:attempts,fetch});
    const initial=await service.start(project,[artifact],"en",{scopeKey:"account"}),job=await settled(service,initial.jobId);
    assert.equal(job.status,"failed");assert.equal(job.result,undefined);assert.equal(job.report.omissions.length,0);
  }
});
