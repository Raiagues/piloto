/** Repeat real extraction with fixed public design context only. No evaluator imports. */
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSystemAiService } from "../server/system-ai.mjs";
import { analyzeImpact } from "../shared/impact-engine.mjs";
import { createValidationProject } from "../server/data-store.mjs";
import { contextDocuments } from "../benchmark/quetzal1/context/design-context.mjs";
import { benchmarkProjectWithContext } from "./attach-benchmark-context.mjs";
import { benchmarkHash, buildBenchmarkManifest } from "./benchmark-manifest.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });

export async function extractQuetzalRuns({ runs = 3, language = "pt", outputDirectory, evaluationReferenceRevision = null, fetchImpl = fetch, apiKey, model, onRun = () => {} } = {}) {
  if (!Number.isInteger(runs) || runs < 1 || runs > 10 || !["pt", "en"].includes(language)) throw new Error("Use 1–10 runs and language pt or en.");
  const runSetId = `quetzal-extraction-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(outputDirectory || join(root, "var/benchmarks", runSetId));
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { recursive: false, mode: 0o700 });
  const context = contextDocuments.map((document) => ({ id: document.id, label: document.label, fileName: document.fileName, text: document.text }));
  await save(join(directory, "context.json"), context);
  const aggregate = { runSetId, plannedRuns: runs, language, evaluationReferenceRevision, contextHash: benchmarkHash(context), startedAt: new Date().toISOString(), selectionPolicy: "All attempted runs are recorded; no retries or best-run selection.", runs: [] };
  for (let index = 1; index <= runs; index += 1) {
    const runDirectory = join(directory, `run-${index}`);
    await mkdir(runDirectory, { mode: 0o700 });
    const started = Date.now();
    const record = { run: index, startedAt: new Date().toISOString(), validation: { status: "not_run" }, requestCount: 0 };
    let publicRequest = null;
    let modelVersion = null;
    const service = createSystemAiService({ apiKey, model, transportPolicy: { timeoutMs: 90_000, totalDeadlineMs: 91_000, maxAttempts: 1 }, maxContractAttempts: 1, fetch: async (url, options) => {
      record.requestCount += 1;
      const body = JSON.parse(options.body);
      const destination = new URL(url);
      // Never serialize request headers, environment values, private thoughts or raw errors.
      publicRequest = { destination: `${destination.origin}${destination.pathname}`, method: options.method, contents: body.contents, generationConfig: body.generationConfig };
      await save(join(runDirectory, "request.json"), publicRequest);
      const response = await fetchImpl(url, options);
      record.httpStatus = response.status;
      const provider = await response.clone().json().catch(() => null);
      modelVersion = provider?.modelVersion || null;
      const candidates = (provider?.candidates || []).map((candidate) => ({ finishReason: candidate.finishReason || null, text: (candidate.content?.parts || []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("") }));
      await save(join(runDirectory, "provider-public.json"), { httpStatus: response.status, modelVersion, usageMetadata: provider?.usageMetadata || null, candidates });
      if (candidates[0]?.text) await writeFile(join(runDirectory, "raw-output.txt"), candidates[0].text, { mode: 0o600 });
      return response;
    } });
    try {
      const { project, artifacts } = benchmarkProjectWithContext(createValidationProject());
      const prediction = await service.generate(project, artifacts, language);
      record.validation = { status: "passed", checks: "schema, references, declared formula inputs, exact quotations, numeric evidence, dimensions and explicit hypothesis provenance" };
      record.counts = { entities: prediction.entities.length, relations: prediction.relations.length, requirements: prediction.requirements.length, evidence: prediction.evidence.length };
      await save(join(runDirectory, "prediction.json"), prediction);
      const targets = prediction.entities.filter((entity) => entity.properties.some((property) => property.key === "tx_duty_cycle"));
      record.impactExecution = { status: targets.length === 1 ? "executed" : "not_run", reason: targets.length === 1 ? null : "A unique extracted transmitter duty property is unavailable." };
      if (targets.length === 1) {
        const impacts = [10, 100].map((value) => analyzeImpact(prediction, { id: `${runSetId}-${index}-${value}`, targetEntityId: targets[0].id, kind: "parameter", oldValues: targets[0].properties.filter((property) => property.key === "tx_duty_cycle"), newValues: [{ key: "tx_duty_cycle", name: "TX duty cycle", value, unit: "%", source: "user", evidenceRefs: [] }], description: `TX duty cycle ${value}%`, createdAt: new Date().toISOString() }, language));
        await save(join(runDirectory, "impacts.json"), impacts);
        record.impactExecution.cases = impacts.map((analysis) => ({ duty: analysis.change.newValues[0].value, metrics: analysis.metrics, calculations: analysis.calculations.map((calculation) => ({ ruleId: calculation.ruleId, result: calculation.result, unit: calculation.unit || null })) }));
      }
    } catch (error) {
      record.validation = { status: "failed", code: error.code || "EXTRACTION_RUN_FAILED", message: error.code ? error.message : "The extraction run did not complete; inspect the recorded public response." };
    }
    record.elapsedMs = Date.now() - started;
    const parameters = publicRequest?.generationConfig || {};
    record.responseSchemaHash = parameters.responseJsonSchema ? benchmarkHash(parameters.responseJsonSchema) : null;
    record.manifest = await buildBenchmarkManifest({ benchmarkName: "Quetzal-1 real context extraction", benchmarkRevision: "v0.1-development", evaluationReferenceRevision, context, modelIdentifier: modelVersion || service.status().model, predictionMetadata: { provider: "Google Gemini", model: modelVersion || service.status().model, generationParameters: parameters, promptHash: publicRequest ? benchmarkHash(publicRequest.contents) : null, seedAvailability: "not_set; repeated runs measure variability" }, prompt: publicRequest ? JSON.stringify(publicRequest.contents) : null });
    await save(join(runDirectory, "metadata.json"), record);
    aggregate.runs.push(record);
    aggregate.summary = { attempted: aggregate.runs.length, accepted: aggregate.runs.filter((run) => run.validation.status === "passed").length, failed: aggregate.runs.filter((run) => run.validation.status === "failed").length, elapsedMs: aggregate.runs.reduce((total, run) => total + run.elapsedMs, 0) };
    await save(join(directory, "manifest.json"), aggregate);
    await onRun(record);
  }
  aggregate.finishedAt = new Date().toISOString();
  await save(join(directory, "manifest.json"), aggregate);
  return { directory, manifest: aggregate };
}

function argumentsFor(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--help") return { help: true };
    const name = { "--runs": "runs", "--language": "language", "--output-dir": "outputDirectory", "--evaluation-revision": "evaluationReferenceRevision" }[args[index]];
    if (!name || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Unknown extraction option. Use --help.");
    const value = args[++index];
    options[name] = name === "runs" ? Number(value) : value;
  }
  return options;
}
async function main() {
  const options = argumentsFor(process.argv.slice(2));
  if (options.help) { console.log("Usage: node --env-file-if-exists=.env.local scripts/extract-quetzal.mjs [--runs 3] [--language pt|en] [--output-dir NEW_DIRECTORY] [--evaluation-revision FROZEN_REVISION]\nSends only fixed public design-context artifacts to the configured Gemini service. Records every raw public response, validation result and deterministic impact. Never reads evaluator content or persists a project baseline."); return; }
  const { directory, manifest } = await extractQuetzalRuns({ ...options, onRun: (record) => console.log(JSON.stringify({ run: record.run, elapsedMs: record.elapsedMs, validation: record.validation, counts: record.counts || null })) });
  console.log(JSON.stringify({ directory, summary: manifest.summary }));
  if (manifest.summary.failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error("Extraction run could not start. Check configuration and use a new output directory."); process.exitCode = 1; });
