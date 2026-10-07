// Browser coverage for the separate V2 window; API replies below are fixtures, not AI validation.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
  const root=path.resolve(__dirname,'..'),requests=[],assetsRead=[],errors=[];
  const assets=new Set(['meeting-commands.js','meeting-session.js','meeting-evidence.js','meeting-state.js','meeting-review.js','meeting-hierarchy.js','meeting-amendments.js','meeting-document.js','gemini-minutes.js','gemini-minutes.css','meeting-room.js','meeting-room.css','meeting-canvas.js','meeting-canvas.css','index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','memory-storage.js','memory-v2.js','typed-relations.js','typed-relations-page.js','meeting-minutes.js','meeting-minutes.css','relation-map.js','relation-map.css','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json']);
  let failProfile=false, quota=null;
  const server=http.createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/api/classify'||req.url==='/api/relations'||req.url==='/api/typed-relations'){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
      assert.equal(JSON.stringify(body).includes('expected_'),false,'gabarito must not enter API requests');
      if(quota) {
        if(req.url==='/api/relations') {
          quota.secondaryCalls++;await quota.primaryReady;
          quota.failureSent=true;
          return res.writeHead(429,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Quota de teste esgotada'}));
        }
        quota.primaryCalls++;
        if(quota.failureSent)quota.newCallsAfterFailure++;
        if(quota.primaryCalls===5) {
          quota.markPrimaryReady();
          // Keep the already-started chunk request in flight until the browser
          // has observed the fatal thread error, avoiding timing assumptions.
          await quota.releasePrimary;
        }
      }
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
        if(q.type==='noul')return [id,{type:'noul',noul:.97}];
        const choice=id==='event_type'?'observation':id.startsWith('relation_type__')?'none':'belongs',keys=Object.keys(q.criteria);
        return [id,{type:'choice',choice,confidence:.2,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?.96:.04/(keys.length-1)]))}];
      }));
      await sleep(10);return json({request:body,response:{model:'ui-fixture',answers},provider:'official',latencyMs:10});
    }
    const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);assetsRead.push(name);
    if(!assets.has(name)||failProfile&&name==='memory-v2.js')return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-memory-v2-browser-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket,chromeError='';chrome.stderr.on('data',data=>{chromeError=(chromeError+data).slice(-2000);});
  try{
    let port;for(let i=0;i<600;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Page.javascriptDialogOpening'&&m.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(e=>errors.push(e.message));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<350;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}throw Error('Timed out: '+expression+' '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const snapshot=()=>evaluate('NorteMemoryPage.snapshot()');
    const flush=async()=>assert.equal(await evaluate('NorteMemoryPage.flushStorage()'),true,'the latest draft and memory checkpoint committed');
    const ready=()=>wait('window.NorteMemoryPage && NorteClassifier.isAvailable() && document.body.dataset.page==="memory"');
    const load=async batch=>{await click('#mfPaste');await evaluate(`document.querySelector('#mfBatchJSON').value=${JSON.stringify(JSON.stringify(batch))}`);await click('#mfLoad');await wait('!document.querySelector("#mfInputDialog").open');};
    const originalKeys=['memory-flow','meeting-memory','memory-library','memory-ui'].map(k=>'norte.'+k+'.v1');
    const originalStorage=()=>evaluate(`Object.fromEntries(${JSON.stringify(originalKeys)}.map(key=>[key,{local:localStorage.getItem(key),session:sessionStorage.getItem(key)}]))`);
    const makeBatch=(id,count)=>({batch_id:id,cases:Array.from({length:count},(_,i)=>({id:'S'+i,current_utterance:i===0?'The motor housing vibrates.':'The motor housing is steel.',expected_store_memory:true,expected_event_type:'observation'})),expected_threads:Object.fromEntries(Array.from({length:count},(_,i)=>['S'+i,{expected_action:i===0?'create_new_thread':'keep_active_thread',expected_thread_id:'T001'}]))});
    const base='http://127.0.0.1:'+server.address().port;
    await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:base+'/#memoria'});await ready();
    assert.equal(assetsRead.includes('memory-v2.js'),false,'legacy window does not load V2 defaults');
    assert.equal(assetsRead.includes('memory-storage.js'),false,'legacy window keeps its Web Storage persistence');
    assert.equal(assetsRead.includes('relation-map.js'),false,'legacy window does not load the V2 relation map');
    assert.equal(assetsRead.includes('relation-map.css'),false);
    assert.equal((await snapshot()).batch,null);
    assert.equal(await evaluate('document.querySelector("#memoryV2Mode").target'),'_blank');
    await load(makeBatch('UI-LEGACY',1));await click('#mfBurstToggle');await click('#mfRun');await wait('NorteMemoryPage.snapshot().run?.status==="done" && !NorteMemoryPage.isRunning()');await click('#mfSaveTest');await wait('document.querySelector("#mfSaveTest").textContent==="Salvo"');await flush();
    assert.equal((await snapshot()).run.thread_worker.schemaVersion,4);
    const legacy=await originalStorage(),before=requests.length;
    await call('Page.navigate',{url:base+'/?profile=memory-v2#memoria'});await ready();
    let state=await snapshot();assert.equal(state.profile,'memory-v2');assert.equal(state.batch.cases.length,43);assert.equal(state.run,null);
    assert.deepEqual(Object.keys(state.batch),['batch_id','cases','expected_threads'],'V2 default input keeps the original shape');
    assert.equal(assetsRead.includes('relation-map.js'),true);
    assert.equal(assetsRead.includes('memory-storage.js'),true,'V2 loads its IndexedDB persistence adapter');
    assert.equal(await evaluate('!!document.querySelector("#mfTypedExamples, #mfLoadExample")'),false,'example loader controls have been removed');
    assert.deepEqual(state.questionSet,await evaluate('NorteMemoryV2.questions'));
    assert.deepEqual(state.threadConfig,await evaluate('NorteMemoryV2.threadConfig'));
    assert.equal(state.library.tests.length,0);assert.equal(requests.length,before,'opening V2 does not call the API');
    assert.equal(await evaluate('document.querySelector(".manual-page-title h1").textContent'),'Fluxo de memória V2');
    assert.equal(await evaluate('document.querySelector("#memoryV2Mode").getAttribute("aria-current")'),'page');
    assert.equal(await evaluate('document.querySelector("#memoryMode").hasAttribute("aria-current")'),false);
    assert.deepEqual(await originalStorage(),legacy);
    await load(makeBatch('UI-V2',2));await click('#mfBurstToggle');await click('#mfRun');await wait('NorteMemoryPage.snapshot().run?.status==="done" && !NorteMemoryPage.isRunning()');
    state=await snapshot();assert.equal(state.run.thread_worker.schemaVersion,5);assert.equal(state.run.thread_worker.calls,1);assert.equal(state.meeting_events.length,2);assert.equal(state.meeting_threads.length,1);
    assert.equal(state.run.typed_relation_worker.status,'done');assert.equal(state.run.typed_relation_worker.schemaVersion,3);assert.equal(state.run.typed_relation_worker.input_closed,true);assert.equal(state.run.typed_relation_worker.calls,1);assert.equal(state.meeting_relations.length,0);
    assert.match(await evaluate('document.querySelector("#mfThreadContext").textContent'),/1 \u00b7 recent_context \u00b7 1 \/ 8 anteriores/);
    const threadRequest=requests.findLast(r=>r.questions.belongs_to_active_thread);assert.ok(threadRequest);assert.equal(JSON.stringify(threadRequest.state).includes('thread_assignment_state'),false);assert.equal(JSON.stringify(threadRequest.state).includes('"chunk":'),false);
    assert.ok(state.run.records.every(r=>r.result.correct));await click('#mfSaveTest');await wait('document.querySelector("#mfSaveTest").textContent==="Salvo"');await flush();
    assert.equal((await snapshot()).library.tests.length,1);assert.deepEqual(await originalStorage(),legacy,'V2 never overwrites legacy draft, results, history, or layout');
    const savedV2=await snapshot();
    assert.deepEqual(await evaluate('[localStorage.getItem("norte.memory-library.v2"),localStorage.getItem("norte.meeting-memory.v2"),sessionStorage.getItem("norte.memory-flow.v2")]'),[null,null,null],'large V2 records no longer consume Web Storage quota');
    const calls=requests.length;await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage');await ready();
    assert.equal((await snapshot()).run.thread_worker.schemaVersion,5);assert.equal((await snapshot()).batch.batch_id,'UI-V2');assert.equal(requests.length,calls,'reload never reruns AI calls');
    assert.deepEqual((await snapshot()).library,savedV2.library,'the whole versioned test library is recovered from IndexedDB');
    assert.deepEqual((await snapshot()).meeting_events,savedV2.meeting_events);
    assert.deepEqual((await snapshot()).meeting_threads,savedV2.meeting_threads);
    await click('#manualMode');await click('#memoryV2Mode');assert.equal(await evaluate('document.body.dataset.page'),'memory');assert.equal((await snapshot()).run.records.length,2);
    const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-memory-v2.png',Buffer.from(shot.data,'base64'));
    await click('#mfClear');assert.equal((await snapshot()).batch,null);await flush();await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage');await ready();assert.equal((await snapshot()).batch,null,'explicitly cleared draft stays empty after reload');
    const b002=JSON.parse(await fs.readFile(path.join(root,'B002.json'),'utf8'));
    assert.deepEqual(Object.keys(b002),['batch_id','cases','expected_threads']);
    await load(b002);assert.deepEqual((await snapshot()).batch,b002,'the root B002 document can be copied and pasted verbatim');assert.equal((await snapshot()).library.tests.length,1);
    assert.equal(assetsRead.some(name=>name.startsWith('tests/fixtures/')),false,'input loading never fetches fixture examples');
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.deepEqual(await originalStorage(),legacy);
    await load(makeBatch('UI-FATAL-THREAD-QUOTA',12));
    quota={primaryCalls:0,secondaryCalls:0,newCallsAfterFailure:0,failureSent:false};
    quota.primaryReady=new Promise(resolve=>quota.markPrimaryReady=resolve);
    quota.releasePrimary=new Promise(resolve=>quota.finishPrimary=resolve);
    await click('#mfRun');
    await wait('document.querySelector("#mfNotice").textContent.includes("Quota de teste esgotada")');
    assert.equal(await evaluate('NorteMemoryPage.isRunning()'),true,'existing primary request is allowed to settle');
    assert.equal(await evaluate('document.querySelector("#mfStop").disabled'),true,'fatal error already requested shared cancellation');
    assert.equal(quota.primaryCalls,5);quota.finishPrimary();
    await wait('!NorteMemoryPage.isRunning()');state=await snapshot();
    assert.equal(state.run.status,'stopped');assert.equal(state.run.thread_worker.status,'stopped');
    assert.equal(state.run.records.filter(r=>r.status==='done').length,2,'remaining chunk queue was not classified');
    assert.equal(state.run.records.find(r=>r.id==='S2').status,'interrupted','in-flight filter cannot initiate the next type call');
    assert.equal(quota.primaryCalls,5);assert.equal(quota.secondaryCalls,1);assert.equal(quota.newCallsAfterFailure,0);
    assert.match(state.run.thread_worker.jobs[1].parts[0].error,/Quota de teste esgotada/);
    const stoppedCalls=requests.length;await flush();await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage');await ready();
    state=await snapshot();assert.equal(state.run.status,'stopped');assert.equal(state.run.thread_worker.status,'stopped');assert.equal(requests.length,stoppedCalls,'fatal failures are never automatically retried on reload');
    assert.deepEqual(await originalStorage(),legacy);
    failProfile=true;await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && document.querySelector("#mfNotice")?.textContent.includes("Não foi possível carregar Memória V2")');assert.equal(await evaluate('!!window.NorteMemoryPage'),false);assert.equal(await evaluate('document.querySelector("#mfRun").disabled'),true);
    assert.deepEqual(errors,[]);console.log('PASS: V2 navigation, original input shape, copied root B002 without example buttons, IndexedDB save/reload outside Web Storage quota, complete versioned history and memories preserved, isolated legacy storage/layout, thread schema 5 and streaming relation schema 3, no auto API calls, mobile layout, shared cancellation after fatal thread quota errors, and fail-closed profile loading. API responses were local fixtures.');
  }finally{quota?.finishPrimary?.();quota?.markPrimaryReady?.();socket?.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});
