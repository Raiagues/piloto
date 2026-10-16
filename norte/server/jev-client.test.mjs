import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { bridgeHeaders, confidentChoice, createJevClient } from './jev-client.mjs';

const secret = 'test-secret-with-at-least-thirty-two-characters';
test('the private Jev client signs the exact body and account scope; credentials never enter user state', async () => {
  let request;
  const client = createJevClient({ env: { NORTE_MEETING_BRIDGE_SECRET: secret }, fetch: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ response: { model: 'jev-latest', answers: { x: {} } }, latencyMs: 15 })); } });
  assert.equal(client.enabled, true);
  const output = await client.classify('person-1', { text: 'camera 1 kg' }, { x: { type: 'choice' } });
  assert.equal(output.latencyMs, 15); assert.equal(String(request.url), 'http://127.0.0.1:8790/api/classify');
  const headers = request.options.headers, digest = createHash('sha256').update(request.options.body).digest('hex');
  const canonical = ['POST', '/api/classify', 'person-1', 'user:person-1', 'user', headers['X-Norte-Bridge-Time'], digest].join('\n');
  assert.equal(headers['X-Norte-Bridge-Signature'], createHmac('sha256', secret).update(canonical).digest('hex'));
  assert.equal(request.options.redirect, 'error'); assert.equal(request.options.body.includes(secret), false);
});

test('disabled credentials, external origins and invalid actor ids cannot send a request', async () => {
  for (const origin of ['https://127.0.0.1:8790', 'http://example.com', 'http://127.0.0.1.example.com', 'http://person:password@localhost']) {
    const client = createJevClient({ env: { NORTE_MEETING_BRIDGE_SECRET: secret, NORTE_MEETING_BACKEND_URL: origin }, fetch: async () => { throw Error('must not call'); } });
    assert.equal(client.enabled, false); assert.equal(await client.classify('person', {}, {}), null);
  }
  const client = createJevClient({ env: { NORTE_MEETING_BRIDGE_SECRET: secret }, fetch: async () => { throw Error('must not call'); } });
  assert.equal(await client.classify('../../x', {}, {}), null);
  await assert.rejects(client.classify('person', { text: 'x'.repeat(16000) }, {}), /limite/);
});

test('high confidence must agree with calibrated probabilities and allowed answers', () => {
  const answer = { type: 'choice', choice: 'a', confidence: .98, probabilities: { a: .98, b: .02 } };
  assert.equal(confidentChoice(answer, ['a', 'b']), 'a');
  assert.equal(confidentChoice({ ...answer, confidence: .7 }, ['a', 'b']), null);
  assert.equal(confidentChoice({ ...answer, probabilities: { a: .1, b: .9 } }, ['a', 'b']), null);
  assert.equal(confidentChoice({ ...answer, choice: 'private' }, ['a', 'b']), null);
  assert.equal(confidentChoice({ ...answer, probabilities: { a: '0.98', b: .02 } }, ['a', 'b']), null);
  assert.equal(confidentChoice({ ...answer, probabilities: { a: 4, b: -3 } }, ['a', 'b']), null);
});

test('bridge signature is deterministic and changes with each identity, scope and body', () => {
  const input = { method: 'POST', path: '/api/classify', actorId: 'u1', body: '{}', secret, now: 1000 };
  const signature = value => bridgeHeaders(value)['X-Norte-Bridge-Signature'];
  assert.equal(signature(input), signature(input));
  for (const variation of [{ actorId: 'u2' }, { scope: 'meeting:m1' }, { body: '{"a":1}' }]) assert.notEqual(signature(input), signature({ ...input, ...variation }));
});
