// UI/transport fixtures only. These responses are not evidence of AI accuracy.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
  const root=path.resolve(__dirname,'..'),requests=[],errors=[],assetsRead=[];
  const assets=new Set(['meeting-commands.js','meeting-session.js','meeting-evidence.js','meeting-state.js','meeting-review.js','meeting-hierarchy.js','meeting-amendments.js','meeting-document.js','gemini-minutes.js','gemini-minutes.css','meeting-room.js','meeting-room.css','meeting-canvas.js','meeting-canvas.css','index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','memory-storage.js','memory-v2.js','typed-relations.js','typed-relations-page.js','meeting-minutes.js','meeting-minutes.css','relation-map.js','relation-map.css','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json']);
  let typedWait=null,typedRelease=null,chunkWait=null,chunkRelease=null,chunkHeld=false,matchFailure=false;
  const server=http.createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(['/api/classify','/api/relations','/api/typed-relations'].includes(req.url)){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push({url:req.url,body});
      assert.equal(JSON.stringify(body).includes('expected_'),false);
      if(req.url==='/api/classify'&&chunkWait&&body.state.current_utterance==='The bracket drawing is B12.'){chunkHeld=true;await chunkWait;}
      if(req.url==='/api/typed-relations'&&typedWait)await typedWait;
      if(matchFailure&&Object.keys(body.questions).some(k=>k.startsWith('configuration_match__')))return res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Fixture: resposta match indisponível'}));
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
        if(q.type==='noul')return [id,{type:'noul',noul:.98}];
        let choice='belongs';const current=body.state.current_event,source=current?.event_id,target=id.split('__')[1];
        if(id==='event_type')choice=/Let's test/.test(JSON.stringify(body.state))?'test_proposal':/measured/.test(JSON.stringify(body.state))?'test_result':'observation';
        if(id.startsWith('relation_type__'))choice=source==='E003'&&target==='E002'?'result_of':'none';
        if(id.startsWith('configuration_match__'))choice='mismatch';
        const keys=Object.keys(q.criteria);assert.ok(keys.includes(choice),id+' '+choice);
        return [id,{type:'choice',choice,confidence:.2,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice?.96:.04/(keys.length-1)]))}];
      }));
      await sleep(5);return json({request:body,response:{model:'ui-fixture',answers},provider:'official',latencyMs:5});
    }
    const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
    assetsRead.push(name);
    if(!assets.has(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-typed-browser-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket,chromeError='';chrome.stderr.on('data',data=>{chromeError=(chromeError+data).slice(-2000);});
  try{
    let port;for(let i=0;i<600;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Page.javascriptDialogOpening'&&m.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(e=>errors.push(e.message));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<400;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}throw Error('Timed out: '+expression+' '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),snapshot=()=>evaluate('NorteMemoryPage.snapshot()');
    const flush=async()=>assert.equal(await evaluate('NorteMemoryPage.flushStorage()'),true,'the latest draft and memory checkpoint committed');
    const input={batch_id:'UI-TYPED',cases:[
      {id:'C01',current_utterance:'The bracket is deforming.',expected_store_memory:true,expected_event_type:'observation'},
      {id:'C02',current_utterance:"Let's test the bracket with a 3 mm wall.",expected_store_memory:true,expected_event_type:'test_proposal'},
      {id:'C03',current_utterance:'For the proposed bracket test, we measured a 4 mm wall instead; deformation was 2 mm.',expected_store_memory:true,expected_event_type:'test_result'},
      {id:'C04',current_utterance:'The bracket drawing is B12.',expected_store_memory:true,expected_event_type:'observation'}
    ],expected_threads:Object.fromEntries(['C01','C02','C03','C04'].map((id,i)=>[id,{expected_action:i?'keep_active_thread':'create_new_thread',expected_thread_id:'T001'}]))};
    await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?profile=memory-v2#memoria'});
    await wait('window.NorteMemoryPage && NorteClassifier.isAvailable() && document.body.dataset.page==="memory"');
    assert.equal(assetsRead.some(name=>name.startsWith('tests/fixtures/')),false,'opening the input never fetches fixture files');
    await wait('Array.from(document.querySelectorAll("link")).some(link=>link.href.includes("relation-map.css"))');
    assert.equal(assetsRead.includes('relation-map.js'),true,'V2 loads its relation map module');
    await click('#mfPaste');
    assert.equal(await evaluate('!!document.querySelector("#mfTypedExamples, #mfLoadExample, #mfLoadCurated, #mfLoadHoldout, #mfLoadB002Relations, #mfLoadNatural, #mfLoadB002Clarified")'),false,'the input dialog contains no example loader buttons');
    await click('#mfInputDialog [data-mf-close]');
    await click('#mfQuestions');await click('#mfTypedQuestions');
    assert.match(await evaluate('document.querySelector("#mfTypedArchitecture").textContent'),/um único par por chamada/);
    assert.equal(await evaluate('document.querySelector("#mfTypedQuestions").getAttribute("aria-pressed")'),'true');
    const config=JSON.parse(await evaluate('document.querySelector("#mfQuestionJSON").value'));
    assert.ok(config.questions.relation_type.criteria.none);assert.ok(config.questions.configuration_match.criteria.mismatch);
    const customConfig=structuredClone(config);customConfig.questions.relation_type.instructions+=' Local browser fixture custom wording.';
    await evaluate(`(()=>{const field=document.querySelector('#mfQuestionJSON');field.value=${JSON.stringify(JSON.stringify(customConfig))};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('#mfSaveQuestions');await wait('document.querySelector("#mfSaveQuestions").textContent==="Salvo"');assert.match(await evaluate('document.querySelector("#mfQuestionId").textContent'),/^TRQ/);
    assert.deepEqual((await snapshot()).typedRelationConfig,customConfig);
    await click('#mfRestoreQuestions');assert.deepEqual(JSON.parse(await evaluate('document.querySelector("#mfQuestionJSON").value')),config);
    assert.deepEqual((await snapshot()).typedRelationConfig,customConfig,'restoring defaults only edits a draft until Save version');
    await click('#mfSaveQuestions');await wait('document.querySelector("#mfSaveQuestions").textContent==="Salvo"');assert.equal((await snapshot()).library.typedRelationVersions.length,2);
    assert.deepEqual((await snapshot()).typedRelationConfig,config);
    await click('#mfQuestionsDialog [data-mf-close]');
    await click('#mfPaste');await evaluate(`document.querySelector('#mfBatchJSON').value=${JSON.stringify(JSON.stringify(input))}`);await click('#mfLoad');
    await wait('!document.querySelector("#mfInputDialog").open');assert.deepEqual((await snapshot()).batch,input,'copy/paste preserves the original input shape without relation labels');
    assert.equal(requests.length,0,'editing questions and applying input do not call inference');await click('#mfBurstToggle');
    chunkWait=new Promise(r=>chunkRelease=r);typedWait=new Promise(r=>typedRelease=r);
    await click('#mfRun');await wait('NorteMemoryPage.snapshot().run?.typed_relation_worker?.status==="running"');
    assert.equal(await evaluate('document.querySelector("#mfSaveTest").disabled'),true);
    assert.equal(await evaluate('document.querySelector("#mfMinutes").disabled'),true);
    assert.equal(await evaluate('NorteMemoryPage.isRunning()'),true);
    await wait('NorteMemoryPage.snapshot().run?.meeting_events.length===3 && NorteMemoryPage.snapshot().run?.records.find(record=>record.id==="C04")?.status==="running"');
    assert.equal(chunkHeld,true,'the final chunk is waiting for its deliberately gated response');
    typedRelease();typedWait=null;
    await wait('NorteMemoryPage.snapshot().meeting_relations.some(edge=>edge.source_event_id==="E003" && edge.target_event_id==="E002" && edge.configuration_match==="mismatch")');
    let streaming=await snapshot();
    assert.equal(streaming.run.status,'running');assert.equal(streaming.run.typed_relation_worker.status,'running');
    assert.equal(streaming.run.typed_relation_worker.schemaVersion,3);assert.equal(streaming.run.typed_relation_worker.input_closed,false);
    assert.equal(streaming.meeting_events.length,3,'no response to the fourth chunk has been supplied');
    assert.equal(await evaluate('document.querySelector("#mfMeetingRelationsCount").textContent'),'1','the new edge is rendered while later chunks are still running');
    assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify('#mfMeetingRelations [data-typed-pair="E003→E002"]')})`),true);
    assert.equal(await evaluate('NorteMemoryPage.isRunning()'),true);
    chunkRelease();chunkWait=null;
    await wait('!NorteMemoryPage.isRunning()');let state=await snapshot();
    assert.equal(state.run.typed_relation_worker.status,'done');assert.equal(state.run.typed_relation_worker.schemaVersion,3);assert.equal(state.run.typed_relation_worker.input_closed,true);assert.equal(state.meeting_relations.length,1);
    assert.equal(state.meeting_relations[0].relation_type,'result_of');assert.equal(state.meeting_relations[0].configuration_match,'mismatch');
    assert.equal(await evaluate('NorteTypedRelations.lifecycle(NorteMemoryPage.snapshot().run).E002.status'),'open');
    assert.equal(await evaluate('document.querySelector("#mfMeetingRelationsCount").textContent'),'1');
    assert.equal(await evaluate('document.querySelector("#mfTypedAuditCount").textContent'),'5');
    for(const edge of ['typed_candidates','typed_type','typed_match','typed_save','typed_none'])assert.equal(await evaluate(`!!document.querySelector('[data-connection="${edge}"][marker-end]')`),true);
    await click('#mfMeetingRelations [data-typed-pair="E003→E002"]');
    assert.match(await evaluate('document.querySelector("#mfTypedDetails").textContent'),/mismatch/);
    assert.match(await evaluate('document.querySelector("#mfTypedDetails").textContent'),/request enviado e resposta original/);
    const desktop=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-typed-relations-desktop.png',Buffer.from(desktop.data,'base64'));
    await click('.mf-panel-tools [data-panel-toggle="inspectorHidden"]');await click('.mf-panel-tools [data-panel-toggle="chunksHidden"]');
    for(const key of ['typed_pairs','meeting_relations','typed_audit'])await click(`[data-stream-collapse="stream:${key}"]`);
    await evaluate('document.querySelectorAll("#mfMeetingRelations details, #mfTypedPairs details, #mfMemoryRelations details, #mfTypedAudit details").forEach(d=>d.open=true)');await click('#mfFit');
    await evaluate(`(()=>{const canvas=document.querySelector('#mfCanvas'),rect=document.querySelector('#mfNodeTypedType').getBoundingClientRect();canvas.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,deltaY:-270}));})()`);await sleep(100);
    const graph=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-typed-relations-graph.png',Buffer.from(graph.data,'base64'));
    assert.equal(await evaluate('document.querySelector("#mfMinutes").disabled'),false);
    await click('#mfMinutes');assert.equal(await evaluate('!!document.querySelector("dialog[open]")'),true);
    await evaluate('document.querySelector("dialog[open]").close()');await click('#mfSaveTest');await wait('document.querySelector("#mfSaveTest").textContent==="Salvo"');state=await snapshot();
    assert.ok(state.library.tests[0].typedRelationVersion);assert.equal(state.library.typedRelationVersions.length,2);
    const savedBeforeRestore=structuredClone(state.library.tests),runBeforeRestore=structuredClone(state.run);
    await click('#mfQuestions');
    for(const [tab,definition] of [['mfChunkQuestions','NorteMemoryV2.questions'],['mfRelationQuestions','NorteMemoryV2.threadConfig'],['mfTypedQuestions','NorteTypedRelations.defaults']]) {
      await click('#'+tab);await evaluate(`(()=>{const field=document.querySelector('#mfQuestionJSON');field.value='{"unfinished":';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await click('#mfRestoreQuestions');assert.deepEqual(JSON.parse(await evaluate('document.querySelector("#mfQuestionJSON").value')),await evaluate(definition));
      assert.deepEqual((await snapshot()).library.tests,savedBeforeRestore);assert.deepEqual((await snapshot()).run,runBeforeRestore,'restoring a question draft never rewrites an executed run');
    }
    await click('#mfQuestionsDialog [data-mf-close]');
    const count=requests.length;await flush();await evaluate('window.beforeReload=true');await call('Page.reload');await wait('!window.beforeReload && window.NorteMemoryPage');
    assert.equal(requests.length,count);assert.equal((await snapshot()).meeting_relations[0].configuration_match,'mismatch');
    assert.deepEqual((await snapshot()).library.tests,savedBeforeRestore,'saved test snapshots survive IndexedDB reload unchanged');
    assert.equal((await snapshot()).library.typedRelationVersions.length,2,'both relation question versions remain available');
    assert.deepEqual((await snapshot()).typedRelationConfig,config);
    assert.deepEqual((await snapshot()).run.meeting_relations,runBeforeRestore.meeting_relations,'all retained edge evidence is restored');
    assert.deepEqual((await snapshot()).run.typed_relation_worker,runBeforeRestore.typed_relation_worker,'requests, responses, none judgments, probabilities and match errors remain auditable');
    // A failed match must remain visible; it cannot silently delete a real relation.
    matchFailure=true;await click('#mfRun');await wait('!NorteMemoryPage.isRunning() && NorteMemoryPage.snapshot().run?.typed_relation_worker?.calls>0');
    state=await snapshot();assert.equal(state.meeting_relations.length,1);assert.equal(state.meeting_relations[0].review_state,'needs_review');
    await click('#mfMeetingRelations [data-typed-pair="E003→E002"]');assert.match(await evaluate('document.querySelector("#mfTypedDetails").textContent'),/resposta match indisponível/);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate('document.querySelector(".mf-main").getBoundingClientRect().bottom<=document.querySelector("#mfMemories").getBoundingClientRect().top+1'),true,'mobile memories do not overlap inspector');
    assert.equal(await evaluate('document.querySelector("#mfMemories").getBoundingClientRect().bottom<=document.querySelector("#mfHistory").getBoundingClientRect().top+1'),true,'mobile history follows memory panels');
    await evaluate('document.querySelector("#memoryPage").scrollTop=0');await sleep(100);
    const mobile=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-typed-relations-mobile.png',Buffer.from(mobile.data,'base64'));
    await evaluate('document.querySelector("#mfRelationsPanel").scrollIntoView({block:"start"})');await sleep(100);
    const mobileRelations=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-typed-relations-mobile-relations.png',Buffer.from(mobileRelations.data,'base64'));
    assert.equal(assetsRead.some(name=>name.startsWith('tests/fixtures/')),false,'the application never fetches example fixtures');
    assert.equal(assetsRead.includes('relation-map.css'),true);
    assert.deepEqual(errors,[]);console.log('PASS: original JSON copy/paste without example buttons, relation questions/versioning, streaming relation edge before gated final chunk completes, conditional match, mismatch edge retained, lifecycle open, source grouping, arrow graph, raw responses, save/reload, match failure review, minutes entry and mobile layout. No AI accuracy claim.');
  }finally{typedRelease?.();chunkRelease?.();socket?.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
})().catch(error=>{console.error(error);process.exitCode=1;});
