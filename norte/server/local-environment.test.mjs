import test from "node:test";
import assert from "node:assert/strict";
import { loadLocalEnvironment, LOCAL_ENV_FILES } from "./local-environment.mjs";

test("every local entry point reads the same files, in the same order", () => {
  assert.deepEqual([...LOCAL_ENV_FILES], [".env", ".env.local"]);
});

test("a missing env file is not an error", () => {
  const load = () => { throw Object.assign(new Error("no such file"), { code: "ENOENT" }); };
  assert.deepEqual(loadLocalEnvironment({ env: {}, files: [".env"], load }), []);
});

test("an unreadable env file is reported rather than swallowed", () => {
  const load = () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); };
  assert.throws(() => loadLocalEnvironment({ env: {}, files: [".env"], load }), /permission denied/u);
});

test("hosted deployments keep the environment their platform injected", () => {
  let calls = 0;
  const loaded = loadLocalEnvironment({ env: { NODE_ENV: "production" }, files: [".env"], load: () => { calls += 1; } });
  assert.deepEqual(loaded, []);
  assert.equal(calls, 0);
});

test("local runs load each file that exists", () => {
  const seen = [];
  const loaded = loadLocalEnvironment({ env: {}, files: [".env", ".env.local"], load: (file) => { seen.push(file); } });
  assert.deepEqual(seen, [".env", ".env.local"]);
  assert.deepEqual(loaded, [".env", ".env.local"]);
});
