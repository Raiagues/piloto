// Isolated browser + fake primary/secondary API; never calls a paid model.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const {requested:previousInput,scenario,threadOutput,chunkOutput,response,clone}=require('./fixtures/thread-scenarios.cjs');
const expandedExpectations=process.argv.includes('--archive-results');
const requested=expandedExpectations?require('./fixtures/memory-b001-thread-results.json'):previousInput;
const continuity=require('./fixtures/memory-b001-continuity.json');
const F=require('../memory-flow.js'),T=require('../relation-worker.js').threads,legacy=require('./fixtures/memory-relations-v1.json');
(async()=>{
  const root=path.resolve(__dirname,'..'),sent=[],secondary=[],errors=[];let release,activeBatch=requested,primaryActive=0,secondaryActive=0,overlap=false;
  const assets=['index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json'];
  const server=http.createServer(async(req,res)=>{
    const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json({provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/api/classify' || req.url==='/api/relations'){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw),isThread=req.url==='/api/relations';
      if(isThread){secondary.push(body);secondaryActive++;if(primaryActive)overlap=true;if(secondary.length===1)await new Promise(r=>release=r);else await sleep(25);secondaryActive--;
        const id=body.state.current_event.chunk_id;
        if(activeBatch===continuity)return json(response(body,{belongs_to_active_thread:id==='C12'?'uncertain':'belongs'},id==='C12'?.86:.94));
        if(['low_negative','low_archive'].includes(id))return json(response(body,Object.fromEntries(Object.keys(body.questions).map(key=>[key,'does_not_belong'])),id==='low_negative'||body.state.candidate_threads?.7:.94));
        const output=threadOutput(body);if(id==='sensor_cause' && body.state.active_thread){const a=output.response.answers.belongs_to_active_thread;for(const key of Object.keys(a.probabilities))a.probabilities[key]=key===a.choice?.7:.15;}return json(output);}
      sent.push(body);primaryActive++;if(secondaryActive)overlap=true;await sleep(15);primaryActive--;return json(chunkOutput(body,activeBatch));
    }
    const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);
    if(!assets.includes(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-threads-browser-')),downloads=await fs.mkdtemp(path.join(os.tmpdir(),'norte-threads-downloads-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket,chromeError='';chrome.stderr.on('data',data=>{chromeError=(chromeError+data).slice(-2000);});
  try {
    let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(75);}}assert.ok(port,chromeError);
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Page.javascriptDialogOpening'&&m.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(e=>errors.push(e.message));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<350;i++){if(await evaluate(expression))return;await sleep(30);}throw Error('Timed out: '+expression+' '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const field=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const snapshot=()=>evaluate('NorteMemoryPage.snapshot()');
    const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-threads-'+name+'.png',Buffer.from(s.data,'base64'));};
    const load=async batch=>{activeBatch=batch;await click('#mfPaste');await field('#mfBatchJSON',JSON.stringify(batch,null,2));await click('#mfLoad');await wait('!document.querySelector("#mfInputDialog").open');};
    const exportFile=async (format,id)=>{
      if(!id){if(!(await snapshot()).savedId)await click('#mfSaveTest');id=(await snapshot()).savedId;}
      const before=new Set(await fs.readdir(downloads));await click('[data-export-test="'+id+'"][data-mf-export="'+format+'"]');
      for(let i=0;i<100;i++){const name=(await fs.readdir(downloads)).find(n=>!before.has(n)&&n.endsWith('.'+format));if(name)return fs.readFile(path.join(downloads,name),'utf8');await sleep(30);}throw Error('Missing download');
    };
    await call('Runtime.enable');await call('Page.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
    await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#memoria'});
    await wait('window.NorteMemoryPage && NorteClassifier.isAvailable() && document.body.dataset.page==="memory"');
    assert.equal(await evaluate('document.querySelector("#mfNodeHasRelation").offsetHeight'),0);
    await load(requested);assert.deepEqual((await snapshot()).batch,requested,'exact detailed gabarito preserved');
    await click('#mfQuestions');await click('#mfRelationQuestions');
    const custom=clone(T.defaults.questions);custom.belongs_to_active_thread.instructions+=' Fixture edit, preserve recent context.';
    await field('#mfQuestionJSON',JSON.stringify({belongs_to_active_thread:custom.belongs_to_active_thread},null,2));await click('#mfSaveQuestions');
    await wait('document.querySelector("#mfQuestionStatus").textContent.includes("salva")');
    assert.equal((await snapshot()).threadVersion,'TQ001');assert.equal((await snapshot()).library.tests.length,0);
    await click('#mfQuestionsDialog [data-mf-close]');await click('#mfBurstToggle');await click('#mfRun');
    await wait('NorteMemoryPage.snapshot().run?.status==="done"');
    let state=await snapshot();assert.equal(state.run.calls,26);assert.equal(state.meeting_events.length,11);assert.equal(state.run.thread_worker.status,'running');assert.equal(state.meeting_threads.length,1);
    assert.equal(state.raw_window.length,15);assert.equal(secondary.length,1);assert.ok(overlap,'secondary cannot stall primary processing');
    release();await wait('!NorteMemoryPage.isRunning()');state=await snapshot();
    assert.equal(state.meeting_threads.length,2);assert.equal(state.run.thread_worker.calls,11);assert.equal(state.library.tests.length,0,'tests never autosave');
    assert.ok(secondary.every(req=>Object.keys(req.questions).every(id=>id.startsWith('belongs_to_'))));
    assert.ok(secondary.filter(req=>req.questions.belongs_to_active_thread).every(req=>req.questions.belongs_to_active_thread.instructions===custom.belongs_to_active_thread.instructions));
    assert.equal(state.run.relation_worker,undefined);assert.ok(!JSON.stringify(state.meeting_events).includes('confidence'));
    assert.ok(state.meeting_events.every(e=>e.thread_assignment_state==='assigned'));assert.equal(state.run.thread_worker.schemaVersion,4);
    assert.deepEqual(state.meeting_threads[0].anchor_event_ids,['E001','E002','E003','E004','E005','E006','E007','E009','E010','E011']);
    if(expandedExpectations) {
      await click('#mfChunks [data-chunk="C03"]');
      assert.equal(await evaluate('document.querySelector("[data-thread-question=expected_action] .mf-answer-verdict").dataset.tone'),'pass','keep_active_thread is not a false mismatch');
      assert.ok(await evaluate('document.querySelector("[data-thread-question=expected_action]").textContent.includes("keep_active_thread")'));
      await click('#mfChunks [data-chunk="C12"]');
      assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-thread-question=expected_archive_results] .mf-answer-value")].map(n=>n.textContent)'),['{}','{}']);
      assert.equal(await evaluate('document.querySelector("[data-thread-question=expected_archive_results] .mf-answer-verdict").dataset.tone'),'pass');
    }
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#mfMemoryThreads [data-thread-group=archived] [data-thread]")].map(n=>n.dataset.thread)'),['T002']);
    await click('#mfChunks [data-chunk="C13"]');
    await wait('document.querySelector("#mfThreadDetails")?.textContent.includes("reactivate_thread")');
    assert.equal(await evaluate('document.querySelectorAll("#mfThreadDetails [data-thread-question]").length'),7);
    assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'pass');
    await click('#mfChunks [data-chunk="C03"]');
    assert.equal(T.audit(state.run,state.run.thread_worker.jobs.find(job=>job.chunk_id==='C03')).action,'keep_active_thread');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-thread-question=expected_action] .mf-answer-value")].map(n=>n.textContent)'),
      Object.hasOwn(requested.expected_threads.C03,'expected_action')?['keep_active_thread','keep_active_thread']:[],
      'the inspector compares expected_action only when supplied, without inventing a missing label');
    assert.equal(await evaluate('document.querySelector("#mfThreadDetails").textContent.includes("equivalentes")'),false);
    await click('#mfChunks [data-chunk="C13"]');
    if(expandedExpectations) {
      assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-thread-question=expected_active_thread_id] .mf-answer-value")].map(n=>n.textContent)'),['T002','T002']);
      assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-thread-question=expected_archive_results] .mf-answer-value")].map(n=>JSON.parse(n.textContent))'),[{T001:'belongs'},{T001:'belongs'}]);
    }
    await click('[data-thread-question="belongs_to_archive_thread__T001"] summary');
    assert.equal(await evaluate('document.querySelectorAll("[data-thread-question=belongs_to_archive_thread__T001] .mf-probability-ring").length'),3);
    assert.equal(await evaluate('document.querySelector("[data-thread-question=belongs_to_archive_thread__T001] .mf-answer-confidence").textContent'),'Confiança 94.0%');
    await click('[data-stream-collapse="stream:meeting_threads"]');await click('#mfThreads [data-thread="T001"] summary');
    assert.equal(await evaluate('document.querySelectorAll("#mfThreads [data-thread=T001] [data-thread-event]").length'),10);
    await click('#mfThreads [data-thread-event="E009"]');assert.equal((await snapshot()).selected,'C13');
    assert.equal(await evaluate('document.querySelectorAll("#mfThreads [data-tone=pass]").length'),2,'only the selected thread and event are highlighted');
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_decision][data-tone=pass]").length'),1);
    assert.equal(await evaluate('[...document.querySelectorAll("#mfEdges path[data-connection]")].some(n=>n.dataset.connection.startsWith("relation_"))'),false);
    await click('#mfChunks [data-chunk="C02"]');await sleep(50);
    assert.equal(await evaluate('document.querySelector("#mfNodeRelationEvents").dataset.routeTone'),'');
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection^=thread_][data-tone=pass]").length'),0,'an ignored chunk must not retain the previous event path');
    await click('#mfChunks [data-chunk="C13"]');
    await shot('expanded');
    await click('.mf-panel-tools [data-panel-toggle="inspectorHidden"]');await click('.mf-panel-tools [data-panel-toggle="memoriesHidden"]');await click('#mfFit');await sleep(120);await shot('canvas');
    // Persistent queue height and collapsed state.
    await evaluate('(()=>{const h=document.querySelector("#mfNodeThreads [data-queue-resize]");h.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}));})()');
    const height=await evaluate('document.querySelector("#mfNodeThreads").style.height');
    await click('#mfSaveTest');state=await snapshot();assert.equal(state.library.tests.length,1);assert.equal(state.savedId,'T001');
    const report=JSON.parse(await exportFile('json'));assert.equal(report.thread_question_version,'TQ001');assert.equal(report.thread_assignments.length,11);assert.equal(report.thread_assignments.find(j=>j.chunk_id==='C13').checks.length,5);
    assert.deepEqual(report.input,requested);assert.ok(report.thread_assignments.every(a=>a.matches===true));
    assert.equal(report.configuration.thread_assignment_threshold,.8);
    assert.ok(secondary.every(req=>!JSON.stringify(req).includes('expected_')));
    const csv=await exportFile('csv');assert.ok(csv.includes('thread_assignment'));assert.ok(csv.includes('belongs_to_archive_thread__T001'));
    await evaluate('window.beforeThreadsReload=true');await call('Page.reload');
    await wait('!window.beforeThreadsReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    state=await snapshot();assert.equal(state.savedId,'T001');assert.deepEqual(state.batch,requested);assert.deepEqual(state.meeting_threads,report.execution.meeting_threads);assert.equal(await evaluate('document.querySelector("#mfNodeThreads").style.height'),height);
    const sentBefore=sent.length+secondary.length;await sleep(120);assert.equal(sent.length+secondary.length,sentBefore,'reload cannot resume calls');
    // A different input with duplicate utterance text and batched archive questions.
    const divergent=clone(scenario);divergent.expected_threads.test_sensor={expected_thread_id:'T001',expected_active_result:'does_not_belong'};
    divergent.expected_threads.sensor_cause={expected_active_result:'belongs',expected_thread_id:null,expected_action:'assignment_pending'};
    for(const id of ['low_negative','low_archive']) {
      divergent.cases.push({id,current_utterance:'Input '+id,expected_store_memory:true,expected_event_type:'observation'});
      divergent.expected_threads[id]={expected_active_result:'does_not_belong',expected_action:'assignment_pending',expected_thread_id:null};
    }
    await load(divergent);await click('#mfRun');await wait('!NorteMemoryPage.isRunning() && NorteMemoryPage.snapshot().run?.thread_worker.status==="done"');
    state=await snapshot();assert.equal(state.meeting_threads.length,3);assert.equal(state.meeting_events.find(e=>e.chunk_id==='test_sensor').thread_id,'T002');
    assert.equal(await evaluate('document.querySelector("#mfThreadPendingCount").textContent'),'6');
    await click('#mfChunks [data-chunk="test_sensor"]');assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'fail');
    await click('#mfChunks [data-chunk="sensor_cause"]');assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'warning');
    assert.equal(await evaluate('document.querySelector("#mfThreadDetails").dataset.assignmentState'),'pending');
    assert.equal(state.meeting_events.find(e=>e.chunk_id==='sensor_cause').thread_id,null);
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_decision][data-tone=warning]").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_belongs][data-tone=warning]").length'),0);
    await click('#mfChunks [data-chunk="low_negative"]');
    assert.ok(await evaluate('document.querySelector("#mfThreadDetails").textContent.includes("Arquivada: confiança < 80%")'));
    assert.equal(await evaluate('document.querySelector("#mfThreadArchiveCount").textContent'),'2');
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_archive][data-tone=warning]").length'),0);
    assert.equal(secondary.filter(req=>req.state.current_event.chunk_id==='low_negative').length,2);
    await click('#mfChunks [data-chunk="low_archive"]');
    assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'warning');
    assert.ok(await evaluate('document.querySelector("#mfThreadDetails").textContent.includes("Arquivada: confiança < 80%")'));
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_save][data-tone=warning]").length'),1);
    assert.equal(await evaluate('document.querySelectorAll("#mfEdges [data-connection=thread_archive_assign][data-tone=warning]").length'),0);
    const pendingReport=JSON.parse(await exportFile('json'));assert.equal(pendingReport.summary.pending_assignments,6);assert.equal(pendingReport.thread_assignments.find(a=>a.chunk_id==='low_archive').reason,'low_confidence_archive');
    assert.equal(pendingReport.execution.meeting_events.find(e=>e.chunk_id==='low_negative').thread_assignment_state,'pending');
    await shot('pending');
    await click('#mfChunks [data-chunk="ambiguous"]');assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'pass');
    await click('#mfSaveTest');await click('#mfHistoryToggle');await click('#mfTestRows [data-saved-test="T001"] td:nth-child(4)');await wait('NorteMemoryPage.snapshot().savedId==="T001"');
    assert.equal((await snapshot()).batch.batch_id,'B001');
    await shot('history');
    // New state contract: upgrade an unchanged built-in prompt on rerun, while
    // retaining the old saved version. Inspect the actual HTTP payload in-page.
    await load(continuity);
    await click('#mfQuestions');await click('#mfRelationQuestions');
    const oldConfig={questions:{...clone(T.defaults.questions),belongs_to_active_thread:require('./fixtures/thread-continuity-previous-questions.json')[1]}};
    await field('#mfQuestionJSON',JSON.stringify(oldConfig,null,2));await click('#mfSaveQuestions');
    await wait('document.querySelector("#mfQuestionStatus").textContent.includes("salva")');
    await click('#mfQuestionsDialog [data-mf-close]');
    const requestOffset=secondary.length;
    await click('#mfRun');await wait('!NorteMemoryPage.isRunning() && NorteMemoryPage.snapshot().run?.thread_worker.status==="done"');
    state=await snapshot();assert.equal(state.meeting_threads.length,1);
    const c12=state.run.thread_worker.jobs.find(job=>job.chunk_id==='C12');
    assert.equal(c12.result.reason,'uncertain_active');assert.equal(c12.result.thread_id,null);
    assert.equal(c12.parts.length,1);assert.equal(secondary.length-requestOffset,10);
    const sentC12=secondary.slice(requestOffset).find(req=>req.state.current_event.chunk_id==='C12');
    assert.deepEqual(sentC12.questions.belongs_to_active_thread,T.defaults.questions.belongs_to_active_thread);
    assert.deepEqual(sentC12.state.recent_context.map(c=>c.chunk_id),['C07','C08','C09','C10','C11']);
    assert.deepEqual(sentC12.state.recent_context,state.raw_window.filter(c=>['C07','C08','C09','C10','C11'].includes(c.chunk_id)));
    assert.equal(sentC12.state.active_thread.events.length,7);
    assert.ok(sentC12.state.active_thread.events.every(event=>event.chunk.text===event.text && event.status && event.timestamp));
    await click('#mfChunks [data-chunk="C12"]');
    assert.deepEqual(await evaluate('JSON.parse(document.querySelector("[data-thread-request=belongs_to_active_thread] pre").textContent)'),sentC12);
    assert.equal(await evaluate('document.querySelector("#mfThreadDetails .mf-thread-route").dataset.tone'),'pass');
    for(const id of ['mfNodeThreadContext','mfNodeThreads']) {
      if(await evaluate(`document.querySelector('#${id} [data-stream-collapse]').getAttribute('aria-expanded')==='false'`))await click('#'+id+' [data-stream-collapse]');
    }
    await click('#mfFit');await sleep(120);
    assert.ok(await evaluate(`[...document.querySelectorAll('#mfEdges path[data-connection^="thread_"]')].every(path=>/C/.test(path.getAttribute('d')) && !/[HV]/.test(path.getAttribute('d')))`),'thread connections use fluid curves, without bypass branches');
    assert.ok(await evaluate(`(()=>{
      const ids=['mfNodeRelationEvents','mfNodeThreadContext','mfNodeThreadActive','mfNodeThreadAssignment','mfNodeThreads'];
      const centers=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top+r.height/2;});
      return Math.max(...centers)-Math.min(...centers)<1;
    })()`),'main thread stages share a horizontal centerline');
    assert.ok(await evaluate(`['mfNodeThreadArchive','mfNodeThreadPending'].every(id=>document.getElementById('mfNodeThreads').contains(document.getElementById(id)))`),'archives and pending belong inside meeting_threads');
    assert.ok(await evaluate(`(()=>{
      const nodes=[...document.querySelectorAll('.mf-thread-node,#mfNodeRelationEvents')].filter(n=>!n.hidden);
      return nodes.every((a,i)=>nodes.slice(i+1).every(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.right<=y.left || y.right<=x.left || x.bottom<=y.top || y.bottom<=x.top;}));
    })()`),'expanded state, archive and thread lists do not overlap');
    // Copy controls serialize the request actually seen by the server, not a reconstruction.
    await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedJSON=text;}}})`);
    for(const [selector,expected] of [
      ['[data-thread-request=belongs_to_active_thread] [data-copy=json]',sentC12],
      ['[data-thread-request=belongs_to_active_thread] [data-copy=state]',sentC12.state],
      ['[data-thread-request=belongs_to_active_thread] [data-copy=questions]',sentC12.questions],
      ['#mfThreadDetails [data-copy=output]',c12.parts[0].output.response],
      ['#mfThreadContext [data-copy=state]',sentC12.state],
      ['#mfThreadContext [data-copy=request]',sentC12]
    ]){await click(selector);assert.deepEqual(await evaluate('JSON.parse(window.copiedJSON)'),expected);}
    // Clipboard fallback also copies the exact payload when the browser API is denied.
    await evaluate(`navigator.clipboard.writeText=async()=>{throw Error('denied')};window.originalExecCommand=document.execCommand;document.execCommand=()=>{window.copiedJSON=document.activeElement.value;return true;}`);
    await click('[data-thread-request=belongs_to_active_thread] [data-copy=json]');
    assert.deepEqual(await evaluate('JSON.parse(window.copiedJSON)'),sentC12);
    assert.equal(await evaluate('document.querySelectorAll(".mf-copy-buffer").length'),0);
    await evaluate('document.execCommand=window.originalExecCommand;navigator.clipboard.writeText=async text=>{window.copiedJSON=text;}');
    await click('#mfPaste');await click('#mfInputDialog [data-copy=editor]');
    assert.deepEqual(await evaluate('JSON.parse(window.copiedJSON)'),continuity);await click('#mfInputDialog [data-mf-close]');
    await click('#mfQuestions');await click('#mfRelationQuestions');await click('#mfQuestionsDialog [data-copy=editor]');
    assert.equal(await evaluate('window.copiedJSON'),await evaluate('document.querySelector("#mfQuestionJSON").value'));await click('#mfQuestionsDialog [data-mf-close]');
    // The sidebar is a single indented tree; pending is not a fabricated thread.
    if(await evaluate('document.querySelector("#mfMemories").hidden'))await click('.mf-panel-tools [data-panel-toggle="memoriesHidden"]');
    for(const id of ['mfEventsToggle','mfThreadsToggle','mfRawToggle'])if(await evaluate(`document.getElementById('${id}').getAttribute('aria-expanded')==='false'`))await click('#'+id);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#mfMemoryThreads [data-thread-group=unassigned] [data-thread-event]")].map(n=>n.dataset.threadEvent)'),['E008']);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#mfMemoryThreads [data-thread]")].map(n=>n.dataset.thread)'),['T001']);
    assert.ok(await evaluate(`(()=>{
      const events=document.getElementById('mfEventsPanel').getBoundingClientRect(),threads=document.getElementById('mfThreadsPanel').getBoundingClientRect(),raw=document.getElementById('mfRawPanel').getBoundingClientRect();
      const first=document.querySelector('#mfMeetingEvents .mf-memory-item').getBoundingClientRect(),heading=document.getElementById('mfEventsToggle').getBoundingClientRect();
      return threads.top-events.bottom<16 && raw.top-threads.bottom<16 && first.left>heading.left+8;
    })()`),'collections follow their contents without empty panel space, with indented children');
    await click('#mfEventsToggle');await click('#mfThreadsToggle');await click('#mfRawToggle');
    assert.ok(await evaluate(`['mfMeetingEvents','mfMemoryThreads','mfRawWindow'].every(id=>document.getElementById(id).hidden)`));
    await click('#mfEventsToggle');await click('#mfThreadsToggle');
    await shot('continuity-c12');
    const frozenRun=JSON.stringify(state.run);
    for(const [width,height,dpr] of [[1366,768,1],[1024,768,1.25],[390,844,2]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:width<500});
      await click('#mfFit');await sleep(180);
      const sizes=await evaluate(`new Promise(resolve=>{const frames=[];function frame(){const s=document.querySelector('#mfScene').getBoundingClientRect();frames.push([s.width,s.height]);if(frames.length<20)requestAnimationFrame(frame);else resolve(frames);}frame();})`);
      assert.equal(new Set(sizes.map(r=>JSON.stringify(r))).size,1,'thread map settles at '+width);
      assert.ok(await evaluate(`(()=>{const c=document.querySelector('#mfCanvas').getBoundingClientRect(),s=document.querySelector('#mfScene').getBoundingClientRect();return s.left>=c.left-1 && s.right<=c.right+1 && s.top>=c.top-1 && s.bottom<=c.bottom+1;})()`),'expanded thread map fits at '+width);
      assert.equal(JSON.stringify((await snapshot()).run),frozenRun,'layout changes preserve results');
    }
    // Saved-row downloads and bulk deletion never substitute the currently open run.
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await click('#mfSaveTest');const savedBefore=await snapshot(),openBefore=JSON.stringify(savedBefore.run);
    assert.equal(savedBefore.savedId,'T003');
    assert.equal(await evaluate('document.querySelector("#mfExport")'),null);
    assert.equal(await evaluate('document.querySelector("#mfInputDialog details")'),null);
    await fs.rm(downloads,{recursive:true,force:true});await fs.mkdir(downloads);
    const oldDownload=JSON.parse(await exportFile('json','T001'));
    assert.equal(oldDownload.test_id,'T001');assert.deepEqual(oldDownload.input,requested);
    assert.equal((await snapshot()).savedId,'T003');assert.equal(JSON.stringify((await snapshot()).run),openBefore);
    await click('[data-select-test="T001"]');assert.equal((await snapshot()).savedId,'T003','checkbox does not open a different test');
    assert.equal(await evaluate('document.querySelector("#mfSelectAllTests").indeterminate'),true);
    await click('#mfSelectAllTests');assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),3);
    await click('#mfSelectAllTests');assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),0);
    await click('[data-select-test="T001"]');await click('[data-select-test="T003"]');
    await click('#mfDeleteSelectedTests');await wait('document.querySelector("#mfConfirmDialog").open');
    await click('[data-mf-confirm="cancel"]');assert.equal((await snapshot()).library.tests.length,3);
    await shot('history-actions');
    await click('#mfDeleteSelectedTests');await click('[data-mf-confirm="discard"]');await wait('NorteMemoryPage.snapshot().library.tests.length===1');
    const afterDelete=await snapshot();assert.deepEqual(afterDelete.library.tests.map(test=>test.id),['T002']);
    assert.equal(afterDelete.savedId,null);assert.equal(JSON.stringify(afterDelete.run),openBefore,'deleting the open saved test retains its draft');
    assert.deepEqual(afterDelete.library.versions,savedBefore.library.versions);assert.deepEqual(afterDelete.library.threadVersions,savedBefore.library.threadVersions);
    assert.equal(await evaluate('document.querySelector("#mfDeleteSelectedTests").disabled'),true);
    await click('#mfSaveTest');assert.equal((await snapshot()).savedId,'T004','deleted IDs are not reused');
    // Old relation snapshots remain readable, without rerunning their worker.
    const lib=F.emptyLibrary();F.saveTest(lib,legacy.batch,legacy.questions,F.restore(legacy));
    const legacySeed=await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('norte.memory-library.v1',${JSON.stringify(JSON.stringify(lib))});sessionStorage.removeItem('norte.memory-flow.v1');localStorage.removeItem('norte.meeting-memory.v1');`});
    await evaluate('window.beforeLegacyReload=true');
    await call('Page.reload');await wait('!window.beforeLegacyReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:legacySeed.identifier});
    if(!await evaluate('!document.querySelector("#mfHistory").hidden'))await click('#mfHistoryToggle');
    await click('#mfTestRows [data-saved-test="T001"] td:nth-child(3)');await wait('NorteMemoryPage.snapshot().run?.relation_worker');
    assert.ok(await evaluate('document.querySelector("#mfNodeHasRelation").offsetHeight>0'));
    assert.equal(await evaluate('document.querySelector("#mfNodeThreadActive").offsetHeight'),0);
    assert.deepEqual(errors,[]);console.log('PASS browser threads: detailed gabarito, independent queues, batched archives, inline answers, memories, snapshots, downloads, legacy history');
  } finally {
    release?.();if(socket)socket.close();
    const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');if(chrome.exitCode===null)await Promise.race([exited,sleep(3000)]);if(chrome.exitCode===null){chrome.kill('SIGKILL');await exited;}
    server.closeAllConnections();await new Promise(r=>server.close(r));
    await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});await fs.rm(downloads,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
