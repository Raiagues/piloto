import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeImpact } from "../shared/impact-engine.mjs";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { createStructuralModel, structuralDocuments, STRUCTURAL_VARIANTS } from "../benchmark/structural/context.mjs";
import { structuralCases, structuralReference, STRUCTURAL_REFERENCE_REVISION } from "../benchmark/structural/evaluation_reference.mjs";
import { evaluateStructuralImpact, runStructuralBenchmark, structuralChange } from "../scripts/benchmark-structural.mjs";

const runCase = (id = structuralCases[0].id) => {
  const reference = structuralReference(id), model = createStructuralModel(reference.variant), change = structuralChange(model, reference);
  return { model, reference, analysis: analyzeImpact(model, change, "en") };
};

test("C2 has independent neutral design documents, complete provenance and physically consistent transceiver peak inputs", async () => {
  for (const variant of STRUCTURAL_VARIANTS) {
    const model = createStructuralModel(variant), documents = structuralDocuments(variant);
    assert.equal(validateEngineeringSystem(model), true);
    assert.equal(model.entities.length, 15);
    assert.equal(documents.length, 2);
    assert.doesNotMatch(JSON.stringify({ model, documents }), /quetzal|ax100|guatemala|uvg|jossonline|775\.76|1\.58|2640|3\.6\s*%|STRUCTURAL_EVALUATION_ONLY/iu);
    for (const source of model.evidence) assert.ok(documents.find((document) => document.id === source.artifactId)?.text.includes(source.excerpt));
    const properties = model.entities.find((entity) => entity.id === "transceiver-c4").properties;
    const tx = properties.find((property) => property.key === "tx_power"), peak = properties.find((property) => property.key === "peak_current");
    const volts = model.entities.find((entity) => entity.id === "regulator-d2").properties.find((property) => property.key === "output_voltage").value;
    assert.ok(Math.abs((tx.unit === "mW" ? tx.value / 1000 : tx.value) - peak.value * volts) < 1e-12);
    assert.ok(model.entities.find((entity) => entity.id === "storage-b7").properties.every((property) => property.key !== "available_energy"));
  }
  const source = await readFile(new URL("../benchmark/structural/context.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bimport\b/u);
  assert.doesNotMatch(source, /evaluation_reference|impact-engine/u);
});

test("C2 evaluation arithmetic is independently fixed for both numeric cases and both perturbed designs", async () => {
  const expected = [[.924, 1.7158, .2342], [3.9, 5.1382, -3.1882], [1.395, 2.28096, .41904], [4.8, 5.95836, -3.25836]];
  structuralCases.forEach((testCase, index) => {
    const reference = structuralReference(testCase.id);
    for (const [key, column] of [["linkAverageW", 0], ["totalLoadW", 1], ["powerMarginW", 2]]) assert.ok(Math.abs(reference.arithmetic[key] - expected[index][column]) < 1e-10);
  });
  const referenceSource = await readFile(new URL("../benchmark/structural/evaluation_reference.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(referenceSource, /^import\s/gmu);
  assert.equal(structuralReference(structuralCases[0].id).referenceRevision, STRUCTURAL_REFERENCE_REVISION);
  assert.match(structuralReference(structuralCases[0].id).revisionNotes[0].rationale, /state of charge/u);
});

for (const testCase of structuralCases) test(`${testCase.id}: generic engine preserves numeric values, directed causal traces and uncertainty`, () => {
  const model = createStructuralModel(testCase.variant), baseline = JSON.stringify(model), change = structuralChange(model, testCase);
  const analysis = analyzeImpact(model, change, "en"), result = evaluateStructuralImpact(model, analysis, structuralReference(testCase.id));
  assert.equal(result.status, "pass", JSON.stringify(result.failures));
  assert.equal(JSON.stringify(model), baseline);
  assert.equal(result.unsupportedClaims.length, 0);
  for (const metric of Object.values(result.metrics)) assert.equal(metric.value, 1);
  const rerun = analyzeImpact(model, change, "en");
  const signature = (value) => value.impacts.map((impact) => ({ id: impact.entityId, status: impact.status, path: impact.path, calculation: impact.calculation }));
  assert.deepEqual(signature(analysis), signature(rerun));
  assert.equal(analysis.calculations.some((calculation) => /current|depletion|reset/iu.test(calculation.ruleId)), false);
});

test("a duty-only case rejects invented peak overcurrent and preserves lower confidence across the storage hypothesis", () => {
  const { model, reference, analysis } = runCase("C2-nominal-continuous");
  const storage = analysis.impacts.find((impact) => impact.entityId === "storage-b7");
  assert.equal(storage.reasoning.type, "inference");
  assert.equal(storage.confidence, .55);
  const altered = structuredClone(analysis);
  altered.impacts.find((impact) => impact.entityId === "regulator-d2").status = "critical";
  altered.calculations.push({ ...altered.calculations[0], ruleId: "required_current_within_available", expression: "Invented instantaneous overcurrent" });
  const evaluation = evaluateStructuralImpact(model, altered, reference);
  assert.equal(evaluation.status, "fail");
  assert.ok(evaluation.unsupportedClaims.some((claim) => claim.includes("unsupported critical")));
  assert.ok(evaluation.unsupportedClaims.some((claim) => claim.includes("instantaneous-current")));
});

test("the C2 evaluator rejects numerical errors even when a prediction retains plausible formulas and paths", () => {
  const { model, reference, analysis } = runCase();
  const altered = structuredClone(analysis);
  altered.impacts.find((impact) => impact.entityId === "load-budget").calculation.result += .1;
  const evaluation = evaluateStructuralImpact(model, altered, reference);
  assert.equal(evaluation.status, "fail");
  assert.equal(evaluation.metrics.numericCalculations.numerator, 2);
  assert.match(evaluation.failures.join(" "), /load-budget: expected/u);
});

test("the C2 evaluator rejects wrong edge IDs and reverse dependency directions", () => {
  const { model, reference, analysis } = runCase();
  const wrongId = structuredClone(analysis);
  wrongId.impacts.find((impact) => impact.entityId === "link-average").traversedRelationIds[0] = "regulator-transceiver-c4";
  assert.equal(evaluateStructuralImpact(model, wrongId, reference).status, "fail");
  const wrongDirection = structuredClone(model);
  const edge = wrongDirection.relations.find((relation) => relation.id === "link-mode");
  [edge.from, edge.to] = [edge.to, edge.from];
  const reversed = evaluateStructuralImpact(wrongDirection, analysis, reference);
  assert.equal(reversed.status, "fail");
  assert.ok(reversed.metrics.traceAndEvidenceIntegrity.value < 1);
  const containment = structuredClone(model);
  containment.relations.find((relation) => relation.id === "link-mode").kind = "contains";
  assert.equal(evaluateStructuralImpact(containment, analysis, reference).status, "fail");
});

test("the C2 evaluator rejects forged excerpts, changed provenance kinds and fabricated scenario sources", () => {
  const { model, reference, analysis } = runCase();
  for (const mutate of [
    (result) => { result.evidence.find((source) => source.id === "transceiver").excerpt = "A fabricated component specification"; },
    (result) => { result.evidence.find((source) => source.id === "transceiver").kind = "user"; },
    (result) => { result.evidence.find((source) => source.id === `change:${reference.id}:0`).excerpt = "tx duty cycle: 999 %"; },
    (result) => { result.evidence.push({ ...result.evidence[0] }); }
  ]) {
    const altered = structuredClone(analysis); mutate(altered);
    assert.equal(evaluateStructuralImpact(model, altered, reference).status, "fail");
  }
});

test("C2 runner records a complete inspectable manifest and sends no evaluation reference to the engine", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "norte-structural-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const { report, reportPath } = await runStructuralBenchmark({ outputDirectory: directory, engine: (model, change, language) => {
    calls += 1;
    assert.doesNotMatch(JSON.stringify({ model, change }), /STRUCTURAL_EVALUATION_ONLY|expectedCalculations|criticalIds|forbiddenClaims/u);
    assert.equal(language, "en");
    return analyzeImpact(model, change, language);
  } });
  assert.equal(calls, 4);
  assert.equal(report.passed, true);
  assert.equal(report.providerInvoked, false);
  assert.equal(report.manifest.modelProvider, null);
  assert.equal(report.manifest.modelIdentifier, null);
  assert.equal(report.manifest.promptHash, null);
  assert.equal(report.manifest.seedAvailability, "not_applicable_deterministic");
  assert.match(report.manifest.contextHash, /^[a-f0-9]{64}$/u);
  assert.match(report.manifest.impactEngineVersion.sha256, /^[a-f0-9]{64}$/u);
  assert.match(report.manifest.evaluationReferenceRevision.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(report.manifest.generationParameters, { temperature: null, top_p: null, seed: null });
  assert.ok(report.cases.every((testCase) => testCase.actualCalculations.length === 3 && testCase.trace.length > 0 && testCase.sourcesUsed.length > 0));
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
});

test("C2 runner preserves failed cases and partial evidence instead of returning only an overall pass flag", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "norte-structural-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { report } = await runStructuralBenchmark({ outputDirectory: directory, engine: (model, change) => {
    const analysis = analyzeImpact(model, change);
    analysis.impacts.find((impact) => impact.entityId === "load-budget").calculation.result = 999;
    return analysis;
  } });
  assert.equal(report.passed, false);
  assert.ok(report.cases.every((testCase) => testCase.status === "fail" && testCase.failures.length > 0 && testCase.expected && testCase.predicted && testCase.input));
});
