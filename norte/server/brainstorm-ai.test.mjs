import assert from "node:assert/strict";
import test from "node:test";
import { createBrainstormAiService } from "./brainstorm-ai.mjs";

const request = {
  language: "pt",
  intent: "organize",
  focusDomainId: "payload",
  missionContext: "{\"competition\":\"OBSAT\",\"deadline\":\"2026-09-05\"}",
  nodes: [
    { id: "a", text: "Operar à noite", x: 0, y: 0, pinned: false, maturity: "draft" },
    { id: "b", text: "Usar câmera térmica", x: 200, y: 200, pinned: false, maturity: "forming" }
  ],
  confirmedRelations: [],
  dismissedRelations: [],
  dismissedInsights: [],
  teamMemory: []
};

test("the Gemini proxy keeps the key server-side and caches structured results", async () => {
  let calls = 0;
  let upstreamRequest = "";
  const service = createBrainstormAiService({
    apiKey: "server-only-key",
    model: "gemini-test",
    fetch: async (_url, init) => {
      calls += 1;
      upstreamRequest = init.body;
      assert.equal(init.headers["x-goog-api-key"], "server-only-key");
      assert.doesNotMatch(init.body, /server-only-key/u);
      return new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ relations: [], groups: [], nodePlans: [], tensions: [], connectionIssues: [], gaps: [] }) }] } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.deepEqual(service.status(), { configured: true, model: "gemini-test" });
  const first = await service.analyze(request);
  const second = await service.analyze(request);
  assert.equal(first.model, "gemini-test");
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.match(upstreamRequest, /Focus this organization pass on the payload mission area/u);
  assert.match(upstreamRequest, /OBSAT/u);
  assert.match(upstreamRequest, /2026-09-05/u);
  assert.deepEqual(JSON.parse(upstreamRequest).generationConfig.responseSchema.required, ["relations", "groups", "nodePlans", "tensions", "connectionIssues", "gaps"]);
  assert.doesNotMatch(JSON.stringify(first), /server-only-key/u);
});

test("the Gemini proxy reports quota errors without leaking upstream details", async () => {
  const service = createBrainstormAiService({
    apiKey: "server-only-key",
    fetch: async () => new Response(JSON.stringify({ error: { message: "private upstream details" } }), { status: 429 })
  });
  await assert.rejects(service.analyze(request), (error) => {
    assert.equal(error.statusCode, 429);
    assert.equal(error.code, "AI_QUOTA");
    assert.doesNotMatch(error.message, /private upstream details/u);
    return true;
  });
});
