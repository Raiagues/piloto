'use strict';
// The scoring of the LYLE suite, checked by hand on a tiny case so a wrong metric cannot pass unnoticed.
const test = require('node:test'),
  assert = require('node:assert/strict');
const { score, iou } = require('./lyle/metrics.cjs');

const alert = { id: 'A', turn: 'T1', rule: 'r1', start: 10, end: 20, proofTurns: ['T0'] };
const finding = (extra = {}) => ({
  turnKey: 'T1',
  ruleId: 'r1',
  start: 10,
  end: 20,
  evidence: [{ turnKey: 'T0' }],
  ...extra,
});

test('marks that coincide score 1; half of the mark scores 1/3', () => {
  assert.equal(iou({ start: 10, end: 20 }, { start: 10, end: 20 }), 1);
  assert.equal(iou({ start: 10, end: 20 }, { start: 15, end: 25 }), 1 / 3);
});

test('a perfect finding scores everything', () => {
  const result = score([alert], [finding()], 10);
  assert.deepEqual(
    [
      result.recall,
      result.precision,
      result.f1,
      result.rightRule,
      result.meanIou,
      result.closeMarks,
      result.proofRight,
      result.falseAlarmsPer100,
    ],
    [1, 1, 1, 1, 1, 1, 1, 0],
  );
});

test('a finding in another turn is a false alarm, not a hit', () => {
  const result = score([alert], [finding({ turnKey: 'T2' })], 10);
  assert.equal(result.recall, 0);
  assert.equal(result.precision, 0);
  assert.equal(result.falseAlarmsPer100, 10);
});

test('the right place with the wrong rule counts as found but not as the right rule', () => {
  const result = score([alert], [finding({ ruleId: 'r2' })], 10);
  assert.equal(result.recall, 1);
  assert.equal(result.rightRule, 0);
});

test('a finding that does not touch the mark inside the same turn is a false alarm', () => {
  assert.equal(score([alert], [finding({ start: 30, end: 40 })], 10).found, 0);
});

test('an alert without an expected proof is left out of the proof metric', () => {
  assert.equal(score([{ ...alert, proofTurns: [] }], [finding()], 10).proofRight, null);
});
