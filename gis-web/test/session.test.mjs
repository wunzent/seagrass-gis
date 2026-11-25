import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSessionService,
  validateLogin,
  publicData,
  loginMessage,
  SESSION_STORAGE_KEY,
} from '../src/services/session-service.ts';
import { fetchJson } from '../src/services/http-client.ts';
import { createSessionStore } from '../src/stores/session-store.ts';
const createSession = (options) => {
  const sink = createSessionStore(options.now);
  return { ...sink, ...createSessionService(sink, options) };
};

const safe = (id = 'a', expires_at = new Date(10000).toISOString()) => ({
  user: { id, email: `${id}@demo.local`, role: 'viewer', secret: 'discard' },
  expires_at,
  access_token: 'discard',
});
const noRequest = async () => {
  throw new Error('no request expected');
};
/** `stored` is what an earlier login left in browser storage (object, raw string, or absent). */
function harness(fetcher = noRequest, { stored } = {}) {
  let now = 1000;
  const jobs = new Map();
  let id = 0;
  const memory = new Map();
  if (stored !== undefined)
    memory.set(SESSION_STORAGE_KEY, typeof stored === 'string' ? stored : JSON.stringify(stored));
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  };
  const store = createSession({
    fetcher,
    now: () => now,
    schedule: (fn, ms) => {
      jobs.set(++id, { fn, at: now + ms });
      return id;
    },
    cancel: (key) => jobs.delete(key),
    storage,
  });
  return {
    store,
    memory,
    async advance(ms) {
      now += ms;
      for (const [key, job] of [...jobs])
        if (job.at <= now) {
          jobs.delete(key);
          job.fn();
        }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}
const json = (value) => Response.json(value);

test('restore shows the remembered safe identity without any request', async () => {
  const h = harness(noRequest, { stored: safe() });
  assert.equal(h.store.getSnapshot().phase, 'checking');
  await h.store.restore();
  assert.deepEqual(h.store.getSnapshot().session, {
    user: { id: 'a', email: 'a@demo.local', role: 'viewer' },
    expires_at: safe().expires_at,
  });
  assert.equal(h.store.getSnapshot().phase, 'ready');
  assert.equal(h.memory.get(SESSION_STORAGE_KEY).includes('discard'), false);
  h.store.dispose();
});
test('restore drops missing, corrupt, expired or unsafe remembered identities without a request', async () => {
  const badRole = safe();
  badRole.user.role = 'root';
  for (const stored of [undefined, 'not json', safe('a', new Date(500).toISOString()), badRole]) {
    const h = harness(noRequest, { stored });
    await h.store.restore();
    assert.equal(h.store.getSnapshot().session, null);
    assert.equal(h.store.getSnapshot().phase, 'ready');
    assert.equal(h.store.getSnapshot().error, '');
    assert.equal(h.memory.has(SESSION_STORAGE_KEY), false);
    h.store.dispose();
  }
});
test('login remembers only the safe identity; logout and a data 401 forget it', async () => {
  const h = harness(async (url) =>
    url.endsWith('/logout') ? new Response(null, { status: 204 }) : json(safe('a', new Date(121000).toISOString())),
  );
  assert.equal(await h.store.login('a@demo.local', 'secret-pass'), true);
  const remembered = JSON.parse(h.memory.get(SESSION_STORAGE_KEY));
  assert.deepEqual(remembered, {
    user: { id: 'a', email: 'a@demo.local', role: 'viewer' },
    expires_at: new Date(121000).toISOString(),
  });
  await h.store.logout();
  assert.equal(h.memory.has(SESSION_STORAGE_KEY), false);
  await h.store.login('a@demo.local', 'secret-pass');
  h.store.unauthorized();
  assert.equal(h.memory.has(SESSION_STORAGE_KEY), false);
  h.store.dispose();
});
test('X-Auth-Session: invalid on a data response drops a known identity; anonymous and disposed stores ignore it', async (t) => {
  const marked = () => Response.json([], { headers: { 'x-auth-session': 'invalid' } });
  t.mock.method(globalThis, 'fetch', async () => marked());
  const anonymous = harness();
  await anonymous.store.restore();
  const generation = anonymous.store.getSnapshot().generation;
  await fetchJson('/api/sites', new AbortController().signal);
  assert.equal(anonymous.store.getSnapshot().generation, generation);
  assert.equal(anonymous.store.getSnapshot().expiryNotice, null);
  anonymous.store.dispose();

  const known = harness(noRequest, { stored: safe('a', new Date(121000).toISOString()) });
  await known.store.restore();
  const before = known.store.getSnapshot().generation;
  assert.deepEqual(await fetchJson('/api/sites', new AbortController().signal), []);
  assert.equal(known.store.getSnapshot().session, null);
  assert.ok(known.store.getSnapshot().generation > before);
  assert.equal(known.store.getSnapshot().expiryNotice, 'expired');
  assert.equal(known.memory.has(SESSION_STORAGE_KEY), false);
  known.store.dispose();

  const disposed = harness(noRequest, { stored: safe('a', new Date(121000).toISOString()) });
  await disposed.store.restore();
  disposed.store.dispose();
  await fetchJson('/api/sites', new AbortController().signal);
  assert.ok(disposed.store.getSnapshot().session);
  // React StrictMode runs cleanup then the effect again: restore re-attaches the listener.
  await disposed.store.restore();
  await fetchJson('/api/sites', new AbortController().signal);
  assert.equal(disposed.store.getSnapshot().session, null);
  disposed.store.dispose();
});
test('a marker on a request sent before login does not drop the new login', async (t) => {
  let reply;
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const h = harness(async () => json(safe('a', new Date(121000).toISOString())));
  await h.store.restore();
  const stale = fetchJson('/api/sites', new AbortController().signal);
  assert.equal(await h.store.login('a@demo.local', 'secret-pass'), true);
  reply(Response.json([], { headers: { 'x-auth-session': 'invalid' } }));
  await stale;
  assert.ok(h.store.getSnapshot().session);
  assert.equal(h.store.getSnapshot().expiryNotice, null);
  const fresh = fetchJson('/api/sites', new AbortController().signal);
  reply(Response.json([], { headers: { 'x-auth-session': 'invalid' } }));
  await fresh;
  assert.equal(h.store.getSnapshot().session, null);
  h.store.dispose();
});
test("dropping this tab's identity leaves another tab's newer login in storage", async () => {
  const h = harness(noRequest, { stored: safe('a', new Date(121000).toISOString()) });
  await h.store.restore();
  const other = JSON.stringify(safe('b', new Date(500000).toISOString()));
  h.memory.set(SESSION_STORAGE_KEY, other);
  h.store.unauthorized();
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.memory.get(SESSION_STORAGE_KEY), other);
  h.store.dispose();
});
test('a normal data response keeps the identity', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  const h = harness(noRequest, { stored: safe('a', new Date(121000).toISOString()) });
  await h.store.restore();
  await fetchJson('/api/sites', new AbortController().signal);
  assert.ok(h.store.getSnapshot().session);
  h.store.dispose();
});
test('expiry timer invalidates generation without making a request', async () => {
  const h = harness(noRequest, { stored: safe() });
  await h.store.restore();
  const generation = h.store.getSnapshot().generation;
  await h.advance(9000);
  assert.equal(h.store.getSnapshot().session, null);
  assert.ok(h.store.getSnapshot().generation > generation);
  assert.equal(h.memory.has(SESSION_STORAGE_KEY), false);
});
test('expiry notice warns one minute before and says expired at the deadline, without requests', async () => {
  const h = harness(noRequest, { stored: safe('a', new Date(121000).toISOString()) });
  await h.store.restore();
  assert.equal(h.store.getSnapshot().expiryNotice, null);
  await h.advance(59000);
  assert.equal(h.store.getSnapshot().expiryNotice, null);
  await h.advance(1000);
  assert.equal(h.store.getSnapshot().expiryNotice, 'soon');
  assert.ok(h.store.getSnapshot().session);
  await h.advance(60000);
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getSnapshot().expiryNotice, 'expired');
  h.store.dismissNotice();
  assert.equal(h.store.getSnapshot().expiryNotice, null);
});
test('a session with under a minute left warns at once; a new login clears the notice', async () => {
  const h = harness(async () => json(safe('a', new Date(500000).toISOString())), { stored: safe() });
  await h.store.restore();
  assert.equal(h.store.getSnapshot().expiryNotice, 'soon');
  await h.advance(9000);
  assert.equal(h.store.getSnapshot().expiryNotice, 'expired');
  assert.equal(await h.store.login('a@demo.local', 'secret-pass'), true);
  assert.equal(h.store.getSnapshot().expiryNotice, null);
});
test('a 401 from a data request marks a known session expired; anonymous 401 shows nothing; logout shows nothing', async () => {
  const later = safe('a', new Date(121000).toISOString());
  const h = harness(async () => new Response(null, { status: 204 }), { stored: later });
  h.store.unauthorized();
  assert.equal(h.store.getSnapshot().expiryNotice, null);
  h.memory.set(SESSION_STORAGE_KEY, JSON.stringify(later));
  await h.store.restore();
  h.store.unauthorized();
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getSnapshot().expiryNotice, 'expired');
  h.memory.set(SESSION_STORAGE_KEY, JSON.stringify(later));
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getSnapshot().expiryNotice, null);
});
test('logout sends a CSRF POST and needs 204', async () => {
  const h = harness(
    async (url, init) => (
      assert.ok(url.endsWith('/logout')),
      assert.equal(init.method, 'POST'),
      assert.equal(init.headers['X-CSRF-Protection'], '1'),
      new Response(null, { status: 204 })
    ),
    { stored: safe() },
  );
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getSnapshot().logoutPending, false);
});
test('logout network/503 clears private state, blocks restore/login and retries to 204', async () => {
  let calls = 0;
  const h = harness(
    async () => {
      calls++;
      if (calls === 1) throw Error('offline');
      return new Response(null, { status: calls === 2 ? 503 : 204 });
    },
    { stored: safe() },
  );
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().session, null);
  assert.equal(h.store.getSnapshot().logoutPending, true);
  await h.store.restore();
  assert.equal(h.store.getSnapshot().session, null);
  await h.store.login('a@demo.local', 'example');
  assert.equal(calls, 1);
  await h.store.logout();
  assert.equal(h.store.getSnapshot().logoutPending, true);
  await h.advance(6000);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 3);
  assert.equal(h.store.getSnapshot().logoutPending, false);
});
test('logout CSRF rejection preserves the session', async () => {
  const h = harness(async () => new Response(null, { status: 403 }), { stored: safe() });
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().session.user.id, 'a');
  assert.equal(h.store.getSnapshot().logoutPending, false);
  assert.equal(h.store.getSnapshot().errorSource, 'logout');
});
test('validation, duplicate login guard, safe error messages and identity switch', async () => {
  assert.ok(validateLogin('bad', '').email);
  assert.ok(validateLogin('a@b.local', '').password);
  let resolve,
    calls = 0;
  const { store } = harness(async (url, init) => {
    calls++;
    assert.equal(init.headers['X-CSRF-Protection'], '1');
    return new Promise((r) => {
      resolve = r;
    });
  });
  const pending = store.login('a@b.local', 'example');
  await store.login('a@b.local', 'example');
  assert.equal(calls, 1);
  assert.equal(store.isCurrent(store.getSnapshot().generation), false);
  store.unauthorized();
  assert.equal(store.getSnapshot().busy, 'login');
  resolve(json(safe('b')));
  assert.equal(await pending, true);
  assert.equal(store.getSnapshot().session.user.id, 'b');
});
test('restoring a different remembered identity starts a new generation', async () => {
  const h = harness(noRequest, { stored: safe() });
  await h.store.restore();
  const generation = h.store.getSnapshot().generation;
  await h.store.restore();
  assert.equal(h.store.getSnapshot().generation, generation);
  for (const change of [{ id: 'b' }, { email: 'new@demo.local' }, { role: 'admin' }]) {
    const changed = safe();
    Object.assign(changed.user, change);
    h.memory.set(SESSION_STORAGE_KEY, JSON.stringify(changed));
    const before = h.store.getSnapshot().generation;
    await h.store.restore();
    assert.equal(h.store.getSnapshot().generation, before + 1);
    assert.equal(h.store.getSnapshot().session.user[Object.keys(change)[0]], Object.values(change)[0]);
  }
});
test('identity guard rejects late private payloads at deadline and after identity change', async () => {
  const h = harness(noRequest, { stored: safe() });
  await h.store.restore();
  const generation = h.store.getSnapshot().generation;
  assert.equal(h.store.isCurrent(generation), true);
  await h.advance(9000);
  assert.equal(h.store.isCurrent(generation), false);
  const source = {
    features: [{ properties: { name: 'public', created_by: { email: 'private' }, updated_by: 'private' } }],
  };
  assert.deepEqual(publicData(source), { features: [{ properties: { name: 'public' } }] });
  assert.ok(source.features[0].properties.created_by);
});
test('login failure statuses use fixed messages without reflecting upstream contents', async () => {
  for (const status of [400, 401, 403, 429, 503]) {
    const { store } = harness(async () => Response.json({ error: { message: 'sensitive detail' } }, { status }));
    assert.equal(await store.login('a@b.local', 'example'), false);
    assert.equal(store.getSnapshot().error, loginMessage(status));
    assert.equal(store.getSnapshot().errorSource, 'login');
    assert.equal(store.getSnapshot().error.includes('sensitive'), false);
  }
});
test('late resource401 cannot cancel active logout before React effect cleanup', async () => {
  let resolve, logoutSignal;
  const { store } = harness(
    async (url, init) => (
      (logoutSignal = init.signal),
      new Promise((reply) => {
        resolve = reply;
      })
    ),
    { stored: safe() },
  );
  await store.restore();
  const generation = store.getSnapshot().generation;
  const pending = store.logout();
  assert.equal(store.isCurrent(generation), false);
  if (store.isCurrent(generation)) store.unauthorized();
  store.unauthorized();
  assert.equal(logoutSignal.aborted, false);
  resolve(new Response(null, { status: 503 }));
  await pending;
  assert.equal(store.getSnapshot().logoutPending, true);
  assert.equal(store.getSnapshot().session, null);
});
test('logout backs off 3/6/12/24/30 seconds and stops at original expiry', async () => {
  let calls = 0;
  const h = harness(async () => (calls++, new Response(null, { status: 503 })), {
    stored: safe('a', new Date(110000).toISOString()),
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await h.store.restore();
  await h.store.logout();
  assert.equal(calls, 1);
  for (const delay of [3000, 6000, 12000, 24000, 30000, 30000]) {
    await h.advance(delay - 1);
    await flush();
    const previous = calls;
    await h.advance(1);
    await flush();
    assert.equal(calls, previous + 1);
  }
  await h.advance(4000);
  await flush();
  assert.equal(h.store.getSnapshot().logoutPending, false);
  await h.advance(60000);
  await flush();
  assert.equal(calls, 7);
});
test('logout 429 waits longer and never retries beyond the cookie deadline', async () => {
  let calls = 0;
  const h = harness(async () => (calls++, new Response(null, { status: 429, headers: { 'Retry-After': '90' } })), {
    stored: safe('a', new Date(200000).toISOString()),
  });
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().rateLimitedUntil, 91000);
  await h.store.logout();
  assert.equal(calls, 1, 'explicit retry must respect 429 wait');
  await h.advance(89999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  await h.advance(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  await h.advance(109000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(h.store.getSnapshot().logoutPending, false);
  assert.equal(h.store.getSnapshot().rateLimitedUntil, 0);
});

test('logout respects HTTP-date Retry-After and retries at its deadline', async () => {
  let calls = 0;
  const h = harness(
    async () =>
      new Response(null, {
        status: ++calls === 1 ? 429 : 204,
        headers: { 'Retry-After': new Date(121000).toUTCString() },
      }),
    { stored: safe('a', new Date(200000).toISOString()) },
  );
  await h.store.restore();
  await h.store.logout();
  assert.equal(h.store.getSnapshot().rateLimitedUntil, 121000);
  await h.advance(119999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  await h.advance(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(h.store.getSnapshot().rateLimitedUntil, 0);
  assert.equal(h.store.getSnapshot().errorSource, null);
});

test('dispose clears the retry handle so an explicit logout can continue a pending one', async () => {
  let calls = 0;
  const h = harness(async () => new Response(null, { status: ++calls === 1 ? 503 : 204 }), { stored: safe() });
  await h.store.restore();
  await h.store.logout();
  h.store.dispose();
  await h.advance(3000);
  assert.equal(calls, 1);
  await h.store.logout();
  assert.equal(calls, 2);
  assert.equal(h.store.getSnapshot().logoutPending, false);
});

test('login ignores JWT response fields in every published snapshot, storage and subsequent request', async () => {
  const snapshots = [];
  const requests = [];
  const marker = 'test-jwt-must-not-enter-web-state';
  const h = harness(async (url, init) => {
    requests.push({ url, init });
    return json({ ...safe(), access_token: marker });
  });
  const { store } = h;
  store.subscribe(() => snapshots.push(structuredClone(store.getSnapshot())));
  assert.equal(await store.login('a@demo.local', 'example'), true);
  const session = store.getSnapshot().session;
  assert.deepEqual(Object.keys(session).sort(), ['expires_at', 'user']);
  assert.deepEqual(Object.keys(session.user).sort(), ['email', 'id', 'role']);
  await store.restore();
  assert.equal(JSON.stringify(snapshots).includes(marker), false);
  assert.equal(JSON.stringify(snapshots).includes('access_token'), false);
  assert.equal(h.memory.get(SESSION_STORAGE_KEY).includes(marker), false);
  assert.equal(JSON.stringify(requests).includes(marker), false);
  for (const { init } of requests) assert.equal(new Headers(init.headers).has('Authorization'), false);
  store.dispose();
});

test('hydration reads a fixed checking snapshot, never the identity restored from storage before the tree hydrates', () => {
  const store = createSessionStore();
  const server = store.getServerSnapshot();
  assert.equal(server.phase, 'checking');
  assert.equal(server.session, null);
  store.setState((state) => ({
    ...state,
    phase: 'ready',
    session: { user: { id: 'u', email: 'a@demo.local', role: 'admin' }, expires_at: '2999-01-01T00:00:00Z' },
  }));
  assert.equal(store.getSnapshot().phase, 'ready');
  assert.equal(store.getServerSnapshot(), server, 'same object every call');
  assert.equal(store.getServerSnapshot().phase, 'checking');
});

test('useSession hydrates from the server snapshot', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/stores/session-context.tsx', import.meta.url), 'utf8');
  assert.match(source, /useSyncExternalStore\(store\.subscribe, store\.getSnapshot, store\.getServerSnapshot\)/);
  const provider = readFileSync(new URL('../src/features/auth/session-provider.tsx', import.meta.url), 'utf8');
  assert.match(provider, /getServerSnapshot: sink\.getServerSnapshot/);
});
