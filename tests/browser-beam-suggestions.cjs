// Browser regression for the contextual simulation entry point and saved tabs.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
 const root=path.resolve(__dirname,'..'),errors=[];
 const source=await fs.readFile(path.join(root,'index.html'),'utf8');
 const room=source.slice(source.indexOf('    <section id="meetingPage"'),source.indexOf('    <section id="memoryPage"')).replace('aria-label="Sala de reunião" hidden','aria-label="Sala de reunião"');
 const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/meeting-room.css"><link rel="stylesheet" href="/meeting-beam.css"><style>body{padding:20px;display:block}#meetingPage{height:calc(100vh - 40px)}.bw-fixture{padding:60px;color:#a8c8df}</style><body data-page="beam">${room}<script src="/meeting-evidence.js"></script><script src="/meeting-beam.js"></script><script>
 window.current={id:'draft',room_kind:'beam',status:'draft',meeting_events:[],meeting_threads:[],transcript:[]};
 window.saved=0;window.mounts=0;window.requests=0;
 NorteBeamWorkspace={mount(host,{data}){mounts++;host.innerHTML='<div class="bw-fixture">Simulação aberta por solicitação</div>';const state=data||{state:{L:6},versions:[]};return {destroy(){host.replaceChildren()},snapshot(){return state},showTab(tab){host.dataset.view=tab}}}};
 window.integration=NorteMeetingBeam.create({getRun:()=>current,save:()=>saved++,notice:()=>{},submit:()=>{requests++},submitFacts:()=>false,canSubmit:()=>true});
 window.activate=run=>{current=run;integration.activate(true,run);integration.update(run)};
 activate(current);
 </script></body></html>`;
 const assets=new Set(['styles.css','meeting-room.css','meeting-beam.css','meeting-beam.js','meeting-evidence.js']);
 const server=http.createServer(async(req,res)=>{try{const name=req.url.slice(1);if(!name)return res.writeHead(200,{'Content-Type':'text/html'}).end(html);if(!assets.has(name))return res.writeHead(404).end();res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':'text/css'}).end(await fs.readFile(path.join(root,name)));}catch(error){errors.push(error.stack);res.writeHead(500).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-beam-suggestions-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});let socket;
 try{
  let port;for(let i=0;i<400;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(30);}}assert.ok(port,'Chrome starts');
  const targets=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const tabs=()=>evaluate('[...document.querySelectorAll("#beamRoomTabs button")].filter(b=>!b.hidden).map(b=>b.textContent)');
  const updateEvent=async(type,text,id,confidence=.95,threadId='T001')=>evaluate(`current.meeting_events.push({event_id:${JSON.stringify(id)},type:${JSON.stringify(type)},text:${JSON.stringify(text)},thread_id:${JSON.stringify(threadId)},store_confidence:${confidence},type_confidence:${confidence}});integration.update(current)`);
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  for(let i=0;i<300&&!await evaluate('!!window.integration');i++)await sleep(25);
  assert.deepEqual(await tabs(),['Canvas']);assert.equal(await visible('#beamSimulationSuggestion'),false);assert.equal(await visible('#beamRoomHost'),false);assert.equal(await evaluate('document.querySelector("#beamRoomHint")'),null,'old canvas popup is removed');
  await updateEvent('observation','A viga está na bancada.','E001');assert.equal(await visible('#beamSimulationSuggestion'),false,'ordinary context does not show a suggestion');
  await updateEvent('hypothesis','Uma hipótese é aumentar a espessura.','E002',.6,null);assert.equal(await visible('#beamSimulationSuggestion'),true,'a retained hypothesis at 60% can suggest a test while topic assignment is pending');assert.match(await evaluate('document.querySelector("#beamSimulationSuggestion").textContent'),/testar a espessura.*por exemplo.*Norte, vamos simular uma viga/);assert.deepEqual(await tabs(),['Canvas'],'a detected discussion does not open tabs or simulate');
  assert.equal(await evaluate('(()=>{const h=document.querySelector("#beamSimulationSuggestion"),w=document.querySelector("#roomWorkspace");return h.parentElement.id==="meetingPage"&&h.getBoundingClientRect().bottom<=w.getBoundingClientRect().top})()'),true,'suggestion is above the workspace, outside the canvas');
  await evaluate('document.querySelector(".beam-suggestion-dismiss").click();integration.update(current)');assert.equal(await visible('#beamSimulationSuggestion'),false,'dismissed suggestion stays dismissed');
  await updateEvent('test_proposal','Vamos testar uma força maior.','E003');assert.equal(await visible('#beamSimulationSuggestion'),true);assert.match(await evaluate('document.querySelector("#beamSimulationSuggestion").textContent'),/testar o carregamento/);
  const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-beam-top-suggestion.png',Buffer.from(shot.data,'base64'));
  await evaluate('document.querySelector("#beamSimulationSuggestion .compact-button").click()');assert.deepEqual(await tabs(),['Canvas','Simulação']);assert.equal(await visible('#beamRoomHost'),true);assert.equal(await visible('#beamSimulationSuggestion'),false);assert.equal(await evaluate('current.beam_started'),true);assert.equal(await evaluate('requests'),0,'opening the simulator never invents a command or calculation result');
  await evaluate('integration.showTab("graphs");window.savedRun=JSON.parse(JSON.stringify(current));activate({id:"next",room_kind:"beam",status:"draft",meeting_events:[],transcript:[]})');assert.deepEqual(await tabs(),['Canvas'],'new meetings do not inherit opened tabs or suggestions');assert.equal(await visible('#beamSimulationSuggestion'),false);
  await evaluate('activate(savedRun)');assert.deepEqual(await tabs(),['Canvas','Simulação','Gráficos']);assert.equal(await evaluate('document.querySelector("#beamRoomHost").dataset.view'),'graphs','explicitly requested tabs survive restore');
  await evaluate('activate({id:"legacy",room_kind:"beam",status:"draft",beam_started:false,beam_view:"simulation",beam_open_tabs:["canvas","simulation","graphs"],meeting_events:[],transcript:[]})');assert.deepEqual(await tabs(),['Canvas']);assert.equal(await visible('#beamRoomHost'),false,'old draft tabs cannot unlock simulation');
  await updateEvent('test_proposal','Vamos tentar aumentar a espessura de 10 para 15 mm.','E004');await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('(()=>{const r=document.querySelector("#beamSimulationSuggestion").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()'),true,'top suggestion fits narrow screens');
  await evaluate('current.status="done";integration.update(current)');assert.equal(await visible('#beamSimulationSuggestion'),false,'closed meetings do not prompt new tests');
  await evaluate('integration.activate(false,current)');assert.equal(await visible('#beamRoomTabs'),false);assert.deepEqual(errors,[]);
  console.log('PASS: contextual top suggestion, canvas-only initial/legacy tabs, explicit opening, dismissal, persistence, new-meeting isolation and narrow layout.');
 }finally{socket?.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});
