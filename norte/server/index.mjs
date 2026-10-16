import { loadLocalEnvironment } from "./local-environment.mjs";

// Local secrets must reach every entry point, not only `npm run dev`. Hosted
// deployments inject their own environment and are left untouched.
loadLocalEnvironment();

const { buildApp } = await import("./app.mjs");

const port = Number(process.env.PORT || process.env.NORTE_API_PORT || process.env.MISSION_API_PORT || 8787);
const host = process.env.NORTE_API_HOST || process.env.MISSION_API_HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
// Initialize the map only from attached user documents, never recorded answers.
const app = await buildApp({ serveStatic: true, ...(process.env.NORTE_STORE_FILE ? { storeFile: process.env.NORTE_STORE_FILE } : {}) });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 20_000);
  deadline.unref();
  try { await app.close(); process.exit(0); }
  catch { process.exit(1); }
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
try {
  await app.listen({ host, port });
  app.log.info(`Norte disponível em http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
