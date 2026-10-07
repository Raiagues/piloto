const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Cutter, alignWords } = require('../speech-windows.js');
const { Ledger } = require('../transcription.js');
const result = (text, final = false) => Object.assign([{ transcript: text, confidence: .8 }], { isFinal: final });

function interruptedSentence(prefix, full) {
  const cutter = new Cutter(), ledger = new Ledger();
  cutter.voice(true, 1000); ledger.beginRun(); ledger.speechStart(1000);
  ledger.ingest([result(prefix)], 0, 4000, 'pt-BR');
  cutter.voice(false, 5000); cutter.tick(6000);
  cutter.voice(true, 6500);
  ledger.ingest([result(full, true)], 0, 9000, 'pt-BR');
  cutter.flush(9000);
  return { cutter, ledger };
}
test('classifier restores the complete bar-size request instead of sending only de 5', () => {
  const full = 'Eu quero mudar o tamanho da barra para 10 cm ao invés de 5';
  const { cutter, ledger } = interruptedSentence('Eu quero mudar o tamanho da barra para 10 cm ao invés', full);
  assert.equal(cutter.view(ledger.records).at(-1).text, 'de 5');
  const inputs = cutter.classificationView(ledger.records);
  assert.equal(inputs.at(-1).text, full);
  assert.equal(inputs.at(-1).context, 'same-utterance-prefix');
  assert.equal(inputs.at(-1).windowText, 'de 5');
  assert.equal(inputs.at(-1).inputStartMs, 1000);
  assert.ok(!inputs[0].text.endsWith('de 5'), 'never reads a future suffix into an earlier window');
  for (const packet of inputs) for (const source of packet.inputSources) {
    assert.equal(ledger.records.find(r => r.id === source.sourceId).text.slice(source.charStart, source.charEnd), source.text);
  }
  const restored = new Cutter(cutter.snapshot());
  assert.equal(restored.classificationView(ledger.records).at(-1).text, full);
});
test('classifier restores the full decision instead of a lone dimensão', () => {
  const prefix = 'Nossa deu muito certo então a gente vai definir 100% que a gente vai usar essa nova';
  const full = prefix + ' dimensão';
  const { cutter, ledger } = interruptedSentence(prefix, full);
  assert.equal(cutter.view(ledger.records).at(-1).text, 'dimensão');
  assert.equal(cutter.classificationView(ledger.records).at(-1).text, full);
});
test('restoration does not include previous completed sentences, takes or unrelated turns', () => {
  const { cutter, ledger } = interruptedSentence('Outro assunto encerrado. Vamos definir a nova', 'Outro assunto encerrado. Vamos definir a nova dimensão');
  const packet = cutter.classificationView(ledger.records).at(-1);
  assert.equal(packet.text, 'Vamos definir a nova dimensão');
  assert.ok(!packet.text.includes('Outro assunto'));
  cutter.takeId = 2; cutter.voice(true, 9000); ledger.beginRun(); ledger.speechStart(9000);
  ledger.ingest([result('Obrigado.', true)], 0, 10000, 'pt-BR'); ledger.records.at(-1).takeId = 2; cutter.flush(10000);
  assert.equal(cutter.classificationView(ledger.records).at(-1).text, 'Obrigado.');
});
test('15 second windows remain bounded while long speech gets a bounded explicit prefix', () => {
  const cutter = new Cutter(), ledger = new Ledger();
  const prefix = Array.from({ length: 300 }, (_, i) => 'palavra' + i).join(' ');
  cutter.voice(true, 0); ledger.beginRun(); ledger.speechStart(0);
  ledger.ingest([result(prefix)], 0, 12000, 'pt-BR'); cutter.tick(15000);
  ledger.ingest([result(prefix + ' terminamos.', true)], 0, 18000, 'pt-BR'); cutter.flush(18000);
  const packet = cutter.classificationView(ledger.records).at(-1);
  assert.ok(packet.text.endsWith('terminamos.'));
  assert.ok(packet.text.split(/\s+/).length <= 161);
  assert.equal(packet.contextTruncated, true);
  assert.ok(cutter.windows.every(w => w.endMs - w.startMs <= 15000));
});
test('delayed words in VAD gaps are retained rather than silently disappearing', () => {
  const cutter = new Cutter(); cutter.voice(true, 0); cutter.flush(5000); cutter.voice(true, 9000);
  const text = 'fala atrasada';
  const record = { id:'r', text, status:'final', startMs:1000, wordMarks:[{ text:'fala', offset:0, atMs:1000 }, { text:'atrasada', offset:5, atMs:7000 }] };
  assert.equal(cutter.view([record]).flatMap(p => p.sources).map(s => s.text).join(''), text);
});

test('a pause before 5 seconds waits for minimum duration, without empty silence packets', () => {
  const cutter = new Cutter();
  cutter.voice(true, 1000); cutter.voice(false, 3000);
  cutter.tick(5999); assert.equal(cutter.windows[0].endMs, null);
  cutter.tick(6000); assert.equal(cutter.windows[0].endMs, 6000);
  assert.equal(cutter.windows[0].reason, 'pause');
  cutter.tick(200000); assert.equal(cutter.windows.length, 1);
});
test('pause after 5s closes at 650ms of silence; short hesitations do not cut', () => {
  const cutter = new Cutter();
  cutter.voice(true, 0); cutter.voice(false, 6000); cutter.voice(true, 6400);
  cutter.tick(7000); assert.equal(cutter.windows[0].endMs, null);
  cutter.voice(false, 8000); cutter.tick(8650);
  assert.equal(cutter.windows[0].endMs, 8650);
});
test('continuous speech cuts at 15s even with a delayed timer; window durations never exceed 15s', () => {
  const cutter = new Cutter(); cutter.voice(true, 0); cutter.tick(47000);
  assert.deepEqual(cutter.windows.filter(w => w.endMs !== null).map(w => w.endMs - w.startMs), [15000, 15000, 15000]);
  assert.equal(cutter.active.startMs, 45000);
});
test('manual stop keeps short final tail instead of dropping text', () => {
  const cutter = new Cutter(); cutter.voice(true, 10000); cutter.flush(12000);
  assert.equal(cutter.windows[0].endMs, 12000);
  assert.equal(cutter.windows[0].reason, 'manual');
});
test('interim text spans windows, final corrections revise the original window without duplication', () => {
  const cutter = new Cutter(); const ledger = new Ledger(); ledger.beginRun();
  cutter.voice(true, 0); ledger.speechStart(0);
  ledger.ingest([result('Precisamos de dois sensores')], 0, 2000, 'pt-BR');
  cutter.tick(15000);
  ledger.ingest([result('Precisamos de dois sensores com bateria')], 0, 17000, 'pt-BR');
  let packets = cutter.view(ledger.records);
  assert.equal(packets[0].text, 'Precisamos de dois sensores');
  assert.equal(packets[1].text, 'com bateria');
  ledger.ingest([result('Precisamos de três sensores com bateria.', true)], 0, 19000, 'pt-BR');
  packets = cutter.view(ledger.records);
  assert.equal(packets[0].text, 'Precisamos de três sensores');
  assert.equal(packets[0].status, 'confirmed');
  assert.equal(packets[1].text, 'com bateria.');
  assert.equal(packets.flatMap(p => p.sources.map(s => s.text)).join(''), ledger.records[0].text);
  assert.ok(packets.every(p => p.context === 'none'));
});
test('replacement words retain estimated source times and appended words get current event time', () => {
  const before = alignWords('a bateria dura dez horas', [], 1000, 4000);
  const after = alignWords('a bateria dura duas horas sem recarga', before, 1000, 17000);
  assert.equal(after[3].atMs, 1000);
  assert.equal(after.at(-1).atMs, 17000);
});
test('reload closes unfinished window and preserves its text independently of later captures', () => {
  const cutter = new Cutter(); cutter.voice(true, 2000); cutter.tick(7000);
  const restored = new Cutter(cutter.snapshot());
  assert.equal(restored.windows[0].endMs, 7000);
  assert.equal(restored.windows[0].reason, 'reload');
  restored.voice(true, 7000); assert.equal(restored.windows[1].id, 'window-2');
});
test('restarting at an identical timestamp never moves a late final into the next take', () => {
  const cutter = new Cutter(); const ledger = new Ledger();
  ledger.beginRun(); ledger.speechStart(0); cutter.voice(true, 0);
  ledger.ingest([result('Vamos testar')], 0, 1000, 'pt-BR');
  ledger.records[0].takeId = 1;
  ledger.ingest([result('Vamos testar amanhã.', true)], 0, 2000, 'pt-BR');
  ledger.finishRun(); cutter.flush(2000);
  cutter.takeId = 2; cutter.takeOffsetMs = 2000;
  cutter.voice(true, 2000); ledger.beginRun(); ledger.speechStart(2000);
  ledger.ingest([result('Quantos sensores?', true)], 0, 3000, 'pt-BR');
  ledger.records[1].takeId = 2;
  cutter.flush(3000);
  const packets = cutter.view(ledger.records);
  assert.equal(packets[0].text, 'Vamos testar amanhã.');
  assert.equal(packets[1].text, 'Quantos sensores?');
  assert.equal(packets[1].takeOffsetMs, 2000);
  const restored = new Cutter(cutter.snapshot());
  assert.equal(restored.takeId, 2);
  assert.deepEqual(restored.view(ledger.records), packets);
});
