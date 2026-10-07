// Real server.py + real Chrome: sign-up, roles and meetings saved in the account.
// No paid calls: the TypeSafe key is blanked and no meeting is started.
// Optional: TEST_DATABASE_URL=postgresql://… runs it against Postgres instead of a temp SQLite file.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'norte-accounts-'));
  const port=await new Promise(resolve=>{const probe=net.createServer().listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(()=>resolve(value));});});
  const base='http://127.0.0.1:'+port,python=process.env.PYTHON||'python3';
  const env={...process.env,NORTE_PROVIDER:'official',TYPESAFE_API_KEY:'COLE_SUA_CHAVE_AQUI',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'admin-teste-123',
    NORTE_SQLITE_PATH:path.join(temp,'accounts.sqlite3'),DATABASE_URL:process.env.TEST_DATABASE_URL||''};
  const server=spawn(python,[path.join(root,'server.py'),'--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let serverLog='';server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);
  const profile=path.join(temp,'chrome');
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let socket;
  try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch(_){}await sleep(100);}
    assert.equal(await fetch(base+'/healthz').then(r=>r.text()),'ok','server started: '+serverLog);
    let devtools;for(let i=0;i<100;i++){try{devtools=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(100);}}
    const tabs=await fetch('http://127.0.0.1:'+devtools+'/json/list').then(r=>r.json());
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map(),errors=[];
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async(expression,tries=200)=>{for(let i=0;i<tries;i++){try{if(await evaluate(expression))return;}catch(_){}await sleep(50);}throw Error('Timed out: '+expression+'; errors: '+JSON.stringify(errors));};
    const field=(selector,value)=>evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const visibleNav=()=>evaluate(`[...document.querySelectorAll('#sidebarNav .nav-item')].filter(n=>getComputedStyle(n).display!=='none').map(n=>n.id)`);
    const shot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(os.tmpdir(),'norte-accounts-'+name+'.png'),Buffer.from(image.data,'base64'));};
    const go=async url=>{await call('Page.navigate',{url});await sleep(200);};
    await call('Runtime.enable');await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});

    // Signed out: every page leads to the sign-in screen.
    await go(base+'/#simulacao');
    await wait('location.pathname==="/login" && !!document.querySelector("#authForm")');
    await shot('login');
    await click('#tabSignup');
    await field('#username','Ana.Teste');await field('#password','senha-da-ana');await field('#confirm','senha-diferente');
    await click('#authSubmit');
    await wait('document.querySelector("#authError").textContent.includes("não conferem")');
    await field('#confirm','senha-da-ana');await click('#authSubmit');

    // A regular account lands on the beam-simulation meetings and sees nothing else.
    await wait('location.pathname==="/" && document.body.dataset.page==="beam" && window.NorteMeetingRoom && !document.querySelector("#roomNew").disabled');
    assert.equal(await evaluate('document.body.dataset.role'),'user');
    assert.deepEqual(await visibleNav(),['beamMode']);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell")).visibility'),'visible');
    assert.equal(await evaluate('document.querySelector("#roomLibraryHeader h1").textContent'),'Simulação de vigas');
    assert.equal(await evaluate('document.querySelector("#accountLogout small").textContent'),'ana.teste');
    for(const hash of ['#manual','#automatizados','#memoria','#reuniao','#ao-vivo']){
      await evaluate(`location.hash=${JSON.stringify(hash)}`);await sleep(150);
      assert.equal(await evaluate('document.body.dataset.page'),'beam','regular account stays on the simulation for '+hash);
    }
    assert.equal(await evaluate('fetch("/manual-test-example.json").then(r=>r.status)'),404);
    await shot('user-library');

    // Meetings are saved in the account, not in this browser.
    await click('#roomNew');await click('#roomCreateInstant');
    await wait('!document.querySelector("#meetingPage").hidden && document.querySelector("#roomSave").textContent.includes("conta")');
    await field('#roomTitle','Viga da garagem');await evaluate('document.querySelector("#roomTitle").dispatchEvent(new Event("change",{bubbles:true}))');
    await evaluate('NorteMeetingRoom.flushStorage()');
    await wait('document.querySelector("#roomSave").textContent==="Salvo na sua conta"');
    await shot('user-meeting');
    const index=await evaluate('fetch("/api/records?key=norte.meeting-room.index.v2").then(r=>r.json())');
    assert.equal(JSON.parse(index.value).length,1);assert.equal(JSON.parse(index.value)[0].room_kind,'beam');
    assert.equal(await evaluate(`new Promise(resolve=>{const r=indexedDB.open('norte-memory',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>{const tx=r.result.transaction('records','readonly').objectStore('records').get('norte.meeting-room.index.v2');tx.onsuccess=()=>resolve(tx.result??null);};})`),null,'nothing stored in the browser');

    // Sign out, then the admin sees every page and has no access to Ana's meetings.
    await click('#accountLogout');
    await wait('location.pathname==="/login"');
    await field('#username','admin');await field('#password','senha-errada');await click('#authSubmit');
    await wait('document.querySelector("#authError").textContent==="Usuário ou senha incorretos."');
    await field('#password','admin-teste-123');await click('#authSubmit');
    await wait('location.pathname==="/" && document.body.dataset.role==="admin" && window.NorteLab && document.body.dataset.page==="live" && !document.querySelector("#manualMode").disabled');
    assert.deepEqual(await visibleNav(),['liveMode','manualMode','automatedMode','memoryMode','memoryV2Mode','meetingMode','beamMode']);
    await click('#manualMode');await wait('document.body.dataset.page==="manual"');
    await click('#beamMode');await wait('document.body.dataset.page==="beam" && window.NorteMeetingRoom && !document.querySelector("#roomNew").disabled');
    assert.equal(await evaluate('document.querySelector("#roomLibraryCount").textContent'),'0 reuniões');
    await shot('admin');

    // Ana signs in again (new tab state) and finds her meeting.
    await click('#accountLogout');await wait('location.pathname==="/login"');
    await field('#username','ana.teste');await field('#password','senha-da-ana');await click('#authSubmit');
    await wait('document.body.dataset.page==="beam" && document.querySelectorAll("#roomLibraryList tr").length===1');
    assert.equal(await evaluate('document.querySelector("#roomLibraryList .room-open-meeting").textContent'),'Viga da garagem');
    assert.deepEqual(errors,[],'no uncaught page errors');
    console.log('browser-accounts: ok ('+(process.env.TEST_DATABASE_URL?'postgres':'sqlite')+')');
  }finally{
    socket?.close();chrome.kill();server.kill();
    await sleep(300);await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});
  }
})().catch(error=>{console.error(error);process.exit(1);});
