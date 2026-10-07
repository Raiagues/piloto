// Current UI compatibility for immutable V1 relation snapshots. Local fixtures only.
// Covers original requests, probabilities and history exports; live relations were replaced by threads.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises'),F=require('../memory-flow.js');
const legacyRun=require('./fixtures/memory-relations-v1.json');
(async()=>{
  const root=path.resolve(__dirname,'..'),sent=[],relationSent=[],errors=[];
  const library=F.emptyLibrary(),saved=F.saveTest(library,legacyRun.batch,legacyRun.questions,legacyRun);
  const assets=['index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json'];
  const server=http.createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/api/classify'||req.url==='/api/relations'){
      let text='';for await(const part of req)text+=part;const request=JSON.parse(text);
      (req.url==='/api/relations'?relationSent:sent).push(request);
      const item=legacyRun.batch.cases.find(c=>c.current_utterance===request.state.current_utterance);
      const answers=Object.fromEntries(Object.entries(request.questions).map(([id,q])=>{
        if(q.type==='noul')return[id,{type:'noul',noul:.97}];
        const choice=id==='event_type'?item.expected_event_type:'belongs',keys=Object.keys(q.criteria);
        return[id,{type:'choice',choice,confidence:.2,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?.97:.03/(keys.length-1)]))}];
      }));
      await sleep(15);return json({request,response:{model:'compatibility-fixture',answers},provider:'official',latencyMs:15});
    }
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!assets.includes(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-relations-'));
  const downloads=await fs.mkdtemp(path.join(os.tmpdir(),'norte-memory-downloads-'));
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
    const exportFile=async format=>{
      const before=new Set(await fs.readdir(downloads));
      await pointer(`[data-export-test="${saved.id}"][data-mf-export="${format}"]`);
      for(let i=0;i<150;i++) {
        const name=(await fs.readdir(downloads)).find(name=>!before.has(name)&&name.endsWith('.'+format));
        if(name)return {name,text:await fs.readFile(path.join(downloads,name),'utf8')};
        await sleep(30);
      }
      throw Error('Download missing: '+format);
    };
    const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-relations-'+name+'.png',Buffer.from(r.data,'base64'));};
    await call('Runtime.enable');await call('Page.enable');
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#memoria'});
    await wait('window.NorteMemoryPage && NorteClassifier.isAvailable()');
    await evaluate("localStorage.setItem('norte.memory-library.v1',"+JSON.stringify(JSON.stringify(library))+")");
    await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    await click('#mfHistoryToggle');await click('[data-saved-test="'+saved.id+'"]');await wait('NorteMemoryPage.snapshot().run?.relation_worker?.schemaVersion===1');
    let state=await snapshot();const immutable=state.library.tests.find(t=>t.id===saved.id),historical=state.run;
    assert.equal(sent.length+relationSent.length,0,'opening history never reruns inference');assert.equal(historical.thread_worker,undefined);
    assert.deepEqual(historical.relations,legacyRun.relations);assert.deepEqual(historical.relation_worker.config,legacyRun.relation_worker.config);
    assert.equal(await evaluate('document.querySelector("#mfNodeRelationFilter").hidden'),false);
    assert.match(await evaluate('document.querySelector("#mfRelationHeading").textContent'),/histórico/);
    assert.equal(await evaluate('document.querySelector("#mfNodeThreadContext").hidden'),true);
    await click('#mfChunks [data-chunk="C03"]');
    assert.equal(await evaluate('document.querySelectorAll("#mfRelationDetails [data-relation-target=E001]").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("#mfRelationDetails .mf-probability-ring").length'),2);
    assert.match(await evaluate('document.querySelector("#mfRelationDetails").textContent'),/95\.0%/);
    assert.match(await evaluate('document.querySelector("#mfRelationDetails").textContent'),/has_relation__E001/);
    assert.match(await evaluate('document.querySelector("#mfRelationDetails").textContent'),/JSON da chamada e resposta/);
    const report=JSON.parse((await exportFile('json')).text),csv=(await exportFile('csv')).text;
    assert.deepEqual(report.execution.relation_worker,historical.relation_worker);assert.deepEqual(report.execution.relations,legacyRun.relations);
    assert.equal(report.configuration.relation_candidate_scope,'legacy_type_status_filter');assert.match(csv,/relation_call/);assert.match(csv,/has_relation__E001/);
    assert.equal(sent.length+relationSent.length,0,'inspection and exports use saved evidence');await shot('v1-compat');
    // The second editor configures the next thread run; legacy relation prompts stay immutable.
    await click('#mfQuestions');await click('#mfRelationQuestions');
    const config=JSON.parse(await evaluate('document.querySelector("#mfQuestionJSON").value'));
    assert.ok(config.questions.belongs_to_active_thread);assert.equal(config.questions.has_relation,undefined);
    assert.match(await evaluate('document.querySelector("#mfQuestionStatus").textContent'),/próxima execução/);
    config.questions.belongs_to_active_thread.instructions+=' Compatibility fixture: preserve this explicit thread question.';
    await evaluate("(()=>{const input=document.querySelector('#mfQuestionJSON');input.value="+JSON.stringify(JSON.stringify(config))+";input.dispatchEvent(new Event('input',{bubbles:true}));})()");await click('#mfSaveQuestions');
    await wait('document.querySelector("#mfQuestionStatus").textContent.includes("salva")');await click('#mfQuestionsDialog [data-mf-close]');
    assert.deepEqual((await snapshot()).library.tests.find(t=>t.id===saved.id),immutable);
    await click('#mfBurstToggle');await click('#mfRun');await wait('!NorteMemoryPage.isRunning() && NorteMemoryPage.snapshot().run?.thread_worker?.status==="done"');
    state=await snapshot();assert.equal(state.run.relation_worker,undefined);assert.equal(state.run.thread_worker.schemaVersion,4);assert.equal(state.run.typed_relation_worker,undefined);
    assert.equal(state.meeting_threads.length,1);assert.equal(sent.length,6);assert.equal(relationSent.length,2);
    assert.ok(relationSent.every(request=>request.questions.belongs_to_active_thread.instructions===config.questions.belongs_to_active_thread.instructions));
    assert.deepEqual(state.library.tests.find(t=>t.id===saved.id),immutable,'rerunning legacy inputs creates a new current run');
    await click('#mfSaveTest');const calls=sent.length+relationSent.length;
    await click('[data-saved-test="'+saved.id+'"]');await wait('NorteMemoryPage.snapshot().run?.relation_worker?.schemaVersion===1');
    await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    state=await snapshot();assert.equal(state.savedId,saved.id);assert.deepEqual(state.run.relation_worker,historical.relation_worker);assert.equal(sent.length+relationSent.length,calls);
    assert.deepEqual(state.library.tests.find(t=>t.id===saved.id),immutable);assert.deepEqual(errors,[]);
    console.log('PASS: immutable V1 filtered relation snapshot, original probabilities/requests, history JSON/CSV exports, read-only legacy configuration, editable versioned threads for next run, rerun migration, preserved history and reload without inference. Local fixtures only.');
  }finally{
    socket?.close();server.close();
    const exited=chrome.exitCode!==null || chrome.signalCode!==null ? Promise.resolve() : new Promise(resolve=>chrome.once('exit',resolve));
    chrome.kill('SIGTERM');await exited;
    // This mkdtemp profile is exclusively owned by this test, never a real browser.
    await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    await fs.rm(downloads,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
