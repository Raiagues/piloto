/** Local `.env` loading for every entry point. Variables injected by the host win over a developer file. */
export const LOCAL_ENV_FILES = Object.freeze(['.env', '.env.local']);

export function loadLocalEnvironment({ env = process.env, files = LOCAL_ENV_FILES, load = process.loadEnvFile } = {}) {
  if (env.NODE_ENV === 'production' || typeof load !== 'function') return [];
  const loaded = [];
  for (const file of files) {
    try {
      load.call(process, file);
      loaded.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return loaded;
}
