// Regressions for live canvas resizing. Local fake API and isolated Chrome only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises'),F=require('../memory-flow.js');
(async()=>{
  const root=path.resolve(__dirname,'..'),sent=[],threadSent=[],errors=[];
  const assets=['index.html','styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js','app.js','workspace.js','experiments.js','automation.js','classifier.js','lab.js','speech-windows.js','transcription.js','classifier-config.json','manual-test-example.json'];
  const batch={batch_id:'LAYOUT',cases:Array.from({length:40},(_,i)=>({id:'C'+String(i+1).padStart(2,'0'),current_utterance:`Chunk ${i+1}: `+(i%2?'The bracket is deforming too much.':'The bracket needs a comparison of alternative dimensions and support conditions before we can select the final design. '.repeat(5)),expected_store_memory:i%8!==7,expected_event_type:i%8===7?null:F.types[i%8]}))};
  function output(req){
    const item=batch.cases.find(c=>c.current_utterance===req.state.current_utterance);assert.ok(item);
    const answers=req.questions.should_store_memory?{should_store_memory:{type:'noul',noul:item.expected_store_memory?.92:.03}}:{event_type:{type:'choice',choice:item.expected_event_type,confidence:.1,probabilities:Object.fromEntries(F.types.map(t=>[t,t===item.expected_event_type?.94:.06/(F.types.length-1)]))}};
    return {request:req,response:{model:'layout-fixture',answers},provider:'official',latencyMs:10};
  }
  const savedRun=F.createRun(batch,'official');await F.execute(savedRun,{send:async req=>output(req)});
  const server=http.createServer(async(req,res)=>{
    const json=(code,value)=>res.writeHead(code,{'Content-Type':'application/json'}).end(JSON.stringify(value));
    if(req.url==='/api/health')return json(200,{provider:'official',ready:true,engine:'jev-latest'});
    if(req.url==='/api/relations'){
      let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);threadSent.push(body);
      const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>[id,{type:'choice',choice:'belongs',confidence:.2,probabilities:Object.fromEntries(Object.keys(q.criteria).map(key=>[key,key==='belongs'?.96:.02]))}]));
      return json(200,{request:body,response:{model:'layout-fixture',answers},provider:'official',latencyMs:0});
    }
    if(req.url==='/api/classify'){let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);sent.push(body);await sleep(70);return json(200,output(body));}
    const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);
    if(!assets.includes(name))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-memory-layout-'));
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});let socket;
  try{
    let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(100);}}assert.ok(port);
    const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Page.javascriptDialogOpening'&&m.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>errors.push(error.message));if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out: '+method+' '+JSON.stringify(params).slice(0,200)));},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await sleep(50);}throw Error('Timed out: '+expression+'; '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-memory-layout-'+name+'.png',Buffer.from(s.data,'base64'));};
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.confirm=()=>true;if(!sessionStorage.getItem('layout-seeded')){sessionStorage.setItem('norte.memory-flow.v1',${JSON.stringify(JSON.stringify({batch,run:savedRun,selected:'C14'}))});sessionStorage.setItem('layout-seeded','1');}`});
    await call('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#memoria'});
    await wait('window.NorteMemoryPage && NorteClassifier.isAvailable() && document.body.dataset.page==="memory"');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".manual-page-title h1")).fontSize'),'14px');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".mf-chunk-preview")).fontSize'),'11px');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".mf-inspector-text")).fontSize'),'12px');
    assert.equal(await evaluate('document.querySelectorAll("[data-collapse][aria-expanded=false]").length'),9,'queues default collapsed when no explicit preference exists');
    const rawLimit=F.exportResults({run:savedRun}).configuration.raw_window_limit;
    assert.equal(rawLimit,15);
    for(const key of ['raw_window','meeting_events','relation_events','thread_context','meeting_threads','meeting_relations']) {
      assert.equal(await evaluate(`document.querySelector('[data-stream-collapse="stream:${key}"]').getAttribute('aria-expanded')`),'false',key+' defaults collapsed');
    }
    await sleep(100);await shot('fifo-default');
    await click('[data-stream-collapse="stream:raw_window"]');await click('[data-stream-collapse="stream:meeting_events"]');await click('#mfFit');await sleep(100);
    assert.equal(await evaluate('document.querySelectorAll("[data-connection^=memory]").length'),8);
    const expectedRaw=batch.cases.slice(-rawLimit).map(item=>item.id);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#mfGraphRawQueue [data-record]")].map(n=>n.dataset.record)'),expectedRaw,'the raw graph evicts arrivals beyond the configured window');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#mfRawWindow [data-memory-chunk]")].map(n=>n.dataset.memoryChunk)'),expectedRaw,'the sidebar shares the same bounded window');
    assert.equal(await evaluate('document.querySelector("#mfGraphRawCount").textContent'),rawLimit+'/'+rawLimit);
    assert.match(await evaluate('document.querySelector("#mfRawSelection").textContent'),/C14.*fora da janela atual/,'historical selection does not rewind the raw window');
    assert.ok(await evaluate('(()=>{const q=document.querySelector("#mfGraphRawQueue"),r=q.getBoundingClientRect();return q.scrollHeight>q.clientHeight && [...q.querySelectorAll("[data-record]")].filter(n=>{const b=n.getBoundingClientRect();return b.top>=r.top-1 && b.bottom<=r.bottom+1}).length>=4})()'),'the expanded FIFO scrolls while showing at least four complete arrivals');
    assert.ok(await evaluate('(()=>{const q=document.querySelector("#mfGraphEventsQueue"),n=q.querySelector(".is-selected"),a=q.getBoundingClientRect(),b=n.getBoundingClientRect();return b.top>=a.top-1 && b.bottom<=a.bottom+1})()'),'selected stored event is revealed within its graph FIFO');
    await click('#mfCollapseAll');await click('#mfFit');await sleep(100);
    assert.ok(await evaluate('[...document.querySelectorAll(".mf-destination, .mf-ignore-node")].every(n=>n.offsetHeight===260)'),'expanded lists start taller');
    assert.ok(await evaluate('(()=>{const q=document.querySelector("#mfQueue-observation"),r=q.getBoundingClientRect();return [...q.querySelectorAll("[data-record]")].filter(n=>{const b=n.getBoundingClientRect();return b.top>=r.top-1 && b.bottom<=r.bottom+1}).length>=4})()'),'at least four full chunks are visible in the default expanded list');
    await click('#mfMeetingEvents [data-memory-chunk="C02"]');
    assert.match(await evaluate('document.querySelector("#mfMeetingEvents [data-memory-chunk=C02]").nextElementSibling.textContent'),/typehypothesisstatusopen/,'event lifecycle status appears in its expanded metadata');
    await click('#mfMeetingEvents [data-memory-chunk="C02"]');await click('[data-chunk="C14"]');
    const sample=()=>evaluate(`new Promise(resolve=>{
      const rows=[];let redraws=0;const observer=new MutationObserver(records=>{redraws+=records.filter(r=>r.target.id==='mfEdges').length;});observer.observe(document.querySelector('#mfEdges'),{childList:true});
      function frame(){const scene=document.querySelector('#mfScene'),canvas=document.querySelector('#mfCanvas'),r=scene.getBoundingClientRect();rows.push({zoom:scene.style.zoom,transform:scene.style.transform,width:r.width,height:r.height,viewport:[canvas.clientWidth,canvas.clientHeight]});if(rows.length<35)requestAnimationFrame(frame);else{observer.disconnect();resolve({rows,redraws});}}requestAnimationFrame(frame);
    })`);
    for(const [width,height,dpr] of [[1600,1000,1],[1440,900,1.25],[1366,768,1],[1280,720,1.25],[1280,600,1],[1024,768,2],[390,844,2]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:width<500});await sleep(250);
      const result=await sample(),sizes=new Set(result.rows.map(r=>JSON.stringify(r)));
      console.log(JSON.stringify({viewport:[width,height,dpr],distinctSizes:sizes.size,redraws:result.redraws,first:result.rows[0],last:result.rows.at(-1)}));
      await shot(width);
      assert.equal(sizes.size,1,'canvas settles instead of oscillating at '+width);
      assert.ok(result.redraws<=2,'idle canvas must not redraw every frame at '+width);
      assert.equal(await evaluate('document.querySelector("#mfScene").style.zoom'),'','CSS zoom must not reflow the graph');
      assert.ok(await evaluate('(()=>{const canvas=document.querySelector("#mfCanvas"),r=canvas.getBoundingClientRect(),s=document.querySelector("#mfScene").getBoundingClientRect(),panel=document.querySelector(".mf-main").getBoundingClientRect(),inspector=document.querySelector("#mfInspector").getBoundingClientRect();return s.right<=r.right+1 && s.bottom<=r.bottom+1 && inspector.bottom<=panel.bottom+1 && canvas.scrollWidth<=canvas.clientWidth+1 && canvas.scrollHeight<=canvas.clientHeight+1;})()'),'fit and inspector stay inside their panels');
      assert.ok(await evaluate('(()=>{const p=document.querySelector("#mfMemories"),r=p.getBoundingClientRect(),w=document.querySelector(".mf-workspace").getBoundingClientRect();return r.right<=w.right+1 && r.bottom<=w.bottom+1 && p.clientWidth>100 && getComputedStyle(p).overflowY==="auto" && [...p.querySelectorAll(".mf-memory-list")].every(n=>n.hidden || (!n.childElementCount || n.clientHeight>0) && n.scrollWidth<=n.clientWidth+1);})()'),'memory panels are visible, bounded and wrap without horizontal scrolling at '+width);
      assert.ok(await evaluate('(()=>{const p=document.querySelector("[data-edge=test_result]"),v=p.getPointAtLength(p.getTotalLength()),point=new DOMPoint(v.x,v.y).matrixTransform(p.getScreenCTM()),r=document.querySelector("#mfNode-test_result").getBoundingClientRect();return Math.abs(point.x-r.left)<2 && Math.abs(point.y-r.top-r.height/2)<2})()'),'edge stays connected after resizing');
      assert.ok(await evaluate(`(()=>{const p=document.querySelector('[data-connection="memory:test_result"]'),v=p.getPointAtLength(p.getTotalLength()),point=new DOMPoint(v.x,v.y).matrixTransform(p.getScreenCTM()),r=document.querySelector('#mfNodeMeetingEvents').getBoundingClientRect(),s=document.querySelector('#mfScene').getBoundingClientRect(),raw=document.querySelector('#mfNodeChunk').getBoundingClientRect();return Math.abs(point.x-r.left)<2 && Math.abs(point.y-r.top-r.height/2)<2 && r.bottom<=s.bottom+1 && raw.top>=s.top-1 && raw.bottom<=s.bottom+1})()`),'memory arrows and input FIFO stay within the natural scene');
      if ([1600,1280,390].includes(width)) {
        const beforePanels=JSON.stringify(await evaluate('NorteMemoryPage.snapshot().run'));
        for(const [key,id] of [['chunksHidden','mfSidebar'],['inspectorHidden','mfInspector'],['memoriesHidden','mfMemories']]) {
          await click('.mf-panel-tools [data-panel-toggle="'+key+'"]'); await sleep(60);
          assert.equal(await evaluate(`document.getElementById(${JSON.stringify(id)}).hidden`),true);
        }
        assert.ok(await evaluate('(()=>{const c=document.querySelector("#mfCanvas").getBoundingClientRect(),w=document.querySelector(".mf-workspace").getBoundingClientRect();return c.width>=w.width-2 && c.height>w.height*.65 && c.bottom<=w.bottom+1 && document.documentElement.scrollWidth<=innerWidth})()'),'hiding panels returns their space to the map at '+width);
        if(width===1600)await shot('hidden-panels');
        for(const key of ['chunksHidden','inspectorHidden','memoriesHidden']) await click('.mf-panel-tools [data-panel-toggle="'+key+'"]');
        await sleep(100);
        assert.equal(JSON.stringify(await evaluate('NorteMemoryPage.snapshot().run')),beforePanels,'panel visibility never changes results');
        await click('#mfInspector [data-question="should_store_memory"] > summary');
        await click('#mfInspector [data-question="event_type"] > summary');
        await wait('document.querySelector(".mf-main").classList.contains("has-expanded-answer")');await sleep(150);
        const expanded=await sample();
        assert.equal(new Set(expanded.rows.map(r=>JSON.stringify(r))).size,1,'expanded inline responses settle at '+width);
        assert.equal(expanded.redraws,0,'expanded inline responses do not cause a resize loop');
        assert.ok(await evaluate('(()=>{const p=document.querySelector("#mfInspector"),r=p.getBoundingClientRect(),m=document.querySelector(".mf-main").getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1 && r.bottom<=m.bottom+1 && document.documentElement.scrollWidth<=innerWidth;})()'),'inline probabilities wrap without overflowing at '+width);
        if(width===390)await shot('inline-mobile');
        await click('#mfInspector [data-question="should_store_memory"] > summary');
        await click('#mfInspector [data-question="event_type"] > summary');
        await wait('!document.querySelector(".mf-main").classList.contains("has-expanded-answer")');
      }
    }
    assert.equal(sent.length,0);
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await click('[data-chunk="C14"]');await sleep(150);
    // A status/render refresh must not resize a scene whose content did not change.
    const refreshed=await evaluate(`new Promise(resolve=>{let i=0,redraws=0;const sizes=[],observer=new MutationObserver(records=>{redraws+=records.length;});observer.observe(document.querySelector('#mfEdges'),{childList:true});function frame(){window.dispatchEvent(new CustomEvent('norte:page-changed'));requestAnimationFrame(()=>{const r=document.querySelector('#mfScene').getBoundingClientRect();sizes.push([r.width,r.height]);if(++i<35)requestAnimationFrame(frame);else{observer.disconnect();resolve({sizes,redraws});}});}frame();})`);
    assert.equal(new Set(refreshed.sizes.map(r=>JSON.stringify(r))).size,1,'repeated unchanged render preserves canvas size');
    assert.equal(refreshed.redraws,0,'unchanged refresh must not replace the SVG and restart its animation');
    await evaluate('window.queueItem=document.querySelector("#mfQueue-observation [data-record]");const q=document.querySelector("#mfQueue-observation");q.scrollTop=q.scrollHeight;window.queueScroll=q.scrollTop;');
    await click('[data-chunk="C02"]');
    assert.equal(await evaluate('queueItem.isConnected'),true,'selecting another chunk preserves queue DOM');
    assert.equal(await evaluate('document.querySelector("#mfQueue-observation").scrollTop===queueScroll'),true,'selection does not reset FIFO scroll');
    await click('#mfZoomIn');await click('#mfZoomIn');await click('#mfZoomIn');
    const manualScale=await evaluate('document.querySelector("#mfScene").dataset.scale');
    await click('[data-chunk="C01"]');await sleep(100);assert.equal(await evaluate('document.querySelector("#mfScene").dataset.scale'),manualScale,'manual zoom stays selected');
    await click('#mfFit');
    // Height preferences belong to the UI, not a model run or a saved test.
    const originalRun=JSON.stringify(await evaluate('NorteMemoryPage.snapshot().run'));
    const resizeQueue=async(id,delta)=>{
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const selector='[data-queue-resize="'+id+'"]';
      const p=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect(),c=n.closest('.mf-node');return {x:r.left+r.width/2,y:r.top+r.height/2,height:c.offsetHeight,scale:Number(document.querySelector('#mfScene').dataset.scale),panX:document.querySelector('#mfCanvas').dataset.panX,panY:document.querySelector('#mfCanvas').dataset.panY};})()`);
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${p.x},${p.y}))`),'queue handle is reachable');
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});
      await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1});
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y+delta,button:'left',buttons:1});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y+delta,button:'left',clickCount:1});await sleep(150);
      const actual=await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('.mf-node').offsetHeight`);
      assert.ok(Math.abs(actual-Math.max(120,Math.min(720,p.height+delta/p.scale)))<=1,'drag honors the current canvas scale');
      assert.equal(await evaluate('Number(document.querySelector("#mfScene").dataset.scale)'),p.scale,'resizing never auto-shrinks the map');
      assert.deepEqual(await evaluate('[document.querySelector("#mfCanvas").dataset.panX,document.querySelector("#mfCanvas").dataset.panY]'),[p.panX,p.panY],'resize does not pan');
      assert.equal(await evaluate(`JSON.parse(localStorage.getItem('norte.memory-ui.v1')).queueLayouts[${JSON.stringify(id)}].height`),actual);
      return actual;
    };
    const resizedHeight=await resizeQueue('type:observation',28);
    assert.ok(resizedHeight>260);assert.equal(await evaluate('document.querySelector("#mfNode-hypothesis").offsetHeight'),260,'other list heights stay independent');
    await click('[data-collapse="type:observation"]');assert.equal(await evaluate('document.querySelector("#mfNode-observation").offsetHeight'),42);
    assert.equal(await evaluate(`document.querySelector('[data-queue-resize="type:observation"]').hidden`),true);
    await click('[data-collapse="type:observation"]');assert.equal(await evaluate('document.querySelector("#mfNode-observation").offsetHeight'),resizedHeight);
    const reducedHeight=await resizeQueue('type:observation',-12);assert.ok(reducedHeight<resizedHeight);
    await click('#mfFit');await sleep(100);
    await evaluate(`document.querySelector('[data-queue-resize="type:observation"]').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await sleep(100);
    assert.equal(await evaluate('document.querySelector("#mfNode-observation").offsetHeight'),reducedHeight+20,'keyboard resizing works');
    await evaluate(`document.querySelector('[data-queue-resize="type:observation"]').dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))`);await sleep(100);
    assert.equal(await evaluate('document.querySelector("#mfNode-observation").offsetHeight'),260,'double-click restores the default');
    await click('#mfCollapseAll');await click('[data-collapse="ignore"]');await click('#mfFit');await sleep(100);
    await resizeQueue('ignore',45);
    await evaluate('document.querySelector("[data-queue-resize=ignore]").focus()');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});await sleep(100);
    assert.equal(await evaluate('document.querySelector("#mfNodeIgnore").offsetHeight'),720);
    assert.ok(await evaluate('(()=>{const i=document.querySelector("#mfNodeIgnore").getBoundingClientRect(),s=document.querySelector("#mfScene").getBoundingClientRect();return i.bottom<=s.bottom+1})()'),'large Ignore remains inside its reserved grid space even with other lists collapsed');
    await click('[data-collapse="ignore"]');
    await click('#mfFit');await sleep(100);
    const rawHeight=await resizeQueue('stream:raw_window',18);
    await click('[data-stream-collapse="stream:meeting_events"]');
    await click('#mfCollapseAll');await click('#mfCollapseAll');
    assert.equal(await evaluate('document.querySelector("#mfGraphEventsQueue").hidden'),true,'category controls do not change independent memory disclosure');
    const prefs=await evaluate('JSON.parse(localStorage.getItem("norte.memory-ui.v1")).queueLayouts');
    assert.ok(prefs.ignore.collapsed);assert.equal(prefs.ignore.height,720);
    assert.equal(JSON.stringify(await evaluate('NorteMemoryPage.snapshot().run')),originalRun,'resizing and collapsing never edit the run');
    await evaluate('window.beforeLayoutReload=true;sessionStorage.removeItem("norte.memory-flow.v1")');
    await call('Page.reload');await wait('!window.beforeLayoutReload && window.NorteMemoryPage && NorteClassifier.isAvailable()');
    assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("norte.memory-ui.v1")).queueLayouts'),prefs,'sizes survive a fresh session');
    assert.equal(await evaluate('document.querySelectorAll("[data-collapse][aria-expanded=false]").length'),9,'collapsed states also survive a fresh session');
    assert.equal(await evaluate('document.querySelector("#mfNodeChunk").offsetHeight'),rawHeight,'raw FIFO height is restored');
    assert.equal(await evaluate('document.querySelector("#mfGraphEventsQueue").hidden'),true,'graph memory collapse is restored');
    await click('[data-stream-collapse="stream:meeting_events"]');
    assert.equal(await evaluate('document.querySelector("#mfNodeMeetingEvents").offsetHeight'),320);
    await sleep(100);
    const collapsedZoom=await evaluate('document.querySelector("#mfScene").dataset.scale');
    await click('[data-collapse="ignore"]');await sleep(100);assert.equal(await evaluate('document.querySelector("#mfNodeIgnore").offsetHeight'),720,'expanding recovers the saved height');
    assert.equal(await evaluate('document.querySelector("#mfScene").dataset.scale'),collapsedZoom,'opening a list preserves its on-screen scale');
    await evaluate('document.querySelector("[data-queue-resize=ignore]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
    await click('#mfCollapseAll');await click('#mfFit');await sleep(100);
    await click('[data-collapse="type:observation"]');await click('[data-chunk="C01"]');await sleep(100);await shot('expanded-at-current-zoom');
    await click('#mfCollapseAll');await click('#mfCollapseAll');await click('#mfFit');await sleep(100);
    await shot('resizable-lists');
    await evaluate('window.graphHeightBeforeRun=document.querySelector("#mfScene").offsetHeight;window.queueBoundsBeforeRun=[...document.querySelectorAll(".mf-destination")].map(n=>[n.offsetTop,n.offsetHeight]);');
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await click('#mfRun');await wait('document.querySelector("#mfConfirmDialog").open');await click('[data-mf-confirm="discard"]');await wait('NorteMemoryPage.isRunning()');
    await wait('NorteMemoryPage.snapshot().run.records.length>=12');
    assert.ok(await evaluate('JSON.stringify([...document.querySelectorAll("#mfGraphEventsQueue [data-record]")].map(n=>n.dataset.record))===JSON.stringify(NorteMemoryPage.snapshot().meeting_events.map(e=>e.chunk_id))'),'graph memory receives each completed event in arrival order');
    assert.equal(await evaluate('document.querySelector("#mfScene").offsetHeight===graphHeightBeforeRun'),true,'growing queues do not change the natural graph height');
    assert.equal(await evaluate('JSON.stringify([...document.querySelectorAll(".mf-destination")].map(n=>[n.offsetTop,n.offsetHeight]))===JSON.stringify(queueBoundsBeforeRun)'),true,'FIFO panels keep their positions during the run');
    await click('[data-chunk="C01"]');
    await evaluate('window.liveQueueItem=document.querySelector("#mfQueue-observation [data-record]");');
    const runBefore=await evaluate('NorteMemoryPage.snapshot().run.records.length');
    await wait('NorteMemoryPage.snapshot().run.records.length>='+Math.min(40,runBefore+9));
    assert.equal(await evaluate('liveQueueItem.isConnected'),true,'growing FIFO keeps existing blocks mounted while running');
    await call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1.25,mobile:false});
    await shot('running');
    await wait('!NorteMemoryPage.isRunning()');await sleep(250);
    const afterRun=await sample();console.log('after run',JSON.stringify({redraws:afterRun.redraws,sizes:[...new Set(afterRun.rows.map(r=>JSON.stringify(r)))]}));
    assert.equal(new Set(afterRun.rows.map(r=>JSON.stringify(r))).size,1,'completed live run settles');
    assert.ok(afterRun.redraws<=2,'completed live run has no resize loop');
    await evaluate('window.finalRun=JSON.stringify(NorteMemoryPage.snapshot().run);');
    await click('#manualMode');await click('#memoryMode');await sleep(150);
    assert.equal(await evaluate('JSON.stringify(NorteMemoryPage.snapshot().run)===finalRun'),true,'navigation/resizing never changes saved classifications');
    const final=await evaluate('NorteMemoryPage.snapshot()');
    assert.equal(final.run.thread_worker.status,'done');
    // This layout stress fixture intentionally keeps lengthy prose. Once a thread
    // exceeds the API state budget it must remain pending, never truncate anchors
    // or present the missing inference as a successful assignment.
    const completedJobs=final.run.thread_worker.jobs.filter(job=>job.status==='done');
    const oversizedJobs=final.run.thread_worker.jobs.filter(job=>job.status==='error');
    assert.ok(completedJobs.length>0);assert.ok(oversizedJobs.length>0,'long histories exercise the documented state limit');
    assert.equal(completedJobs.length+oversizedJobs.length,final.run.thread_worker.jobs.length,'no queued, running or interrupted jobs remain after completion');
    for(const job of oversizedJobs) {
      assert.ok(job.parts.some(part=>/State JSON excede 16.000 caracteres.*Nenhum anchor foi descartado/.test(part.error)));
      assert.ok(job.parts.every(part=>part.status==='error'&&!part.output&&!part.request),'oversized histories never reach the API');
      const event=final.meeting_events.find(event=>event.event_id===job.event_id);
      assert.equal(event.thread_id,null);assert.equal(event.thread_assignment_state,'pending','a size error cannot invent a thread assignment');
    }
    assert.ok(threadSent.every(request=>JSON.stringify(request.state).length<=16000),'only states within the API limit are submitted');
    assert.ok(threadSent.length>0);assert.ok([...sent,...threadSent].every(request=>!JSON.stringify(request).includes('expected_')));
    assert.deepEqual(final.raw_window.map(item=>item.chunk_id),expectedRaw,'the live run also obeys the configured FIFO limit');
    assert.equal(errors.length,0,JSON.stringify(errors));
    console.log('PASS: compact fonts, taller queues, scale-aware pointer/keyboard resizing, independent Ignore height, persistent sizes/collapse states, immutable runs and stable live canvas at desktop/fractional/mobile sizes. No paid calls.');
  }finally{socket?.close();chrome.kill('SIGTERM');server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
