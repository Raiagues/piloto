#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { analyzeImpact } from "../shared/impact-engine.mjs";
import { validateEngineeringSystem } from "../shared/engineering-schema.mjs";
import { createStructuralModel, structuralDocuments, STRUCTURAL_CONTEXT_REVISION, STRUCTURAL_VARIANTS } from "../benchmark/structural/context.mjs";
import { structuralCases, structuralReference, STRUCTURAL_REFERENCE_REVISION } from "../benchmark/structural/evaluation_reference.mjs";
import { benchmarkHash, buildBenchmarkManifest } from "./benchmark-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const metric = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });

export function structuralChange(model, testCase) {
  const target = model.entities.find((entity) => entity.id === "transceiver-c4");
  const previous = target.properties.find((property) => property.key === "tx_duty_cycle");
  return { id: testCase.id, targetEntityId: target.id, kind: "parameter", oldValues: structuredClone(target.properties), newValues: [{ ...previous, value: testCase.txDutyPercent, source: "user", evidenceRefs: [] }], description: `${target.name}: transmit duty ${previous.value}% → ${testCase.txDutyPercent}%`, createdAt: "2026-09-08T00:00:00.000Z" };
}

function traceConnects(model, id, from, to) {
  const relation = model.relations.find((item) => item.id === id);
  if (relation) {
    if (["contains", "unknown"].includes(relation.kind)) return false;
    if (["derived_from", "depends_on", "requires", "consumes", "mounted_on"].includes(relation.kind)) return relation.to === from && relation.from === to;
    if (["powers", "connects_to", "communicates_with", "thermal_coupling"].includes(relation.kind)) return relation.from === from && relation.to === to || relation.from === to && relation.to === from;
    return relation.from === from && relation.to === to;
  }
  const requirement = model.requirements.find((item) => item.id === to);
  return Boolean(requirement && id === `trace:${to}:${from}` && requirement.relatedEntityIds.includes(from));
}

export function evaluateStructuralImpact(model, analysis, reference) {
  const failures = [], unsupportedClaims = [], impacts = analysis.impacts;
  const actualCalculations = reference.calculations.map((expected) => ({ entityId: expected.entityId, calculation: impacts.find((item) => item.entityId === expected.entityId)?.calculation ?? null }));
  let numericPassed = 0, statusPassed = 0, pathPassed = 0, tracePassed = 0;
  for (const expected of reference.calculations) {
    const actual = actualCalculations.find((item) => item.entityId === expected.entityId).calculation;
    if (actual?.ruleId === expected.ruleId && actual.unit === expected.unit && typeof actual.result === "number" && Math.abs(actual.result - expected.result) <= reference.toleranceW) numericPassed += 1;
    else failures.push(`${expected.entityId}: expected ${expected.result} ${expected.unit} via ${expected.ruleId}; received ${actual ? `${actual.result} ${actual.unit ?? ""} via ${actual.ruleId}` : "no calculation"}`);
  }
  for (const [id, expected] of Object.entries(reference.statuses)) {
    const actual = impacts.find((item) => item.entityId === id)?.status;
    if (actual === expected) statusPassed += 1;
    else failures.push(`${id}: expected status ${expected}; received ${actual ?? "missing"}`);
  }
  for (const [id, expected] of Object.entries(reference.paths)) {
    const actual = impacts.find((item) => item.entityId === id)?.path;
    if (JSON.stringify(actual) === JSON.stringify(expected)) pathPassed += 1;
    else failures.push(`${id}: expected path ${expected.join(" → ")}; received ${actual?.join(" → ") ?? "missing"}`);
  }
  const sources = analysis.evidence ?? [], evidence = new Map(sources.map((source) => [source.id, source]));
  const originalEvidence = new Map(model.evidence.map((source) => [source.id, source]));
  const objects = new Set([...model.entities, ...model.requirements].map((object) => object.id));
  const duty = model.entities.find((entity) => entity.id === "transceiver-c4").properties.find((property) => property.key === "tx_duty_cycle");
  const supported = (refs) => refs.length > 0 && refs.every((id) => {
    const actual = evidence.get(id), original = originalEvidence.get(id);
    if (!actual) return false;
    if (original) return ["artifactId", "artifactLabel", "locator", "excerpt", "kind"].every((key) => actual[key] === original[key]);
    return id === `change:${reference.id}:0` && actual.artifactId === reference.id && actual.kind === "user" && actual.excerpt === `${duty.name}: ${reference.txDutyPercent} %`;
  });
  if (evidence.size !== sources.length) failures.push("Duplicate evidence IDs make the provenance ambiguous.");
  if (analysis.change.id !== reference.id || analysis.changedEntityId !== "transceiver-c4" || analysis.change.targetEntityId !== "transceiver-c4" || analysis.change.newValues.length !== 1 || analysis.change.newValues[0].key !== "tx_duty_cycle" || analysis.change.newValues[0].value !== reference.txDutyPercent || analysis.change.newValues[0].unit !== "%") failures.push("The analyzed change does not match the independently specified hypothetical input.");
  const affected = impacts.filter((impact) => impact.status !== "unaffected");
  const expectedAffected = new Set(Object.entries(reference.statuses).filter(([, status]) => status !== "unaffected").map(([id]) => id));
  const predictedAffected = new Set(affected.map((impact) => impact.entityId));
  const matchingAffected = [...predictedAffected].filter((id) => expectedAffected.has(id)).length;
  if (new Set(impacts.map((impact) => impact.entityId)).size !== impacts.length) failures.push("Duplicate impact IDs make the conclusions ambiguous.");
  for (const impact of affected) {
    const sourceRefs = [...impact.evidenceRefs, ...impact.reasoning.sourceRefs, ...(impact.calculation?.evidenceRefs ?? []), ...(impact.calculation?.inputs.flatMap((input) => input.evidenceRefs) ?? [])];
    const validPath = impact.path.length > 0 && impact.path[0] === analysis.changedEntityId && impact.path.at(-1) === impact.entityId && impact.traversedRelationIds.length === impact.path.length - 1 && impact.traversedRelationIds.every((id, index) => traceConnects(model, id, impact.path[index], impact.path[index + 1]));
    if (objects.has(impact.entityId) && supported(sourceRefs) && validPath) tracePassed += 1;
    else failures.push(`${impact.entityId}: unresolved evidence or discontinuous causal trace`);
    if (impact.status === "critical" && !reference.criticalIds.includes(impact.entityId)) unsupportedClaims.push(`${impact.entityId}: unsupported critical verdict`);
    if (/(?:shutdown|reset|deplet\w*|failure)\s+(?:in|after|at)\s+\d+(?:\.\d+)?\s*(?:h\b|hours?|min\b|minutes?|seconds?)/iu.test(impact.shortExplanation)) unsupportedClaims.push(`${impact.entityId}: a failure time was asserted without a time-dependent storage model`);
  }
  for (const calculation of analysis.calculations) {
    if (!supported(calculation.evidenceRefs) || !calculation.inputs.length || calculation.inputs.some((input) => !objects.has(input.entityId) || !supported(input.evidenceRefs))) failures.push(`${calculation.ruleId}: calculation inputs or source excerpts cannot be traced`);
    if (/current|depletion|reset|failure_time/iu.test(calculation.ruleId)) unsupportedClaims.push(`${calculation.ruleId}: unsupported instantaneous-current or failure-time calculation for a duty-only change`);
  }
  if (reference.arithmetic.powerMarginW < 0) {
    const storage = impacts.find((item) => item.entityId === "storage-b7");
    if (storage?.reasoning.type !== "inference" || storage.confidence >= 1) failures.push("Storage consequence must preserve the inferred dependency and its uncertainty.");
  }
  failures.push(...unsupportedClaims);
  return {
    id: reference.id, class: "C2", variant: reference.variant, status: failures.length ? "fail" : "pass", failures,
    input: model, change: analysis.change, expected: reference, actualCalculations, calculations: analysis.calculations,
    predicted: analysis, trace: affected.map(({ entityId, status, path, traversedRelationIds, evidenceRefs, reasoning, confidence }) => ({ entityId, status, path, traversedRelationIds, evidenceRefs, reasoningType: reasoning.type, confidence })),
    sourcesUsed: sources.filter((source) => affected.some((impact) => impact.evidenceRefs.includes(source.id))), unsupportedClaims,
    expectedAffected: [...expectedAffected], predictedAffected: [...predictedAffected], falseCriticalCount: affected.filter((impact) => impact.status === "critical" && !reference.criticalIds.includes(impact.entityId)).length,
    metrics: { numericCalculations: metric(numericPassed, reference.calculations.length), expectedStatuses: metric(statusPassed, Object.keys(reference.statuses).length), expectedCausalPaths: metric(pathPassed, Object.keys(reference.paths).length), traceAndEvidenceIntegrity: metric(tracePassed, affected.length), affectedPrecision: metric(matchingAffected, predictedAffected.size), affectedRecall: metric(matchingAffected, expectedAffected.size) }
  };
}

export async function runStructuralBenchmark({ outputDirectory = resolve(repositoryRoot, "var/benchmarks"), engine = analyzeImpact } = {}) {
  const context = STRUCTURAL_VARIANTS.map((variant) => ({ variant, documents: structuralDocuments(variant), engineeringSystem: createStructuralModel(variant) }));
  const cases = [];
  for (const testCase of structuralCases) {
    const model = createStructuralModel(testCase.variant), change = structuralChange(model, testCase), baseline = JSON.stringify(model);
    if (!validateEngineeringSystem(model)) throw new Error(`Invalid authored structural model: ${testCase.variant}`);
    const reference = structuralReference(testCase.id);
    try {
      // The production engine receives only authored engineering input and the hypothetical change.
      const analysis = await engine(model, change, "en");
      const result = evaluateStructuralImpact(JSON.parse(baseline), analysis, reference);
      if (JSON.stringify(model) !== baseline) { result.failures.push("The production engine mutated the baseline."); result.status = "fail"; }
      cases.push(result);
    } catch (error) { cases.push({ id: testCase.id, class: "C2", variant: testCase.variant, status: "fail", failures: [error.message], input: JSON.parse(baseline), change, expected: reference, predicted: null, actualCalculations: [], trace: [], sourcesUsed: [], unsupportedClaims: [], metrics: {} }); }
  }
  const referenceText = await readFile(new URL("../benchmark/structural/evaluation_reference.mjs", import.meta.url), "utf8");
  const manifest = await buildBenchmarkManifest({ benchmarkName: "System K masked structural benchmark", benchmarkRevision: STRUCTURAL_CONTEXT_REVISION, evaluationReferenceRevision: { revision: STRUCTURAL_REFERENCE_REVISION, sha256: benchmarkHash(referenceText) }, context });
  const report = { schemaVersion: 1, benchmark: "System K masked structural benchmark", class: "C2", manifest, executionMode: "deterministic_structured_input", providerInvoked: false,
    interpretation: "Checks generic engineering dependency calculations with an independently authored neutral system and perturbed numeric designs. Document extraction and AI generalization are not measured. Masking reduces identity cues; it does not establish absence of pretraining contamination. Independent human engineering review is pending.",
    context, cases, passed: cases.every((item) => item.status === "pass"), executedCases: cases.length };
  const reportPath = resolve(outputDirectory, `structural-${Date.now()}-${randomUUID()}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { report, reportPath };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log("Usage: node scripts/benchmark-structural.mjs [--output-dir DIRECTORY]\nRuns four deterministic structural cases. No network or AI provider is used. Inspect the JSON report for per-case arithmetic, statuses, traces, evidence and manifest."); return; }
  if (args.length && (args.length !== 2 || args[0] !== "--output-dir" || args[1].startsWith("--"))) throw new Error("Usage: node scripts/benchmark-structural.mjs [--output-dir DIRECTORY]");
  const { report, reportPath } = await runStructuralBenchmark({ ...(args.length ? { outputDirectory: resolve(args[1]) } : {}) });
  console.log(`${report.benchmark} — deterministic; AI generalization not measured`);
  for (const testCase of report.cases) {
    console.log(`${testCase.id}: ${testCase.status.toUpperCase()}`);
    for (const { entityId, calculation } of testCase.actualCalculations) console.log(`  ${entityId}: ${calculation ? `${calculation.result} ${calculation.unit} (${calculation.ruleId})` : "missing"}`);
    for (const failure of testCase.failures) console.log(`  FAIL: ${failure}`);
  }
  console.log(`Evidence report: ${reportPath}`);
  process.exitCode = report.passed ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => { console.error(`Structural benchmark failed: ${error.message}`); process.exitCode = 1; });
