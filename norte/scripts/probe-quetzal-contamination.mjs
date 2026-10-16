#!/usr/bin/env node
/** Evaluator only: never import this probe, its output or its markers into project memory. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { createSystemAiService } from "../server/system-ai.mjs";
import { buildBenchmarkManifest } from "./benchmark-manifest.mjs";

export const contaminationPrompt = [
  "Answer from your existing knowledge only. Do not browse, use tools or retrieve documents.",
  "For each question, distinguish what you recall from what you do not know. Do not guess numbers or invent citations.",
  "1. What do you know about Quetzal-1's electrical power system?",
  "2. Do you recall any reported AX100 communications anomalies on that mission?",
  "3. Do you recall reported battery behavior associated with communications anomalies?",
  "4. Do you recall any reported operational response to those anomalies?"
].join("\n");

// Mention detection is descriptive metadata; it neither proves memorization nor scores engineering quality.
export function recalledMarkers(response) {
  const markers = [
    ["24 TX-hang events", /\b24\b.{0,100}(?:TX|transmi|hang|fail|event)|(?:TX|transmi|hang|fail|event).{0,100}\b24\b/iu],
    ["3.13 W observed total demand", /\b3[.,]13\s*(?:W\b|watts?)/iu],
    ["−1.81 W observed power margin", /[−-]\s*1[.,]81\s*(?:W\b|watts?)/iu],
    ["approximately six-hour depletion", /\b(?:6|six)\s*[- ]?\s*(?:hours?|h\b)/iu],
    ["watchdog shortened from 24 h to 2 h", /(?:watchdog|reset).{0,180}\b24\b.{0,100}\b2\b/iu]
  ];
  return markers.filter(([, pattern]) => pattern.test(response)).map(([fact, pattern]) => ({ fact, matchedText: response.match(pattern)?.[0] }));
}

export async function runContaminationProbe({ apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY, model = createSystemAiService().status().model, fetchImpl = fetch, outputDirectory = resolve("var/benchmarks") } = {}) {
  if (!apiKey) throw new Error("Set GEMINI_API_KEY or GOOGLE_API_KEY to run the isolated contamination probe.");
  if (!/^[a-zA-Z0-9._-]+$/u.test(model)) throw new Error("Invalid model identifier.");
  const generationConfig = { temperature: 0.1, maxOutputTokens: 3000 };
  const manifest = await buildBenchmarkManifest({ benchmarkName: "Quetzal-1 contamination probe", benchmarkRevision: "probe-v1", evaluationReferenceRevision: "probe-markers-v1", context: [], modelIdentifier: model, prompt: contaminationPrompt,
    predictionMetadata: { provider: "Google Gemini", model, temperature: generationConfig.temperature, top_p: null, seed: null, seedAvailability: "Not requested; provider reproducibility is not established.", promptVersion: "probe-v1", generationParameters: generationConfig } });
  const report = { schemaVersion: 1, manifest, kind: "pretraining_contamination_probe", scored: false, prompt: contaminationPrompt, projectMemoryProvided: false, retrievalEnabled: false, status: "pending", response: null, recalledEvaluatorFacts: [],
    interpretation: "Matched mentions are contamination signals, not verified recall. No match does not establish absence of pretraining contamination. This probe does not contribute to benchmark scores." };
  const started = Date.now();
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: contaminationPrompt }] }], generationConfig })
    });
    report.providerStatus = response.status;
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    const body = await response.json();
    const candidate = body?.candidates?.[0];
    report.response = candidate?.content?.parts?.filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("") || null;
    report.finishReason = candidate?.finishReason || null;
    report.providerModelVersion = body.modelVersion || null;
    report.usageMetadata = body.usageMetadata || null;
    if (!report.response) throw new Error("Provider returned no public response text.");
    report.recalledEvaluatorFacts = recalledMarkers(report.response);
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    // No arbitrary provider exception/body is persisted: it may contain credentials or request headers.
    report.error = error?.name === "TimeoutError" ? "Provider timeout" : report.providerStatus && report.providerStatus !== 200 ? `Provider HTTP ${report.providerStatus}` : "Probe did not return a usable response.";
  }
  report.elapsedMs = Date.now() - started;
  await mkdir(outputDirectory, { recursive: true });
  const reportPath = resolve(outputDirectory, `quetzal-probe-${Date.now()}-${randomUUID()}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { report, reportPath };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--help")) console.log("Usage: node --env-file=.env scripts/probe-quetzal-contamination.mjs\nOne isolated live provider request, without Project Memory or retrieval. Private report: var/benchmarks/.");
  else runContaminationProbe().then(({ report, reportPath }) => {
    console.log(`Contamination probe: ${report.status}; evaluator-fact mentions: ${report.recalledEvaluatorFacts.length}. No benchmark score.`);
    console.log(`Evidence report: ${reportPath}`);
    process.exitCode = report.status === "completed" ? 0 : 1;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
