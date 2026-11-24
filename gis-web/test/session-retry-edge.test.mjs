import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionService } from '../src/services/session-service.ts';
import { createSessionStore } from '../src/stores/session-store.ts';
const remembered = (expires) => {
  const value = JSON.stringify({
    user: { id: 'a', email: 'a@demo.local', role: 'viewer' },
    expires_at: new Date(expires).toISOString(),
  });
  const memory = new Map([['gis-session', value]]);
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, v) => memory.set(key, v),
    removeItem: (key) => memory.delete(key),
  };
};
const createSession = (options) => {
  const sink = createSessionStore(options.now);
  return { ...sink, ...createSessionService(sink, options) };
};

test('a logout 429 retry firing 1 ms early does not strand pending logout', async () => {
  let now = 1000,
    calls = 0;
  const jobs = new Map();
  let id = 0;
  const store = createSession({
    now: () => now,
    schedule: (fn, ms) => {
      jobs.set(++id, { fn, at: now + ms });
      return id;
    },
    cancel: (key) => jobs.delete(key),
    storage: remembered(200000),
    fetcher: async () => new Response(null, { status: ++calls === 1 ? 429 : 204, headers: { 'Retry-After': '90' } }),
  });
  await store.restore();
  await store.logout();
  const [key, job] = [...jobs][0];
  now = job.at - 1;
  jobs.delete(key);
  job.fn();
  await new Promise((resolve) => setImmediate(resolve));
  // A timer may retry internally or re-arm the remaining millisecond, but must not disappear.
  assert.ok(calls === 2 || jobs.size > 0, 'early timer must retry or reschedule');
  for (const [nextKey, next] of [...jobs]) {
    now = next.at;
    jobs.delete(nextKey);
    next.fn();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().logoutPending, false);
  assert.equal(store.getSnapshot().rateLimitedUntil, 0);
  store.dispose();
});

test('a pending logout retry receiving 403 remains private but releases at original expiry', async () => {
  let now = 1000,
    calls = 0,
    id = 0;
  const jobs = new Map();
  const store = createSession({
    now: () => now,
    schedule: (fn, ms) => {
      jobs.set(++id, { fn, at: now + ms });
      return id;
    },
    cancel: (key) => jobs.delete(key),
    storage: remembered(10000),
    fetcher: async () => new Response(null, { status: ++calls === 1 ? 503 : 403 }),
  });
  const advance = async (ms) => {
    now += ms;
    for (const [key, job] of [...jobs])
      if (job.at <= now) {
        jobs.delete(key);
        job.fn();
      }
    await new Promise((resolve) => setImmediate(resolve));
  };
  await store.restore();
  await store.logout();
  await advance(3000);
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().logoutPending, true);
  await advance(6000);
  assert.equal(store.getSnapshot().logoutPending, false);
  assert.equal(store.getSnapshot().error, '');
  assert.equal(store.getSnapshot().busy, null);
  await advance(60000);
  assert.equal(calls, 2);
  store.dispose();
});
