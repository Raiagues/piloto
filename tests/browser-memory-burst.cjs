// Real browser interactions against an isolated local fixture, never the paid API.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises'),F=require('../memory-flow.js');
(async()=>{
  const root=path.resolve(__dirname,'..'),sent=[],secondary=[],errors=[];let active=0,peak=0,secondaryActive=0,secondaryPeak=0,releaseFirst;
  const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
  const assets=['index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json'];
  const batch={batch_id:'BURST',cases:Array.from({length:20},(_,i)=>({id:'C'+String(i+1).padStart(2,'0'),current_utterance:'Fixture utterance '+(i+1),expected_store_memory:i%3!==1,expected_event_type:i%3===1?null:F.types[i%F.types.length]}))};
  const server=http.createServer(async(req,res)=>{
    const json=(value)=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/api/classify'){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);sent.push(body);peak=Math.max(peak,++active);
      if(sent.length===1)await firstResponse;else await sleep(40);active--;
      const item=batch.cases.find(c=>c.current_utterance===body.state.current_utterance);assert.ok(item);
      const answers=body.questions.should_store_memory?{should_store_memory:{type:'noul',noul:item.expected_store_memory?.96:.02}}:
        {event_type:{type:'choice',choice:item.expected_event_type,confidence:.2,probabilities:Object.fromEntries(F.types.map(t=>[t,t===item.expected_event_type?.94:.06/(F.types.length-1)]))}};
      return json({request:body,response:{model:'local-fixture',answers},provider:'official',latencyMs:40});
    }
    if(req.url==='/api/relations'){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);secondary.push(body);secondaryPeak=Math.max(secondaryPeak,++secondaryActive);
      assert.ok(body.state.current_event);assert.ok(body.state.active_thread);
      assert.ok(!JSON.stringify(body).includes('expected_'),'model requests never contain evaluation labels');
      await sleep(40);secondaryActive--;
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,{type:'choice',choice:'belongs',confidence:.2,probabilities:Object.fromEntries(Object.keys(q.criteria).map(value=>[value,value==='belongs'?.94:.03]))}]));
      return json({request:body,response:{model:'local-thread-fixture',answers},provider:'official',latencyMs:40});
    }
    const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);
    if(!assets.includes(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-memory-burst-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket,chromeError='';chrome.stderr.on('data',data=>{chromeError=(chromeError+data).slice(-3000);});
  try{
    let port;for(let i=0;i<120;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(100);}}assert.ok(port,chromeError);
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Page.javascriptDialogOpening'&&m.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(e=>errors.push(e.message));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out: '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<400;i++){if(await evaluate(expression))return;await sleep(25);}throw Error('Timed out: '+expression+' '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const pointer=async selector=>{const p=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,ok:n.contains(document.elementFromPoint(x,y))};})()`);assert.ok(p.ok,selector);await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});};
    const snapshot=()=>evaluate('NorteMemoryPage.snapshot()');
    const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-memory-burst-'+name+'.png',Buffer.from(r.data,'base64'));};
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.memoryVisualWaits=[];const nativeTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===450||ms===550)memoryVisualWaits.push(ms);return nativeTimeout(fn,ms,...args);};`});
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#memoria'});
    await wait('window.NorteMemoryPage && NorteClassifier.isAvailable()');
    assert.equal(await evaluate('document.querySelector("#mfBurstToggle").getAttribute("aria-checked")'),'false');
    await pointer('#mfBurstToggle');assert.equal(await evaluate('document.querySelector("#mfModeLabel").textContent'),'Rajada');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("norte.memory-ui.v1")).fastMode'),true);
    assert.equal((await snapshot()).library.tests.length,0,'choosing a mode never archives a test');
    await pointer('#mfPaste');await evaluate(`document.querySelector('#mfBatchJSON').value=${JSON.stringify(JSON.stringify(batch))}`);await pointer('#mfLoad');
    await pointer('#mfRun');await wait('NorteMemoryPage.snapshot().run.records.length===20');
    let s=await snapshot();assert.equal(s.run.executionMode,'burst');assert.equal(s.run.calls,1);
    assert.equal(s.run.records.filter(r=>r.status==='queued').length,19);assert.equal(s.selected,'C01','arrivals never steal follow from the worker');
    assert.deepEqual(s.raw_window.map(c=>c.chunk_id),batch.cases.slice(-15).map(c=>c.id),'FIFO keeps C06–C20 while every received chunk stays queued');
    assert.equal(await evaluate('document.querySelector("#mfBurstToggle").disabled'),true);
    assert.match(await evaluate('document.querySelector("#mfProgress").textContent'),/19 na fila/);
    await click('[data-chunk="C20"]');await wait('document.querySelector("#mfViewing").textContent.includes("na fila")');
    assert.equal(await evaluate('document.querySelector("#mfGraphRawQueue .is-selected").dataset.record'),'C20');
    assert.equal(await evaluate('document.querySelector("#mfNodeStore").dataset.tone'),'','queued chunks have no invented path');
    assert.equal((await snapshot()).follow,false);
    await shot('queued');releaseFirst();
    await wait('NorteMemoryPage.snapshot().run.records.find(r=>r.id==="C03").status!=="queued"');
    await click('[data-chunk="C01"]');
    await wait('!NorteMemoryPage.isRunning()');s=await snapshot();
    assert.equal(s.selected,'C01','manual inspection stays selected during subsequent processing and arrivals');
    assert.equal(s.run.status,'done');assert.equal(s.run.calls,33);assert.equal(peak,1,'primary requests remain serial');
    assert.equal(s.run.thread_worker.status,'done');assert.equal(s.run.thread_worker.calls,12);assert.equal(secondaryPeak,1,'thread requests remain serial within their own worker');
    assert.equal(s.meeting_threads.length,1);assert.ok(s.run.thread_worker.jobs.every(job=>job.status==='done'));
    assert.deepEqual(sent.map(req=>[req.state.current_utterance,Object.keys(req.questions)[0]]),batch.cases.flatMap(item=>[[item.current_utterance,'should_store_memory'],...(item.expected_store_memory?[[item.current_utterance,'event_type']]:[])]),'primary inference preserves receipt order, including chunks evicted from the raw view');
    assert.deepEqual(secondary.map(req=>req.state.current_event.chunk_id),batch.cases.filter(item=>item.expected_store_memory).slice(1).map(item=>item.id));
    assert.deepEqual(s.raw_window.map(c=>c.chunk_id),batch.cases.slice(-15).map(c=>c.id));
    assert.ok(s.run.records.every(r=>r.status==='done'&&r.result.correct));
    assert.deepEqual(s.meeting_events.map(e=>e.chunk_id),batch.cases.filter(c=>c.expected_store_memory).map(c=>c.id));
    assert.deepEqual(await evaluate('memoryVisualWaits'),[],'fast mode adds no per-call or per-result visual delays');
    assert.match(await evaluate('document.querySelector("#mfRawSelection").textContent'),/fora da janela atual/);
    assert.equal(await evaluate('document.querySelector("#mfNodeChunk").dataset.routeTone'),'pass','raw input remains marked along a historical route');
    await click('[data-chunk="C18"]');
    assert.equal(await evaluate('document.querySelector("#mfGraphRawQueue .is-selected").dataset.record'),'C18');
    assert.equal(await evaluate('document.querySelector("#mfRawWindow .is-selected").dataset.memoryChunk'),'C18');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#mfNodeChunk")).borderTopColor'),'rgb(90, 218, 178)');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#mfNodeChunk")).backgroundColor'),'rgb(8, 28, 48)','raw border highlight never tints every chunk');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#mfRawWindow .is-selected")).borderLeftColor'),'rgb(90, 218, 178)');
    assert.ok(await evaluate('[...document.querySelectorAll("#mfGraphRawQueue [data-record]:not(.is-selected)")].every(n=>n.dataset.tone==="")'));
    await shot('complete');
    await pointer('#mfSaveTest');assert.equal((await snapshot()).library.tests[0].run.executionMode,'burst');
    const calls=sent.length,threadCalls=secondary.length;await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    assert.equal(await evaluate('document.querySelector("#mfBurstToggle").getAttribute("aria-checked")'),'true');
    assert.equal((await snapshot()).run.executionMode,'burst');assert.equal(sent.length,calls,'recovery never resends a batch');assert.equal(secondary.length,threadCalls,'recovery never resends thread calls');assert.equal((await snapshot()).run.thread_worker.status,'done');
    await pointer('#mfBurstToggle');assert.equal(await evaluate('document.querySelector("#mfModeLabel").textContent'),'Passo a passo');
    assert.equal((await snapshot()).library.tests[0].run.executionMode,'burst','mode preference does not rewrite saved results');
    await pointer('#mfRun');await wait('NorteMemoryPage.snapshot().run.records[0]?.status==="done"');
    await pointer('#mfStop');await wait('!NorteMemoryPage.isRunning()');s=await snapshot();
    assert.equal(s.run.executionMode,'step');assert.equal(s.run.status,'stopped');assert.equal(s.run.records.length,1,'step mode does not accept a backlog');
    assert.deepEqual(await evaluate('memoryVisualWaits'),[550,550,450]);
    assert.equal(s.library.tests.length,1,'neither mode automatically saves a new test');
    assert.equal(sent.length,calls+2,'stop finishes only the current chunk');assert.equal(secondary.length,threadCalls,'the first event requires no thread call and stop starts no later work');
    assert.ok(sent.every(req=>Object.keys(req.state).join()==='current_utterance'));
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log('PASS: burst arrival backlog, FIFO15 without dropped work, independent serial workers with local responses, stop/restore, mode persistence and synchronized raw highlight. No paid calls.');
  }finally{releaseFirst();socket?.close();chrome.kill('SIGTERM');server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
