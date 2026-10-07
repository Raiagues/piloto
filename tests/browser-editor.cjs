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
    const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-editor-'+name+'.png',Buffer.from(shot.data,'base64'));};
    assert.equal(await evaluate('document.querySelector("#requestHeader").contains(document.querySelector("#runTest"))'),true);
    assert.equal(await evaluate('document.querySelector("#requestScope")'),null);
    assert.equal(await evaluate('document.querySelector("#renameCurrentTest").compareDocumentPosition(document.querySelector("#testName")) & Node.DOCUMENT_POSITION_FOLLOWING'),4);
    assert.ok(await evaluate('document.querySelector("#testName").getBoundingClientRect().width<200'));
    assert.ok(await evaluate('Math.abs(document.querySelector("#runTest").getBoundingClientRect().top-document.querySelector("#testName").getBoundingClientRect().top)<14'),'run is beside the name on desktop');
    assert.equal(await evaluate('document.querySelector("#testSummary h2").textContent'),'Testes');
    assert.equal(await evaluate('document.querySelectorAll("#testSummary [data-run]").length'),1);
    await field('#testRepeats','10','change');
    assert.equal(await evaluate('document.querySelectorAll("#testSummary [data-run]").length'),10);
    assert.ok(await evaluate('[...document.querySelectorAll("#testSummary [data-run]")].every(button=>button.disabled && button.dataset.status==="pending" && button.textContent.includes("Execução"))'));
    assert.equal(sent.length,0);
    await screenshot('initial');
    const tabSource='{\n"x": 1,\n"y": 2\n}';
    const tab=async shift=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:shift?8:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:shift?8:0});};
    const selection=async(start,end=start)=>evaluate(`document.querySelector('#manualState').focus();document.querySelector('#manualState').setSelectionRange(${start},${end})`);
    await field('#manualState',tabSource);await selection(2);await tab(false);
    assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource.replace('\n','\n  '));
    assert.equal(await evaluate('document.activeElement.id'),'manualState');
    assert.equal(await evaluate('document.querySelector("#manualState").selectionStart'),4);
    assert.ok(await evaluate('document.querySelector("#manualStateHighlight").textContent.includes(\'  "x"\')'));
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'z',code:'KeyZ',windowsVirtualKeyCode:90,modifiers:2});
    assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource,'Tab remains undoable');
    await selection(0,tabSource.length);await tab(false);
    assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource.split('\n').map(line=>'  '+line).join('\n'));
    await tab(true);assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource,'Shift+Tab unindents selected lines');
    await selection(2,tabSource.indexOf('"y"'));await tab(false);
    assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource.replace('\n','\n  '),'a selection ending at the next line does not indent that unselected line');
    await selection(4);await tab(true);assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource);
    await selection(2);await tab(true);assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource,'unindenting an unindented line is harmless');
    await evaluate('document.querySelector("#manualState").readOnly=true');await tab(false);
    assert.equal(await evaluate('document.querySelector("#manualState").value'),tabSource,'read-only source is never changed by Tab');
    await evaluate('document.querySelector("#manualState").readOnly=false');
    const longState={...common.state,current_utterance:'Speaker C: '+('Long engineering phrase '.repeat(40))+'<img src=x onerror="window.INJECTED=true">',extra:{approved:true,size:4}};
    const rawState=JSON.stringify(longState,null,2);
    await field('#manualState',rawState);
    const longQuestions={should_track:{...common.questions.should_track,instructions:'A long instruction '+('X'.repeat(450))}};
    await field('#questionEditor',JSON.stringify(longQuestions,null,2));await sleep(100);
    assert.ok(await evaluate('document.querySelectorAll("#manualStateHighlight .json-key").length>3'));
    assert.ok(await evaluate('document.querySelectorAll("#manualStateHighlight .json-string").length>3'));
    assert.ok(await evaluate('document.querySelectorAll("#manualStateHighlight .json-value").length>=2'));
    assert.equal(await evaluate('document.querySelector("#manualState").value'),rawState,'soft wrapping never inserts source newlines');
    assert.equal(await evaluate('!!window.INJECTED || !!document.querySelector("#manualStateHighlight img")'),false);
    for(const width of [1440,900,390,320]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(150);
      for(const selector of ['#manualState','#questionEditor'])assert.ok(await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return e.scrollWidth<=e.clientWidth+1})()'),'no horizontal scrolling: '+selector+' at '+width);
      assert.ok(await evaluate('(()=>{const mirror=document.querySelector("#questionHighlight"),e=document.querySelector("#questionEditor");return Math.abs(mirror.getBoundingClientRect().width-e.clientWidth)<1})()'));
      await evaluate('document.querySelector("#questionEditor").scrollTop=100;document.querySelector("#questionEditor").dispatchEvent(new Event("scroll"))');
      assert.ok(await evaluate('(()=>{const a=[...document.querySelector("#questionHighlight").children],b=[...document.querySelector("#questionLines").children];return a.length===b.length && a.every((r,i)=>Math.abs(r.getBoundingClientRect().top-b[i].getBoundingClientRect().top)<2 && Math.abs(r.getBoundingClientRect().height-b[i].getBoundingClientRect().height)<2)})()'),'line numbers track wrapped source lines');
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight'),false);
    }
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
    await evaluate('document.querySelector("#manualState").focus();document.querySelector("#manualState").setSelectionRange(document.querySelector("#manualState").value.length,document.querySelector("#manualState").value.length)');
    await call('Input.insertText',{text:' '});
    assert.equal(await evaluate('document.querySelector("#manualState").value'),rawState+' ','native caret/input remains intact');
    await click('#inputLayoutTabs');await evaluate('NorteLayout.reset("#stateDivider",80)');await click('#inputLayoutToggle');
    assert.equal(await evaluate('document.querySelector("#stateDivider").getAttribute("aria-valuenow")'),'50');
    assert.ok(await evaluate('Math.abs(document.querySelector("#stateInputPanel").getBoundingClientRect().height-document.querySelector("#questionsInputPanel").getBoundingClientRect().height)<2'));
    await click('#inputLayoutTabs');
    await evaluate('(()=>{const dt=new DataTransfer(),tab=document.querySelector("#questionsInputTab"),host=document.querySelector("#inputPaneBody");tab.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));host.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));})()');
    assert.equal(await evaluate('document.querySelector("#stateDivider").getAttribute("aria-valuenow")'),'50');
    await screenshot('wrapped');
    // Recorded fixtures, not model judgments: verify every status and the confidence-only reason.
    const E=require('../experiments.js'),q={should_track:common.questions.should_track};
    const input={name:'Run status fixture',language:'en',state:common.state,config:{model:common.model,questions:q},expected:{should_track:{type:'noul',value:true,minProbability:.8}}};
    const batch={id:'editor-status-fixture',createdAt:'2026-10-04T10:00:00Z',provider:'official',input,requested:4,status:'done',runs:[.95,.65,.1].map((prob,index)=>({index:index+1,status:'done',startedAt:'2026-10-04T10:00:00Z',finishedAt:'2026-10-04T10:00:01Z',output:{request:E.request(input),response:{model:'fixture',answers:{should_track:{type:'noul',noul:prob}}},provider:'official',latencyMs:100}}))};
    batch.runs.push({index:4,status:'error',error:'Simulated API error',startedAt:'2026-10-04T10:00:00Z',finishedAt:'2026-10-04T10:00:01Z'});
    await evaluate('NorteLab.importArchive('+JSON.stringify({schemaVersion:1,cases:[],batches:[batch]})+')');await click('[data-action=view-batch]');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#testSummary [data-run]")].map(b=>b.dataset.status)'),['passed','failed','failed','error']);
    assert.match(await evaluate('document.querySelector("#testSummary [data-run=\\"2\\"]").title'),/confiança insuficiente/);
    assert.match(await evaluate('document.querySelector("#testSummary [data-run=\\"3\\"]").title'),/resposta diferente/);
    assert.equal(await evaluate('document.querySelectorAll(".test-statistics").length'),0);
    assert.ok(await evaluate('getComputedStyle(document.querySelector("#testSummary [data-run=\\"1\\"]")).color !== getComputedStyle(document.querySelector("#testSummary [data-run=\\"2\\"]")).color'));
    const frozen=await evaluate('NorteLab.snapshot().batches[0].runs');
    await screenshot('statuses');
    await click('#testSummary [data-run="2"]');
    assert.match(await evaluate('document.querySelector(".run-verdict").textContent'),/confiança insuficiente/);
    await field('[data-min-probability=should_track]','60','change');
    assert.equal(await evaluate('document.querySelector("#testSummary [data-run=\\"2\\"]").dataset.status'),'passed');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches[0].runs'),frozen);
    await field('#testRepeats','10','change');
    assert.equal(await evaluate('document.querySelectorAll("#testSummary [data-run]").length'),10);
    assert.ok(await evaluate('[...document.querySelectorAll("#testSummary [data-run]")].every(b=>b.disabled && b.dataset.status==="pending")'));
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches[0].runs'),frozen);
    assert.equal(sent.length,0);assert.deepEqual(errors,[]);
    console.log('PASS: soft-wrap + safe State syntax colors, native editing/scrolling, wrapped line numbers, compact top controls, icons, 50/50 docking, planned execution count, pass/wrong-answer/low-confidence/API-error colors and unchanged snapshots. No inference calls.');
  }finally{socket?.close();chrome.kill('SIGTERM');server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
