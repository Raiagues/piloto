// Browser rendering/control fixtures only. These numbers do not measure product accuracy.
// Covers admin metrics semantics, runtime contracts, queue/rollback, offline state and PDF.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=await fs.mkdtemp(path.join(os.tmpdir(),'norte-observatory-'));
  const requests=[],errors=[];let offline=false;
  const data={
    metrics:{events:32,decisions:20,successes:18,unrecognized:2,errors:1,human_labeled:0,human_accuracy:null,accuracy:null,success_rate:.9,learning_rate:.5,published_proposals:1,active_aliases:1,proposals:2,latency_p50_ms:85,latency_p95_ms:150,provider_calls:8,input_tokens:1234,output_tokens:123,estimated_cost_usd:.0345,unknown_cost_calls:2,recoveries_detected:3,automatic_evaluations:1},
    daily:[{day:'2026-10-08',events:12,successes:11,errors:1,cost_usd:.01},{day:'2026-10-09',events:20,successes:18,errors:0,cost_usd:.0245}],
    jobs:[{id:'JOB-1',kind:'audit',status:'done',attempts:1,created_at:1791543600,updated_at:1791543620,result:{evidence:'<img src=x onerror=alert(1)>',proposal_id:'RULE-1'}}],
    proposals:[{id:'RULE-1',phrase:'abrirr o simulador',intent:'open_simulation',status:'published',reason:'Repetição seguida de navegação',evidence_count:3,evaluation:{passed:24,total:24},created_at:1791543620}],
    aliases:[{id:'RULE-1',phrase:'abrirr o simulador',intent:'open_simulation',status:'active',created_at:1791543620}],
    evaluations:[{id:'EVAL-1',kind:'replay',passed:23,total:24,created_at:1791543620,details:{scope:'server_intent_adapter'}}],
    settings:{agents_enabled:true,external_review_enabled:true,agent_provider:'openai',agent_model:'gpt-4.1-mini',provider_configured:true,provider_status:{provider:'openai',model:'gpt-4.1-mini',configured:true,verified:false,last_status:'untested',last_check_at:null,last_error:null},gemini_configured:false,paid_agents_ready:true,auto_publish:true,retention_days:30,worker_mode:'inline',daily_budget_usd:1,daily_spend_usd:.03,daily_calls_used:2,daily_call_limit:50}
  };
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),name=url.pathname.slice(1)||'index.html';
      const json=(value,status=200)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));
      if(url.pathname==='/api/health')return json({ready:true,provider:'official',engine:'jev-latest'});
      if(url.pathname.startsWith('/api/admin/ai/')){
        if(offline)return json({error:'Servidor temporariamente indisponível'},503);
        let raw='';for await(const part of req)raw+=part;
        const body=raw?JSON.parse(raw):null;requests.push({path:url.pathname,body});
        if(url.pathname.endsWith('/overview'))return json(data);
        if(url.pathname.endsWith('/aliases')){assert.equal(body.id,'RULE-1');assert.equal(body.action,'disable');data.aliases[0].status='disabled';data.metrics.active_aliases=0;return json({ok:true});}
        return json({job_id:'JOB-'+requests.length,status:'queued'});
      }
      if(!/^[\w-]+\.(js|css|html)$/.test(name)&&name!=='classifier-config.json')return res.writeHead(404).end();
      const file=await fs.readFile(path.join(root,name));
      const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html';
      res.writeHead(200,{'Content-Type':type}).end(file);
    }catch(error){res.writeHead(500).end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,profile=path.join(temp,'chrome');
  const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--no-first-run','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
  let socket;
  try{
    let devtools;for(let i=0;i<100;i++){try{devtools=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch(_){await sleep(100);}}
    const tabs=await fetch('http://127.0.0.1:'+devtools+'/json/list').then(r=>r.json());
    socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
    let next=0;const pending=new Map();
    socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
    const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    const wait=async(expression,tries=200)=>{for(let i=0;i<tries;i++){try{if(await evaluate(expression))return;}catch(_){}await sleep(50);}throw Error('Timed out: '+expression+'; errors: '+JSON.stringify(errors));};
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const shot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(os.tmpdir(),'norte-observatory-'+name+'.png'),Buffer.from(image.data,'base64'));};
    await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:base+'/#agentes'});
    await wait('document.body.dataset.page==="observatory" && document.querySelectorAll(".ao-metric").length===4');
    const cards=await evaluate('[...document.querySelectorAll(".ao-metric")].map(n=>n.textContent)');
    assert.match(cards[0],/Acerto validado—Aguardando/,'operational success never becomes accuracy');
    assert.match(cards[1],/90%/);assert.match(cards[3],/1 publicadas \/ 2 propostas/);
    assert.equal(await evaluate('document.querySelectorAll(".ao-chart-column").length'),2);
    assert.match(await evaluate('document.querySelector("#aoCosts").textContent'),/Chamadas com custo desconhecido2/);
    assert.equal(await evaluate('document.querySelector("#aoProviderModel").textContent'),'OpenAI · gpt-4.1-mini');
    assert.equal(await evaluate('document.querySelector("#aoProviderConfiguration").textContent'),'Chave e tarifas configuradas');
    assert.equal(await evaluate('document.querySelector("#aoProviderConnection").textContent'),'Ainda não verificado','configuration is not a connection check');
    assert.equal(await evaluate('document.querySelector("#aoProviderNotice").hidden'),true);
    data.settings.agent_provider='gemini';data.settings.agent_model='gemini-3.1-flash-lite';
    data.settings.provider_status={provider:'gemini',model:'gemini-3.1-flash-lite',configured:true,verified:false,last_status:'error',last_check_at:1791543620,last_error:{code:'HTTPError',http_status:403,raw_body:'SENSITIVE_PROVIDER_RESPONSE_MUST_NOT_RENDER',api_key:'SECRET_MUST_NOT_RENDER'}};
    await evaluate('NorteAIObservatory.refresh()');
    assert.equal(await evaluate('document.querySelector("#aoProviderConnection").textContent'),'Acesso negado · HTTP 403');
    assert.match(await evaluate('document.querySelector("#aoProviderNotice").textContent'),/^Última chamada a Gemini: Acesso negado/);
    assert.equal(await evaluate('document.querySelector("#aiObservatoryPage").textContent.includes("MUST_NOT_RENDER")'),false,'only sanitized HTTP metadata reaches UI');
    data.settings.agent_provider='openai';data.settings.agent_model='gpt-4.1-mini';
    data.settings.provider_status={provider:'openai',model:'gpt-4.1-mini',configured:true,verified:true,last_status:'success',last_check_at:1791543630,last_error:null};
    await evaluate('NorteAIObservatory.refresh()');
    assert.equal(await evaluate('document.querySelector("#aoProviderConnection").textContent'),'Última chamada bem-sucedida');
    assert.equal(await evaluate('document.querySelector("#aoProviderNotice").hidden'),true,'selected provider success clears previous provider warning');
    await shot('overview');
    await click('#aoArchitectureTab');await wait('document.querySelectorAll(".ao-question").length===13');
    assert.equal(await evaluate('document.querySelector("#ao-q-beam_action .ao-instructions").textContent===NorteBeamCommands.defaults.questions.beam_action.instructions'),true);
    assert.equal(await evaluate('document.querySelector("#ao-q-speech_status .ao-instructions").textContent===NorteMeetingSession.speechGate.questions.speech_status.instructions'),true);
    await click('[data-node="events"]');assert.match(await evaluate('document.querySelector("#aoNodeDetail").textContent'),/should_store_memory/);
    await click('#aoNodeDetail a');assert.equal(await evaluate('document.querySelector("#ao-q-should_store_memory").open'),true);
    await evaluate('document.querySelector("#aiObservatoryPage").scrollTop=0');await shot('architecture');
    await click('#aoActivityTab');await click('#aoJobs summary');
    assert.equal(await evaluate('document.querySelector("#aoJobs img")'),null,'evidence rendered as text');
    assert.match(await evaluate('document.querySelector("#aoJobs pre").textContent'),/<img/);
    await click('#aoAliases button');await wait('document.querySelector("#aoAliases button").disabled && document.querySelector("#aoAliases").textContent.includes("Desativada")');
    await click('#aoAudit');await wait('document.querySelector("#aoNotice").textContent.includes("adicionada à fila")');
    assert.equal(requests.some(r=>r.path.endsWith('/run')),true);
    await click('#aoReplayTab');
    await evaluate('document.querySelector("#aoReplayCases").value="[{]";document.querySelector("#aoReplayForm").requestSubmit()');
    await wait('document.querySelector("#aoNotice").textContent.includes("JSON dos casos não é válido")');
    assert.equal(requests.some(r=>r.path.endsWith('/replay')),false);
    await click('#aoReplayExample');await click('#aoReplaySubmit');await wait('document.querySelector("#aoNotice").textContent.includes("adicionada à fila")');
    const replay=requests.find(r=>r.path.endsWith('/replay'));assert.equal(replay.body.cases.length,8);assert.equal(replay.body.cases.at(-1).expected_intent,null);
    await click('#aoReplayDefault');await wait('!document.querySelector("#aoReplayDefault").disabled');assert.deepEqual(requests.filter(r=>r.path.endsWith('/replay')).at(-1).body,{});
    await evaluate('window.__printed=false;window.print=()=>{window.__printed=true}');await click('#aoExport');assert.equal(await evaluate('window.__printed'),true);
    const pdf=await call('Page.printToPDF',{landscape:true,printBackground:true,preferCSSPageSize:true});const pdfBytes=Buffer.from(pdf.data,'base64');assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');assert.ok(pdfBytes.length>10000);assert.equal((pdfBytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2,'compact summary and architecture PDF');await fs.writeFile(path.join(os.tmpdir(),'norte-observatory-test.pdf'),pdfBytes);
    await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await click('#aoOverviewTab');await evaluate('document.querySelector("#aiObservatoryPage").scrollTop=0');await shot('mobile');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'no page-level horizontal overflow');
    offline=true;await click('#aoRefresh');await wait('document.querySelector("#aoUpdated").textContent.includes("Última consulta falhou")');
    assert.match(await evaluate('document.querySelector("#aoNotice").textContent'),/indisponível/);
    assert.equal(await evaluate('document.querySelectorAll(".ao-metric").length'),4,'retain clearly marked previous data');
    assert.deepEqual(errors,[],'no uncaught page errors');
    console.log('browser-ai-observatory: ok (fixtures, runtime contracts, replay, rollback, offline, mobile, PDF)');
  }finally{socket?.close();chrome.kill();await new Promise(resolve=>server.close(resolve));await sleep(200);await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});}
})().catch(error=>{console.error(error);process.exit(1);});
