import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.mjs';
import { createValidationProject } from './data-store.mjs';

async function setup(t, scope='team') {
 const dir=await mkdtemp(join(tmpdir(),'norte-idea-draft-'));
 const app=await buildApp({logger:false,storeFile:join(dir,'state.json'),demoAccount:false,ai:{apiKey:''},systemAi:{apiKey:''}});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const req=(actor,method,path,payload)=>app.inject({method,url:'/api'+path,headers:actor?.headers,...(payload===undefined?{}:{payload})});
 async function register(name){const r=await req(null,'POST','/auth/register',{name,email:name+'@example.test',password:'idea draft isolated test passphrase'});assert.equal(r.statusCode,201,r.body);return {...r.json().user,headers:{cookie:[r.headers['set-cookie']].flat().map(x=>x.split(';')[0]).join('; '),'x-csrf-token':r.json().csrfToken}};}
 const admin=await register('admin'),author=await register('author'),reviewer=await register('reviewer');
 const team=(await req(author,'POST','/teams',{name:'Ideas isolated team'})).json().team;
 await app.missionStore.update(data=>{data.teams.find(t=>t.id===team.id).memberIds.push(reviewer.memberId);});
 const p=createValidationProject();p.id='draft-project';p.context.teamId=team.id;p.context.assignments=[{memberId:author.memberId,roleId:'captain',sectorId:''},{memberId:reviewer.memberId,roleId:'member',sectorId:''}];
 const entity=(id,name,kind,parentId)=>({id,name,kind,...(parentId?{parentId}:{}),description:'Isolated fixture',properties:[],source:'user',evidenceRefs:[],confidence:1});
 p.engineeringSystem={schemaVersion:1,id:'draft-model',name:'Draft fixture',generatedAt:new Date().toISOString(),generatedFromRevision:0,revision:1,entities:[entity('sat','Spacecraft','system'),entity('eps','Power','subsystem','sat'),{...entity('battery','Battery','component','eps'),properties:[{key:'voltage',name:'Voltage',value:3.3,unit:'V',source:'user',evidenceRefs:[]}]}],relations:[],requirements:[],evidence:[],artifactSources:[]};
 assert.equal((await req(author,'POST','/projects',p)).statusCode,201);
 await app.missionStore.update(data=>{const project=data.workspace.projects[p.id].document;project.engineeringSystem.generatedFromRevision=project.memoryRevision||0;});
 const session=(await req(author,'POST',`/projects/${p.id}/idea-sessions`,{title:'Power trade',scope})).json().session;
 const idea=(await req(author,'POST',`/idea-sessions/${session.id}/ideas`,{text:'Change battery and connect a sensor.',key:randomUUID()})).json().session.ideas[0];
 const url=`/idea-sessions/${session.id}/ideas/${idea.id}/draft`;
 const read=async(actor=author)=>{const r=await req(actor,'GET',url);assert.equal(r.statusCode,200,r.body);return r.json();};
 async function save(previous,changes={},actor=author){return req(actor,'PUT',url,{expectedRevision:previous.draft?.revision||0,ideaRevision:idea.revision,baselineHash:previous.baselineHash,deliveryRevision:previous.deliveryRevision,entities:previous.model.entities,relations:previous.model.relations,positions:{},...changes});}
 const action=(value,action,extra={},actor=author)=>req(actor,'POST',url+'/actions',{action,expectedRevision:value.draft.revision,contentHash:value.draft.contentHash,...extra});
 return {app,req,admin,author,reviewer,team,projectId:p.id,session,idea,url,read,save,action};
}

test('editable idea map persists nodes/links with CAS; independent reviewer merges only exact approved version',async t=>{
 const f=await setup(t),initial=await f.read(),before=structuredClone(f.app.missionStore.read().workspace.projects[f.projectId].document.engineeringSystem);
 const model=structuredClone(initial.model);model.entities.find(e=>e.id==='battery').properties[0].value=3;
 model.entities.push({id:'sensor',name:'Payload sensor',kind:'component',parentId:'eps',description:'Candidate part',properties:[],source:'documented',evidenceRefs:['fake-document'],confidence:1});
 model.relations.push({id:'power-link',from:'battery',to:'sensor',kind:'powers',label:'Proposed supply',source:'documented',evidenceRefs:['fake-document'],confidence:1});
 let response=await f.save(initial,model);assert.equal(response.statusCode,200,response.body);let value=response.json();
 assert.equal(value.model.entities.find(e=>e.id==='sensor').source,'user');assert.deepEqual(value.model.entities.find(e=>e.id==='sensor').evidenceRefs,[]);
 assert.equal(value.model.relations[0].source,'user');assert.equal((await f.save(initial,model)).statusCode,409);
 assert.equal((await f.save(value,{},f.reviewer)).statusCode,403);assert.equal((await f.req(f.admin,'GET',f.url)).statusCode,404);
 const sessions=(await f.req(f.reviewer,'GET',`/projects/${f.projectId}/idea-sessions`)).json();assert.equal(sessions.sessions[0].ideas[0].draft.patch,undefined,'session overview never leaks editable graph payload');
 assert.equal((await f.action(value,'request_review',{reviewers:[f.author.id]})).statusCode,400);
 response=await f.action(value,'request_review',{reviewers:[f.reviewer.id]});assert.equal(response.statusCode,200,response.body);value=response.json();
 assert.equal((await f.action(value,'review',{decision:'approve'})).statusCode,403);
 response=await f.action(value,'review',{decision:'approve'},f.reviewer);assert.equal(response.statusCode,200,response.body);value=response.json();assert.equal(value.draft.status,'approved');
 response=await f.save(value,{entities:value.model.entities.map(e=>e.id==='sensor'?{...e,name:'Edited sensor'}:e)});assert.equal(response.statusCode,200,response.body);value=response.json();assert.deepEqual(value.draft.decisions,{});assert.equal(value.draft.status,'changes_requested');
 assert.equal((await f.action(value,'merge')).statusCode,409);
 response=await f.action(value,'review',{decision:'approve'},f.reviewer);value=response.json();assert.equal(response.statusCode,200,response.body);
 assert.equal((await f.action(value,'merge',{},f.reviewer)).statusCode,403);
 response=await f.action(value,'merge');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().merged,true);
 const saved=f.app.missionStore.read().workspace.projects[f.projectId];assert.equal(saved.document.engineeringSystem.entities.find(e=>e.id==='battery').properties[0].value,3);assert.equal(saved.document.engineeringSystem.entities.find(e=>e.id==='sensor').name,'Edited sensor');assert.equal(saved.engineeringHistory.length,1);assert.deepEqual(saved.engineeringHistory[0].engineeringSystem,before);assert.equal(saved.document.engineeringSystem.revision,2);assert.equal((await f.action(value,'merge')).statusCode,409);
});

test('draft scope, source references, hierarchy, CSRF and concurrent save guards fail closed',async t=>{
 const f=await setup(t,'private'),initial=await f.read();
 assert.equal((await f.req(f.reviewer,'GET',f.url)).statusCode,404);
 const noCsrf=await f.app.inject({method:'PUT',url:'/api'+f.url,headers:{cookie:f.author.headers.cookie},payload:{}});assert.equal(noCsrf.statusCode,403);
 assert.equal((await f.save(initial,{entities:initial.model.entities.filter(e=>e.id!=='eps')})).statusCode,400);
 assert.equal((await f.save(initial,{entities:initial.model.entities.map(e=>e.id==='battery'?{...e,parentId:'sat'}:e)})).statusCode,400);
 const child=id=>({id,name:id,kind:'subsystem',description:'Cycle attempt',properties:[],source:'user',evidenceRefs:[],confidence:1}),contains=(from,to)=>({id:from+'-'+to,from,to,kind:'contains',label:'',source:'user',evidenceRefs:[],confidence:1});
 assert.equal((await f.save(initial,{entities:[...initial.model.entities,child('cycle-a'),child('cycle-b')],relations:[contains('cycle-a','cycle-b'),contains('cycle-b','cycle-a')]})).statusCode,400);
 const changed=initial.model.entities.map(e=>e.id==='battery'?{...e,name:'Candidate battery'}:e);
 const both=await Promise.all([f.save(initial,{entities:changed}),f.save(initial,{entities:changed})]);assert.deepEqual(both.map(r=>r.statusCode).sort(),[200,409]);
 const value=await f.read();assert.equal((await f.action(value,'request_review',{reviewers:[f.reviewer.id]})).statusCode,400);
 await f.app.missionStore.update(data=>{data.users.find(u=>u.id===f.author.id).active=false;});assert.equal((await f.req(f.author,'GET',f.url)).statusCode,401);
});

test('hypothesis edits, stale baseline, changed requirements and revoked reviewer invalidate draft incorporation',async t=>{
 const f=await setup(t),initial=await f.read();let r=await f.save(initial,{entities:initial.model.entities.map(e=>e.id==='battery'?{...e,name:'Alternative battery'}:e)});let value=r.json();
 r=await f.action(value,'request_review',{reviewers:[f.reviewer.id]});value=r.json();r=await f.action(value,'review',{decision:'approve'},f.reviewer);value=r.json();
 await f.app.missionStore.update(data=>{data.users.find(u=>u.id===f.reviewer.id).isFictionalProfile=true;});assert.equal((await f.action(value,'merge')).statusCode,409);assert.equal((await f.read()).draft.status,'in_review');
 await f.app.missionStore.update(data=>{data.users.find(u=>u.id===f.reviewer.id).isFictionalProfile=false;data.workspace.delivery||={};data.workspace.delivery[f.projectId]={revision:42,requirements:[],tests:[],tasks:[],proposals:[],standards:[]};});assert.equal((await f.action(value,'merge')).statusCode,409);assert.equal((await f.read()).draft.stale,true);
 await f.app.missionStore.update(data=>{delete data.workspace.delivery[f.projectId];});
 r=await f.req(f.author,'POST',`/idea-sessions/${f.session.id}/actions`,{action:'edit',ideaId:f.idea.id,expectedRevision:1,text:'A different hypothesis now'});assert.equal(r.statusCode,200);assert.equal((await f.read()).draft.stale,true);assert.equal((await f.action(value,'merge')).statusCode,409);
 await f.app.missionStore.update(data=>{data.workspace.projects[f.projectId].document.engineeringSystem.entities[0].name='New baseline';});assert.equal((await f.save(value)).statusCode,409);
});

test('layout cannot become a change, coeditors cannot review, and hidden properties cannot be dropped or exposed',async t=>{
 const f=await setup(t),initial=await f.read();let r=await f.save(initial,{positions:{eps:{x:20,y:40}}});assert.equal(r.statusCode,200,r.body);let value=r.json();assert.equal((await f.action(value,'request_review',{reviewers:[f.reviewer.id]})).json().error,'EMPTY_DRAFT');
 r=await f.save(value,{entities:value.model.entities.map(e=>e.id==='battery'?{...e,name:'Human candidate'}:e)});assert.equal(r.statusCode,200,r.body);value=r.json();r=await f.action(value,'request_review',{reviewers:[f.reviewer.id]});value=r.json();
 await f.app.missionStore.update(data=>{data.workspace.ideaSessions[f.session.id].createdBy=f.reviewer.id;});
 r=await f.save(value,{entities:value.model.entities.map(e=>e.id==='battery'?{...e,description:'Reviewer became a contributor'}:e)},f.reviewer);assert.equal(r.statusCode,200,r.body);value=r.json();assert.equal((await f.action(value,'review',{decision:'approve'},f.reviewer)).statusCode,403);
 await f.app.missionStore.update(data=>{const model=data.workspace.projects[f.projectId].document.engineeringSystem;model.evidence.push({id:'restricted-value',artifactId:'private-artifact',artifactLabel:'Private fixture',excerpt:'A restricted value.',kind:'fact'});model.entities.find(e=>e.id==='battery').properties.push({key:'hidden',name:'Restricted value',value:51,source:'documented',evidenceRefs:['restricted-value']});delete data.workspace.ideaSessions[f.session.id].ideas[0].draft;});
 const filtered=await f.read();assert.equal(filtered.model.entities.find(e=>e.id==='battery').properties.some(p=>p.key==='hidden'),false);
 r=await f.save(filtered,{entities:filtered.model.entities.map(e=>e.id==='battery'?{...e,name:'Must not drop hidden data'}:e)});assert.equal(r.statusCode,403,r.body);assert.equal(f.app.missionStore.read().workspace.projects[f.projectId].document.engineeringSystem.entities.find(e=>e.id==='battery').properties.find(p=>p.key==='hidden').value,51);
});
