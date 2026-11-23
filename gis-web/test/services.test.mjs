import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sites from '../src/services/sites-service.ts';
import * as surveys from '../src/services/surveys-service.ts';
import * as lookups from '../src/services/lookups-service.ts';
import { fetchJson, requestAuth, ApiError } from '../src/services/http-client.ts';
const filters = { province: '81', status: 'good', q: 'A & ไทย' };
const state = { filters, page: 2 };
const bbox = [98, 7, 99, 8];
test('domain service keys preserve encoded list, geometry, detail, history and lookup URLs', () => {
  assert.ok(sites.sitesService, 'sitesService domain API required');
  assert.equal(
    sites.sitesService.listKey(state),
    '/api/sites?page=2&pageSize=20&province=81&status=good&q=A+%26+%E0%B9%84%E0%B8%97%E0%B8%A2',
  );
  assert.equal(sites.sitesService.getKey('A/B ?'), '/api/sites/A%2FB%20%3F');
  assert.equal(
    sites.sitesService.geojsonKey(filters, bbox),
    '/api/sites.geojson?province=81&status=good&q=A+%26+%E0%B9%84%E0%B8%97%E0%B8%A2&bbox=98%2C7%2C99%2C8',
  );
  assert.equal(surveys.surveysService.historyKey('A/B ?'), '/api/sites/A%2FB%20%3F/surveys?page=1&pageSize=100');
  assert.equal(
    surveys.surveysService.geojsonKey(filters, bbox),
    '/api/surveys.geojson?province=81&status=good&q=A+%26+%E0%B9%84%E0%B8%97%E0%B8%A2&bbox=98%2C7%2C99%2C8',
  );
  assert.equal(lookups.lookupsService.provincesKey(), '/api/provinces.geojson');
});
test('each domain loader uses its key with the supplied signal and unchanged transport options', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const signal = new AbortController().signal;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return Response.json({ ok: true });
  };
  try {
    const s = sites.sitesService,
      u = surveys.surveysService,
      l = lookups.lookupsService;
    assert.ok(s && u && l, 'domain APIs required');
    const expected = [
      s.listKey(state),
      s.getKey('S 1'),
      s.geojsonKey(filters, bbox),
      u.historyKey('S 1'),
      u.geojsonKey(filters, bbox),
      l.provincesKey(),
    ];
    for (const run of [
      () => s.list(state, signal),
      () => s.get('S 1', signal),
      () => s.geojson(filters, bbox, signal),
      () => u.history('S 1', signal),
      () => u.geojson(filters, bbox, signal),
      () => l.provinces(signal),
    ])
      assert.deepEqual(await run(), { ok: true });
    assert.deepEqual(
      calls.map(([url]) => url),
      expected,
    );
    for (const [, init] of calls) {
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.signal, signal);
    }
  } finally {
    globalThis.fetch = original;
  }
});
test('http client preserves credentials, no-store, signal and ApiError status', async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/sites');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.signal, signal);
    return new Response('', { status: 403 });
  };
  try {
    await assert.rejects(fetchJson('/api/sites', signal), (e) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 403);
      return true;
    });
  } finally {
    globalThis.fetch = original;
  }
});
test('auth transport preserves CSRF body, credentials, no-store and propagates caller abort', async () => {
  const controller = new AbortController();
  let captured;
  const response = await requestAuth(
    async (url, init) => {
      captured = init;
      assert.equal(url, '/api/auth/login');
      return new Response(null, { status: 204 });
    },
    'login',
    controller.signal,
    { method: 'POST', headers: { 'X-CSRF-Protection': '1' }, body: '{}' },
  );
  assert.equal(response.status, 204);
  assert.equal(captured.credentials, 'same-origin');
  assert.equal(captured.cache, 'no-store');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.headers['X-CSRF-Protection'], '1');
  assert.equal(captured.body, '{}');
  assert.equal(captured.signal.aborted, false);
  controller.abort();
  assert.equal(captured.signal.aborted, true);
});
