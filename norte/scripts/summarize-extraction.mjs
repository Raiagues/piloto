/** Read-only reassessment of retained diagnostics. Does not send requests or edit original reports. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

export async function summarizeExtraction(directories) {
  const groups = [];
  for (const directory of directories) {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    for (const model of manifest.models) {
      const records = manifest.records.filter((record) => record.model === model);
      const physical = records.flatMap((record) => record.provider);
      const completedRequests = physical.filter((request) => request.status === "provider_completed");
      const expectedStages = manifest.strategy === "B" ? 4 : manifest.strategy === "C" ? 2 : 1;
      const completed = records.filter((record) => record.provider.length === expectedStages && record.provider.every((request) => request.status === "provider_completed"));
      const valid = records.filter((record) => record.contractStatus === "pass");
      const a0 = records.filter((record) => record.a0Status === "pass");
      const schemaChecks = [];
      for (const record of records) for (let index = 0; index < record.provider.length; index++) {
        const request = record.provider[index];
        if (request.status !== "provider_completed") continue;
        const path = join(directory, `${record.model}-${record.run}`);
        const response = JSON.parse(await readFile(join(path, `response-${index + 1}.json`), "utf8"));
        let jsonValid = false;
        try { JSON.parse(response?.candidates?.[0]?.text); jsonValid = true; } catch { /* A completed transport may contain invalid model JSON. */ }
        schemaChecks.push({ run: record.run, stage: request.stage || "monolithic", jsonValid, schemaStatus: request.schemaStatus || (record.schemaStatus === "pass" ? "pass" : "unknown") });
      }
      const fullCandidate = manifest.strategy !== "probe" && !(manifest.strategy === "compact" && (manifest.ablation ?? 6) < 6);
      const denominator = (numerator, count) => `${numerator}/${count}`;
      groups.push({ directory: resolve(directory), strategy: manifest.strategy, ablation: manifest.ablation ?? 6, internalLanguage: manifest.internalLanguage || "en", model, parameters: manifest.parameters, attempted: records.length, physical: physical.length, providerCompletion: denominator(completedRequests.length, physical.length), jsonValidity: denominator(schemaChecks.filter((item) => item.jsonValid).length, completedRequests.length), pipelineCompletion: denominator(completed.length, records.length), contractAmongCompleted: fullCandidate ? denominator(valid.length, completed.length) : "n/a", a0AmongCompleted: fullCandidate ? denominator(a0.length, completed.length) : "n/a", usableOverall: fullCandidate ? denominator(valid.length, records.length) : "n/a", meanPhysicalLatencyMs: physical.reduce((sum, item) => sum + item.elapsedMs, 0) / physical.length, meanCompletedRequestLatencyMs: completedRequests.length ? completedRequests.reduce((sum, item) => sum + item.elapsedMs, 0) / completedRequests.length : null, records, schemaChecks, acceptance: manifest.acceptance || null });
    }
  }
  const table = groups.map((group) => `| ${group.strategy}${group.strategy === "compact" ? ` ${group.ablation}` : ""} / ${group.internalLanguage} | ${group.model} | ${group.providerCompletion} | ${group.jsonValidity} | ${group.pipelineCompletion} | ${group.contractAmongCompleted} | ${group.a0AmongCompleted} | ${group.usableOverall} | ${(group.meanPhysicalLatencyMs / 1000).toFixed(2)} |`).join("\n");
  const details = groups.flatMap((group) => group.records.map((record) => {
    const missing = (record.missingProperties || []).map((property) => `${property.entity}.${property.keys.join("/")} (actual: ${property.actual ? JSON.stringify(property.actual.value) : "missing"})`);
    const lines = [
      `### ${group.strategy} / ${group.model} / run ${record.run}`,
      `Source run: ${group.directory}. Internal language: ${group.internalLanguage}; scope: ${group.ablation}.`,
      `Provider: ${record.provider.map((request) => `${request.stage || "monolithic"}: ${request.httpStatus ?? request.status}, ${request.elapsedMs} ms, request ${request.requestChars} chars, schema ${request.schemaChars} chars, response ${request.responseBytes} bytes, headers at ${request.timeToHeadersMs ?? "unavailable"} ms`).join("; ")}.`,
      `Schema ${record.schemaStatus}; hierarchy ${record.hierarchyStatus}; contract ${record.contractStatus}; A0 ${record.a0Status}. Categories: ${record.categories.join(", ") || "none"}.`,
      `Missing entities: ${(record.missingEntities || []).map((entity) => entity.expectedId).join(", ") || "none reported / not evaluable"}.`,
      `Missing or incorrect properties: ${missing.join("; ") || "none reported / not evaluable"}.`,
      `Relation errors: ${(record.relationErrors?.missing || []).join("; ") || "none reported / not evaluable"}; unexpected: ${(record.relationErrors?.unexpected || []).map((item) => item.signature).join("; ") || "none reported / not evaluable"}.`,
      `Requirement errors: ${(record.requirementErrors || []).filter((item) => !item.correct).map((item) => `${item.expectedId}: meaning=${item.correctMeaning}, trace=${item.correctTrace}`).join("; ") || "none reported / not evaluable"}.`,
      `Evidence errors: ${(record.evidenceErrors || []).map((item) => `${item.claim}: ${item.reason}`).join("; ") || "none reported / not evaluable"}.`,
      `A0 failures: ${(record.failures || []).join("; ") || "none reported / not evaluable"}.`
    ];
    return lines.join("\n\n");
  })).join("\n\n");
  return { groups, markdown: `# Extraction diagnostic comparison\n\nEvery physical request is counted, including failed stages. Contract and A0 denominators use completed end-to-end extractions. Partial ablations and provider controls are not full-contract candidates. A0 on rejected raw outputs is diagnostic only. Unavailable checks are not successes. This is an observational development sample, not a statistical reliability guarantee.\n\n| Strategy / language | Model | Provider requests | JSON / responses | Completed pipelines | Contract / completed | A0 / completed | Usable / attempted | Mean request s |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${table}\n\n${details}\n` };
}
async function main() {
  const args = process.argv.slice(2), outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : `var/benchmarks/extraction-comparison-${Date.now()}.md`;
  if (outputIndex >= 0) args.splice(outputIndex, 2);
  if (!args.length || !output) throw new Error("Usage: node scripts/summarize-extraction.mjs RUN_DIR [RUN_DIR ...] [--output NEW_MARKDOWN_FILE]");
  const result = await summarizeExtraction(args);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, result.markdown, { mode: 0o600, flag: "wx" });
  await writeFile(`${output}.json`, JSON.stringify(result.groups, null, 2), { mode: 0o600, flag: "wx" });
  console.log(`Comparison saved: ${resolve(output)}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
