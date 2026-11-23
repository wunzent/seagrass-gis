import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const create = async () => {
  assert.ok(
    existsSync(new URL('../src/stores/resource-store.ts', import.meta.url)),
    'resource slice must belong to a store',
  );
  return (await import('../src/stores/resource-store.ts')).createResourceStore();
};
const context = (extra = {}) => ({
  authenticated: false,
  isCurrent: () => true,
  unauthorized: () => {},
  isUnauthorized: () => false,
  ...extra,
});
test('resource store isolates mounts and rejects stale keys, retries, aborts and generations', async () => {
  const store = await create(),
    other = await create();
  const a = deferred(),
    b = deferred();
  let signal;
  const first = store.identity('/a', 0, 1);
  const cancel = store.load(
    first,
    (s) => {
      signal = s;
      return a.promise;
    },
    context(),
  );
  const second = store.identity('/b', 0, 1);
  store.load(second, () => b.promise, context());
  assert.equal(signal.aborted, true);
  a.resolve({ old: true });
  b.resolve({ fresh: true });
  await b.promise;
  await Promise.resolve();
  assert.deepEqual(store.read(second, true, () => true).data, { fresh: true });
  assert.equal(store.read(first, true, () => true).data, undefined);
  assert.equal(other.getSnapshot(), undefined);
  cancel();
  assert.equal(store.read(second, true, () => false).data, undefined);
  const retry = store.identity('/b', 1, 1);
  assert.notEqual(retry, second);
  assert.equal(store.read(retry, true, () => true).loading, true);
  const generation = store.identity('/b', 1, 2);
  assert.notEqual(generation, retry);
  const late = deferred();
  let current = true;
  store.load(generation, () => late.promise, context({ isCurrent: () => current }));
  current = false;
  late.resolve({ private: true });
  await late.promise;
  await Promise.resolve();
  assert.equal(store.read(generation, true, () => true).data, undefined);
});
test('resource publication strips anonymous creator data and keeps authenticated 401 distinct', async () => {
  const store = await create();
  let changes = 0;
  store.subscribe(() => changes++);
  const id = store.identity('/a', 0, 1);
  store.load(id, async () => ({ items: [{ created_by: { email: 'private' }, note: 'public' }] }), context());
  await Promise.resolve();
  assert.deepEqual(store.read(id, true, () => true).data, { items: [{ note: 'public' }] });
  assert.equal(changes, 1);
  let invalidations = 0;
  const error = new Error('401');
  const second = store.identity('/a', 1, 1);
  store.load(
    second,
    async () => {
      throw error;
    },
    context({ authenticated: true, isUnauthorized: (e) => e === error, unauthorized: () => invalidations++ }),
  );
  await Promise.resolve();
  assert.equal(invalidations, 1);
  assert.equal(store.read(second, true, () => true).error, undefined);
  const third = store.identity('/a', 2, 2);
  store.load(
    third,
    async () => {
      throw error;
    },
    context(),
  );
  await Promise.resolve();
  assert.equal(store.read(third, true, () => true).error, error);
  const empty = store.identity(null, 0, 2);
  assert.equal(store.read(empty, false, () => true).loading, false);
});
