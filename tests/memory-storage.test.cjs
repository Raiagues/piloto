const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../memory-storage.js'), 'utf8');
function load(environment = {}) {
  const context = vm.createContext({ module: { exports: {} }, ...environment });
  vm.runInContext(source, context, { filename: 'memory-storage.js' });
  return context.module.exports;
}

test('unavailable IndexedDB fails clearly without accessing or clearing Web Storage', async () => {
  let touched = false;
  const storage = load({ localStorage: { clear() { touched = true; }, removeItem() { touched = true; } } });
  await assert.rejects(storage.open(), /dados anteriores foram preservados.*IndexedDB indisponível/);
  assert.equal(touched, false);
});

test('denied IndexedDB access retains its original cause and explains preservation', async () => {
  const cause = Object.assign(Error('Access denied by browser'), { name: 'SecurityError' });
  const storage = load({ indexedDB: { open() { throw cause; } } });
  await assert.rejects(storage.open(), error => {
    assert.equal(error.cause, cause);
    assert.match(error.message, /dados anteriores foram preservados/);
    return true;
  });
});

test('a blocked open rejects and closes a connection that succeeds only later', async () => {
  const request = {};
  const storage = load({ indexedDB: { open() { return request; } } });
  const opening = storage.open();
  request.onblocked();
  await assert.rejects(opening, /Outra aba.*Feche a aba antiga/);
  let closed = 0;
  request.result = { close() { closed++; } };
  request.onsuccess();
  assert.equal(closed, 1, 'a rejected open cannot leak a live connection that blocks later migrations');
});

test('a schema creation failure aborts the upgrade and retains its actual cause', async () => {
  const cause = Error('Browser denied creation'), request = {};
  let aborted = 0;
  const storage = load({ indexedDB: { open() { return request; } } });
  const opening = storage.open();
  request.result = { objectStoreNames: { contains() { return false; } }, createObjectStore() { throw cause; } };
  request.transaction = { abort() { aborted++; } };
  request.onupgradeneeded();
  await assert.rejects(opening, error => error.cause === cause);
  assert.equal(aborted, 1);
});
