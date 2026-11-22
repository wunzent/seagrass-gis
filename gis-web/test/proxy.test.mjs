import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upstreamUrl, proxyRequest } from '../src/lib/proxy.ts';

test('proxy forwards Retry-After for both delay seconds and HTTP-date without other upstream headers', async () => {
  for (const after of ['90', 'Sat, 21 Nov 2026 12:00:00 GMT']) {
    const response = await proxyRequest(
      new Request('http://web/api/auth/logout', { method: 'POST' }),
      'http://api:3001',
      async () => new Response(null, { status: 429, headers: { 'Retry-After': after, 'x-private': 'hidden' } }),
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), after);
    assert.equal(response.headers.has('x-private'), false);
  }
});

test('proxy strips only /api and preserves encoded code/query on fixed origin', () => {
  assert.equal(
    upstreamUrl('http://web/api/sites.geojson?bbox=98%2C6%2C101%2C10&q=a%26b', 'http://api:3001').href,
    'http://api:3001/sites.geojson?bbox=98%2C6%2C101%2C10&q=a%26b',
  );
  assert.equal(upstreamUrl('http://web/api/sites/A%20B', 'http://api:3001/').pathname, '/sites/A%20B');
  for (const path of ['/api//evil.test/x', '/api/%2e%2e/admin', '/api/sites/%2Fsecret', '/other/sites'])
    assert.throws(() => upstreamUrl('http://web' + path, 'http://api:3001'));
});

test('proxy forwards cookie/CSRF and body, preserves separate cookies and never caches', async () => {
  const request = new Request('http://web/api/auth/login', {
    method: 'POST',
    headers: {
      cookie: 'demo=value',
      origin: 'http://web',
      'x-csrf-protection': '1',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      'x-forwarded-host': 'evil',
      authorization: 'Bearer browser-supplied-token',
    },
    body: '{"example":true}',
  });
  const response = await proxyRequest(request, 'http://api:3001', async (url, init) => {
    assert.equal(url.href, 'http://api:3001/auth/login');
    assert.equal(init.headers.get('cookie'), 'demo=value');
    assert.equal(init.headers.get('origin'), 'http://web');
    assert.equal(init.headers.get('x-csrf-protection'), '1');
    assert.equal(init.headers.has('x-forwarded-host'), false);
    assert.equal(init.headers.has('authorization'), false);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'manual');
    assert.equal(new TextDecoder().decode(init.body), '{"example":true}');
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'public',
      'access-control-allow-origin': '*',
    });
    headers.append('set-cookie', 'a=one; HttpOnly; Path=/');
    headers.append('set-cookie', 'b=two; HttpOnly; Path=/');
    return new Response('{"ok":true}', { headers });
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.has('access-control-allow-origin'), false);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.deepEqual(await response.json(), { ok: true });
});

test('upstream failure is sanitized and redirects are not followed', async () => {
  const result = await proxyRequest(new Request('http://web/api/sites'), 'http://api:3001', async () => {
    throw new Error('private upstream information');
  });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, 'SERVICE_UNAVAILABLE');
  const redirect = await proxyRequest(
    new Request('http://web/api/sites'),
    'http://api:3001',
    async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } }),
  );
  assert.equal(redirect.status, 502);
});

test('demo-login is proxied like the other auth routes', () => {
  assert.equal(
    upstreamUrl('http://web/api/auth/demo-login', 'http://api:3001/').href,
    'http://api:3001/auth/demo-login',
  );
});

for (const path of ['login', 'demo-login']) {
  test(`successful POST ${path} hides JWT fields while preserving session data and cookies`, async () => {
    const safe = { user: { id: 'user-id', role: 'viewer' }, expires_in: 900, expires_at: '2026-11-23T00:15:00Z' };
    const body = JSON.stringify({ ...safe, access_token: 'private-jwt', token_type: 'Bearer' });
    const response = await proxyRequest(
      new Request(`http://web/api/auth/${path}`, { method: 'POST' }),
      'http://api:3001',
      async () =>
        new Response(body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-length': String(Buffer.byteLength(body)),
            'set-cookie': 'gis_access=private-jwt; HttpOnly; Path=/',
          },
        }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), safe);
    assert.equal(response.headers.get('content-length'), null);
    assert.deepEqual(response.headers.getSetCookie(), ['gis_access=private-jwt; HttpOnly; Path=/']);
  });
}

test('proxy streams errors, other routes, GET auth and non-JSON login unchanged', async () => {
  for (const [path, method, status, type] of [
    ['auth/login', 'POST', 401, 'application/json'],
    ['auth/demo-login', 'POST', 401, 'application/json'],
    ['sites', 'POST', 200, 'application/json'],
    ['auth/demo-login', 'GET', 200, 'application/json'],
    ['auth/login', 'POST', 200, 'text/plain'],
  ]) {
    const body = '{ "access_token": "unchanged", "token_type": "Bearer" }';
    const upstream = new Response(body, { status, headers: { 'content-type': type } });
    const stream = upstream.body;
    const response = await proxyRequest(
      new Request(`http://web/api/${path}`, { method }),
      'http://api:3001',
      async () => upstream,
    );
    assert.equal(response.body, stream);
    assert.equal(response.status, status);
    assert.equal(await response.text(), body);
  }
});
