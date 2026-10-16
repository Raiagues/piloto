import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diagnoseExtraction } from "../scripts/diagnose-extraction.mjs";

test("diagnostics retain provider and malformed-output denominators separately without hidden retries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "norte-diagnostic-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const result = await diagnoseExtraction({ models: ["test-model"], runs: 2, apiKey: "test-only", outputDirectory: join(directory, "runs"), fetchImpl: async (_url, options) => {
    assert.doesNotMatch(options.body, /QUETZAL_EVALUATOR_ONLY|expectedCalculations|evaluation_reference/u);
    calls++;
    return calls === 1 ? new Response('{"error":{"status":"UNAVAILABLE","code":503}}', { status: 503 }) : new Response('{"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"invalid JSON"}]}}]}');
  } });
  assert.equal(calls, 2);
  assert.equal(result.manifest.summary.physicalRequests, 2);
  assert.equal(result.manifest.summary.providerCompletedRequests, 1);
  assert.equal(result.manifest.summary.completedExtractions, 1);
  assert.equal(result.manifest.summary.contractValid, 0);
  assert.equal(result.manifest.summary.contractAmongCompleted, 0);
  assert.deepEqual(result.manifest.records.map((record) => record.categories[0]), ["provider_error", "schema_rejection"]);
});
