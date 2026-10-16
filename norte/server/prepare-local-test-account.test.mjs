import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.mjs';
import { ACCOUNT, LOCAL_ORIGIN, loadVerifiedCorpus, localApi, optionsFromArgs, prepareLocalTestAccount, reviewedMapPayload } from '../scripts/prepare-local-test-account.mjs';
import { assertLocalJsonConfiguration, commitPreparedPublication, validatePreparedPublication } from '../scripts/apply-local-reviewed-map.mjs';

async function fixture(t) {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'norte-reusable-account-'));
  const directory = join(rootDirectory, 'project-documents/quetzal-1'); await mkdir(directory, { recursive: true });
  const text = 'Satellite sensor requires 3.3 V.', bytes = Buffer.from(text), hash = createHash('sha256').update(bytes).digest('hex');
  const sources = [];
  for (let i = 0; i < 17; i++) {
    const path = `source-${i}.txt`; await writeFile(join(directory, path), bytes);
    sources.push({ id: 'source-' + i, title: 'Documento público ' + i, role: i % 2 ? 'supporting_datasheet' : 'project_context', source_url: 'https://raw.githubusercontent.com/example/public/source-' + i, path, sha256: hash, text_path: path, text_sha256: hash });
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ sources }));
  const app = await buildApp({ logger: false, storeFile: join(rootDirectory, 'server.json'), ai: { apiKey: '' }, systemAi: { apiKey: '' } });
  t.after(async () => { await app.close(); await rm(rootDirectory, { recursive: true, force: true }); });
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, LOCAL_ORIGIN);
    assert.equal(options.redirect, 'error');
    const path = new URL(url).pathname; calls.push({ method: options.method, path });
    assert.doesNotMatch(path, /email-verification|invitations|system-ai|classify|brainstorm/u, 'preparation must never call mail, provider or invitation APIs');
    const response = await app.inject({ method: options.method, url: new URL(url).pathname + new URL(url).search, headers: { ...options.headers, host: '127.0.0.1:8000' }, payload: options.body });
    return new Response(response.rawPayload, { status: response.statusCode, headers: response.headers });
  };
  return { app, rootDirectory, directory, text, bytes, sources, calls, fetchImpl, run: options => prepareLocalTestAccount({ rootDirectory, fetchImpl, ...options }) };
}

test('preparation is opt-in, rejects alternate destinations and verifies original/text hashes before registration', async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).applied, false); assert.equal(f.calls.length, 0);
  await assert.rejects(stat(join(f.rootDirectory, '.runtime')), { code: 'ENOENT' });
  assert.throws(() => optionsFromArgs(['--origin', 'https://example.test']), /destino é fixo/u);
  assert.throws(() => localApi({ session: {}, origin: 'http://localhost:8001' }), /somente/u);
  await writeFile(join(f.directory, 'source-16.txt'), 'alterado');
  await assert.rejects(f.run({ apply: true }), /Hash/u); assert.equal(f.calls.length, 0);
});

test('real API preparation reuses the initial empty team/project, persists private credentials and resumes idempotently', async t => {
  const f = await fixture(t), first = await f.run({ apply: true });
  const data = f.app.missionStore.read();
  assert.equal(data.users.length, 1); assert.equal(data.teams.length, 1); assert.equal(Object.keys(data.workspace.projects).length, 1);
  assert.equal(first.projectId, 'quetzal1-eps-comms');
  assert.deepEqual(data.teams[0].memberIds, [data.users[0].memberId]); assert.equal(data.artifacts.length, 17);
  assert.equal(data.artifacts.filter(item => item.sourceRole === 'supporting_datasheet').length, 8);
  assert.equal(data.workspace.projects[first.projectId].document.engineeringSystem, undefined);
  const text = await readFile(first.credentialsFile, 'utf8'), password = /^Senha: (.+)$/mu.exec(text)[1];
  assert.ok(password.length >= 24); assert.equal(JSON.stringify(first).includes(password), false);
  assert.equal((await stat(first.credentialsFile)).mode & 0o777, 0o600);
  assert.equal((await stat(first.sessionFile)).mode & 0o777, 0o600);
  const second = await f.run({ apply: true });
  assert.equal(second.projectId, first.projectId); assert.equal(second.teamId, first.teamId);
  assert.equal(await readFile(first.credentialsFile, 'utf8'), text);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/api/artifacts').length, 17);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/api/auth/register').length, 1);
  assert.equal(f.app.missionStore.read().users.length, 1);
  await f.app.missionStore.update(current => { current.sessions = []; });
  await f.run({ apply: true });
  assert.equal(f.calls.filter(call => call.path === '/api/auth/login').length, 1, 'an expired session is renewed using the private saved password');
  await f.app.missionStore.update(current => { current.artifacts[0].url = 'data:text/plain;base64,' + Buffer.from('user correction').toString('base64'); });
  await assert.rejects(f.run({ apply: true }), /documento salvo foi alterado/u);
  assert.equal(f.app.missionStore.read().artifacts[0].url, 'data:text/plain;base64,' + Buffer.from('user correction').toString('base64'));
});

test('a pre-existing account is never reset, adopted or overwritten', async t => {
  const f = await fixture(t);
  const created = await f.app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...ACCOUNT, password: 'Existing account secret is preserved 2026' } });
  assert.equal(created.statusCode, 201);
  const before = f.app.missionStore.read().users[0];
  await assert.rejects(f.run({ apply: true }), error => error.status === 409);
  await assert.rejects(f.run({ apply: true }), error => error.status === 401);
  const after = f.app.missionStore.read();
  assert.deepEqual(after.users[0], before); assert.equal(after.users.length, 1); assert.equal(after.artifacts.length, 0);
});

test('when another account exists preparation creates only its own single team and project', async t => {
  const f = await fixture(t);
  await f.app.inject({ method: 'POST', url: '/api/auth/register', payload: { name: 'Other user', email: 'other@example.test', nickname: 'other_user', password: 'Other user passphrase preserved 2026' } });
  const before = f.app.missionStore.read(), first = await f.run({ apply: true });
  const after = f.app.missionStore.read();
  assert.equal(after.users.length, 2); assert.equal(after.teams.length, 2); assert.equal(Object.keys(after.workspace.projects).length, 2);
  assert.deepEqual(after.teams[0], before.teams[0]);
  assert.deepEqual(after.workspace.projects['quetzal1-eps-comms'], before.workspace.projects['quetzal1-eps-comms']);
  assert.notEqual(first.projectId, 'quetzal1-eps-comms');
  assert.equal(after.teams.find(team => team.id === first.teamId).memberIds.length, 1);
  await f.run({ apply: true });
  assert.equal(f.app.missionStore.read().teams.length, 2);
});

test('reviewed map preparation remaps by identity and verified bytes, rejects fabricated evidence and preserves existing maps', async t => {
  const f = await fixture(t), result = await f.run({ apply: true });
  const data = f.app.missionStore.read(), record = data.workspace.projects[result.projectId], corpus = await loadVerifiedCorpus(f.directory);
  const artifacts = data.artifacts.map(item => ({ ...item, verifiedBytes: Buffer.from(item.url.split(',')[1], 'base64') }));
  const model = {
    schemaVersion: 1, id: 'system-other', name: 'Map', model: 'test-only-model', generatedAt: new Date().toISOString(), generatedFromRevision: 1,
    entities: [{ id: 'satellite', name: 'Satellite', kind: 'system', description: 'Satellite sensor.', properties: [], source: 'documented', evidenceRefs: ['e-1'], confidence: 1 }],
    relations: [], requirements: [], evidence: [{ id: 'e-1', artifactId: 'demo-source-0', artifactLabel: 'Original label', excerpt: f.text, kind: 'fact' }],
    artifactSources: corpus.documents.map(({ source }) => ({ artifactId: 'demo-' + source.id, artifactLabel: source.title, status: 'parsed' }))
  };
  const input = { status: 'completed', result: model, report: { complete: true, documents: model.artifactSources.map(source => ({ artifactId: source.artifactId, complete: true })), omissions: [{ artifactId: 'demo-source-0', chunkId: 'demo-source-0', id: 'demo-source-0', kind: 'entity', reason: 'Review' }] }, progress: { coverage: 1 } };
  const payload = reviewedMapPayload(input, { project: record.document, revision: record.revision, artifacts, corpus });
  assert.equal(payload.applied, false); assert.equal(payload.target.requiresEmptyBaseline, true);
  assert.equal(payload.provenance.sources.length, 17);
  assert.equal(payload.project.engineeringSystem.evidence[0].artifactId, artifacts[0].id);
  assert.equal(payload.project.engineeringSystem.generatedFromRevision, record.document.memoryRevision);
  assert.deepEqual(payload.provenance.report.documents.map(item => item.artifactId), artifacts.map(item => item.id));
  assert.deepEqual(payload.provenance.report.omissions[0], { ...input.report.omissions[0], artifactId: artifacts[0].id }, 'only artifactId changes; chunk and entity identifiers retain their meaning');
  assert.equal(input.report.documents[0].artifactId, 'demo-source-0', 'the original report remains untouched');
  const unknownReport = structuredClone(input); unknownReport.report.omissions[0].artifactId = 'another-private-source';
  assert.throws(() => reviewedMapPayload(unknownReport, { project: record.document, revision: record.revision, artifacts, corpus }), /relatório aponta/u);
  assert.equal(f.app.missionStore.read().workspace.projects[result.projectId].document.engineeringSystem, undefined);
  const forged = structuredClone(input); forged.result.evidence[0].excerpt = 'Invented value 1000 V.';
  assert.throws(() => reviewedMapPayload(forged, { project: record.document, revision: record.revision, artifacts, corpus }), /could not be verified/u);
  assert.throws(() => reviewedMapPayload(input, { project: { ...record.document, engineeringSystem: model }, revision: record.revision, artifacts, corpus }), /já possui mapa/u);
  const tampered = artifacts.map((item, index) => index ? item : { ...item, verifiedBytes: Buffer.from('different source') });
  assert.throws(() => reviewedMapPayload(input, { project: record.document, revision: record.revision, artifacts: tampered, corpus }), /não corresponde/u);
  const file = join(f.rootDirectory, 'completed-map.json'); await writeFile(file, JSON.stringify(input));
  const prepared = await f.run({ apply: true, importReviewedMap: file });
  assert.equal(prepared.mapPayloadPrepared, true); assert.equal(prepared.mapApplied, false);
  assert.equal((await stat(join(f.rootDirectory, '.runtime/validation/reviewed-map-payload.json'))).mode & 0o777, 0o600);
});

async function publicationFixture(t) {
  const f = await fixture(t), prepared = await f.run({ apply: true });
  const session = JSON.parse(await readFile(prepared.sessionFile, 'utf8'));
  const data = f.app.missionStore.read(), record = data.workspace.projects[prepared.projectId], corpus = await loadVerifiedCorpus(f.directory);
  const artifacts = data.artifacts.map(item => ({ ...item, verifiedBytes: Buffer.from(item.url.split(',')[1], 'base64') }));
  const model = {
    schemaVersion: 1, id: 'system-other', name: 'Map', model: 'test-only-model', generatedAt: new Date().toISOString(), generatedFromRevision: 1,
    entities: [{ id: 'satellite', name: 'Satellite', kind: 'system', description: 'Satellite sensor.', properties: [], source: 'documented', evidenceRefs: ['e-1'], confidence: 1 }],
    relations: [], requirements: [], evidence: [{ id: 'e-1', artifactId: 'demo-source-0', artifactLabel: 'Original label', excerpt: f.text, kind: 'fact' }],
    artifactSources: corpus.documents.map(({ source }) => ({ artifactId: 'demo-' + source.id, artifactLabel: source.title, status: 'parsed' }))
  };
  const payload = reviewedMapPayload({ status: 'completed', result: model, report: { complete: true, documents: model.artifactSources.map(source => ({ artifactId: source.artifactId, complete: true })), omissions: [] }, progress: { coverage: 1 } }, { project: record.document, revision: record.revision, artifacts, corpus });
  return { ...f, data, record, corpus, payload, session };
}

test('offline publication refuses revision conflicts, invalid maps and changed files without modifying the store', async t => {
  const f = await publicationFixture(t);
  const variants = [
    payload => { payload.target.expectedRevision++; },
    payload => { payload.target.expectedMemoryRevision++; },
    payload => { payload.project.name = 'Forged change'; },
    payload => { payload.project.engineeringSystem.evidence[0].excerpt = 'Invented engineering value.'; },
    payload => { payload.project.engineeringSystem.entities[0].unknown = true; },
    payload => { payload.provenance.sources[0].textSha256 = '0'.repeat(64); },
    payload => { payload.provenance.report.complete = false; },
    payload => { payload.provenance.progress.coverage = .5; },
    payload => { payload.provenance.report.documents[0].artifactId = 'demo-source-0'; },
    payload => { payload.provenance.report.omissions = [{ artifactId: 'demo-source-0', id: 'entity-id' }]; }
  ];
  for (const modify of variants) {
    const payload = structuredClone(f.payload); modify(payload);
    await assert.rejects(commitPreparedPublication(f.app.missionStore, payload, f.session, f.corpus));
    assert.deepEqual(f.app.missionStore.read(), f.data);
  }
  await assert.rejects(commitPreparedPublication(f.app.missionStore, f.payload, f.session, f.corpus, async () => { throw new Error('External file changed'); }), /External file changed/u);
  assert.deepEqual(f.app.missionStore.read(), f.data);
  for (const modify of [
    data => { data.users[0].active = false; },
    data => { data.workspace.projects[f.session.projectId].createdBy = 'another-user'; },
    data => { data.teams[0].memberIds.push('another-member'); },
    data => { data.artifacts[0].url = 'data:text/plain;base64,' + Buffer.from('Changed bytes').toString('base64'); },
    data => { data.artifacts[0].sourceRole = 'supporting_datasheet'; },
    data => { data.workspace.projects[f.session.projectId].document.engineeringSystem = f.payload.project.engineeringSystem; }
  ]) {
    const data = structuredClone(f.data); modify(data);
    assert.throws(() => validatePreparedPublication(data, f.payload, f.session, f.corpus));
  }
});

test('offline publication changes only the reviewed blank project and refuses a second application', async t => {
  const f = await publicationFixture(t), before = f.app.missionStore.read();
  const result = await commitPreparedPublication(f.app.missionStore, f.payload, f.session, f.corpus);
  assert.equal(result.applied, true); assert.equal(result.revision, f.record.revision + 1); assert.equal(result.memoryRevision, f.record.document.memoryRevision);
  assert.equal(result.entities, 1); assert.equal(result.evidence, 1); assert.equal(result.providerCalls, 0);
  const current = f.app.missionStore.read(), record = current.workspace.projects[f.session.projectId];
  assert.deepEqual(current.users, before.users); assert.deepEqual(current.sessions, before.sessions); assert.deepEqual(current.artifacts, before.artifacts); assert.deepEqual(current.teams, before.teams);
  assert.equal(record.reviewedMapImport.appliedBy, f.session.user.id); assert.equal(record.reviewedMapImport.sources.length, 17);
  assert.equal(record.extractionReport.complete, true); assert.equal(record.extractionReport.progress.coverage, 1);
  assert.deepEqual(current.workspace.project, record);
  await assert.rejects(commitPreparedPublication(f.app.missionStore, f.payload, f.session, f.corpus), /já possui mapa/u);
});

test('offline publication rejects production, PostgreSQL and a different storage path', async t => {
  const root = await mkdtemp(join(tmpdir(), 'norte-offline-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  await assertLocalJsonConfiguration(root, {});
  for (const env of [{ DATABASE_URL: 'postgresql://localhost/test' }, { NODE_ENV: 'production' }, { NORTE_STORE_FILE: 'another.json' }, { PORT: '8001' }]) await assert.rejects(assertLocalJsonConfiguration(root, env));
  await writeFile(join(root, '.env'), 'DATABASE_URL=postgresql://localhost/test\n');
  await assert.rejects(assertLocalJsonConfiguration(root, {}), /JSON local/u);
});
