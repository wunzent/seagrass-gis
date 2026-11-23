import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionService, validateLogin, publicData, loginMessage } from '../src/services/session-service.ts';
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
function harness(fetcher) {
  let now = 1000;
  const jobs = new Map();
  let id = 0;
  const store = createSession({
    fetcher,
    now: () => now,
    schedule: (fn, ms) => {
      jobs.set(++id, { fn, at: now + ms });
      return id;
    },
    cancel: (key) => jobs.delete(key),
  });
  return {
    store,
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

for (const status of [400, 401, 404]) {
  test(`demo login ${status} uses a demo-specific error without email/password`, async () => {
    const { store } = harness(async () => new Response(null, { status }));
    assert.equal(await store.demoLogin('viewer'), false);
    assert.equal(store.getSnapshot().error, 'เข้าสู่ระบบด้วยบัญชีสาธิตไม่สำเร็จ ลองใหม่หรือกรอกเอง');
    assert.equal(store.getSnapshot().busy, null);
    assert.equal(store.getSnapshot().errorSource, 'login');
  });
}

test('demo roles discovery is same-origin no-store and silently unavailable on errors', async () => {
  const roles = ['viewer', 'editor', 'admin'];
  for (const result of [
    json({ roles }),
    new Response(null, { status: 404 }),
    new Response(null, { status: 503 }),
    new Error('offline'),
  ]) {
    const { store } = harness(async (url, init) => {
      assert.equal(url, '/api/auth/demo-login');
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.cache, 'no-store');
      if (result instanceof Error) throw result;
      return result;
    });
    assert.deepEqual(await store.demoRoles(), result.status === 200 ? roles : null);
    assert.equal(store.getSnapshot().error, '');
  }
});

test('demo login posts only role with CSRF, shares busy guard and accepts safe session', async () => {
  let reply;
  let calls = 0;
  const { store } = harness(async (url, init) => {
    calls++;
    assert.equal(url, '/api/auth/demo-login');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['X-CSRF-Protection'], '1');
    assert.deepEqual(JSON.parse(init.body), { role: 'editor' });
    return new Promise((resolve) => {
      reply = resolve;
    });
  });
  const pending = store.demoLogin('editor');
  assert.equal(store.getSnapshot().busy, 'login');
  assert.equal(await store.demoLogin('admin'), false);
  assert.equal(await store.login('a@demo.local', 'example'), false);
  assert.equal(calls, 1);
  const session = safe();
  session.user.role = 'editor';
  reply(json(session));
  assert.equal(await pending, true);
  assert.deepEqual(store.getSnapshot().session.user, { id: 'a', email: 'a@demo.local', role: 'editor' });
  assert.equal(store.getSnapshot().busy, null);
});

test('demo login maps rejection and network errors through the existing login banner', async () => {
  for (const status of [403, 429, 503, null]) {
    const { store } = harness(async () => {
      if (status === null) throw Error('offline');
      return Response.json({ message: 'sensitive detail' }, { status });
    });
    assert.equal(await store.demoLogin('viewer'), false);
    assert.equal(store.getSnapshot().error, loginMessage(status ?? 503));
    assert.equal(store.getSnapshot().errorSource, 'login');
    assert.equal(store.getSnapshot().busy, null);
  }
});

test('restore allowlists safe session and sends same-origin no-store', async () => {
  const { store } = harness(async (url, init) => {
    assert.equal(url, '/api/auth/me');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    return json(safe());
  });
  await store.restore();
  assert.deepEqual(store.getSnapshot().session, {
    user: { id: 'a', email: 'a@demo.local', role: 'viewer' },
    expires_at: safe().expires_at,
  });
});
test('401 restores anonymous without banner; network failure is retryable', async () => {
  let fail = false;
  const { store } = harness(async () => {
    if (fail) throw Error('private');
    return new Response(null, { status: 401 });
  });
  await store.restore();
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().error, '');
  fail = true;
  await store.restore();
  assert.ok(store.getSnapshot().error);
  assert.equal(store.getSnapshot().phase, 'ready');
});
test('expiry timer invalidates generation without making another request', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return json(safe());
  });
  await h.store.restore();
  const generation = h.store.getSnapshot().generation;
  await h.advance(9000);
  assert.equal(h.store.getSnapshot().session, null);
  assert.ok(h.store.getSnapshot().generation > generation);
  assert.equal(calls, 1);
});
test('late restore cannot resurrect identity after logout; CSRF post and 204 required', async () => {
  let resolve;
  const { store } = harness((url, init) =>
    url.endsWith('/me')
      ? new Promise((r) => {
          resolve = r;
        })
      : (assert.equal(init.method, 'POST'),
        assert.equal(init.headers['X-CSRF-Protection'], '1'),
        Promise.resolve(new Response(null, { status: 204 }))),
  );
  const restore = store.restore();
  await store.logout();
  resolve(json(safe()));
  await restore;
  assert.equal(store.getSnapshot().session, null);
  assert.equal(store.getSnapshot().logoutPending, false);
});
test('logout network/503 clears private state, blocks restore/login and retries to 204', async () => {
  let calls = 0;
  const h = harness(async (url) => {
    if (url.endsWith('/me')) return json(safe());
    calls++;
    if (calls === 1) throw Error('offline');
    return new Response(null, { status: calls === 2 ? 503 : 204 });
  });
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
  const { store } = harness(async (url) => (url.endsWith('/me') ? json(safe()) : new Response(null, { status: 403 })));
  await store.restore();
  await store.logout();
  assert.equal(store.getSnapshot().session.user.id, 'a');
  assert.equal(store.getSnapshot().logoutPending, false);
  assert.equal(store.getSnapshot().errorSource, 'logout');
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
test('focus revalidation clears stale identity on revoked session; expired response rejected', async () => {
  let calls = 0;
  const { store } = harness(async () => (++calls === 1 ? json(safe()) : new Response(null, { status: 401 })));
  await store.restore();
  await store.resume();
  assert.equal(store.getSnapshot().session, null);
  const h = harness(async () => json(safe('a', new Date(500).toISOString())));
  await h.store.restore();
  assert.equal(h.store.getSnapshot().session, null);
});
test('unchanged focus revalidation preserves identity, phase and generation while pending and refreshes expiry', async () => {
  let reply;
  let calls = 0;
  const h = harness(() =>
    ++calls === 1
      ? Promise.resolve(json(safe()))
      : new Promise((resolve) => {
          reply = resolve;
        }),
  );
  await h.store.restore();
  const before = h.store.getSnapshot();
  const pending = h.store.resume();
  assert.equal(h.store.getSnapshot().session, before.session);
  assert.equal(h.store.getSnapshot().phase, 'ready');
  assert.equal(h.store.getSnapshot().generation, before.generation);
  reply(json(safe('a', new Date(20000).toISOString())));
  await pending;
  assert.deepEqual(h.store.getSnapshot().session.user, before.session.user);
  assert.equal(h.store.getSnapshot().generation, before.generation);
  await h.advance(9000);
  assert.ok(h.store.getSnapshot().session);
  await h.advance(10000);
  assert.equal(h.store.getSnapshot().session, null);
});
test('revalidation detects changes in id, email or role; repeated anonymous 401 keeps generation', async () => {
  for (const user of [{ id: 'b' }, { email: 'new@demo.local' }, { role: 'admin' }]) {
    let calls = 0;
    const changed = safe();
    Object.assign(changed.user, user);
    const { store } = harness(async () => json(++calls === 1 ? safe() : changed));
    await store.restore();
    const generation = store.getSnapshot().generation;
    await store.resume();
    assert.equal(store.getSnapshot().generation, generation + 1);
    assert.deepEqual(store.getSnapshot().session.user, {
      id: changed.user.id,
      email: changed.user.email,
      role: changed.user.role,
    });
  }
  const { store } = harness(async () => new Response(null, { status: 401 }));
  await store.restore();
  const generation = store.getSnapshot().generation;
  await store.resume();
  assert.equal(store.getSnapshot().generation, generation);
});
test('identity guard rejects late private payloads at deadline and after identity change', async () => {
  const h = harness(async () => json(safe()));
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
test('overlapping restores and disposed requests cannot overwrite a newer identity', async () => {
  const replies = [];
  const { store } = harness(() => new Promise((resolve) => replies.push(resolve)));
  const old = store.restore();
  const fresh = store.restore();
  replies[1](json(safe('b')));
  await fresh;
  replies[0](json(safe('a')));
  await old;
  assert.equal(store.getSnapshot().session.user.id, 'b');
  const pending = store.restore();
  store.dispose();
  replies[2](json(safe('a')));
  await pending;
  assert.equal(store.getSnapshot().session.user.id, 'b');
});
test('late resource401 cannot cancel active logout before React effect cleanup', async () => {
  let resolve, logoutSignal;
  const { store } = harness(async (url, init) =>
    url.endsWith('/me')
      ? json(safe())
      : ((logoutSignal = init.signal),
        new Promise((reply) => {
          resolve = reply;
        })),
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
test('transient focus failure keeps the established identity and generation', async () => {
  let fail = false;
  const { store } = harness(async () => {
    if (fail) throw Error('offline');
    return json(safe());
  });
  await store.restore();
  const before = store.getSnapshot();
  fail = true;
  await store.resume();
  assert.equal(store.getSnapshot().session, before.session);
  assert.equal(store.getSnapshot().generation, before.generation);
  assert.ok(store.getSnapshot().error);
  assert.equal(store.getSnapshot().errorSource, 'restore');
});
test('logout backs off 3/6/12/24/30 seconds, focus does not bypass delay, and stops at original expiry', async () => {
  let calls = 0;
  const h = harness(async (url) =>
    url.endsWith('/me')
      ? json(safe('a', new Date(110000).toISOString()))
      : (calls++, new Response(null, { status: 503 })),
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await h.store.restore();
  await h.store.logout();
  await h.store.resume();
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
  const h = harness(async (url) =>
    url.endsWith('/me')
      ? json(safe('a', new Date(200000).toISOString()))
      : (calls++, new Response(null, { status: 429, headers: { 'Retry-After': '90' } })),
  );
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
  const h = harness(async (url) =>
    url.endsWith('/me')
      ? json(safe('a', new Date(200000).toISOString()))
      : new Response(null, {
          status: ++calls === 1 ? 429 : 204,
          headers: { 'Retry-After': new Date(121000).toUTCString() },
        }),
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

test('dispose clears the retry handle so resume can continue a pending logout', async () => {
  let calls = 0;
  const h = harness(async (url) =>
    url.endsWith('/me') ? json(safe()) : new Response(null, { status: ++calls === 1 ? 503 : 204 }),
  );
  await h.store.restore();
  await h.store.logout();
  h.store.dispose();
  await h.advance(3000);
  assert.equal(calls, 1);
  await h.store.resume();
  assert.equal(calls, 2);
  assert.equal(h.store.getSnapshot().logoutPending, false);
});

for (const action of ['login', 'demoLogin']) {
  test(`${action} ignores JWT response fields in every published snapshot and subsequent request`, async () => {
    const snapshots = [];
    const requests = [];
    const marker = 'test-jwt-must-not-enter-web-state';
    const { store } = harness(async (url, init) => {
      requests.push({ url, init });
      return json({ ...safe(), access_token: marker, token_type: 'Bearer', expires_in: 900 });
    });
    store.subscribe(() => snapshots.push(structuredClone(store.getSnapshot())));
    assert.equal(await (action === 'login' ? store.login('a@demo.local', 'example') : store.demoLogin('viewer')), true);
    const session = store.getSnapshot().session;
    assert.deepEqual(Object.keys(session).sort(), ['expires_at', 'user']);
    assert.deepEqual(Object.keys(session.user).sort(), ['email', 'id', 'role']);
    await store.resume();
    assert.equal(JSON.stringify(snapshots).includes(marker), false);
    assert.equal(JSON.stringify(snapshots).includes('access_token'), false);
    assert.equal(JSON.stringify(requests).includes(marker), false);
    for (const { init } of requests) assert.equal(new Headers(init.headers).has('Authorization'), false);
    store.dispose();
  });
}
