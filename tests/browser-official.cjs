// One authorized paid call, or replay of its recorded output. No physical audio.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

(async () => {
  const base = process.env.NORTE_OFFICIAL_TEST_URL || 'http://127.0.0.1:8000';
  const replayPath = process.env.NORTE_OFFICIAL_REPLAY;
  assert.ok(replayPath || process.env.NORTE_ALLOW_PAID_TEST === '1', 'Set NORTE_ALLOW_PAID_TEST=1 to authorize exactly one paid example call, or NORTE_OFFICIAL_REPLAY to test offline.');
  const health = await fetch(base + '/api/health').then(r => r.json());
  assert.equal(health.provider, 'official'); assert.equal(health.ready, true);
  const replay = replayPath ? JSON.parse(await fs.readFile(replayPath, 'utf8')) : null;
  // Replay keeps the original contract of the previously paid response.
  const exampleTest = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/prototype-v1.json'), 'utf8'));
  const example = {model:exampleTest.model,state:exampleTest.state,questions:exampleTest.questions};
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'norte-official-ui-'));
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--no-first-run', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let i=0; i<100; i++) { try { port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; } catch (_) { await sleep(100); } }
    assert.ok(port);
    const pages = await fetch('http://127.0.0.1:' + port + '/json/list').then(r=>r.json());
    socket = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
    let nextId=0; const pending=new Map(), errors=[];
    socket.addEventListener('message',event=>{
      const msg=JSON.parse(event.data);
      if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
      if(msg.id){const handler=pending.get(msg.id);pending.delete(msg.id);msg.error?handler.reject(Error(JSON.stringify(msg.error))):handler.resolve(msg.result);}
    });
    function call(method,params={}) { return new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));}); }
    async function evaluate(expression) {const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
    async function waitUntil(expression,timeout=10000){for(let i=0;i<timeout/100;i++){if(await evaluate(expression))return;await sleep(100);}throw Error('Timed out: '+expression);}
    await call('Page.enable');await call('Runtime.enable');
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`
      navigator.mediaDevices.getUserMedia=async()=>{throw Error('No audio in test');};
      window.originalFetch=window.fetch;window.officialCalls=[];window.extraCalls=0;
      window.fetch=(url,options)=>{
        if(url==='/api/classify') {
          const request=JSON.parse(options.body);
          if(JSON.stringify(request)!==JSON.stringify(${JSON.stringify(example)}))throw Error('Unexpected request; blocked before network');
          if(officialCalls.length){extraCalls++;throw Error('Only one official call allowed');}
          officialCalls.push({request,headers:options.headers});
          ${replay ? `return Promise.resolve(new Response(JSON.stringify(${JSON.stringify(replay)}),{status:200,headers:{'Content-Type':'application/json'}}));` : ''}
        }
        return originalFetch(url,options);
      };
    `});
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await call('Page.navigate',{url:base+'/#manual'});
    await waitUntil('window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page === "manual"');
    assert.match(await evaluate('document.querySelector("#providerStatus").textContent'),/Jev oficial/);
    await evaluate(`NorteLab.loadJSON(${JSON.stringify(JSON.stringify(exampleTest))});document.querySelector('#testRepeats').value='1';document.querySelector('#runTest').click()`);
    await waitUntil('!NorteLab.isRunning()',45000);
    const batch=await evaluate('NorteLab.snapshot().batches.at(-1)');
    assert.deepEqual(batch.input.expected,exampleTest.expected);
    for(const [id,expected] of Object.entries(exampleTest.expected)) assert.equal(await evaluate(`Number(document.querySelector('[data-min-probability="${id}"]').value)`),Number((expected.minProbability*100).toFixed(10)));
    assert.equal(batch.runs.length,1);
    assert.equal(batch.runs[0].status,'done',batch.runs[0].error || 'No successful response');
    const result=batch.runs[0].output;
    // Keep the already-paid response for subsequent rendering checks without more API usage.
    if(!replay) await fs.writeFile('/tmp/norte-official-verified.json',JSON.stringify(result,null,2),{mode:0o600});
    assert.equal(result.provider,'official'); assert.ok(result.response.model.startsWith('jev-'));
    assert.deepEqual(result.request,example);
    assert.equal(result.requestAdapter,undefined);assert.equal(result.effectiveRequest,undefined);
    assert.equal(Object.keys(result.response.answers).length,8);
    for(const [key,q] of Object.entries(example.questions))assert.equal(result.response.answers[key].type,q.type);
    assert.deepEqual(await evaluate('officialCalls.map(c=>c.request)'),[example]);
    const headers=await evaluate('officialCalls[0].headers');
    assert.equal(headers['X-Norte-Provider'],'official');assert.equal(headers.Authorization,undefined);
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-pending").length'),0);
    assert.match(await evaluate('document.querySelector(".result-provider").textContent'),/Jev oficial/);
    await evaluate('document.querySelector(".test-run-selectors [data-run]").click()');
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-row").length'),8);
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults .expected-verdict").length'),8);
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-summary .primitive-type").length'),0);
    assert.equal(await evaluate(`new Set([...document.querySelectorAll('#classificationResults .expected-select')].map(n=>getComputedStyle(n).color)).size`),1,'expected true/false/choice all use neutral styling');
    assert.equal(await evaluate(`document.querySelectorAll('#classificationResults .obtained-value').length`),8);
    await evaluate(`document.querySelector('[data-select-test="${batch.id}"]').click();document.querySelector('#compareTests').click()`);
    assert.match(await evaluate('document.querySelector(".comparison-info").textContent'),/Jev oficial/);
    await evaluate('document.querySelector("#clearTestSelection").click()');
    for(const width of [390,1440]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      assert.equal(await evaluate(`(() => {const row=document.querySelector('#classificationResults .answer-summary'),r=row.getBoundingClientRect(),s=row.querySelector('.expected-settings').getBoundingClientRect();return s.right<=r.right && s.left>=r.left;})()`),true);
      const image=await call('Page.captureScreenshot',{format:'png'});
      await fs.writeFile('/tmp/norte-official-'+width+'.png',Buffer.from(image.data,'base64'));
    }
    assert.equal(await evaluate('extraCalls'),0);
    // Re-evaluate a recorded response under a stricter local limit, entirely offline.
    await evaluate(`window.thresholdReplay=${JSON.stringify(result)};window.thresholdRequests=[];window.fetch=(url,options)=>url==='/api/classify'?(thresholdRequests.push(JSON.parse(options.body)),Promise.resolve(new Response(JSON.stringify(thresholdReplay),{status:200,headers:{'Content-Type':'application/json'}}))):originalFetch(url,options);const input=document.querySelector('[data-min-probability=meaningful_event]');input.value='100';input.dispatchEvent(new Event('change'));document.querySelector('#runTest').click();`);
    await waitUntil('!NorteLab.isRunning()');
    assert.deepEqual(await evaluate('thresholdRequests'),[example]);
    assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).input.expected.meaningful_event.minProbability'),1);
    assert.equal(await evaluate('NorteLab.snapshot().batches[0].input.expected.meaningful_event.minProbability'),.85,'editing thresholds never rewrites an existing batch');
    await evaluate('document.querySelector(".test-run-selectors [data-run]").click()');
    const meaningResult=result.response.answers.meaningful_event.noul;
    if(meaningResult>=.5 && meaningResult<1) {
      assert.equal(await evaluate(`document.querySelector('[data-question=meaningful_event] .expected-verdict').dataset.verdict`),'low-probability');
      assert.match(await evaluate('document.querySelector(".run-verdict").textContent'),/Falhou/);
    }
    const thresholdBatch=await evaluate('NorteLab.snapshot().batches.at(-1)');
    await call('Page.reload');
    await waitUntil('window.NorteLab && NorteClassifier.isAvailable() && document.body.dataset.page === "manual"');
    await evaluate(`document.querySelector('[data-test-id="${thresholdBatch.id}"] [data-action=view-batch]').click()`);
    assert.equal(await evaluate('document.querySelector("[data-min-probability=meaningful_event]").value'),'100');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches.at(-1)'),thresholdBatch,'thresholds survive reload');
    // Mocked authentication failure stops repetitions; never sends another paid request.
    await evaluate(`window.failureCalls=0;window.fetch=(url,options)=>url==='/api/classify'?(failureCalls++,Promise.resolve(new Response(JSON.stringify({error:'Chave inválida (teste simulado)'}),{status:401,headers:{'Content-Type':'application/json'}}))):originalFetch(url,options);document.querySelector('#testRepeats').value='4';document.querySelector('#runTest').click()`);
    await waitUntil('!NorteLab.isRunning()');
    assert.equal(await evaluate('failureCalls'),1);
    assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).status'),'cancelled');
    assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).runs.length'),1);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({mode:replay?'replayed recorded output':'one paid official call',model:result.response.model,questions:Object.keys(result.response.answers).length,seconds:result.latencyMs/1000,event_type:result.response.answers.event_type?.choice,passed:true}));
  } finally {socket?.close();chrome.kill('SIGTERM');}
})().catch(error=>{console.error(error);process.exitCode=1;});
