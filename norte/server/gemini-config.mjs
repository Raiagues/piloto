export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

// generateContent REST capabilities, checked against Google's documentation.
// Deliberately explicit: new model aliases need a reviewed capability entry.
const levels = {
  "gemini-3.8-flash": ["low", "medium", "high"],
  "gemini-3.7-flash": ["low", "medium", "high"],
  "gemini-3.6-flash": ["minimal", "low", "medium", "high"],
  "gemini-3.5-flash": ["minimal", "low", "medium", "high"],
  "gemini-3.5-flash-lite": ["minimal", "low", "medium", "high"],
  "gemini-3.1-flash-lite": ["minimal", "low", "medium", "high"],
  "gemini-3.1-flash-lite-preview": ["minimal", "low", "medium", "high"],
  "gemini-3.1-pro-preview": ["low", "medium", "high"],
  "gemini-3-flash-preview": ["minimal", "low", "medium", "high"],
  "gemini-3-pro-preview": ["low", "high"]
};
const invalid = (field) => Object.assign(new Error(`Invalid Gemini configuration (${field}). Review the server settings; no fallback model was used.`), { code: "GEMINI_CONFIG_INVALID", category: "configuration", statusCode: 503 });

export function geminiConfig(options = {}, feature = "extraction") {
  const env = options.env ?? process.env;
  const prefix = `GEMINI_${feature.toUpperCase()}`;
  const override = options.features?.[feature] ?? {};
  const model = override.model ?? options.model ?? env[`${prefix}_MODEL`] ?? env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  if (typeof model !== "string" || !/^gemini-[a-zA-Z0-9._-]+$/u.test(model)) throw invalid("model");
  const rawLevel = override.thinkingLevel ?? options.thinkingLevel ?? (env[`${prefix}_THINKING_LEVEL`] || env.GEMINI_THINKING_LEVEL);
  const level = typeof rawLevel === "string" ? rawLevel.trim().toLowerCase() : rawLevel;
  if (level && level !== "default" && !levels[model]?.includes(level)) throw invalid("thinking level/model compatibility");
  const maxOutputTokens = Number(override.maxOutputTokens ?? env[`${prefix}_MAX_OUTPUT_TOKENS`] ?? ({ discovery: 8192, extraction: 16000, organization: 6000 })[feature]);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 65536) throw invalid("max output tokens");
  return { model, maxOutputTokens, ...(level && level !== "default" ? { thinkingConfig: { thinkingLevel: level.toUpperCase() } } : {}) };
}

export function geminiStatus(apiKey, options, feature) {
  try { return { configured: Boolean(apiKey), model: geminiConfig(options, feature).model }; }
  catch { return { configured: false, model: null, configurationError: "GEMINI_CONFIG_INVALID" }; }
}
