// Real Chrome + mocked speech events. Optional real local model via NORTE_TEST_URL.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

(async () => {
  const root = path.resolve(__dirname, '..');
  if (process.env.NORTE_TEST_URL) {
    const health = await fetch(process.env.NORTE_TEST_URL + '/api/health').then(r => r.json());
    assert.ok(health.provider === 'local' || health.engine === 'jevos-v3', 'This broad regression suite must not consume the official API. Use browser-official.cjs for one explicitly authorized call.');
  }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'norte-ui-check-'));
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.js', 'transcription.js', 'styles.css','memory-flow.css','relation-worker.js','memory-flow.js','memory-page.js', 'speech-windows.js', 'classifier.js', 'workspace.js', 'experiments.js', 'automation.js', 'lab.js', 'classifier-config.json', 'manual-test-example.json'].includes(filename)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await fs.readFile(path.join(root, filename)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--no-first-run', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch (_) { await sleep(100); }
    }
    assert.ok(port, 'Chrome debugging endpoint starts');
    const tabs = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json());
    socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let nextId = 0;
    const requests = new Map();
    const errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (message.id) {
        const request = requests.get(message.id);
        requests.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
      }
    });
    function call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        requests.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    }
    async function reload() {
      // Page.reload acknowledges navigation before replacing the old document.
      // Never let assertions pass against the previous page's ready globals.
      await evaluate('window.beforeTestReload = true');
      await call('Page.reload');
      for (let i = 0; i < 200; i++) {
        try {
          if (await evaluate('!window.beforeTestReload && !!window.NorteLab && !!window.norteSession && !!window.NorteClassifier?.getConfig()')) return;
        } catch (error) {
          // Chrome may destroy the old execution context while this readiness
          // query is in flight; only navigation-context errors are retryable.
          if (!/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(error.message)) throw error;
        }
        await sleep(50);
      }
      throw Error('Reload did not initialize a new document');
    }
    async function latestOutput() {
      return evaluate(`(() => {
        const packet = norteSession.getClassifierInputs().findLast(p => p.text.trim());
        const snapshot = NorteClassifier.snapshot();
        const item = snapshot?.results.find(r => r.id === packet?.id);
        if (!item?.output || item.request.state !== JSON.parse(document.querySelector('#stateCode').textContent).state || JSON.stringify(item.request.questions) !== JSON.stringify(snapshot.config.questions)) return null;
        return { request: item.request, response: item.output.response, segmentation: item.packet };
      })()`);
    }
    async function drag(selector, delta) {
      const box = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}), r = n.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2, vertical:n.getAttribute('aria-orientation') === 'vertical', before:Number(n.getAttribute('aria-valuenow')) }; })()`);
      await call('Input.dispatchMouseEvent', { type:'mouseMoved', x:box.x, y:box.y });
      await call('Input.dispatchMouseEvent', { type:'mousePressed', x:box.x, y:box.y, button:'left', buttons:1, clickCount:1 });
      await call('Input.dispatchMouseEvent', { type:'mouseMoved', x:box.x+(box.vertical ? delta : 0), y:box.y+(box.vertical ? 0 : delta), button:'left', buttons:1 });
      await call('Input.dispatchMouseEvent', { type:'mouseReleased', x:box.x+(box.vertical ? delta : 0), y:box.y+(box.vertical ? 0 : delta), button:'left', clickCount:1 });
      const after = await evaluate(`Number(document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow'))`);
      assert.ok(Math.abs(after - box.before) >= 2, selector + ' responds to real pointer drag');
      assert.equal(await evaluate('document.body.hasAttribute("data-resizing")'), false);
    }
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: `
      navigator.mediaDevices.getUserMedia = async () => { throw new Error('Mocked microphone; no physical capture'); };
      window.testNow = 0;
      Object.defineProperty(performance, 'now', { value: () => window.testNow });
      window.advance = ms => window.testNow += ms;
      window.engines = [];
      window.SpeechRecognition = class {
        constructor() { engines.push(this); }
        start() { queueMicrotask(() => this.onstart?.()); }
        stop() { this.stopped = true; }
        abort() { queueMicrotask(() => this.onend?.()); }
        emit(items, resultIndex = 0) {
          const results = items.map(([text, final]) => Object.assign([{ transcript: text, confidence: .9 }], { isFinal: final }));
          this.onresult({ results, resultIndex });
        }
      };
    ` });
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: process.env.NORTE_TEST_URL || 'http://127.0.0.1:' + server.address().port });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('Boolean(window.norteSession)')) break;
      await sleep(50);
    }
    assert.equal(await evaluate('document.querySelector("#buttonLabel").textContent'), 'Iniciar reunião');
    assert.equal(await evaluate('document.querySelector("#meetingStarted").textContent'), 'Ainda não iniciada');
    await evaluate(`document.querySelector('#meetingName').value = 'Projeto <Norte> & sensores'; document.querySelector('#meetingName').dispatchEvent(new Event('change'));`);
    assert.equal(await evaluate('document.title'), 'Norte · Projeto <Norte> & sensores');
    const idle = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile('/tmp/norte-centered-idle.png', Buffer.from(idle.data, 'base64'));
    await evaluate('document.querySelector("#micBtn").click()');
    const meetingStart = await evaluate('norteSession.getSnapshot().meeting.startedAt');
    assert.ok(meetingStart && !Number.isNaN(Date.parse(meetingStart)));
    assert.equal(await evaluate('document.querySelector("#meetingStarted").dateTime'), meetingStart);
    await evaluate(`advance(2000); engines.at(-1).onspeechstart(); advance(1000); engines.at(-1).emit([['Precisamos de três', false]]);`);
    assert.equal(await evaluate('window.norteSession.getPackets().filter(p => p.endMs !== null).length'), 0);
    for (let i = 0; i < 100 && !await evaluate('NorteClassifier.snapshot() !== null'); i++) await sleep(50);
    assert.equal(await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'), 'Precisamos de três');
    assert.equal(await evaluate('document.querySelectorAll(".answer-pending").length'), 3);
    assert.equal(await evaluate('Object.hasOwn(JSON.parse(document.querySelector("#questionEditor").value), "model")'), false);
    await evaluate(`advance(2000); engines.at(-1).emit([['Precisamos de dois sensores.', true]]);`);
    assert.equal(await evaluate('document.querySelector(".transcript-time").textContent'), '00:02');
    await evaluate(`engines.at(-1).emit([['Precisamos de dois sensores.', true]]);`);
    assert.equal(await evaluate('document.querySelectorAll(".transcript-entry").length'), 1);
    await evaluate(`advance(3000); engines.at(-1).onspeechstart(); advance(2000); engines.at(-1).emit([['Precisamos de dois sensores.', true], ['Mas o segundo só deve', false]], 1); document.querySelector('#micBtn').click();`);
    assert.equal(await evaluate('document.querySelector("#buttonLabel").textContent'), 'Pausando…');
    await evaluate(`engines.at(-1).emit([['Precisamos de dois sensores.', true], ['Mas o segundo só deve ser usado se o primeiro falhar.', true]], 1); engines.at(-1).onend();`);
    assert.equal(await evaluate('document.querySelectorAll(".transcript-entry").length'), 2);
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:10');
    assert.equal(await evaluate('document.querySelector("#buttonLabel").textContent'), 'Retomar reunião');
    await evaluate(`document.querySelector('#micBtn').click()`);
    await evaluate(`advance(2000); engines.at(-1).onspeechstart(); advance(3000); engines.at(-1).emit([['Corrigindo: a redundância também precisa registrar temperatura.', true]]);`);
    await evaluate('engines.at(-1).onend()');
    await sleep(650);
    assert.equal(await evaluate('engines.length'), 3);
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:15');
    await evaluate(`advance(1000); engines.at(-1).onspeechstart(); advance(3000); engines.at(-1).emit([['Essa condição precisa constar no requisito.', true]]);`);
    assert.equal(await evaluate('window.norteSession.getSnapshot().records.length'), 4);
    await evaluate('document.querySelector("#micBtn").click(); engines.at(-1).onend();');
    if (process.env.NORTE_TEST_URL) {
      for (let i = 0; i < 180; i++) {
        const ready = await evaluate('NorteClassifier.snapshot()?.results?.length > 0 && NorteClassifier.snapshot().results.every(r => r.status === "done")');
        if (ready) break;
        await sleep(150);
      }
      const actual = await evaluate('NorteClassifier.snapshot().results');
      assert.ok(actual.length >= 2);
      assert.ok(actual.every(r => r.status === 'done'), JSON.stringify(actual.map(r=>({state:r.status,error:r.error}))));
      assert.ok(actual.every(r => r.output.response.model === 'jevos-v3'));
      assert.ok(actual.every(r => r.request.state === r.packet.text));
      assert.equal(await evaluate('document.querySelectorAll(".answer-row").length'), 3);
      assert.equal(await evaluate('document.querySelectorAll(".score-level .answer-dot").length'), 4);
      assert.equal(await evaluate('new Set([...document.querySelectorAll(".score-level .answer-dot")].map(n => getComputedStyle(n).borderColor)).size'), 4);
      const visible = await latestOutput();
      assert.equal(visible.request.state, await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'));
      assert.equal(await evaluate('document.querySelector("[data-question=depende_de_contexto] .answer-primary strong").textContent'), (visible.response.answers.depende_de_contexto.noul * 100).toFixed(1) + '%');
      assert.equal(await evaluate('document.querySelector("[data-question=tipo] .choice-probability").textContent'), (visible.response.answers.tipo.probabilities[visible.response.answers.tipo.choice] * 100).toFixed(1) + '%');
      await evaluate('document.querySelector(".answer-row").open = true');
      assert.equal(await evaluate('document.querySelectorAll(".answer-row .distribution-line").length'), 11);
      assert.match(await evaluate('document.querySelector(".answer-row .answer-breakdown").textContent'), /%/);
      assert.equal(await evaluate('document.querySelectorAll(".classifier-output pre, #outputJson, #outputDetails, .answer-json").length'), 0);
      await evaluate('document.querySelector(".answer-row").open = false');
    }
    assert.equal(await evaluate('document.querySelector("#workspace-classifier").classList.contains("active")'), true);
    assert.equal(await evaluate('document.querySelector("#tab-keypoints")'), null);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".transcript-text")).fontSize'), '13px');
    assert.equal(await evaluate('getComputedStyle(document.body).fontFamily === getComputedStyle(document.querySelector("#questionEditor")).fontFamily'), true);
    await evaluate('document.querySelector("#stateDivider").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}))');
    assert.equal(await evaluate('document.querySelector("#stateDivider").getAttribute("aria-valuenow")'), '47');
    await evaluate('document.querySelector("#stateDivider").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowUp", bubbles: true}))');
    await evaluate('document.querySelector("#classifierDivider").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}))');
    assert.equal(await evaluate('document.querySelector("#classifierDivider").getAttribute("aria-valuenow")'), '48');
    await evaluate('document.querySelector("#classifierDivider").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}))');
    for (const selector of ['#stateDivider', '#classifierDivider', '#logDivider']) {
      await drag(selector, 50);
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
    }
    await evaluate('document.querySelector("#tab-canvas").click()');
    assert.equal(await evaluate('document.querySelector("#workspace-canvas").classList.contains("active")'), true);
    await evaluate('document.querySelector("#tab-classifier").click(); document.querySelector("#workspaceSplit").click()');
    assert.equal(await evaluate('document.querySelector("#workspacePanels").classList.contains("split")'), true);
    await evaluate('document.querySelector("#workspaceSplit").click()');
    await evaluate(`(() => {
      const data = new DataTransfer(); data.setData('application/x-norte-workspace', 'classifier');
      const panels = document.querySelector('#workspacePanels'); const box = panels.getBoundingClientRect();
      panels.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 10 }));
      panels.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 10 }));
    })()`);
    assert.equal(await evaluate('document.querySelector("#workspacePanels").classList.contains("reversed")'), true);
    await evaluate('document.querySelector("#workspaceDivider").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}))');
    assert.equal(await evaluate('document.querySelector("#workspaceDivider").getAttribute("aria-valuenow")'), '50');
    await drag('#workspaceDivider', 45);
    await evaluate('document.querySelector("#workspaceDivider").dispatchEvent(new MouseEvent("dblclick", {bubbles:true}))');
    await evaluate('document.querySelector("#workspaceSplit").click()');
    for (const width of [1440, 1024, 900, 390, 320]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await evaluate(`(() => {
        const box = document.querySelector(innerWidth <= 900 ? '.audio-widget' : '#micBtn').getBoundingClientRect(), shell=document.querySelector('.app-shell').getBoundingClientRect();
        return { center: box.x + box.width / 2, expectedCenter:shell.x+shell.width/2, overflow: document.documentElement.scrollWidth > innerWidth, bottom: document.querySelector('.log-shell').getBoundingClientRect().bottom };
      })()`);
      assert.ok(Math.abs(layout.center - layout.expectedCenter) < 1, 'Recording controls centered in page beside sidebar at ' + width);
      assert.equal(layout.overflow, false, 'No horizontal overflow at ' + width);
      assert.ok(layout.bottom <= 900, 'Log fits viewport at ' + width);
      if ([1440, 390].includes(width)) {
        const screenshot = await call('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile('/tmp/norte-classifier-' + width + '.png', Buffer.from(screenshot.data, 'base64'));
      }
    }
    // The narrow classifier keeps a working horizontal splitter instead of hiding it.
    await sleep(80);
    assert.equal(await evaluate('document.querySelector("#classifierDivider").getAttribute("aria-orientation")'), 'horizontal');
    await drag('#classifierDivider', 30);
    await drag('#logDivider', -35);
    const savedSize = await evaluate('document.querySelector("#logDivider").getAttribute("aria-valuenow")');
    await reload();
    for (let i = 0; i < 100; i++) {
      if (await evaluate('Boolean(window.norteSession) && document.querySelectorAll(".transcript-entry").length === 4')) break;
      await sleep(50);
    }
    assert.equal(await evaluate('document.querySelectorAll(".transcript-entry").length'), 4);
    assert.equal(await evaluate('document.querySelector("#logDivider").getAttribute("aria-valuenow")'), savedSize);
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:19');
    assert.equal(await evaluate('document.querySelector("#meetingName").value'), 'Projeto <Norte> & sensores');
    assert.equal(await evaluate('norteSession.getSnapshot().meeting.startedAt'), meetingStart);
    await evaluate('document.querySelector("#micBtn").click()');
    await evaluate(`engines.at(-1).onerror({ error: 'not-allowed' })`);
    assert.equal(await evaluate('document.querySelector("#micBtn").disabled'), false);
    assert.match(await evaluate('document.querySelector("#toast").textContent'), /Permita/);
    // Restart from paused: clears only the current display/timer, not source history.
    await evaluate('document.querySelector("#restartAudio").click()');
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:00');
    assert.equal(await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'), '');
    assert.equal(await evaluate('norteSession.getSnapshot().records.length'), 4);
    assert.equal(await evaluate('norteSession.getSnapshot().takes.length'), 2);
    await evaluate(`engines.at(-1).onspeechstart(); advance(1000); engines.at(-1).emit([['Vamos testar', false]]);`);
    assert.equal(await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'), 'Vamos testar');
    assert.equal(await evaluate('document.querySelectorAll(".answer-pending").length'), 3);
    // Restart while listening: preserve a late final, then open a clean third take.
    await evaluate(`document.querySelector('#restartAudio').click(); engines.at(-1).emit([['Vamos testar amanhã.', true]]); engines.at(-1).onend();`);
    assert.equal(await evaluate('norteSession.getSnapshot().takes.length'), 3);
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:00');
    await evaluate(`engines.at(-1).onspeechstart(); advance(1000); engines.at(-1).emit([['Quantos sensores precisamos?', true]]); document.querySelector('#micBtn').click(); engines.at(-1).onend();`);
    assert.equal(await evaluate('norteSession.getSnapshot().records.length'), 6);
    assert.equal(await evaluate('norteSession.getPackets().find(p => p.takeId === 2).text'), 'Vamos testar amanhã.');
    assert.equal(await evaluate('norteSession.getPackets().find(p => p.takeId === 3).text'), 'Quantos sensores precisamos?');
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:01');
    assert.equal(await evaluate('document.querySelector(".transcript-entry:last-child .transcript-time").textContent'), '00:00');
    assert.match(await evaluate('document.querySelector(".transcript-entry:last-child .transcript-meta").textContent'), /Tomada 3/);
    const questionsBefore = await evaluate('JSON.stringify(NorteClassifier.snapshot().config.questions)');
    await evaluate(`document.querySelector('#questionEditor').value = '{broken'; document.querySelector('#questionEditor').dispatchEvent(new Event('input')); document.querySelector('#applyQuestions').click();`);
    assert.ok(await evaluate('document.querySelector("#configError").textContent.length > 0'));
    assert.equal(await evaluate('JSON.stringify(NorteClassifier.snapshot().config.questions)'), questionsBefore);
    await evaluate(`(() => {
      const questions = NorteClassifier.snapshot().config.questions;
      questions.tipo.instructions += ' Use the excerpt only.';
      const editor = document.querySelector('#questionEditor'); editor.value = JSON.stringify(questions, null, 2);
      editor.dispatchEvent(new Event('input')); document.querySelector('#applyQuestions').click();
    })()`);
    assert.equal(await evaluate('document.querySelector("#configError").textContent'), '');
    assert.match(await evaluate('document.querySelector(".answer-instructions").textContent'), /Use the excerpt only/);
    if (process.env.NORTE_TEST_URL) {
      for (let i = 0; i < 200; i++) {
        if (await evaluate('NorteClassifier.snapshot().results.every(r => r.status === "done")')) break;
        await sleep(150);
      }
      const output = await latestOutput();
      assert.equal(output.request.state, 'Quantos sensores precisamos?');
      assert.match(output.request.questions.tipo.instructions, /Use the excerpt only/);
      assert.equal(output.response.model, 'jevos-v3');
    }
    await reload();
    for (let i = 0; i < 100; i++) {
      if (await evaluate('window.norteSession?.getSnapshot().records.length === 6 && NorteClassifier.snapshot() !== null')) break;
      await sleep(50);
    }
    assert.equal(await evaluate('norteSession.getSnapshot().takes.length'), 3);
    assert.equal(await evaluate('norteSession.getSnapshot().meeting.startedAt'), meetingStart);
    assert.equal(await evaluate('document.querySelector("#timer").textContent'), '00:01');
    assert.equal(await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'), 'Quantos sensores precisamos?');
    // User regression: delayed final words after a false pause must not replace the full State.
    await call('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
    const examples = [
      ['Eu quero mudar o tamanho da barra para 10 cm ao invés', 'Eu quero mudar o tamanho da barra para 10 cm ao invés de 5', 'de 5'],
      ['Nossa deu muito certo então a gente vai definir 100% que a gente vai usar essa nova', 'Nossa deu muito certo então a gente vai definir 100% que a gente vai usar essa nova dimensão', 'dimensão'],
    ];
    for (const [prefix, full, tail] of examples) {
      await evaluate('document.querySelector("#restartAudio").click()');
      await evaluate(`advance(1000); engines.at(-1).onspeechstart(); advance(3000); engines.at(-1).emit([[${JSON.stringify(prefix)},false]]); advance(1000); engines.at(-1).onspeechend(); advance(1100);`);
      await sleep(160);
      await evaluate(`engines.at(-1).onspeechstart(); advance(2900); engines.at(-1).emit([[${JSON.stringify(full)},true]]); document.querySelector('#micBtn').click(); engines.at(-1).onend();`);
      assert.equal(await evaluate('norteSession.getPackets().at(-1).text'), tail);
      assert.equal(await evaluate('JSON.parse(document.querySelector("#stateCode").textContent).state'), full);
      assert.equal(await evaluate('norteSession.getClassifierInputs().at(-1).context'), 'same-utterance-prefix');
      if (process.env.NORTE_TEST_URL) {
        for (let i = 0; i < 200; i++) {
          if ((await latestOutput())?.request.state === full) break;
          await sleep(100);
        }
        const current = await latestOutput();
        assert.equal(current.request.state, full);
        assert.equal(current.segmentation.windowText, tail);
        assert.equal(current.response.model, 'jevos-v3');
      }
    }
    for (const selector of ['#stateDivider', '#classifierDivider', '#logDivider']) await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`);
    const completeState = await call('Page.captureScreenshot', { format:'png' });
    await fs.writeFile('/tmp/norte-complete-state.png', Buffer.from(completeState.data, 'base64'));
    // Manual experiments use isolated inputs and durable snapshots, never the speech ledger.
    async function field(selector, value, event = 'input') {
      await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); n.value = ${JSON.stringify(value)}; n.dispatchEvent(new Event(${JSON.stringify(event)}, {bubbles:true})); })()`);
    }
    async function waitForBatch() {
      for (let i = 0; i < 450; i++) { if (!await evaluate('NorteLab.isRunning()')) return; await sleep(100); }
      throw Error('Manual batch did not finish');
    }
    async function importArchive(archive) {
      await evaluate(`NorteLab.importArchive(${JSON.stringify(archive)})`);
      await sleep(100);
    }
    const sourceBefore = await evaluate('JSON.stringify(norteSession.getSnapshot().records)');
    const liveConfigBefore = await evaluate('NorteClassifier.getConfig()');
    await evaluate('document.querySelector("#manualMode").click()');
    await evaluate(`NorteLab.loadJSON(JSON.stringify({model:'jev-latest',state:'Manual test',questions:${JSON.stringify(liveConfigBefore.questions)}}))`);
    assert.equal(await evaluate('document.body.dataset.page'),'manual');
    assert.equal(await evaluate('location.hash'),'#manual');
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),true);
    assert.equal(await evaluate('document.querySelector(".audio-widget").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#panel-tests").hidden'),false);
    assert.equal(await evaluate('document.querySelectorAll(".output-heading, .log-tab, #showCases, #showRuns").length'),0);
    assert.equal(await evaluate('document.querySelector("#logHeading").textContent'),'Testes');
    await evaluate('document.querySelector("#sidebarToggle").click()');
    assert.equal(await evaluate('document.querySelector("#sidebarToggle").getAttribute("aria-expanded")'),'true');
    assert.equal(await evaluate('document.querySelector("#sidebar").getBoundingClientRect().width'),224);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
    await evaluate('document.querySelector("#sidebarToggle").click()');
    assert.equal(await evaluate('document.querySelector("#manualStateView").hidden'), false);
    assert.equal(await evaluate('document.querySelector("#liveStateView").hidden'), true);
    await field('#testName', 'Dimensão <teste>');
    await field('#manualState', 'A equipe decidiu usar a barra de dez centímetros.');
    await field('[data-expected="tipo"]', 'decisao', 'change');
    await field('[data-expected="relevancia"]', '3', 'change');
    await field('[data-expected="depende_de_contexto"]', 'false', 'change');
    assert.equal(await evaluate('JSON.stringify(norteSession.getSnapshot().records)'), sourceBefore);
    assert.equal(await evaluate('document.querySelectorAll(".classifier-output pre").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("#testFilter, #saveTestCase, .connection-dot").length'),0);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".sidebar-footer")).display'),'none');
    // Old case-only backups remain intact even though cases have no UI anymore.
    const savedCase = await evaluate(`({id:crypto.randomUUID(),createdAt:new Date().toISOString(),input:{name:document.querySelector('#testName').value,language:'pt',state:document.querySelector('#manualState').value,config:NorteClassifier.getConfig(),expected:{tipo:{type:'choice',value:'decisao'},relevancia:{type:'score',value:3},depende_de_contexto:{type:'noul',value:false}}}})`);
    await importArchive({schemaVersion:1,cases:[savedCase],batches:[]});
    assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'');
    assert.equal(savedCase.input.expected.depende_de_contexto.value, false);
    assert.equal(savedCase.input.state, 'A equipe decidiu usar a barra de dez centímetros.');
    if (process.env.NORTE_TEST_URL) {
      await evaluate(`window.testModelRequests = []; window.originalLabFetch = window.fetch; window.fetch = (url, options) => {
        if (url === '/api/classify' && options?.method === 'POST') testModelRequests.push(JSON.parse(options.body));
        return originalLabFetch(url, options);
      }; document.querySelector('#runTest').click();`);
      assert.equal(await evaluate('NorteLab.isRunning()'), true);
      assert.equal(await evaluate('document.querySelector("#manualState").readOnly'), true);
      await waitForBatch();
      const batch = await evaluate('NorteLab.snapshot().batches.at(-1)');
      assert.equal(batch.requested, 4); assert.equal(batch.runs.length, 4);
      assert.ok(batch.runs.every(r => r.status === 'done'), JSON.stringify(batch.runs));
      const sent = await evaluate('testModelRequests.filter(r => r.state === "A equipe decidiu usar a barra de dez centímetros.")');
      assert.equal(sent.length, 4, 'four actual POSTs, not duplicated client results');
      assert.ok(sent.every(r => JSON.stringify(r) === JSON.stringify(sent[0])));
      assert.deepEqual(Object.keys(sent[0]).sort(), ['model', 'questions', 'state']);
      assert.equal(await evaluate('NorteExperiments.summarize(NorteLab.snapshot().batches.at(-1)).comparisons'), 12);
      assert.equal(await evaluate('document.querySelectorAll(".test-run-selectors button").length'), 5);
      assert.equal(await evaluate('document.querySelector("[data-action=view-summary]").getAttribute("aria-pressed")'), 'true');
      assert.equal(await evaluate('document.querySelectorAll(".expected-verdict").length'), 3);
      assert.equal(await evaluate('document.querySelectorAll(".experiment-metric, .aggregate-label").length'), 0);
      assert.equal(await evaluate('document.querySelectorAll(".obtained-confidence").length'), 3);
      assert.match(await evaluate('document.querySelector(".batch-timing").textContent'), /[0-9],[0-9]{3} s/);
      const manualImage = await call('Page.captureScreenshot', {format:'png'});
      await fs.writeFile('/tmp/norte-manual-tests.png', Buffer.from(manualImage.data,'base64'));
      await evaluate('document.querySelector("#sidebarToggle").click()');
      const expandedImage = await call('Page.captureScreenshot', {format:'png'});
      await fs.writeFile('/tmp/norte-sidebar-expanded.png',Buffer.from(expandedImage.data,'base64'));
      await evaluate('document.querySelector("#sidebarToggle").click()');
      for(const width of [390,320]) {
        await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
        const layout = await evaluate(`(() => {const b=document.querySelector('#runTest').getBoundingClientRect(),p=document.querySelector('.state-pane').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,visible:b.bottom<=p.bottom && b.top>=p.top,textarea:document.querySelector('#manualState').clientHeight};})()`);
        assert.equal(layout.overflow,false); assert.equal(layout.visible,true,'manual run button visible at '+width);assert.ok(layout.textarea>=60);
        if(width===390){const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-manual-390.png',Buffer.from(shot.data,'base64'));}
        await evaluate('document.querySelector("#sidebarToggle").click()');
        assert.equal(await evaluate('document.querySelector(".app-shell").inert'),true);
        assert.equal(await evaluate('getComputedStyle(document.querySelector("#sidebarOverlay")).display'),'block');
        assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
        await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
        assert.equal(await evaluate('document.querySelector(".app-shell").inert'),false);
      }
      await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
      // Inspect an older execution, then edit the draft without changing its historical input.
      await evaluate('document.querySelector(".test-run-selectors [data-run]").click()');
      assert.equal(await evaluate('document.querySelectorAll(".experiment-metric, .aggregate-label").length'),0);
      assert.equal(await evaluate('document.querySelectorAll(".expected-verdict").length'),3);
      assert.match(await evaluate('document.querySelector(".run-timing").textContent'),/[0-9],[0-9]{3} s/);
      const frozen = await evaluate('JSON.stringify(NorteLab.snapshot().batches[0].input)');
      await field('#manualState', 'Outro texto, sem alterar a execução guardada.');
      assert.equal(await evaluate('JSON.stringify(NorteLab.snapshot().batches[0].input)'), frozen);
      assert.equal(await evaluate('document.querySelectorAll(".answer-pending").length'), 3);
    }
    for (const [lang, state] of [['en','The team decided to use the ten-centimeter bar.'],['fr','L’équipe a décidé d’utiliser la barre de dix centimètres.'],['es','El equipo decidió usar la barra de diez centímetros.']]) {
      await field('#testLanguage', lang, 'change'); await field('#manualState', state);
      await importArchive({schemaVersion:1,cases:[{...savedCase,id:savedCase.id+'-'+lang,input:{...savedCase.input,language:lang,state}}],batches:[]});
      if (process.env.NORTE_TEST_URL) {
        await field('#testRepeats', '1', 'change'); await evaluate('document.querySelector("#runTest").click()'); await waitForBatch();
        const batch = await evaluate('NorteLab.snapshot().batches.at(-1)');
        assert.equal(batch.input.language, lang); assert.equal(batch.runs[0].output.request.state, state);
      }
    }
    assert.equal(await evaluate('NorteLab.snapshot().cases.length'), 4);
    assert.deepEqual(await evaluate('NorteLab.snapshot().cases.map(c=>c.input.language)'), ['pt','en','fr','es']);
    // A recorded test restores the original input; no separate saved-case controls.
    if (!process.env.NORTE_TEST_URL) await importArchive({schemaVersion:1,cases:[],batches:['pt','en'].map(language=>({id:'offline-navigation-fixture-'+language,createdAt:savedCase.createdAt,input:{...savedCase.input,language},requested:1,status:'done',runs:[{index:1,status:'error',error:'Offline navigation fixture; no model output.'}]}))});
    const firstBatchId=await evaluate('NorteLab.snapshot().batches[0].id');
    // Rename only the label; original inputs/expectations/results are immutable.
    const firstBeforeRename=await evaluate('NorteLab.snapshot().batches[0]');
    const firstRow=`document.querySelector('[data-test-id="${firstBatchId}"]')`;
    await evaluate(`${firstRow}.querySelector('[data-action=rename-batch]').click()`);
    await field('.test-name-input','Cancel this edit');
    await evaluate(`document.querySelector('.test-name-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches[0]'),firstBeforeRename);
    await evaluate(`${firstRow}.querySelector('[data-action=rename-batch]').click()`);
    await field('.test-name-input','Renamed <manual>');
    await evaluate('document.querySelector(".test-name-form").requestSubmit()');
    const renamed=await evaluate('NorteLab.snapshot().batches[0]');
    assert.equal(renamed.displayName,'Renamed <manual>');
    assert.deepEqual(renamed.input,firstBeforeRename.input); assert.deepEqual(renamed.runs,firstBeforeRename.runs);
    assert.equal(await evaluate(`${firstRow}.querySelector('.test-name-button span').textContent`),'Renamed <manual>');
    assert.equal(await evaluate(`getComputedStyle(${firstRow}.querySelector('.test-checkbox')).appearance`),'none');
    // A quota failure leaves both the saved and in-memory name untouched.
    await evaluate(`${firstRow}.querySelector('[data-action=rename-batch]').click();window.renameStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='norte.tests.v1')throw Error('Quota fixture');return renameStorageSet.call(this,k,v);}`);
    await field('.test-name-input','Must not be saved');
    await evaluate('document.querySelector(".test-name-form").requestSubmit()');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches[0]'),renamed);
    assert.match(await evaluate('document.querySelector("#testMessage").textContent'),/Não foi possível renomear/);
    await evaluate(`Storage.prototype.setItem=renameStorageSet;document.querySelector('[aria-label="Cancelar edição do nome"]').click();${firstRow}.querySelector('[data-action=view-batch]').click();window.dispatchEvent(new Event('pagehide'));`);
    assert.equal(await evaluate('document.querySelector("#testName").value'),'Renamed <manual>');
    await evaluate('window.beforeRenameReload=true');
    await reload();
    for(let i=0;i<100;i++){if(await evaluate('Boolean(!window.beforeRenameReload && window.NorteLab && NorteClassifier.getConfig() && document.body.dataset.page==="manual" && document.querySelector("[data-action=view-batch]"))'))break;await sleep(50);}
    assert.equal(await evaluate('NorteLab.snapshot().batches[0].displayName'),'Renamed <manual>');
    assert.equal(await evaluate(`Boolean(${firstRow}?.querySelector('[data-action=view-batch]'))`),true,'saved test row is ready after reload');
    await evaluate(`${firstRow}.querySelector('[data-action=view-batch]').click()`);
    // Multi-selection never changes the draft or pools distinct States/questions.
    const comparisonBefore=await evaluate('NorteLab.snapshot()');
    const comparisonDraft=await evaluate('document.querySelector("#manualState").value');
    const comparisonQuestions=await evaluate('document.querySelector("#questionEditor").value');
    const compareIds=comparisonBefore.batches.slice(0,2).map(b=>b.id);
    for(const id of compareIds) await evaluate(`document.querySelector('[data-select-test="${id}"]').click()`);
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),2);
    assert.equal(await evaluate('document.querySelector("#testSelectionCount").textContent'),'2 selecionados');
    assert.equal(await evaluate('document.querySelector("#selectAllTests").indeterminate'),comparisonBefore.batches.length>2);
    assert.equal(await evaluate('document.querySelector("#testComparison").hidden'),true);
    const requestsBeforeCompare=await evaluate('window.testModelRequests?.length || 0');
    await evaluate('document.querySelector("#compareTests").click()');
    assert.equal(await evaluate('document.querySelector("#testComparison").hidden'),false);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".classifier-inputs")).display'),'none');
    assert.equal(await evaluate('document.querySelectorAll(".comparison-column").length'),2);
    assert.equal(await evaluate('document.querySelectorAll("#testComparison select:not(:disabled), #testComparison pre").length'),0);
    for(const id of compareIds) {
      const source=comparisonBefore.batches.find(b=>b.id===id);
      const col=`document.querySelector('[data-comparison-id="${id}"]')`;
      assert.equal(await evaluate(`${col}.querySelector('.comparison-state p').textContent`),source.input.state);
      assert.equal(await evaluate(`${col}.querySelector('.answer-instructions').textContent`),Object.values(source.input.config.questions)[0].instructions);
      const expectedTime=await evaluate(`NorteExperiments.seconds(NorteExperiments.summarize(NorteLab.snapshot().batches.find(b=>b.id==='${id}')).latencyMs)`);
      assert.equal(await evaluate(`${col}.querySelector('.comparison-time').textContent`),'Média '+expectedTime);
      if(process.env.NORTE_TEST_URL) {
        const expectedMean=await evaluate(`(NorteExperiments.aggregate(NorteLab.snapshot().batches.find(b=>b.id==='${id}')).answers.depende_de_contexto.noul*100).toFixed(1)+'%'`);
        assert.equal(await evaluate(`${col}.querySelector('[data-question=depende_de_contexto] .answer-primary strong').textContent`),expectedMean);
      } else assert.match(await evaluate(`${col}.textContent`),/Sem resultados válidos/);
    }
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),comparisonBefore);
    assert.equal(await evaluate('window.testModelRequests?.length || 0'),requestsBeforeCompare,'comparison performs no inference');
    const compareImage=await call('Page.captureScreenshot',{format:'png'});
    await fs.writeFile('/tmp/norte-compare-tests.png',Buffer.from(compareImage.data,'base64'));
    for(const width of [390,320]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
      assert.equal(await evaluate('document.documentElement.scrollHeight > innerHeight'),false);
      assert.equal(await evaluate('document.querySelector("#compareTests").getBoundingClientRect().right <= innerWidth'),true);
      assert.equal(await evaluate('document.querySelector("#deleteSelectedTests").getBoundingClientRect().right <= innerWidth'),true);
      if(width===390){const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-compare-tests-390.png',Buffer.from(shot.data,'base64'));}
    }
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
    await evaluate('document.querySelector("#closeTestComparison").click()');
    assert.equal(await evaluate('document.querySelector("#manualState").value'),comparisonDraft);
    assert.equal(await evaluate('document.querySelector("#questionEditor").value'),comparisonQuestions);
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),2);
    await evaluate('document.querySelector("#clearTestSelection").click();document.querySelector("#selectAllTests").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),comparisonBefore.batches.length);
    await evaluate('document.querySelector("#compareTests").click()');
    assert.equal(await evaluate('document.querySelectorAll(".comparison-column").length'),comparisonBefore.batches.length);
    await evaluate('document.querySelector("[data-action=inspect-comparison]").click()');
    assert.equal(await evaluate('document.querySelector("#testComparison").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#manualState").value'),comparisonBefore.batches[0].input.state);
    await evaluate('document.querySelector("#clearTestSelection").click()');
    assert.equal(await evaluate('document.querySelector("#testSelectionActions").hidden'),true);
    await evaluate(`document.querySelector('[data-test-id="${firstBatchId}"] [data-action=view-batch]').click()`);
    assert.equal(await evaluate('document.querySelector("#manualState").value'), savedCase.input.state);
    assert.equal(await evaluate('document.querySelector("[data-expected=tipo]").value'), 'decisao');
    await evaluate(`(() => {const q=NorteClassifier.getConfig().questions; q.tipo.instructions += ' Changed for manual testing.'; const e=document.querySelector('#questionEditor'); e.value=JSON.stringify(q,null,2); e.dispatchEvent(new Event('input')); document.querySelector('#applyQuestions').click();})()`);
    assert.match(await evaluate('NorteClassifier.getConfig().questions.tipo.instructions'), /Changed for manual/);
    const manualDraft=await evaluate('document.querySelector("#manualState").value');
    await evaluate('document.querySelector("#questionEditor").value += "  ";document.querySelector("#questionEditor").dispatchEvent(new Event("input"))');
    const questionDraft=await evaluate('document.querySelector("#questionEditor").value');
    await evaluate('document.querySelector("#liveMode").click()');
    assert.deepEqual(await evaluate('NorteClassifier.getConfig()'), liveConfigBefore);
    assert.equal(await evaluate('document.querySelector("#panel-tests").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#panel-transcription").hidden'),false);
    assert.equal(await evaluate('document.body.dataset.page'),'live');
    await evaluate('history.back()');await sleep(100);
    assert.equal(await evaluate('document.body.dataset.page'),'manual');
    assert.equal(await evaluate('document.querySelector("#manualState").value'),manualDraft);
    assert.equal(await evaluate('document.querySelector("#questionEditor").value'),questionDraft);
    assert.equal(await evaluate('document.querySelector("#applyQuestions").disabled'),false);
    await evaluate('history.forward()');await sleep(100);
    assert.equal(await evaluate('document.body.dataset.page'),'live');
    assert.equal(await evaluate('JSON.stringify(norteSession.getSnapshot().records)'), sourceBefore);
    // Durable storage survives reload; the default recording experience returns to live mode.
    const archiveBefore = await evaluate('NorteLab.snapshot()');
    await reload();
    for(let i=0;i<100;i++){if(await evaluate('Boolean(window.NorteLab && NorteClassifier.getConfig())'))break;await sleep(50);}
    assert.deepEqual(await evaluate('NorteLab.snapshot()'), archiveBefore);
    assert.equal(await evaluate('document.querySelector("#manualStateView").hidden'), true);
    // Backups merge without duplicating or overwriting existing cases; bad files are atomic.
    await evaluate('NorteLab.importArchive(NorteLab.snapshot())');
    await sleep(100);
    assert.equal(await evaluate('NorteLab.snapshot().cases.length'), 4);
    await evaluate('NorteLab.importArchive({schemaVersion:999})');
    await sleep(100);
    assert.match(await evaluate('document.querySelector("#testMessage").textContent'), /inválido/);
    assert.equal(await evaluate('NorteLab.snapshot().cases.length'), 4);
    if (process.env.NORTE_TEST_URL) {
      for (let i=0;i<100 && !await evaluate('NorteClassifier.isAvailable()');i++) await sleep(50);
      await evaluate('document.querySelector("#manualMode").click();document.querySelector("[data-action=view-batch]").click()');
      await field('#testRepeats','10','change'); await evaluate('document.querySelector("#runTest").click()');
      for(let i=0;i<150;i++){if(await evaluate('NorteLab.snapshot().batches.at(-1).runs.length > 0'))break;await sleep(50);}
      await evaluate('document.querySelector("#cancelTest").click()'); await waitForBatch();
      const partial = await evaluate('NorteLab.snapshot().batches.at(-1)');
      assert.equal(partial.status,'cancelled');assert.ok(partial.runs.length>=1 && partial.runs.length<10);
      // Failures remain visible and never inflate agreement statistics.
      await field('#testRepeats','1','change');
      await evaluate(`window.fetchBeforeFailure = window.fetch; window.fetch = (url, options) => url === '/api/classify' ? Promise.resolve(new Response(JSON.stringify({error:'Falha simulada do modelo'}), {status:502,headers:{'Content-Type':'application/json'}})) : fetchBeforeFailure(url, options); document.querySelector('#runTest').click();`);
      await waitForBatch();
      assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).runs[0].status'),'error');
      assert.equal(await evaluate('NorteExperiments.summarize(NorteLab.snapshot().batches.at(-1)).comparisons'),0);
      await evaluate('document.querySelector(".test-run-selectors [data-run]").click()');
      assert.match(await evaluate('document.querySelector("#classificationStatus").textContent'),/Falha simulada/);
      await evaluate('window.fetch = fetchBeforeFailure');
      // Storage failure must be explicit, while the data remains available for backup.
      await field('#testName','Memória apenas');
      await evaluate(`window.storageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k === 'norte.tests.v1') throw new DOMException('Quota test','QuotaExceededError'); return storageSet.call(this,k,v); }; document.querySelector('#runTest').click();`);
      await waitForBatch();
      assert.match(await evaluate('document.querySelector("#testStorageStatus").textContent'),/Não salvo/);
      assert.ok(await evaluate('NorteLab.snapshot().batches.some(b=>b.input.name === "Memória apenas")'));
      await evaluate('Storage.prototype.setItem = storageSet;window.dispatchEvent(new Event("pagehide"))');
      assert.equal(await evaluate('document.querySelector("#testStorageStatus").textContent'),'');
      // A reload during an unfinished call records an interrupted batch, not a successful run.
      await evaluate(`window.fetch = (url, options) => url === '/api/classify' ? new Promise(() => {}) : fetchBeforeFailure(url, options); document.querySelector('#runTest').click();`);
      assert.equal(await evaluate('NorteLab.isRunning()'),true);
      await reload();
      for(let i=0;i<100;i++){if(await evaluate('Boolean(window.NorteLab && NorteClassifier.getConfig())'))break;await sleep(50);}
      assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).status'),'interrupted');
      assert.equal(await evaluate('NorteLab.snapshot().batches.at(-1).runs.length'),0);
    }
    // Destructive controls are exercised only in this isolated temporary profile.
    const beforeDelete = await evaluate('NorteLab.snapshot()');
    const deletedBatchId = beforeDelete.batches[0].id;
    await evaluate(`window.confirm = text => { window.lastConfirmation = text; return false; }; document.querySelector('#manualMode').click();`);
    await evaluate(`document.querySelector('[data-test-id="${deletedBatchId}"] [data-action=delete-batch]').click()`);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'), beforeDelete, 'cancelled confirmation changes nothing');
    assert.match(await evaluate('lastConfirmation'),/não pode ser desfeita/);
    // A failed deletion write leaves both the displayed and persisted data intact.
    await evaluate(`window.confirm=()=>true; window.deleteStorageSet=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){if(k==='norte.tests.v1')throw new DOMException('Full','QuotaExceededError');return deleteStorageSet.call(this,k,v);};document.querySelector('[data-test-id="${deletedBatchId}"] [data-action=delete-batch]').click();`);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'), beforeDelete);
    assert.match(await evaluate('document.querySelector("#testMessage").textContent'),/Não foi possível excluir/);
    await evaluate('Storage.prototype.setItem = deleteStorageSet');
    if(process.env.NORTE_TEST_URL) {
      await evaluate(`document.querySelector('[data-test-id="${deletedBatchId}"] [data-action=view-batch]').click();`);
      assert.equal(await evaluate('document.querySelectorAll(".test-run-selectors button").length'),5);
      await evaluate(`document.querySelector('[data-run="4"]').click()`);
      await evaluate('document.querySelector("[data-action=delete-run]").click()');
      assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'','successful deletion is silent');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#testMessage")).display'),'none');
      assert.equal(await evaluate('document.querySelectorAll(".test-run-selectors button").length'),4);
      const changed=await evaluate('NorteLab.snapshot().batches[0]');
      assert.deepEqual(changed.runs[3],{index:4,status:'deleted'});
      assert.equal(await evaluate('NorteExperiments.summarize(NorteLab.snapshot().batches[0]).comparisons'),9);
      // A stale tab save cannot restore the removed run.
      await evaluate(`(() => {const stale=${JSON.stringify(beforeDelete)};localStorage.setItem('norte.tests.v1',JSON.stringify(stale));window.dispatchEvent(new StorageEvent('storage',{key:'norte.tests.v1',newValue:JSON.stringify(stale)}));})()`);
      assert.deepEqual(await evaluate('NorteLab.snapshot().batches[0].runs[3]'),{index:4,status:'deleted'});
    }
    await evaluate(`document.querySelector('[data-test-id="${deletedBatchId}"] [data-action=delete-batch]').click();`);
    assert.equal(await evaluate('NorteLab.snapshot().batches.length'),beforeDelete.batches.length-1);
    assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'');
    assert.equal(await evaluate('document.querySelectorAll("#testSummary [data-run]").length'),await evaluate('Number(document.querySelector("#testRepeats").value)'));
    assert.equal(await evaluate('[...document.querySelectorAll("#testSummary [data-run]")].every(button=>button.disabled && button.dataset.status==="pending")'),true,'deleted batch leaves only the planned, unexecuted placeholders');
    assert.deepEqual(await evaluate('NorteLab.snapshot().cases'),beforeDelete.cases,'legacy cases are not deleted by removing their UI');
    await reload();
    for(let i=0;i<100;i++){if(await evaluate('Boolean(window.NorteLab && NorteClassifier.getConfig())'))break;await sleep(50);}
    assert.equal(await evaluate(`NorteLab.snapshot().batches.some(b=>b.id === ${JSON.stringify(deletedBatchId)})`),false,'deletion survives reload');
    // An explicit pre-deletion backup restores content with new IDs; tombstones stay valid.
    await evaluate(`NorteLab.importArchive(${JSON.stringify(beforeDelete)})`);
    await sleep(100);
    assert.deepEqual(await evaluate('NorteLab.snapshot().cases'),beforeDelete.cases);
    assert.equal(await evaluate('NorteLab.snapshot().batches.length'),beforeDelete.batches.length);
    assert.equal(await evaluate(`NorteLab.snapshot().batches.some(b=>b.id === ${JSON.stringify(deletedBatchId)})`),false);
    assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'','successful import is silent');
    assert.equal(await evaluate('document.querySelectorAll("#testFilter, #saveTestCase, [data-action=load-case], .connection-dot").length'),0);
    assert.equal(await evaluate('Boolean(NorteExperiments.validateArchive(NorteLab.snapshot()))'),true);
    assert.equal(await evaluate('document.body.dataset.page'),'manual','manual route survives reload');
    // Bulk deletion is one confirmed, atomic save; unselected tests and legacy cases survive.
    const beforeBulk=await evaluate('NorteLab.snapshot()');
    const bulkIds=beforeBulk.batches.slice(0,2).map(b=>b.id);
    for(const id of bulkIds) await evaluate(`document.querySelector('[data-select-test="${id}"]').click()`);
    await evaluate('document.querySelector("#compareTests").click()');
    await evaluate('window.confirm=text=>{window.lastConfirmation=text;return false;};document.querySelector("#deleteSelectedTests").click()');
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),beforeBulk);
    assert.match(await evaluate('lastConfirmation'),/2 teste\(s\).*todas as suas execuções/);
    await evaluate(`window.confirm=()=>true;window.bulkStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='norte.tests.v1')throw new DOMException('Full','QuotaExceededError');return bulkStorageSet.call(this,k,v);};document.querySelector('#deleteSelectedTests').click()`);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),beforeBulk);
    assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("norte.tests.v1"))'),beforeBulk);
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),2);
    assert.equal(await evaluate('document.querySelectorAll(".comparison-column").length'),2);
    assert.match(await evaluate('document.querySelector("#testMessage").textContent'),/Não foi possível excluir/);
    await evaluate('Storage.prototype.setItem=bulkStorageSet;document.querySelector("#deleteSelectedTests").click()');
    assert.deepEqual(await evaluate('NorteLab.snapshot().batches.map(b=>b.id)'),beforeBulk.batches.filter(b=>!bulkIds.includes(b.id)).map(b=>b.id));
    assert.deepEqual(await evaluate('NorteLab.snapshot().cases'),beforeBulk.cases);
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),0);
    assert.equal(await evaluate('document.querySelector("#testComparison").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#testSelectionActions").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'');
    await evaluate(`(() => {const stale=${JSON.stringify(beforeBulk)};localStorage.setItem('norte.tests.v1',JSON.stringify(stale));window.dispatchEvent(new StorageEvent('storage',{key:'norte.tests.v1',newValue:JSON.stringify(stale)}));})()`);
    assert.equal(await evaluate(`NorteLab.snapshot().batches.some(b=>${JSON.stringify(bulkIds)}.includes(b.id))`),false);
    await reload();
    for(let i=0;i<100;i++){if(await evaluate('Boolean(window.NorteLab && NorteClassifier.getConfig())'))break;await sleep(50);}
    assert.equal(await evaluate(`NorteLab.snapshot().batches.some(b=>${JSON.stringify(bulkIds)}.includes(b.id))`),false);
    assert.equal(await evaluate('Boolean(NorteExperiments.validateArchive(NorteLab.snapshot()))'),true);
    // Different contracts, deleted-only results, and remote removal remain isolated.
    const mixedInput={...savedCase.input,name:'Pergunta diferente',state:'Outro State',config:{model:'jev-latest',questions:{tipo:{type:'noul',instructions:'Different question, same key?'}}},expected:{tipo:{type:'noul',value:false}}};
    const mixed={id:'mixed-contract-fixture',createdAt:savedCase.createdAt,input:mixedInput,requested:1,status:'done',runs:[{index:1,status:'deleted'}]};
    const failed={id:'failed-comparison-fixture',createdAt:savedCase.createdAt,input:savedCase.input,requested:4,status:'interrupted',runs:[]};
    await importArchive({schemaVersion:1,cases:[],batches:[mixed,failed]});
    for(const id of [mixed.id,failed.id]) await evaluate(`document.querySelector('[data-select-test="${id}"]').click()`);
    await evaluate('document.querySelector("#compareTests").click()');
    assert.equal(await evaluate('document.querySelector("[data-comparison-id=mixed-contract-fixture] .primitive-type").textContent'),'Noul');
    assert.equal(await evaluate('document.querySelector("[data-comparison-id=mixed-contract-fixture] .answer-instructions").textContent'),mixedInput.config.questions.tipo.instructions);
    assert.equal(await evaluate('document.querySelector("[data-comparison-id=failed-comparison-fixture] .primitive-type").textContent'),'Choice');
    assert.equal(await evaluate('document.querySelectorAll("#testComparison .aggregate-label").length'),0);
    // A running batch discovered at commit time rejects the whole removal, not just its own ID.
    const beforeConflict=await evaluate('NorteLab.snapshot()');
    await evaluate(`(() => {const current=NorteLab.snapshot();const b=current.batches.find(b=>b.id==='${failed.id}');b.status='running';b.runs=[{index:1,status:'error',error:'Fixture: no model output.'}];localStorage.setItem('norte.tests.v1',JSON.stringify(current));window.confirm=()=>true;document.querySelector('#deleteSelectedTests').click();})()`);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),beforeConflict);
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("norte.tests.v1")).batches.some(b=>b.id==="mixed-contract-fixture")'),true);
    assert.match(await evaluate('document.querySelector("#testMessage").textContent'),/Não foi possível excluir/);
    await evaluate(`localStorage.setItem('norte.tests.v1',JSON.stringify(${JSON.stringify(beforeConflict)}))`);
    await evaluate(`(() => {const other=NorteLab.snapshot();NorteExperiments.removeItem(other,'batches','${mixed.id}');localStorage.setItem('norte.tests.v1',JSON.stringify(other));window.dispatchEvent(new StorageEvent('storage',{key:'norte.tests.v1',newValue:JSON.stringify(other)}));})()`);
    assert.equal(await evaluate('document.querySelectorAll("[data-select-test]:checked").length'),1);
    assert.equal(await evaluate('document.querySelectorAll(".comparison-column").length'),1);
    assert.equal(await evaluate('document.querySelector(".comparison-column").dataset.comparisonId'),failed.id);
    await evaluate('document.querySelector("#deleteSelectedTests").click()');
    assert.equal(await evaluate('document.querySelector("#testComparison").hidden'),true);
    assert.equal(await evaluate('document.querySelector("#testMessage").textContent'),'');
    // Backward-compatible data import stays atomic, without a JSON toolbar.
    const prototypeTest=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/prototype-v1.json'),'utf8'));
    const prototypeRequest={model:prototypeTest.model,state:prototypeTest.state,questions:prototypeTest.questions};
    const beforeRequestLoad=await evaluate('NorteLab.snapshot()');
    const beforeDraft=await evaluate('NorteLab.draft()');
    assert.match(await evaluate(`(()=>{try{NorteLab.loadJSON('{"state":{}}');return '';}catch(e){return e.message;}})()`),/model, state e questions/);
    assert.equal(await evaluate('NorteLab.draft().text'),beforeDraft.text);
    await evaluate(`NorteLab.loadJSON(${JSON.stringify(JSON.stringify(prototypeTest))})`);
    assert.deepEqual(await evaluate('NorteLab.draft().expected'),prototypeTest.expected);
    assert.deepEqual(await evaluate('NorteLab.snapshot()'),beforeRequestLoad);
    assert.equal(await evaluate('document.querySelectorAll("#openRequestImport,#exportRequest,#requestImportDialog").length'),0);
    assert.equal(await evaluate('Boolean(document.querySelector("#testToolbar #newTestCase"))'),true);
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-summary .primitive-type").length'),0);
    assert.equal(await evaluate('document.querySelectorAll("#classificationResults [data-expected]").length'),8);
    await field('#manualState','{"recent_context":');
    assert.equal(await evaluate('document.querySelector("#runTest").disabled'),true);
    assert.match(await evaluate('document.querySelector("#stateError").textContent'),/JSON inválido/);
    await field('#manualState',JSON.stringify(prototypeRequest.state,null,2));
    assert.equal(await evaluate('document.querySelector("#stateError").textContent'),'');
    await evaluate('document.querySelector("#liveMode").click()');
    assert.deepEqual(await evaluate('NorteClassifier.getConfig()'),liveConfigBefore);
    await evaluate('document.querySelector("#manualMode").click()');
    assert.deepEqual(await evaluate('NorteClassifier.getConfig().questions'),prototypeRequest.questions);
    assert.deepEqual(await evaluate('JSON.parse(document.querySelector("#manualState").value)'),prototypeRequest.state);
    for(const width of [390,320]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'),false);
      assert.equal(await evaluate('document.querySelector("#useExample").getBoundingClientRect().bottom <= document.querySelector(".state-pane").getBoundingClientRect().bottom'),true);
      assert.equal(await evaluate('document.querySelector("#useExample").getBoundingClientRect().bottom <= document.querySelector(".state-pane").getBoundingClientRect().bottom'),true);
      assert.equal(await evaluate(`(() => {const row=document.querySelector('#classificationResults .answer-summary'),r=row.getBoundingClientRect(),s=row.querySelector('select').getBoundingClientRect();return s.right<=r.right && s.left>=r.left;})()`),true);
      if(width===390){const shot=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile('/tmp/norte-expected-mobile.png',Buffer.from(shot.data,'base64'));}
    }
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false}); await sleep(100);
    if(process.env.NORTE_TEST_URL) {
      for(let i=0;i<100 && !await evaluate('NorteClassifier.isAvailable()');i++)await sleep(50);
      await field('[data-expected=meaningful_event]','true','change');
      await field('#testRepeats','1','change');
      await evaluate(`window.structuredRequests=[];window.beforeStructuredFetch=window.fetch;window.fetch=(url,options)=>{if(url==='/api/classify')structuredRequests.push(JSON.parse(options.body));return beforeStructuredFetch(url,options);};document.querySelector('#runTest').click()`);
      assert.equal(await evaluate('document.querySelector("#stateFormat").disabled'),true);
      assert.equal(await evaluate('document.querySelector("#useExample").disabled'),true);
      await waitForBatch();
      const structured=await evaluate('NorteLab.snapshot().batches.at(-1)');
      assert.equal(structured.runs[0].status,'done',JSON.stringify(structured.runs[0]));
      assert.deepEqual(await evaluate('structuredRequests'),[prototypeRequest]);
      const result=structured.runs[0].output;
      assert.deepEqual(result.request,prototypeRequest);
      assert.deepEqual(result.effectiveRequest.state,prototypeRequest.state);
      assert.equal(result.requestAdapter,'jevos-noul-criteria-v1');
      for(const [key,q] of Object.entries(prototypeRequest.questions)) {
        assert.equal(result.response.answers[key].type,q.type);
        if(q.type==='noul') for(const label of ['true','false']) assert.ok(result.effectiveRequest.questions[key].instructions.includes(q.criteria[label]));
        else assert.deepEqual(result.effectiveRequest.questions[key],q);
      }
      assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-pending").length'),0,'structured State binds to its exact output');
      assert.equal(await evaluate('document.querySelectorAll("#classificationResults .obtained-confidence").length'),8);
      const prototypeImage=await call('Page.captureScreenshot',{format:'png'});
      await fs.writeFile('/tmp/norte-prototype-test.png',Buffer.from(prototypeImage.data,'base64'));
      await evaluate('document.querySelector(".test-run-selectors [data-run]").click()');
      assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-pending").length'),0);
      assert.equal(await evaluate('document.querySelectorAll(".criterion-description").length'),8);
      await evaluate(`document.querySelector('[data-select-test="${structured.id}"]').click();document.querySelector('#compareTests').click()`);
      assert.equal(await evaluate('document.querySelector(".comparison-state p").textContent'),JSON.stringify(prototypeRequest.state,null,2));
      await evaluate('document.querySelector("#clearTestSelection").click()');
      const structuredArchive=await evaluate('NorteLab.snapshot()');
      await importArchive(structuredArchive);
      assert.deepEqual(await evaluate('NorteLab.snapshot()'),structuredArchive);
      await reload();
      for(let i=0;i<100;i++){if(await evaluate('Boolean(window.NorteLab && NorteClassifier.getConfig())'))break;await sleep(50);}
      await evaluate(`document.querySelector('[data-test-id="${structured.id}"] [data-action=view-batch]').click()`);
      assert.deepEqual(await evaluate('JSON.parse(document.querySelector("#manualState").value)'),prototypeRequest.state);
      assert.equal(await evaluate('document.querySelectorAll("#classificationResults .answer-pending").length'),0);
      assert.deepEqual(await evaluate('NorteLab.snapshot().batches.at(-1).runs[0].output'),result);
    }
    // The hidden recording controls cannot leave audio running on the manual page.
    await evaluate('document.querySelector("#liveMode").click();document.querySelector("#micBtn").click()');
    const countBeforePause=await evaluate('norteSession.getSnapshot().records.length');
    await evaluate(`engines.at(-1).onspeechstart();advance(1000);engines.at(-1).emit([['Navegação preserva',false]]);document.querySelector('#manualMode').click();`);
    assert.equal(await evaluate('document.querySelector("#micBtn").getAttribute("aria-pressed")'),'false');
    await evaluate(`engines.at(-1).emit([['Navegação preserva a fala final.',true]]);engines.at(-1).onend();`);
    assert.equal(await evaluate('norteSession.getSnapshot().records.length'),countBeforePause+1);
    assert.equal(await evaluate('norteSession.getSnapshot().records.at(-1).text'),'Navegação preserva a fala final.');
    assert.equal(await evaluate('document.querySelectorAll(".classifier-output pre, .output-heading").length'),0);
    assert.deepEqual(errors, []);
    console.log('PASS: live/manual routes, sidebar + mobile overlay, summary/individual results, multi-selection + comparison, atomic bulk deletion, seconds, manual drafts, real repetitions, languages, safe deletion + restore, speech/layout regressions, no runtime exceptions.');
    console.log('Screenshots: /tmp/norte-centered-idle.png, /tmp/norte-classifier-1440.png, /tmp/norte-classifier-390.png');
  } finally {
    socket?.close();
    chrome.kill('SIGTERM');
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
