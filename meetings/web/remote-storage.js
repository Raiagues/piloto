/* Meeting records saved in the signed-in account, with the same read/write/change
 * contract as NorteMemoryStorage. Writes to one key are serialized; a write that
 * has not started yet is replaced by a newer one. change() uses the server version
 * as a compare-and-swap, so two tabs never overwrite each other's meeting list.
 */
(function (root) {
  'use strict';
  const COMPRESS_FROM = 32 * 1024, KEEPALIVE_LIMIT = 60 * 1024;
  // versions: last server version per key. known: last value of keys updated through change().
  const versions = new Map(), known = new Map(), lanes = new Map();

  function validKey(key) {
    if (typeof key !== 'string' || !key) throw TypeError('A chave do armazenamento deve ser um texto não vazio.');
  }
  function validRaw(raw) {
    if (raw !== null && typeof raw !== 'string') throw TypeError('O registro do armazenamento deve ser texto ou null.');
  }
  async function failure(response) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) return Error('Sua sessão terminou. Entre novamente para continuar salvando na conta.');
    if (response.status === 413) return Error(body.error || 'Esta reunião ficou grande demais para salvar na conta.');
    return Error(body.error || 'Não foi possível salvar na sua conta. Confira a conexão.');
  }
  async function get(key) {
    const response = await fetch('/api/records?key=' + encodeURIComponent(key), { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw await failure(response);
    const body = await response.json();
    versions.set(key, body.version);
    if (known.has(key)) known.set(key, body.value);
    return body.value;
  }
  async function put(key, raw, expected) {
    const payload = JSON.stringify(expected === undefined ? { key, value: raw } : { key, value: raw, expected_version: expected });
    const headers = { 'Content-Type': 'application/json' };
    let body = payload;
    if (payload.length > COMPRESS_FROM && typeof root.CompressionStream === 'function') {
      body = await new Response(new Blob([payload]).stream().pipeThrough(new root.CompressionStream('gzip'))).blob();
      headers['Content-Encoding'] = 'gzip';
    }
    const size = typeof body === 'string' ? body.length : body.size;
    // keepalive lets the last save finish while the page closes; browsers cap it near 64 KB.
    const response = await fetch('/api/records', { method: 'POST', headers, body, credentials: 'same-origin', keepalive: size < KEEPALIVE_LIMIT });
    if (response.status === 409) {
      const current = await response.json();
      versions.set(key, current.version);
      return { conflict: true, raw: current.value };
    }
    if (!response.ok) throw await failure(response);
    versions.set(key, (await response.json()).version);
    return { conflict: false };
  }
  function lane(key) {
    if (!lanes.has(key)) lanes.set(key, { tail: Promise.resolve(), queued: null });
    return lanes.get(key);
  }
  function enqueue(key, task) {
    const current = lane(key);
    const run = current.tail.catch(() => {}).then(task);
    current.tail = run;
    return run;
  }

  function open() {
    const store = {
      read(key) {
        try { validKey(key); } catch (error) { return Promise.reject(error); }
        return enqueue(key, () => get(key));
      },
      write(key, raw) {
        try { validKey(key); validRaw(raw); } catch (error) { return Promise.reject(error); }
        const current = lane(key);
        if (current.queued) { current.queued.raw = raw; return current.queued.done; }
        const job = { raw };
        current.queued = job;
        job.done = enqueue(key, async () => {
          if (current.queued === job) current.queued = null;
          known.delete(key);
          await put(key, job.raw);
        });
        return job.done;
      },
      change(key, mutator) {
        try { validKey(key); } catch (error) { return Promise.reject(error); }
        if (typeof mutator !== 'function') return Promise.reject(TypeError('A alteração do armazenamento requer uma função.'));
        return enqueue(key, async () => {
          let raw = known.has(key) ? known.get(key) : await get(key);
          for (let attempt = 0; attempt < 6; attempt++) {
            const next = mutator(raw);
            if (!next || typeof next !== 'object' || typeof next.then === 'function' || !Object.prototype.hasOwnProperty.call(next, 'value')) {
              throw TypeError('A alteração deve retornar { value, result } de forma síncrona.');
            }
            validRaw(next.value);
            if (next.value === raw) return next.result;
            const saved = await put(key, next.value, versions.get(key) || 0);
            if (!saved.conflict) { known.set(key, next.value); return next.result; }
            raw = saved.raw; known.set(key, raw);
          }
          throw Error('A lista de reuniões mudou em outra aba ao mesmo tempo. Tente novamente.');
        });
      },
      subscribe() { return () => {}; },
      close() {}
    };
    return Promise.resolve(store);
  }
  root.NorteRemoteStorage = { open };
})(typeof globalThis !== 'undefined' ? globalThis : this);
