'use strict';
// Transport and bookkeeping of the highlights with a fake JEV. Says nothing about how well the questions work:
// that is measured by the LYLE suite (tests/lyle/highlights.cjs), which uses the real provider.
const test = require('node:test'),
  assert = require('node:assert/strict');
const H = require('../meetings/web/meeting-highlights.js'),
  Q = require('../prompts/jev/questions.js');

const turns = [
  { key: 'T1', speaker: 'Ana', offsetMs: 12000, text: 'O ensaio de vibração ainda não terminou.' },
  {
    key: 'T2',
    speaker: 'Rui',
    offsetMs: 75000,
    text: 'Bom dia. No resumo, o ensaio consta como concluído, então seguimos.',
  },
];
const noul = value => ({ type: 'noul', noul: value });
const reply = answers => ({ response: { answers } });
function fakeJev(request) {
  if (request.questions.status_without_evidence) {
    const hit = request.state.current_sentence.includes('resumo');
    return reply(
      Object.fromEntries(
        Object.keys(Q.highlights).map(id => [id, noul(hit && id === 'status_without_evidence' ? 0.9 : 0.1)]),
      ),
    );
  }
  const answers = {};
  for (const [id, text] of Object.entries(request.state.fragments))
    answers[`fragment__${id}`] = noul(text.includes('consta') ? 0.9 : 0.1);
  answers.evidence = { type: 'choice', choice: 'S1', confidence: 0.8 };
  return reply(answers);
}

test('a transcript is cut into sentences with offsets inside the turn', () => {
  const list = H.sentences(turns);
  assert.deepEqual(
    list.map(item => item.id),
    ['T1#1', 'T2#1', 'T2#2'],
  );
  assert.equal(turns[1].text.slice(list[2].start, list[2].end), list[2].text);
});

test('a decimal point does not end a sentence', () => {
  assert.equal(H.sentences([{ key: 'T', text: 'A massa é 2.5 kg. Confere.' }]).length, 2);
});

test('fragments drop connectors and keep exact offsets', () => {
  const [sentence] = H.sentences([{ key: 'T', text: 'Por isso, podemos considerar que não há risco.' }]);
  const pieces = H.fragments(sentence);
  assert.deepEqual(
    pieces.map(item => item.text),
    ['Por isso', 'podemos considerar', 'não há risco.'],
  );
  for (const piece of pieces) assert.equal(sentence.text.slice(piece.start, piece.end), piece.text);
});

test('a flagged sentence becomes a finding with the exact span and its proof', async () => {
  const result = await H.analyze(turns, async request => fakeJev(request));
  assert.equal(result.findings.length, 1);
  const [finding] = result.findings;
  assert.equal(finding.ruleId, 'status_without_evidence');
  assert.equal(finding.affectedText, turns[1].text.slice(finding.start, finding.end));
  assert.equal(finding.affectedText, 'o ensaio consta como concluído');
  assert.deepEqual(finding.evidence, [
    { sentenceId: 'T1#1', turnKey: 'T1', speaker: 'Ana', time: '00m12s', quote: turns[0].text },
  ]);
  assert.equal(finding.time, '01m15s');
  assert.equal(result.calls, 4);
});

test('every finding carries the fields of a requirement finding', async () => {
  const {
    findings: [finding],
  } = await H.analyze(turns, async request => fakeJev(request));
  for (const field of ['ruleId', 'severity', 'title', 'explanation', 'suggestion', 'start', 'end', 'affectedText'])
    assert.notEqual(finding[field], undefined, field);
});

test('a provider failure stops the analysis instead of returning a partial success', async () => {
  await assert.rejects(
    H.analyze(turns, async () => {
      throw new Error('JEV indisponível');
    }),
    /JEV indisponível/,
  );
});

test('low scores produce no finding and the first sentence has no proof to choose', async () => {
  const seen = [];
  const result = await H.analyze(turns.slice(0, 1), async request => {
    seen.push(request);
    return reply(Object.fromEntries(Object.keys(Q.highlights).map(id => [id, noul(0.59)])));
  });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(seen[0].state.earlier_statements, []);
  assert.equal(H.locateRequest(H.sentences(turns)[0], [], 'contradicts_record').questions.evidence, undefined);
});

test('the requests fit the limits of the classifier', () => {
  const list = H.sentences(turns),
    long = { ...list[0], text: 'a, b, c, d, e, f, g, h, i, j.' };
  const request = H.locateRequest(long, list.slice(0, 1), 'contradicts_record');
  assert.ok(Object.keys(request.questions).length <= 32);
  for (const rule of Object.values(Q.highlights)) assert.ok(rule.instructions.length <= 1500);
});

test('every rule has a question and the text a person reads', () => {
  assert.deepEqual(Object.keys(Q.highlightRules).sort(), Object.keys(Q.highlights).sort());
  for (const rule of Object.values(Q.highlightRules))
    for (const field of ['severity', 'title', 'problem', 'explanation', 'suggestion']) assert.ok(rule[field], field);
});

test('overlapping findings stay on the same marked piece', () => {
  const text = 'abcdefghij',
    a = { id: 'a', start: 2, end: 6 },
    b = { id: 'b', start: 4, end: 8 };
  assert.deepEqual(
    H.segments(text, [a, b]).map(piece => [piece.text, piece.findings.map(item => item.id)]),
    [
      ['ab', []],
      ['cd', ['a']],
      ['ef', ['a', 'b']],
      ['gh', ['b']],
      ['ij', []],
    ],
  );
});
