/** One alias policy for provider keys, mirrored by config.py.
 *
 * Empty values count as absent. When two aliases of the same credential are
 * filled with different values, no service picks one silently: the result is a
 * configuration error that asks the operator to keep a single name. Values are
 * kept out of messages, logs and responses.
 */
const ALIASES = Object.freeze({
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  typesafe: ['TYPESAFE_API_KEY', 'JEV_API_KEY', 'JEV_KEY_API'],
});
const PLACEHOLDERS = new Set(['COLE_SUA_CHAVE_AQUI', 'SUA_CHAVE_AQUI']);

export function resolveKey(kind, env = process.env) {
  const names = ALIASES[kind];
  if (!names) throw new Error(`Unknown credential kind ${kind}`);
  const filled = names
    .map(name => [name, String(env[name] ?? '').trim()])
    .filter(([, value]) => value && !PLACEHOLDERS.has(value));
  const distinct = new Set(filled.map(([, value]) => value));
  if (distinct.size > 1) {
    return {
      key: '',
      source: null,
      configured: false,
      error: 'KEY_ALIAS_CONFLICT',
      message: `${filled.map(([name]) => name).join(' e ')} estão preenchidas com valores diferentes. Mantenha somente uma delas no .env.`,
    };
  }
  const [first] = filled;
  if (first && !/^[\x21-\x7e]+$/u.test(first[1]))
    return {
      key: '',
      source: first[0],
      configured: false,
      error: 'KEY_INVALID',
      message: `${first[0]} contém espaços ou caracteres inválidos.`,
    };
  return { key: first?.[1] || '', source: first?.[0] || null, configured: Boolean(first), error: null, message: null };
}

/** The key of the selected language-model provider. Conflicts resolve to '' and are reported as not configured. */
export function llmApiKey(env = process.env) {
  return resolveKey((env.NORTE_LLM_PROVIDER || 'openai') === 'gemini' ? 'google' : 'openai', env).key;
}
