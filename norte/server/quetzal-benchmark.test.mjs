import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createQuetzalDesignModel, createQuetzalArtifacts, contextDocuments, QUETZAL_PROJECT_ID } from "../benchmark/quetzal1/context/design-context.mjs";
import { analyzeImpact } from "../shared/impact-engine.mjs";
import { prepareProjectArtifacts, buildSystemPrompt } from "./system-ai.mjs";
import { benchmarkChange, evaluateExtraction, evaluateImpact } from "../scripts/quetzal-evaluator.mjs";
import { runQuetzalBenchmark } from "../scripts/benchmark-quetzal.mjs";
import { calculateReference } from "../benchmark/quetzal1/evaluation_reference/reference-arithmetic.mjs";
import { buildBenchmarkManifest } from "../scripts/benchmark-manifest.mjs";

const truth = JSON.parse(await readFile(new URL("../benchmark/quetzal1/evaluation_reference/expectations.json", import.meta.url), "utf8"));
async function temporaryOutput(t) {
  const path = await mkdtemp(join(tmpdir(), "norte-quetzal-benchmark-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("runner evaluates B/C independently, leaves A unmeasured, and preserves inspectable evidence", async (t) => {
  const { report, reportPath } = await runQuetzalBenchmark({ outputDirectory: await temporaryOutput(t) });
  assert.equal(report.passed, true);
  assert.equal(report.executedCases, 5);
  assert.equal(report.cases[0].status, "not_run");
  assert.equal(report.humanReview.status, "pending");
  assert.equal(report.humanReview.reviewer, null);
  assert.equal(report.specificationApproval.status, "user_approved_document");
  assert.equal(report.cases[1].metrics.criticalImpactPrecision.value, null);
  assert.ok(Math.abs(report.cases[1].calculationResults[2].actual.result - 0.41379496) < 1e-8);
  assert.ok(Math.abs(report.cases.at(-1).calculationResults[2].actual.result + 1.97111504) < 1e-8);
  const saved = JSON.parse(await readFile(reportPath, "utf8"));
  for (const item of saved.cases.slice(1)) {
    assert.ok(item.input.entities.length && item.change.newValues.length);
    assert.ok(item.expectedCalculations.length && item.actualCalculations.length);
    assert.ok(item.predicted.impacts.length && item.sourcesUsed.length);
    assert.deepEqual(item.unsupportedClaims, []);
  }
  assert.equal(saved.cases.at(-1).historicalComparison.status, "qualitative_only");
  assert.notEqual(saved.cases.at(-1).historicalComparison.observations.observedMarginW, saved.cases.at(-1).calculationResults[2].actual.result);
});

test("negative control: changing a structured design fact fails independent expected calculations", async (t) => {
  const model = createQuetzalDesignModel();
  model.entities.find((item) => item.id === "radio").properties.find((item) => item.key === "tx_power").value = 2000;
  const { report } = await runQuetzalBenchmark({ model, outputDirectory: await temporaryOutput(t) });
  assert.equal(report.passed, false);
  assert.equal(report.cases[1].status, "fail");
  assert.ok(report.cases[1].metrics.calculationAccuracy.value < 1);
});

test("negative controls: altered arithmetic, fake critical and forged evidence cannot pass", () => {
  const model = createQuetzalDesignModel(), expected = truth.cases[0];
  const prediction = analyzeImpact(model, benchmarkChange(model, expected));
  const wrongCalculation = structuredClone(prediction);
  wrongCalculation.impacts.find((item) => item.entityId === "energy-balance").calculation.result = -4;
  assert.equal(evaluateImpact(model, wrongCalculation, expected).status, "fail");
  const wrongCritical = structuredClone(prediction);
  wrongCritical.impacts.find((item) => item.entityId === "battery").status = "critical";
  const evaluatedCritical = evaluateImpact(model, wrongCritical, expected);
  assert.equal(evaluatedCritical.metrics.criticalImpactPrecision.value, 0);
  assert.ok(evaluatedCritical.metrics.unsupportedClaimRate.value > 0);
  const wrongReference = structuredClone(prediction);
  wrongReference.calculations[0].inputs[0].evidenceRefs = ["nonexistent-source"];
  const evaluatedReference = evaluateImpact(model, wrongReference, expected);
  assert.equal(evaluatedReference.status, "fail");
  assert.ok(evaluatedReference.metrics.traceabilityCoverage.value < 1);
  const forgedFragment = structuredClone(prediction);
  forgedFragment.evidence.find((item) => item.id === "radio").excerpt = "Invented source content";
  assert.equal(evaluateImpact(model, forgedFragment, expected).status, "fail");
});

test("invalid context references produce failed cases and evidence reports instead of invented results", async (t) => {
  const model = createQuetzalDesignModel();
  model.entities[0].evidenceRefs = ["missing-source"];
  const { report } = await runQuetzalBenchmark({ model, outputDirectory: await temporaryOutput(t) });
  assert.equal(report.passed, false);
  assert.equal(report.cases[1].predicted, null);
  assert.match(report.cases[1].failures[0], /invalid/iu);
});

test("extraction evaluator accepts normalized units and renamed IDs, while missing properties and false sources fail", () => {
  // This is an evaluator test double, never a measured extraction run.
  const prediction = createQuetzalDesignModel();
  const radio = prediction.entities.find((item) => item.id === "radio");
  radio.name = "NanoCom AX100";
  radio.id = "extracted-transceiver-42";
  for (const relation of prediction.relations) {
    if (relation.from === "radio") relation.from = radio.id;
    if (relation.to === "radio") relation.to = radio.id;
  }
  radio.properties.find((item) => item.key === "tx_power").value = 2.64;
  radio.properties.find((item) => item.key === "tx_power").unit = "W";
  const original = evaluateExtraction(prediction, truth, contextDocuments);
  assert.equal(original.status, "pass", JSON.stringify(original.failures));
  radio.properties.find((item) => item.key === "rx_power").value = 232;
  const corrupted = evaluateExtraction(prediction, truth, contextDocuments);
  assert.equal(corrupted.status, "fail");
  assert.ok(corrupted.metrics.propertyAccuracy.value < 1);
  prediction.evidence[0].excerpt = "A source that does not exist.";
  assert.ok(evaluateExtraction(prediction, truth, contextDocuments).metrics.provenanceCoverage.value < 1);
});

test("no predictions gives null precision denominators, not a perfect extraction score", () => {
  const prediction = createQuetzalDesignModel();
  prediction.entities = []; prediction.relations = []; prediction.requirements = [];
  const result = evaluateExtraction(prediction, truth, contextDocuments);
  assert.equal(result.status, "fail");
  assert.equal(result.metrics.entityPrecision.value, null);
  assert.equal(result.metrics.entityRecall.value, 0);
  assert.equal(result.metrics.relationPrecision.value, null);
});

test("A0 locale normalization and requirement prefixes preserve genuine semantic failures", () => {
  const prediction = createQuetzalDesignModel();
  const labels = { system: "Quetzal-1", eps: "EPS", comms: "Comunicações", solar: "Painéis Solares", chargers: "Carregadores de Bateria", battery: "Bateria Recarregável", "main-bus": "Barramento Principal da Bateria", "rail-3v3": "Trilho regulado de 3.3V", radio: "Transceptor AX100", obc: "OBC", "eps-controller": "Controlador e Sensores do EPS", heater: "Aquecedor de Bateria", housekeeping: "Housekeeping ADCS", "comms-average": "Cálculo de Potência Média COMMS", "heater-average": "Cálculo de Contribuição Média do Aquecedor", "housekeeping-average": "Cálculo de Contribuição Média do Housekeeping", "power-budget": "Orçamento de Potência", "energy-balance": "Balanço de Energia" };
  for (const entity of prediction.entities) entity.name = labels[entity.id];
  for (const requirement of prediction.requirements) requirement.id = `req-${requirement.id.toLowerCase()}`;
  const localized = evaluateExtraction(prediction, truth, contextDocuments);
  assert.equal(localized.status, "pass", JSON.stringify(localized.failures));
  const reverse = prediction.relations.find((item) => item.id === "radio-average");
  [reverse.from, reverse.to] = [reverse.to, reverse.from];
  const backwards = evaluateExtraction(prediction, truth, contextDocuments);
  assert.ok(backwards.metrics.relationRecall.value < 1);
  prediction.relations.find((item) => item.id === "balance-battery").source = "documented";
  const falseFact = evaluateExtraction(prediction, truth, contextDocuments);
  assert.equal(falseFact.status, "fail");
  assert.ok(falseFact.unsupportedClaims.some((item) => item.claim === "balance-battery"));
});

test("independent reference arithmetic brackets the decision boundary without production calculations", () => {
  assert.ok(Math.abs(calculateReference(25)["energy-balance"] - 0.01630996) < 1e-10);
  assert.ok(Math.abs(calculateReference(26)["energy-balance"] + 0.01018904) < 1e-10);
  for (const benchmarkCase of truth.cases) {
    const result = calculateReference(benchmarkCase.txDutyPercent);
    for (const expected of benchmarkCase.expectedCalculations) assert.ok(Math.abs(result[expected.entityId] - expected.value) < expected.tolerance);
  }
});

test("run manifest records reproducible hashes and keeps unknown provider settings null", async () => {
  const manifest = await buildBenchmarkManifest({ benchmarkName: "unit-test", benchmarkRevision: "test", evaluationReferenceRevision: "test-reference", context: contextDocuments });
  assert.match(manifest.gitSha, /^[a-f0-9]{40}$/u);
  assert.match(manifest.impactEngineVersion.sha256, /^[a-f0-9]{64}$/u);
  assert.match(manifest.contextHash, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.modelProvider, null);
  assert.equal(manifest.modelIdentifier, null);
  assert.equal(manifest.generationParameters.temperature, null);
  assert.equal(manifest.promptHash, null);
  const original = { modelProvider: "google", modelIdentifier: "gemini-test-model", generationParameters: { temperature: 0.1, top_p: 0.8 }, promptHash: "recorded-request-hash" };
  const supplied = await buildBenchmarkManifest({ benchmarkName: "unit-test", benchmarkRevision: "test", evaluationReferenceRevision: "test-reference", context: contextDocuments, predictionMetadata: { manifest: original } });
  assert.equal(supplied.modelProvider, "google");
  assert.equal(supplied.modelIdentifier, "gemini-test-model");
  assert.equal(supplied.generationParameters.temperature, 0.1);
  assert.equal(supplied.promptHash, original.promptHash);
  assert.deepEqual(supplied.originalExtractionManifest, original);
});

test("artifact preparation and generation prompt exclude holdout outcomes and canary", () => {
  const artifacts = createQuetzalArtifacts();
  const project = { id: QUETZAL_PROJECT_ID, name: "Quetzal-1 EPS + COMMS", memoryRevision: 1, context: { projectArtifactIds: artifacts.map((item) => item.id), teamArtifactIds: [] } };
  const holdout = { ...artifacts[0], id: "evaluator-only", url: `data:text/plain;base64,${Buffer.from(JSON.stringify(truth)).toString("base64")}` };
  const parsed = prepareProjectArtifacts(project, [...artifacts, holdout]);
  const prompt = buildSystemPrompt(project, parsed, "en");
  assert.equal(parsed.length, 2);
  assert.ok(prompt.includes("2640 mW") && prompt.includes("33.33 %"));
  for (const prohibited of [truth.holdoutCanary, "historicalObservations", "approximateDepletionHours", "1.16620504", "0.41379496", "-1.97111504", "24 continuous-TX failures", "watchdogHoursAfter"]) assert.equal(prompt.includes(prohibited), false, prohibited);
  assert.ok(parsed.every((item) => item.source.status === "parsed"));
});

test("runtime source tree has no dependency on evaluation references", async () => {
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await inspect(path); continue; }
      if (!/\.(mjs|tsx?|js)$/u.test(entry.name) || /\.test\./u.test(entry.name)) continue;
      const source = await readFile(path, "utf8");
      assert.equal(/(?:from\s*|import\s*\(|readFile\s*\()[^\n]*(?:ground_truth|evaluation_reference)/u.test(source), false, path);
      assert.equal(source.includes(truth.holdoutCanary), false, path);
    }
  }
  for (const directory of ["src", "server", "shared", "benchmark/quetzal1/context"]) await inspect(fileURLToPath(new URL(`../${directory}/`, import.meta.url)));
});
