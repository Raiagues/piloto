// Chrome's actual localStorage quota and IndexedDB; all classification is local fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const F=require('../memory-flow.js'),V2=require('../memory-v2.js'),TR=require('../typed-relations.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const makeBatch=id=>({batch_id:id,cases:[{id:'C01',current_utterance:'The pump housing is steel.',expected_store_memory:true,expected_event_type:'observation'}]});
async function fixtureRun(id){
  const run=F.createRun(makeBatch(id),'official',.8,V2.questions);
  await F.execute(run,{mode:'burst',wait:async()=>{},send:async request=>{
    const question=request.questions.event_type;
    return {request:clone(request),provider:'official',latencyMs:1,response:{model:'local-storage-fixture',answers:question?{event_type:{type:'choice',choice:'observation',confidence:.97,probabilities:Object.fromEntries(Object.keys(question.criteria).map(key=>[key,key==='observation'?.97:.03/(Object.keys(question.criteria).length-1)]))}}:{should_store_memory:{type:'noul',noul:.98}}}};
  }});return run;
}
(async()=>{
  const root=path.resolve(__dirname,'..'),errors=[],requests=[],sockets=[];
  const library=F.emptyLibrary(),savedRun=await fixtureRun('LEGACY-SAVED'),activeRun=await fixtureRun('LEGACY-UNSAVED');
  F.saveTest(library,savedRun.batch,savedRun.questions,savedRun,V2.threadConfig,TR.defaults);F.validateLibrary(library);
  const seed={library,checkpoint:{schemaVersion:1,run:activeRun,selected:'C01',savedId:null}};
  const assets=new Set(['meeting-commands.js','meeting-session.js','meeting-evidence.js','meeting-state.js','meeting-review.js','meeting-hierarchy.js','meeting-amendments.js','meeting-document.js','gemini-minutes.js','gemini-minutes.css','meeting-room.js','meeting-room.css','meeting-canvas.js','meeting-canvas.css','index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','memory-v2.js','memory-storage.js','typed-relations.js','typed-relations-page.js','meeting-minutes.js','meeting-minutes.css','relation-map.js','relation-map.css','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json']);
  const server=http.createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/seed.json')return json(seed);
    if(req.url==='/bootstrap')return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Isolated storage fixture</title>');
    if(req.url.startsWith('/api/')){requests.push(req.url);return res.writeHead(500).end('No classification calls are permitted in this test.');}
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    if(!assets.has(name))return res.writeHead(404).end();
    try{res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));}
    catch(error){res.writeHead(500).end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-storage-browser-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let chromeError='';chrome.stderr.on('data',data=>chromeError=(chromeError+data).slice(-2000));
  try{
    let port;for(let i=0;i<600;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,'Chrome debugging port unavailable; exit='+chrome.exitCode+' '+chromeError);
    async function attach(debuggerUrl){
      const socket=new WebSocket(debuggerUrl);sockets.push(socket);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));let next=0;const pending=new Map();
      const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
      socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Page.javascriptDialogOpening'&&message.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>errors.push(error.message));if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);}}});
      const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
      const wait=async expression=>{for(let i=0;i<600;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}throw Error('Timed out: '+expression+' '+JSON.stringify(errors));};
      await call('Runtime.enable');await call('Page.enable');return {call,evaluate,wait,click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)};
    }
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json()),tab=await attach(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await tab.call('Page.navigate',{url:base+'/bootstrap'});await tab.wait('location.pathname==="/bootstrap" && document.readyState==="complete"');
    const quota=await tab.evaluate(`(async()=>{
      const seed=await fetch('/seed.json').then(response=>response.json());
      localStorage.setItem('norte.memory-library.v2',JSON.stringify(seed.library));
      localStorage.setItem('norte.meeting-memory.v2',JSON.stringify(seed.checkpoint));
      localStorage.setItem('unrelated-user-data','preserve-me');localStorage.setItem('norte.memory-library.v1','legacy-window-preserved');
      let size=0,name='';for(;;){try{localStorage.setItem('opaque.quota-filler','x'.repeat(size+65536));size+=65536;}catch(error){name=error.name;break;}}
      let originalSaveFailure='';try{localStorage.setItem('norte.memory-library.v2',JSON.stringify(seed.library)+' '.repeat(65536));}catch(error){originalSaveFailure=error.name;}
      return {size,name,originalSaveFailure};
    })()`);
    assert.equal(quota.name,'QuotaExceededError');assert.equal(quota.originalSaveFailure,'QuotaExceededError');assert.ok(quota.size>4*1024*1024);
    await tab.call('Page.navigate',{url:base+'/?profile=memory-v2#memoria'});await tab.wait('window.NorteMemoryPage && window.NorteMemoryStorage && NorteClassifier.isAvailable()');
    let state=await tab.evaluate('NorteMemoryPage.snapshot()');assert.equal(state.library.tests.length,1);assert.equal(state.library.tests[0].batch.batch_id,'LEGACY-SAVED');assert.equal(state.run.batch.batch_id,'LEGACY-UNSAVED');assert.equal(state.run.records[0].status,'done');
    const preserved=()=>tab.evaluate(`({opaque:localStorage.getItem('opaque.quota-filler')?.length,unrelated:localStorage.getItem('unrelated-user-data'),v1:localStorage.getItem('norte.memory-library.v1')})`);
    assert.deepEqual(await preserved(),{opaque:quota.size,unrelated:'preserve-me',v1:'legacy-window-preserved'});
    await tab.evaluate('(async()=>{window.testStore=await NorteMemoryStorage.open();})()');
    assert.equal(await tab.evaluate(`(async()=>JSON.parse(await testStore.read('norte.memory-library.v2')).tests[0].batch.batch_id)()`),'LEGACY-SAVED');
    const safety=await tab.evaluate(`(async()=>{
      const key='storage-test.atomic';await testStore.write(key,'original');let mutationError='';
      try{await testStore.change(key,()=>{throw Error('cancel this edit');});}catch(error){mutationError=error.message;}
      const afterAbort=await testStore.read(key),conflict=await testStore.compareAndSwap(key,'stale','overwrite'),afterConflict=await testStore.read(key);
      const changed=await testStore.compareAndSwap(key,'original','committed'),afterCommit=await testStore.read(key);
      localStorage.setItem('storage-test.invalid','{ invalid');let migrationFailed=false;
      try{await testStore.migrate('storage-test.invalid',localStorage,JSON.parse);}catch(error){migrationFailed=error instanceof SyntaxError;}
      return {mutationError,afterAbort,conflict,afterConflict,changed,afterCommit,migrationFailed,invalidLegacy:localStorage.getItem('storage-test.invalid'),invalidDB:await testStore.read('storage-test.invalid')};
    })()`);
    assert.deepEqual(safety,{mutationError:'cancel this edit',afterAbort:'original',conflict:false,afterConflict:'original',changed:true,afterCommit:'committed',migrationFailed:true,invalidLegacy:'{ invalid',invalidDB:null});
    // Change the legacy bytes at the commit notification, before migration can
    // remove them. Both versions must remain available and migration must fail.
    const migrationRace=await tab.evaluate(`(async()=>{
      const key='storage-test.changed-during-migration';localStorage.setItem(key,'{"version":1}');
      const unsubscribe=testStore.subscribe(changed=>{if(changed===key)localStorage.setItem(key,'{"version":2}');});
      let error='';try{await testStore.migrate(key,localStorage,JSON.parse);}catch(cause){error=cause.message;}finally{unsubscribe();}
      return {error,legacy:localStorage.getItem(key),database:await testStore.read(key)};
    })()`);
    assert.match(migrationRace.error,/mudou durante a migração/);assert.equal(migrationRace.legacy,'{"version":2}');assert.equal(migrationRace.database,'{"version":1}');
    await tab.click('#mfPaste');await tab.evaluate(`document.querySelector('#mfBatchJSON').value=${JSON.stringify(JSON.stringify(makeBatch('AFTER-QUOTA')))}`);await tab.click('#mfLoad');await tab.wait('document.querySelector("#mfConfirmDialog").open');
    // Keep a real competing IDB transaction alive until the UI has entered its
    // save lock; this makes the pending-save assertion independent of timing.
    await tab.evaluate(`(async()=>{
      const database=await new Promise((resolve,reject)=>{const request=indexedDB.open('norte-memory',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const transaction=database.transaction('records','readwrite'),records=transaction.objectStore('records');let keepAlive=true;
      window.releaseStorageLock=()=>{keepAlive=false;};window.storageLockHeld=true;
      transaction.oncomplete=()=>{database.close();window.storageLockHeld=false;};
      const pump=()=>{records.get('storage-test.lock').onsuccess=()=>{if(keepAlive)pump();};};pump();
    })()`);
    await tab.click('[data-mf-confirm="save"]');await tab.wait('document.querySelector("#mfQuestionJSON").readOnly');
    assert.equal(await tab.evaluate('document.querySelector("#mfSaveQuestions").disabled'),true);
    assert.equal(await tab.evaluate('document.querySelector("#mfRestoreQuestions").disabled'),true);
    assert.equal(await tab.evaluate('NorteMemoryPage.snapshot().library.tests.length'),1,'a queued save is not represented as a committed test');
    await tab.evaluate('releaseStorageLock()');await tab.wait('!document.querySelector("#mfInputDialog").open && !document.querySelector("#mfQuestionJSON").readOnly');
    state=await tab.evaluate('NorteMemoryPage.snapshot()');assert.equal(state.batch.batch_id,'AFTER-QUOTA');assert.equal(state.library.tests.length,2);assert.deepEqual(state.library.tests.map(t=>t.id),['T001','T002']);assert.equal(state.library.tests[1].run.records[0].status,'done');assert.equal(state.library.tests[1].run.records[0].typeOutput.response.model,'local-storage-fixture');assert.equal(state.run,null);
    assert.equal(await tab.evaluate(`(async()=>JSON.parse(await testStore.read('norte.memory-library.v2')).tests[1].batch.batch_id)()`),'LEGACY-UNSAVED');
    assert.doesNotMatch(await tab.evaluate('document.querySelector("#mfInputError").textContent'),/quota|setItem/i);
    // A real valid history larger than localStorage can hold, without truncation.
    const large=await tab.evaluate(`testStore.change('norte.memory-library.v2',raw=>{
      const history=NorteMemoryFlow.validateLibrary(JSON.parse(raw));
      for(let i=0;i<17;i++){
        const batch={batch_id:'LARGE-'+i,cases:Array.from({length:80},(_,n)=>({id:'L'+n,current_utterance:'Engineering note '+i+'/'+n+' '+('x'.repeat(4900)),expected_store_memory:true,expected_event_type:'observation'}))};
        NorteMemoryFlow.saveTest(history,batch,NorteMemoryV2.questions);
      }
      const value=JSON.stringify(history);return {value,result:{bytes:value.length,tests:history.tests.length,last:history.tests.at(-1).id}};
    })`);
    assert.ok(large.bytes>6*1024*1024);assert.equal(large.tests,19);assert.equal(large.last,'T019');
    await tab.evaluate('(async()=>{await NorteMemoryPage.flushStorage();window.beforeReload=true;})()');await tab.call('Page.reload');await tab.wait('!window.beforeReload && window.NorteMemoryPage');
    state=await tab.evaluate('NorteMemoryPage.snapshot()');assert.equal(state.batch.batch_id,'AFTER-QUOTA');assert.equal(state.library.tests.length,19);assert.equal(state.library.tests[0].run.records[0].typeOutput.response.model,'local-storage-fixture');assert.equal(state.library.tests.at(-1).batch.cases.at(-1).current_utterance,'Engineering note 16/79 '+'x'.repeat(4900));
    assert.deepEqual(await preserved(),{opaque:quota.size,unrelated:'preserve-me',v1:'legacy-window-preserved'});
    // Two actual browser documents commit concurrent edits; IDs cannot collide.
    const secondTarget=await fetch('http://127.0.0.1:'+port+'/json/new?'+encodeURIComponent(base+'/bootstrap'),{method:'PUT'}).then(response=>response.json()),second=await attach(secondTarget.webSocketDebuggerUrl);
    await second.wait('location.pathname==="/bootstrap" && document.readyState==="complete"');
    await second.evaluate(`(async()=>{for(const src of ['/experiments.js','/relation-worker.js','/memory-flow.js','/memory-v2.js','/typed-relations.js','/memory-storage.js'])await import(src);window.testStore=await NorteMemoryStorage.open();})()`);
    await tab.evaluate('(async()=>{window.testStore=await NorteMemoryStorage.open();})()');
    const append=id=>`testStore.change('norte.memory-library.v2',raw=>{const history=NorteMemoryFlow.validateLibrary(JSON.parse(raw));const saved=NorteMemoryFlow.saveTest(history,${JSON.stringify(makeBatch(id))},NorteMemoryV2.questions);return {value:JSON.stringify(history),result:saved.id};})`;
    const ids=await Promise.all([tab.evaluate(append('CONCURRENT-A')),second.evaluate(append('CONCURRENT-B'))]);assert.deepEqual(ids.sort(),['T020','T021']);
    const final=await second.evaluate(`(()=>testStore.read('norte.memory-library.v2').then(raw=>{const history=NorteMemoryFlow.validateLibrary(JSON.parse(raw));return {ids:history.tests.slice(-2).map(t=>t.id),batches:history.tests.slice(-2).map(t=>t.batch.batch_id),next:history.nextTestNumber,count:history.tests.length};}))()`);
    assert.deepEqual(final.ids,['T020','T021']);assert.deepEqual(final.batches.sort(),['CONCURRENT-A','CONCURRENT-B']);assert.equal(final.next,22);assert.equal(final.count,21);
    // An open saved run remains an editable draft if another tab deletes its
    // historical entry. Both documents use the actual page UI for this path.
    await tab.click('#mfHistoryToggle');await tab.click('[data-saved-test="T002"]');await tab.wait('document.querySelector("#mfConfirmDialog").open');await tab.click('[data-mf-confirm="discard"]');await tab.wait('NorteMemoryPage.snapshot().savedId==="T002"');
    await tab.evaluate('(async()=>{await NorteMemoryPage.flushStorage();window.beforeReload=true;})()');await tab.call('Page.reload');await tab.wait('!window.beforeReload && window.NorteMemoryPage');
    assert.equal(await tab.evaluate('NorteMemoryPage.snapshot().savedId'),'T002');const openedRun=await tab.evaluate('NorteMemoryPage.snapshot().run');
    await second.call('Page.navigate',{url:base+'/?profile=memory-v2#memoria'});await second.wait('window.NorteMemoryPage && NorteMemoryPage.snapshot().savedId==="T002"');
    await second.click('#mfHistoryToggle');await second.click('[data-delete-test="T002"]');await second.wait('document.querySelector("#mfConfirmDialog").open');await second.click('[data-mf-confirm="discard"]');
    await second.wait('!NorteMemoryPage.snapshot().library.tests.some(test=>test.id==="T002")');await tab.wait('NorteMemoryPage.snapshot().savedId===null && !NorteMemoryPage.snapshot().library.tests.some(test=>test.id==="T002")');
    assert.deepEqual(await tab.evaluate('NorteMemoryPage.snapshot().run'),openedRun,'cross-tab deletion must preserve the open run and its evidence');
    assert.equal(await tab.evaluate('document.querySelector("#mfSaveTest").disabled'),false,'the surviving draft can be saved again');
    await tab.click('#mfSaveTest');await tab.wait('NorteMemoryPage.snapshot().savedId==="T022"');
    assert.equal(await tab.evaluate('NorteMemoryPage.snapshot().library.tests.at(-1).run.records[0].typeOutput.response.model'),'local-storage-fixture');
    assert.deepEqual(requests,[],'migration, reload, and history edits never call paid APIs');assert.deepEqual(errors,[]);
    console.log('PASS: real Chrome localStorage quota, non-destructive and racing legacy migrations, save-before-new-input with editor lock, >6 MiB history after reload, unrelated/V1 data preserved, concurrent tab commits with unique IDs, cross-tab deletion preserves the open run as a draft, and no AI calls.');
  }finally{
    for(const socket of sockets)socket.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
