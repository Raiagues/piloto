// Real deployment smoke. Explicit opt-in creates one ordinary test account and
// sends two natural commands through the actual page, including Jev validation.
// Run only AFTER the intended commit is deployed:
// NORTE_URL=https://norte-r007.onrender.com node tests/browser-deployed-smoke.cjs --run-live
// Set BOTH NORTE_TEST_USERNAME and NORTE_TEST_PASSWORD to reuse a test account.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),{setTimeout:sleep}=require('node:timers/promises');
const ROOT=path.resolve(__dirname,'..'),REPORT=path.join(ROOT,'.runtime/deployed-smoke.json'),SCREENSHOT=path.join(ROOT,'.runtime/deployed-smoke.png');
const PAID=/^\/api\/(?:classify|relations|typed-relations|minutes)$/;
async function main(){
 if(!process.argv.includes('--run-live'))throw Error('Use --run-live somente depois de validar o deploy.');
 if(!process.env.NORTE_URL)throw Error('NORTE_URL é obrigatório.');
 const target=new URL(process.env.NORTE_URL);
 if(target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('NORTE_URL deve conter apenas a origem HTTPS, sem credenciais.');
 if(target.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(target.hostname)&&target.protocol==='http:'))throw Error('Use HTTPS para o servidor remoto.');
 const origin=target.origin,reuse=!!process.env.NORTE_TEST_USERNAME||!!process.env.NORTE_TEST_PASSWORD;
 if(reuse&&!(process.env.NORTE_TEST_USERNAME&&process.env.NORTE_TEST_PASSWORD))throw Error('Informe NORTE_TEST_USERNAME e NORTE_TEST_PASSWORD juntos.');
 const username=process.env.NORTE_TEST_USERNAME||'teste_codex_'+randomBytes(5).toString('hex');
 let password=process.env.NORTE_TEST_PASSWORD||randomBytes(24).toString('base64url'),cookie='',chrome=null,socket=null,profile=null,call=null;
 const requests=[],responses=[],runtimeErrors=[];
 const report={created_at:new Date().toISOString(),origin,username,reused_account:reuse,account_created:false,meeting_id:null,checks:[],commands:[],passed:false};
 const began=Date.now();let phase='authentication';
 const check=(name,passed,details={})=>{report.checks.push({name,passed,...details});assert.ok(passed,name);};
 try{
  const body={username,password,...(!reuse&&process.env.NORTE_SIGNUP_CODE?{code:process.env.NORTE_SIGNUP_CODE}:{})};
  const auth=await fetch(origin+'/api/auth/'+(reuse?'login':'signup'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  report.auth_status=auth.status;check('account_authenticated',auth.status===200);
  const account=await auth.json();cookie=(auth.headers.get('set-cookie')||'').split(';')[0];password='';
  check('ordinary_account',!!cookie&&!!account.user&&account.user.role!=='admin'&&account.user.is_admin!==true);
  report.account_created=!reuse;report.account_role=account.user.role||'user';
  console.log('Conta comum autenticada; iniciando navegador do deploy.');
  phase='browser_start';profile=await fs.mkdtemp(path.join(os.tmpdir(),'norte-deployed-smoke-'));
  chrome=spawn(process.env.CHROME_BIN||'google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let launchError=false;chrome.once('error',()=>{launchError=true;});chrome.stderr.on('data',()=>{});
  let port;
  for(let attempt=0;attempt<600;attempt++){
   if(launchError||chrome.exitCode!==null)throw Error('browser_start_failed');
   try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){}
   await sleep(100);
  }
  if(!port)throw Error('browser_start_timeout');
  const tabs=await fetch('http://127.0.0.1:'+port+'/json/list').then(response=>response.json());
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('browser_socket_timeout')),15000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('browser_socket_error'));},{once:true});});
  let next=0;const pending=new Map();
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('browser_call_timeout'));},95000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:()=>{clearTimeout(timer);reject(Error('browser_call_failed'));}});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message',event=>{
   const message=JSON.parse(event.data);
   if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject():item.resolve(message.result);}return;}
   if(message.method==='Runtime.exceptionThrown')runtimeErrors.push({phase:phase,message:'uncaught_browser_exception'});
   if(message.method==='Page.javascriptDialogOpening')call('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
   if(message.method==='Network.requestWillBeSent'){
    const request=message.params.request,url=new URL(request.url);if(url.origin===origin&&url.pathname.startsWith('/api/'))requests.push({path:url.pathname,method:request.method,phase});
   }
   if(message.method==='Network.responseReceived'){
    const response=message.params.response,url=new URL(response.url);if(url.origin===origin&&url.pathname.startsWith('/api/'))responses.push({path:url.pathname,status:response.status,phase});
   }
  });
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('page_evaluation_failed');return result.result.value;};
  const wait=async(expression,label)=>{const deadline=Date.now()+90000;while(Date.now()<deadline){try{if(await evaluate(expression))return;}catch(error){if(error.message!=='page_evaluation_failed')throw error;}await sleep(200);}throw Error('wait_'+label);};
  const click=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Control unavailable');e.click();})()`);
  const visible=selector=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.getClientRects().length`);
  const snapshot=()=>evaluate('NorteMeetingRoom.snapshot()');
  const drained=()=>wait('(()=>{const r=NorteMeetingRoom.snapshot();return !!r&&r.transcript.every(t=>["done","command"].includes(t.status))&&r.records.every(x=>x.status==="done")&&r.thread_worker.jobs.every(x=>x.status==="done")&&r.typed_relation_worker.jobs.every(x=>["done","skipped"].includes(x.status));})()','pipeline_drained');
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1050,deviceScaleFactor:1,mobile:false});
  const equal=cookie.indexOf('='),setCookie=await call('Network.setCookie',{name:cookie.slice(0,equal),value:cookie.slice(equal+1),url:origin+'/',path:'/',httpOnly:true,secure:target.protocol==='https:',sameSite:'Lax'});
  check('browser_cookie_set',setCookie.success===true);
  phase='open_page';await call('Page.navigate',{url:origin+'/index.html#simulacao'});
  await wait('window.NorteMeetingRoom?.ready()&&window.NorteClassifier?.isAvailable()&&document.body.dataset.page==="beam"','simulation_page');
  phase='create_draft';await click('#roomNew');await wait('!document.querySelector("#roomCreateMenu").hidden','create_menu');await click('#roomCreateInstant');
  await wait('NorteMeetingRoom.snapshot()?.status==="draft"&&!!window.NorteMeetingBeam','draft');
  const draft=await snapshot();report.meeting_id=draft.id;check('beam_draft',draft.room_kind==='beam');
  const labels=await evaluate('[...document.querySelectorAll("#beamRoomTabs button")].filter(e=>e.getClientRects().length).map(e=>e.textContent)');
  check('five_discoverable_tabs',JSON.stringify(labels)===JSON.stringify(['Canvas','Simulação','Gráficos','Resultados','Cálculos']),{labels});
  phase='manual_navigation';const paidBefore=requests.filter(item=>PAID.test(item.path)).length;
  for(const tab of ['simulation','graphs','results','calculations']){await click('#beamTab-'+tab);await wait(`NorteMeetingRoom.snapshot().beam_view===${JSON.stringify(tab)}`,'tab_'+tab);check('visible_'+tab,await visible('#beamRoomHost'));}
  await sleep(800);
  check('manual_navigation_without_model_requests',requests.filter(item=>PAID.test(item.path)).length===paidBefore,{paid_requests:requests.filter(item=>PAID.test(item.path)).length-paidBefore});
  const command=async text=>{
   const count=(await snapshot()).beam_commands?.length||0,start=Date.now();
   if(!await visible('#beamCommandForm'))await click('#beamComposeToggle');
   await wait('!document.querySelector("#beamCommandText").disabled','composer_ready');
   await evaluate(`document.querySelector('#beamCommandText').value=${JSON.stringify(text)};document.querySelector('#beamCommandForm').requestSubmit();`);
   await wait('(NorteMeetingRoom.snapshot()?.beam_commands?.length||0)>'+count,'command_applied');
   const audit=(await snapshot()).beam_commands.at(-1);report.commands.push({text,status:audit.status,routing:audit.routing||null,latency_ms:Date.now()-start,operations:audit.operations,model:audit.outputs?.[0]?.response?.model||null});
   check('command_applied_'+(count+1),audit.status==='applied');await drained();return audit;
  };
  phase='natural_open';console.log('Abas visíveis e navegação local verificadas; testando dois pedidos naturais.');
  const open=await command('quero fazer uma simulação');check('natural_open_local',open.routing==='local_navigation'&&open.operations.some(op=>op.type==='open_simulation'));
  phase='natural_edit';await command('muda a força P1 para 12 kN');
  let run=await snapshot();check('force_p1_12_kn',run.beam_lab.state.loads.find(load=>load.id==='p1')?.value===12000);
  check('only_two_spoken_commands',run.beam_commands.length===2);
  phase='persist';await click('#roomFinish');await wait('NorteMeetingRoom.snapshot()?.status==="done"&&!NorteMeetingRoom.isRunning()','meeting_finished');
  await evaluate('NorteMeetingRoom.flushStorage()');await evaluate('NorteAI.flush()');await sleep(1000);await evaluate('NorteAI.flush()');
  run=await snapshot();report.meeting_status=run.status;report.final_state={length_m:run.beam_lab.state.L,force_p1_N:run.beam_lab.state.loads.find(load=>load.id==='p1')?.value};
  phase='account_boundaries';
  const aliases=await fetch(origin+'/api/ai/aliases',{headers:{Cookie:cookie},signal:AbortSignal.timeout(90000)});check('account_aliases_200',aliases.status===200,{status:aliases.status});
  check('telemetry_events_200',responses.some(item=>item.path==='/api/ai/events'&&item.status===200));
  const restricted=await fetch(origin+'/api/admin/ai/overview',{headers:{Cookie:cookie},signal:AbortSignal.timeout(90000)});check('admin_forbidden_403',restricted.status===403,{status:restricted.status});
  check('no_minutes_generation',!requests.some(item=>item.path==='/api/minutes'));
  check('no_browser_exceptions',runtimeErrors.length===0,{count:runtimeErrors.length});
  phase='screenshot';await click('#beamTab-results');await fs.mkdir(path.dirname(SCREENSHOT),{recursive:true});
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(SCREENSHOT,Buffer.from(shot.data,'base64'));report.screenshot=SCREENSHOT;
  report.passed=true;
 }catch(error){report.failed_phase=phase;report.error_code=/^[a-z_0-9]+$/.test(error.message)?error.message:'smoke_assertion_failed';}
 finally{
  password='';cookie='';
  if(socket?.readyState===WebSocket.OPEN){try{await call('Browser.close');}catch(_){}socket.close();}
  if(chrome?.pid&&chrome.exitCode===null&&chrome.signalCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await Promise.race([exited,sleep(2000)]);if(chrome.exitCode===null&&chrome.signalCode===null){chrome.kill('SIGKILL');await exited;}}
  if(profile)await fs.rm(profile,{recursive:true,force:true});
  report.elapsed_ms=Date.now()-began;report.network={model_requests:requests.filter(item=>PAID.test(item.path)).length,telemetry_requests:requests.filter(item=>item.path==='/api/ai/events').length,api_responses:responses};report.browser_errors=runtimeErrors;
  await fs.mkdir(path.dirname(REPORT),{recursive:true});await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,username:report.username,meeting_id:report.meeting_id,checks:report.checks.length,model_requests:report.network.model_requests,failed_phase:report.failed_phase||null,error_code:report.error_code||null,report:REPORT,screenshot:report.screenshot||null}));
  if(!report.passed)process.exitCode=1;
 }
}
main().catch(error=>{console.error(/NORTE_|HTTPS|--run-live/.test(error.message)?error.message:'Não foi possível iniciar o smoke do deploy.');process.exitCode=1;});
