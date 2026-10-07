// Browser fixtures validate simulator/meeting integration, not classifier accuracy.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
 const root=path.resolve(__dirname,'..'),requests=[],errors=[],liveCalls=[];
 const liveCommands=process.argv.includes('--live-commands');
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
    if(liveCommands&&body.questions.beam_action){
     assert.ok(liveCalls.length<20,'explicit live call budget exceeded');
     const row={request:body,started_at:new Date().toISOString()};liveCalls.push(row);
     const upstream=await fetch('http://127.0.0.1:8000/api/classify',{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':'official'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
     row.status=upstream.status;row.output=await upstream.json();assert.equal(upstream.ok,true,row.output.error||'classification proxy failed');
     return json(row.output);
    }
    const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
     const utterance=body.state.current_utterance||'',retainedSpeech=/problema no teste anterior|então o que eu pensei/.test(utterance),filler=/^e a gente tem que resolver/.test(utterance);
     if(q.type==='noul')return [id,{type:'noul',noul:retainedSpeech?.65:filler||/^Oi gente/.test(utterance)?.02:.98}];
     const current=body.state.current_event,target=body.state.candidates?.find(item=>item.event_id===id.split('__')[1]),ops=body.state.deterministic_candidate?.operations||[];let choice;
     if(id==='beam_action')choice=ops.length>1?'compound':/load$/.test(ops[0]?.type)?'load':/support$/.test(ops[0]?.type)?'support':['show_results','show_calculations','show_canvas','show_section'].includes(ops[0]?.type)?'show_inspection':ops[0]?.type||'other_command';
     else if(id==='action_mode'){const modes=[...new Set(ops.map(op=>op.type.startsWith('add_')?'add':op.type.startsWith('update_')?'update':op.type.startsWith('remove_')?'remove':op.type.startsWith('change_')?'change':'view'))];choice=modes.length>1?'mixed':modes[0]||'not_applicable';}
     else if(id==='candidate_fit')choice=body.state.deterministic_candidate.issues.length?'incomplete':'exact';
     else if(id==='command_type')choice='conversation';
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
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-beam-spoken-edits-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let socket,chromeError='';chrome.stderr.on('data',data=>chromeError=(chromeError+data).slice(-2000));
 try{
  let port;for(let i=0;i<600;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json());socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Page.javascriptDialogOpening'&&message.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>errors.push(error.message));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let i=0;i<(liveCommands?2200:500);i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}const state=await evaluate('(()=>{const r=window.NorteMeetingRoom?.snapshot();return r&&{status:r.status,error:r.error,commands:r.beam_commands?.map(c=>({text:c.text,status:c.status,message:c.message,interpreted:c.interpreted_text})),state:r.beam_lab?.state,records:r.records.map(x=>({id:x.id,status:x.status,error:x.error})),threads:r.thread_worker&&{status:r.thread_worker.status,jobs:r.thread_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))},relations:r.typed_relation_worker&&{status:r.typed_relation_worker.status,error:r.typed_relation_worker.error,jobs:r.typed_relation_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))}};})()');throw Error('Timed out: '+expression+' '+JSON.stringify(errors)+' '+JSON.stringify(state));};
  const click=selector=>evaluate(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});if(typeof target.click==='function')target.click();else target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  const snapshot=()=>evaluate('NorteMeetingRoom.snapshot()');
  const screenshot=async name=>{await call('Page.bringToFront');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-beam-spoken-edits-'+name+'.png',Buffer.from(shot.data,'base64'));};
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


  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const settled=()=>wait('(()=>{const r=NorteMeetingRoom.snapshot();return r.transcript.every(x=>["done","command"].includes(x.status))&&r.records.every(x=>x.status==="done")&&r.thread_worker.jobs.every(x=>x.status==="done")&&r.typed_relation_worker.jobs.every(x=>["done","skipped"].includes(x.status));})()');
  // Keep actual CaptureWindow timers. Only microphone event timestamps advance,
  // so this models the source offsets without waiting 90 wall-clock seconds.
  const say=async(text,at,isFinal=true,index=null)=>evaluate(`(()=>{const clock=Date.now,base=Date.parse(NorteMeetingRoom.snapshot().startedAt);try{Date.now=()=>base+${at};__speech.onspeechstart?.();const index=${index===null?'__speech.results.length':index};__speech.emit(${JSON.stringify(text)},false,index);Date.now=()=>base+${at+4000};if(${isFinal})__speech.emit(${JSON.stringify(text)},true,index);return {index,recognition:__speechInstances.length};}finally{Date.now=clock;}})()`);
  await call('Page.navigate',{url:origin+'/index.html#simulacao'});
  await wait('window.NorteMeetingRoom?.ready() && NorteClassifier.isAvailable() && document.body.dataset.page==="beam"');
  await click('#roomNew');await wait('!document.querySelector("#roomCreateMenu").hidden');await click('#roomCreateInstant');
  await wait('NorteMeetingRoom.snapshot()?.status==="draft" && !!window.NorteMeetingBeam');
  assert.equal(await visible('#beamTab-simulation'),false,'simulation stays on demand');
  await click('#roomLive');await wait('!!window.__speech');
  await say('Norte vamos simular uma viga',57000);
  await wait('NorteMeetingRoom.snapshot().beam_commands?.some(c=>c.status==="applied"&&c.operations.some(o=>o.type==="open_simulation"))');await settled();
  let run=await snapshot();assert.equal(run.beam_lab.state.L,6);assert.equal(run.beam_lab.versions.length,1);assert.equal(await visible('#beamTab-simulation'),true);
  assert.ok(run.transcript.some(t=>t.source==='simulation'),'calculated facts enter the normal meeting pipeline between speech');

  await say('beleza eu quero reduzir de',63000);
  await sleep(100);run=await snapshot();assert.equal(run.beam_lab.state.L,6);assert.equal(run.beam_lab.versions.length,1,'the incomplete preposition is not executed');
  await say('para 5 metros',68000);
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.L===5');await settled();
  run=await snapshot();assert.equal(run.beam_lab.state.loads[0].x,5,'tip force follows the resized beam');assert.equal(run.beam_lab.versions.length,2);
  assert.match(await evaluate('document.querySelector(".bw-drawing").textContent'),/L = 5 m/);
  assert.equal(await evaluate('document.querySelector("#roomNotice").hidden'),true,'successful continuation clears old ambiguity notices');

  await say('eu quero reduzir o tamanho da viga de 5 m para',73000);
  // No target value is present. A late recognizer fragment must not cause a
  // physical mutation, nor reorder the displayed conversation when confirmed.
  const late=await say('me',78000,false);
  await sleep(150);run=await snapshot();assert.equal(run.beam_lab.state.L,5);assert.equal(run.beam_lab.versions.length,2);
  await say('eu quero reduzir a força P1 de 10 Kg',83000);
  await sleep(150);run=await snapshot();assert.equal(run.beam_lab.state.loads[0].value,10000);assert.equal(run.beam_lab.versions.length,2,'the source value (10 Kg) is not used as the new load');
  await say('é 5 Kilo newtons',88000);
  // Final for the earlier index arrives after the newer command; real browsers
  // can confirm indices out of order. No fresh command should be synthesized.
  await evaluate(`(()=>{const recognition=__speechInstances[${late.recognition-1}],clock=Date.now;try{Date.now=()=>Date.parse(NorteMeetingRoom.snapshot().startedAt)+94000;recognition.emit('me',true,${late.index});}finally{Date.now=clock;}})()`);
  await wait('NorteMeetingRoom.snapshot().beam_lab.state.loads[0].value===5000');
  await click('#roomLive');await wait('!document.querySelector("#roomLive").disabled');await settled();
  run=await snapshot();assert.equal(run.beam_lab.state.L,5);assert.equal(run.beam_lab.state.loads[0].value,5000);assert.equal(run.beam_lab.state.loads[0].x,5);assert.equal(run.beam_lab.versions.length,3,'only complete, distinct physical changes make new versions');
  const lastChange=run.beam_commands.filter(c=>c.status==='applied'&&c.operations.some(o=>o.type==='update_load')).at(-1);assert.ok(lastChange);assert.equal(lastChange.operations.find(o=>o.type==='update_load').patch.value,5000);
  const drawing=await evaluate('document.querySelector(".bw-drawing").textContent');assert.match(drawing,/L = 5 m/);assert.match(drawing,/P1 = 5 kN/);
  const calc=await evaluate('(()=>{const s=NorteMeetingRoom.snapshot().beam_lab.state,r=NorteBeamEngine.calculate(s),v=NorteBeamEngine.structuralResults(s,r);return {valid:r.valid,V:v.d.Vmax,M:v.d.Mmax,reactions:r.reactions};})()');
  assert.equal(calc.valid,true);assert.equal(calc.V,5000);assert.equal(calc.M,25000);assert.equal(Math.abs(calc.reactions[0].M),25000);
  assert.ok(run.transcript.some(t=>t.source==='simulation'&&/momento fletor máximo absoluto 25 kN/.test(t.text)),'new computations feed the meeting memory');
  assert.equal(await evaluate('document.querySelector("#roomNotice").hidden||!document.querySelector("#roomNotice").textContent'),true,'no stale unclear-target banner after successful force update');
  const rows=await evaluate('[...document.querySelectorAll("#roomTranscript .room-speech")].map(e=>({text:e.querySelector(".room-speech-text").textContent,time:e.querySelector("time").textContent}))');
  assert.deepEqual(rows.map(r=>r.text),['Norte vamos simular uma viga','beleza eu quero reduzir de','para 5 metros','eu quero reduzir o tamanho da viga de 5 m para','me','eu quero reduzir a força P1 de 10 Kg','é 5 Kilo newtons']);
  assert.deepEqual(rows.map(r=>r.time),['00:00:57','00:01:03','00:01:08','00:01:13','00:01:18','00:01:23','00:01:28']);
  assert.equal(run.transcript.filter(t=>t.source==='microphone').length,7,'every literal capture is preserved once');
  assert.equal(run.speech_ledger.records.filter(r=>r.status==='final').length,7);
  assert.equal(await visible('#beamTab-graphs'),false);assert.equal(await visible('#beamTab-results'),false);assert.equal(await visible('#beamTab-calculations'),false);
  for(const {body} of requests.filter(item=>item.body?.questions.beam_action))assert.ok(body.state.conversation_context.recent_utterances.every(text=>!/^Teste de simulação|^Resultado calculado da simulação/.test(text)),'computed facts must not replace the prior human utterance');
  await screenshot('complete');
  await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done" && !NorteMeetingRoom.isRunning()');
  await evaluate('NorteMeetingRoom.flushStorage()');assert.deepEqual(errors,[]);
  console.log('PASS: actual microphone/session path, natural split request gives 5m, incomplete old-value request leaves model unchanged, 10Kg→5kN continuation gives 25kNm, exactly two edit versions, recomputed meeting facts, chronological late-final transcript and no stale warning.');
 }finally{
  if(liveCommands){const report=path.join(root,'.runtime/beam-spoken-edits-live.json');await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify({fixture:true,description:'Native microphone event and real room integration; command classification uses the actual API; computed-fact memory classification is stubbed.',api_calls:liveCalls.length,calls:liveCalls,errors},null,2));console.log('Live command calls: '+liveCalls.length+'; report '+report);}
  socket?.close();
  await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
