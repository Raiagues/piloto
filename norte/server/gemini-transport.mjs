/** Direct REST transport. One observable record per physical request, including retries. */
const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
const headerNames = ["retry-after", "server-timing", "x-request-id", "x-goog-request-id", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];
const usageFields = ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount", "cachedContentTokenCount"];
const finishReasons = new Set(["STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "LANGUAGE", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "FINISH_REASON_UNSPECIFIED"]);
export const EXTRACTION_TRANSPORT_POLICY = Object.freeze({ timeoutMs: 90_000, maxAttempts: 2, totalDeadlineMs: 185_000, initialBackoffMs: 1000, maxBackoffMs: 10_000 });
export function retryDelay(headers, attempt, random = Math.random, now = Date.now()) {
  const value = headers?.get("retry-after");
  const serverDelay = value == null ? 0 : Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Math.max(Number.isFinite(serverDelay) ? Math.max(0, serverDelay) : 0, Math.min(10_000, 1000 * 2 ** (attempt - 1)) * (0.5 + random() * 0.5));
}
export function classifyExtractionError(code) {
  return ({ SYSTEM_HIERARCHY_INVALID: "hierarchy_failure", SYSTEM_FORMULA_INVALID: "relation_direction_failure", SYSTEM_EVIDENCE_INVALID: "unsupported_evidence", SYSTEM_RESPONSE_INVALID: "schema_rejection" })[code] || "semantic_validation_failure";
}
export async function geminiGenerate({ apiKey, model, body, fetchImpl = fetch, policy = EXTRACTION_TRANSPORT_POLICY, onAttempt = () => {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random }) {
  const started = Date.now();
  const serialized = JSON.stringify(body);
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const start = Date.now();
    const timeoutMs = Math.min(policy.timeoutMs, policy.totalDeadlineMs - (start - started));
    if (timeoutMs <= 0) break;
    const record = { provider: "Google Gemini", model, attempt, startedAt: new Date(start).toISOString(), requestChars: serialized.length, requestBytes: Buffer.byteLength(serialized), approximateRequestTokens: Math.ceil(serialized.length / 4), approximateTokenMethod: "characters/4; not tokenizer or billing", schemaChars: JSON.stringify(body.generationConfig?.responseJsonSchema || {}).length, contextChars: JSON.stringify(body.contents).length, timeoutMs, headers: {}, httpStatus: null, timeToHeadersMs: null, responseBytes: 0, status: "provider_error", clientAborted: false };
    let response, publicBody, output, failure;
    try {
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(timeoutMs), body: serialized });
      record.timeToHeadersMs = Date.now() - start;
      record.httpStatus = response.status;
      record.headers = Object.fromEntries(headerNames.flatMap((name) => response.headers.get(name) ? [[name, response.headers.get(name)]] : []));
      const raw = await response.text();
      record.responseBytes = Buffer.byteLength(raw);
      let data;
      try { data = JSON.parse(raw); } catch { throw Object.assign(new Error("Invalid provider envelope"), { category: response.ok ? "schema_rejection" : "provider_error" }); }
      const candidates = (Array.isArray(data.candidates) ? data.candidates : []).map((candidate) => ({ finishReason: finishReasons.has(candidate.finishReason) ? candidate.finishReason : null, text: (Array.isArray(candidate.content?.parts) ? candidate.content.parts : []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("") }));
      // Whitelist response fields; never expose request headers, thoughts or raw error messages.
      record.quotaUnavailable = response.status === 429 && /\blimit:\s*0\b/iu.test(data.error?.message || "");
      const usage = Object.fromEntries(usageFields.filter((key) => Number.isSafeInteger(data.usageMetadata?.[key]) && data.usageMetadata[key] >= 0).map((key) => [key, data.usageMetadata[key]]));
      publicBody = { modelVersion: typeof data.modelVersion === "string" && /^[\w.-]{1,100}$/u.test(data.modelVersion) ? data.modelVersion : null, usageMetadata: Object.keys(usage).length ? usage : null, candidates, error: data.error ? { code: response.status } : null };
      record.modelVersion = publicBody.modelVersion;
      record.usageMetadata = publicBody.usageMetadata;
      record.finishReason = candidates[0]?.finishReason ?? null;
      if (!response.ok) throw Object.assign(new Error("Provider rejected request"), { category: "provider_error" });
      record.status = "provider_completed";
      record.usageAvailable = Boolean(publicBody.usageMetadata);
      record.outputTokens = record.usageAvailable ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) : null;
      record.outputLimit = body.generationConfig?.maxOutputTokens ?? null;
      if (data.promptFeedback?.blockReason) throw Object.assign(new Error("Blocked provider response"), { category: "provider_blocked" });
      if (!candidates.length) throw Object.assign(new Error("Missing candidate"), { category: "schema_rejection" });
      if (candidates.length !== 1 || candidates[0].finishReason !== "STOP") throw Object.assign(new Error("Incomplete provider response"), { category: candidates[0]?.finishReason === "MAX_TOKENS" || !candidates[0]?.finishReason ? "provider_incomplete" : "provider_blocked" });
      if (usageFields.some((key) => data.usageMetadata?.[key] !== undefined && !Object.hasOwn(usage, key))) throw Object.assign(new Error("Invalid token metadata"), { category: "schema_rejection" });
      if (record.outputLimit && record.outputTokens >= record.outputLimit) throw Object.assign(new Error("Output budget exhausted"), { category: "provider_incomplete" });
      try { output = JSON.parse(candidates[0]?.text); } catch { throw Object.assign(new Error("Invalid structured response"), { category: "schema_rejection" }); }
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      record.clientAborted = timeout;
      const code = ({ schema_rejection: "SYSTEM_RESPONSE_INVALID", provider_incomplete: "GEMINI_RESPONSE_INCOMPLETE", provider_blocked: "GEMINI_RESPONSE_BLOCKED" })[error.category] || "SYSTEM_AI_UNAVAILABLE";
      failure = Object.assign(new Error(timeout ? "The engineering service exceeded the local deadline. Project memory is preserved." : error.category === "provider_incomplete" ? "The AI response was interrupted or exhausted its token budget. Your idea is preserved; retry the interpretation." : error.category === "schema_rejection" ? "The engineering service returned invalid structured data." : "The engineering service could not complete this request. Project memory is preserved."), { code, statusCode: response?.status === 429 ? 429 : 502, category: timeout ? "provider_timeout" : error.category || "provider_error" });
      record.status = failure.category === "schema_rejection" ? "provider_completed" : failure.category;
      record.failureCategory = failure.category;
    }
    record.elapsedMs = Date.now() - start;
    const delay = retryDelay(response?.headers, attempt, random);
    const retryable = failure && !record.quotaUnavailable && (failure.category === "provider_timeout" || (failure.category === "provider_error" && (!response || retryStatuses.has(response.status))));
    record.retryScheduled = Boolean(retryable && attempt < policy.maxAttempts && Date.now() - started + delay + 1000 < policy.totalDeadlineMs);
    record.retryDelayMs = record.retryScheduled ? delay : null;
    await onAttempt(record, { request: body, response: publicBody ?? null, output: output ?? null });
    if (!failure) return output;
    if (!record.retryScheduled) throw failure;
    await wait(delay);
  }
  throw Object.assign(new Error("The extraction request budget expired. Retry from Project Memory."), { code: "SYSTEM_AI_UNAVAILABLE", category: "provider_timeout", statusCode: 502 });
}
