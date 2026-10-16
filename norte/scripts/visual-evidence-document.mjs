/* global window, document */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import PDFDocument from 'pdfkit';
import { chromium } from 'playwright-core';
import { buildApp } from '../server/app.mjs';
const directory=await mkdtemp(join(tmpdir(),'norte-evidence-document-'));
const app=await buildApp({storeFile:join(directory,'state.json'),logger:false,serveStatic:true,systemAi:{apiKey:''}});
app.get('/norte/*',(req,reply)=>reply.sendFile(req.params['*']||'index.html'));
let browser,page;
try {
 const registration=await app.inject({method:'POST',url:'/api/auth/register',payload:{name:'Document Reviewer',email:'evidence@example.test',password:'isolated evidence review password 2026'}});assert.equal(registration.statusCode,201,registration.body);
 const cookie=registration.headers['set-cookie'].split(';')[0],headers={cookie,'x-csrf-token':registration.json().csrfToken};
 const projectId=(await app.inject({method:'GET',url:'/api/projects',headers})).json().projects[0].id;
 const quote1='The EPS distributes regulated power to the communications subsystem.';
 const quote2='Each command shall be recorded before the deployment sequence starts.';
 const pdf=new PDFDocument({size:'A4',margin:50}); const chunks=[];pdf.on('data',chunk=>chunks.push(chunk));const completed=new Promise(resolve=>pdf.on('end',resolve));
 pdf.fontSize(22).text('Interface evidence');pdf.moveDown().fontSize(12).text(quote1);pdf.addPage().fontSize(22).text('Command evidence');pdf.moveDown().fontSize(12).text(quote2);pdf.end();await completed;const bytes=Buffer.concat(chunks);
 const uploaded=await app.inject({method:'POST',url:'/api/artifacts',headers,payload:{kind:'document',scope:'project',ownerId:projectId,label:'Interface control reference',url:`data:application/pdf;base64,${bytes.toString('base64')}`,fileName:'interface.pdf',mimeType:'application/pdf',size:bytes.length}});assert.equal(uploaded.statusCode,201,uploaded.body);const artifactId=uploaded.json().artifact.id;
 await app.missionStore.update(data=>{const record=data.workspace.projects[projectId],p=record.document;data.users.find(u=>u.id===registration.json().user.id).onboarding={completed:true,version:1};p.name='Evidence review';p.navigation={lastRoute:'brainstorm',lastConceptionWorkspace:'system'};p.engineeringSystem={schemaVersion:1,id:'evidence-model',name:p.name,revision:1,generatedAt:new Date().toISOString(),generatedFromRevision:p.memoryRevision||0,entities:[{id:'system',name:'Satellite',kind:'system',description:'',properties:[],source:'documented',evidenceRefs:[],confidence:1},{id:'eps',parentId:'system',name:'EPS',kind:'subsystem',description:'Power system',properties:[],source:'documented',evidenceRefs:['e1','e2','missing'],confidence:1}],relations:[],requirements:[],artifactSources:[{artifactId,artifactLabel:'Interface control reference',status:'pdf'}],evidence:[quote1,quote2,'The EPS distributes unregulated power to the communications subsystem.'].map((excerpt,i)=>({id:['e1','e2','missing'][i],artifactId,artifactLabel:'Interface control reference',locator:`page ${i===1?2:1}`,excerpt,kind:'fact'}))};});
 await app.listen({host:'127.0.0.1',port:0});const origin=`http://127.0.0.1:${app.server.address().port}`;
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:960}});await context.addCookies([{name:'norte_session',value:cookie.slice(cookie.indexOf('=')+1),url:origin}]);await context.addInitScript(id=>{window.localStorage.setItem('norte-active-project-v1',id);window.localStorage.setItem('norte-language','pt');window.localStorage.setItem('norte-theme','light');},projectId);
 page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});await page.goto(origin+'/norte/#/brainstorming?focus=eps&review=Conferir%20interfaces');
 await page.getByRole('button',{name:'Conferir e editar',exact:true}).click();await page.locator('summary').filter({hasText:'Ver evidências no documento'}).click();
 await page.locator('.evidence-mark.active').first().waitFor({timeout:20000});assert.equal(await page.getByLabel('Página do documento',{exact:true}).inputValue(),'1');assert.equal(await page.locator('.evidence-document-viewer canvas').evaluate(el=>el.width>100&&el.height>100),true);
 await page.screenshot({path:'/tmp/norte-evidence-document-page1.png'});await page.locator('.evidence-tabs button').nth(1).click();await page.waitForFunction(()=>document.querySelector('.evidence-document-toolbar input')?.value==='2'&&document.querySelector('.evidence-mark.active'));await page.screenshot({path:'/tmp/norte-evidence-document-page2.png'});
 await page.locator('.evidence-tabs button').nth(2).click();await page.getByText('Trecho não localizado automaticamente. Confira o documento original.',{exact:true}).waitFor();assert.equal(await page.locator('.evidence-mark.active').count(),0);
 await page.locator('.evidence-tabs button').first().click();await page.locator('.evidence-mark.active').first().waitFor();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/norte-evidence-document-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);
 const denied=await app.inject({method:'GET',url:`/api/artifacts/${artifactId}/content`});assert.equal(denied.statusCode,401);
 console.log('PASS: production CSP, actual PDF canvas, exact excerpts on two pages, multi-evidence tabs, absent quote not highlighted, mobile and anonymous access denied. No AI requests.');
} catch(error){await page?.screenshot({path:'/tmp/norte-evidence-document-failure.png'}).catch(()=>{});throw error;}
finally{await browser?.close();await app.close();await rm(directory,{recursive:true,force:true});}
