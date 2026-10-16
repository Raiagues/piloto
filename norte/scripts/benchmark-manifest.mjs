/** Development benchmark metadata. Unknown provider settings remain null. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
export const benchmarkHash = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export async function buildBenchmarkManifest({ benchmarkName, benchmarkRevision, evaluationReferenceRevision, context, modelSchemaVersion = 1, predictionMetadata = null, modelIdentifier = null, prompt = null }) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const checks = await Promise.allSettled([
    run("git", ["rev-parse", "HEAD"], { cwd: root }), run("git", ["status", "--porcelain"], { cwd: root }),
    readFile(new URL("../shared/impact-engine.mjs", import.meta.url), "utf8"), readFile(new URL("../server/system-ai.mjs", import.meta.url), "utf8")
  ]);
  const result = (index) => checks[index].status === "fulfilled" ? checks[index].value : null;
  const metadata = predictionMetadata?.manifest || predictionMetadata || {};
  const exactModel = metadata.model || metadata.modelIdentifier || modelIdentifier || null;
  const parameters = metadata.generationParameters || {};
  return {
    benchmarkName, benchmarkRevision, gitSha: result(0)?.stdout.trim() || null, gitDirty: result(1) ? Boolean(result(1).stdout.trim()) : null,
    engineeringModelSchemaVersion: modelSchemaVersion,
    impactEngineVersion: { path: "shared/impact-engine.mjs", sha256: result(2) ? benchmarkHash(result(2)) : null },
    promptVersion: { path: "server/system-ai.mjs", sha256: result(3) ? benchmarkHash(result(3)) : null, providerVersion: typeof metadata.promptVersion === "string" ? metadata.promptVersion : metadata.promptVersion?.providerVersion || null },
    promptHash: prompt ? benchmarkHash(prompt) : metadata.promptHash || null,
    modelProvider: metadata.provider || metadata.modelProvider || null, modelIdentifier: exactModel,
    generationParameters: { ...parameters, temperature: metadata.temperature ?? parameters.temperature ?? null, top_p: metadata.top_p ?? parameters.top_p ?? parameters.topP ?? null, seed: metadata.seed ?? parameters.seed ?? null },
    seedAvailability: metadata.seedAvailability || (exactModel ? "not_recorded; no reproducibility claim" : "not_applicable_deterministic"),
    timestamp: new Date().toISOString(), contextHash: benchmarkHash(context), evaluationReferenceRevision,
    metadataLimitations: "Null means unavailable or not applicable. Prompt-source hash identifies repository implementation, not an unrecorded past provider request. Runtime holdout isolation does not exclude pretraining contamination.",
    originalExtractionManifest: predictionMetadata?.manifest || null
  };
}
