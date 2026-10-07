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
    const pointerClick=async selector=>{
      const point=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,visible:n.contains(document.elementFromPoint(x,y))};})()`);
      assert.ok(point.visible,'unobstructed pointer target: '+selector);
      await call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
    };
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#manual'});
    await wait('window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="manual"');
    const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-editor-'+name+'.png',Buffer.from(shot.data,'base64'));};
    assert.equal(await evaluate('document.querySelector("#manualState").value'),'');
    assert.equal(await evaluate('document.querySelector("#questionEditor").value'),'');
    await click('#automatedMode');
    assert.equal(await evaluate('document.querySelectorAll("#autoOptions [role=tab]").length'),1);
    assert.equal(await evaluate('document.querySelector("#autoStateEditor").value'),'');
    await click('#useExample');
    await wait('document.body.dataset.page==="automated" && document.querySelectorAll("#autoOptions [data-select-option]").length===6');
    const originalBase=await evaluate('NorteLab.draft().text'),originalQuestions=await evaluate('NorteClassifier.getConfig()');
    const options=await evaluate('NorteLab.draft().automation.options'),key=options[0].id;
    assert.equal(await evaluate('document.querySelector("#automationNavigator").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#toggleTestVariants")'),null);
    assert.equal(await evaluate('document.querySelectorAll("#autoOptions [role=tab]").length'),7);
    await sleep(80);
    assert.equal(await evaluate('new Set([...document.querySelectorAll("#autoOptions .request-option")].map(n=>n.offsetTop)).size'),1,'tabs stay on one line');
    assert.ok(await evaluate('document.querySelector("#autoOptions").scrollWidth>document.querySelector("#autoOptions").clientWidth'));
    await evaluate('document.querySelector("#autoOptions").scrollLeft=0;document.querySelector("#autoOptions").dispatchEvent(new WheelEvent("wheel",{deltaY:170,bubbles:true,cancelable:true}))');
    assert.ok(await evaluate('document.querySelector("#autoOptions").scrollLeft>0'),'vertical wheel scrolls the tab rail sideways');
    await click('[data-select-option="'+options[5].id+'"]');
    await wait('(()=>{const a=document.querySelector("#autoOptions [aria-selected=true]").parentElement.getBoundingClientRect(),r=document.querySelector("#autoOptions").getBoundingClientRect();return a.left>=r.left-1 && a.right<=r.right+1})()');
    assert.ok(await evaluate('(()=>{const a=document.querySelector("#autoOptions [aria-selected=true]").parentElement.getBoundingClientRect(),r=document.querySelector("#autoOptions").getBoundingClientRect();return a.left>=r.left-1 && a.right<=r.right+1})()'),'selected tab revealed');
    await screenshot('tab-strip');
    await click('[data-select-option="'+key+'"]');
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),key);
    // Drop a real test tab onto State. The unrelated State/Questions layout stays tabbed.
    await evaluate('(()=>{const dt=new DataTransfer(),tab=document.querySelector("#autoOptions [aria-selected=true]");tab.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));document.querySelector("#automationSetup").dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));})()');
    assert.equal(await evaluate('NorteLab.draft().testView'),'stacked');
    assert.equal(await evaluate('document.querySelector("#inputPaneBody").dataset.layout'),'tabs');
    assert.equal(await evaluate('document.querySelectorAll("#autoStateStack .stacked-test").length'),7);
    assert.equal(await evaluate('document.querySelector("#autoStateCodeView").hidden'),true);
    await sleep(100);
    assert.ok(await evaluate('document.querySelectorAll("#autoStateStack .json-key").length>10'));
    const editor='[data-stack-test="'+key+'"] textarea',edited={...common.state,current_utterance:options[0].text+' Edited in stacked view.'};
    await evaluate('document.querySelector('+JSON.stringify(editor)+').focus()');
    await field(editor,JSON.stringify(edited,null,2));
    assert.equal(await evaluate('NorteLab.draft().automation.options[0].text'),edited.current_utterance);
    assert.equal(await evaluate('NorteLab.draft().text'),originalBase);
    assert.deepEqual(await evaluate('NorteClassifier.getConfig()'),originalQuestions);
    const currentStack='[data-stack-test="'+key+'"]',stackToggle='[data-stack-toggle="'+key+'"]';
    await evaluate('document.querySelector('+JSON.stringify(currentStack)+').style.height="360px"');
    const beforeCollapse=await evaluate('NorteLab.draft()');
    await click(stackToggle);
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(stackToggle)+').getAttribute("aria-expanded")'),'false');
    assert.ok(await evaluate('document.querySelector('+JSON.stringify(currentStack)+').getBoundingClientRect().height<65'),'collapsed State only shows heading');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(currentStack+' .state-editor')+').hidden'),true);
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(editor)+').value'),JSON.stringify(edited,null,2));
    assert.deepEqual(await evaluate('NorteLab.draft().automation'),beforeCollapse.automation);
    await click(stackToggle);
    assert.ok(await evaluate('Math.abs(document.querySelector('+JSON.stringify(currentStack)+').getBoundingClientRect().height-360)<2'),'expanding restores resized height');
    // Invalid drafts never fall through to an old valid State.
    await field(editor,'{');
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);
    await click('[data-stack-select="'+options[1].id+'"]');
    assert.equal(await evaluate('document.querySelector('+JSON.stringify(editor)+').value'),'{');
    await evaluate('document.querySelector('+JSON.stringify(editor)+').focus()');await field(editor,JSON.stringify(edited,null,2));
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),false);
    assert.equal(await evaluate('document.activeElement===document.querySelector('+JSON.stringify(editor)+')'),true,'rerender preserves native editing focus');
    // The focus field is advisory: both fields are editable in the same State.
    await field(editor,JSON.stringify({...edited,recent_context:['wrong field']}));
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),false);
    assert.deepEqual(await evaluate('NorteLab.draft().automation.options[0].state.recent_context'),['wrong field']);
    assert.equal(await evaluate('NorteLab.draft().text'),originalBase);
    await field(editor,JSON.stringify(edited,null,2));
    await screenshot('stacked-tests');
    // Round trip: dragging a stack heading back to navigation, keyboard tabs, add/remove a context.
    await evaluate('(()=>{const dt=new DataTransfer(),heading=document.querySelector(".stacked-test.selected [data-stack-select]");heading.dispatchEvent(new DragEvent("dragstart",{bubbles:true,dataTransfer:dt}));document.querySelector("#automationNavigator").dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:dt}));})()');
    assert.equal(await evaluate('NorteLab.draft().testView'),'tabs');
    assert.equal(await evaluate('document.querySelectorAll("#autoStateStack textarea").length'),0,'removed editors are disposed');
    assert.deepEqual(JSON.parse(await evaluate('document.querySelector("#autoStateEditor").value')),edited);
    await evaluate('document.querySelector("#autoOptions [aria-selected=true]").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),options[1].id);
    await pointerClick('#addTestVariation');
    await evaluate('document.querySelector("[data-add-field=recent_context]").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#testVariantMenu").hidden'),false,'pointer interaction in menu must not dismiss it');
    await pointerClick('[data-add-field=recent_context]');
    let all=await evaluate('NorteLab.draft().automation.options');assert.equal(all.length,7);assert.equal(all[6].field,'recent_context');
    await field('#autoStateEditor',JSON.stringify({...common.state,recent_context:['A different saved context']},null,2));
    await click('[data-remove-option="'+all[6].id+'"]');assert.equal(await evaluate('NorteLab.draft().automation.options.length'),6);
    await click('#testViewStacked');await click('[data-stack-toggle="'+options[1].id+'"]');await click('#manualMode');
    assert.equal(await evaluate('document.querySelector("#automationNavigator").hidden'),true);
    assert.equal(await evaluate('document.querySelectorAll("#autoStateStack textarea").length'),0);
    await click('#automatedMode');assert.equal(await evaluate('NorteLab.draft().testView'),'stacked');
    await evaluate('window.beforeNavigationReload=true');
    await call('Page.reload');await wait('!window.beforeNavigationReload && window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="automated"');
    assert.equal(await evaluate('NorteLab.draft().testView'),'stacked');
    assert.equal(await evaluate('NorteLab.draft().automation.options[0].text'),edited.current_utterance);
    assert.equal(await evaluate('document.querySelector(\'[data-stack-toggle="'+options[1].id+'"]\').getAttribute("aria-expanded")'),'false','collapsed States survive route changes and reload');
    await click('#testViewTabs');
    // Seed frozen results with separate answer/confidence gates; no inference calls.
    const E=require('../experiments.js'),ids=['correct','confidence_only','wrong','no_threshold','no_expected','false_expected'];
    const questions=Object.fromEntries(ids.map(id=>[id,{...common.questions.should_track,instructions:'Fixture question '+id}]));
    const expected=Object.fromEntries(ids.filter(id=>id!=='no_expected').map(id=>[id,{type:'noul',value:id!=='false_expected',...(id==='no_threshold'?{}:{minProbability:.8})}]));
    const input={name:'JEV-009-U001-C001',language:'en',state:common.state,config:{model:common.model,questions},expected};
    const answers=Object.fromEntries(ids.map(id=>[id,{type:'noul',noul:id==='confidence_only'?.65:id==='wrong'||id==='false_expected'?.1:.95}]));
    const run=(index,value)=>({index,status:'done',output:{request:E.request(input),response:{model:'fixture',answers:value},provider:'official',latencyMs:100}});
    const first={id:'navigation-a',createdAt:'2026-10-04T10:00:00Z',provider:'official',origin:'automation',input,requested:1,status:'done',runs:[run(1,answers)],automation:{campaignId:'navigation-round',round:9,field:'current_utterance',optionId:key,variant:1,questionVariant:1,label:input.name,questionLabel:'Questions',totalScenarios:2,totalCalls:5}};
    const second=E.clone(first);second.id='navigation-b';second.input.name='JEV-009-U002-C001';second.input.state={...common.state,current_utterance:'Different fixture utterance'};second.automation.variant=2;second.requested=4;
    second.runs=[.95,.65,.1].map((n,index)=>({...run(index+1,{...answers,correct:{type:'noul',noul:n}}),output:{...run(index+1,{...answers,correct:{type:'noul',noul:n}}).output,request:E.request(second.input)}}));
    second.runs.push({index:4,status:'error',error:'Simulated API error'});
    await evaluate('NorteLab.importArchive('+JSON.stringify({schemaVersion:1,cases:[],batches:[first,second]})+')');
    await click('[data-action=view-campaign]');
    assert.equal(await evaluate('document.querySelectorAll("[data-overview-group]").length'),2);
    assert.equal(await evaluate('document.querySelectorAll("[data-overview-question]").length'),12);
    const verdicts=async id=>evaluate('[...document.querySelectorAll(\'[data-overview-batch="navigation-a"][data-overview-question="'+id+'"] [data-verdict]\')].map(n=>n.dataset.verdict)');
    assert.deepEqual(await verdicts('correct'),['passed','passed']);
    assert.deepEqual(await verdicts('confidence_only'),['passed','failed']);
    assert.deepEqual(await verdicts('wrong'),['failed','failed']);
    assert.deepEqual(await verdicts('no_threshold'),['passed','unscored']);
    assert.deepEqual(await verdicts('no_expected'),['unscored','unscored']);
    assert.deepEqual(await verdicts('false_expected'),['passed','passed']);
    assert.match(await evaluate('document.querySelector(\'[data-overview-batch="navigation-b"][data-overview-question="correct"] [data-check=answer]\').textContent'),/2\/3/);
    assert.match(await evaluate('document.querySelector(\'[data-overview-batch="navigation-b"][data-overview-question="correct"] [data-check=confidence]\').textContent'),/1\/3/);
    assert.match(await evaluate('document.querySelector(\'[data-overview-group="navigation-b"] .overview-verdicts\').textContent'),/erro.*API/);
    await screenshot('question-overview');
    const before=await evaluate('NorteLab.snapshot()'),draftBefore=await evaluate('NorteLab.draft().text');
    await click('[data-overview-collapse-all]');
    assert.equal(await evaluate('[...document.querySelectorAll(".overview-questions")].every(n=>n.hidden)'),true);
    const selectedBeforeTitle=await evaluate('document.querySelector("#requestHeader").dataset.selectedTest');
    await pointerClick('[data-overview-test=navigation-a]');
    assert.equal(await evaluate('document.querySelector("#overview-navigation-a").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#campaignOutput .campaign-result")'),null,'title only expands, never navigates');
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),selectedBeforeTitle);
    await click('[data-overview-test=navigation-a]');
    assert.equal(await evaluate('document.querySelector("#overview-navigation-a").hidden'),true);
    assert.equal(await evaluate('document.querySelector("[data-overview-toggle=navigation-a]").getAttribute("aria-expanded")'),'false');
    await click('[data-overview-toggle=navigation-a]');
    await click('[data-overview-batch=navigation-a][data-overview-question=confidence_only] .overview-question-link');
    assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),'navigation-a');
    assert.equal(await evaluate('document.querySelector("#campaignOutput .answer-row[open]").dataset.question'),'confidence_only');
    assert.equal(await evaluate('NorteLab.draft().run'),-1);
    assert.deepEqual(JSON.parse(await evaluate('document.querySelector("#autoStateEditor").value')),first.input.state);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),before);
    assert.equal(await evaluate('NorteLab.draft().text'),draftBefore);
    await click('[data-campaign-summary]');assert.equal(await evaluate('document.querySelector("#overview-navigation-b").hidden'),true,'collapse state survives detail navigation');
    await click('[data-overview-result=navigation-b][data-result-kind=approval]');
    assert.equal(await evaluate('document.querySelector(".campaign-result").dataset.scenarioId'),'navigation-b','approval opens the test even while overview is collapsed');
    await click('#testViewStacked');assert.equal(await evaluate('document.querySelectorAll("#autoStateStack textarea").length'),2);
    assert.ok(await evaluate('[...document.querySelectorAll("#autoStateStack textarea")].every(n=>n.readOnly)'));
    assert.equal(await evaluate('document.querySelector(".stacked-test.selected").dataset.stackTest'),'navigation-b');
    await click('[data-stack-toggle=navigation-a]');
    await click('[data-campaign-summary]');
    await click('[data-overview-batch=navigation-a][data-overview-question=wrong] .overview-question-link');
    assert.equal(await evaluate('document.querySelector(".stacked-test.selected").dataset.stackTest'),'navigation-a');
    assert.equal(await evaluate('document.querySelector("[data-stack-toggle=navigation-a]").getAttribute("aria-expanded")'),'true','targeted navigation reveals its collapsed State');
    for(const check of ['obtained','answer','confidence']) {
      await click('[data-campaign-summary]');
      const target='[data-overview-batch=navigation-a][data-overview-question=confidence_only] [data-check='+check+'] button';
      await evaluate('document.querySelector('+JSON.stringify(target)+').scrollIntoView({block:"center"})');
      await pointerClick(target);
      assert.equal(await evaluate('document.querySelector(".campaign-result").dataset.scenarioId'),'navigation-a');
      assert.ok(await evaluate('!!document.querySelector(\'.answer-row[data-question="confidence_only"][open]\')'),check+' value opens its question');
      assert.equal(await evaluate('document.querySelector("#requestHeader").dataset.selectedTest'),'navigation-a');
    }
    for(const kind of ['answer','confidence']) {
      await click('[data-campaign-summary]');await click('[data-overview-result=navigation-b][data-result-kind='+kind+']');
      assert.equal(await evaluate('document.querySelector(".campaign-result").dataset.scenarioId'),'navigation-b');
    }
    await click('[data-campaign-summary]');await click('[data-overview-result=navigation-a][data-result-kind=approval]');
    // Correct confidence threshold in detail, inspect updated overview, preserve original records.
    await field('#campaignOutput [data-min-probability=confidence_only]','60','change');
    await click('[data-campaign-summary]');
    assert.deepEqual(await verdicts('confidence_only'),['passed','passed']);
    const after=await evaluate('NorteLab.snapshot()');
    assert.deepEqual(after.batches[0].input,before.batches[0].input);assert.deepEqual(after.batches[0].runs,before.batches[0].runs);
    // Both layouts and summary work without horizontal scrolling at small widths.
    for(const width of [1440,900,390,320]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight'),false,'no page overflow at '+width);
      assert.ok(await evaluate('[...document.querySelectorAll("#autoStateStack textarea")].every(n=>n.scrollWidth<=n.clientWidth+1)'),'stack wraps at '+width);
      assert.ok(await evaluate('document.querySelector(".overview-questions").scrollWidth<=document.querySelector(".output-body").clientWidth'),'summary fits at '+width);
      if(width===1440||width===390)await screenshot('overview-'+width);
    }
    await click('#backToDraft');await click('#testViewTabs');await sleep(80);
    assert.equal(await evaluate('new Set([...document.querySelectorAll("#autoOptions .request-option")].map(n=>n.offsetTop)).size'),1,'mobile tabs also stay on one line');
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'tab overflow stays inside the rail');
    assert.equal(sent.length,0);assert.deepEqual(errors,[]);
    console.log('PASS: single-line scrollable tabs, wheel/keyboard/drag navigation, collapsible editable States, preserved resize/drafts, title-only disclosures, approval links, Obtido/Resposta/Confiança detail links, independent verdicts, immutable runs, corrections and four widths. Zero inference calls.');
  }finally{
    socket?.close();server.close();
    const exited=chrome.exitCode!==null || chrome.signalCode!==null?Promise.resolve():new Promise(resolve=>chrome.once('exit',resolve));
    chrome.kill('SIGTERM');await exited;
    await fs.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
