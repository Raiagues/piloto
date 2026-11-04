import { readFileSync } from 'node:fs';

export const DEFAULT_ENGINEERING_MODEL = 'gpt-6.1-sol';
const PROVIDERS = ['openai', 'gemini'];
const PROMPTS = new URL('../../prompts/llm/', import.meta.url);
const invalid = field =>
  Object.assign(
    new Error(
      `Invalid language-model configuration (${field}). Review the server settings; no fallback model was used.`,
    ),
    { code: 'LLM_CONFIG_INVALID', category: 'configuration', statusCode: 503 },
  );

export const prompt = name => readFileSync(new URL(name, PROMPTS), 'utf8');

/** The model of the engineering analyses. For especially hard analyses, set NORTE_ENGINEERING_MODEL=gpt-6-astra. */
export function llmConfig(options = {}, defaultOutputTokens = 6000) {
  const env = options.env ?? process.env;
  const provider = options.provider ?? (env.NORTE_LLM_PROVIDER || 'openai');
  if (!PROVIDERS.includes(provider)) throw invalid('provider');
  const model = options.model ?? env.NORTE_ENGINEERING_MODEL ?? DEFAULT_ENGINEERING_MODEL;
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(model)) throw invalid('model');
  const maxOutputTokens = Number(
    options.maxOutputTokens ?? env.NORTE_ENGINEERING_MAX_OUTPUT_TOKENS ?? defaultOutputTokens,
  );
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 131072)
    throw invalid('max output tokens');
  return { provider, model, maxOutputTokens };
}

export function llmStatus(apiKey, options) {
  try {
    const { provider, model } = llmConfig(options);
    return { configured: Boolean(apiKey), provider, model };
  } catch {
    return { configured: false, provider: null, model: null, configurationError: 'LLM_CONFIG_INVALID' };
  }
}
