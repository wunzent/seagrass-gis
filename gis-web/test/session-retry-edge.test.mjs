import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession } from '../src/lib/session.ts';

test('a pending logout retry receiving 403 remains private but releases at original expiry', async () => {
  let now = 1000, calls = 0, id = 0;
  const jobs = new Map();
  const store = createSession({
    now: () => now,
    schedule: (fn, ms) => { jobs.set(++id, { fn, at: now + ms }); return id; },
    cancel: key => jobs.delete(key),
    fetcher: async url => url.endsWith('/me')
      ? Response.json({ user: { id: 'a', email: 'a@demo.local', role: 'viewer' }, expires_at: new Date(10000).toISOString() })
      : new Response(null, { status: ++calls === 1 ? 503 : 403 }),
  });
  const advance = async ms => {
    now += ms;
    for (const [key, job] of [...jobs]) if (job.at <= now) { jobs.delete(key); job.fn(); }
    await new Promise(resolve => setImmediate(resolve));
  };
  await store.restore(); await store.logout();
  await advance(3000);
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().logoutPending, true);
  await advance(6000);
  assert.equal(store.getSnapshot().logoutPending, false);
  assert.equal(store.getSnapshot().error, '');
  assert.equal(store.getSnapshot().busy, null);
  await advance(60000); assert.equal(calls, 2);
  store.dispose();
});
