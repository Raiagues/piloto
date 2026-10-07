// Real Chrome, isolated storage, local fixture server. Never calls TypeSafe.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
  const root=path.resolve(__dirname,'..'),common=JSON.parse(await fs.readFile(path.join(root,'manual-test-example.json'),'utf8'));
  const assets=['index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json'];
  let mode='ok',delay=20,inflight=0,maxInflight=0;const sent=[];
  const server=http.createServer(async(req,res)=>{
    const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
    if(req.url==='/api/health')return json(200,{provider:'official',ready:true,engine:'jev-latest',message:'Local test fixture'});
    if(req.url==='/api/classify'){
      let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);sent.push(body);inflight++;maxInflight=Math.max(maxInflight,inflight);await sleep(delay);inflight--;
      if(mode==='401')return json(401,{error:'Simulated authentication failure'});
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
        if(q.type==='noul')return[id,{type:'noul',noul:.8}];
        const keys=Object.keys(q.criteria),winner=keys[0],probabilities=Object.fromEntries(keys.map(k=>[k,k===winner?.8:.2/(keys.length-1)]));
        return[id,q.type==='choice'?{type:'choice',choice:winner,probabilities,confidence:.6}:{type:'score',score:keys.reduce((v,k)=>v+Number(k)*probabilities[k],0),probabilities,confidence:.6}];
      }));
      return json(200,{request:body,response:{model:'fixture-not-a-real-model',answers},provider:'official',latencyMs:20});
    }
    const pathname=new URL(req.url,'http://localhost').pathname;
    const name=pathname==='/'?'index.html':pathname.slice(1);if(!assets.includes(name)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-auto-test-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let socket;
  try{
    let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(100);}}
    assert.ok(port);const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map(),errors=[];
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await sleep(50);}throw Error('Timed out: '+expression+'; errors: '+JSON.stringify(errors));};
    const field=async(selector,value,event='input')=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));})()`);
    const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#manual'});
    await wait('window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="manual"');
    const val=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').value');
    const rename=async name=>{await click('#renameCurrentTest');await field('#testName',name);await evaluate("document.querySelector('#testName').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");};
    const openMenu=async()=>{if(await evaluate('document.querySelector("#testVariantMenu").hidden'))await click('#addTestVariation');};
    const select=async id=>{await openMenu();await click('[data-select-option="'+id+'"]');};
    const dock=async target=>evaluate('(()=>{const dt=new DataTransfer(),source=document.querySelector(document.querySelector("#testInputTabs").hidden?"#questionsInputPanel .editor-heading":"#questionsInputTab"),target=document.querySelector('+JSON.stringify(target)+');source.dispatchEvent(new DragEvent("dragstart",{dataTransfer:dt,bubbles:true}));target.dispatchEvent(new DragEvent("dragover",{dataTransfer:dt,bubbles:true,cancelable:true}));target.dispatchEvent(new DragEvent("drop",{dataTransfer:dt,bubbles:true,cancelable:true}));source.dispatchEvent(new DragEvent("dragend",{dataTransfer:dt,bubbles:true}));})()');
    const reload=async()=>{await evaluate('window.dispatchEvent(new Event("pagehide"));window.__beforeReload=true');await call('Page.reload');await wait('!window.__beforeReload && window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="automated"');};
    assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'stacked');
    assert.equal(await evaluate('document.querySelector("#stateInputPanel").hidden || document.querySelector("#questionsInputPanel").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#stateFormat").type'),'hidden');
    assert.equal(await evaluate('document.querySelector("#testInputTabs").hidden'),true,'stacked mode uses actual pane headings, not misleading tabs');
    {const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-request-manual.png',Buffer.from(shot.data,'base64'));}
    assert.equal(await evaluate('document.querySelectorAll("#editAutoState,#autoStateTree,#autoStateMenu,#autoStateTitle,#autoVariations,#openRequestImport,#exportRequest,#exportTests,#importTests").length'),0);
    assert.equal(await evaluate('document.querySelector("#testToolbar #newTestCase").classList.contains("compact-button")'),true);
    await rename('Manual kept');await field('#manualState',JSON.stringify({...common.state,current_utterance:'My manual draft'}));
    const manualDraft=await evaluate('NorteLab.draft()');
    await click('#automatedMode');
    await click('#useExample');await wait('!document.querySelector("#useExample").disabled');
    assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'tabs');
    assert.equal(await evaluate('document.querySelector("#questionsInputPanel").hidden'),true);
    const options=await evaluate('NorteLab.draft().automation.options');
    assert.equal(options.length,6);
    assert.deepEqual(JSON.parse(await val('#autoStateEditor')),{...common.state,current_utterance:options[0].text});
    assert.equal(await evaluate('document.querySelector("#testVariantMenu").hidden'),true);
    await dock('#inputPaneBody');assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'stacked');
    assert.equal(await evaluate('document.querySelector("#stateDivider").hidden'),false);
    await dock('#requestHeader');assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'tabs');
    await click('#stateInputTab');await openMenu();assert.equal(await evaluate('document.querySelectorAll("[data-select-option]").length'),6);
    await click('[data-select-base]');assert.deepEqual(JSON.parse(await val('#autoStateEditor')),common.state);
    await rename('Original editável');await openMenu();assert.equal(await evaluate('document.querySelector("[data-select-base]").textContent'),'Original editável');
    await select(options[0].id);await rename('JEV-TEST-CUSTOM');
    assert.equal(await evaluate('NorteLab.draft().automation.options[0].name'),'JEV-TEST-CUSTOM');
    await click('#renameCurrentTest');await field('#testName','Cancel this');
    await evaluate("document.querySelector('#testName').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await val('#testName'),'JEV-TEST-CUSTOM');
    const firstState=JSON.parse(await val('#autoStateEditor')),rawBase=await val('#manualState');
    await field('#autoStateEditor','{');assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);assert.equal(await val('#autoStateEditor'),'{');
    await field('#autoStateEditor',JSON.stringify({...firstState,recent_context:['Not allowed here']}));
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),false);
    assert.equal(await val('#manualState'),rawBase);
    await field('#autoStateEditor',JSON.stringify(firstState));assert.equal(await evaluate('document.querySelector("#runTest").disabled'),false);
    assert.equal(await val('#manualState'),rawBase);
    await openMenu();await click('[data-add-field="recent_context"]');
    assert.equal((await evaluate('NorteLab.draft().automation.options')).at(-1).field,'recent_context');
    const contextState={...common.state,recent_context:['Speaker A: A different context.']};
    await field('#autoStateEditor',JSON.stringify(contextState));
    assert.deepEqual((await evaluate('NorteLab.draft().automation.options')).slice(0,6).map(o=>o.text),options.map(o=>o.text));
    assert.equal(await evaluate('document.querySelector("#automationCount").textContent'),'7 testes · 7 chamadas');
    await openMenu();await click('[data-add-field="current_utterance"]');
    assert.equal(await evaluate('NorteLab.draft().automation.options.length'),8);
    await openMenu();const extraId=(await evaluate('NorteLab.draft().automation.options')).at(-1).id;
    await click('[data-remove-option="'+extraId+'"]');assert.equal(await evaluate('NorteLab.draft().automation.options.length'),7);
    await select(options[5].id);assert.equal(await evaluate('Object.keys(NorteLab.draft().automation.options[5].expected).length'),11);
    await field('#testRepeats','4','change');await evaluate('window.confirm=()=>false');await click('#runTest');assert.equal(sent.length,0);
    await evaluate('window.confirm=()=>true');await field('#testRepeats','1','change');
    await click('#manualMode');assert.equal(await val('#manualState'),manualDraft.text);assert.equal(await val('#testName'),'Manual kept');
    await click('#automatedMode');await click('#runTest');await wait('!NorteLab.isRunning()');
    assert.equal(sent.length,7);assert.equal(maxInflight,1);
    let batches=await evaluate('NorteLab.snapshot().batches');
    assert.equal(batches.length,7);assert.ok(batches.every(b=>b.runs[0].status==='done'));assert.equal(batches[0].input.name,'JEV-TEST-CUSTOM');
    assert.deepEqual(batches[6].input.state,contextState);
    for(const [i,b]of batches.entries()){assert.deepEqual(Object.keys(sent[i]),['model','state','questions']);assert.deepEqual(sent[i].questions,common.questions);if(i<6){assert.deepEqual(b.input.state.recent_context,common.state.recent_context);assert.deepEqual(b.input.expected,options[i].expected);}}
    assert.equal(await evaluate('document.querySelectorAll("#testLibrary [data-campaign-id]").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("#campaignOutput [data-result-test]").length'),7);
    assert.equal(await evaluate('document.querySelectorAll("#campaignOutput .answer-row,.campaign-scenario,.scenario-context").length'),0);
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);
    await click('[data-result-test="'+batches[0].id+'"]');
    assert.equal(await evaluate('document.querySelectorAll("#campaignOutput .answer-row").length'),11);
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),batches[0].id);
    assert.deepEqual(JSON.parse(await val('#autoStateEditor')),batches[0].input.state);
    assert.equal(await evaluate('document.querySelector("#autoStateEditor").readOnly'),true);assert.equal(await val('#manualState'),rawBase);
    {const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-request-results.png',Buffer.from(shot.data,'base64'));}
    await click('#questionsInputTab');
    assert.deepEqual(await evaluate('JSON.parse(document.querySelector("#savedQuestions").textContent)'),common.questions);
    assert.equal(await evaluate('document.querySelector("#questionsInputPanel .editable-code").hidden'),true);await click('#stateInputTab');
    await openMenu();await click('[data-select-saved="'+batches[6].id+'"]');
    assert.deepEqual(JSON.parse(await val('#autoStateEditor')),contextState);
    assert.equal(await evaluate('document.querySelector("[data-result-test].selected").dataset.resultTest'),batches[6].id);
    await click('[data-result-test="'+batches[0].id+'"]');
    await field('#campaignOutput [data-expected=should_track]','false','change');await field('#campaignOutput [data-min-probability=should_track]','90','change');
    const corrected=await evaluate('NorteLab.snapshot().batches[0]');
    assert.deepEqual(corrected.runs,batches[0].runs);assert.deepEqual(corrected.input,batches[0].input);
    assert.deepEqual(corrected.expectedOverride.should_track,{type:'noul',value:false,minProbability:.9});
    await rename('Renamed saved');assert.equal(await evaluate('NorteLab.snapshot().batches[0].displayName'),'Renamed saved');assert.equal(sent.length,7);
    await click('#backToDraft');assert.equal(await val('#manualState'),rawBase);
    await evaluate('while(NorteLab.draft().automation.options.length>2){document.querySelectorAll("[data-select-option]")[2].click();document.querySelector("[data-remove-option]").click();}');
    const questions={should_track:common.questions.should_track};
    await click('#questionsInputTab');await field('#questionEditor',JSON.stringify(questions));
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);
    await click('#applyQuestions');await click('#stateInputTab');await field('#testRepeats','4','change');
    await click('#runTest');await wait('!NorteLab.isRunning()');assert.equal(sent.length,15);
    batches=await evaluate('NorteLab.snapshot().batches');assert.equal(batches.length,9);
    assert.ok(batches.slice(7).every(b=>b.runs.length===4 && b.automation.round===2));
    for(const r of sent.slice(7))assert.deepEqual(r.questions,questions);
    await click('[data-result-test="'+batches[7].id+'"]');await click('[data-scenario-run="2"]');assert.equal(await evaluate('NorteLab.draft().run'),2);
    const beforeDelete=await evaluate('NorteLab.snapshot()');await click('[data-action=delete-scenario-run]');
    assert.equal(await evaluate('NorteLab.snapshot().batches[7].runs[2].status'),'deleted');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches.slice(0,7)'),beforeDelete.batches.slice(0,7));
    await click('#backToDraft');const unapplied=JSON.stringify({...questions,unapplied_question:common.questions.should_track});
    await click('#questionsInputTab');await field('#questionEditor',unapplied);
    await click('[data-campaign-id="'+batches[0].automation.campaignId+'"] [data-action=view-campaign]');
    await click('[data-result-test="'+batches[1].id+'"]');await click('#questionsInputTab');
    assert.deepEqual(await evaluate('JSON.parse(document.querySelector("#savedQuestions").textContent)'),common.questions);
    assert.deepEqual(await evaluate('NorteClassifier.getConfig().questions'),questions);assert.equal(await val('#questionEditor'),unapplied);
    await click('#backToDraft');assert.equal(await val('#questionEditor'),unapplied);assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);
    await field('#questionEditor',JSON.stringify(questions));await click('#applyQuestions');await click('#stateInputTab');
    delay=300;const beforeCancel=sent.length;await click('#runTest');await sleep(80);await click('#cancelTest');await wait('!NorteLab.isRunning()');assert.equal(sent.length,beforeCancel+1);
    assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).status'),'cancelled');
    await click('#backToDraft');mode='401';delay=20;const beforeFailure=sent.length;await click('#runTest');await wait('!NorteLab.isRunning()');assert.equal(sent.length,beforeFailure+1);mode='ok';
    const beforeReload=sent.length;await reload();assert.equal(sent.length,beforeReload);
    await click('#backToDraft');await click('#inputLayoutToggle');assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'stacked');
    await reload();assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'stacked');await click('#inputLayoutTabs');
    const group=batches[0].automation.campaignId;
    await click('[data-campaign-id="'+group+'"] [data-action=view-campaign]');await click('#selectAllTests');await click('#compareTests');
    assert.equal(await evaluate('document.querySelector("#campaignOutput").hidden'),true);await click('#clearTestSelection');
    const beforeGroup=await evaluate('NorteLab.snapshot()');
    await evaluate('window.confirm=()=>false');await click('[data-campaign-id="'+group+'"] [data-action=delete-campaign]');assert.deepEqual(await evaluate('NorteLab.snapshot()'),beforeGroup);
    await evaluate('window.confirm=()=>true');await click('[data-campaign-id="'+group+'"] [data-action=delete-campaign]');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches'),beforeGroup.batches.filter(b=>b.automation.campaignId!==group));
    await click('#useExample');await wait('!document.querySelector("#useExample").disabled');assert.equal(sent.length,beforeReload);
    assert.equal(await evaluate('NorteLab.draft().automation.options.length'),6);
    for(const width of [1440,900,390,320]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight'),false,'no page scroll at '+width);
      assert.equal(await evaluate('document.querySelector("#runTest").getBoundingClientRect().bottom<=document.querySelector(".state-pane").getBoundingClientRect().bottom'),true,'run visible at '+width);
      assert.equal(await evaluate('document.querySelector("#autoStateEditor").clientHeight>=100'),true,'JSON remains usable at '+width);
      await openMenu();assert.equal(await evaluate('document.querySelector("#testVariantMenu").getBoundingClientRect().right<=innerWidth'),true);
      if(width===1440||width===390){const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-request-menu-'+width+'.png',Buffer.from(shot.data,'base64'));}
      await click('#addTestVariation');
      if(width===1440||width===390){const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-request-editor-'+width+'.png',Buffer.from(shot.data,'base64'));}
    }
    assert.deepEqual(errors,[]);console.log('PASS: JSON editor, variant names/add/remove, mixed State fields, manual stack, drag docking, result/State sync, archived Questions, drafts, compact selectors, corrections, sequential requests, cancellation, errors, reload, deletion and four viewport sizes. Simulated API only.');
  }finally{
    socket?.close();server.close();
    const exited=chrome.exitCode!==null || chrome.signalCode!==null?Promise.resolve():new Promise(resolve=>chrome.once('exit',resolve));
    chrome.kill('SIGTERM');await exited;
    await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
