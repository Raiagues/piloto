/* Large memory snapshots belong in IndexedDB, outside the Web Storage quota.
 * Values stay as their original JSON strings: this layer never drops audit data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NorteMemoryStorage = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const DATABASE = 'norte-memory', STORE = 'records', CHANNEL = 'norte-memory:changes';
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function validKey(key) {
    if (typeof key !== 'string' || !key) throw TypeError('A chave do armazenamento deve ser um texto não vazio.');
  }
  function validRaw(raw) {
    if (raw !== null && typeof raw !== 'string') throw TypeError('O registro do armazenamento deve ser texto ou null.');
  }
  function openError(cause) {
    return new Error('Não foi possível abrir o armazenamento de memória neste navegador. Os dados anteriores foram preservados. ' +
      (cause?.message || 'O acesso ao IndexedDB está indisponível.'), { cause });
  }

  function connect(db) {
    let closed = false, channel = null;
    const listeners = new Set();
    function emit(key) {
      for (const listener of [...listeners]) {
        // Observers cannot undo a committed transaction or prevent its caller
        // from receiving completion. Report their errors independently.
        try { listener(key); }
        catch (error) { root.console?.error('Falha ao atualizar uma visualização da memória salva.', error); }
      }
    }
    try {
      if (typeof root.BroadcastChannel === 'function') {
        channel = new root.BroadcastChannel(CHANNEL);
        channel.onmessage = event => {
          if (!closed && typeof event.data?.key === 'string') emit(event.data.key);
        };
      }
    } catch (_) { /* Transactions remain safe even when cross-tab notices are unavailable. */ }
    function committed(key) {
      emit(key);
      try { channel?.postMessage({ key }); }
      catch (_) { /* The data is already committed; notification is best effort. */ }
    }
    function transaction(mode, key, operation) {
      return new Promise((resolve, reject) => {
        let tx, result, changed = false, failure = null;
        try {
          validKey(key);
          if (closed) throw Error('O armazenamento de memória foi fechado. Recarregue a página antes de salvar novamente.');
          tx = db.transaction(STORE, mode);
          tx.oncomplete = () => {
            resolve(result);
            if (changed) committed(key);
          };
          tx.onabort = () => reject(failure || tx.error || Error('A gravação da memória foi interrompida. Nenhum dado desta transação foi alterado.'));
          tx.onerror = () => { failure ||= tx.error; };
          const objectStore = tx.objectStore(STORE), request = objectStore.get(key);
          request.onerror = () => { failure ||= request.error; };
          request.onsuccess = () => {
            try {
              const raw = request.result === undefined ? null : request.result;
              validRaw(raw);
              const next = operation(raw);
              result = next.result;
              if (mode === 'readwrite') {
                validRaw(next.value);
                if (raw !== next.value) {
                  const write = next.value === null ? objectStore.delete(key) : objectStore.put(next.value, key);
                  write.onerror = () => { failure ||= write.error; };
                  changed = true;
                }
              }
            } catch (error) {
              failure = error;
              try { tx.abort(); } catch (_) { reject(failure); }
            }
          };
        } catch (error) {
          failure = error;
          if (tx) {
            try { tx.abort(); } catch (_) { reject(error); }
          } else reject(error);
        }
      });
    }
    const store = {
      read(key) { return transaction('readonly', key, raw => ({ result: raw })); },
      change(key, mutator) {
        return transaction('readwrite', key, raw => {
          if (typeof mutator !== 'function') throw TypeError('A alteração do armazenamento requer uma função.');
          const next = mutator(raw);
          if (!next || typeof next !== 'object' || typeof next.then === 'function' || !has(next, 'value')) {
            throw TypeError('A alteração deve retornar { value, result } de forma síncrona.');
          }
          return next;
        });
      },
      async write(key, raw) { await store.change(key, () => ({ value: raw })); },
      compareAndSwap(key, expectedRaw, nextRaw) {
        return store.change(key, raw => {
          validRaw(expectedRaw); validRaw(nextRaw);
          return raw === expectedRaw ? { value: nextRaw, result: true } : { value: raw, result: false };
        });
      },
      async migrate(key, legacyStorage, validateRaw) {
        validKey(key);
        if (!legacyStorage || typeof legacyStorage.getItem !== 'function' || typeof legacyStorage.removeItem !== 'function') {
          throw TypeError('O armazenamento anterior não está disponível para migração.');
        }
        if (typeof validateRaw !== 'function') throw TypeError('A migração requer validação dos dados anteriores.');
        const legacy = legacyStorage.getItem(key);
        validRaw(legacy);
        if (legacy !== null) validateRaw(legacy);
        const migrated = await store.change(key, current => {
          if (current !== null) validateRaw(current);
          if (current !== null && legacy !== null && current !== legacy) {
            throw Error('Há duas versões diferentes da memória salva em ' + key + '. Ambas foram preservadas; a migração não substituiu nenhuma delas.');
          }
          const value = current === null ? legacy : current;
          return { value, result: value };
        });
        // Removal happens only after IndexedDB confirms the whole transaction.
        // A concurrent legacy tab may have changed its value in the meantime.
        const latestLegacy = legacyStorage.getItem(key);
        if (latestLegacy !== legacy) {
          throw Error('O registro anterior de ' + key + ' mudou durante a migração. A cópia já migrada e o registro anterior foram preservados; nenhuma versão foi substituída.');
        }
        if (legacy !== null) legacyStorage.removeItem(key);
        return migrated;
      },
      subscribe(listener) {
        if (typeof listener !== 'function') throw TypeError('O observador do armazenamento deve ser uma função.');
        if (closed) throw Error('O armazenamento de memória foi fechado.');
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {
        if (closed) return;
        closed = true; listeners.clear();
        channel?.close(); db.close();
      }
    };
    db.onversionchange = () => store.close();
    return store;
  }

  function open() {
    return new Promise((resolve, reject) => {
      let request, settled = false;
      const fail = error => { if (!settled) { settled = true; reject(openError(error)); } };
      try {
        if (!root.indexedDB || typeof root.indexedDB.open !== 'function') throw Error('IndexedDB indisponível.');
        request = root.indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          try {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
          } catch (error) {
            fail(error);
            try { request.transaction.abort(); } catch (_) { /* Failed upgrade is already closed. */ }
          }
        };
        request.onerror = () => fail(request.error);
        request.onblocked = () => fail(Error('Outra aba está impedindo a atualização do armazenamento. Feche a aba antiga e tente novamente.'));
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          try {
            const store = connect(request.result);
            settled = true; resolve(store);
          } catch (error) { request.result.close(); fail(error); }
        };
      } catch (error) { fail(error); }
    });
  }
  return { open };
});
