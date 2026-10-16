import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';
import { totp } from './platform-security.mjs';
import { modelForArtifacts } from './project-retrieval.mjs';
const password='isolated collaboration audit password';
const model=()=>({schemaVersion:1,id:'audit-model',name:'Audit spacecraft',generatedAt:'2026-10-16T12:00:00Z',generatedFromRevision:0,revision:1,entities:[{id:'eps',name:'Electrical power system',kind:'system',description:'Human-entered fixture',properties:[{key:'voltage',name:'Supply voltage',value:3.3,unit:'V',source:'user',evidenceRefs:[]}],source:'user',evidenceRefs:[],confidence:1}],relations:[],requirements:[],evidence:[],artifactSources:[]});
async function setup(t,fetchImpl,extra={}){
 const dir=await mkdtemp(join(tmpdir(),'norte-collab-security-'));
 const app=await buildApp({logger:false,storeFile:join(dir,'state.json'),demoAccount:false,ai:{apiKey:''},systemAi:{apiKey:fetchImpl?'mock-only-key':'',fetch:fetchImpl},platform:{encryptionKey:'test-only-secure-platform-key-more-than-32-characters'},...extra});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const request=(actor,method,path,payload)=>app.inject({method,url:'/api'+path,headers:actor?.headers,...(payload===undefined?{}:{payload})});
 const account=async name=>{const r=await request(null,'POST','/auth/register',{name,email:name.toLowerCase()+'@example.test',password});assert.equal(r.statusCode,201,r.body);return{...r.json().user,headers:{cookie:[r.headers['set-cookie']].flat().map(v=>v.split(';')[0]).join('; '),'x-csrf-token':r.json().csrfToken}};};
 const admin=await account('Admin'),alice=await account('Alice'),bob=await account('Bob'),outsider=await account('Outsider');
 const team=(await request(alice,'POST','/teams',{name:'Audit engineering team'})).json().team;
 await app.missionStore.update(data=>{data.teams.find(t=>t.id===team.id).memberIds.push(bob.memberId);});
 const p=createValidationProject();p.id='audit-project';p.name='Audit project';p.context.teamId=team.id;p.context.sectors=[{id:'avionics',name:'Avionics'},{id:'structure',name:'Structure'}];p.context.assignments=[{memberId:alice.memberId,roleId:'captain',sectorId:''},{memberId:bob.memberId,roleId:'member',sectorId:'structure'}];p.engineeringSystem=model();
 const created=await request(alice,'POST','/projects',p);assert.equal(created.statusCode,201,created.body);
 await app.missionStore.update(data=>{const project=data.workspace.projects[p.id].document;project.engineeringSystem.generatedFromRevision=project.memoryRevision||0;});
 return{app,request,admin,alice,bob,outsider,team,projectId:p.id,base:`/projects/${p.id}`};
}
function interceptUpdate(store,predicate=()=>true){
 const original=store.update.bind(store);let release,entered;const waiting=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let intercepted=false;
 store.update=mutator=>{if(!intercepted&&predicate(mutator)){intercepted=true;entered();return gate.then(()=>original(mutator));}return original(mutator);};
 return{waiting,release:()=>{store.update=original;release();},original};
}
const response=output=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]}),{status:200});

test('sector conversation membership is explicit, dynamic and includes attachment authorization; platform admin has no bypass',{timeout:15000},async t=>{
 const f=await setup(t),{request,alice,bob,admin,base}=f;
 const created=await request(alice,'POST','/platform/conversations',{kind:'sector',teamId:f.team.id,projectId:f.projectId,sectorId:'avionics'});assert.equal(created.statusCode,200,created.body);const id=created.json().conversation.id;
 for(const actor of [bob,admin,f.outsider])assert.equal((await request(actor,'GET',`/platform/conversations/${id}`)).statusCode,404);
 const scopes=(await request(bob,'GET','/platform/conversation-scopes')).json().scopes;assert(!scopes.some(s=>s.sectorId==='avionics'),'default viewer role is not membership');
 await f.app.missionStore.update(data=>{data.workspace.projects[f.projectId].document.context.assignments.find(a=>a.memberId===bob.memberId).sectorRoles=[{sectorId:'avionics',role:'viewer'}];});
 assert.equal((await request(bob,'GET',`/platform/conversations/${id}`)).statusCode,200);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+vrioAAAAASUVORK5CYII=';
 const sent=await request(alice,'POST',`/platform/conversations/${id}/messages`,{key:randomUUID(),body:'Sector fixture',attachment:{dataUrl:png,name:'fixture.png'}});assert.equal(sent.statusCode,200,sent.body);const url=sent.json().message.attachment.url.slice(4);
 assert.equal((await request(bob,'GET',url)).statusCode,200);
 await f.app.missionStore.update(data=>{data.workspace.projects[f.projectId].document.context.assignments.find(a=>a.memberId===bob.memberId).sectorRoles=[];});
 assert.equal((await request(bob,'GET',url)).statusCode,404);assert.equal((await request(bob,'POST',`/platform/conversations/${id}/messages`,{key:randomUUID(),body:'revoked'})).statusCode,404);
 const privateSession=await request(alice,'POST',base+'/idea-sessions',{scope:'private',title:'Private evaluation'});assert.equal(privateSession.statusCode,200);const sid=privateSession.json().session.id;assert.equal((await request(bob,'POST',`/idea-sessions/${sid}/ideas`,{key:randomUUID(),text:'Cannot enter'})).statusCode,404);
});

test('administration conversations require current MFA and cannot expose unrelated direct chat',{timeout:15000},async t=>{
 const f=await setup(t),{request,alice,bob,admin}=f;
 const support=(await request(alice,'POST','/platform/conversations',{kind:'administration'})).json().conversation.id;
 assert.equal((await request(admin,'GET',`/platform/conversations/${support}`)).statusCode,403);
 assert.equal((await request(bob,'GET',`/platform/conversations/${support}`)).statusCode,404);
 const direct=(await request(alice,'POST','/platform/conversations',{recipientId:bob.id})).json().conversation.id;
 const enrollment=await request(admin,'POST','/platform/admin/security/enroll',{password});assert.equal(enrollment.statusCode,200,enrollment.body);
 const verify=await request(admin,'POST','/platform/admin/security/verify',{code:totp(enrollment.json().secret,Math.floor(Date.now()/30000))});assert.equal(verify.statusCode,200,verify.body);
 assert.equal((await request(admin,'GET',`/platform/conversations/${support}`)).statusCode,200);
 assert.equal((await request(admin,'GET',`/platform/conversations/${direct}`)).statusCode,404);
 await f.app.missionStore.update(data=>{for(const s of data.sessions.filter(s=>s.userId===admin.id))s.adminElevatedUntil=Date.now()-1;});
 assert.equal((await request(admin,'GET',`/platform/conversations/${support}`)).statusCode,403);
});

test('a suspended account cannot write a private idea through an already authenticated queued request',{timeout:15000},async t=>{
 const f=await setup(t),r=await f.request(f.alice,'POST',f.base+'/idea-sessions',{title:'Personal design',scope:'private'}),id=r.json().session.id;
 const hook=interceptUpdate(f.app.missionStore),pending=f.request(f.alice,'POST',`/idea-sessions/${id}/ideas`,{key:randomUUID(),text:'Queued write'});await hook.waiting;
 await hook.original(data=>{data.users.find(u=>u.id===f.alice.id).active=false;});hook.release();const rejected=await pending;assert.equal(rejected.statusCode,401,rejected.body);assert.equal(f.app.missionStore.read().workspace.ideaSessions[id].ideas.length,0);
});

test('idea starter consent is bound to exact payload, serialized before provider and revalidated inside final commit',{timeout:15000},async t=>{
 let calls=0;const f=await setup(t,async()=>{calls++;return response({suggestions:[{text:'Quais interfaces são afetadas por uma mudança no sistema de potência?',entityIds:['eps']}]});});
 let preview=(await f.request(f.alice,'GET',f.base+'/idea-starters/preview?language=pt')).json();assert.equal(preview.payload.entities[0].id,'eps');
 assert.equal((await f.request(f.alice,'POST',f.base+'/idea-starters',{previewDigest:preview.digest})).statusCode,400);assert.equal(calls,0);
 let hook=interceptUpdate(f.app.missionStore);let pending=f.request(f.alice,'POST',f.base+'/idea-starters',{consent:true,previewDigest:preview.digest,language:'pt'});await hook.waiting;
 await hook.original(data=>{data.workspace.projects[f.projectId].document.engineeringSystem.entities[0].name='Changed power system';});hook.release();let rejected=await pending;assert.equal(rejected.statusCode,409,rejected.body);assert.equal(calls,0,'stale consent must not send provider request');
 preview=(await f.request(f.alice,'GET',f.base+'/idea-starters/preview?language=pt')).json();
 hook=interceptUpdate(f.app.missionStore,fn=>fn.toString().includes("source:'model_questions'"));pending=f.request(f.alice,'POST',f.base+'/idea-starters',{consent:true,previewDigest:preview.digest,language:'pt'});await hook.waiting;
 await hook.original(data=>{data.workspace.projects[f.projectId].document.engineeringSystem.entities[0].name='Changed again';});hook.release();rejected=await pending;assert.equal(rejected.statusCode,409,rejected.body);assert.equal(calls,1);assert.equal(Object.keys(f.app.missionStore.read().workspace.ideaStarterCache||{}).length,0);
 preview=(await f.request(f.alice,'GET',f.base+'/idea-starters/preview?language=pt')).json();const success=await f.request(f.alice,'POST',f.base+'/idea-starters',{consent:true,previewDigest:preview.digest,language:'pt'});assert.equal(success.statusCode,200,success.body);assert.equal(calls,2);const reused=await f.request(f.alice,'POST',f.base+'/idea-starters',{consent:true,previewDigest:preview.digest,language:'pt'});assert.equal(reused.json().reused,true);assert.equal(calls,2);
});

test('configuration proposals require independent current members, CAS, correct history and retain human changes in project retrieval',{timeout:15000},async t=>{
 const f=await setup(t),{request,alice,bob,admin,base}=f;const read=async()=>{const r=await request(alice,'GET',base+'/configuration-changes');assert.equal(r.statusCode,200,r.body);return r.json();};
 const initial=await read(),change={id:'fixture-change',targetEntityId:'eps',kind:'parameter',oldValues:[],newValues:[{key:'voltage',name:'Supply voltage',value:3,unit:'V',source:'user',evidenceRefs:[]}],description:'Human proposed power configuration',createdAt:new Date().toISOString()};
 assert.equal((await request(admin,'POST',base+'/configuration-changes',{basis:'manual',deliveryRevision:initial.deliveryRevision,baselineHash:initial.baselineHash,change,reviewers:[bob.id]})).statusCode,404);
 assert.equal((await request(alice,'POST',base+'/configuration-changes',{basis:'manual',deliveryRevision:initial.deliveryRevision,baselineHash:initial.baselineHash,change,reviewers:[alice.id]})).statusCode,400);
 assert.equal((await request(alice,'POST',base+'/configuration-changes',{basis:'manual',deliveryRevision:initial.deliveryRevision,baselineHash:initial.baselineHash,change,reviewers:{id:bob.id}})).statusCode,400);
 let r=await request(alice,'POST',base+'/configuration-changes',{basis:'manual',deliveryRevision:initial.deliveryRevision,baselineHash:initial.baselineHash,change,reviewers:[bob.id],key:randomUUID()});assert.equal(r.statusCode,200,r.body);const id=r.json().changes[0].id,path=base+`/configuration-changes/${id}/actions`;
 assert.equal((await request(alice,'POST',path,{action:'review',decision:'approve',expectedRevision:1})).statusCode,403);
 r=await request(bob,'POST',path,{action:'review',decision:'approve',expectedRevision:1});assert.equal(r.statusCode,200,r.body);assert.equal((await request(bob,'POST',path,{action:'merge',expectedRevision:2})).statusCode,403);
 await f.app.missionStore.update(data=>{data.teams.find(t=>t.id===f.team.id).memberIds=data.teams.find(t=>t.id===f.team.id).memberIds.filter(id=>id!==bob.memberId);});assert.equal((await request(alice,'POST',path,{action:'merge',expectedRevision:2})).statusCode,409);
 await f.app.missionStore.update(data=>{data.teams.find(t=>t.id===f.team.id).memberIds.push(bob.memberId);});r=await request(alice,'POST',path,{action:'merge',expectedRevision:2});assert.equal(r.statusCode,200,r.body);
 const stored=f.app.missionStore.read().workspace.projects[f.projectId];assert.equal(stored.engineeringHistory[0].engineeringSystem.entities[0].properties[0].value,3.3);
 const visible=modelForArtifacts(stored.document.engineeringSystem,[]);assert.equal(visible.entities[0].properties[0].value,3);assert.equal(visible.entities[0].source,'user');assert.equal(visible.evidence[0].kind,'user');
 assert.equal((await request(alice,'POST',path,{action:'merge',expectedRevision:2})).statusCode,409);
 const mixed=structuredClone(stored.document.engineeringSystem);mixed.entities[0].evidenceRefs.push('private-document');mixed.evidence.push({id:'private-document',artifactId:'private',excerpt:'Confidential design description',kind:'fact'});assert.equal(modelForArtifacts(mixed,[]).entities.length,0,'human correction must not bypass revoked documentary provenance');
});

test('requirement analysis rechecks edit permission after authorization and before any provider request',{timeout:15000},async t=>{
 let calls=0;const f=await setup(t,async()=>{calls++;return response({findings:[]});}),{request,alice,base}=f;
 const action=async(action,payload)=>{const state=(await request(alice,'GET',base+'/delivery')).json();return request(alice,'POST',base+'/delivery/actions',{action,...payload,expectedRevision:state.revision,expectedBaselineHash:state.baselineHash});};
 let saved=await action('requirement.save',{item:{title:'Telemetry timing',statement:'O sistema deve responder rapidamente.',sectorId:'avionics'}});assert.equal(saved.statusCode,200,saved.body);const id=saved.json().requirements[0].id;
 await action('standards.set',{standards:['nasa-hb']});
 const hook=interceptUpdate(f.app.missionStore,fn=>fn.toString().includes('analysisBudget'));
 const pending=request(alice,'POST',`${base}/delivery/requirements/${id}/analyze`,{});await hook.waiting;await hook.original(data=>{data.users.find(u=>u.id===alice.id).accessRole='advisor';});hook.release();const rejected=await pending;assert.equal(rejected.statusCode,403,rejected.body);assert.equal(calls,0);
});

test('configuration proposals bind the delivery revision from analysis and require an explicit manual basis without one',{timeout:15000},async t=>{
 const change={id:'revision-bound-change',targetEntityId:'eps',kind:'parameter',oldValues:[],newValues:[{key:'voltage',name:'Supply voltage',value:3,unit:'V',source:'user',evidenceRefs:[]}],description:'Lower EPS supply to 3 V',createdAt:new Date().toISOString()};
 let calls=0;const f=await setup(t,undefined,{systemAiService:{interpret:async(_model,_text,_language,context)=>{calls++;await context.assertAnalysisConsent();return{status:'resolved',change};}}});
 const {request,alice,bob,base}=f;
 const session=(await request(alice,'POST',base+'/idea-sessions',{title:'Version-bound analysis',scope:'private'})).json().session;
 const idea=(await request(alice,'POST',`/idea-sessions/${session.id}/ideas`,{text:'Lower EPS supply to 3 V',key:randomUUID()})).json().session.ideas[0];
 const path=`/idea-sessions/${session.id}`,p=(await request(alice,'POST',path+'/analysis-preview',{ideaId:idea.id})).json();
 const analyzed=await request(alice,'POST',path+'/analyze',{ideaId:idea.id,consent:true,previewDigest:p.digest});assert.equal(analyzed.statusCode,200,analyzed.body);const result=analyzed.json();
 const initial=(await request(alice,'GET',base+'/configuration-changes')).json();assert.equal(result.baselineHash,initial.baselineHash);assert.equal(result.deliveryRevision,initial.deliveryRevision);assert.equal(calls,1);
 const state=(await request(alice,'GET',base+'/delivery')).json();const updated=await request(alice,'POST',base+'/delivery/actions',{action:'requirement.save',item:{title:'Revised operating voltage',statement:'The EPS shall provide at least 3.2 V.'},expectedRevision:state.revision,expectedBaselineHash:state.baselineHash});assert.equal(updated.statusCode,200,updated.body);
 const proposed={basis:'analysis',baselineHash:result.baselineHash,deliveryRevision:result.deliveryRevision,change:result.change,reviewers:[bob.id],key:randomUUID()};
 let r=await request(alice,'POST',base+'/configuration-changes',proposed);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error,'DELIVERY_CHANGED');assert.equal((await request(alice,'GET',base+'/configuration-changes')).json().changes.length,0);
 const current=(await request(alice,'GET',base+'/configuration-changes')).json();assert.equal(current.baselineHash,result.baselineHash,'requirement correction leaves the raw architecture unchanged');
 r=await request(alice,'POST',base+'/configuration-changes',{...proposed,basis:undefined,deliveryRevision:current.deliveryRevision});assert.equal(r.statusCode,400,r.body);assert.equal(r.json().error,'CHANGE_CONTEXT_REQUIRED');
 r=await request(alice,'POST',base+'/configuration-changes',{...proposed,basis:'manual',deliveryRevision:current.deliveryRevision});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().changes[0].basis,'manual');assert.equal(r.json().changes[0].deliveryRevision,current.deliveryRevision);assert.equal(calls,1,'manual proposals do not perform inference');
});

test('document changes block configuration creation, review and merge without altering an approved proposal or manual model',{timeout:15000},async t=>{
 const f=await setup(t),{request,alice,bob,base}=f;
 const current=(await request(alice,'GET',base+'/configuration-changes')).json(),change={id:'document-bound-change',targetEntityId:'eps',kind:'parameter',oldValues:[],newValues:[{key:'voltage',name:'Supply voltage',value:3,unit:'V',source:'user',evidenceRefs:[]}],description:'Manual EPS revision',createdAt:new Date().toISOString()};
 const payload={basis:'manual',baselineHash:current.baselineHash,deliveryRevision:current.deliveryRevision,change,reviewers:[bob.id]};
 let r=await request(alice,'POST',base+'/configuration-changes',{...payload,key:randomUUID()});assert.equal(r.statusCode,200,r.body);const pending=r.json().changes[0];
 r=await request(alice,'POST',base+'/configuration-changes',{...payload,key:randomUUID()});assert.equal(r.statusCode,200,r.body);const approved=r.json().changes[1],actions=id=>`${base}/configuration-changes/${id}/actions`;
 r=await request(bob,'POST',actions(approved.id),{action:'review',decision:'approve',expectedRevision:1});assert.equal(r.statusCode,200,r.body);
 const before=f.app.missionStore.read().workspace.projects[f.projectId];
 await f.app.missionStore.update(data=>{data.workspace.projects[f.projectId].document.memoryRevision++;});
 for(const [actor,url,body] of [[alice,base+'/configuration-changes',{...payload,key:randomUUID()}],[bob,actions(pending.id),{action:'review',decision:'approve',expectedRevision:1}],[alice,actions(approved.id),{action:'merge',expectedRevision:2}]]){
  r=await request(actor,'POST',url,body);assert.equal(r.statusCode,409,r.body);assert.equal(r.json().error,'SYSTEM_MEMORY_STALE');
 }
 const after=f.app.missionStore.read();assert.deepEqual(after.workspace.projects[f.projectId].document.engineeringSystem,before.document.engineeringSystem);assert.deepEqual(after.workspace.projects[f.projectId].engineeringHistory,before.engineeringHistory);
 const rows=(await request(alice,'GET',base+'/configuration-changes')).json().changes;assert.equal(rows.length,2);assert.equal(rows[0].revision,1);assert.equal(rows[1].status,'approved');assert.equal(rows[1].revision,2);
});

test('session analysis preview binds authorized data, requires explicit consent and independent access, and retries reuse cache',{timeout:15000},async t=>{
 let calls=0,captured;const f=await setup(t,undefined,{systemAiService:{interpret:async(model,text,language,context)=>{calls++;await context.assertAnalysisConsent();captured={model,text,language,context};return{status:'clarification',question:'Qual valor deve mudar?',engine:'mock'};}}});
 const session=(await f.request(f.alice,'POST',f.base+'/idea-sessions',{title:'Private power trade',scope:'private'})).json().session;
 const saved=await f.request(f.alice,'POST',`/idea-sessions/${session.id}/ideas`,{text:'Avaliar a alimentação do EPS.',key:randomUUID()});const idea=saved.json().session.ideas[0],path=`/idea-sessions/${session.id}`;
 assert.equal((await f.request(f.bob,'POST',path+'/analysis-preview',{ideaId:idea.id,language:'pt'})).statusCode,404);
 const preview=await f.request(f.alice,'POST',path+'/analysis-preview',{ideaId:idea.id,language:'pt'});assert.equal(preview.statusCode,200,preview.body);const p=preview.json();assert.equal(p.payload.hypothesis,idea.text);assert.equal(p.payload.engineeringModel.entities[0].id,'eps');assert.equal(p.payload.idea.revision,1);assert.equal(calls,0);
 assert.equal((await f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:p.digest})).statusCode,400);
 assert.equal((await f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:'other',consent:true})).statusCode,409);
 let result=await f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:p.digest,consent:true});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().status,'clarification');assert.equal(result.json().analysisModel.entities[0].id,'eps');assert.equal(result.json().deliveryRevision,0);assert.equal(calls,1);assert.equal(captured.text,idea.text);assert.deepEqual(JSON.parse(JSON.stringify(captured.context.authorizedModel)),p.payload.engineeringModel);
 result=await f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:p.digest,consent:true});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().reused,true);assert.equal(calls,1);
 await f.app.missionStore.update(data=>{data.users.find(u=>u.id===f.alice.id).accessRole='advisor';});assert.equal((await f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:p.digest,consent:true})).statusCode,403);assert.equal(calls,1);
});

test('session analysis rejects queued context changes before inference, deduplicates in-flight work and discards edited idea results',{timeout:15000},async t=>{
 let calls=0,started,release;const startedPromise=new Promise(r=>{started=r;});const f=await setup(t,undefined,{systemAiService:{interpret:async(_model,_text,_language,context)=>{calls++;await context.assertAnalysisConsent();started();await new Promise(r=>{release=r;});return{status:'clarification',question:'Qual valor?',engine:'mock'};}}});
 const session=(await f.request(f.alice,'POST',f.base+'/idea-sessions',{title:'Power session',scope:'team'})).json().session;
 const idea=(await f.request(f.alice,'POST',`/idea-sessions/${session.id}/ideas`,{text:'Alterar a alimentação.',key:randomUUID()})).json().session.ideas[0],path=`/idea-sessions/${session.id}`;
 let p=(await f.request(f.alice,'POST',path+'/analysis-preview',{ideaId:idea.id,language:'pt'})).json();let payload={ideaId:idea.id,language:'pt',previewDigest:p.digest,consent:true};
 const hook=interceptUpdate(f.app.missionStore,fn=>fn.toString().includes('ideaAnalysisBudgets'));let pending=f.request(f.alice,'POST',path+'/analyze',payload);await hook.waiting;
 await hook.original(data=>{data.projectLearning||={};data.projectLearning[f.projectId]={revision:1,events:[],versions:[],cache:{},metrics:{}};});hook.release();let result=await pending;assert.equal(result.statusCode,409,result.body);assert.equal(calls,0);
 p=(await f.request(f.alice,'POST',path+'/analysis-preview',{ideaId:idea.id,language:'pt'})).json();payload={...payload,previewDigest:p.digest};pending=f.request(f.alice,'POST',path+'/analyze',payload);await startedPromise;
 assert.equal((await f.request(f.alice,'POST',path+'/analyze',payload)).statusCode,409);assert.equal(calls,1);
 await f.request(f.alice,'POST',path+'/actions',{action:'edit',ideaId:idea.id,text:'Alterar a alimentação somente durante transmissão.',expectedRevision:idea.revision});release();result=await pending;assert.equal(result.statusCode,409,result.body);assert.equal(Object.keys(f.app.missionStore.read().workspace.ideaAnalysisCache||{}).length,0);
});

test('session analysis rechecks access inside its final transaction and never caches a revoked result',{timeout:15000},async t=>{
 let calls=0;const f=await setup(t,undefined,{systemAiService:{interpret:async()=>{calls++;return{status:'clarification',question:'Qual valor?',engine:'mock'};}}});
 const session=(await f.request(f.alice,'POST',f.base+'/idea-sessions',{title:'Shared session',scope:'team'})).json().session;
 const idea=(await f.request(f.alice,'POST',`/idea-sessions/${session.id}/ideas`,{text:'Alterar a alimentação.',key:randomUUID()})).json().session.ideas[0],path=`/idea-sessions/${session.id}`;
 const p=(await f.request(f.alice,'POST',path+'/analysis-preview',{ideaId:idea.id,language:'pt'})).json();
 const hook=interceptUpdate(f.app.missionStore,fn=>fn.toString().includes('ideaAnalysisCache'));
 const pending=f.request(f.alice,'POST',path+'/analyze',{ideaId:idea.id,language:'pt',previewDigest:p.digest,consent:true});await hook.waiting;
 await hook.original(data=>{data.teams.find(t=>t.id===f.team.id).memberIds=data.teams.find(t=>t.id===f.team.id).memberIds.filter(id=>id!==f.alice.memberId);});hook.release();const rejected=await pending;assert.equal(rejected.statusCode,404,rejected.body);assert.equal(calls,1);assert.equal(Object.keys(f.app.missionStore.read().workspace.ideaAnalysisCache||{}).length,0);
});
