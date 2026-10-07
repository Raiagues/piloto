// A real browser checks the visual projection and interactions; no API or model calls.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process'), { setTimeout: sleep } = require('node:timers/promises');
(async () => {
  const root = path.resolve(__dirname, '..'), errors = [];
  const server = http.createServer(async (req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (name === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/relation-map.css"><style>body{margin:0;background:#061623;color:white;font-family:Arial,sans-serif}.memory-page{height:100vh;display:grid}#map{height:100vh;grid-row:1}button{cursor:pointer}</style><main class="memory-page"><section id="map"></section></main><script src="/relation-map.js"></script><script>window.selected=[];window.map=NorteRelationMap.create(document.querySelector("#map"),{onSelect:id=>selected.push(id)});</script></html>');
    if (!['/relation-map.js', '/relation-map.css'].includes(name)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/css' }).end(await fs.readFile(path.join(root, name.slice(1))));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'norte-relation-map-'));
  const chrome = spawn('google-chrome', ['--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', '--no-first-run', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let socket;
  try {
    let port; for (let i = 0; i < 120; i++) { try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch (_) { await sleep(50); } } assert.ok(port);
    const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()); socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let next = 0; const pending = new Map();
    socket.addEventListener('message', e => { const message = JSON.parse(e.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); if (message.id) { const item = pending.get(message.id); if (!item) return; pending.delete(message.id); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); } });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
    const wait = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await sleep(50); } throw Error('Timeout: ' + expression); };
    await call('Runtime.enable'); await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 760, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }); await wait('typeof window.map?.render === "function"'); await call('Page.bringToFront');
    const run = { createdAt: '2026-10-06T10:00:00Z', batch: { batch_id: 'MAP' }, meeting_events: [
      { event_id: 'E001', chunk_id: 'C01', type: 'observation', thread_id: 'T001', text: 'A base vibra acima do limite.' },
      { event_id: 'E002', chunk_id: 'C02', type: 'test_proposal', thread_id: 'T001', text: 'Vamos testar a base com uma parede de 4 mm.' },
      { event_id: 'E003', chunk_id: 'C03', type: 'test_result', thread_id: 'T001', text: 'No teste da base de 4 mm a vibração caiu.' },
      { event_id: 'E004', chunk_id: 'C04', type: 'observation', thread_id: 'T002', text: 'A vedação apresenta um vazamento.' },
      { event_id: 'E005', chunk_id: 'C05', type: 'requirement', thread_id: null, text: 'O cliente exige massa inferior a 2 kg.' }
    ], meeting_relations: [] };
    await evaluate(`window.run=${JSON.stringify(run)};map.render(run)`);
    assert.equal(await evaluate('document.querySelectorAll(".rm-node").length'), 5); assert.equal(await evaluate('document.querySelectorAll(".rm-edge").length'), 0);
    const before = await evaluate('[...document.querySelectorAll(".rm-node")].map(n=>[n.dataset.eventId,n.getAttribute("transform")])');
    await evaluate('window.firstNode=document.querySelector(".rm-node")');
    run.meeting_relations.push({ source_event_id: 'E003', target_event_id: 'E002', relation_type: 'result_of', configuration_match: 'exact', review_state: 'confirmed' });
    run.meeting_relations.push({ source_event_id: 'E002', target_event_id: 'E001', relation_type: 'related_to', configuration_match: null, review_state: 'needs_review' });
    // Invalid/none edges are never visual links, even if an imported projection contains one.
    run.meeting_relations.push({ source_event_id: 'E003', target_event_id: 'E001', relation_type: 'none' });
    run.meeting_relations.push({ source_event_id: 'E004', target_event_id: 'E001', relation_type: 'related_to' });
    run.meeting_relations.push({ source_event_id: 'E005', target_event_id: 'E001', relation_type: 'supports' });
    await evaluate(`Object.assign(run,${JSON.stringify(run)});window.original=JSON.stringify(run);map.render(run)`);
    assert.equal(await evaluate('JSON.stringify(run)===original'), true); assert.equal(await evaluate('firstNode===document.querySelector(".rm-node")'), true);
    assert.equal(await evaluate('document.querySelectorAll(".rm-edge").length'), 2); assert.deepEqual(await evaluate('[...document.querySelectorAll(".rm-node")].map(n=>[n.dataset.eventId,n.getAttribute("transform")])'), before);
    const arrow = await evaluate('(()=>{const e=document.querySelector(".rm-edge[data-source=E003][data-target=E002] path");return [e.getAttribute("marker-end"),e.getAttribute("d"),e.getAttribute("stroke")];})()');
    assert.match(arrow[0], /result_of/); assert.match(arrow[1], /^M.+Q/); assert.equal(arrow[2], '#66d6f2');
    await evaluate('document.querySelector("[data-event-id=E002]").dispatchEvent(new PointerEvent("pointerenter"))');
    assert.equal(await evaluate('document.querySelectorAll(".rm-node.is-related").length'), 3); assert.equal(await evaluate('document.querySelectorAll(".rm-edge.is-related").length'), 2);
    assert.match(await evaluate('document.querySelector(".rm-detail").textContent'), /← Resultado de/); assert.match(await evaluate('document.querySelector(".rm-detail").textContent'), /configuração exata/); assert.match(await evaluate('document.querySelector(".rm-detail").textContent'), /→ Relaciona-se a/);
    await wait('getComputedStyle(document.querySelector(".rm-edge.is-related .rm-edge-label")).opacity === "1"');
    await evaluate('document.querySelector("[data-event-id=E002]").dispatchEvent(new PointerEvent("pointerleave"));document.querySelector("[data-event-id=E004]").focus()');
    assert.equal(await evaluate('document.querySelectorAll(".rm-node.is-related").length'), 1, await evaluate('JSON.stringify({active:document.activeElement.outerHTML,detail:document.querySelector(".rm-detail").outerHTML})')); assert.match(await evaluate('document.querySelector(".rm-detail").textContent'), /Ainda sem relação direta/);
    await evaluate('document.querySelector("[data-event-id=E004]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))'); assert.deepEqual(await evaluate('selected'), ['E004']);
    await evaluate('document.querySelector(".rm-surface").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); assert.equal(await evaluate('document.querySelector(".rm-detail").hidden'), true);
    const zoom = await evaluate('document.querySelector(".rm-surface").dataset.zoom'); await evaluate('document.querySelector(".rm-controls button:nth-child(2)").click()'); assert.ok(Number(await evaluate('document.querySelector(".rm-surface").dataset.zoom')) > Number(zoom));
    // Appending a node does not replace or rearrange the existing nodes.
    run.meeting_events.push({ event_id: 'E006', chunk_id: 'C06', type: 'hypothesis', thread_id: 'T002', text: 'Talvez a vedação esteja frouxa. <img src=x onerror=alert(1)>' });
    await evaluate(`Object.assign(run,${JSON.stringify(run)});map.render(run)`); assert.deepEqual((await evaluate('[...document.querySelectorAll(".rm-node")].slice(0,5).map(n=>[n.dataset.eventId,n.getAttribute("transform")])')), before);
    assert.equal(await evaluate('document.querySelectorAll("#map img").length'), 0);
    await evaluate('document.querySelector(".rm-surface").focus();document.querySelector(".rm-controls button:nth-child(3)").click()');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile('/tmp/norte-relation-map.png', Buffer.from(screenshot.data, 'base64'));
    await evaluate('document.querySelector("[data-event-id=E002]").dispatchEvent(new PointerEvent("pointerenter"))');
    const highlighted = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile('/tmp/norte-relation-map-highlighted.png', Buffer.from(highlighted.data, 'base64'));
    // Drag a node with real pointer events; arrows follow its new position.
    const rect = await evaluate('(()=>{const r=document.querySelector("[data-event-id=E003] circle.rm-node-dot").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    const oldPosition = await evaluate('document.querySelector("[data-event-id=E003]").getAttribute("transform")');
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + 55, y: rect.y + 25, button: 'left', buttons: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 55, y: rect.y + 25, button: 'left', clickCount: 1 });
    assert.notEqual(await evaluate('document.querySelector("[data-event-id=E003]").getAttribute("transform")'), oldPosition);
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true }); await evaluate('map.reset()'); await sleep(60);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true); assert.ok(await evaluate('document.querySelector(".rm-surface").getBoundingClientRect().height>400'));
    const mobile = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile('/tmp/norte-relation-map-mobile.png', Buffer.from(mobile.data, 'base64'));
    await evaluate('map.render(null)'); assert.equal(await evaluate('document.querySelectorAll(".rm-node,.rm-edge").length'), 0); assert.equal(await evaluate('document.querySelector(".rm-empty").hidden'), false);
    await evaluate('map.destroy()'); assert.equal(await evaluate('document.querySelector("#map").children.length'), 0); assert.deepEqual(errors, []);
    console.log('PASS: incremental graph, preserved positions, only actual same-thread edges, directional colored arrows, hover and keyboard neighbors, no HTML injection, pan/zoom controls, node dragging, mobile viewport and cleanup. No model calls.');
  } finally { socket?.close(); await new Promise(resolve => { if (chrome.exitCode !== null) return resolve(); chrome.once('exit', resolve); chrome.kill('SIGTERM'); }); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
