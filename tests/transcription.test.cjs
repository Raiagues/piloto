const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Ledger } = require('../transcription.js');

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
  assert.equal(ledger.segments().filter(s => s.status === 'final').length, 0);
  ledger.ingest([result('precisamos de dois sensores', false)], 0, 4000, 'pt-BR');
  ledger.ingest([result('Precisamos de dois sensores.')], 0, 5000, 'pt-BR');
  ledger.ingest([result('Precisamos de dois sensores.')], 0, 5500, 'pt-BR');
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].startMs, 2100);
  assert.equal(ledger.records[0].endMs, 5000);
  assert.equal(ledger.export().fullText, 'Precisamos de dois sensores.');
});

test('separates sentences and uninterrupted long speech without losing a single source character', () => {
  const ledger = new Ledger();
  const text = 'Primeira frase.  Segunda frase! ' + 'palavra '.repeat(145) + 'conclusão';
  ledger.beginRun();
  ledger.ingest([result(text)], 0, 10000, 'pt-BR');
  const segments = ledger.segments();
  assert.equal(segments.length, 5);
  assert.equal(segments.map(s => s.text).join(''), text);
  assert.ok(segments.some(s => s.boundary === 'readability-limit'));
  for (const segment of segments) {
    assert.equal(text.slice(segment.charStart, segment.charEnd), segment.text);
    assert.equal(segment.startMs, 10000); // No guessed per-word alignment.
    assert.ok(segment.text.trim().split(/\s+/).length <= 60);
  }
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
  assert.equal(ledger.segments().length, 2);
});

test('unconfirmed interrupted speech is preserved for review but never used as confirmed model evidence', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('talvez o prazo seja', false)], 0, 1000, 'pt-BR');
  ledger.finishRun();
  assert.equal(ledger.segments()[0].status, 'unconfirmed');
  assert.equal(ledger.segments().filter(s => s.status === 'final').length, 0);
  assert.equal(ledger.export().records[0].text, 'talvez o prazo seja');
  assert.equal(ledger.export().fullText, '');
});

test('retracted interim results disappear instead of becoming duplicate evidence', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('primeiro', false), result('hipótese removida', false)], 0, 2000, 'pt-BR');
  ledger.ingest([result('Primeiro resultado.')], 0, 3000, 'pt-BR');
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.export().fullText, 'Primeiro resultado.');
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
  assert.equal(restored.export().fullText, 'Requisito confirmado. Uma nova fala.');
});

test('exports are detached snapshots and cannot mutate original transcript records', () => {
  const ledger = new Ledger();
  ledger.beginRun();
  ledger.ingest([result('Texto original.')], 0, 1000, 'pt-BR');
  const exported = ledger.export();
  exported.records[0].text = 'alterado';
  exported.segments[0].text = 'alterado';
  assert.equal(ledger.export().fullText, 'Texto original.');
});
