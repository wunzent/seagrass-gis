import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryCache, snapBbox } from '../src/lib/map-cache.ts';
import { sitesService } from '../src/services/sites-service.ts';
import { surveysService } from '../src/services/surveys-service.ts';
import { createMapStore } from '../src/stores/map-store.ts';

const filters = { province: '', status: '', q: '' };
const box = [98.01, 7.02, 98.24, 7.23];
test('bbox snaps outward to a stable quarter-degree grid, including negative coordinates and world edges', () => {
  assert.deepEqual(snapBbox(box), [98, 7, 98.25, 7.25]);
  assert.deepEqual(snapBbox([-0.24, -0.24, -0.01, -0.01]), [-0.25, -0.25, 0, 0]);
  assert.deepEqual(snapBbox([-180, -90, 180, 90]), [-180, -90, 180, 90]);
  assert.deepEqual(snapBbox([98, 7, 99, 8]), [98, 7, 99, 8]);
  assert.throws(() => snapBbox([99, 7, 98, 8]));
  assert.throws(() => snapBbox([NaN, 7, 98, 8]));
});
test('entries expire at five minutes; a hit updates recency without extending the TTL', () => {
  let now = 0;
  const cache = createMemoryCache({ now: () => now });
  cache.set('one', { value: 1 });
  now = 299999;
  assert.deepEqual(cache.get('one'), { value: 1 });
  now = 300000;
  assert.equal(cache.get('one'), undefined);
});
test('the 200-entry bound evicts the least recently used entry across layer keys and clear removes everything', () => {
  const cache = createMemoryCache();
  for (let i = 0; i < 200; i++) cache.set(String(i), i);
  assert.equal(cache.get('0'), 0);
  cache.set('200', 200);
  assert.equal(cache.get('1'), undefined);
  assert.equal(cache.get('0'), 0);
  assert.equal(cache.size, 200);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get('0'), undefined);
});
test('filter changes clear all layers; paging retains cache; different map mounts never share entries', () => {
  const store = createMapStore();
  store.layerCache.set('sites', {});
  store.layerCache.set('surveys', {});
  store.setState((previous) => ({ ...previous, page: 2 }));
  assert.equal(store.layerCache.size, 2);
  store.setState((previous) => ({ ...previous, filters: { ...filters, q: 'new' } }));
  assert.equal(store.layerCache.size, 0);
  store.layerCache.set('sites', {});
  assert.equal(createMapStore().layerCache.size, 0);
});
test('both layer services request snapped bbox, reuse a small pan and pan-back, and fetch new areas', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return Response.json({ type: 'FeatureCollection', features: [] });
  };
  try {
    const cache = createMemoryCache();
    const signal = new AbortController().signal;
    for (const service of [sitesService, surveysService]) {
      await service.geojson(filters, box, signal, cache);
      await service.geojson(filters, [98.02, 7.03, 98.23, 7.24], signal, cache);
      await service.geojson(filters, [99.01, 8.01, 99.24, 8.24], signal, cache);
      await service.geojson(filters, box, signal, cache);
    }
    assert.equal(requests.length, 4);
    assert.deepEqual(
      requests.map((url) => new URL(url, 'http://local').searchParams.get('bbox')),
      ['98,7,98.25,7.25', '99,8,99.25,8.25', '98,7,98.25,7.25', '99,8,99.25,8.25'],
    );
    assert.equal(sitesService.geojsonKey(filters, box), sitesService.geojsonKey(filters, [98.02, 7.03, 98.23, 7.24]));
    assert.notEqual(sitesService.geojsonKey(filters, box), sitesService.geojsonKey({ ...filters, q: 'new' }, box));
    cache.clear();
    await sitesService.geojson(filters, box, signal, cache);
    assert.equal(requests.length, 5);
  } finally {
    globalThis.fetch = original;
  }
});
test('clear during a request and aborted requests cannot repopulate the cache', async () => {
  const original = globalThis.fetch;
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = () => resolve(Response.json({ features: [] }));
    });
  try {
    const cache = createMemoryCache();
    const controller = new AbortController();
    let request = sitesService.geojson(filters, box, controller.signal, cache);
    cache.clear();
    release();
    await request;
    assert.equal(cache.size, 0);
    request = sitesService.geojson(filters, box, controller.signal, cache);
    controller.abort();
    release();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(cache.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('failed responses are retried and never cached', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () =>
    ++calls === 1 ? new Response('', { status: 503 }) : Response.json({ type: 'FeatureCollection', features: [] });
  try {
    const cache = createMemoryCache();
    const signal = new AbortController().signal;
    await assert.rejects(surveysService.geojson(filters, box, signal, cache));
    assert.equal(cache.size, 0);
    await surveysService.geojson(filters, box, signal, cache);
    assert.equal(calls, 2);
    assert.equal(cache.size, 1);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(surveysService.geojson(filters, box, aborted.signal, cache), { name: 'AbortError' });
  } finally {
    globalThis.fetch = original;
  }
});
