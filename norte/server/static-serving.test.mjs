import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.mjs';

test('integrated server serves the application and preserves API errors', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'norte-static-'));
  const root = join(dir, 'dist'); await mkdir(root);
  await writeFile(join(root, 'index.html'), '<!doctype html><html><body>Norte</body></html>');
  const app = await buildApp({ storeFile: join(dir, 'data.json'), serveStatic: true, staticRoot: root, logger: false });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const page = await app.inject('/');
  assert.equal(page.statusCode, 200); assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /Norte/);
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  const missing = await app.inject('/api/removed-feature');
  assert.equal(missing.statusCode, 404); assert.doesNotMatch(missing.body, /<!doctype html>/);
  assert.equal((await app.inject('/.env')).statusCode, 404);
});
