import test from "node:test";
import assert from "node:assert/strict";
import { geminiGenerate, retryDelay } from "./gemini-transport.mjs";
import { compactExtractionSchema, evidenceFactSetSchema, extractionEnums, validateFactSet, assembleExtraction, sourceLedger, assembleLedgerExtraction, ledgerExtractionSchema } from "./extraction-pipeline.mjs";
import { hydrateExtraction } from "./system-ai.mjs";
import { engineeringSystemSchema } from "../shared/engineering-schema.mjs";
const body = { contents: [{ role: "user", parts: [{ text: "public test" }] }], generationConfig: { temperature: 0.1, responseJsonSchema: { type: "object" } } };
const policy = { timeoutMs: 1000, maxAttempts: 2, totalDeadlineMs: 5000 };
const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: "PRIVATE_THOUGHT" }, { text: '{"entities":[]}' }] }, finishReason: "STOP" }], usageMetadata: { totalTokenCount: 10 } }));
test("transient retry records both physical requests, honors server delay, and excludes private fields", async () => {
  let count = 0; const records = [], delays = [];
  const result = await geminiGenerate({ apiKey: "SECRET_VALUE", model: "test", body, policy, random: () => 0, wait: async (delay) => { delays.push(delay); }, fetchImpl: async () => ++count === 1 ? new Response(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "Temporary SECRET_VALUE" } }), { status: 503, headers: { "retry-after": "2", "set-cookie": "PRIVATE_COOKIE", "x-request-id": "public-id" } }) : ok(), onAttempt: (record, payload) => records.push({ record, payload }) });
  assert.deepEqual(result, { entities: [] }); assert.equal(count, 2); assert.deepEqual(delays, [2000]);
  assert.deepEqual(records.map((item) => item.record.status), ["provider_error", "provider_completed"]);
  assert.equal(records[0].record.headers["x-request-id"], "public-id");
  assert.doesNotMatch(JSON.stringify(records), /SECRET_VALUE|PRIVATE_COOKIE|PRIVATE_THOUGHT|x-goog-api-key/u);
});
test("long Retry-After and permanent failures stop without retry; malformed JSON is a model-output failure", async () => {
  for (const [status, headers] of [[429, { "retry-after": "3600" }], [400, {}], [403, {}], [404, {}], [200, {}]]) {
    let count = 0; const attempts = [];
    await assert.rejects(geminiGenerate({ apiKey: "test", model: "test", body, policy, fetchImpl: async () => { count++; return new Response(status === 200 ? '{"candidates":[]}' : '{"error":{"code":400}}', { status, headers }); }, onAttempt: (record) => attempts.push(record) }), (error) => error.category === (status === 200 ? "schema_rejection" : "provider_error"));
    assert.equal(count, 1); assert.equal(attempts[0].retryScheduled, false);
    if (status === 200) assert.equal(attempts[0].status, "provider_completed");
  }
});
test("a client timeout is distinct from provider 504 and can have one bounded retry", async () => {
  const attempts = []; let count = 0;
  await assert.rejects(geminiGenerate({ apiKey: "test", model: "test", body, policy, wait: async () => {}, fetchImpl: async () => { count++; throw Object.assign(new Error("local deadline"), { name: "TimeoutError" }); }, onAttempt: (record) => attempts.push(record) }), (error) => error.category === "provider_timeout");
  assert.equal(count, 2); assert.ok(attempts.every((item) => item.clientAborted && item.httpStatus === null));
  assert.equal(retryDelay(new Response(null, { headers: { "retry-after": "Tue, 08 Sep 2026 12:00:02 GMT" } }).headers, 1, () => 0, Date.parse("2026-09-08T12:00:00Z")), 2000);
});
test("zero model quota is an external configuration block, not a transient retry", async () => {
  let count = 0;
  await assert.rejects(geminiGenerate({ apiKey: "test", model: "test", body, policy, fetchImpl: async () => { count++; return new Response('{"error":{"code":429,"message":"Quota exceeded, limit: 0, model: example"}}', { status: 429 }); } }), (error) => error.category === "provider_error");
  assert.equal(count, 1);
});

test("valid JSON with interrupted, missing or blocked finish metadata is never accepted or retried", async () => {
  for (const [finishReason, code] of [["MAX_TOKENS", "GEMINI_RESPONSE_INCOMPLETE"], [undefined, "GEMINI_RESPONSE_INCOMPLETE"], ["SAFETY", "GEMINI_RESPONSE_BLOCKED"], ["RECITATION", "GEMINI_RESPONSE_BLOCKED"]]) {
    let calls = 0; const records = [];
    await assert.rejects(geminiGenerate({ apiKey: "test", model: "test", body, policy, fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: '{"valid":"json"}' }] } }] }));
    }, onAttempt: (record) => records.push(record) }), { code });
    assert.equal(calls, 1);
    assert.equal(records[0].retryScheduled, false);
    assert.equal(records[0].finishReason, finishReason ?? null);
  }
});

test("token usage includes thoughts, detects exhausted output budgets, and excludes arbitrary metadata", async () => {
  const attempts = [];
  await assert.rejects(geminiGenerate({ apiKey: "SECRET", model: "test", body: { ...body, generationConfig: { maxOutputTokens: 1000 } }, policy,
    fetchImpl: async () => new Response(JSON.stringify({ usageMetadata: { thoughtsTokenCount: 950, candidatesTokenCount: 50, totalTokenCount: 1200, privateField: "SECRET" }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }] })),
    onAttempt: (record) => attempts.push(record)
  }), { code: "GEMINI_RESPONSE_INCOMPLETE" });
  assert.equal(attempts[0].outputTokens, 1000);
  assert.equal(attempts[0].usageMetadata.thoughtsTokenCount, 950);
  assert.doesNotMatch(JSON.stringify(attempts), /SECRET|privateField/);
  const records = [];
  assert.deepEqual(await geminiGenerate({ apiKey: "test", model: "test", body, policy, fetchImpl: async () => new Response('{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"{}"}]}}]}'), onAttempt: (record) => records.push(record) }), {});
  assert.equal(records[0].usageAvailable, false);
});

test("provider errors never log echoed project data or raw messages", async () => {
  const attempts = [];
  await assert.rejects(geminiGenerate({ apiKey: "secret-key", model: "test", body, policy,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Private hypothesis customer@example.test secret-key", status: "PRIVATE" } }), { status: 400 }),
    onAttempt: (record, payload) => attempts.push({ record, response: payload.response })
  }));
  assert.doesNotMatch(JSON.stringify(attempts), /Private hypothesis|customer@|secret-key|PRIVATE/);
});
test("provider extraction enums are subsets of the shared runtime schema at every matching path", () => {
  const provider = extractionEnums(engineeringSystemSchema);
  function check(node, runtime) {
    if (!node || typeof node !== "object") return;
    if (node.enum) assert.ok(node.enum.every((value) => runtime.enum.includes(value)));
    for (const [key, child] of Object.entries(node)) if (key !== "enum") {
      if (Array.isArray(child)) child.forEach((value, index) => check(value, runtime[key][index]));
      else check(child, runtime?.[key]);
    }
  }
  check(provider, engineeringSystemSchema);
  assert.deepEqual(provider.properties.evidence.items.properties.kind.enum, ["fact"]);
  assert.deepEqual(provider.properties.entities.items.properties.source.enum, ["documented", "inferred"]);
  assert.ok(!compactExtractionSchema.properties.relations.items.properties.kind.enum.includes("contains"));
  assert.equal(compactExtractionSchema.properties.requirements.items.properties.status, undefined);
});
test("fact stage cannot invent a citation and deterministic assembly preserves references", () => {
  const parsed = [{ source: { artifactId: "source", artifactLabel: "Test" }, text: "Unit mass is 5 kg." }];
  const fact = { subject: "unit", predicate: "mass", value: 5, unit: "kg", artifactId: "source", excerpt: "Unit mass is 5 kg.", classification: "documented" };
  assert.ok(validateFactSet({ facts: [fact] }, parsed));
  assert.throws(() => validateFactSet({ facts: [{ ...fact, excerpt: "Unit mass is 7 kg." }] }, parsed));
  assert.deepEqual(evidenceFactSetSchema.properties.facts.items.properties.classification.enum, ["documented", "inferred"]);
  const result = assembleExtraction({ entities: [], relations: [], requirements: [] }, { id: "test", name: "Test", memoryRevision: 4 }, parsed, [fact]);
  assert.equal(result.evidence[0].id, "fact-1"); assert.equal(result.evidence[0].artifactLabel, "Test"); assert.equal(result.generatedFromRevision, 4);
});
test("literal ledger preserves text and typed assembly derives calculation directions without arithmetic", () => {
  const text = "Source capacity 4 Wh.\nDemand 2 W.\nDuration uses energy_over_power.";
  const parsed = [{ source: { artifactId: "doc", artifactLabel: "Method" }, text }];
  const ledger = sourceLedger(parsed);
  assert.ok(ledger.every((item) => text.includes(item.excerpt)));
  const output = { entities: [{ id: "duration", properties: [], calculation: { formula: "energy_over_power", source: "documented", evidenceRefs: ["source-3"] }, calculationInputs: [{ entityId: "energy", source: "documented", evidenceRefs: ["source-1", "source-3"] }] }], relations: [], requirements: [] };
  const model = assembleLedgerExtraction(output, ledger, { id: "example", name: "Example" }, parsed);
  assert.equal(model.relations[0].from, "duration"); assert.equal(model.relations[0].to, "energy"); assert.equal(model.relations[0].kind, "derived_from");
  assert.deepEqual(model.entities[0].properties.map((property) => property.value), ["energy_over_power"]);
  assert.ok(ledgerExtractionSchema(true).properties.entities.items.properties.calculation.anyOf[1].properties.formula.enum.includes("energy_over_power"));
  assert.equal(output.relations.length, 0);
});
test("metadata hydration cannot create missing architecture or accept duplicate hierarchy", () => {
  const project = { id: "example", name: "Example", memoryRevision: 9 };
  const result = hydrateExtraction({ entities: [], relations: [], requirements: [], evidence: [], generatedFromRevision: 99, id: "invented" }, project);
  assert.equal(result.id, "system-example"); assert.equal(result.generatedFromRevision, 9); assert.equal(result.entities.length, 0);
  assert.throws(() => hydrateExtraction({ relations: [{ kind: "contains" }] }, project), { code: "SYSTEM_HIERARCHY_INVALID" });
});
