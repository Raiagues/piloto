/* global window */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
import { createValidationProject } from '../server/data-store.mjs';

const directory=await mkdtemp(join(tmpdir(),'norte-navigation-browser-'));
const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'../.runtime/validation');
const port=5347,origin=`http://127.0.0.1:${port}`,projectId='navigation-browser',endpoint=`/api/projects/${projectId}`;
const previousOrigins=process.env.NORTE_ALLOWED_ORIGINS;
let app,vite,browser,page,releasePut;
const errors=[],events=[],checks=[];
async function stop(child){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},4000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
try{
 await mkdir(output,{recursive:true});process.env.NORTE_ALLOWED_ORIGINS=origin;
 app=await buildApp({storeFile:join(directory,'state.json'),logger:false,demoAccount:false,ai:{apiKey:''},systemAi:{apiKey:''}});await app.listen({host:'127.0.0.1',port:0});
 const config=join(directory,'vite.config.mjs');await writeFile(config,'export default '+JSON.stringify({root,base:'/norte/',server:{hmr:false,watch:null,proxy:{'/api':{target:`http://127.0.0.1:${app.server.address().port}`,changeOrigin:false}}}})+';\n');
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config',config,'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,env:{...process.env,VITE_DEMO_MODE:'false'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let diagnostics='';const timer=setTimeout(()=>reject(new Error('Vite startup timeout '+diagnostics)),30000);vite.stdout.on('data',chunk=>{if(String(chunk).includes('Local:')){clearTimeout(timer);resolve();}});vite.stderr.on('data',chunk=>{diagnostics+=chunk;});vite.once('exit',code=>{clearTimeout(timer);reject(new Error(`Vite exited ${code}: ${diagnostics}`));});});
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{window.localStorage.setItem('norte-language','pt');window.localStorage.setItem('norte-active-project-v1','navigation-browser');});
 const registered=await context.request.post(origin+'/api/auth/register',{data:{name:'Revisora Navegação',nickname:'navigation_reviewer',email:'navigation-isolated@example.test',password:'isolated-navigation-test-password'}});assert.equal(registered.status(),201,await registered.text());const actor=await registered.json(),headers={'x-csrf-token':actor.csrfToken};
 const teamResponse=await context.request.post(origin+'/api/teams',{headers,data:{name:'Equipe navegação isolada'}});assert.equal(teamResponse.status(),201,await teamResponse.text());const team=(await teamResponse.json()).team;
 const project=createValidationProject();project.id=projectId;project.name='Projeto original';project.context.teamId=team.id;project.context.teamName=team.name;project.context.assignments=[{memberId:actor.user.memberId,roleId:'captain',sectorId:''}];
 const created=await context.request.post(origin+'/api/projects',{headers,data:project});assert.equal(created.status(),201,await created.text());
 await app.missionStore.update(data=>{data.users.find(user=>user.id===actor.user.id).onboarding={completed:true,goal:'project',version:1};});
 page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/norte/#/');
 const openProject=async()=>{await page.locator('.home-action-card.accent-open').click();await page.locator('.home-project-open').filter({hasText:'Projeto original'}).click();await page.waitForURL(url=>url.hash.startsWith('#/study-setup'));};
 await openProject();await page.locator('.app-header').getByRole('button',{name:'Voltar à página anterior',exact:true}).click();await page.waitForURL(url=>url.hash==='#/');checks.push('App header back returns to the previous page after project open');
 await openProject();await page.getByRole('button',{name:'Configuração',exact:true}).click();const field=page.locator('#project-memory-name');await field.waitFor();
 let mode='hold',getCount=0,putCount=0,notifyHeld;
 const held=new Promise(resolve=>{notifyHeld=resolve;}),gate=new Promise(resolve=>{releasePut=resolve;});
 await page.route(origin+endpoint,async route=>{
  const request=route.request();if(request.method()==='GET'){getCount++;events.push('GET');await route.continue();return;}
  if(request.method()!=='PUT'){await route.continue();return;}
  putCount++;events.push('PUT request');
  if(mode==='hold'){notifyHeld();await gate;}
  if(mode==='fail'){events.push('PUT failed');await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'TEST_SAVE_FAILURE',message:'Falha simulada de persistência.'})});return;}
  const response=await route.fetch();events.push('PUT completed');assert.equal(response.status(),200,await response.text());await route.fulfill({response});
 });
 const savedName='Nome preservado após salvamento';await field.fill(savedName);await held;
 const startHash=new URL(page.url()).hash;
 await page.locator('.app-header').getByRole('link',{name:savedName,exact:true}).click();
 // The delayed PUT remains unresolved while the breadcrumb handler gets a full turn.
 await page.waitForTimeout(200);
 assert.equal(getCount,0,'project GET must wait for the pending PUT');assert.equal(new URL(page.url()).hash,startHash,'route must wait for durable save');assert.equal(await field.inputValue(),savedName);assert.equal(app.missionStore.read().workspace.projects[projectId].document.name,'Projeto original');
 mode='pass';releasePut();await page.waitForURL(url=>url.hash==='#/study-setup?tab=overview');
 assert.equal(app.missionStore.read().workspace.projects[projectId].document.name,savedName);assert(events.indexOf('GET')>events.lastIndexOf('PUT completed'),'navigation reads only after all queued writes finish');
 await page.getByRole('button',{name:'Configuração',exact:true}).click();assert.equal(await field.inputValue(),savedName);checks.push('Breadcrumb waits for delayed PUT and preserves the saved name');
 mode='fail';getCount=0;const failedName='Edição local preservada com falha',failedHash=new URL(page.url()).hash;
 await field.fill(failedName);await page.locator('.app-header').getByRole('link',{name:failedName,exact:true}).click();await page.locator('.save-error').filter({hasText:'Falha simulada de persistência.'}).waitFor();
 await page.waitForTimeout(200);assert.equal(getCount,0,'failed save must not reload older server state');assert.equal(new URL(page.url()).hash,failedHash,'failed save must preserve current route');assert.equal(await field.inputValue(),failedName,'failed save must preserve editable draft');assert.equal(app.missionStore.read().workspace.projects[projectId].document.name,savedName,'server must retain the last successful version');checks.push('Failed PUT keeps the draft and route without a stale GET');
 await page.screenshot({path:join(output,'project-navigation-save-failure.png'),fullPage:true});
 mode='pass';await page.locator('.save-error').getByRole('button',{name:'Tentar novamente',exact:true}).click();await page.locator('.save-error').waitFor({state:'hidden'});assert.equal(app.missionStore.read().workspace.projects[projectId].document.name,failedName);checks.push('Explicit retry persists the preserved draft');
 assert.deepEqual(errors,[]);assert(putCount>=3);
 await writeFile(join(output,'project-navigation-browser.json'),JSON.stringify({passed:true,isolated:true,externalModelCalls:0,checks,events,generatedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 console.log('PASS: breadcrumb delayed-save ordering, failure draft retention, explicit retry, and app-header back. Isolated data; no AI calls.');
}catch(error){await page?.screenshot({path:join(output,'project-navigation-browser-failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{releasePut?.();await browser?.close();await stop(vite);await app?.close();await rm(directory,{recursive:true,force:true});if(previousOrigins===undefined)delete process.env.NORTE_ALLOWED_ORIGINS;else process.env.NORTE_ALLOWED_ORIGINS=previousOrigins;}
