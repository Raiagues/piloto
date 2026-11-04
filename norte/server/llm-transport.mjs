/** Direct REST transport for structured answers. One observable record per physical request, including retries. */
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const PUBLIC_HEADERS = [
  'retry-after',
  'server-timing',
  'x-request-id',
  'x-goog-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
];
const DEFAULT_POLICY = Object.freeze({ timeoutMs: 90_000, maxAttempts: 2, totalDeadlineMs: 185_000 });
const LOCAL_ONLY_KEYWORDS = new Set([
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
]);
const count = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** Strict structured output closes every object and requires every field; limits stay in the local validation. */
export function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const clean = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !LOCAL_ONLY_KEYWORDS.has(key))
      .map(([key, value]) => [key, key === 'enum' ? value : strictSchema(value)]),
  );
  return schema.type === 'object' && schema.properties
    ? { ...clean, additionalProperties: false, required: Object.keys(schema.properties) }
    : clean;
}

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    url: () => 'https://api.openai.com/v1/responses',
    headers: apiKey => ({ Authorization: `Bearer ${apiKey}` }),
    body: ({ model, instructions, input, schema, schemaName, maxOutputTokens }) => ({
      model,
      instructions,
      input,
      store: false,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name: schemaName, schema: strictSchema(schema), strict: true } },
    }),
    read(data) {
      const parts = (Array.isArray(data.output) ? data.output : [])
        .filter(item => item?.type === 'message')
        .flatMap(item => (Array.isArray(item.content) ? item.content : []));
      const refused = parts.some(part => part?.type === 'refusal'),
        reason = data.incomplete_details?.reason;
      return {
        present: Array.isArray(data.output) && parts.length > 0,
        text: parts
          .filter(part => part?.type === 'output_text')
          .map(part => part.text)
          .join(''),
        finished: data.status === 'completed' && !refused,
        blocked: refused || reason === 'content_filter',
        finishReason: refused ? 'refusal' : reason || data.status || null,
        modelVersion: data.model,
        inputTokens: count(data.usage?.input_tokens),
        outputTokens: count(data.usage?.output_tokens),
      };
    },
  },
  gemini: {
    label: 'Google Gemini',
    url: model => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: apiKey => ({ 'x-goog-api-key': apiKey }),
    body: ({ instructions, input, schema, maxOutputTokens }) => ({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
      generationConfig: {
        maxOutputTokens,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    }),
    read(data) {
      const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null,
        usage = data.usageMetadata;
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      return {
        present: Boolean(candidate),
        text: parts
          .filter(part => typeof part?.text === 'string' && !part.thought)
          .map(part => part.text)
          .join(''),
        finished: candidate?.finishReason === 'STOP',
        blocked:
          Boolean(data.promptFeedback?.blockReason) ||
          ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(candidate?.finishReason),
        finishReason: candidate?.finishReason ?? null,
        modelVersion: data.modelVersion,
        inputTokens: count(usage?.promptTokenCount),
        outputTokens: usage ? (count(usage.candidatesTokenCount) ?? 0) + (count(usage.thoughtsTokenCount) ?? 0) : null,
      };
    },
  },
};

export function retryDelay(headers, attempt, random = Math.random, now = Date.now()) {
  const value = headers?.get('retry-after');
  const serverDelay =
    value == null ? 0 : Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Math.max(
    Number.isFinite(serverDelay) ? Math.max(0, serverDelay) : 0,
    Math.min(10_000, 1000 * 2 ** (attempt - 1)) * (0.5 + random() * 0.5),
  );
}

const failure = (code, message, category, statusCode = 502) =>
  Object.assign(new Error(message), { code, category, statusCode });
const rejected = category => Object.assign(new Error('Provider answer rejected'), { category });
const FAILURES = {
  schema_rejection: [
    'LLM_RESPONSE_INVALID',
    'The AI answer did not match the expected structure. Project memory is preserved.',
  ],
  provider_incomplete: ['LLM_RESPONSE_INCOMPLETE', 'The AI response was cut before it finished. Nothing was saved.'],
  provider_blocked: ['LLM_RESPONSE_BLOCKED', 'The provider refused or blocked this analysis. Nothing was saved.'],
  provider_timeout: [
    'LLM_UNAVAILABLE',
    'The engineering service exceeded the local deadline. Project memory is preserved.',
  ],
  provider_error: ['LLM_UNAVAILABLE', 'The AI service is unavailable. Project memory is preserved.'],
};

export async function generateJson({
  provider = 'openai',
  apiKey,
  model,
  instructions,
  input,
  schema,
  schemaName = 'result',
  maxOutputTokens = 6000,
  fetchImpl = fetch,
  policy = DEFAULT_POLICY,
  onAttempt = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  random = Math.random,
}) {
  const adapter = PROVIDERS[provider],
    started = Date.now();
  const serialized = JSON.stringify(adapter.body({ model, instructions, input, schema, schemaName, maxOutputTokens }));
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const start = Date.now(),
      timeoutMs = Math.min(policy.timeoutMs, policy.totalDeadlineMs - (start - started));
    if (timeoutMs <= 0) break;
    const record = {
      provider: adapter.label,
      model,
      attempt,
      startedAt: new Date(start).toISOString(),
      requestChars: serialized.length,
      requestBytes: Buffer.byteLength(serialized),
      approximateRequestTokens: Math.ceil(serialized.length / 4),
      approximateTokenMethod: 'characters/4; not tokenizer or billing',
      schemaChars: JSON.stringify(schema || {}).length,
      contextChars: String(input).length,
      timeoutMs,
      headers: {},
      httpStatus: null,
      timeToHeadersMs: null,
      responseBytes: 0,
      status: 'provider_error',
      clientAborted: false,
      outputLimit: maxOutputTokens,
    };
    let response, output, error;
    try {
      response = await fetchImpl(adapter.url(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adapter.headers(apiKey) },
        body: serialized,
        signal: AbortSignal.timeout(timeoutMs),
      });
      record.timeToHeadersMs = Date.now() - start;
      record.httpStatus = response.status;
      record.headers = Object.fromEntries(
        PUBLIC_HEADERS.flatMap(name => (response.headers.get(name) ? [[name, response.headers.get(name)]] : [])),
      );
      const raw = await response.text();
      record.responseBytes = Buffer.byteLength(raw);
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw rejected(response.ok ? 'schema_rejection' : 'provider_error');
      }
      // Only listed fields leave this function.
      record.quotaUnavailable =
        response.status === 429 &&
        /\blimit:\s*0\b|insufficient_quota/iu.test(`${data.error?.message || ''} ${data.error?.code || ''}`);
      if (!response.ok) throw rejected('provider_error');
      const reply = adapter.read(data);
      record.modelVersion =
        typeof reply.modelVersion === 'string' && /^[\w.-]{1,100}$/u.test(reply.modelVersion)
          ? reply.modelVersion
          : null;
      record.finishReason = reply.finishReason;
      record.inputTokens = reply.inputTokens;
      record.outputTokens = reply.outputTokens;
      record.usageAvailable = reply.inputTokens !== null || reply.outputTokens !== null;
      record.status = 'provider_completed';
      if (reply.blocked) throw rejected('provider_blocked');
      if (!reply.present) throw rejected('schema_rejection');
      if (!reply.finished || (reply.outputTokens !== null && reply.outputTokens >= maxOutputTokens))
        throw rejected('provider_incomplete');
      try {
        output = JSON.parse(reply.text);
      } catch {
        throw rejected('schema_rejection');
      }
    } catch (caught) {
      const timeout = caught.name === 'TimeoutError' || caught.name === 'AbortError';
      const category = timeout ? 'provider_timeout' : caught.category || 'provider_error';
      const [code, message] = FAILURES[category];
      error = failure(code, message, category);
      record.clientAborted = timeout;
      record.failureCategory = category;
      record.status = category === 'schema_rejection' ? 'provider_completed' : category;
    }
    record.elapsedMs = Date.now() - start;
    const delay = retryDelay(response?.headers, attempt, random);
    const retryable =
      error &&
      !record.quotaUnavailable &&
      (error.category === 'provider_timeout' ||
        (error.category === 'provider_error' && (!response || RETRY_STATUSES.has(response.status))));
    record.retryScheduled = Boolean(
      retryable && attempt < policy.maxAttempts && Date.now() - started + delay + 1000 < policy.totalDeadlineMs,
    );
    record.retryDelayMs = record.retryScheduled ? delay : null;
    await onAttempt(record);
    if (!error) return output;
    if (!record.retryScheduled) throw error;
    await wait(delay);
  }
  throw failure(
    'LLM_UNAVAILABLE',
    'The analysis request budget expired. Run the requirements analysis again.',
    'provider_timeout',
  );
}
