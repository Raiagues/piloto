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
     const utterance=body.state.current_utterance||'',retainedSpeech=/problema no teste anterior|então o que eu pensei/.test(utterance),filler=/^e a gente tem que resolver/.test(utterance);
     if(q.type==='noul')return [id,{type:'noul',noul:retainedSpeech?.65:filler||/^Oi gente/.test(utterance)?.02:.98}];
     const current=body.state.current_event,target=body.state.candidates?.find(item=>item.event_id===id.split('__')[1]),ops=body.state.deterministic_candidate?.operations||[];let choice;
     if(id==='beam_action')choice=ops.length>1?'compound':/load$/.test(ops[0]?.type)?'load':/support$/.test(ops[0]?.type)?'support':['show_results','show_calculations','show_canvas','show_section'].includes(ops[0]?.type)?'show_inspection':ops[0]?.type||'other_command';
     else if(id==='action_mode'){const modes=[...new Set(ops.map(op=>op.type.startsWith('add_')?'add':op.type.startsWith('update_')?'update':op.type.startsWith('remove_')?'remove':op.type.startsWith('change_')?'change':'view'))];choice=modes.length>1?'mixed':modes[0]||'not_applicable';}
     else if(id==='candidate_fit')choice=body.state.deterministic_candidate.issues.length?'incomplete':'exact';
     else if(id==='command_type')choice='conversation';
     else if(id==='speech_status')choice=/(?:^|\s)(?:de|para|que|foi|era)$/.test(body.state.current_utterance||'')?'unfinished':'finished';
     else if(id==='speech_join')choice='separate';
     else if(id==='command_completion')choice=/\d/.test(body.state.next_utterance||'')?'completes':'separate';
     else if(id==='event_type')choice=/^Teste de simulação|^hoje a gente/.test(utterance)?'test_proposal':/^Resultado calculado|^A simulação.*não produziu/.test(utterance)?'test_result':/^Talvez|^então vamos começar|^então o que eu pensei/.test(utterance)?'hypothesis':'observation';
     else if(id==='belongs_to_active_thread'||id.startsWith('belongs_to_archive_thread__'))choice='belongs';
     else if(id.startsWith('relation_type__'))choice=current?.type==='test_result'&&target?.type==='test_proposal'&&simId(current.text)===simId(target.text)?'result_of':'none';
     else if(id.startsWith('configuration_match__'))choice=body.state.relation_type==='result_of'?'exact':'not_applicable';
     const keys=Object.keys(q.criteria);assert.ok(keys.includes(choice),'Unmocked '+id+': '+choice);
     const probability=id==='event_type'&&retainedSpeech?.65:.98;
     return [id,{type:'choice',choice,confidence:.12,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?probability:(1-probability)/(keys.length-1)]))}];
    }));
    await sleep(8);return json({request:body,response:{model:'browser-fixture',answers},provider:'official',latencyMs:8});
   }
   const name=pathname.slice(1)||'index.html';if(!assets.has(name))return res.writeHead(404).end();
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'font/ttf','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  }catch(error){errors.push(error.stack);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-beam-speech-browser-'));
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
  const screenshot=async name=>{await call('Page.bringToFront');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-beam-speech-'+name+'.png',Buffer.from(shot.data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
   class FixtureRecognition {
    constructor(){window.__speech=this;(window.__speechInstances||=[]).push(this);this.results=[];this.stopped=false;this.stopCalls=0;}
    start(){this.stopped=false;this.startedAt=performance.now();queueMicrotask(()=>{this.onstart?.();this.onspeechstart?.();});}
    emit(text,isFinal,index=this.results.length){const result=[{transcript:text,confidence:.99}];result.isFinal=isFinal;this.results[index]=result;this.onresult?.({results:this.results,resultIndex:index});}
    stop(){this.stopCalls++;this.stopped=true;this.stoppedAt=performance.now();setTimeout(()=>{if(this.finalOnStop)this.emit(this.finalOnStop,true,this.results.length-1);this.onend?.();},250);}
    abort(){this.stopped=true;queueMicrotask(()=>this.onend?.());}
   }
   window.SpeechRecognition=FixtureRecognition;window.webkitSpeechRecognition=FixtureRecognition;
  `});
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  const origin='http://127.0.0.1:'+server.address().port;

  const rawSpeech='Oi gente vamos começar a reunião então tá a gente vai começar a discutir primeiro a parte de do tamanho da viga ela deu problema no teste anterior e a gente tem que resolver isso tá como que a gente vai fazer então o que eu pensei era da gente pegar e conseguir diminuir o tamanho dela';
  const rawCommand='tá então o Norte vamos simular um teste uma discussão vamos simular uma viga';
  const expected=[
   'Oi gente vamos começar a reunião então tá a gente vai começar a discutir primeiro a parte de',
   'do tamanho da viga ela deu problema no teste anterior',
   'e a gente tem que resolver isso tá como que a gente vai fazer',
   'então o que eu pensei era da gente pegar e conseguir diminuir o tamanho dela'
  ];
  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const drained=()=>wait('(()=>{const r=NorteMeetingRoom.snapshot();return r.records.length>0&&r.transcript.every(x=>["done","command","error"].includes(x.status))&&r.records.every(x=>x.status==="done")&&r.thread_worker.jobs.every(x=>x.status==="done")&&r.typed_relation_worker.jobs.every(x=>["done","skipped"].includes(x.status));})()');
  await call('Page.navigate',{url:origin+'/index.html#simulacao'});
  await wait('window.NorteMeetingRoom?.ready() && NorteClassifier.isAvailable() && document.body.dataset.page==="beam"');
  await click('#roomNew');await wait('!document.querySelector("#roomCreateMenu").hidden');await click('#roomCreateInstant');
  await wait('NorteMeetingRoom.snapshot()?.status==="draft" && !!window.NorteMeetingBeam');
  assert.equal(requests.length,0);assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#beamRoomTabs button")].filter(b=>!b.hidden).map(b=>b.textContent)'),['Canvas']);
  assert.equal(await visible('#beamSimulationSuggestion'),false);assert.equal(await evaluate('!!document.querySelector("#beamRoomHint")'),false);
  assert.equal(await visible('#roomTranscriptPanel'),false,'transcription is hidden by default');await click('#roomTranscriptToggle');
  assert.equal(await evaluate('document.querySelector("#roomTranscriptDivider").getAttribute("aria-valuenow")'),'78','new beam room reserves roughly 22% for transcription');
  const ratio=await evaluate('document.querySelector("#roomTranscriptPanel").getBoundingClientRect().height/document.querySelector("#roomWorkspace").getBoundingClientRect().height');
  assert.ok(ratio>.15&&ratio<.26,'compact default transcript proportion '+ratio);
  await click('#roomLive');await wait('!!window.__speech');
  assert.equal(await visible('#roomFinish'),true);assert.equal(await evaluate('document.querySelector("#roomFinish").parentElement===document.querySelector("#roomLive").parentElement'),true);
  assert.equal(await visible('#roomSessionBar'),false);assert.equal(await visible('#roomSave'),false);
  await evaluate(`__speech.emit(${JSON.stringify(rawSpeech)},false,0);__speech.finalOnStop=${JSON.stringify(rawSpeech)}`);
  await wait('document.querySelector("#roomInterim").textContent.length>0');
  assert.equal((await snapshot()).transcript.length,0,'recognition hypotheses never create premature memory');
  assert.ok((await evaluate('document.querySelector("#roomInterim").textContent')).split(/\s+/).length<=18,'interim preview is bounded while the complete source remains in the ledger');
  await wait('__speechInstances.length===2');
  const firstStop=await evaluate('({duration:__speechInstances[0].stoppedAt-__speechInstances[0].startedAt,stops:__speechInstances[0].stopCalls})');
  assert.ok(firstStop.duration>=14900&&firstStop.duration<15600,'unconfirmed native speech is finalized after fifteen seconds, not on a fixed five-second clock: '+firstStop.duration);assert.equal(firstStop.stops,1);
  await wait('NorteMeetingRoom.snapshot().records.length===3');await drained();
  await wait('document.querySelectorAll("#roomTranscript .room-speech").length===4');
  let run=await snapshot();assert.deepEqual(run.transcript.map(e=>e.text),expected);
  assert.equal(run.transcript[0].sourceText,rawSpeech);assert.equal(run.speech_ledger.records[0].text,rawSpeech);assert.equal(run.speech_ledger.records[0].status,'final');
  assert.equal(new Set(run.transcript.map(e=>e.segmentId)).size,1);assert.ok(run.transcript.every(e=>e.source==='microphone'&&e.speaker==='Você'&&e.sourceId==='run-1:0'));
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#roomTranscript .room-speech-text")].map(n=>n.textContent)'),expected,'four independent ideas remain four readable transcript rows');
  assert.equal(run.meeting_events.length,2,'fixture retains the problem after the greeting and the hypothesis, while excluding filler');
  assert.equal(run.batch.cases[0].current_utterance,expected.slice(0,2).join(' '),'the unfinished first clause reaches classification together with its literal continuation');
  assert.deepEqual(run.batch.cases[0].source_entry_ids,run.transcript.slice(0,2).map(t=>t.id));
  assert.equal(run.transcript[0].chunk_id,run.transcript[1].chunk_id,'each short transcript row still points to the joint classification');
  assert.ok(run.transcript.every(t=>t.text.split(/\s+/).length<=18),'displayed transcript retains the short capture slices');
  assert.equal(run.records[1].storeOutput.request.state.speech_context.preceding_words,expected.slice(0,2).join(' '));
  await wait('document.querySelectorAll("#roomBoard .room-node").length===2');
  assert.ok(run.records.filter(r=>r.result.store).every(r=>r.result.typeProbability===.65),'the canvas keeps useful classifications below the old 80% gate');
  assert.equal(await visible('#beamSimulationSuggestion'),true);assert.match(await evaluate('document.querySelector("#beamSimulationSuggestion").textContent'),/testar o comprimento.*por exemplo/);assert.equal(await visible('#beamTab-simulation'),false,'a test suggestion does not reveal simulation until requested');
  assert.equal(run.beam_lab.state.section.b,.12);assert.equal(run.beam_lab.state.section.h,.24,'an unspecified 20→25cm discussion never changes a structural dimension');
  await evaluate('document.querySelector(".room-transcript-scroll").scrollTop=0');await screenshot('exact-asr');
  // A final result arriving during stop must pass through the same segmenter once.
  await evaluate(`__speech.emit(${JSON.stringify(rawCommand)},false,0);__speech.finalOnStop=${JSON.stringify(rawCommand)}`);
  const pause=await evaluate('(()=>{const b=document.querySelector("#roomLive");b.click();b.click();return {disabled:b.disabled,instances:__speechInstances.length,stops:__speech.stopCalls};})()');
  assert.equal(pause.disabled,true);assert.equal(pause.instances,2);assert.equal(pause.stops,1);
  await wait('NorteMeetingRoom.snapshot().beam_commands?.[0]?.memory_enqueued===true && !document.querySelector("#roomLive").disabled');await drained();
  run=await snapshot();assert.equal(run.beam_commands.length,1);assert.equal(run.beam_commands[0].status,'applied');assert.equal(run.beam_commands[0].text,rawCommand);
  assert.equal(run.transcript.filter(e=>e.text===rawCommand).length,1);assert.equal(run.transcript.filter(e=>e.source==='simulation').length,2);assert.equal(run.transcript.length,7);
  assert.equal(run.transcript.find(e=>e.text===rawCommand).sourceText,rawCommand);assert.equal(run.speech_ledger.records[1].text,rawCommand);
  assert.equal(await evaluate('document.querySelector("#roomLiveLabel").textContent'),'Retomar gravação');assert.equal(await visible('#roomStatus'),false);
  assert.equal(await evaluate('document.querySelector("#roomFinish").disabled'),false);
  await wait('document.querySelectorAll("#roomTranscript .room-speech").length===5');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("#roomTranscript .room-speech-text")].map(n=>n.textContent)'),[...expected,rawCommand]);
  assert.equal(await evaluate('/Resultado calculado|Teste de simulação|Comando aplicado|Exemplos por voz/.test(document.querySelector("#roomTranscript").innerText)'),false,'only actual speech appears, while computed facts remain in memory');
  assert.equal(run.meeting_events.length,4);assert.ok(run.meeting_events.some(e=>e.text.startsWith('Resultado calculado da simulação')));
  assert.equal(await visible('#beamTab-simulation'),true);assert.equal(await visible('#beamSimulationSuggestion'),false);
  await click('#beamTab-canvas');await wait('!!document.querySelector("#roomCanvas").getClientRects().length');
  await evaluate('document.querySelector("#roomTranscriptDivider").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))');
  assert.equal(await evaluate('document.querySelector("#roomTranscriptDivider").getAttribute("aria-valuenow")'),'73','resize remains available after compact defaults');
  await evaluate('document.querySelector(".room-transcript-scroll").scrollTop=0');await screenshot('final-command');
  await click('#roomTranscriptToggle');assert.equal(await visible('#roomTranscriptPanel'),false);await click('#roomTranscriptToggle');assert.equal(await visible('#roomTranscriptPanel'),true);
  // A command split by a pause waits for its value and runs once, complete:
  // no fabricated kN, no premature ambiguous attempt, no duplicated source text.
  await click('#roomLive');await wait('__speechInstances.length===3');
  await evaluate(`__speech.emit('Norte, mude a força P1 para',false,0);__speech.emit('Norte, mude a força P1 para',true,0)`);
  await sleep(400);assert.equal((await snapshot()).beam_commands.length,1,'the unfinished instruction waits for its value');
  await evaluate(`__speech.emit('12 kN',false,1);__speech.finalOnStop='12 kN'`);await click('#roomLive');
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.loads[0].value===12000 && !document.querySelector("#roomLive").disabled');await drained();
  run=await snapshot();assert.equal(run.beam_commands.length,2);assert.equal(run.beam_commands[1].status,'applied');assert.equal(run.beam_commands[1].text,'Norte, mude a força P1 para 12 kN');
  assert.deepEqual(run.speech_ledger.records.map(r=>r.text),[rawSpeech,rawCommand,'Norte, mude a força P1 para','12 kN']);assert.equal(run.transcript.filter(e=>e.text==='12 kN').length,1);
  await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done" && !NorteMeetingRoom.isRunning()');
  assert.equal((await snapshot()).transcript.length,11);assert.equal(await evaluate('__speechInstances.length'),3,'no restarts besides the forced finalization and the two pauses');assert.equal(await evaluate('__speechInstances.every(instance=>instance.stopCalls===1)'),true);
  await evaluate('NorteMeetingRoom.flushStorage()');
  assert.deepEqual(errors,[]);
  assert.equal(await evaluate('NorteMeetingSession.restore(NorteMeetingRoom.snapshot()).transcript.length'),11,'continuation requests restore with their verified original context');
  console.log('PASS: continuous native capture with a fifteen-second limit for unconfirmed speech, short literal transcript rows with bounded unfinished-clause continuation, 65% facts retained, contextual top hint and on-demand simulation tab, source/timing preserved, a command split at a pause runs once with its value, delayed final on pause retained and memory restore.');
 }finally{
  socket?.close();
  await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
