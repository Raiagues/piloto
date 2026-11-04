const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Ledger } = require('../meetings/web/transcription.js');
const { alignWords } = require('../meetings/web/speech-windows.js');

const confirmed = ledger =>
  ledger.records
    .filter(record => record.status === 'final')
    .map(record => record.text)
    .join(' ');

function result(text, isFinal = true) {
  const value = [{ transcript: text, confidence: 0.9 }];
  value.isFinal = isFinal;
  return value;
}

test('revises interim words in place, records approximate start time and deduplicates replayed finals', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.speechStart(2100);
  ledger.ingest([result('precisamos de dez', false)], 0, 3000, 'pt-BR');
  assert.equal(confirmed(ledger), '');
  ledger.ingest([result('precisamos de dois sensores', false)], 0, 4000, 'pt-BR');
  ledger.ingest([result('Precisamos de dois sensores.')], 0, 5000, 'pt-BR');
  ledger.ingest([result('Precisamos de dois sensores.')], 0, 5500, 'pt-BR');
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].startMs, 2100);
  assert.equal(ledger.records[0].endMs, 5000);
  assert.equal(confirmed(ledger), 'Precisamos de dois sensores.');
});

test('finals arriving after stop are retained; restart result indices do not overwrite earlier speech', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('Se houver falha', false)], 0, 3000, 'pt-BR');
  // The adapter waits for end after stop, allowing this late final.
  ledger.ingest([result('Se houver falha')], 0, 3100, 'pt-BR');
  ledger.finishRun();
  ledger.beginRun();
  ledger.speechStart(7000);
  ledger.ingest([result('devemos acionar a redundância.')], 0, 11000, 'pt-BR');
  assert.equal(ledger.records.length, 2);
  assert.notEqual(ledger.records[0].id, ledger.records[1].id);
  assert.equal(ledger.records[1].startMs, 7000);
});

test('unconfirmed interrupted speech is preserved for review but never used as confirmed model evidence', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('talvez o prazo seja', false)], 0, 1000, 'pt-BR');
  ledger.finishRun();
  assert.equal(ledger.records[0].status, 'unconfirmed');
  assert.equal(ledger.records[0].text, 'talvez o prazo seja');
  assert.equal(confirmed(ledger), '');
});

test('retracted interim results disappear instead of becoming duplicate evidence', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('primeiro', false), result('hipótese removida', false)], 0, 2000, 'pt-BR');
  ledger.ingest([result('Primeiro resultado.')], 0, 3000, 'pt-BR');
  assert.equal(ledger.records.length, 1);
  assert.equal(confirmed(ledger), 'Primeiro resultado.');
});

test('reload preserves confirmed text and increments run IDs, while recovering partial text as unconfirmed', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('Requisito confirmado.'), result('outro requisito', false)], 0, 5000, 'pt-BR');
  const restored = new Ledger(JSON.parse(JSON.stringify(ledger.snapshot())));
  assert.equal(restored.records[1].status, 'unconfirmed');
  restored.beginRun();
  restored.ingest([result('Uma nova fala.')], 0, 9000, 'pt-BR');
  assert.equal(restored.records.length, 3);
  assert.equal(new Set(restored.records.map(r => r.id)).size, 3);
  assert.equal(restored.sessionId, ledger.sessionId);
  assert.equal(confirmed(restored), 'Requisito confirmado. Uma nova fala.');
});

test('snapshots are detached and cannot mutate the original records', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('Texto original.')], 0, 1000, 'pt-BR');
  ledger.snapshot().records[0].text = 'alterado';
  assert.equal(confirmed(ledger), 'Texto original.');
});

test('replacement words retain estimated source times and appended words get current event time', () => {
  const before = alignWords('a bateria dura dez horas', [], 1000, 4000);
  const after = alignWords('a bateria dura duas horas sem recarga', before, 1000, 17000);
  assert.equal(after[3].atMs, 1000);
  assert.equal(after.at(-1).atMs, 17000);
});
