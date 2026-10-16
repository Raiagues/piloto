/** Local `.env` loading, shared by every entry point.
 *
 * `scripts/dev.mjs` used to be the only place that read `.env.local`, so
 * `npm start` and `npm run dev:api` booted without GEMINI_API_KEY and the
 * engineering service reported itself unconfigured. Hosted environments
 * (Render) inject real environment variables and must never be overridden by a
 * developer file that is not deployed anyway.
 */
export const LOCAL_ENV_FILES = Object.freeze([".env", ".env.local"]);

export function loadLocalEnvironment({ env = process.env, files = LOCAL_ENV_FILES, load = process.loadEnvFile } = {}) {
  if (env.NODE_ENV === "production" || typeof load !== "function") return [];
  const loaded = [];
  for (const file of files) {
    try { load.call(process, file); loaded.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return loaded;
}
