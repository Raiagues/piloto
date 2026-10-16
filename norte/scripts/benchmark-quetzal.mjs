#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { analyzeImpact } from "../shared/impact-engine.mjs";
import { contextDocuments, createQuetzalDesignModel } from "../benchmark/quetzal1/context/design-context.mjs";
import { benchmarkChange, evaluateExtraction, evaluateImpact } from "./quetzal-evaluator.mjs";
import { calculateReference } from "../benchmark/quetzal1/evaluation_reference/reference-arithmetic.mjs";
import { buildBenchmarkManifest, benchmarkHash } from "./benchmark-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export async function runQuetzalBenchmark({ prediction, predictionSource = null, predictionMetadata = null, diagnostic = false, outputDirectory = resolve(repositoryRoot, "var/benchmarks"), model = createQuetzalDesignModel(), engine = analyzeImpact } = {}) {
  const truthText = await readFile(new URL("../benchmark/quetzal1/evaluation_reference/expectations.json", import.meta.url), "utf8");
  const truth = JSON.parse(truthText);
  const predictionModel = prediction?.engineeringSystem || prediction;
  const manifest = await buildBenchmarkManifest({ benchmarkName: truth.benchmark, benchmarkRevision: truth.revision, evaluationReferenceRevision: { revision: truth.revision, sha256: benchmarkHash(truthText) }, context: contextDocuments, modelSchemaVersion: model.schemaVersion, predictionMetadata, modelIdentifier: predictionModel?.model || null });
  manifest.evaluatorSha256 = benchmarkHash(await readFile(new URL("./quetzal-evaluator.mjs", import.meta.url), "utf8"));
  manifest.referenceArithmeticSha256 = benchmarkHash(await readFile(new URL("../benchmark/quetzal1/evaluation_reference/reference-arithmetic.mjs", import.meta.url), "utf8"));
  const cases = [prediction ? evaluateExtraction(predictionModel, truth, contextDocuments) : { id: "A0-curated-context", class: "A0", status: "not_run", reason: "No curated-context extraction prediction supplied. Use --prediction FILE with a real extracted engineeringSystem. Structured design input is not an extraction prediction; raw-artifact ingestion A1 is future work.", metrics: {} }];
  for (const expected of truth.cases) {
    const change = benchmarkChange(model, expected);
    const independentValues = calculateReference(expected.txDutyPercent);
    const referenceChecks = expected.expectedCalculations.map((item) => ({ entityId: item.entityId, stored: item.value, independentlyCalculated: independentValues[item.entityId], correct: Math.abs(item.value - independentValues[item.entityId]) <= item.tolerance }));
    try {
      if (referenceChecks.some((item) => !item.correct)) throw new Error("Stored evaluation reference disagrees with independent arithmetic.");
      cases.push({ ...evaluateImpact(model, engine(model, change, "en"), expected), executionKind: "deterministic_structured_input", independentReferenceChecks: referenceChecks });
    }
    catch (error) { cases.push({ id: expected.id, class: expected.class, status: "fail", failures: [error.message], input: model, change, expected, predicted: null, expectedCalculations: expected.expectedCalculations, actualCalculations: [], sourcesUsed: model.evidence, unsupportedClaims: [], metrics: {} }); }
  }
  const report = { schemaVersion: 2, benchmark: truth.benchmark, benchmarkRevision: truth.revision, manifest, generatedAt: new Date().toISOString(), humanReview: truth.humanReview, specificationApproval: truth.specificationApproval, historicalSnapshot: truth.historicalSnapshot,
    interpretation: "Development evidence. B/C1 isolate reasoning with structured design input; A0 measures curated-context transformation only when supplied a prediction. A1 raw artifact ingestion is future work. Independent human engineering review remains pending; runtime isolation does not rule out pretraining contamination or prove an unseen historical prediction.",
    evaluationDisposition: diagnostic ? "diagnostic_reassessment_of_previously_inspected_prediction; original report preserved" : prediction ? "development_evaluation; verify prediction timing and frozen evaluator before public claims" : "deterministic_development_checks",
    expectedRevisionSha256: createHash("sha256").update(truthText).digest("hex"), contextSha256: createHash("sha256").update(JSON.stringify(contextDocuments)).digest("hex"), inputContext: contextDocuments,
    predictionSource, sources: truth.sources, cases, passed: cases.every((item) => item.status !== "fail"), executedCases: cases.filter((item) => item.status !== "not_run").length };
  const reportPath = resolve(outputDirectory, `quetzal-${Date.now()}-${randomUUID()}.json`);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { report, reportPath };
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--help") return { help: true };
    if (args[index] === "--diagnostic") { result.diagnostic = true; continue; }
    if (!["--prediction", "--prediction-metadata", "--output-dir"].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: node scripts/benchmark-quetzal.mjs [--prediction FILE] [--prediction-metadata FILE] [--diagnostic] [--output-dir DIRECTORY]");
    result[args[index] === "--prediction" ? "predictionPath" : args[index] === "--prediction-metadata" ? "metadataPath" : "outputDirectory"] = resolve(args[++index]);
  }
  return result;
}
async function main() {
  const args = options(process.argv.slice(2));
  if (args.help) { console.log("Usage: npm run benchmark:quetzal -- [--prediction FILE] [--prediction-metadata FILE] [--diagnostic] [--output-dir DIRECTORY]\nDefault: deterministic B10/25/26/100 and C1; A0 not_run. No network or AI credentials required.\nPrediction: saved engineeringSystem JSON, or {engineeringSystem: ...}, from curated context only. A1 raw artifacts are future work.\nUse --diagnostic when re-evaluating previously inspected outputs; retain their original report."); return; }
  const prediction = args.predictionPath ? JSON.parse(await readFile(args.predictionPath, "utf8")) : undefined;
  const predictionMetadata = args.metadataPath ? JSON.parse(await readFile(args.metadataPath, "utf8")) : null;
  const { report, reportPath } = await runQuetzalBenchmark({ prediction, predictionMetadata, diagnostic: args.diagnostic, predictionSource: args.predictionPath || null, outputDirectory: args.outputDirectory });
  console.log(`${report.benchmark} — independent human review pending`);
  for (const item of report.cases) {
    console.log(`${item.id}: ${item.status.toUpperCase()}${item.reason ? ` — ${item.reason}` : ""}`);
    for (const [name, value] of Object.entries(item.metrics)) console.log(`  ${name}: ${value.value === null ? "n/a" : `${(value.value * 100).toFixed(2)}%`} (${value.numerator}/${value.denominator})`);
    for (const failure of item.failures || []) console.log(`  FAIL: ${failure}`);
  }
  console.log(`Evidence report: ${reportPath}`);
  process.exitCode = report.passed ? 0 : 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch((error) => { console.error(`Quetzal benchmark failed: ${error.message}`); process.exitCode = 1; });
