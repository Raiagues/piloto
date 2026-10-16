import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contaminationPrompt, runContaminationProbe } from "../scripts/probe-quetzal-contamination.mjs";

test("contamination probe sends neutral questions only and keeps recalled facts outside the request", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "norte-probe-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { report, reportPath } = await runContaminationProbe({ apiKey: "test-credential", model: "model-under-test", outputDirectory: directory, fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: contaminationPrompt }] }]);
    assert.equal("tools" in request, false);
    for (const forbidden of ["3.13", "1.81", "six-hour", "24 TX", "contextDocuments", "expectations", "CANARY"]) assert.equal(options.body.includes(forbidden), false, forbidden);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: "private internal content" }, { text: "I recall 24 TX hang events, demand of 3.13 W and a six-hour depletion." }] }, finishReason: "STOP" }], modelVersion: "model-under-test-1" }));
  } });
  assert.equal(report.status, "completed");
  assert.equal(report.scored, false);
  assert.equal(report.recalledEvaluatorFacts.length, 3);
  assert.equal(report.projectMemoryProvided, false);
  const saved = await readFile(reportPath, "utf8");
  assert.equal(saved.includes("test-credential"), false);
  assert.equal(saved.includes("private internal content"), false);
});

test("failed probe preserves failure metadata without recording provider exceptions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "norte-probe-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { report, reportPath } = await runContaminationProbe({ apiKey: "private-test-key", outputDirectory: directory, fetchImpl: async () => { throw new Error("private-test-key"); } });
  assert.equal(report.status, "failed");
  assert.equal(report.response, null);
  assert.equal((await readFile(reportPath, "utf8")).includes("private-test-key"), false);
});
