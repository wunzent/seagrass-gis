import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyRequest, MAX_BODY_BYTES } from '../src/lib/proxy.ts';
import config, { securityHeaders } from '../next.config.ts';

const asMap = (list) => new Map(list.map((h) => [h.key, h.value]));

test('security headers apply to all routes with the required static headers', async () => {
  const rules = await config.headers();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, '/:path*');
  const headers = asMap(rules[0].headers);
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('CSP is restrictive, allows only the OSM tile host, and no unsafe-eval in production', () => {
  const csp = asMap(securityHeaders(false)).get('Content-Security-Policy');
  const directives = new Map(csp.split('; ').map((d) => [d.split(' ')[0], d]));
  assert.equal(directives.get('default-src'), "default-src 'self'");
  assert.equal(directives.get('script-src'), "script-src 'self' 'unsafe-inline'");
  assert.equal(directives.get('style-src'), "style-src 'self' 'unsafe-inline'");
  assert.equal(directives.get('img-src'), "img-src 'self' data: blob: https://tile.openstreetmap.org");
  assert.equal(directives.get('connect-src'), "connect-src 'self' https://tile.openstreetmap.org");
  assert.equal(directives.get('worker-src'), "worker-src 'self' blob:");
  assert.equal(directives.get('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(directives.get('base-uri'), "base-uri 'self'");
  assert.equal(directives.get('form-action'), "form-action 'self'");
  assert.equal(directives.get('object-src'), "object-src 'none'");
  assert.ok(!csp.includes('unsafe-eval'));
  assert.ok(asMap(securityHeaders(true)).get('Content-Security-Policy').includes("'unsafe-eval'"));
});

test('proxy responses carry nosniff, including errors', async () => {
  const ok = await proxyRequest(new Request('http://web/api/sites'), 'http://api:3001', async () => new Response('{}'));
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  const bad = await proxyRequest(new Request('http://web/api/nope'), 'http://api:3001', async () => new Response('{}'));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('x-content-type-options'), 'nosniff');
});

test('proxy rejects declared oversized bodies with 413 before reading or forwarding', async () => {
  let called = false;
  const response = await proxyRequest(
    new Request('http://web/api/auth/login', {
      method: 'POST',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      body: 'x',
    }),
    'http://api:3001',
    async () => ((called = true), new Response('{}')),
  );
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(called, false);
});

test('proxy caps actual bytes read when content-length is missing or understated', async () => {
  const chunk = new Uint8Array(64 * 1024);
  const stream = () =>
    new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk);
      },
    });
  for (const headers of [{}, { 'content-length': '10' }]) {
    let called = false;
    const response = await proxyRequest(
      new Request('http://web/api/auth/login', { method: 'POST', headers, body: stream(), duplex: 'half' }),
      'http://api:3001',
      async () => ((called = true), new Response('{}')),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(called, false);
  }
});

test('proxy forwards bodies at or under the limit', async () => {
  let received;
  const body = new Uint8Array(MAX_BODY_BYTES).fill(97);
  const response = await proxyRequest(
    new Request('http://web/api/auth/login', { method: 'POST', body }),
    'http://api:3001',
    async (_url, init) => ((received = init.body), new Response('{}')),
  );
  assert.equal(response.status, 200);
  assert.equal(received.byteLength, MAX_BODY_BYTES);
});

test('proxy aborts a stalled request body with the error envelope', async () => {
  const controller = new AbortController();
  const stalled = new ReadableStream({ pull: () => new Promise(() => {}) });
  const request = new Request('http://web/api/auth/login', {
    method: 'POST',
    body: stalled,
    duplex: 'half',
    signal: controller.signal,
  });
  let called = false;
  const pending = proxyRequest(request, 'http://api:3001', async () => ((called = true), new Response('{}')));
  setTimeout(() => controller.abort(), 20);
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(called, false);
});
