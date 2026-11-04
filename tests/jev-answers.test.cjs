const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('../meetings/web/jev-answers.js');

const questions = {
  kept: { type: 'noul', instructions: 'A fala traz um fato?' },
  kind: { type: 'choice', instructions: 'Qual o tipo?', criteria: { fato: 'Um fato.', pedido: 'Um pedido.' } },
};
const input = { state: { fala: 'O ensaio passou.' }, config: { model: 'jev-latest', questions } };
const output = answers => ({
  request: { model: 'jev-latest', state: input.state, questions },
  response: { model: 'jev-1.14.0', answers },
  latencyMs: 120,
});
const noul = value => ({ type: 'noul', noul: value });
const choice = (name, probabilities) => ({ type: 'choice', choice: name, confidence: 0.9, probabilities });

test('State must be non-empty text or JSON within the size and depth limits', () => {
  J.validateState('Uma fala.');
  J.validateState({ fala: 'Uma fala.', turnos: [1, true, null] });
  for (const state of ['   ', 'x'.repeat(16001), {}, null, 7]) assert.throws(() => J.validateState(state));
  let deep = {};
  for (let level = 0; level < 20; level++) deep = { deep };
  assert.throws(() => J.validateState(deep), /16 níveis/);
});

test('the question limits follow the JEV contract', () => {
  J.validateConfig(input.config);
  const config = question => ({ model: 'jev-latest', questions: { q: question } });
  assert.throws(() => J.validateConfig({ model: 'outro', questions }), /inválida/);
  assert.throws(() => J.validateConfig({ model: 'jev-latest', questions: {} }), /1 a 32/);
  assert.throws(() => J.validateConfig(config({ type: 'noul', instructions: 'x'.repeat(1501) })), /inválida/);
  assert.throws(
    () => J.validateConfig(config({ type: 'choice', instructions: 'x', criteria: { a: 'só uma' } })),
    /2 a 12/,
  );
  assert.throws(
    () => J.validateConfig(config({ type: 'noul', instructions: 'x', criteria: { talvez: 'y' } })),
    /true e\/ou false/,
  );
  assert.throws(() => J.validateConfig(config({ type: 'noul', instructions: 'x', extra: 1 })), /desconhecido/);
});

test('a complete response for the same request is accepted', () => {
  J.validateOutput(output({ kept: noul(0.8), kind: choice('fato', { fato: 0.8, pedido: 0.2 }) }), input);
});

test('a response for another request, incomplete or out of range is rejected', () => {
  const good = { kept: noul(0.8), kind: choice('fato', { fato: 0.8, pedido: 0.2 }) };
  assert.throws(
    () => J.validateOutput({ ...output(good), request: { model: 'jev-latest', state: 'outra', questions } }, input),
    /não corresponde/,
  );
  assert.throws(() => J.validateOutput(output({ kept: good.kept }), input), /incompletas/);
  assert.throws(() => J.validateOutput(output({ ...good, kept: noul(1.4) }), input), /Probabilidade/);
  assert.throws(
    () => J.validateOutput(output({ ...good, kind: choice('outro', { fato: 0.8, pedido: 0.2 }) }), input),
    /Classe/,
  );
});

test('the predicted value and its probability come from the answer itself', () => {
  assert.equal(J.predicted(noul(0.6)), true);
  assert.equal(J.predicted(noul(0.4)), false);
  assert.equal(J.predicted(choice('pedido', { fato: 0.3, pedido: 0.7 })), 'pedido');
  assert.equal(J.probabilityOf(noul(0.8), true), 0.8);
  assert.ok(Math.abs(J.probabilityOf(noul(0.8), false) - 0.2) < 1e-9);
  assert.equal(J.probabilityOf(choice('fato', { fato: 0.7, pedido: 0.3 }), 'pedido'), 0.3);
  assert.equal(J.probabilityOf(noul(0.8), null), null);
});
