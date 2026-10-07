// UI fixtures exercise streaming and document behavior, not classifier accuracy.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');

(async()=>{
 const root=path.resolve(__dirname,'..'),requests=[],errors=[];
 const utterances=[
  'O suporte está deformando acima do limite.',
  'Talvez a espessura do suporte explique a deformação.',
  'Vamos testar o suporte de 4 mm sob carga de 20 N.',
  'No ensaio do suporte de 4 mm sob 20 N, a deformação ainda excedeu o limite.',
  'Norte o assunto um é Deformação do suporte.',
  'Vamos repetir o ensaio do suporte de 4 mm sob 20 N amanhã.',
  'A caixa do sensor apresenta trincas perto dos furos de montagem.',
  'Talvez a distância entre os furos concentre a tensão na caixa.'
 ];
 const transcript=utterances.map((text,index)=>'[00:'+String(index).padStart(2,'0')+':15] Participante: '+text).join('\n'),types=['observation','hypothesis','test_proposal','test_result',null,'test_proposal','observation','hypothesis'];
 const attentionText=['A carga no suporte deve ser no máximo 20 N.','Talvez reforçar o suporte resolva a falha.','Vamos verificar o suporte no ensaio R1, sob 20 N.','No ensaio R1 a carga chegou a 30 N.'];
 const attentionTypes=['requirement','hypothesis','test_proposal','test_result'];
 let gateRelease,gateHeld=false;const gate=new Promise(resolve=>gateRelease=resolve);
 let cancelRelease,cancelHeld=false;const cancellationGate=new Promise(resolve=>cancelRelease=resolve);
 const assets=new Set(['index.html','reuniao.html','styles.css','memory-flow.css','workspace.js','automation.js','classifier.js','lab.js','app.js','memory-page.js','typed-relations-page.js','relation-map.js','relation-map.css','classifier-config.json','manual-test-example.json','meeting-canvas.js','meeting-canvas.css','meeting-room.css','meeting-room.js','experiments.js','relation-worker.js','memory-flow.js','memory-v2.js','typed-relations.js','memory-storage.js','speech-windows.js','transcription.js','meeting-commands.js','meeting-session.js','meeting-speech.js','meeting-evidence.js','meeting-state.js','meeting-review.js','meeting-hierarchy.js','meeting-minutes.js','meeting-minutes.css','meeting-amendments.js','meeting-document.js','gemini-minutes.js','gemini-minutes.css','vendor/minutes/jspdf-4.2.1.umd.min.js','vendor/minutes/DejaVuSans-2.37.ttf']);
 const subject=text=>/caixa|furos/.test(text||'')?'caixa':'suporte';
 const server=http.createServer(async(req,res)=>{
  try {
   const pathname=new URL(req.url,'http://localhost').pathname;
   const json=value=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
   if(pathname==='/__seed')return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Storage seed</title>');
   if(pathname==='/api/health')return json({ready:true,provider:'official',engine:'jev-latest'});
   if(pathname==='/api/minutes'){requests.push({url:pathname});return res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Unexpected remote organization in local-preview test'}));}
   if(['/api/classify','/api/relations','/api/typed-relations'].includes(pathname)){
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push({url:pathname,body});
    assert.equal(JSON.stringify(body).includes('expected_'),false,'model requests must not contain fixture labels');
    if(!gateHeld&&body.state.utterance===utterances[7]){gateHeld=true;await gate;}
    if(body.state.utterance==='Cancelar antes da resposta.'){cancelHeld=true;await cancellationGate;}
    const answers=Object.fromEntries(Object.entries(body.questions).map(([id,q])=>{
     if(q.type==='noul')return [id,{type:'noul',noul:.98}];
     const current=body.state.current_event,target=body.state.candidates?.find(item=>item.event_id===id.split('__')[1]);let choice;
     if(id==='command_type')choice=/^Norte\b/.test(body.state.utterance)?'rename_topic':'conversation';
     else if(id==='event_type')choice=attentionTypes[attentionText.indexOf(body.state.current_utterance)]||types[utterances.indexOf(body.state.current_utterance)]||'observation';
     else if(id==='belongs_to_active_thread')choice=subject(current.text)===subject(body.state.active_thread.events[0].text)?'belongs':'does_not_belong';
     else if(id.startsWith('belongs_to_archive_thread__')){
      const candidate=body.state.candidate_threads.find(item=>item.thread_id===id.split('__')[1]);choice=subject(current.text)===subject(candidate.events[0].text)?'belongs':'does_not_belong';
     }else if(id.startsWith('relation_type__')){
      choice='none';
      if(current.type==='hypothesis'&&target?.type==='observation'&&subject(current.text)===subject(target.text))choice='related_to';
      if(current.text===utterances[2]&&target?.type==='hypothesis')choice='tests';
      if(current.type==='test_result'&&target?.text===utterances[2])choice='result_of';
      if(current.text===utterances[5]&&target?.text===utterances[2])choice='repeats';
      if(current.text===attentionText[2]&&target?.text===attentionText[1])choice='tests';
      if(current.text===attentionText[3]&&target?.text===attentionText[2])choice='result_of';
      if(current.text===attentionText[3]&&target?.text===attentionText[0])choice='contradicts';
     }else if(id.startsWith('configuration_match__')){
      choice=['result_of','repeats'].includes(body.state.relation_type)?'exact':'not_applicable';
      if(current.text===attentionText[2]&&body.state.relation_type==='tests')choice='ambiguous';
      if(current.text===attentionText[3])choice=body.state.relation_type==='result_of'?'mismatch':body.state.relation_type==='contradicts'?'exact':choice;
     }
     const keys=Object.keys(q.criteria);assert.ok(keys.includes(choice),'Unmocked answer '+id+' '+choice);
     return [id,{type:'choice',choice,confidence:.2,probabilities:Object.fromEntries(keys.map(key=>[key,key===choice?.98:.02/(keys.length-1)]))}];
    }));
    await sleep(12);return json({request:body,response:{model:'browser-fixture',answers},provider:'official',latencyMs:12});
   }
   const name=pathname.slice(1)||'index.html';
   if(!assets.has(name))return res.writeHead(404).end();
   res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'font/ttf','Cache-Control':'no-store'}).end(await fs.readFile(path.join(root,name)));
  }catch(error){errors.push(error.stack);if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-meeting-room-browser-'));
 const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let socket,chromeError='';chrome.stderr.on('data',data=>chromeError=(chromeError+data).slice(-2000));
 try{
  let port;for(let i=0;i<160;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(50);}}assert.ok(port,chromeError);
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json());socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let next=0;const pending=new Map();
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},20000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);if(message.method==='Page.javascriptDialogOpening'&&message.params.type==='beforeunload')call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>errors.push(error.message));if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(Error(JSON.stringify(message.error))):item.resolve(message.result);}});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async expression=>{for(let i=0;i<500;i++){try{if(await evaluate(expression))return;}catch(error){if(!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message))throw error;}await sleep(30);}const state=await evaluate('(()=>{const r=window.NorteMeetingRoom?.snapshot();return r&&{status:r.status,error:r.error,records:r.records.map(x=>({id:x.id,status:x.status,error:x.error})),threads:r.thread_worker&&{status:r.thread_worker.status,jobs:r.thread_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))},relations:r.typed_relation_worker&&{status:r.typed_relation_worker.status,error:r.typed_relation_worker.error,jobs:r.typed_relation_worker.jobs.map(x=>({id:x.event_id,status:x.status,error:x.error}))}};})()');throw Error('Timed out: '+expression+' '+JSON.stringify(errors)+' '+JSON.stringify(state));};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const snapshot=()=>evaluate('NorteMeetingRoom.snapshot()');
  const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-meeting-room-'+name+'.png',Buffer.from(shot.data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
   class FixtureRecognition {
    constructor(){window.__speech=this;(window.__speechInstances||=[]).push(this);this.results=[];this.stopped=false;this.stopCalls=0;}
    start(){this.stopped=false;queueMicrotask(()=>this.onstart?.());}
    emit(text,isFinal,index=this.results.length){const result=[{transcript:text,confidence:.99}];result.isFinal=isFinal;this.results[index]=result;this.onresult?.({results:this.results,resultIndex:index});}
    stop(){this.stopCalls++;this.stopped=true;setTimeout(()=>{if(this.finalOnStop)this.emit(this.finalOnStop,true,this.results.length-1);this.onend?.();},250);}
    abort(){this.stopped=true;queueMicrotask(()=>this.onend?.());}
   }
   window.SpeechRecognition=FixtureRecognition;window.webkitSpeechRecognition=FixtureRecognition;
  `});
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  const origin='http://127.0.0.1:'+server.address().port;
  const labSentinel=JSON.stringify({schemaVersion:1,cases:[],batches:[]});
  const memorySentinel=JSON.stringify(require('../memory-flow.js').emptyLibrary());
  await call('Page.navigate',{url:origin+'/__seed'});await wait('location.pathname==="/__seed"');
  await evaluate(`(async()=>{localStorage.setItem('norte.tests.v1',${JSON.stringify(labSentinel)});const request=indexedDB.open('norte-memory',1);await new Promise((resolve,reject)=>{request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onerror=()=>reject(request.error);request.onsuccess=resolve;});const db=request.result;await new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');for(const [key,value] of Object.entries({'norte.meeting-room.current.v1':'"legacy"','norte.meeting-room.index.v1':'[{"id":"legacy","title":"Reunião antiga","date":"2026-01-01"}]','norte.meeting-room.session.v1.legacy':'{"id":"legacy"}','norte.meeting-room.session.v1.orphan':'{"id":"orphan"}','norte.memory-library.v1':${JSON.stringify(memorySentinel)}}))store.put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();})()`);
  await call('Page.navigate',{url:origin+'/index.html#reuniao'});
  await wait('window.NorteMeetingRoom?.ready() && window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page==="meeting"');
  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const openSaved=async id=>{await wait('[...document.querySelectorAll(".room-open-meeting")].some(button=>button.dataset.meetingId==='+JSON.stringify(id)+')');await evaluate(`document.querySelector('.room-open-meeting[data-meeting-id="'+${JSON.stringify(id)}+'"]').click()`);await wait('NorteMeetingRoom.view()==="room" && NorteMeetingRoom.snapshot()?.id==='+JSON.stringify(id));};
  const createInstant=async()=>{await click('#roomNew');await wait('!document.querySelector("#roomCreateMenu").hidden');assert.equal(await evaluate('document.querySelector("#roomSchedule").disabled'),true);await click('#roomCreateInstant');await wait('NorteMeetingRoom.view()==="room" && NorteMeetingRoom.snapshot()?.status==="draft"');return snapshot();};
  assert.equal(await evaluate('document.querySelectorAll("#sidebar").length'),1,'the meeting uses the original application sidebar');
  assert.equal(await evaluate('document.querySelector(".room-nav")'),null,'no standalone navigation is embedded');
  assert.equal(await evaluate('document.querySelector("#meetingMode").getAttribute("aria-current")'),'page');
  assert.equal(await evaluate('NorteMeetingRoom.view()'),'library');assert.equal(await snapshot(),null);
  assert.equal(await visible('#roomLibrary'),true);assert.equal(await visible('#roomLibraryEmpty'),true);
  assert.equal(await evaluate('document.querySelectorAll("#roomLibraryList .room-open-meeting").length'),0);
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);assert.equal(requests.length,0,'opening an empty library never records or sends inference');
  const migrated=await evaluate(`(async()=>{const db=await NorteMemoryStorage.open();const keys=['norte.meeting-room.current.v1','norte.meeting-room.index.v1','norte.meeting-room.session.v1.legacy','norte.meeting-room.session.v1.orphan','norte.memory-library.v1'];const values=Object.fromEntries(await Promise.all(keys.map(async key=>[key,await db.read(key)])));db.close();return {values,lab:localStorage.getItem('norte.tests.v1')};})()`);
  for(const key of Object.keys(migrated.values).filter(key=>key.startsWith('norte.meeting-room.')))assert.equal(migrated.values[key],null,'migration removes only obsolete meeting data: '+key);
  assert.equal(migrated.values['norte.memory-library.v1'],memorySentinel);assert.equal(migrated.lab,labSentinel,'lab history survives the room-only migration');
  const pageBackground=await evaluate('getComputedStyle(document.body).backgroundColor');assert.ok((pageBackground.match(/\d+/g)||[]).slice(0,3).every(value=>Number(value)<90),'existing dark palette retained');
  await screenshot('library-empty');
  // The new library is one application route; previous workspaces keep their own drafts.
  await click('#manualMode');await wait('document.body.dataset.page==="manual"');
  const manualDraft=JSON.stringify({current_utterance:'Rascunho preservado na página manual.'});
  await evaluate(`document.querySelector('#manualState').value=${JSON.stringify(manualDraft)};document.querySelector('#manualState').dispatchEvent(new Event('input',{bubbles:true}))`);
  for(const [id,page,hash] of [['automatedMode','automated','#automatizados'],['memoryMode','memory','#memoria'],['liveMode','live','#ao-vivo'],['manualMode','manual','#manual']]){await click('#'+id);await wait('document.body.dataset.page==='+JSON.stringify(page));assert.equal(await evaluate('location.hash'),hash);assert.equal(await evaluate('document.querySelector('+JSON.stringify('#'+id)+').getAttribute("aria-current")'),'page');}
  assert.equal(await evaluate('document.querySelector("#manualState").value'),manualDraft);
  await click('#meetingMode');await wait('document.body.dataset.page==="meeting" && NorteMeetingRoom.view()==="library"');
  assert.equal(requests.length,0,'navigation never starts a meeting');
  const draft=await createInstant();
  assert.equal(draft.startedAt,null);assert.deepEqual(draft.transcript,[]);assert.deepEqual(draft.meeting_events,[]);
  assert.equal(requests.length,0,'instant meeting is only a draft until input arrives');assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  assert.equal(await visible('#roomImport'),true);assert.equal(await visible('#roomLive'),true);assert.equal(await visible('#roomTranscriptPanel'),true,'transcription starts below the canvas');
  assert.equal(await evaluate('document.querySelector("#roomMinutes").disabled'),true);
  assert.equal(await evaluate('document.querySelectorAll(".room-legend [data-status]").length'),6);
  const dividerBefore=await evaluate('Number(document.querySelector("#roomTranscriptDivider").getAttribute("aria-valuenow"))');
  await evaluate(`document.querySelector('#roomTranscriptDivider').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
  const dividerAfter=await evaluate('Number(document.querySelector("#roomTranscriptDivider").getAttribute("aria-valuenow"))');assert.ok(Number.isFinite(dividerAfter)&&dividerAfter!==dividerBefore,'keyboard resizes the transcript split');
  await click('#roomTranscriptToggle');assert.equal(await visible('#roomTranscriptPanel'),false);await click('#roomTranscriptToggle');assert.equal(await visible('#roomTranscriptPanel'),true);
  await screenshot('draft');
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');
  assert.equal(await evaluate('document.querySelectorAll("#roomLibraryList .room-open-meeting").length'),1);
  await openSaved(draft.id);assert.equal((await snapshot()).status,'draft');assert.equal(requests.length,0);assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  await click('#roomImport');await wait('document.querySelector("#roomImportDialog").open');
  const transcriptFile=path.join(profile,'reuniao-upload.txt');await fs.writeFile(transcriptFile,transcript);
  const dom=await call('DOM.getDocument'),fileInput=await call('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#roomFile'});
  await call('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[transcriptFile]});await wait('document.querySelector("#roomImportText").value==='+JSON.stringify(transcript));
  assert.equal(await evaluate('document.querySelector("#roomFileLabel").textContent'),'reuniao-upload.txt');
  await evaluate(`document.querySelector('#roomImportForm').requestSubmit()`);
  await wait('NorteMeetingRoom.snapshot()?.meeting_events?.length>=6');
  assert.equal((await snapshot()).id,draft.id,'import uses the already-created meeting');
  await wait('!!document.querySelector(".room-node[data-type=test_proposal] .room-node[data-type=test_result]")');
  assert.equal(gateHeld,true);assert.equal((await snapshot()).status,'running');
  assert.equal(await evaluate('document.querySelectorAll("#roomBoard .room-node").length'),6);
  assert.match(await evaluate('document.querySelector(".room-topic-name h2").textContent'),/Deformação do suporte/);
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0,'import never opens the microphone');
  gateRelease();await wait('NorteMeetingRoom.snapshot()?.status==="done" && NorteMeetingRoom.snapshot()?.typed_relation_worker?.status==="done"');
  const finished=await snapshot();assert.equal(finished.id,draft.id);assert.equal(finished.meeting_events.length,7);assert.equal(finished.transcript.length,8);assert.equal(finished.meeting_threads.length,2);
  assert.deepEqual(finished.transcript.map(entry=>entry.text),utterances,'timestamps and speakers never enter the model text');
  assert.deepEqual(finished.transcript.map(entry=>entry.offsetMs),utterances.map((_,index)=>(index*60+15)*1000),'source times survive import');
  assert.ok(finished.transcript.every(entry=>entry.speaker==='Participante'&&entry.sourceText.startsWith('[00:')),'speaker and original source remain available');
  assert.equal(await evaluate('document.querySelector(".room-speech-time").textContent'),'00:00:15');
  assert.equal(await evaluate('document.querySelector(".room-speech-speaker").textContent'),'Participante');
  assert.equal(await evaluate('document.querySelector(".room-speech-text").textContent'),utterances[0]);
  assert.equal(finished.topic_titles.T001,'Deformação do suporte');assert.equal(finished.meeting_commands.filter(item=>item.renamed).length,1);assert.equal(finished.meeting_events.some(item=>item.text.startsWith('Norte,')),false);
  await wait('document.querySelectorAll("#roomBoard path[marker-end]").length===2');
  assert.equal(await evaluate('document.querySelectorAll("#roomBoard .room-node").length'),7);assert.equal(await evaluate('document.querySelectorAll(".room-topic").length'),2);assert.equal(await evaluate('document.querySelectorAll("#roomBoard path[marker-end]").length'),2,'only tests and result_of are drawn, excluding related_to and repeats');
  assert.equal(await evaluate('document.querySelector(".room-node[data-type=test_proposal][data-status=completed]")!==null'),true);assert.equal(await evaluate('document.querySelector("#roomMinutes").disabled'),false);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const canvasGeometry=await evaluate(`(()=>{const canvas=document.querySelector('#roomCanvas'),board=document.querySelector('#roomBoard'),clusters=board.querySelector('.mc-clusters'),rect=canvas.closest('.room-canvas-stage').getBoundingClientRect(),nodes=[...board.querySelectorAll('.room-node')].map(node=>({...node.getBoundingClientRect().toJSON(),type:node.dataset.type}));return {canvas:{rect:rect.toJSON(),width:canvas.clientWidth,height:canvas.clientHeight,left:canvas.scrollLeft,top:canvas.scrollTop},board:{rect:board.getBoundingClientRect().toJSON(),width:board.offsetWidth,height:board.offsetHeight,zoom:board.style.zoom},clusters:clusters&&{rect:clusters.getBoundingClientRect().toJSON(),left:clusters.offsetLeft,top:clusters.offsetTop},nodes,visible:nodes.filter(node=>node.width>0&&node.height>0&&node.right>rect.left&&node.left<rect.right&&node.bottom>rect.top&&node.top<rect.bottom).length};})()`);
  assert.ok(canvasGeometry.canvas.height<=canvasGeometry.canvas.rect.height+1,'canvas remains within its clipped panel: '+JSON.stringify(canvasGeometry.canvas));
  assert.ok(canvasGeometry.visible>0,'streamed nodes must be visible without manually fitting: '+JSON.stringify(canvasGeometry));
  const streamedResult=canvasGeometry.nodes.find(node=>node.type==='test_result'),stageRect=canvasGeometry.canvas.rect;
  assert.ok(streamedResult&&streamedResult.right>stageRect.left&&streamedResult.left<stageRect.right&&streamedResult.bottom>stageRect.top&&streamedResult.top<stageRect.bottom,'the deepest streamed result remains visible before any canvas gestures: '+JSON.stringify(canvasGeometry));
  assert.ok(await evaluate(`(()=>{const columns=[...document.querySelectorAll('.room-topic:first-child .mc-column')].map(node=>node.getBoundingClientRect());return columns.length===3&&columns.every(node=>Math.abs(node.top-columns[0].top)<1)&&columns[0].right<columns[1].left&&columns[1].right<columns[2].left;})()`),'problems, hypotheses and tests remain side by side');
  assert.ok(await evaluate(`(()=>{const svg=document.querySelector('#roomBoard .mc-edges'),r=svg.getBoundingClientRect();return [...svg.querySelectorAll('path[marker-end]')].every(path=>{const p=path.getBoundingClientRect();return path.getTotalLength()>0&&p.left>=r.left&&p.right<=r.right&&p.top>=r.top&&p.bottom<=r.bottom;});})()`),'edge paths fit the actual rendered SVG viewport, unaffected by icon sizing rules');
  const beforeCanvas=JSON.stringify((await snapshot()).meeting_events);
  await click('.mc-node-text');assert.equal(await evaluate('document.querySelector(".mc-node-text").getAttribute("aria-expanded")'),'false','short text has no needless expand/collapse');
  assert.equal(await visible('.room-pan-hint'),false);
  assert.equal(await evaluate('document.querySelector("#roomCounts").textContent'),'2 assuntos');
  assert.ok(await evaluate(`(()=>{const topics=[...document.querySelectorAll('.room-topic')].map(n=>n.getBoundingClientRect());return topics[1].left>topics[0].right&&Math.abs(topics[1].top-topics[0].top)<1;})()`),'topics sit side by side');
  assert.match(await evaluate('document.querySelectorAll(".room-topic-name h2")[1].textContent'),/Norte.*assunto.*é/,'unnamed topic teaches the voice command rather than copying a sentence');
  await click('#roomCounts');assert.equal(await visible('#roomTopicsMenu'),true);assert.equal(await evaluate('document.querySelectorAll(".room-topic-menu-entry").length'),2);await click('#roomCounts');
  await evaluate('document.querySelectorAll(".room-edit-title")[1].click()');assert.equal(await evaluate('document.querySelector("#roomRenameValue").value'),'');
  await evaluate('document.querySelector("#roomRenameValue").value="Caixa do sensor";document.querySelector("#roomRenameForm").requestSubmit()');
  assert.equal((await snapshot()).topic_titles.T002,'Caixa do sensor');assert.equal((await snapshot()).meeting_threads.find(t=>t.thread_id==='T002').title,'Caixa do sensor','manual rename updates actual thread title');
  await click('#roomConnectionsToggle');assert.equal(await evaluate('document.querySelector("#roomConnectionsToggle").getAttribute("aria-pressed")'),'false');assert.equal(await visible('#roomBoard .mc-edges'),false);await click('#roomConnectionsToggle');assert.equal(await visible('#roomBoard .mc-edges'),true);
  const zoomBefore=await evaluate('parseInt(document.querySelector("#roomZoom").textContent,10)');await click('#roomZoomIn');assert.ok(await evaluate('parseInt(document.querySelector("#roomZoom").textContent,10)')>zoomBefore);
  const pan=await evaluate(`(()=>{const canvas=document.querySelector('#roomCanvas'),r=canvas.getBoundingClientRect();return {x:r.left+100,y:r.top+80,left:canvas.scrollLeft,top:canvas.scrollTop};})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:pan.x,y:pan.y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:pan.x,y:pan.y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:pan.x-60,y:pan.y-40,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:pan.x-60,y:pan.y-40,button:'left',buttons:0,clickCount:1});
  assert.ok(await evaluate(`document.querySelector('#roomCanvas').scrollLeft>${pan.left} || document.querySelector('#roomCanvas').scrollTop>${pan.top}`),'dragging the canvas background pans the surface');
  await click('#roomFit');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  for(const [selector,space] of [['.room-node-header',false],['.mc-node-text',true]]){
   const start=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect(),canvas=document.querySelector('#roomCanvas');return {x:r.left+r.width/2,y:r.top+r.height/2,left:canvas.scrollLeft,top:canvas.scrollTop};})()`);
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x,y:start.y});
   if(space)await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
   await call('Input.dispatchMouseEvent',{type:'mousePressed',x:start.x,y:start.y,button:'left',buttons:1,clickCount:1});
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x-70,y:start.y-45,button:'left',buttons:1});
   await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x-70,y:start.y-45,button:'left',buttons:0,clickCount:1});
   if(space)await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
   assert.ok(await evaluate(`document.querySelector('#roomCanvas').scrollLeft>${start.left} && document.querySelector('#roomCanvas').scrollTop>${start.top}`),space?'Space+drag pans even when starting on card text':'dragging a card header pans the canvas');
   assert.equal(await evaluate('document.querySelector(".mc-node-text").getAttribute("aria-expanded")'),'false','panning never opens a card');
   await click('#roomFit');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('.room-canvas-stage').getBoundingClientRect();return [...document.querySelectorAll('#roomBoard .room-node')].some(node=>{const n=node.getBoundingClientRect();return n.width>0&&n.height>0&&n.right>r.left&&n.left<r.right&&n.bottom>r.top&&n.top<r.bottom;});})()`),'fit keeps the nodes visible inside the clipped panel');
  assert.equal(JSON.stringify((await snapshot()).meeting_events),beforeCanvas,'canvas inspection never changes extracted events');
  const wheel=await evaluate(`(()=>{const r=document.querySelector('#roomCanvas').getBoundingClientRect();return {x:r.left+120,y:r.top+120};})()`),wheelZoom=await evaluate('parseInt(document.querySelector("#roomZoom").textContent,10)');
  await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:wheel.x,y:wheel.y,deltaX:0,deltaY:700});
  await wait('parseInt(document.querySelector("#roomZoom").textContent,10)<'+wheelZoom);assert.ok(await evaluate('parseInt(document.querySelector("#roomZoom").textContent,10)')<wheelZoom,'normal wheel zooms');
  for(let index=0;index<9;index++)await click('#roomZoomOut');await wait('document.querySelector("#roomBoard").dataset.detail==="topics"');await screenshot('macro');
  await click('#roomFit');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await screenshot('desktop');
  const callsBeforeReopen=requests.length;
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');await screenshot('library');await openSaved(finished.id);
  assert.equal((await snapshot()).meeting_events.length,7);assert.equal(requests.length,callsBeforeReopen,'reopening stored meetings never repeats inference');
  await click('#manualMode');await wait('document.body.dataset.page==="manual"');assert.equal(await evaluate('document.querySelector("#manualState").value'),manualDraft);
  await click('#meetingMode');await wait('document.body.dataset.page==="meeting"');
  if(await evaluate('NorteMeetingRoom.view()==="library"'))await openSaved(finished.id);
  assert.equal((await snapshot()).id,finished.id);
  await click('#roomMinutes');await wait('document.querySelector("#gmDialog")?.open');assert.equal(requests.filter(item=>item.url==='/api/minutes').length,0);
  assert.match(await evaluate('document.querySelector(".gm-paper").textContent'),/Deformação do suporte/);assert.ok(await evaluate('document.querySelector(".gm-node-test_proposal .gm-node-test_result")'));assert.doesNotMatch(await evaluate('document.querySelector("#gmDialog").textContent'),/Gemini|gerad[oa] por IA/);
  assert.equal(await evaluate('document.querySelectorAll(".gm-source-id,.gm-history").length'),0,'event IDs and discussion-history controls are absent from the document');
  await click('.gm-contents a');
  assert.equal(await evaluate('location.hash'),'#reuniao','source references keep the application route unchanged');
  assert.equal(await evaluate('document.body.dataset.page'),'meeting');
  assert.ok(await evaluate('document.querySelector(".gm-topic .gm-current-list > li")'),'the linked topic keeps its original statements in readable bullet points');
  await evaluate('document.querySelector("#gmDialog").close()');
  await evaluate('NorteMeetingRoom.flushStorage()');const callsBeforeReload=requests.length;
  await evaluate('window.__beforeReload=true');await call('Page.reload');await wait('!window.__beforeReload && window.NorteMeetingRoom?.ready() && NorteMeetingRoom.view()==="library"');
  assert.equal(await snapshot(),null,'reload opens the library rather than entering the last meeting');assert.equal(requests.length,callsBeforeReload);assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);
  await openSaved(finished.id);const restored=await snapshot();assert.equal(restored.topic_titles.T001,'Deformação do suporte');assert.deepEqual(restored.meeting_relations,finished.meeting_relations);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await wait(`(()=>{const stage=document.querySelector('.room-canvas-stage').getBoundingClientRect();return stage.height>0&&[...document.querySelectorAll('#roomBoard .room-node')].some(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>stage.left&&r.left<stage.right&&r.bottom>stage.top&&r.top<stage.bottom;});})()`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.ok(await evaluate(`(()=>{const canvas=document.querySelector('#roomCanvas'),stage=canvas.closest('.room-canvas-stage').getBoundingClientRect();return canvas.clientHeight<=stage.height+1&&canvas.clientWidth<=stage.width+1;})()`),'mobile canvas stays within the visible clipped stage');
  await screenshot('mobile');
  // Canceling an import settles the controls without waiting for a stalled response.
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false});
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');await createInstant();await click('#roomImport');
  await evaluate('document.querySelector("#roomImportText").value="Cancelar antes da resposta.";document.querySelector("#roomImportForm").requestSubmit()');
  for(let i=0;i<100&&!cancelHeld;i++)await sleep(20);assert.ok(cancelHeld);
  const cancelStarted=Date.now();await click('#roomStop');await wait('NorteMeetingRoom.snapshot().status==="interrupted" && !NorteMeetingRoom.isRunning()');
  assert.ok(Date.now()-cancelStarted<1500,'cancel button settles without a pending request finishing');assert.equal(await evaluate('document.querySelector("#roomLiveLabel").textContent'),'Reunião encerrada');
  assert.equal(await evaluate('document.querySelector("#roomBack").disabled'),false);cancelRelease();await sleep(100);assert.equal((await snapshot()).meeting_events.length,0,'late responses never create memories after cancellation');
  const callsBeforeSpeech=requests.length;
  // Speech starts only on its explicit button, and the last final after stop is retained.
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');const spokenDraft=await createInstant();
  assert.equal(await evaluate('(window.__speechInstances||[]).length'),0);assert.equal(requests.length,callsBeforeSpeech);
  await click('#roomLive');await wait('!!window.__speech');
  assert.equal((await snapshot()).id,spokenDraft.id,'recording uses the draft meeting');
  const firstSpokenTurn=utterances.slice(0,2).join(' ');
  await evaluate(`__speech.emit(${JSON.stringify(firstSpokenTurn)},true,0)`);await wait('NorteMeetingRoom.snapshot()?.meeting_events?.length===2');
  assert.equal((await snapshot()).transcript.length,2,'one complete speech turn can yield multiple internal processing chunks');
  assert.equal(await evaluate('document.querySelectorAll(".room-speech").length'),1,'processing chunks are grouped into the original speech turn');
  assert.equal(await evaluate('document.querySelector(".room-speech-text").textContent'),firstSpokenTurn);
  await evaluate(`__speech.emit(${JSON.stringify(utterances[2])},false,1);__speech.finalOnStop=${JSON.stringify(utterances[2])}`);await sleep(80);assert.equal((await snapshot()).transcript.length,2);
  const paused=await evaluate(`(()=>{window.__pausedSpeech=__speech;const button=document.querySelector('#roomLive');button.click();button.click();return {disabled:button.disabled,instances:__speechInstances.length,same:__speech===__pausedSpeech,running:NorteMeetingRoom.isRunning(),navigationDisabled:['manualMode','automatedMode','memoryMode','liveMode'].every(id=>document.getElementById(id).disabled),backDisabled:document.querySelector('#roomBack').disabled};})()`);
  assert.deepEqual(paused,{disabled:true,instances:1,same:true,running:true,navigationDisabled:true,backDisabled:true},'pause cannot race another recognizer or leave a running meeting');
  await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done" && NorteMeetingRoom.snapshot()?.typed_relation_worker?.status==="done"');
  const spoken=await snapshot();assert.equal(spoken.transcript.length,3);assert.equal(spoken.meeting_events.length,3);assert.equal(spoken.transcript[2].text,utterances[2]);assert.equal(spoken.meeting_events.filter(item=>item.text===utterances[0]).length,1);assert.equal(await evaluate('__pausedSpeech.stopCalls'),1);
  assert.equal(await evaluate('document.querySelectorAll(".room-speech").length'),2,'the final speech after stopping remains a separate complete turn');
  await evaluate('NorteMeetingRoom.flushStorage()');const callsBeforeV2=requests.length;
  await evaluate('window.__beforeReload=true');await call('Page.navigate',{url:origin+'/index.html?profile=memory-v2#reuniao'});
  await wait('!window.__beforeReload && window.NorteMeetingRoom?.ready() && window.NorteMemoryPage && window.NorteTypedRelationsPage && document.body.dataset.page==="meeting" && NorteMeetingRoom.view()==="library"');
  assert.equal(await snapshot(),null);assert.equal(await evaluate('document.querySelector("#memoryPage").dataset.profile'),'memory-v2');
  await click('#memoryV2Mode');await wait('document.body.dataset.page==="memory"');assert.equal(await evaluate('location.hash'),'#memoria');assert.equal(await evaluate('document.querySelector("#mfTypedQuestions").hidden'),false);
  await click('#meetingMode');await wait('document.body.dataset.page==="meeting" && NorteMeetingRoom.view()==="library"');await openSaved(spoken.id);assert.equal((await snapshot()).id,spoken.id);assert.equal(requests.length,callsBeforeV2);
  // Conflicts and incomplete links belong to explicit diagnostics, independent of zoom.
  await click('#roomBack');await wait('NorteMeetingRoom.view()==="library"');await createInstant();await click('#roomImport');
  await evaluate(`document.querySelector('#roomImportText').value=${JSON.stringify(attentionText.map((text,index)=>'[00:0'+index+':00] Participante: '+text).join('\n'))};document.querySelector('#roomImportForm').requestSubmit()`);
  await wait('NorteMeetingRoom.snapshot()?.status==="done" && NorteMeetingRoom.snapshot()?.typed_relation_worker?.status==="done"');
  await wait('!!document.querySelector("#roomAlerts .room-alert-item[data-kind=conflict]")');
  assert.equal(await visible('#roomAlerts'),true);assert.equal(await visible('#roomPending'),true);
  assert.ok(await evaluate('document.querySelectorAll("#roomAlerts .room-alert-item[data-kind=review]").length>=1'));
  assert.equal(await evaluate('document.querySelector(".room-node[data-type=requirement]").dataset.canvasStatus'),'conflict','a contradicted requirement is red');
  assert.equal(await evaluate('document.querySelector(".room-node[data-type=hypothesis]").dataset.canvasStatus'),'open','an uncertain link does not turn its endpoints into classification errors');
  assert.equal(await evaluate('document.querySelector(".room-node[data-type=test_proposal]").dataset.canvasStatus'),'open','a mismatched result never completes the planned test');
  assert.equal(await evaluate('document.querySelectorAll(".mc-node-info").length'),4,'every record has an information icon');
  await click('#roomPendingCount');assert.equal(await visible('#roomPendingList'),true);
  const beforeInspect=JSON.stringify((await snapshot()).meeting_events);
  await click('#roomAlerts .room-alert-item[data-kind=conflict]');await wait('!!document.querySelector(".room-diagnostics[open]")');
  assert.match(await evaluate('document.querySelector(".room-diagnostics").textContent'),/contradiz|contrária/i);
  assert.match(await evaluate('document.querySelector(".room-diagnostic-log pre").textContent'),/contradicts/);
  await evaluate('document.querySelector(".room-diagnostics").close()');
  assert.equal(JSON.stringify((await snapshot()).meeting_events),beforeInspect,'inspection never edits original extracted records');
  await click('#roomPendingCount');await click('#roomFit');await screenshot('attention');
  if(process.env.MEETING_ROOM_LIVE_RUN){
   const real=JSON.parse(await fs.readFile(process.env.MEETING_ROOM_LIVE_RUN,'utf8')),run=real.run||real;
   await evaluate(`(async()=>{await NorteMeetingRoom.flushStorage();const db=await NorteMemoryStorage.open();const run=${JSON.stringify(run)};await db.write('norte.meeting-room.session.v2.'+run.id,JSON.stringify(run));await db.change('norte.meeting-room.index.v2',raw=>({value:JSON.stringify([{id:run.id,title:run.title,date:run.createdAt,status:run.status},...JSON.parse(raw||'[]').filter(item=>item.id!==run.id)]),result:true}));db.close();window.__beforeReload=true;})()`);
   await call('Page.reload');await wait('!window.__beforeReload && window.NorteMeetingRoom?.ready() && NorteMeetingRoom.view()==="library"');await openSaved(run.id);await wait('document.querySelectorAll("#roomBoard .room-node").length==='+String(run.meeting_events.length));await screenshot('real');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: empty library, scoped legacy migration, draft creation without recording/inference, disabled scheduling, same-session import, visible hierarchical canvas with text disclosure/zoom/pan, transcript toggle/keyboard resize, list/reopen/reload, explicit recording with final speech retained, existing navigation/drafts, local minutes, mobile and concurrent V2 imports.');
 }finally{
  gateRelease();cancelRelease();socket?.close();
  await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);chrome.kill('SIGTERM');});
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
