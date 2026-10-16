/** PostgreSQL persistence codec; legacy JSON is still the default write format.
 * Version 1 expands to a stream of JSON records, not one giant JSON string.
 * Each record is parsed with native JSON.parse. The 128 MiB limit and SHA-256
 * cover the exact UTF-8 record stream (including framing), not JSON.stringify
 * of the reconstructed state. Strings are segmented; containers are rebuilt
 * with own data properties, including harmless literal __proto__ keys.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createGzip, createGunzip } from 'node:zlib';

const FORMAT = 'norte-postgres-state', ENCODING = 'gzip+base64+json-records';
export const POSTGRES_STATE_MAX_BYTES = 128 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = POSTGRES_STATE_MAX_BYTES + 1024 * 1024;
const MAX_RECORD_BYTES = 512 * 1024, MAX_KEY_LENGTH = 64 * 1024, MAX_DEPTH = 512;
const ENVELOPE_KEYS = new Set(['format', 'version', 'encoding', 'uncompressedBytes', 'sha256', 'payload']);
function invalid(message = 'Invalid PostgreSQL state encoding.') {
  return Object.assign(new Error(message), { code: 'POSTGRES_STATE_CODEC_INVALID' });
}
function tooLarge() {
  return Object.assign(new Error('PostgreSQL state exceeds the 128 MiB uncompressed record limit.'), { code: 'POSTGRES_STATE_LIMIT_EXCEEDED' });
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validateState(value) {
  if (!record(value) || !Number.isInteger(value.schemaVersion) || value.schemaVersion < 1 || value.schemaVersion > 10
    || !Array.isArray(value.users) || !Array.isArray(value.members) || !Array.isArray(value.artifacts)) throw invalid('Unsupported PostgreSQL state schema.');
  return value;
}
/** Identifies the envelope, not its validity; decode always validates it. */
export function isEncodedPostgresState(value) {
  return record(value) && Object.hasOwn(value, 'format') && value.format === FORMAT;
}

// Persisted state is JSON data. Also retain native JSON semantics for Date,
// standard primitive wrappers, toJSON(key), undefined and nonfinite numbers.
function jsonValue(value, key) {
  if (value !== null && (typeof value === 'object' || typeof value === 'function' || typeof value === 'bigint')) {
    const toJSON = value.toJSON;
    if (typeof toJSON === 'function') value = toJSON.call(value, key);
  }
  if (value !== null && typeof value === 'object') {
    if (value instanceof Number) return Number(value);
    if (value instanceof String) return String(value);
    if (value instanceof Boolean) return Boolean.prototype.valueOf.call(value);
    if (Object.getPrototypeOf(value) === BigInt.prototype) return BigInt.prototype.valueOf.call(value);
  }
  return value;
}
function omitted(value) { return value === undefined || typeof value === 'function' || typeof value === 'symbol'; }
function* segments(value) {
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 32 * 1024, value.length);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff
      && value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end--;
    yield value.slice(start, end); start = end;
  }
}
function* records(value, key, ancestors) {
  if (typeof key === 'string' && key.length > MAX_KEY_LENGTH) throw invalid('PostgreSQL state contains an oversized key.');
  if (typeof value === 'string') {
    if (ancestors.size >= MAX_DEPTH) throw invalid('PostgreSQL state exceeds the nesting limit.');
    yield ['string', key]; for (const part of segments(value)) yield ['part', part]; yield ['end']; return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') { yield ['value', key, value]; return; }
  if (typeof value === 'bigint' || omitted(value) || ancestors.has(value) || ancestors.size >= MAX_DEPTH) throw invalid('PostgreSQL state is not serializable JSON.');
  ancestors.add(value);
  if (Array.isArray(value)) {
    yield ['array', key]; const length = value.length;
    for (let index = 0; index < length; index++) {
      const item = jsonValue(value[index], String(index));
      yield* records(omitted(item) ? null : item, index, ancestors);
    }
  } else {
    yield ['object', key];
    for (const name of Object.keys(value)) {
      const item = jsonValue(value[name], name); if (!omitted(item)) yield* records(item, name, ancestors);
    }
  }
  yield ['end']; ancestors.delete(value);
}
async function compressState(data) {
  const hash = createHash('sha256'); let size = 0, compressedSize = 0, chunks = [];
  function* buffers() {
    const value = jsonValue(data, ''); validateState(value);
    let pending = '["norte-json-records",1]\n';
    for (const item of records(value, null, new Set())) {
      const line = JSON.stringify(item) + '\n';
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw invalid('PostgreSQL state record is too large.');
      pending += line;
      if (pending.length >= 64 * 1024) { const bytes = Buffer.from(pending, 'utf8'); size += bytes.length; if (size > POSTGRES_STATE_MAX_BYTES) throw tooLarge(); hash.update(bytes); yield bytes; pending = ''; }
    }
    if (pending) { const bytes = Buffer.from(pending, 'utf8'); size += bytes.length; if (size > POSTGRES_STATE_MAX_BYTES) throw tooLarge(); hash.update(bytes); yield bytes; }
  }
  try {
    await pipeline(Readable.from(buffers(), { objectMode: false }), createGzip({ level: constants.Z_BEST_SPEED }), new Writable({
      write(chunk, _encoding, callback) {
        compressedSize += chunk.length;
        if (compressedSize > MAX_COMPRESSED_BYTES) { callback(tooLarge()); return; }
        chunks.push(chunk); callback();
      }
    }));
  } catch (error) {
    if (error?.code === 'POSTGRES_STATE_LIMIT_EXCEEDED' || error?.code === 'POSTGRES_STATE_CODEC_INVALID') throw error;
    throw invalid('PostgreSQL state is not serializable JSON.');
  }
  const compressed = Buffer.concat(chunks, compressedSize); chunks = [];
  return { format: FORMAT, version: 1, encoding: ENCODING, uncompressedBytes: size,
    sha256: hash.digest('hex'), payload: compressed.toString('base64') };
}

function recordReader() {
  let header = false, root, rootSet = false; const stack = [], strings = new Map();
  // Public demo corpora repeat across sandboxes. Strings are immutable, so
  // equal long values can share one allocation without sharing mutable state
  // or crossing an authorization boundary. The table exists for this decode
  // only and is released before returning the reconstructed state.
  function sharedString(parts) {
    const value = parts.join(''); if (value.length < 1024) return value;
    const existing = strings.get(value); if (existing !== undefined) return existing;
    strings.set(value, value); return value;
  }
  function attach(key, value) {
    if (!stack.length) {
      if (rootSet || key !== null) throw invalid(); root = value; rootSet = true; return;
    }
    const parent = stack.at(-1);
    if (parent.kind === 'array') {
      if (!Number.isSafeInteger(key) || key !== parent.value.length) throw invalid(); parent.value.push(value);
    } else if (parent.kind === 'object') {
      if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH || Object.hasOwn(parent.value, key)) throw invalid();
      Object.defineProperty(parent.value, key, { value, enumerable: true, writable: true, configurable: true });
    } else throw invalid();
  }
  return {
    line(line) {
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) throw invalid();
      const item = JSON.parse(line);
      if (!Array.isArray(item)) throw invalid();
      if (!header) { if (item.length !== 2 || item[0] !== 'norte-json-records' || item[1] !== 1) throw invalid(); header = true; return; }
      if (rootSet && !stack.length) throw invalid('PostgreSQL state has trailing records.');
      const [kind, key, value] = item;
      if (kind === 'end') {
        if (item.length !== 1 || !stack.length) throw invalid();
        const frame = stack.pop(); if (frame.kind === 'string') attach(frame.key, sharedString(frame.parts));
      } else if (kind === 'part') {
        if (item.length !== 2 || typeof key !== 'string' || stack.at(-1)?.kind !== 'string') throw invalid(); stack.at(-1).parts.push(key);
      } else if (kind === 'value') {
        if (item.length !== 3 || (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value)))) throw invalid(); attach(key, value);
      } else if (kind === 'object' || kind === 'array' || kind === 'string') {
        if (item.length !== 2 || stack.length >= MAX_DEPTH || stack.at(-1)?.kind === 'string') throw invalid();
        if (kind === 'string') stack.push({ kind, key, parts: [] });
        else { const container = kind === 'array' ? [] : {}; attach(key, container); stack.push({ kind, value: container }); }
      } else throw invalid();
    },
    finish() { if (!header || !rootSet || stack.length) throw invalid('PostgreSQL state has incomplete records.'); strings.clear(); return validateState(root); }
  };
}

export async function decodePostgresState(value) {
  if (!isEncodedPostgresState(value)) return validateState(value);
  if (value.version !== 1 || value.encoding !== ENCODING
    || Object.keys(value).some(key => !ENVELOPE_KEYS.has(key))
    || !Number.isSafeInteger(value.uncompressedBytes) || value.uncompressedBytes < 1
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || typeof value.payload !== 'string' || !value.payload.length) throw invalid();
  if (value.uncompressedBytes > POSTGRES_STATE_MAX_BYTES) throw tooLarge();
  if (value.payload.length > Math.ceil(MAX_COMPRESSED_BYTES / 3) * 4
    || value.payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value.payload)) throw invalid();
  const compressed = Buffer.from(value.payload, 'base64');
  if (compressed.length > MAX_COMPRESSED_BYTES || compressed.toString('base64') !== value.payload) throw invalid();
  const reader = recordReader(), decoder = new TextDecoder('utf-8', { fatal: true }), hash = createHash('sha256');
  let size = 0, pending = '';
  function consume(chunk) {
    size += chunk.length; if (size > value.uncompressedBytes || size > POSTGRES_STATE_MAX_BYTES) throw invalid('PostgreSQL state exceeds its declared size.');
    hash.update(chunk); pending += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = pending.indexOf('\n')) !== -1) { reader.line(pending.slice(0, end)); pending = pending.slice(end + 1); }
    if (Buffer.byteLength(pending) > MAX_RECORD_BYTES) throw invalid('PostgreSQL state record is too large.');
  }
  try {
    await pipeline(Readable.from([compressed], { objectMode: false }), createGunzip(), new Writable({
      write(chunk, _encoding, callback) { try { consume(chunk); callback(); } catch (error) { callback(error); } }
    }));
    pending += decoder.decode();
    if (pending || size !== value.uncompressedBytes || !timingSafeEqual(hash.digest(), Buffer.from(value.sha256, 'hex'))) throw invalid('PostgreSQL state integrity check failed.');
    return reader.finish();
  } catch (error) {
    if (error?.code === 'POSTGRES_STATE_CODEC_INVALID') throw error;
    throw invalid('PostgreSQL state could not be decoded.');
  }
}

export async function encodePostgresState(data, { compress = false } = {}) {
  if (isEncodedPostgresState(data)) { await decodePostgresState(data); return data; }
  validateState(data);
  return compress ? compressState(data) : data;
}
