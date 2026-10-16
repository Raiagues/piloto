import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractQuetzalRuns } from "../scripts/extract-quetzal.mjs";
import { createQuetzalDesignModel, contextDocuments } from "../benchmark/quetzal1/context/design-context.mjs";

test("repeated extraction preserves every success and failure without recording credentials or private thoughts", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "norte-extraction-runs-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  let calls = 0;
  const outputDirectory = join(temporary, "all-runs");
  const result = await extractQuetzalRuns({ runs: 3, outputDirectory, apiKey: "SECRET_NOT_IN_OUTPUT", evaluationReferenceRevision: "test-frozen-reference", fetchImpl: async (url, options) => {
    calls += 1;
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//u);
    const request = JSON.parse(options.body);
    const text = request.contents[0].parts[0].text;
    for (const document of contextDocuments) assert.ok(text.includes(document.id));
    assert.doesNotMatch(text, /evaluation_reference|GROUND_TRUTH|reviewer notes/u);
    const response = createQuetzalDesignModel();
    // Synthetic provider output satisfies the current typed containment contract.
    response.entities.push({ id: "avionics", name: "Avionics", kind: "subsystem", parentId: "system", description: "", properties: [], source: "inferred", evidenceRefs: response.entities.find(e => e.id === "obc").evidenceRefs, confidence: .5 });
    for (const e of response.entities) if (["obc", "housekeeping"].includes(e.id)) e.parentId = "avionics";
    if (calls === 2) response.relations[0].to = response.relations[0].from;
    return new Response(JSON.stringify({ modelVersion: "test-provider-model", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 }, candidates: [{ finishReason: "STOP", content: { parts: [{ text: "PRIVATE_THOUGHT_NOT_IN_OUTPUT", thought: true }, { text: JSON.stringify(response) }] } }] }), { status: 200 });
  } });
  assert.equal(calls, 3);
  assert.deepEqual(result.manifest.runs.map((run) => run.validation.status), ["passed", "failed", "passed"]);
  assert.equal(result.manifest.summary.accepted, 2);
  assert.equal(result.manifest.summary.failed, 1);
  assert.equal(result.manifest.runs[1].validation.code, "SYSTEM_RESPONSE_INVALID");
  for (let index = 1; index <= 3; index += 1) {
    const directory = join(outputDirectory, `run-${index}`);
    assert.ok((await readdir(directory)).includes("raw-output.txt"));
    for (const file of await readdir(directory)) assert.doesNotMatch(await readFile(join(directory, file), "utf8"), /SECRET_NOT_IN_OUTPUT|PRIVATE_THOUGHT_NOT_IN_OUTPUT/u);
    const metadata = JSON.parse(await readFile(join(directory, "metadata.json"), "utf8"));
    assert.equal(metadata.requestCount, 1);
    assert.equal(metadata.manifest.modelIdentifier, "test-provider-model");
    assert.match(metadata.manifest.promptHash, /^[a-f0-9]{64}$/u);
    assert.equal(metadata.manifest.generationParameters.temperature, 0.1);
  }
  assert.equal(result.manifest.runs[0].impactExecution.cases.length, 2);
  assert.ok(result.manifest.runs[0].impactExecution.cases.every((item) => item.calculations.some((calculation) => calculation.ruleId === "energy_balance")));
  await assert.rejects(extractQuetzalRuns({ runs: 1, outputDirectory, apiKey: "unused", fetchImpl: () => { throw new Error("Do not fetch when the directory exists"); } }), { code: "EEXIST" });
});
