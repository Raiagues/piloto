import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';
import { createValidationProject } from './test-support/project.mjs';
import { totp } from './platform-security.mjs';
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
 const f=await setup(t),{request,alice,bob,admin}=f;
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

test('requirement analysis rechecks edit permission after authorization and before any provider request',{timeout:15000},async t=>{
 let calls=0;const f=await setup(t,async()=>{calls++;return response({findings:[]});}),{request,alice,base}=f;
 const action=async(action,payload)=>{const state=(await request(alice,'GET',base+'/delivery')).json();return request(alice,'POST',base+'/delivery/actions',{action,...payload,expectedRevision:state.revision,expectedBaselineHash:state.baselineHash});};
 let saved=await action('requirement.save',{item:{title:'Telemetry timing',statement:'O sistema deve responder rapidamente.',sectorId:'avionics'}});assert.equal(saved.statusCode,200,saved.body);const id=saved.json().requirements[0].id;
 await action('standards.set',{standards:['nasa-hb']});
 const hook=interceptUpdate(f.app.missionStore,fn=>fn.toString().includes('reserveEngineeringBudget'));
 const pending=request(alice,'POST',`${base}/delivery/requirements/${id}/analyze`,{});await hook.waiting;await hook.original(data=>{data.users.find(u=>u.id===alice.id).accessRole='advisor';});hook.release();const rejected=await pending;assert.equal(rejected.statusCode,403,rejected.body);assert.equal(calls,0);
});
