import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApp } from './app.mjs';
import { validationDocuments, VALIDATION_DOCUMENTS_MISSING_MESSAGE } from './validation-documents.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'norte-private-corpus-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const text = 'A missão de teste mede a temperatura do equipamento.';
  const source = { id: 'fixture', title: 'Documento sintético', description: 'Somente para teste.', role: 'project_context', text_path: 'extracted/source.txt', text_sha256: createHash('sha256').update(text).digest('hex'), source_url: 'https://example.test/source' };
  return { directory, text, source };
}

test('missing manifest fails with a safe actionable provisioning error, never an empty corpus', async t => {
  const { directory } = await fixture(t);
  assert.throws(() => validationDocuments(directory), error => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'VALIDATION_DOCUMENTS_MISSING');
    assert.equal(error.message, VALIDATION_DOCUMENTS_MISSING_MESSAGE);
    assert.equal(error.message.includes(directory), false);
    assert.equal(error.path, undefined);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('validation demo with a present manifest and missing text returns 503 without creating any account; provisioning the complete public corpus succeeds', async t => {
  const { directory } = await fixture(t);
  const corpus = fileURLToPath(new URL('../../project-documents/quetzal-1/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(corpus, 'manifest.json'), 'utf8'));
  const sources = manifest.sources.filter(source => ['project_context', 'supporting_datasheet'].includes(source.role));
  assert.equal(sources.length, 17);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ sources: [...sources, { role: 'evaluation_reference', text_path: 'benchmark/missing.txt' }] }));
  const previous = { profile: process.env.NORTE_DEMO_PROFILE, documents: process.env.NORTE_VALIDATION_DOCUMENTS };
  process.env.NORTE_DEMO_PROFILE = 'validation'; process.env.NORTE_VALIDATION_DOCUMENTS = directory;
  t.after(() => {
    for (const [name, value] of [['NORTE_DEMO_PROFILE', previous.profile], ['NORTE_VALIDATION_DOCUMENTS', previous.documents]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const app = await buildApp({ storeFile: join(directory, 'store.json'), logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  const before = app.missionStore.read();
  const missing = await app.inject({ method: 'POST', url: '/api/auth/demo' });
  assert.equal(missing.statusCode, 503);
  assert.deepEqual(missing.json(), { error: 'VALIDATION_DOCUMENTS_MISSING', message: VALIDATION_DOCUMENTS_MISSING_MESSAGE });
  assert.equal(missing.headers['set-cookie'], undefined);
  assert.equal(missing.body.includes(directory), false);
  const after = app.missionStore.read();
  for (const key of ['users', 'members', 'teams', 'artifacts', 'sessions', 'workspace']) assert.deepEqual(after[key], before[key], key + ' must not contain partial demo data');
  for (const source of sources) {
    const target = join(directory, source.text_path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(corpus, source.text_path)));
  }
  const ready = await app.inject({ method: 'POST', url: '/api/auth/demo' });
  assert.equal(ready.statusCode, 201, ready.body);
  assert.equal(ready.json().user.demoAccount, true);
  const imported = app.missionStore.read().artifacts.filter(artifact => artifact.demoSandboxId);
  assert.equal(imported.length, 17);
  for (const source of sources) {
    const importedSource = imported.find(artifact => artifact.fileName === `${source.id}.txt`);
    assert.equal(importedSource.documentText, await readFile(join(corpus, source.text_path), 'utf8'));
  }
  const owner = app.missionStore.read().users.find(user => user.id === ready.json().user.id);
  assert(app.missionStore.read().workspace.projects[`${owner.demoSandboxId}-quetzal-1`].publicQuetzalDemoFixture);
});

test('a partial readable corpus returns a safe provisioning error and rolls back all demo records', async t => {
  const { directory, source, text } = await fixture(t);
  await mkdir(join(directory, 'extracted'));
  await writeFile(join(directory, source.text_path), text);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ sources: [source] }));
  const previous = { profile: process.env.NORTE_DEMO_PROFILE, documents: process.env.NORTE_VALIDATION_DOCUMENTS };
  process.env.NORTE_DEMO_PROFILE = 'validation'; process.env.NORTE_VALIDATION_DOCUMENTS = directory;
  t.after(() => {
    for (const [name, value] of [['NORTE_DEMO_PROFILE', previous.profile], ['NORTE_VALIDATION_DOCUMENTS', previous.documents]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const app = await buildApp({ storeFile: join(directory, 'store.json'), logger: false, demoAccount: true, ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(() => app.close());
  const before = app.missionStore.read();
  const response = await app.inject({ method: 'POST', url: '/api/auth/demo' });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'VALIDATION_DOCUMENTS_MISSING', message: VALIDATION_DOCUMENTS_MISSING_MESSAGE });
  assert.equal(response.body.includes(directory), false);
  assert.equal(response.headers['set-cookie'], undefined);
  const after = app.missionStore.read();
  for (const key of ['users', 'members', 'teams', 'artifacts', 'sessions', 'workspace']) assert.deepEqual(after[key], before[key]);
});

test('a source whose download was unavailable cannot silently produce a partial demo corpus', async t => {
  const { directory, source } = await fixture(t);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ sources: [{ ...source, status: 'unavailable', text_path: undefined }] }));
  assert.throws(() => validationDocuments(directory), { code: 'VALIDATION_DOCUMENTS_MISSING', statusCode: 503 });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ sources: [] }));
  assert.throws(() => validationDocuments(directory), { code: 'VALIDATION_DOCUMENTS_MISSING', statusCode: 503 });
});
