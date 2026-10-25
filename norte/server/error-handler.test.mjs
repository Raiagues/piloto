import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from './app.mjs';

for (const serveStatic of [false, true]) {
  test(`production API errors remain sanitized with serveStatic=${serveStatic}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'norte-errors-'));
    const previous = process.env.NODE_ENV;
    let app;
    process.env.NODE_ENV = 'production';
    try {
      app = await buildApp({ storeFile: join(directory, 'state.json'), databaseUrl: '', serveStatic,
        logger: false, demoAccount: false, bootstrapToken: 'isolated-bootstrap-test-token-with-enough-characters',
        ai: { apiKey: '' }, systemAi: { apiKey: '' },
        platform: { encryptionKey: 'isolated-error-test-key-not-a-real-credential' } });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    }
    t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });

    const rejected = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      name: 'Visitor', nickname: 'visitor', email: 'visitor@example.test',
      password: 'Isolated error-envelope test passphrase', bootstrapToken: 'wrong-code'
    } });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().error, 'BOOTSTRAP_INVALID');
    assert.equal(app.missionStore.read().users.length, 0);

    // Exercise a real existing API route, including its finalized static-mode
    // context, rather than registering a test route after app construction.
    app.missionStore.health = async () => { throw new Error('private database password and /internal/path'); };
    const failed = await app.inject('/api/health');
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(failed.json(), { error: 'INTERNAL_ERROR', message: 'The server could not complete this request.' });
    assert.ok(!failed.body.includes('private database'));
    assert.ok(!failed.body.includes('/internal/path'));


  });
}
