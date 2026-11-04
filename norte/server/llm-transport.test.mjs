import test from 'node:test';
import assert from 'node:assert/strict';
import { generateJson, retryDelay, strictSchema } from './llm-transport.mjs';

const call = {
  model: 'test',
  instructions: 'public prompt',
  input: 'public test',
  schema: { type: 'object', properties: {} },
  policy: { timeoutMs: 1000, maxAttempts: 2, totalDeadlineMs: 5000 },
  apiKey: 'test',
};
const completed = (text, extra = {}) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      model: 'gpt-test',
      output: [
        { type: 'reasoning', summary: [{ text: 'PRIVATE_THOUGHT' }] },
        { type: 'message', content: [{ type: 'output_text', text }] },
      ],
      ...extra,
    }),
  );

test('the request follows the OpenAI Responses contract and keeps nothing on the provider', async () => {
  let sent;
  const output = await generateJson({
    ...call,
    schema: { type: 'object', properties: { items: { type: 'array', maxItems: 3, items: { type: 'string' } } } },
    schemaName: 'review',
    maxOutputTokens: 900,
    fetchImpl: async (url, init) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) };
      return completed('{"items":[]}');
    },
  });
  assert.deepEqual(output, { items: [] });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.headers.Authorization, 'Bearer test');
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.max_output_tokens, 900);
  assert.equal(sent.body.temperature, undefined);
  assert.equal(sent.body.text.format.strict, true);
  assert.equal(sent.body.text.format.name, 'review');
  assert.equal(sent.body.text.format.schema.additionalProperties, false);
  assert.deepEqual(sent.body.text.format.schema.required, ['items']);
  assert.equal(sent.body.text.format.schema.properties.items.maxItems, undefined);
});

test('strict schemas keep enum values and close nested objects', () => {
  const schema = strictSchema({
    type: 'object',
    required: ['a'],
    properties: {
      a: { type: 'string', enum: ['minimum', 'format'] },
      b: { type: 'object', properties: { c: { type: 'integer', minimum: 0 } } },
    },
  });
  assert.deepEqual(schema.required, ['a', 'b']);
  assert.deepEqual(schema.properties.a.enum, ['minimum', 'format']);
  assert.deepEqual(schema.properties.b, {
    type: 'object',
    properties: { c: { type: 'integer' } },
    additionalProperties: false,
    required: ['c'],
  });
});

test('transient retry records both physical requests, honors server delay, and excludes private fields', async () => {
  let count = 0;
  const records = [],
    delays = [];
  const result = await generateJson({
    ...call,
    apiKey: 'SECRET_VALUE',
    random: () => 0,
    wait: async delay => {
      delays.push(delay);
    },
    onAttempt: record => records.push(record),
    fetchImpl: async () =>
      ++count === 1
        ? new Response(JSON.stringify({ error: { message: 'Temporary SECRET_VALUE' } }), {
            status: 503,
            headers: { 'retry-after': '2', 'set-cookie': 'PRIVATE_COOKIE', 'x-request-id': 'public-id' },
          })
        : completed('{"entities":[]}'),
  });
  assert.deepEqual(result, { entities: [] });
  assert.equal(count, 2);
  assert.deepEqual(delays, [2000]);
  assert.deepEqual(
    records.map(item => item.status),
    ['provider_error', 'provider_completed'],
  );
  assert.equal(records[0].headers['x-request-id'], 'public-id');
  assert.doesNotMatch(JSON.stringify(records), /SECRET_VALUE|PRIVATE_COOKIE|PRIVATE_THOUGHT|Authorization/u);
});

test('long Retry-After and permanent failures stop without retry; an empty answer is a model-output failure', async () => {
  for (const [status, headers] of [
    [429, { 'retry-after': '3600' }],
    [400, {}],
    [403, {}],
    [404, {}],
    [200, {}],
  ]) {
    let count = 0;
    const attempts = [];
    await assert.rejects(
      generateJson({
        ...call,
        fetchImpl: async () => {
          count++;
          return new Response(status === 200 ? '{"status":"completed","output":[]}' : '{"error":{"code":"x"}}', {
            status,
            headers,
          });
        },
        onAttempt: record => attempts.push(record),
      }),
      error => error.category === (status === 200 ? 'schema_rejection' : 'provider_error'),
    );
    assert.equal(count, 1);
    assert.equal(attempts[0].retryScheduled, false);
    if (status === 200) assert.equal(attempts[0].status, 'provider_completed');
  }
});

test('a client timeout is distinct from provider 504 and can have one bounded retry', async () => {
  const attempts = [];
  let count = 0;
  await assert.rejects(
    generateJson({
      ...call,
      wait: async () => {},
      fetchImpl: async () => {
        count++;
        throw Object.assign(new Error('local deadline'), { name: 'TimeoutError' });
      },
      onAttempt: record => attempts.push(record),
    }),
    error => error.category === 'provider_timeout',
  );
  assert.equal(count, 2);
  assert.ok(attempts.every(item => item.clientAborted && item.httpStatus === null));
  assert.equal(
    retryDelay(
      new Response(null, { headers: { 'retry-after': 'Tue, 08 Sep 2026 12:00:02 GMT' } }).headers,
      1,
      () => 0,
      Date.parse('2026-09-08T12:00:00Z'),
    ),
    2000,
  );
});

test('an exhausted quota is an external block, not a transient retry', async () => {
  let count = 0;
  await assert.rejects(
    generateJson({
      ...call,
      fetchImpl: async () => {
        count++;
        return new Response('{"error":{"code":"insufficient_quota","message":"Quota exceeded"}}', { status: 429 });
      },
    }),
    error => error.category === 'provider_error',
  );
  assert.equal(count, 1);
});

test('valid JSON in a cut, refused or filtered answer is never accepted or retried', async () => {
  const message = [{ type: 'message', content: [{ type: 'output_text', text: '{"valid":"json"}' }] }];
  for (const [reply, code] of [
    [
      { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: message },
      'LLM_RESPONSE_INCOMPLETE',
    ],
    [
      { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: message },
      'LLM_RESPONSE_BLOCKED',
    ],
    [
      { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'não' }] }] },
      'LLM_RESPONSE_BLOCKED',
    ],
  ]) {
    let calls = 0;
    await assert.rejects(
      generateJson({
        ...call,
        fetchImpl: async () => {
          calls++;
          return new Response(JSON.stringify(reply));
        },
      }),
      { code },
    );
    assert.equal(calls, 1);
  }
});

test('usage is read from the provider, an exhausted budget is incomplete, and missing usage stays unknown', async () => {
  const attempts = [];
  await assert.rejects(
    generateJson({
      ...call,
      maxOutputTokens: 1000,
      onAttempt: record => attempts.push(record),
      fetchImpl: async () =>
        completed('{}', { usage: { input_tokens: 40, output_tokens: 1000, privateField: 'SECRET' } }),
    }),
    { code: 'LLM_RESPONSE_INCOMPLETE' },
  );
  assert.equal(attempts[0].inputTokens, 40);
  assert.equal(attempts[0].outputTokens, 1000);
  assert.doesNotMatch(JSON.stringify(attempts), /SECRET|privateField/);
  const records = [];
  assert.deepEqual(
    await generateJson({ ...call, fetchImpl: async () => completed('{}'), onAttempt: record => records.push(record) }),
    {},
  );
  assert.equal(records[0].usageAvailable, false);
});

test('provider errors never log echoed project data or raw messages', async () => {
  const attempts = [];
  await assert.rejects(
    generateJson({
      ...call,
      apiKey: 'secret-key',
      onAttempt: record => attempts.push(record),
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: 'Private hypothesis customer@example.test secret-key' } }), {
          status: 400,
        }),
    }),
  );
  assert.doesNotMatch(JSON.stringify(attempts), /Private hypothesis|customer@|secret-key/);
});

test('the same call can select Gemini', async () => {
  let sent;
  assert.deepEqual(
    await generateJson({
      ...call,
      provider: 'gemini',
      fetchImpl: async (url, init) => {
        sent = { url, headers: init.headers };
        return new Response(
          '{"candidates":[{"finishReason":"STOP","content":{"parts":[{"thought":true,"text":"x"},{"text":"{}"}]}}]}',
        );
      },
    }),
    {},
  );
  assert.ok(sent.url.endsWith('test:generateContent'));
  assert.equal(sent.headers['x-goog-api-key'], 'test');
});
