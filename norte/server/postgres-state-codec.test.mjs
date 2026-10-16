import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createInitialData } from './data-store.mjs';
import { decodePostgresState, encodePostgresState, isEncodedPostgresState, POSTGRES_STATE_MAX_BYTES, POSTGRES_STATE_MAX_STRING_BYTES } from './postgres-state-codec.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function envelope(bytes, version = 1) {
  return { format: 'norte-postgres-state', version, encoding: 'gzip+base64+json-records', uncompressedBytes: bytes.length,
    sha256: digest(bytes), payload: gzipSync(bytes).toString('base64') };
}
function fixture() {
  const state = createInitialData(), bytes = Buffer.from('Documentação: tensão 3,3 V; revisão α; órbita → 500 km.\n'.repeat(4000));
  state.artifacts.push({ id: 'document-1', ownerId: 'project-1', scope: 'project', documentText: bytes.toString('utf8'), url: `data:text/plain;base64,${bytes.toString('base64')}` });
  state.users.push({ id: 'user-1', name: 'Synthetic user', active: true });
  state.sessions.push({ userId: 'user-1', id: 'synthetic-session', expiresAt: 123456789 });
  state.authBootstrap = { completedAt: '2026-01-01T00:00:00.000Z', userId: 'user-1' };
  return state;
}

test('legacy reads and default writes retain the exact state without changing historical schema', async () => {
  for (const schemaVersion of [1, 5, 10]) {
    const state = fixture(); state.schemaVersion = schemaVersion;
    const before = structuredClone(state);
    assert.equal(isEncodedPostgresState(state), false);
    assert.strictEqual(await decodePostgresState(state), state);
    assert.strictEqual(await encodePostgresState(state), state);
    assert.strictEqual(await encodePostgresState(state, { compress: false }), state);
    assert.deepEqual(state, before);
  }
});

test('compressed round-trip preserves every field, document byte hash and session/bootstrap metadata', async () => {
  const state = fixture(), before = structuredClone(state);
  const encoded = await encodePostgresState(state, { compress: true });
  assert.equal(isEncodedPostgresState(encoded), true);
  assert.equal(encoded.version, 1);
  const stream = gunzipSync(Buffer.from(encoded.payload, 'base64'));
  assert.equal(encoded.uncompressedBytes, stream.length);
  assert.equal(encoded.sha256, digest(stream));
  assert(Buffer.byteLength(JSON.stringify(encoded)) < encoded.uncompressedBytes / 4);
  const decoded = await decodePostgresState(encoded);
  assert.notStrictEqual(decoded, state);
  assert.deepEqual(decoded, before);
  for (const artifact of decoded.artifacts) {
    const original = before.artifacts.find(item => item.id === artifact.id);
    assert.equal(digest(artifact.documentText), digest(original.documentText));
    assert.equal(digest(artifact.url), digest(original.url));
  }
  assert.deepEqual(state, before);
  assert.strictEqual(await encodePostgresState(encoded, { compress: false }), encoded, 'a compatible reader never downgrades an already compressed envelope');
});

test('unsupported versions, encodings, malformed base64 and inaccurate size/hash fail closed', async () => {
  const valid = await encodePostgresState(fixture(), { compress: true });
  const bad = [
    { version: 2 }, { version: 3 }, { encoding: 'brotli' }, { extra: 'unrecognized envelope field' },
    { uncompressedBytes: -1 }, { uncompressedBytes: 1.5 }, { uncompressedBytes: '100' },
    { uncompressedBytes: valid.uncompressedBytes + 1 }, { uncompressedBytes: valid.uncompressedBytes - 1 },
    { sha256: '0'.repeat(64) }, { sha256: 'secret-not-a-hash' },
    { payload: valid.payload + '\n' }, { payload: '%%%=' }, { payload: 'AB==' }, { payload: '' }
  ];
  for (const patch of bad) await assert.rejects(decodePostgresState({ ...valid, ...patch }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  await assert.rejects(encodePostgresState({ ...valid, version: 2 }, { compress: false }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
});

test('v2 string references are opt-in, byte-preserving and never share mutable objects', async () => {
  const state = fixture(), original = state.artifacts[0];
  state.artifacts = Array.from({ length: 5 }, (_, index) => ({ ...original, id: `document-${index}`, ownerId: `project-${index}`, nested: { title: `Independent ${index}` } }));
  state.extra = { unicode: '界🛰'.repeat(800), sameUnicode: '界🛰'.repeat(800), keys: JSON.parse('{"__proto__":"literal"}') };
  const before = structuredClone(state), v1 = await encodePostgresState(state, { compress: true });
  assert.strictEqual(await encodePostgresState(state, { compactStrings: true }), state);
  assert.equal(v1.version, 1);
  const v2 = await encodePostgresState(state, { compress: true, compactStrings: true });
  assert.equal(v2.version, 2);
  const rows = gunzipSync(Buffer.from(v2.payload, 'base64')).toString('utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows[0], ['norte-json-records', 2]);
  assert(rows.some(row => row[0] === 'ref'));
  assert.deepEqual(rows.filter(row => row[0] === 'string' && row.length === 3).map(row => row[2]), [0, 1, 2]);
  assert(v2.uncompressedBytes < v1.uncompressedBytes / 2);
  assert(Buffer.byteLength(JSON.stringify(v2)) < Buffer.byteLength(JSON.stringify(v1)));
  const decoded = await decodePostgresState(v2);
  assert.deepEqual(decoded, before);
  assert.equal(digest(JSON.stringify(decoded)), digest(JSON.stringify(await decodePostgresState(v1))));
  assert.notStrictEqual(decoded.artifacts[0], decoded.artifacts[1]);
  assert.notStrictEqual(decoded.artifacts[0].nested, decoded.artifacts[1].nested);
  decoded.artifacts[0].nested.title = 'Edited only first document';
  assert.equal(decoded.artifacts[1].nested.title, 'Independent 1');
  assert.deepEqual(state, before);
  assert.strictEqual(await encodePostgresState(v2, { compress: false, compactStrings: false }), v2);
  assert.strictEqual(await encodePostgresState(v1, { compress: true, compactStrings: true }), v1, 'already encoded values retain their validated format');
});

test('v2 rejects incomplete, forward, duplicate and invalid string references and mismatched headers', async () => {
  const prefix = [['norte-json-records', 2], ['object', null], ['value', 'schemaVersion', 10], ['array', 'users'], ['end'], ['array', 'members'], ['end'], ['array', 'artifacts'], ['end']];
  const registered = [['string', 'first', 0], ['part', 'a'.repeat(1024)], ['end']];
  const pack = (rows, version = 2) => envelope(Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'), version);
  const invalidRows = [
    [...prefix, ['ref', 'forward', 0], ...registered, ['end']],
    [...prefix, ['string', 'first', 0], ['ref', 'self', 0], ['end'], ['end']],
    [...prefix, ...registered, ['string', 'duplicateId', 0], ['part', 'different'], ['end'], ['end']],
    [...prefix, ...registered, ['string', 'duplicateValue', 1], ['part', 'a'.repeat(1024)], ['end'], ['end']],
    [...prefix, ...registered, ['string', 'gap', 2], ['part', 'different'], ['end'], ['end']],
    [...prefix, ...registered, ['string', 'open', 1], ['ref', 'insideString', 0], ['end'], ['end']],
    [...prefix, ...registered, ['ref', 'second', 0], ['ref', 'notRegisteredByRef', 1], ['end']],
    [...prefix, ['string', 'first', 0], ['part', 'incomplete']],
    [...prefix, ...registered, ['end'], ['ref', null, 0]],
    ...[-1, '0', 0.5, null, {}, [], 1].map(id => [...prefix, ...registered, ['ref', 'invalid', id], ['end']]),
    ...[-1, '0', 0.5, null, {}, [], 1].map(id => [...prefix, ['string', 'invalid', id], ['part', 'value'], ['end'], ['end']])
  ];
  for (const rows of invalidRows) await assert.rejects(decodePostgresState(pack(rows)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  await assert.rejects(decodePostgresState(pack([...prefix, ...registered, ['end']], 1)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  const v1Header = [...prefix]; v1Header[0] = ['norte-json-records', 1];
  await assert.rejects(decodePostgresState(pack([...v1Header, ['end']], 2)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  await assert.rejects(decodePostgresState(pack([...v1Header, ...registered, ['end']], 1)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  await assert.rejects(decodePostgresState(pack([...v1Header, ['ref', 'missing', 0], ['end']], 1)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
});

test('v2 bounds UTF-8 expansion even when a small stream repeats one immutable value many times', async () => {
  const text = '界'.repeat(32768), copies = Math.floor(POSTGRES_STATE_MAX_STRING_BYTES / Buffer.byteLength(text)) + 1;
  const state = createInitialData(); state.repeated = Array.from({ length: copies }, () => text);
  await assert.rejects(encodePostgresState(state, { compress: true, compactStrings: true }), { code: 'POSTGRES_STATE_LIMIT_EXCEEDED' });
  const rows = [['norte-json-records', 2], ['object', null], ['value', 'schemaVersion', 10], ['array', 'users'], ['end'], ['array', 'members'], ['end'], ['array', 'artifacts'], ['end'], ['array', 'repeated'], ['string', 0, 0], ['part', text], ['end'], ...Array.from({ length: copies - 1 }, (_, index) => ['ref', index + 1, 0]), ['end'], ['end']];
  const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  assert(bytes.length < POSTGRES_STATE_MAX_BYTES / 100);
  await assert.rejects(decodePostgresState(envelope(bytes, 2)), { code: 'POSTGRES_STATE_LIMIT_EXCEEDED' });
});

test('truncated, corrupt and misleading gzip streams are rejected before returning a state', async () => {
  const valid = await encodePostgresState(fixture(), { compress: true }), bytes = Buffer.from(valid.payload, 'base64');
  await assert.rejects(decodePostgresState({ ...valid, payload: bytes.subarray(0, bytes.length - 5).toString('base64') }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  const corrupt = Buffer.from(bytes); corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
  await assert.rejects(decodePostgresState({ ...valid, payload: corrupt.toString('base64') }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  // The small declared bound stops expansion early rather than allocating the
  // global limit, even if the compressed stream would produce much more.
  const bomb = envelope(Buffer.alloc(1024 * 1024, 'x')); bomb.uncompressedBytes = 1024;
  await assert.rejects(decodePostgresState(bomb), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  await assert.rejects(decodePostgresState({ ...valid, uncompressedBytes: POSTGRES_STATE_MAX_BYTES + 1 }), { code: 'POSTGRES_STATE_LIMIT_EXCEEDED' });
});

test('a correct hash cannot make invalid UTF-8, invalid JSON or an unsupported state schema acceptable', async () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from('{'), Buffer.from('null'), Buffer.from('[]'), Buffer.from('{"schemaVersion":99,"users":[],"members":[],"artifacts":[]}')]) {
    await assert.rejects(decodePostgresState(envelope(bytes)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  }
  for (const state of [null, [], {}, { schemaVersion: 10, users: [], members: [] }]) {
    await assert.rejects(decodePostgresState(state), { code: 'POSTGRES_STATE_CODEC_INVALID' });
    await assert.rejects(encodePostgresState(state, { compress: true }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  }
  const circular = fixture(); circular.self = circular;
  await assert.rejects(encodePostgresState(circular, { compress: true }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
});

test('segmented JSON retains native value semantics, key order, surrogates and safe own properties', async () => {
  const state = fixture(), shared = { retained: true };
  state.extra = {
    absent: undefined, absentSymbol: Symbol('not stored'), absentFunction: () => {},
    list: [undefined, undefined, NaN, Infinity, -Infinity, -0, Symbol('null in array'), () => {}],
    number: Object(3), boolean: Object(false), string: Object('wrapped'),
    date: new Date('2026-01-01T00:00:00.000Z'),
    custom: { toJSON(key) { return `converted ${key}`; } },
    shared1: shared, shared2: shared,
    escaped: 'x'.repeat(32767) + '🛰️' + '\ud800' + '\udfff' + '"\\\n\t\u0000'.repeat(10000),
    properties: JSON.parse('{"__proto__":{"polluted":true},"constructor":"literal","prototype":"literal","2":"second","1":"first"}')
  };
  delete state.extra.list[0]; // An actual sparse slot, without a sparse literal.
  const expected = JSON.parse(JSON.stringify(state)), decoded = await decodePostgresState(await encodePostgresState(state, { compress: true }));
  assert.deepEqual(decoded, expected);
  assert.equal(JSON.stringify(decoded), JSON.stringify(expected));
  assert.equal(Object.hasOwn(decoded.extra.properties, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(decoded.extra.properties), Object.prototype);
  assert.equal(Object.prototype.polluted, undefined);
  state.extra.bigint = 1n;
  await assert.rejects(encodePostgresState(state, { compress: true }), { code: 'POSTGRES_STATE_CODEC_INVALID' });
});

test('record reconstruction rejects duplicate keys, array gaps, trailing records, bad containers and excess depth', async () => {
  const prefix = [['norte-json-records', 1], ['object', null], ['value', 'schemaVersion', 10], ['array', 'users'], ['end'], ['array', 'members'], ['end'], ['array', 'artifacts'], ['end']];
  const pack = rows => envelope(Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n'));
  const invalidRecords = [
    [...prefix, ['value', 'schemaVersion', 10], ['end']],
    [...prefix, ['array', 'extra'], ['value', 1, null], ['end'], ['end']],
    [...prefix, ['array', 'extra'], ['value', '0', null], ['end'], ['end']],
    [...prefix, ['value', 0, null], ['end']],
    [...prefix, ['value', 'extra', {}], ['end']],
    [...prefix, ['part', 'outside string'], ['end']],
    [...prefix, ['string', 'extra'], ['object', 'nested'], ['end'], ['end']],
    [...prefix, ['end', 'object']],
    [...prefix, ['end'], ['value', null, null]],
    [...prefix],
    [['norte-json-records', 2], ['object', null], ['end']],
    [...prefix, ...Array.from({ length: 513 }, () => ['object', 'nested']), ...Array.from({ length: 514 }, () => ['end'])]
  ];
  for (const rows of invalidRecords) await assert.rejects(decodePostgresState(pack(rows)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  const wrongSchema = [...prefix, ['end']]; wrongSchema[2] = ['value', 'schemaVersion', 99];
  await assert.rejects(decodePostgresState(pack(wrongSchema)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
  const noNewline = Buffer.from(prefix.map(row => JSON.stringify(row)).join('\n'));
  await assert.rejects(decodePostgresState(envelope(noNewline)), { code: 'POSTGRES_STATE_CODEC_INVALID' });
});
