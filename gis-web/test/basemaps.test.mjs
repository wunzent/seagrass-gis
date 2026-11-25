import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASEMAPS, DEFAULT_BASEMAP, isBasemap, basemapSource, TILE_HOSTS } from '../src/lib/basemaps.ts';
import { contentSecurityPolicy } from '../next.config.ts';

test('at least two basemaps (streets and satellite), each with tiles and attribution; streets is the default', () => {
  const ids = Object.keys(BASEMAPS);
  assert.ok(ids.length >= 2);
  assert.ok(ids.includes('streets') && ids.includes('satellite'));
  assert.equal(DEFAULT_BASEMAP, 'streets');
  for (const id of ids) {
    const source = basemapSource(id);
    assert.equal(source.type, 'raster');
    assert.equal(source.tileSize, 256);
    assert.ok(source.tiles.length >= 1 && source.tiles.every((url) => url.startsWith('https://')));
    assert.ok(source.tiles.every((url) => url.includes('{z}') && url.includes('{x}') && url.includes('{y}')));
    assert.ok(source.attribution.length > 0);
    assert.ok(BASEMAPS[id].label.length > 0);
  }
  assert.equal(isBasemap('satellite'), true);
  for (const value of ['', 'toString', '__proto__', 'Satellite', null, undefined, 1])
    assert.equal(isBasemap(value), false);
});

test('CSP allows exactly the basemap tile hosts for images and fetches', () => {
  const hosts = new Set(
    Object.values(BASEMAPS).flatMap((item) =>
      [...item.tiles, ...item.overlays.flatMap((overlay) => overlay.tiles)].map(
        (url) => new URL(url.replace(/\{[a-z]\}/g, '0')).origin,
      ),
    ),
  );
  assert.deepEqual([...TILE_HOSTS].sort(), [...hosts].sort());
  const directives = new Map(
    contentSecurityPolicy(false)
      .split('; ')
      .map((d) => [d.split(' ')[0], d]),
  );
  assert.equal(directives.get('img-src'), `img-src 'self' data: blob: ${TILE_HOSTS.join(' ')}`);
  assert.equal(directives.get('connect-src'), `connect-src 'self' ${TILE_HOSTS.join(' ')}`);
});

test('only streets and satellite remain (CARTO needs an API key); satellite overlays roads and place names', async () => {
  const { basemapOverlaySources } = await import('../src/lib/basemaps.ts');
  assert.deepEqual(Object.keys(BASEMAPS), ['streets', 'satellite']);
  assert.deepEqual(basemapOverlaySources('streets'), []);
  const overlays = basemapOverlaySources('satellite');
  assert.equal(overlays.length, 2);
  for (const source of overlays) {
    assert.equal(source.type, 'raster');
    assert.equal(source.tileSize, 256);
    assert.match(
      source.tiles[0],
      /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/Reference\/.+\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/,
    );
  }
});
