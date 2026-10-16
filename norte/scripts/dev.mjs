import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadLocalEnvironment } from "../server/local-environment.mjs";

// Keep Gemini configuration server-side while supporting the documented local setup.
loadLocalEnvironment();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const vite = resolve(root, "node_modules/vite/bin/vite.js");

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 20)) {
  console.error(`Norte requires Node.js 24.20 or newer. Current version: ${process.versions.node}.`);
  console.error("Older runtimes crash on the argon2 native binding before the API can start.");
  console.error("Run:  source ~/.nvm/nvm.sh && nvm install && npm ci && npm run dev");
  process.exit(1);
}

function portIsAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolvePort(true)));
  });
}

async function availablePort(preferred) {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No available port found between ${preferred} and ${preferred + 19}.`);
}

const apiPort = await availablePort(Number(process.env.NORTE_API_PORT || 8787));
const webPort = await availablePort(Number(process.env.NORTE_WEB_PORT || 5173));
const developmentEnv = {
  ...process.env,
  NORTE_API_PORT: String(apiPort),
  VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  NORTE_ALLOWED_ORIGINS: process.env.NORTE_ALLOWED_ORIGINS || `http://127.0.0.1:${webPort},http://localhost:${webPort}`
};

console.log(`Norte web: http://127.0.0.1:${webPort}/norte/`);
console.log(`Norte API: http://127.0.0.1:${apiPort}/docs`);

const children = [
  spawn(node, [resolve(root, "server/index.mjs")], { cwd: root, stdio: "inherit", env: developmentEnv }),
  spawn(node, [vite, "--host", "127.0.0.1", "--port", String(webPort), "--strictPort", "--open", "/norte/"], { cwd: root, stdio: "inherit", env: developmentEnv })
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 250);
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) stop(code || 1);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
