// Reproduces an upgrade with already-cached legacy assets and saved data.
// Isolated Chrome storage and local fake API only; never uses a user's profile/key.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const E=require('../experiments.js'),{Ledger}=require('../transcription.js');
(async()=>{
  const root=path.resolve(__dirname,'..'),example=require('../manual-test-example.json');
  const html=await fs.readFile(path.join(root,'index.html'),'utf8');
  const assets=['styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js'];
  const requests=[];let classifications=0;
  const server=http.createServer(async(req,res)=>{
    requests.push(req.url);
    const route=new URL(req.url,'http://localhost'),name=route.pathname.slice(1);
    const json=value=>res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
    if(route.pathname==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(route.pathname==='/api/classify'){classifications++;return res.writeHead(500).end('Unexpected call; no remote service exists in this test.');}
    if(route.pathname==='/prime')return res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(assets.filter(a=>a.endsWith('.css')).map(a=>'<link rel="stylesheet" href="/'+a+'">').join('')+assets.filter(a=>a.endsWith('.js')).map(a=>'<script src="/'+a+'"></script>').join(''));
    if(assets.includes(name) && !route.search){
      // These URLs remain cached for a year: an unversioned upgrade would load them.
      return res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'public, max-age=31536000'}).end(name.endsWith('.css')?'#autoStateEditor{background:rgb(88,0,0)!important;width:160px!important}':'window.legacyAssetLoaded=true;');
    }
    if(route.pathname==='/' || name==='index.html')return res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end(html);
    if(!assets.includes(name) && !['classifier-config.json','manual-test-example.json'].includes(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/json','Cache-Control':'no-store'});
    res.end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-cache-test-'));
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
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const base='http://127.0.0.1:'+server.address().port;
    await call('Page.navigate',{url:base+'/prime'});
    // Wait for every priming script, not just the first one, before checking
    // cache reuse; otherwise fetch can race the initial /lab.js response.
    await wait('window.legacyAssetLoaded===true && document.readyState==="complete"');
    await evaluate("fetch('/lab.js').then(r=>r.text())");
    assert.equal(requests.filter(p=>p==='/lab.js').length,1,'legacy script is really cached');
    const input={name:'JEV-001-U001-C001',language:'en',state:example.state,config:{model:example.model,questions:example.questions},expected:example.expected};
    const savedBatch=id=>({id,createdAt:'2026-10-03T10:00:00Z',provider:'official',input:E.clone(input),requested:1,status:'cancelled',runs:[]});
    const manual=savedBatch('existing-manual'),automated=savedBatch('existing-automated');
    automated.origin='automation';automated.automation={campaignId:'existing-round',round:1,field:'current_utterance',optionId:'1',variant:1,questionVariant:1,label:input.name,questionLabel:'Questions',totalScenarios:1,totalCalls:1};
    const archive={schemaVersion:1,cases:[],batches:[manual,automated]};E.validateArchive(archive);
    const ledger=new Ledger(),result=[{transcript:'Amanhã vamos discutir os pontos da reunião.',confidence:.9}];result.isFinal=true;
    ledger.beginRun();ledger.speechStart(2000);ledger.ingest([result],0,6000,'pt-BR');
    const recording={ledger:ledger.snapshot(),elapsedMs:6000,language:'pt-BR',meeting:{name:'Reunião preservada',startedAt:'2026-10-03T10:00:00Z'}};
    const draft={name:input.name,language:'en',text:JSON.stringify(example.state,null,2),format:'json',config:input.config,editor:JSON.stringify(input.config.questions,null,2),expected:input.expected,batchId:null,run:-1,repeats:'1',inputTab:'state',inputLayout:'stacked',automation:{field:'current_utterance',options:require('../automation.js').exampleOptions(example.questions),repeats:1},view:'variants'};
    await evaluate('localStorage.setItem("norte.tests.v1",'+JSON.stringify(JSON.stringify(archive))+');sessionStorage.setItem("norte.transcription.v1",'+JSON.stringify(JSON.stringify(recording))+');sessionStorage.setItem("norte.lab.drafts.v1",'+JSON.stringify(JSON.stringify({manual:draft,automated:{...draft,inputLayout:'tabs'}}))+');');
    await call('Page.navigate',{url:base+'/#manual'});
    await wait('window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="manual"');
    assert.equal(await evaluate('!!window.legacyAssetLoaded'),false,'no cached legacy script executed');
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#panel-tests").hidden'),false);
    assert.equal(await evaluate('document.querySelectorAll("#testLibrary [data-test-id]").length'),1);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#manualState")).resize'),'none');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches'),archive.batches);
    assert.deepEqual(await evaluate('norteSession.getSnapshot().records'),ledger.records);
    const snapshot=async label=>{const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-cache-'+label+'.png',Buffer.from(shot.data,'base64'));};
    await snapshot('manual');
    await click('#automatedMode');
    assert.equal(await evaluate('document.querySelector("#requestHeader").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),true);
    assert.equal(await evaluate('document.querySelectorAll("#testLibrary [data-campaign-id]").length'),1);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#autoStateEditor")).resize'),'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#autoStateEditor")).backgroundColor'),'rgba(0, 0, 0, 0)');
    assert.equal(await evaluate('JSON.parse(document.querySelector("#autoStateEditor").value).recent_context.length'),3);
    await click('[data-action=view-campaign]');await click('[data-result-test]');
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),automated.id);
    await snapshot('automated');
    await click('#liveMode');
    assert.equal(await evaluate('document.querySelector("#panel-tests").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),false);
    assert.match(await evaluate('document.querySelector("#transcript").textContent'),/Amanhã vamos discutir/);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#inputPaneBody")).display'),'grid');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#questionsInputPanel")).overflow'),'hidden');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".editable-code")).overflow'),'hidden');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#questionEditor")).overflow'),'auto');
    assert.equal(await evaluate('document.querySelector("#questionEditor").scrollWidth<=document.querySelector("#questionEditor").clientWidth'),true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#questionsInputPanel")).minWidth'),'0px');
    await snapshot('live');
    await click('#automatedMode');
    await evaluate('window.dispatchEvent(new Event("pagehide"));window.beforeCacheReload=true');
    await call('Page.reload');
    await wait('!window.beforeCacheReload && window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="automated"');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches'),archive.batches);
    assert.deepEqual(await evaluate('norteSession.getSnapshot().records'),ledger.records);
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),true);
    assert.equal(await evaluate('document.querySelectorAll("#testLibrary [data-campaign-id]").length'),1);
    for(const asset of assets){
      assert.equal(requests.filter(p=>p==='/'+asset).length,1,'cached URL never fetched again: '+asset);
      assert.ok(requests.some(p=>p.startsWith('/'+asset+'?v=')),'versioned asset fetched: '+asset);
    }
    assert.equal(classifications,0);assert.deepEqual(errors,[]);
    console.log('PASS: cached legacy CSS/JS bypassed, existing manual/automated tests and transcription preserved, editors styled, correct log panels, live JSON clipped, normal reload works; zero model calls.');
  }finally{socket?.close();chrome.kill('SIGTERM');server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
