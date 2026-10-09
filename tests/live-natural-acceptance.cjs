// Explicit opt-in. Uses a temporary local account and at most eight real Jev
// requests. Expectations and credentials never enter a classification request.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {spawn}=require('node:child_process'),{randomBytes}=require('node:crypto'),{setTimeout:sleep}=require('node:timers/promises');
const C=require('../beam-commands.js'),B=require('../beam-engine.js');
const ROOT=path.resolve(__dirname,'..'),REPORT=path.join(ROOT,'.runtime/live-natural-acceptance.json'),MAX_CALLS=8;
async function freePort(){const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));return port;}
async function main(){
 if(!process.argv.includes('--run-live'))throw Error('Use --run-live somente com autorização para consumir créditos da API.');
 const started=Date.now(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'norte-live-natural-')),port=await freePort(),origin='http://127.0.0.1:'+port;
 const report={created_at:new Date().toISOString(),fixture:true,scope:'temporary_account_real_jev_parser_acceptance',max_api_calls:MAX_CALLS,gemini_calls:0,account:{created:false,temporary_database:true},cases:[]};
 const server=spawn('python3',['server.py','--host','127.0.0.1','--port',String(port)],{cwd:ROOT,env:{...process.env,
  NORTE_SQLITE_PATH:path.join(directory,'smoke.sqlite3'),DATABASE_URL:'',ADMIN_USERNAME:'smoke-admin',ADMIN_PASSWORD:randomBytes(18).toString('hex'),
  SIGNUP_CODE:'',ALLOWED_HOSTS:'127.0.0.1,localhost',NORTE_PROVIDER:'official',AI_AGENTS_ENABLED:'false',AI_EXTERNAL_REVIEW_ENABLED:'false',AI_AUTO_PUBLISH:'false'},stdio:['ignore','ignore','pipe']});
 // Startup diagnostics may contain environment-specific paths; only an error
 // code is retained in the shareable report. Never print or save server output.
 server.stderr.on('data',()=>{});
 let serverError=false,cookie='',calls=0,state=B.defaultState();server.once('error',()=>{serverError=true;});
 try{
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
   if(serverError||server.exitCode!==null)throw Error('server_start_failed');
   try{const health=await fetch(origin+'/healthz',{signal:AbortSignal.timeout(600)});if(health.ok){ready=true;break;}}catch(_){}
   await sleep(100);
  }
  if(!ready)throw Error('server_start_timeout');
  const signup=await fetch(origin+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'smoke-'+randomBytes(6).toString('hex'),password:randomBytes(18).toString('hex')}),signal:AbortSignal.timeout(5000)});
  if(!signup.ok)throw Error('signup_http_'+signup.status);
  const account=await signup.json();cookie=(signup.headers.get('set-cookie')||'').split(';')[0];
  if(!cookie||account.user?.role==='admin'||account.user?.is_admin===true)throw Error('test_account_invalid');
  report.account.created=true;report.account.role=account.user?.role||'user';
  const health=await fetch(origin+'/api/health',{headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)});
  if(!health.ok||(await health.json()).ready!==true)throw Error('jev_not_configured');
  const transport=async(request,meta)=>{
   if(calls>=MAX_CALLS)throw Error('live_call_limit');calls++;
   const response=await fetch(origin+'/api/classify',{method:'POST',headers:{'Content-Type':'application/json','X-Norte-Provider':'official',Cookie:cookie},body:JSON.stringify(request),signal:meta.signal});
   if(!response.ok)throw Error('classify_http_'+response.status);
   return response.json();
  };
  const execute=async(text,kind,expected)=>{
   const before=JSON.stringify(state),priorCalls=calls,time=Date.now();
   const audit=await C.process(text,{state,active:kind!=='navigation',activeTab:'simulation',source:'typed',provider:'official',timeoutMs:45000,transport});
   const pure=before===JSON.stringify(state);let passed=pure,error=null;
   if(kind==='navigation')passed&&=audit.status==='proposed'&&audit.operations.length===1&&audit.operations[0].type===expected&&calls===priorCalls&&audit.routing==='local_navigation';
   else if(kind==='negative')passed&&=!audit.consumed&&audit.operations.length===0&&calls===priorCalls;
   else{
    passed&&=audit.status==='proposed'&&calls===priorCalls+1;
    if(audit.status==='proposed')try{state=B.applyOperations(state,audit.operations).state;passed&&=Math.abs((expected.field==='L'?state.L:state.loads[0].value)-expected.value)<1e-8;}catch(_){passed=false;error='operation_rejected';}
   }
   const classifications=Object.fromEntries(Object.entries(audit.classifications||{}).map(([id,answer])=>[id,{choice:answer.choice,probability:answer.probabilities?.[answer.choice]}]));
   const row={text,kind,passed,status:audit.status,routing:audit.routing||'jev',latency_ms:Date.now()-time,api_calls:calls-priorCalls,
    provider:audit.outputs[0]?.provider||null,model:audit.outputs[0]?.response?.model||null,provider_latency_ms:audit.outputs[0]?.latencyMs??null,
    interpreted_text:audit.interpreted_text,operations:audit.operations,classifications,issues:audit.issues||[],error_code:error||audit.error_code||null,
    state_after:{length_m:state.L,force_p1_N:state.loads[0].value}};
   report.cases.push(row);console.log(JSON.stringify({text,kind,passed,status:row.status,latency_ms:row.latency_ms,api_calls:row.api_calls,model:row.model,classifications}));
  };
  for(const text of ['quero abrir a simulação','quero fazer uma simulação','abirr simulação','vamos simular uma viga','simula a viga'])await execute(text,'navigation','open_simulation');
  await execute('mostra os cálculos','navigation','show_calculations');
  for(const [text,expected] of [
   ['mude o comprimento da viga para 5 metros',{field:'L',value:5}],
   ['reduza o comprimento da viga em 10%',{field:'L',value:4.5}],
   ['mude a força P1 para 12 kN',{field:'value',value:12000}],
   ['aumenta a força P1 em 10%',{field:'value',value:13200}]
  ])await execute(text,'edit',expected);
  for(const text of ['não reduza o comprimento da viga para 2 metros','se aumentar a força P1 para 20 kN'])await execute(text,'negative');
 }catch(error){report.error_code=/^[a-z_]+(?:_\d+)?$/.test(error.message)?error.message:'smoke_failed';}
 finally{
  cookie='';
  const running=()=>!serverError&&server.exitCode===null&&server.signalCode===null;
  if(running()){
   const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
   await Promise.race([exited,sleep(3000)]);
   if(running()){server.kill('SIGKILL');await exited;}
  }
  await fs.rm(directory,{recursive:true,force:true});report.account.temporary_database_removed=true;
  const live=report.cases.filter(row=>row.api_calls),latencies=live.map(row=>row.latency_ms);
  report.summary={total:report.cases.length,passed:report.cases.filter(row=>row.passed).length,failed:report.cases.filter(row=>!row.passed).length,
   api_calls:calls,real_model_responses:live.filter(row=>row.model).length,elapsed_ms:Date.now()-started,
   mean_live_latency_ms:latencies.length?Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length):null,final_state:{length_m:state.L,force_p1_N:state.loads[0].value}};
  await fs.mkdir(path.dirname(REPORT),{recursive:true});await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({summary:report.summary,error_code:report.error_code||null,report:REPORT}));
  if(report.error_code||report.summary.failed||report.summary.total!==12)process.exitCode=1;
 }
}
main().catch(()=>{console.error('Não foi possível concluir o smoke local. Nenhuma credencial foi registrada.');process.exitCode=1;});
