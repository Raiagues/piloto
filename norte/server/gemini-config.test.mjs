import test from "node:test";
import assert from "node:assert/strict";
import { geminiConfig } from "./gemini-config.mjs";
import { createSystemAiService } from "./system-ai.mjs";
import { createBrainstormAiService } from "./brainstorm-ai.mjs";
import { createEngineeringValidationModel } from "../examples/engineering-validation.mjs";

test("global thinking level reaches REST in the correct casing, with feature overrides", async () => {
  const env = { GEMINI_MODEL: "gemini-3.8-flash", GEMINI_THINKING_LEVEL: "high", GEMINI_ORGANIZATION_THINKING_LEVEL: "low", GEMINI_EXTRACTION_THINKING_LEVEL: "default" };
  assert.deepEqual(geminiConfig({ env }, "discovery").thinkingConfig, { thinkingLevel: "HIGH" });
  assert.deepEqual(geminiConfig({ env }, "organization").thinkingConfig, { thinkingLevel: "LOW" });
  assert.equal(geminiConfig({ env }, "extraction").thinkingConfig, undefined);
  assert.deepEqual(geminiConfig({ env: { ...env, GEMINI_DISCOVERY_THINKING_LEVEL: "" } }, "discovery").thinkingConfig, { thinkingLevel: "HIGH" });
  const captured = [];
  const fetch = async (url, init) => {
    captured.push({ url, body: JSON.parse(init.body) });
    const result = captured.length === 1 ? { kind: "clarification", targetId: "", replacementName: "", summary: "", question: "Qual câmera?", confirmation: "", updates: [] } : { relations: [], groups: [], nodePlans: [], tensions: [], connectionIssues: [], gaps: [] };
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(result) }] } }], usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 500, totalTokenCount: 800 } }));
  };
  await createSystemAiService({ apiKey: "test", env, fetch }).interpret(createEngineeringValidationModel(), "mudar câmera");
  await createBrainstormAiService({ apiKey: "test", env, fetch }).analyze({ language: "pt", nodes: [], confirmedRelations: [], teamMemory: [] });
  assert.equal(captured[0].body.generationConfig.thinkingConfig.thinkingLevel, "HIGH");
  assert.equal(captured[0].body.generationConfig.maxOutputTokens, 8192);
  assert.equal(captured[1].body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  assert.ok(captured.every(({ url }) => url.endsWith("gemini-3.8-flash:generateContent")));
});

test("invalid configuration cannot call or silently select another model", async () => {
  for (const env of [
    { GEMINI_MODEL: "models/gemini-3.8-flash" }, { GEMINI_MODEL: "" },
    { GEMINI_MODEL: "gemini-2.5-flash", GEMINI_THINKING_LEVEL: "high" },
    { GEMINI_MODEL: "gemini-3.8-flash", GEMINI_THINKING_LEVEL: "minimal" },
    { GEMINI_MODEL: "gemini-3-pro-preview", GEMINI_THINKING_LEVEL: "medium" },
    { GEMINI_THINKING_LEVEL: "typo" }, { GEMINI_DISCOVERY_MAX_OUTPUT_TOKENS: "NaN" }
  ]) {
    let calls = 0;
    const options = { apiKey: "test", env, fetch: async () => { calls++; throw new Error("Must not call"); } };
    await assert.rejects(createSystemAiService(options).interpret(createEngineeringValidationModel(), "radio 1.2 A"), { code: "GEMINI_CONFIG_INVALID" });
    assert.equal(calls, 0);
  }
  const service = createBrainstormAiService({ apiKey: "test", env: { GEMINI_MODEL: "invalid/model" }, fetch: () => assert.fail("No provider call") });
  assert.equal(service.status().configurationError, "GEMINI_CONFIG_INVALID");
  await assert.rejects(service.analyze({}), { code: "GEMINI_CONFIG_INVALID" });
});

test("feature model and token budgets are independent, defaults never force high thinking", () => {
  const env = { GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DISCOVERY_MODEL: "gemini-3.5-flash-lite", GEMINI_DISCOVERY_MAX_OUTPUT_TOKENS: "10000" };
  assert.equal(geminiConfig({ env }, "discovery").model, "gemini-3.5-flash-lite");
  assert.equal(geminiConfig({ env }, "discovery").maxOutputTokens, 10000);
  assert.equal(geminiConfig({ env }, "discovery").thinkingConfig, undefined);
  assert.equal(geminiConfig({ env }, "extraction").model, "gemini-3.8-flash");
});
