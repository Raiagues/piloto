// Browser fixtures validate simulator/meeting integration, not classifier accuracy.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
 const root=path.resolve(__dirname,'..'),requests=[],errors=[];
 const assets=new Set(['beam-engine.js','beam-commands.js','beam-workspace.js','beam-workspace.css','meeting-beam.js','meeting-beam.css','index.html','reuniao.html','styles.css','memory-flow.css','workspace.js','automation.js','classifier.js','lab.js','app.js','memory-page.js','typed-relations-page.js','relation-map.js','relation-map.css','classifier-config.json','manual-test-example.json','meeting-canvas.js','meeting-canvas.css','meeting-room.css','meeting-room.js','experiments.js','relation-worker.js','memory-flow.js','memory-v2.js','typed-relations.js','memory-storage.js','speech-windows.js','transcription.js','meeting-commands.js','meeting-session.js','meeting-evidence.js','meeting-state.js','meeting-review.js','meeting-hierarchy.js','meeting-minutes.js','meeting-minutes.css','meeting-amendments.js','meeting-document.js','gemini-minutes.js','gemini-minutes.css','vendor/minutes/jspdf-4.2.1.umd.min.js','vendor/minutes/DejaVuSans-2.37.ttf']);
 assets.add('meeting-speech.js');
 const simId=text=>String(text||'').match(/SIM-V\d+/)?.[0];
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
   if(pathname==='/api/health')return json({ready:true,provider:'official',engine:'jev-latest'});
   if(pathname==='/api/minutes'){requests.push({url:pathname});return res.writeHead(500).end('Unexpected remote generation');}
   if(['/api/classify','/api/relations','/api/typed-relations'].includes(pathname)){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push({url:pathname,body});
    assert.equal(JSON.stringify(body).includes('expected_'),false,'requests never leak test labels');
    const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
     if(q.type==='noul')return [id,{type:'noul',noul:.98}];
     const current=body.state.current_event,target=body.state.candidates?.find(item=>item.event_id===id.split('__')[1]),ops=body.state.deterministic_candidate?.operations||[];let choice;
     if(id==='beam_action')choice=ops.length>1?'compound':/load$/.test(ops[0]?.type)?'load':/support$/.test(ops[0]?.type)?'support':['show_results','show_calculations','show_canvas','show_section'].includes(ops[0]?.type)?'show_inspection':ops[0]?.type||'other_command';
     else if(id==='action_mode'){const modes=[...new Set(ops.map(op=>op.type.startsWith('add_')?'add':op.type.startsWith('update_')?'update':op.type.startsWith('remove_')?'remove':op.type.startsWith('change_')?'change':'view'))];choice=modes.length>1?'mixed':modes[0]||'not_applicable';}
     else if(id==='candidate_fit')choice=body.state.deterministic_candidate.issues.length?'incomplete':'exact';
     else if(id==='command_type')choice='conversation';
     else if(id==='speech_join')choice='separate';
     else if(id==='command_completion')choice=/\d/.test(body.state.next_utterance||'')?'completes':'separate';
     else if(id==='speech_status')choice='finished';
     else if(id==='event_type')choice=/^Teste de simulação/.test(body.state.current_utterance)?'test_proposal':/^Resultado calculado|^A simulação.*não produziu/.test(body.state.current_utterance)?'test_result':/^Talvez/.test(body.state.current_utterance)?'hypothesis':'observation';
     else if(id==='belongs_to_active_thread'||id.startsWith('belongs_to_archive_thread__'))choice='belongs';
     else if(id.startsWith('relation_type__'))choice=current?.type==='test_result'&&target?.type==='test_proposal'&&simId(current.text)===simId(target.text)?'result_of':'none';
     else if(id.startsWith('configuration_match__'))choice=body.state.relation_type==='result_of'?'exact':'not_applicable';
     const keys=Object.keys(q.criteria);assert.ok(keys.includes(choice),'Unmocked '+id+': '+choice);
     return [id,{type:'choice',choice,confidence:.12,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?.98:.02/(keys.length-1)]))}];
    }));
    await sleep(8);return json({request:body,response:{model:'browser-fixture',answers},provider:'official',latencyMs:8});
   }
   const name=pathname.slice(1)||'index.html';if(!assets.has(name))return res.writeHead(404).end();
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'font/ttf','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  }catch(error){errors.push(error.stack);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-beam-meeting-browser-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let socket,chromeError='';chrome.stderr.on('data',data=>chromeError=(chromeError+data).slice(-2000));
 try{
  let port;for(let i=0;i<600;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json());socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Page.javascriptDialogOpening'&&message.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>errors.push(error.message));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let i=0;i<500;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}const state=await evaluate('(()=>{const r=window.NorteMeetingRoom?.snapshot();return r&&{status:r.status,error:r.error,records:r.records.map(x=>({id:x.id,status:x.status,error:x.error})),threads:r.thread_worker&&{status:r.thread_worker.status,jobs:r.thread_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))},relations:r.typed_relation_worker&&{status:r.typed_relation_worker.status,error:r.typed_relation_worker.error,jobs:r.typed_relation_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))}};})()');throw Error('Timed out: '+expression+' '+JSON.stringify(errors)+' '+JSON.stringify(state));};
  const click=selector=>evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(typeof target.click==='function')target.click();else target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const snapshot=()=>evaluate('NorteMeetingRoom.snapshot()');
  const screenshot=async name=>{await call('Page.bringToFront');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-beam-meeting-'+name+'.png',Buffer.from(shot.data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
   class FixtureRecognition {
    constructor(){window.__speech=this;(window.__speechInstances||=[]).push(this);this.results=[];this.stopped=false;this.stopCalls=0;}
    start(){this.stopped=false;queueMicrotask(()=>this.onstart?.());}
    emit(text,isFinal,index=this.results.length){const result=[{transcript:text,confidence:.99}];result.isFinal=isFinal;this.results[index]=result;this.onresult?.({results:this.results,resultIndex:index});}
    stop(){this.stopCalls++;this.stopped=true;setTimeout(()=>{if(this.finalOnStop)this.emit(this.finalOnStop,true,this.results.length-1);this.onend?.();},250);}
    abort(){this.stopped=true;queueMicrotask(()=>this.onend?.());}
   }
   window.SpeechRecognition=FixtureRecognition;window.webkitSpeechRecognition=FixtureRecognition;
  `});
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  const origin='http://127.0.0.1:'+server.address().port;
  await call('Page.navigate',{url:origin+'/index.html#simulacao'});
  await wait('window.NorteMeetingRoom?.ready() && NorteClassifier.isAvailable() && document.body.dataset.page==="beam"');
  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const createInstant=async()=>{await click('#roomNew');await wait('!document.querySelector("#roomCreateMenu").hidden');assert.equal(await evaluate('document.querySelector("#roomSchedule").disabled'),true);await click('#roomCreateInstant');await wait('NorteMeetingRoom.view()==="room" && NorteMeetingRoom.snapshot()?.status==="draft"');return snapshot();};
  const edit=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const command=async(text)=>{
   const before=(await snapshot()).beam_commands?.length||0;
   if(!await visible('#beamCommandForm'))await click('#beamComposeToggle');
   await wait('!document.querySelector("#beamCommandText").disabled');
   await evaluate(`document.querySelector('#beamCommandText').value=${JSON.stringify(text)};document.querySelector('#beamCommandForm').requestSubmit()`);
   await wait('(NorteMeetingRoom.snapshot()?.beam_commands?.length||0)>'+before);
   const audit=(await snapshot()).beam_commands.at(-1);assert.equal(audit.status,'applied',JSON.stringify(audit));return audit;
  };
  const drained=()=>wait('(()=>{const r=NorteMeetingRoom.snapshot();return r.records.length>0&&r.records.every(x=>x.status==="done")&&r.thread_worker.jobs.every(x=>x.status==="done")&&r.typed_relation_worker.jobs.every(x=>["done","skipped"].includes(x.status));})()');
  assert.equal(await evaluate('NorteMeetingRoom.view()'),'library');assert.equal(await snapshot(),null);
  assert.equal(await evaluate('document.querySelector("#beamMode").getAttribute("aria-current")'),'page');
  assert.equal(await evaluate('document.querySelectorAll("#sidebar").length'),1);
  assert.equal(requests.length,0);assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  const draft=await createInstant();assert.equal(draft.room_kind,'beam');
  await wait('!!NorteMeetingRoom.snapshot()?.beam_lab');
  assert.equal(await visible('#beamCommandForm'),false);assert.equal(await visible('#beamRoomTabs'),true);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#beamRoomTabs button")].filter(x=>!x.hidden).map(x=>x.textContent)'),['Canvas','Simulação','Gráficos','Resultados','Cálculos']);
  assert.equal(await visible('#roomSessionBar'),false,'beam meetings have no repeated footer status');
  assert.equal(await visible('#beamRoomHost'),false,'draft starts on the meeting canvas');
  const first=await command('tá então o Norte vamos simular um teste uma discussão vamos simular uma viga');assert.equal(first.command_type,'open_simulation');
  await wait('NorteMeetingRoom.snapshot().meeting_events.length===2');await drained();
  const initialCalls=requests.length;
  await wait('!!document.querySelector(".bw-drawing")?.getClientRects().length');
  assert.equal(await visible('.bw-versionbar'),false);assert.equal(await visible('.bw-options'),false);assert.equal(await visible('.bw-inspector'),false);
  assert.equal(await evaluate('document.querySelectorAll(".bw-quick-results,.bw-scene-heading,.bw-legend").length'),0);
  await click('.bw-drawing [data-object="beam"]');await wait('document.querySelector(".bw-inspector").open');
  await edit('[data-field="beam.L"]',8);await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===8');
  await edit('[data-field="beam.L"]',6);await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===6');
  await click('[data-action="close-editor"]');
  const editedDraft=await snapshot();assert.equal(editedDraft.status,'running');assert.equal(editedDraft.beam_lab.versions.length,3);assert.equal(editedDraft.beam_lab.state.loads[0].x,6);
  assert.equal(editedDraft.records.length,2);assert.equal(requests.length,initialCalls,'manual exploration does not add classification calls');
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0,'creating and exploring draft never requests microphone');
  await edit('#roomTitle','Estudo da viga');
  let run=await snapshot();assert.equal(run.id,draft.id);assert.equal(run.input_mode,'text');assert.equal(run.beam_lab.state.L,6);assert.equal(run.beam_lab.versions.length,3);
  assert.equal(run.records.length,2);assert.deepEqual(run.meeting_events.map(e=>e.type),['test_proposal','test_result']);
  assert.match(run.meeting_events[1].text,/momento fletor máximo absoluto 60 kN/);
  assert.equal(run.transcript.filter(t=>t.source==='simulation').length,2);
  assert.equal(run.beam_commands[0].memory_enqueued,true);assert.ok(run.beam_recorded.includes(run.beam_commands[0].version_id));
  assert.equal(run.beam_view,'simulation');assert.equal(await visible('#roomNotice'),false,'successful commands do not display a warning banner');
  assert.equal(await visible('#beamCommandForm'),false,'successful typed submission closes the optional composer');
  assert.equal(await evaluate('document.querySelector("#roomTranscript").textContent.includes("Resultado calculado")'),false,'calculated memory is not rendered as a person speaking');
  assert.equal(await evaluate('document.querySelector("#roomTranscript").textContent.includes("Comando aplicado")'),false);
  assert.deepEqual(run.transcript.slice(0,3).map(t=>t.source),['typed','simulation','simulation'],'computed facts follow their triggering command immediately');
  for(const fact of run.transcript.filter(t=>t.source==='simulation')){assert.deepEqual(fact.simulation.state,run.beam_lab.state);assert.equal(fact.simulation.command_id,run.beam_commands[0].id);}
  assert.equal(run.transcript.filter(t=>t.command?.consumed).length,1,'spoken control itself is not a physics observation');
  assert.ok(run.meeting_relations.some(r=>r.type==='result_of'||r.relation_type==='result_of'),'computed facts traverse the same relation worker');
  const change=await command('muda essa força pra 12 km');assert.equal(change.command_type,'load');
  await wait('NorteMeetingRoom.snapshot().meeting_events.length===4');await drained();
  run=await snapshot();assert.equal(run.beam_lab.state.loads[0].value,12000);assert.equal(run.beam_lab.versions.length,4);assert.equal(run.beam_lab.versions.at(-2).state.loads[0].value,10000);
  assert.match(run.meeting_events.at(-1).text,/momento fletor máximo absoluto 72 kN/);
  assert.equal(run.records.length,4);assert.equal(run.meeting_threads.length,1);
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  assert.ok(run.transcript.some(t=>t.text==='muda essa força pra 12 km'),'the original ASR wording is retained');
  assert.ok(change.normalizations.length,'dimensional ASR correction is auditable');
  await screenshot('desktop');
  const recordsBeforeView=run.records.length;
  await command('Norte, compare o esforço cortante antes e depois');
  assert.equal(await visible('.bw-pane[data-pane="graphs"]'),true);
  assert.equal(await evaluate('document.querySelector("#beamTab-graphs").getAttribute("aria-selected")'),'true');
  assert.equal((await snapshot()).beam_lab.baselineId,run.beam_lab.versions.at(-2).id);
  assert.ok(await evaluate('document.querySelectorAll(".bw-baseline-path").length>0 && document.querySelectorAll(".bw-current-path").length>0'));
  await click('[data-plot="all"]');assert.equal(await evaluate('document.querySelectorAll(".bw-chart").length'),3);
  assert.ok(await evaluate('document.querySelector("[data-chart=deflection] .bw-current-path").getAttribute("d").length>100'));
  assert.equal((await snapshot()).records.length,recordsBeforeView,'graph commands never become invented memory facts');
  assert.ok(await evaluate('[...document.querySelectorAll(".bw-chart svg")].every(svg=>svg.getBoundingClientRect().height>200)'),'engineering plots have readable dimensions in the shared platform CSS');
  assert.equal(await visible('#roomTranscriptPanel'),false,'transcription is hidden by default');
  await screenshot('graphs');await click('#roomTranscriptToggle');assert.equal(await visible('#roomTranscriptPanel'),true);await click('#roomTranscriptToggle');
  assert.equal(await visible('#beamTab-results'),true);assert.equal(await visible('#beamTab-calculations'),true);
  await command('quero ver os resultados');assert.equal(await visible('.bw-pane[data-pane="results"]'),true);
  assert.match(await evaluate('document.querySelector(".bw-pane[data-pane=results]").textContent'),/72/);
  await command('mostra os cálculos');assert.equal(await visible('.bw-pane[data-pane="calculations"]'),true);
  await command('volta para o canvas');assert.equal(await visible('#roomCanvas'),true);assert.equal(await visible('#beamRoomHost'),false);
  await wait('document.querySelectorAll("#roomBoard .room-node").length===4');
  await click('#roomLive');await wait('!!window.__speech');assert.equal((await snapshot()).input_mode,'live');
  assert.equal(await evaluate('document.querySelector("#roomFinish").parentElement===document.querySelector("#roomLive").parentElement'),true,'finish sits beside the microphone');
  await evaluate('__speech.emit("Norte, mude o comprimento para 4 metros",true)');
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===4 && NorteMeetingRoom.snapshot().meeting_events.length===6');await drained();
  run=await snapshot();assert.equal(run.beam_lab.state.loads[0].x,4);assert.match(run.meeting_events.at(-1).text,/momento fletor máximo absoluto 48 kN/);
  await evaluate('__speech.emit("muda a altura da seção para 25 centímetros",true)');
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.section.h===.25 && NorteMeetingRoom.snapshot().meeting_events.length===8');await drained();
  assert.equal(await visible('.bw-section-3d'),true);assert.equal(await visible('.bw-drawing'),false);
  assert.equal(await evaluate('document.querySelector(".bw-section-solid").dataset.height'),'0.25');
  await screenshot('section');
  await evaluate('__speech.emit("volta para os gráficos",true)');await wait('NorteMeetingRoom.snapshot().beam_view==="graphs"');
  await evaluate('__speech.emit("volta para a simulação",true)');await wait('NorteMeetingRoom.snapshot().beam_view==="simulation"');
  assert.equal(await visible('.bw-drawing'),true);assert.equal(await visible('.bw-section-3d'),false);
  run=await snapshot();
  const versionCount=run.beam_lab.versions.length;
  await evaluate('__speech.emit("Talvez aumentar a altura da seção reduza a deformação.",true)');
  await wait('NorteMeetingRoom.snapshot().meeting_events.length===9');await drained();
  assert.equal((await snapshot()).meeting_events.at(-1).type,'hypothesis');assert.equal((await snapshot()).beam_lab.versions.length,versionCount,'ordinary discussion never edits the structural model');
  await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done" && !NorteMeetingRoom.isRunning()');
  const completed=await snapshot();assert.equal(await evaluate('__speech.stopped'),true);assert.equal(await evaluate('document.querySelector("#roomMinutes").disabled'),false);
  assert.equal(completed.beam_lab.state.L,4);assert.equal(completed.beam_lab.state.loads[0].value,12000);assert.equal(completed.records.length,9);
  await click('#roomMinutes');await wait('document.querySelector("#gmDialog")?.open');
  assert.match(await evaluate('document.querySelector("#gmDialog").textContent'),/SIM-V|momento fletor/);
  assert.equal(requests.filter(r=>r.url==='/api/minutes').length,0,'finished meeting opens local canonical minutes without an organization request');
  await screenshot('minutes');await evaluate('document.querySelector("#gmDialog").close()');
  await evaluate('NorteMeetingRoom.flushStorage()');const requestsBeforeReload=requests.length;
  await evaluate('window.__beforeReload=true');await call('Page.reload');
  await wait('!window.__beforeReload && window.NorteMeetingRoom?.ready() && document.body.dataset.page==="beam" && NorteMeetingRoom.view()==="library"');
  await wait('!!document.querySelector(".room-open-meeting")');
  await click('.room-open-meeting');await wait('NorteMeetingRoom.snapshot()?.id==='+JSON.stringify(completed.id)+' && NorteMeetingRoom.view()==="room"');
  const restored=await snapshot();assert.equal(restored.beam_lab.state.L,4);assert.deepEqual(restored.beam_lab.versions,completed.beam_lab.versions);assert.equal(restored.beam_commands.length,completed.beam_commands.length);assert.equal(restored.records.length,9);assert.deepEqual(restored.beam_open_tabs,completed.beam_open_tabs);assert.equal(requests.length,requestsBeforeReload,'restore does not replay inference or simulation commands');
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0,'restore does not activate microphone');
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');
  await click('#meetingMode');await wait('document.body.dataset.page==="meeting" && NorteMeetingRoom.view()==="library"');
  assert.equal(await evaluate('document.querySelectorAll("#roomLibraryList .room-open-meeting").length'),0,'original meeting page has a separate library');
  const normal=await createInstant();assert.equal(normal.room_kind,'meeting');assert.equal(await visible('#beamCommandForm'),false);assert.equal(await visible('#beamRoomTabs'),false);
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library" && !NorteMeetingRoom.isRunning()');await click('#beamMode');await wait('document.body.dataset.page==="beam" && NorteMeetingRoom.view()==="library"');
  assert.equal(await evaluate('document.querySelectorAll("#roomLibraryList .room-open-meeting").length'),1);assert.equal(requests.length,requestsBeforeReload);
  // An explicit manual record uses the same atomic fact queue and preserves provenance.
  const manualDraft=await createInstant();await wait('NorteMeetingRoom.snapshot()?.beam_lab');
  await evaluate('document.querySelector("#roomText").value="Talvez reduzir o comprimento diminua a deformação.";document.querySelector("#roomTextForm").requestSubmit()');
  await wait('NorteMeetingRoom.snapshot().meeting_events.length===1');await drained();
  await wait('!!document.querySelector("#beamSimulationSuggestion")?.getClientRects().length');
  assert.equal(await visible('#beamTab-simulation'),true,'discussion suggests a simulation and keeps its tab visible');
  const callsBeforeManual=requests.length;
  await click('#beamSimulationSuggestion .compact-button');await click('.bw-drawing [data-object="beam"]');await edit('[data-field="beam.L"]',5);
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===5');
  assert.equal((await snapshot()).status,'running');assert.equal(requests.length,callsBeforeManual);
  await click('[data-action="close-editor"]');await click('[data-action="options"]');await click('[data-action="record"]');await wait('NorteMeetingRoom.snapshot().meeting_events.length===3');await drained();
  const manuallyRecorded=await snapshot(),manualVersion=manuallyRecorded.beam_lab.currentId;
  assert.equal(manuallyRecorded.id,manualDraft.id);assert.equal(manuallyRecorded.status,'running');assert.equal(manuallyRecorded.input_mode,'text');assert.equal(manuallyRecorded.beam_view,'simulation');
  assert.equal(manuallyRecorded.beam_commands?.length||0,0);assert.equal(manuallyRecorded.transcript.length,3);assert.deepEqual(manuallyRecorded.beam_recorded,[manualVersion]);
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  for(const [index,fact] of manuallyRecorded.transcript.filter(t=>t.source==='simulation').entries()){
   assert.equal(fact.source,'simulation');assert.equal(fact.speaker,'Simulação');assert.equal(fact.simulation.version_id,manualVersion);assert.equal(fact.simulation.command_id,'manual');
   assert.deepEqual(fact.simulation.state,manuallyRecorded.beam_lab.state);assert.equal(fact.simulation.kind,index===0?'test_proposal':'test_result');assert.ok(fact.simulation.computed_at);
  }
  assert.match(manuallyRecorded.meeting_events[2].text,/momento fletor máximo absoluto 50 kN/);
  const callsBeforeDuplicate=requests.length;
  await click('[data-action="options"]');await click('[data-action="record"]');await wait('document.querySelector(".bw-notice").textContent.includes("ainda não foi registrado")');
  assert.equal((await snapshot()).transcript.length,3);assert.equal(requests.length,callsBeforeDuplicate,'recording an existing version never duplicates facts');
  await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done" && !NorteMeetingRoom.isRunning()');
  await click('.bw-drawing [data-object="beam"]');await edit('[data-field="beam.L"]',4);await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===4');await click('[data-action="close-editor"]');
  const closedBefore=await snapshot(),closedCalls=requests.length;
  await click('[data-action="options"]');await click('[data-action="record"]');await wait('document.querySelector(".bw-notice").textContent.includes("ainda não foi registrado")');
  assert.equal((await snapshot()).transcript.length,3);assert.equal(requests.length,closedCalls);assert.deepEqual((await snapshot()).beam_recorded,[manualVersion]);
  assert.equal((await snapshot()).status,'done');assert.deepEqual((await snapshot()).beam_lab.state,closedBefore.beam_lab.state);
  assert.equal(await evaluate('document.querySelector(".bw-notice").textContent.includes("Resultado enviado")'),false,'closed meetings never report a false successful record');
  await evaluate('NorteMeetingRoom.flushStorage()');
  assert.deepEqual(errors,[]);
  console.log('PASS: beam route and isolated library, draft/manual changes without inference or microphone, text+voice commands, unchanged default SI calculations, version comparison and deflection plots, canonical simulation facts and relations, ordinary conversation, same-session local minutes, persist/restore without replay, original meeting page preserved.');
 }finally{
  socket?.close();
  await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
