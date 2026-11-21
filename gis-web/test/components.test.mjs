import assert from 'node:assert/strict';
import { test } from 'node:test';
import { componentHarness, nodes } from './component-harness.mjs';
import { ApiError } from '../src/lib/sites.ts';
import * as mapState from '../src/lib/map-state.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));
test('session restore error retries restore while retaining the signed-in controls', () => {
  let restores = 0,
    logouts = 0;
  const h = componentHarness('../src/components/session-controls.tsx', {
    'next/link': { default: 'a', __esModule: true },
    './ui/button': { Button: 'button' },
    './session-provider': {
      useSession: () => ({
        session: { user: { email: 'a@demo.local', role: 'viewer' } },
        phase: 'ready',
        busy: null,
        logoutPending: false,
        error: 'restore failed',
        errorSource: 'restore',
        store: { restore: () => restores++, logout: () => logouts++ },
      }),
    },
  });
  const buttons = nodes(h.render(() => h.exports.SessionControls())).filter((node) => node.type === 'button');
  assert.equal(buttons.at(-1).props.children, 'ตรวจสอบผู้ใช้อีกครั้ง');
  buttons.at(-1).props.onClick();
  assert.equal(restores, 1);
  assert.equal(logouts, 0);
});
test('logout retry shows the rate-limit wait and is disabled until the store retries', () => {
  const state = {
    phase: 'ready',
    session: null,
    busy: null,
    logoutPending: true,
    error: 'unconfirmed',
    errorSource: 'logout',
    rateLimitedUntil: 91000,
    store: { logout() {} },
  };
  const h = componentHarness('../src/components/session-controls.tsx', {
    'next/link': { default: 'a', __esModule: true },
    './ui/button': { Button: 'button' },
    './session-provider': { useSession: () => state },
  });
  let button = nodes(h.render(() => h.exports.SessionControls())).find((node) => node.type === 'button');
  assert.equal(button.props.disabled, true);
  assert.equal(button.props.children, 'กรุณารอสักครู่');
  state.rateLimitedUntil = 0;
  button = nodes(h.render(() => h.exports.SessionControls())).find((node) => node.type === 'button');
  assert.equal(button.props.disabled, false);
  assert.equal(button.props.children, 'ลองออกจากระบบอีกครั้ง');
});
test('anonymous resource 401 becomes retryable error; authenticated 401 invalidates identity', async () => {
  for (const session of [null, { user: { id: 'a' } }]) {
    let unauthorized = 0,
      calls = 0;
    const h = componentHarness('../src/components/use-resource.ts', {
      './session-provider': { useSession: () => ({ session, phase: 'ready', generation: 1, busy: null, store }) },
      '../lib/sites': {
        ApiError,
        fetchJson: async () => {
          calls++;
          throw new ApiError(401);
        },
      },
    });
    const store = { isCurrent: () => true, unauthorized: () => unauthorized++ };
    h.render(() => h.exports.useResource('/api/sites', 0));
    await flush();
    const result = h.render(() => h.exports.useResource('/api/sites', 0));
    assert.equal(unauthorized, session ? 1 : 0);
    if (!session) {
      assert.equal(result.error.status, 401);
      assert.equal(result.loading, false);
      h.render(() => h.exports.useResource('/api/sites', 1));
      await flush();
      assert.equal(calls, 2);
    }
  }
});

test('invalid filters show validation without list skeleton or map loading status', () => {
  const h = componentHarness('../src/components/map-workspace.tsx', {
    'next/dynamic': { default: () => 'SiteMap', __esModule: true },
    './ui/button': { Button: 'button' },
    './session-controls': { SessionControls: 'controls' },
    './session-provider': { useSession: () => ({ generation: 1 }) },
    './use-resource': { useResource: () => ({ loading: false }) },
  });
  const Content = h.render(() => h.exports.default()).type;
  const tree = h.render(() => Content());
  nodes(tree)
    .find((node) => node.type === 'input')
    .props.onChange({ target: { value: '\0' } });
  const invalid = nodes(h.render(() => Content()));
  assert.ok(invalid.some((node) => node.props?.className === 'filter-error'));
  assert.equal(
    invalid.some((node) => node.props?.className === 'loading-state'),
    false,
  );
  assert.equal(invalid.find((node) => node.props?.className === 'map-progress').props.children, '');
});

function mapHarness(globals = {}, onDisplayChange) {
  let map;
  class FakeMap {
    events = new Map();
    values = [];
    coveringKeys = ['a', 'b'];
    coveringTiles(options) {
      assert.equal(options.tileSize, 256);
      assert.equal(options.maxzoom, 19);
      assert.equal(options.roundZoom, true);
      return this.coveringKeys.map((key) => ({ key }));
    }
    constructor() {
      map = this;
    }
    on(name, ...args) {
      this.events.set(name, args.at(-1));
    }
    emit(name, event = {}) {
      this.events.get(name)?.(event);
    }
    addControl() {}
    addSource() {}
    addLayer() {}
    getCenter() {
      return { toArray: () => [99.2, 8.1] };
    }
    getZoom() {
      return 6.2;
    }
    remove() {}
    setFilter() {}
    isSourceLoaded() {
      return true;
    }
    getSource() {
      return { setData: (data) => this.values.push(data) };
    }
    getBounds() {
      return { getWest: () => 98, getSouth: () => 6, getEast: () => 101, getNorth: () => 10 };
    }
  }
  const h = componentHarness(
    '../src/components/site-map.tsx',
    {
      'maplibre-gl': { Map: FakeMap, NavigationControl: class {}, setWorkerUrl() {} },
      '../lib/map-state': { ...mapState, debounce: (fn) => ({ run: fn, cancel() {} }) },
    },
    {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      ...globals,
    },
  );
  const render = (data) => h.render(() => h.exports.default({ data, onViewport() {}, onSelect() {}, onDisplayChange }));
  render();
  map.emit('load');
  render();
  return {
    render,
    get map() {
      return map;
    },
  };
}

test('map reports displayed data and resets the flag when the retry recreates the map', () => {
  const displayed = [];
  const h = mapHarness({}, (value) => displayed.push(value));
  const data = { type: 'FeatureCollection', features: [] };
  h.render(data);
  assert.deepEqual(displayed, [false, true]);
  h.map.emit('error', { sourceId: 'basemap', tile: { tileID: { key: 'a' } } });
  const oldMap = h.map;
  nodes(h.render())
    .find((node) => node.type === 'button')
    .props.onClick();
  h.render();
  assert.notEqual(h.map, oldMap);
  assert.equal(displayed.at(-1), false);
  h.map.emit('load');
  h.render();
  assert.equal(displayed.at(-1), false, 'no collection is displayed on the new map');
  h.render(data);
  assert.equal(displayed.at(-1), true);
});
test('map retains last polygons while viewport request is pending and replaces them on success', () => {
  const { render, map } = mapHarness();
  const data = { type: 'FeatureCollection', features: [{ properties: { code: 'a' } }] };
  render(data);
  map.emit('movestart');
  render(undefined);
  assert.equal(map.values.at(-1), data);
  const empty = { type: 'FeatureCollection', features: [] };
  render(empty);
  assert.equal(map.values.at(-1), empty);
});
test('only basemap errors show tile warning and later successful idle clears it; map is a region', () => {
  const { render, map } = mapHarness();
  const warning = () => nodes(render()).find((node) => node.props?.className === 'map-warning');
  map.emit('error', { sourceId: 'basemap', tile: { tileID: { key: 'a' } } });
  assert.ok(warning());
  map.emit('error', { sourceId: 'basemap', tile: { tileID: { key: 'b' } } });
  map.emit('idle');
  assert.ok(warning(), 'failed tiles can be loaded; failed idle must retain warning');
  map.emit('sourcedata', { sourceId: 'basemap', tile: { state: 'loaded', tileID: { key: 'other' } } });
  map.emit('idle');
  assert.ok(warning());
  map.emit('sourcedata', { sourceId: 'basemap', tile: { state: 'loaded', tileID: { key: 'a' } } });
  map.emit('idle');
  assert.ok(warning(), 'another failed tile remains');
  map.emit('sourcedata', { sourceId: 'basemap', tile: { state: 'loaded', tileID: { key: 'b' } } });
  map.emit('idle');
  assert.equal(warning(), undefined);
  const canvas = nodes(render()).find((node) => node.props?.className === 'map-canvas');
  assert.equal(canvas.props.role, 'region');
});

test('basemap idle prunes failed tiles outside the current viewport only', () => {
  const { render, map } = mapHarness();
  const warning = () => nodes(render()).find((node) => node.props?.className === 'map-warning');
  for (const key of ['a', 'b']) map.emit('error', { sourceId: 'basemap', tile: { tileID: { key } } });
  map.coveringKeys = ['b', 'c'];
  map.emit('idle');
  assert.ok(warning(), 'visible failed tile still needs recovery');
  map.coveringKeys = ['c'];
  map.emit('idle');
  assert.equal(warning(), undefined, 'offscreen failures must not keep the warning');
});

test('non-basemap errors retain MapLibre console error reporting', () => {
  const logged = [];
  const { render, map } = mapHarness({ console: { error: (error) => logged.push(error) } });
  const error = new Error('source failed');
  map.emit('error', { sourceId: 'sites', error });
  map.emit('error', { error });
  assert.deepEqual(logged, [error, error]);
  assert.equal(
    nodes(render()).some((node) => node.props?.className === 'map-warning'),
    false,
  );
});

test('map stale notice starts only after a collection and stays stable through viewport updates', () => {
  let resource = { loading: true };
  const h = componentHarness('../src/components/map-workspace.tsx', {
    'next/dynamic': { default: () => 'SiteMap', __esModule: true },
    './ui/button': { Button: 'button' },
    './session-controls': { SessionControls: 'controls' },
    './session-provider': { useSession: () => ({ generation: 1 }) },
    './use-resource': { useResource: (url) => (url?.startsWith('/api/sites.geojson') ? resource : { loading: false }) },
  });
  const Content = h.render(() => h.exports.default()).type;
  const render = () => nodes(h.render(() => Content()));
  const progress = (tree) => tree.find((node) => node.props?.className === 'map-progress').props;
  let tree = render();
  assert.equal(progress(tree).children, 'กำลังปรับขอบเขต / โหลดข้อมูล…');
  assert.equal(progress(tree)['aria-live'], 'polite');
  tree.find((node) => node.type === 'SiteMap').props.onViewport([98, 6, 101, 10]);
  resource = { data: { type: 'FeatureCollection', features: [] }, loading: false };
  render()
    .find((node) => node.type === 'SiteMap')
    .props.onDisplayChange(true);
  resource = { loading: true };
  tree = render();
  const text = progress(tree).children;
  assert.match(text, /พื้นที่เดิมอาจไม่ใช่ข้อมูลล่าสุด/);
  tree.find((node) => node.type === 'SiteMap').props.onViewport(null);
  tree = render();
  assert.equal(progress(tree).children, text);
  tree.find((node) => node.type === 'SiteMap').props.onViewport([99, 7, 102, 11]);
  assert.equal(progress(render()).children, text);
  // SiteMap reports a fresh map with no displayed collection after its retry button remounts it.
  tree.find((node) => node.type === 'SiteMap').props.onDisplayChange?.(false);
  assert.equal(progress(render()).children, 'กำลังปรับขอบเขต / โหลดข้อมูล…');
});
