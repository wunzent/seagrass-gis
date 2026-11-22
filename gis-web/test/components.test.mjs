import assert from 'node:assert/strict';
import { test } from 'node:test';
import { componentHarness, nodes } from './component-harness.mjs';
import { ApiError } from '../src/lib/sites.ts';
import * as mapState from '../src/lib/map-state.ts';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function loginHarness(roles) {
  const calls = [];
  const state = {
    session: null,
    phase: 'ready',
    busy: null,
    logoutPending: false,
    error: '',
    store: {
      demoRoles: async () => roles,
      demoLogin: async (role) => {
        calls.push(role);
        return true;
      },
    },
  };
  const h = componentHarness('../src/components/login-form.tsx', {
    'next/link': { default: 'a', __esModule: true },
    'next/navigation': { useRouter: () => ({ replace: (path) => calls.push(path) }) },
    './ui/button': { Button: 'button' },
    './session-controls': { SessionControls: 'controls' },
    './session-provider': { useSession: () => state },
  });
  return { state, calls, render: () => nodes(h.render(() => h.exports.LoginForm())) };
}

test('login demo buttons appear in role order with descriptions and Editor navigates home', async () => {
  const h = loginHarness(['admin', 'viewer', 'editor']);
  h.render();
  await flush();
  const tree = h.render();
  const buttons = tree.filter((n) => n.type === 'button' && n.props.type === 'button');
  assert.equal(buttons.length, 3);
  const copy = (button) =>
    nodes(button)
      .map((n) => n.props.children)
      .flat()
      .filter((c) => typeof c === 'string')
      .join(' ');
  for (const [i, role, description] of [
    [0, 'Viewer', 'อ่านข้อมูล และเห็นผู้บันทึก'],
    [1, 'Editor', 'แก้ชื่อแหล่ง และจัดการ survey'],
    [2, 'Admin', 'จัดการแหล่งทั้งหมด'],
  ]) {
    assert.ok(copy(buttons[i]).includes(role));
    assert.ok(copy(buttons[i]).includes(description));
  }
  assert.ok(tree.some((n) => n.props?.children === 'บัญชีสาธิต กดเพื่อเข้าสู่ระบบทันที'));
  assert.ok(tree.some((n) => n.props?.children === 'หรือกรอกเอง'));
  await buttons[1].props.onClick();
  assert.deepEqual(h.calls, ['editor', '/']);
  h.state.busy = 'login';
  assert.ok(
    h
      .render()
      .filter((n) => n.type === 'button')
      .every((n) => n.props.disabled),
  );
});

test('clicked demo role shows progress and group busy until login settles', async () => {
  const h = loginHarness(['viewer', 'editor', 'admin']);
  let resolve;
  h.state.store.demoLogin = () =>
    new Promise((done) => {
      resolve = done;
    });
  h.render();
  await flush();
  const buttons = () => h.render().filter((n) => n.type === 'button' && n.props.type === 'button');
  const group = () => h.render().find((n) => n.props.role === 'group');
  assert.equal(group().props['aria-busy'], false);
  const pending = buttons()[1].props.onClick();
  h.state.busy = 'login';
  assert.equal(group().props['aria-busy'], true);
  assert.equal(buttons()[1].props.children[0].props.children, 'กำลังเข้าสู่ระบบ…');
  assert.equal(buttons()[1].props['aria-label'], 'Editor');
  assert.equal(buttons()[0].props.children[0].props.children, 'Viewer');
  assert.equal(buttons()[2].props.children[0].props.children, 'Admin');
  assert.ok(
    h
      .render()
      .filter((n) => n.type === 'button')
      .every((n) => n.props.disabled),
  );
  resolve(true);
  await pending;
  h.state.busy = null;
  assert.equal(group().props['aria-busy'], false);
  assert.equal(buttons()[1].props.children[0].props.children, 'Editor');
});

test('unavailable demo roles leave the original form with no demo buttons or error', async () => {
  const h = loginHarness(null);
  h.render();
  await flush();
  const tree = h.render();
  assert.equal(tree.filter((n) => n.type === 'button').length, 1);
  assert.equal(
    tree.some((n) => n.props?.role === 'alert'),
    false,
  );
  assert.equal(tree.filter((n) => n.type === 'input').length, 2);
});

test('bright map preserves OSM paint and uses primary survey marks and selected outline', () => {
  const { map } = mapHarness();
  const raster = map.layers.find((layer) => layer.type === 'raster');
  assert.ok(raster);
  assert.equal(
    Object.keys(raster.paint ?? {}).some((key) => /^raster-(saturation|contrast|brightness)/.test(key)),
    false,
  );
  const points = map.layers.filter((layer) => layer.type === 'circle');
  assert.equal(points.length, 3);
  for (const point of points) {
    const selected = point.id.includes('selected');
    assert.equal(point.paint['circle-color'], selected ? '#0077B6' : '#FFFFFF');
    assert.equal(point.paint['circle-stroke-color'], selected ? '#FFFFFF' : '#0077B6');
  }
  assert.equal(map.layers.find((layer) => layer.id === 'selected').paint['line-color'], '#0077B6');
});
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

function mapHarness(globals = {}, onDisplayChange, onSelect = () => {}) {
  let map;
  class FakeMap {
    events = new Map();
    values = [];
    sources = new Map();
    layers = [];
    coveringKeys = ['a', 'b'];
    coveringTiles(options) {
      assert.equal(options.tileSize, 256);
      assert.equal(options.maxzoom, 19);
      assert.equal(options.roundZoom, true);
      return this.coveringKeys.map((key) => ({ key }));
    }
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- test double captures the constructed map instance
      map = this;
    }
    on(name, ...args) {
      this.events.set(args.length > 1 ? `${name}:${args[0]}` : name, args.at(-1));
    }
    emit(name, event = {}) {
      this.events.get(name)?.(event);
    }
    addControl() {}
    addSource(id, source) {
      this.sources.set(id, {
        ...source,
        setData(data) {
          this.data = data;
        },
      });
    }
    addLayer(layer) {
      this.layers.push(layer);
    }
    getCanvas() {
      return (this.canvas ??= { style: {} });
    }
    queryRenderedFeatures(point, options) {
      const layers = Array.from(options.layers);
      if (layers.includes('surveys-circle')) {
        assert.deepEqual(layers, ['surveys-circle']);
        return this.clickedPoints ?? [];
      }
      assert.deepEqual(layers, ['sites-fill', 'sites-nodata']);
      return this.clickedFeatures ?? [];
    }
    addImage() {}
    project() {
      return this.point ?? { x: 0, y: 0 };
    }
    getCenter() {
      return { toArray: () => [99.2, 8.1] };
    }
    getZoom() {
      return 6.2;
    }
    remove() {}
    setFilter() {}
    fits = [];
    fitBounds(bounds) {
      this.fits.push(bounds);
    }
    container = { clientWidth: 800, clientHeight: 600 };
    getContainer() {
      return this.container;
    }
    resize() {}
    isSourceLoaded() {
      return true;
    }
    getSource(id) {
      if (id !== 'sites') return this.sources.get(id);
      return { setData: (data) => this.values.push(data) };
    }
    getBounds() {
      return { getWest: () => 98, getSouth: () => 6, getEast: () => 101, getNorth: () => 10 };
    }
  }
  const h = componentHarness(
    '../src/components/site-map.tsx',
    {
      'maplibre-gl': { Map: FakeMap, NavigationControl: class {}, ScaleControl: class {}, setWorkerUrl() {} },
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
  const render = (data, extra = {}) =>
    h.render(() => h.exports.default({ data, onViewport() {}, onSelect, onDisplayChange, ...extra }));
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

function provinceWorkspace(provinces) {
  const h = componentHarness('../src/components/map-workspace.tsx', {
    'next/dynamic': { default: () => 'SiteMap', __esModule: true },
    './ui/button': { Button: 'button' },
    './session-controls': { SessionControls: 'controls' },
    './session-provider': { useSession: () => ({ generation: 1 }) },
    './use-resource': {
      useResource: (url) => {
        if (url === '/api/provinces.geojson') return provinces;
        if (url?.startsWith('/api/sites?')) {
          return {
            data: {
              items: [{ code: 'S1', name: 'แหล่ง', province_code: '81', area_rai: 1, status: 'no_data', version: 1 }],
              total: 1,
              page: 1,
            },
            loading: false,
          };
        }
        return { loading: false };
      },
    },
  });
  const Content = h.render(() => h.exports.default()).type;
  const render = () => nodes(h.render(() => Content()));
  const provinceCell = () => {
    render()
      .find((node) => node.props?.className === 'nav-item' && node.props.children === 'ตารางแหล่งหญ้าทะเล')
      .props.onClick();
    return render().filter((node) => node.type === 'td')[2].props.children;
  };
  return { h, render, Content, provinceCell };
}

test('province select options and labels come from the provinces API, falling back to the code on failure', () => {
  const feature = (code, name_th) => ({ type: 'Feature', geometry: null, properties: { code, name_th } });
  const loaded = provinceWorkspace({
    data: { type: 'FeatureCollection', features: [feature('81', 'กระบี่'), feature('92', 'ตรัง')] },
    loading: false,
  });
  const provinceSelect = (tree) => tree.find((node) => node.type === 'select');
  const options = (tree) =>
    nodes(provinceSelect(tree))
      .filter((node) => node.type === 'option')
      .map((option) => [option.props.value, option.props.children]);
  assert.deepEqual(options(loaded.render()), [
    ['', 'ทุกจังหวัด'],
    ['81', 'กระบี่'],
    ['92', 'ตรัง'],
  ]);
  assert.equal(loaded.provinceCell(), 'กระบี่');

  const failed = provinceWorkspace({ error: new Error('offline'), loading: false });
  assert.deepEqual(options(failed.render()), [['', 'ทุกจังหวัด']]);
  assert.equal(failed.provinceCell(), '81');

  const loading = provinceWorkspace({ loading: true });
  assert.deepEqual(options(loading.render()), [['', 'ทุกจังหวัด']]);
  assert.equal(loading.provinceCell(), '81');

  provinceSelect(failed.render()).props.onChange({ target: { value: '92' } });
  assert.deepEqual(options(failed.render()), [
    ['', 'ทุกจังหวัด'],
    ['92', '92'],
  ]);
});

test('province outlines stay below sites and points remain above sites through empty and pending updates', () => {
  const selected = [];
  const { render, map } = mapHarness({}, undefined, (code) => selected.push(code));
  const provinces = { type: 'FeatureCollection', features: [{ properties: { code: '81' } }] };
  const surveys = { type: 'FeatureCollection', features: [{ properties: { site_code: 'S1' } }] };
  const empty = { type: 'FeatureCollection', features: [] };
  render(empty, { provinces, surveys });
  const ids = map.layers.map((layer) => layer.id);
  assert.equal(ids.filter((id) => id === 'provinces-line').length, 1);
  assert.ok(ids.indexOf('provinces-line') < ids.indexOf('sites-fill'));
  assert.ok(ids.indexOf('surveys-circle') > ids.indexOf('sites-fill'));
  assert.equal(map.sources.get('provinces').data, provinces);
  assert.equal(map.sources.get('surveys').data, surveys);
  render(undefined);
  assert.equal(map.sources.get('surveys').data, surveys);
  render(empty, { surveys: empty });
  assert.equal(map.sources.get('provinces').data, provinces);
  assert.equal(map.sources.get('surveys').data, empty);
  assert.ok(ids.indexOf('sites-nodata') > ids.indexOf('sites-fill'), 'hatched no_data sites are their own layer');
  map.clickedFeatures = [{ properties: { code: 'S2' } }];
  map.emit('click', { point: { x: 10, y: 10 } });
  assert.deepEqual(selected, ['S2']);
});

function historyWorkspace() {
  const document = { body: {} };
  document.activeElement = document.body;
  let history = { data: { items: [], total: 0, page: 1 }, loading: false };
  const resources = new Map();
  const calls = [];
  const provinces = { type: 'FeatureCollection', features: [] };
  const h = componentHarness(
    '../src/components/map-workspace.tsx',
    {
      'next/dynamic': { default: () => 'SiteMap', __esModule: true },
      './ui/button': { Button: 'button' },
      './session-controls': { SessionControls: 'controls' },
      './session-provider': { useSession: () => ({ generation: 1 }) },
      '../lib/map-state': { ...mapState, debounce: (fn) => ({ run: fn, cancel() {} }) },
      './use-resource': {
        useResource: (url, retry) => {
          calls.push({ url, retry });
          for (const [prefix, resource] of resources) if (url?.startsWith(prefix)) return resource;
          if (url === '/api/provinces.geojson') return { data: provinces };
          if (url?.includes('/surveys?')) return history;
          if (/^\/api\/sites\/[^?]+$/.test(url ?? ''))
            return {
              data: {
                properties: {
                  code: url.split('/').at(-1),
                  name: 'Site',
                  province_code: '81',
                  area_rai: 1,
                  status: 'good',
                },
              },
            };
          return { loading: false };
        },
      },
    },
    { document },
  );
  const Content = h.render(() => h.exports.default()).type;
  const render = () => {
    calls.length = 0;
    return nodes(h.render(() => Content()));
  };
  return {
    render,
    document,
    host: h.host,
    calls,
    provinces,
    setResource(prefix, value) {
      resources.set(prefix, value);
    },
    setHistory(value) {
      history = value;
    },
  };
}
const mapNode = (tree) => tree.find((node) => node.type === 'SiteMap');
const textOf = (tree) =>
  nodes(tree)
    .flatMap((node) => [node.props?.children])
    .flat(Infinity)
    .filter((value) => typeof value === 'string')
    .join(' ');

test('workspace shares province resource and exact bounded filters with survey points', () => {
  const w = historyWorkspace();
  let tree = w.render();
  assert.equal(mapNode(tree).props.provinces, w.provinces);
  mapNode(tree).props.onViewport([98, 6, 101, 10]);
  tree.find((node) => node.type === 'select').props.onChange({ target: { value: '81' } });
  tree = w.render();
  tree.filter((node) => node.type === 'select')[1].props.onChange({ target: { value: 'good' } });
  tree = w.render();
  tree.find((node) => node.type === 'input').props.onChange({ target: { value: 'reef' } });
  tree = w.render();
  const sites = w.calls.find(({ url }) => url?.startsWith('/api/sites.geojson?')).url;
  const points = w.calls.find(({ url }) => url?.startsWith('/api/surveys.geojson?')).url;
  assert.equal(points.split('?')[1], sites.split('?')[1]);
  assert.match(points, /province=81&status=good&q=reef&bbox=/);
  assert.equal(w.calls.filter(({ url }) => url === '/api/provinces.geojson').length, 1);
  assert.match(textOf(tree), /จุดสำรวจ/);
  mapNode(tree).props.onViewport(null);
  w.render();
  assert.equal(
    w.calls.some(({ url }) => url?.startsWith('/api/surveys.geojson?')),
    false,
  );
});

test('site popup summarises survey rounds from one request and reloads for a new selection', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onSelect('S1');
  const survey = (id, surveyed_on, cover_percent) => ({ id, surveyed_on, cover_percent, species: [], note: null });
  w.setHistory({
    data: {
      items: [survey('a', '2026-06-24', 50), survey('b', '2026-06-24', 45), survey('c', '2025-03-28', 87)],
      total: 3,
      page: 1,
    },
    loading: false,
  });
  const tree = w.render();
  assert.ok(w.calls.some(({ url }) => url === '/api/sites/S1/surveys?page=1&pageSize=100'));
  const rounds = tree.find((node) => node.props?.className === 'round-list');
  const items = nodes(rounds).filter((node) => node.type === 'li');
  assert.deepEqual(
    items.map((item) => item.key),
    ['2026-06-24', '2025-03-28'],
    'newest round first',
  );
  const allText = (node) =>
    nodes(node)
      .flatMap((item) => [item.props?.children])
      .flat(Infinity)
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .join('')
      .replace(/\s/g, '');
  assert.match(allText(items[0]), /47\.5%\(2จุด\)/);
  assert.match(allText(items[1]), /87%\(1จุด\)/);
  assert.equal(
    tree.some((node) => node.props?.className === 'note'),
    false,
  );
  w.setHistory({ data: { items: [survey('a', '2026-06-24', 50)], total: 140, page: 1 }, loading: false });
  assert.match(allText(w.render()), /รอบนี้อาจแสดงข้อมูลไม่ครบจาก1จุดล่าสุดจากทั้งหมด140จุด/);
  mapNode(w.render()).props.onSelect('S2');
  w.render();
  assert.ok(w.calls.some(({ url }) => url === '/api/sites/S2/surveys?page=1&pageSize=100'));
});

test('clicking a survey point opens its own popup with its fields, creator only when present', () => {
  const w = historyWorkspace();
  const point = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [98.64326, 8.12352] },
    properties: {
      id: '17',
      site_code: 'S1',
      surveyed_on: '2025-03-28',
      cover_percent: 87,
      species: ['TH'],
      note: null,
      created_by: { id: 'u', email: 'recorder@example.test' },
    },
  };
  w.setResource('/api/surveys.geojson', { data: { type: 'FeatureCollection', features: [point] }, loading: false });
  let tree = w.render();
  mapNode(tree).props.onViewport([98, 7, 99, 9]);
  tree = w.render();
  mapNode(tree).props.onSelectSurvey('17');
  tree = w.render();
  const dialog = tree.find((node) => node.props?.role === 'dialog');
  const text = textOf(dialog);
  for (const value of [
    'จุดสำรวจ 2025-03-28',
    'S1',
    '87',
    'TH',
    'ไม่มี',
    'recorder@example.test',
    '98.64326',
    '8.12352',
  ])
    assert.ok(text.includes(value), value);
  assert.equal(mapNode(tree).props.selectedSurveyId, '17');
  assert.deepEqual(JSON.parse(JSON.stringify(mapNode(tree).props.popup)), {
    key: 'survey:17',
    point: [98.64326, 8.12352],
  });
  assert.equal(
    w.calls.some(({ url }) => url?.startsWith('/api/sites/S1')),
    false,
    'no extra request for a point',
  );
  tree
    .find((node) => node.props?.className === 'text-button' && textOf(node).includes('ดูรายละเอียดแหล่ง'))
    .props.onClick();
  tree = w.render();
  assert.equal(mapNode(tree).props.popup.key, 'site:S1');
  assert.equal(mapNode(tree).props.selectedSurveyId, null);

  point.properties = { ...point.properties, id: '18', created_by: undefined };
  w.render();
  mapNode(w.render()).props.onSelectSurvey('18');
  assert.equal(textOf(w.render()).includes('ผู้บันทึก'), false);
});

test('history has loading, empty, error and retry states', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onSelect('S1');
  assert.match(textOf(w.render()), /ยังไม่มีข้อมูลการสำรวจ/);
  w.setHistory({ loading: true });
  assert.match(textOf(w.render()), /กำลังโหลดประวัติการสำรวจ/);
  w.setHistory({ error: new Error('offline'), loading: false });
  let tree = w.render();
  const failure = tree.find((node) => typeof node.type === 'function' && node.props?.error?.message === 'offline');
  assert.ok(failure);
  const before = w.calls.find(({ url }) => url?.includes('/surveys?')).retry;
  failure.props.retry();
  w.render();
  assert.equal(w.calls.find(({ url }) => url?.includes('/surveys?')).retry, before + 1);
});

test('history resource drops old pages, selections and creator data across identity changes', async () => {
  let generation = 1;
  let session = { user: { id: 'u' } };
  const pending = [];
  const store = { isCurrent: (value) => value === generation };
  const h = componentHarness('../src/components/use-resource.ts', {
    './session-provider': { useSession: () => ({ session, phase: 'ready', generation, busy: null, store }) },
    '../lib/sites': {
      ApiError,
      fetchJson: (url, signal) => new Promise((resolve) => pending.push({ url, signal, resolve })),
    },
  });
  const render = (url) => h.render(() => h.exports.useResource(url, 0));
  const page1 = '/api/sites/S1/surveys?page=1&pageSize=5';
  const page2 = '/api/sites/S1/surveys?page=2&pageSize=5';
  const other = '/api/sites/S2/surveys?page=1&pageSize=5';
  const privateData = { items: [{ id: 'a', created_by: { email: 'private@example.test' } }], total: 1, page: 1 };
  render(page1);
  pending[0].resolve(privateData);
  await flush();
  assert.equal(render(page1).data.items[0].created_by.email, 'private@example.test');
  assert.equal(render(page2).data, undefined);
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(render(other).data, undefined);
  pending[1].resolve(privateData);
  await flush();
  assert.equal(render(other).data, undefined, 'late old-page response must not show');
  generation = 2;
  session = null;
  assert.equal(render(other).data, undefined);
  pending[2].resolve(privateData);
  await flush();
  assert.equal(render(other).data, undefined, 'late signed-in response must not show');
  pending[3].resolve(privateData);
  await flush();
  assert.equal(render(other).data.items[0].created_by, undefined);
});

for (const kind of ['list']) {
  test(`${kind} pagination preserves host instances and keyboard focus through loading and boundaries`, () => {
    const w = historyWorkspace();
    const label = kind === 'history' ? 'หน้าประวัติการสำรวจ' : 'หน้ารายการแหล่ง';
    if (kind === 'history') mapNode(w.render()).props.onSelect('S1');
    const set = (value) => (kind === 'history' ? w.setHistory(value) : w.setResource('/api/sites?', value));
    const pageSize = kind === 'history' ? 5 : mapState.PAGE_SIZE;
    const total = pageSize * 3;
    set({ data: { items: [], total, page: 1 }, loading: false });
    w.render(); // commit pagination metadata
    let tree = w.render();
    const getNav = () => tree.find((node) => node.props?.['aria-label'] === label);
    const getButtons = () => nodes(getNav()).filter((node) => node.type === 'button');
    const navHost = w.host(getNav());
    const buttonHosts = getButtons().map(w.host);
    assert.equal(getButtons()[0].props.disabled, true);
    assert.equal(getButtons()[1].props.disabled, false);
    const focused = getButtons()[1];
    buttonHosts[1].focus();
    focused.props.onClick();
    set({ loading: true });
    tree = w.render();
    const loadingNav = getNav();
    assert.ok(loadingNav, 'pagination must stay mounted');
    const buttons = nodes(loadingNav).filter((node) => node.type === 'button');
    assert.equal(w.host(loadingNav), navHost);
    buttons.forEach((button, i) => assert.equal(w.host(button), buttonHosts[i]));
    assert.ok(
      buttons.every((button) => !button.props.disabled),
      'loading must not natively disable buttons',
    );
    assert.ok(buttons.every((button) => button.props['aria-disabled'] === true));
    assert.equal(w.document.activeElement, buttonHosts[1]);
    const pageLabel = nodes(loadingNav).find((node) => node.type === 'span').props.children;
    assert.deepEqual(Array.from(pageLabel), ['หน้า ', 1, ' / ', 3]);
    for (const button of buttons) {
      button.props.onClick();
      tree = w.render();
      assert.ok(
        w.calls.some(({ url }) => url?.includes(kind === 'history' ? '/surveys?page=2&' : '/api/sites?page=2&')),
      );
    }
    set({ data: { items: [], total, page: 2 }, loading: false });
    tree = w.render();
    assert.equal(w.host(getNav()), navHost);
    assert.equal(w.host(getButtons()[1]), buttonHosts[1]);
    assert.equal(w.document.activeElement, buttonHosts[1]);
    getButtons()[1].props.onClick();
    set({ loading: true });
    tree = w.render();
    assert.equal(w.document.activeElement, buttonHosts[1]);
    set({ data: { items: [], total, page: 3 }, loading: false });
    tree = w.render();
    assert.equal(w.host(getButtons()[1]), buttonHosts[1]);
    assert.equal(getButtons()[1].props.disabled, true);
    assert.equal(w.document.activeElement, buttonHosts[0], 'last page transfers focus to Previous');
    getButtons()[0].props.onClick();
    set({ loading: true });
    tree = w.render();
    set({ data: { items: [], total, page: 2 }, loading: false });
    tree = w.render();
    getButtons()[0].props.onClick();
    set({ loading: true });
    tree = w.render();
    set({ data: { items: [], total, page: 1 }, loading: false });
    tree = w.render();
    assert.equal(getButtons()[0].props.disabled, true);
    assert.equal(w.document.activeElement, buttonHosts[1], 'first page transfers focus to Next');
    getButtons()[1].props.onClick();
    set({ loading: true });
    tree = w.render();
    // Leaving the nav while waiting must not steal focus back on completion.
    const outside = w.host(tree.find((node) => node.type === 'input'));
    outside.focus();
    set({ data: { items: [], total: pageSize + 1, page: 2 }, loading: false });
    tree = w.render();
    assert.equal(w.document.activeElement, outside);
    // A changed total can leave neither direction enabled: focus the status.
    buttonHosts[0].focus();
    getButtons()[0].props.onClick();
    set({ loading: true });
    tree = w.render();
    set({ data: { items: [], total: 0, page: 1 }, loading: false });
    tree = w.render();
    assert.equal(w.document.activeElement, w.host(nodes(getNav()).find((node) => node.type === 'span')));
  });
}

test('survey-only data reports a displayed collection', () => {
  const displayed = [];
  const h = mapHarness({}, (value, layer) => displayed.push([value, layer]));
  h.render(undefined, { surveys: { type: 'FeatureCollection', features: [] } });
  assert.deepEqual(displayed, [
    [false, undefined],
    [true, 'surveys'],
  ]);
});

test('list pagination ignores clicks and is aria-disabled while a filter validation error exists', () => {
  const w = historyWorkspace();
  const total = mapState.PAGE_SIZE * 3;
  w.setResource('/api/sites?', { data: { items: [], total, page: 1 }, loading: false });
  let tree = w.render();
  const getNav = () => tree.find((node) => node.props?.['aria-label'] === 'หน้ารายการแหล่ง');
  const getButtons = () => nodes(getNav()).filter((node) => node.type === 'button');
  assert.equal(getButtons()[1].props.disabled, false);
  tree.find((node) => node.type === 'input').props.onChange({ target: { value: '\0' } });
  tree = w.render();
  assert.ok(tree.some((node) => node.props?.className === 'filter-error'));
  assert.ok(getButtons().every((button) => button.props['aria-disabled'] === true));
  w.calls.length = 0;
  getButtons()[1].props.onClick();
  tree = w.render();
  assert.equal(
    w.calls.some(({ url }) => url?.includes('/api/sites?page=2&')),
    false,
    'validation error must block list pagination clicks',
  );
});

test('cursor stays a pointer moving from a survey point to a polygon, and clears over water', () => {
  const { map } = mapHarness();
  const filters = [];
  map.setFilter = (layer, filter) => {
    if (layer === 'surveys-hover') filters.push(JSON.parse(JSON.stringify(filter)).at(-1));
  };
  map.clickedPoints = [{ properties: { id: 7, site_code: 'S1' }, geometry: { coordinates: [98, 7] } }];
  map.point = { x: 13, y: 10 };
  map.emit('mousemove', { point: { x: 10, y: 10 } });
  assert.equal(map.getCanvas().style.cursor, 'pointer');
  assert.equal(filters.at(-1), '7', 'hovered point is enlarged');
  map.clickedPoints = [];
  map.clickedFeatures = [{ properties: { code: 'S2' } }];
  map.emit('mousemove', { point: { x: 10, y: 10 } });
  assert.equal(map.getCanvas().style.cursor, 'pointer');
  assert.equal(filters.at(-1), '');
  map.clickedFeatures = [];
  map.emit('mousemove', { point: { x: 10, y: 10 } });
  assert.equal(map.getCanvas().style.cursor, '');
});

test('layer failures share one named banner and retry only failing layers with accurate stale copy', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onViewport([98, 6, 101, 10]);
  const pointsUrl = '/api/surveys.geojson?';
  const sitesUrl = '/api/sites.geojson?';
  const failure = (tree) => tree.filter((node) => typeof node.type === 'function' && node.props?.error);
  const retries = () =>
    [sitesUrl, pointsUrl].map((prefix) => w.calls.find((call) => call.url?.startsWith(prefix)).retry);
  mapNode(w.render()).props.onDisplayChange(true, 'sites');
  mapNode(w.render()).props.onDisplayChange(true, 'surveys');
  w.setResource(sitesUrl, { data: { type: 'FeatureCollection', features: [] }, loading: false });
  w.setResource(pointsUrl, { error: new Error('offline'), loading: false });
  let tree = w.render();
  assert.equal(failure(tree).length, 1);
  assert.equal(failure(tree)[0].props.error.message, 'โหลดจุดสำรวจไม่สำเร็จ');
  const progress = tree.find((node) => node.props?.className === 'map-progress').props.children;
  assert.match(progress, /จุดสำรวจเดิม/);
  assert.doesNotMatch(progress, /พื้นที่เดิม/);
  const before = retries();
  failure(tree)[0].props.retry();
  w.render();
  assert.deepEqual(retries(), [before[0], before[1] + 1]);
  w.setResource(sitesUrl, { error: new Error('offline'), loading: false });
  tree = w.render();
  assert.equal(failure(tree).length, 1);
  assert.equal(failure(tree)[0].props.error.message, 'โหลดพื้นที่และจุดสำรวจไม่สำเร็จ');
  const bothBefore = retries();
  failure(tree)[0].props.retry();
  w.render();
  assert.deepEqual(
    retries(),
    bothBefore.map((value) => value + 1),
  );
  const legend = tree.find((node) => node.props?.['aria-label'] === 'คำอธิบายแผนที่');
  assert.ok(legend);
  const entries = nodes(legend).filter((node) => node.type === 'li');
  assert.equal(entries.length, 6, 'five statuses plus the survey mark');
  assert.match(textOf(legend), /ดีมาก/);
});

test('history 404 before detail resolves does not flash a retry banner', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onSelect('missing');
  w.setResource('/api/sites/missing', { loading: true });
  w.setHistory({ error: new ApiError(404), loading: false });
  assert.equal(
    w.render().some((node) => typeof node.type === 'function' && node.props?.error),
    false,
  );
});

const square = {
  type: 'Feature',
  properties: { code: 'S1' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [98, 7],
        [99, 7],
        [99, 8],
        [98, 7],
      ],
    ],
  },
};
test('selection made while the map is hidden (zero size) fits once the map is resized visible', () => {
  let resized;
  const h = mapHarness({
    ResizeObserver: class {
      constructor(callback) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  h.map.container = { clientWidth: 0, clientHeight: 0 };
  resized();
  h.render(undefined, { selection: square });
  assert.equal(h.map.fits.length, 0, 'zero-size canvas cannot fit');
  h.map.container = { clientWidth: 375, clientHeight: 300 };
  resized();
  assert.deepEqual(JSON.parse(JSON.stringify(h.map.fits)), [
    [
      [98, 7],
      [99, 8],
    ],
  ]);
  resized();
  h.render(undefined, { selection: square });
  assert.equal(h.map.fits.length, 1, 'an already fitted selection is not refitted');
});

test('map reports unavailable when MapLibre cannot start and available again on retry', () => {
  const reports = [];
  let fail = true;
  const h = componentHarness(
    '../src/components/site-map.tsx',
    {
      'maplibre-gl': {
        Map: class {
          constructor() {
            if (fail) throw new Error('no WebGL');
          }
          addControl() {}
          on() {}
          remove() {}
          getCenter() {
            return { toArray: () => [99.2, 8.1] };
          }
          getZoom() {
            return 6.2;
          }
        },
        NavigationControl: class {},
        ScaleControl: class {},
        setWorkerUrl() {},
      },
      '../lib/map-state': { ...mapState, debounce: (fn) => ({ run: fn, cancel() {} }) },
    },
    {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
  );
  const render = () =>
    h.render(() =>
      h.exports.default({ onViewport() {}, onSelect() {}, onAvailabilityChange: (value) => reports.push(value) }),
    );
  render();
  assert.equal(reports.at(-1), false);
  fail = false;
  nodes(render())
    .find((node) => node.type === 'button')
    .props.onClick();
  render();
  assert.equal(reports.at(-1), true);
});

test('unavailable map drops the loading text and aria-busy from the map panel', () => {
  const w = historyWorkspace();
  const panel = (tree) => tree.find((node) => node.props?.['aria-labelledby'] === 'map-heading');
  assert.equal(panel(w.render())['props']['aria-busy'], true);
  mapNode(w.render()).props.onAvailabilityChange?.(false);
  const tree = w.render();
  assert.equal(panel(tree).props['aria-busy'], false);
  assert.equal(tree.find((node) => node.props?.className === 'map-progress').props.children, '');
});

const siteRows = {
  data: {
    items: [{ code: 'S1', name: 'Site', province_code: '81', area_rai: 1, status: 'good' }],
    total: 1,
    page: 1,
  },
  loading: false,
};
const byClass = (tree, name) => tree.find((node) => node.props?.className?.split?.(' ').includes(name));
const navItem = (tree, label) =>
  tree.find((node) => node.props?.className === 'nav-item' && node.props.children === label);

test('top menu switches between the map and the table view and marks the current one', () => {
  const w = historyWorkspace();
  w.setResource('/api/sites?', siteRows);
  let tree = w.render();
  assert.equal(navItem(tree, 'แผนที่').props['aria-current'], 'page');
  assert.equal(navItem(tree, 'ตารางแหล่งหญ้าทะเล').props['aria-current'], undefined);
  assert.ok(byClass(tree, 'sidebar'), 'filters and list sit in the map sidebar');
  assert.equal(byClass(tree, 'table-view'), undefined);
  navItem(tree, 'ตารางแหล่งหญ้าทะเล').props.onClick();
  tree = w.render();
  assert.equal(navItem(tree, 'ตารางแหล่งหญ้าทะเล').props['aria-current'], 'page');
  assert.ok(byClass(tree, 'table-view'));
  assert.ok(byClass(tree, 'map-layout').props.className.includes('view-hidden'), 'map stays mounted, hidden');
  assert.equal(byClass(tree, 'sidebar'), undefined, 'one set of filter controls at a time');
  assert.equal(tree.filter((node) => node.type === 'select').length, 2);
  assert.equal(
    tree.some((node) => node.props?.role === 'dialog'),
    false,
    'no popup until a site is selected',
  );
});

test('choosing a site from the list opens the map popup with focus on its heading; Escape closes it', () => {
  const w = historyWorkspace();
  w.setResource('/api/sites?', siteRows);
  let tree = w.render();
  navItem(tree, 'ตารางแหล่งหญ้าทะเล').props.onClick();
  tree = w.render();
  tree.find((node) => node.props?.className === 'table-link').props.onClick();
  tree = w.render();
  assert.ok(!byClass(tree, 'map-layout').props.className.includes('view-hidden'), 'switched to the map');
  const dialog = tree.find((node) => node.props?.role === 'dialog');
  assert.equal(dialog.props['aria-labelledby'], 'detail-heading');
  assert.equal(mapNode(tree).props.popup.key, 'site:S1');
  assert.equal(mapNode(w.render()).props.popupElement, w.host(dialog), 'SiteMap receives the mounted popup element');
  tree = w.render();
  assert.equal(w.document.activeElement, w.host(tree.find((node) => node.props?.id === 'detail-heading')));
  assert.match(textOf(dialog), /Site/);
  const mapHeading = w.host(tree.find((node) => node.props?.id === 'map-heading'));
  w.host(tree.find((node) => node.props?.className === 'site-button')).getClientRects = () => [];
  mapHeading.getClientRects = () => [{}];
  tree.find((node) => node.props?.className === 'map-container').props.onKeyDown({ key: 'Escape' });
  tree = w.render();
  assert.equal(
    tree.some((node) => node.props?.role === 'dialog'),
    false,
  );
  assert.equal(mapNode(tree).props.popup, null);
  assert.equal(w.document.activeElement, mapHeading, 'focus returns to the visible map heading');
});

test('a map click opens the popup without moving focus; clicking empty water closes it', () => {
  const w = historyWorkspace();
  let tree = w.render();
  mapNode(tree).props.onSelect('S1');
  tree = w.render();
  assert.ok(tree.find((node) => node.props?.role === 'dialog'));
  assert.equal(w.document.activeElement, w.document.body);
  mapNode(tree).props.onDeselect();
  tree = w.render();
  assert.equal(
    tree.some((node) => node.props?.role === 'dialog'),
    false,
  );
});

test('closing the popup returns focus to the selected row, else the map heading, else the sites heading', () => {
  for (const [rowVisible, mapVisible] of [
    [true, true],
    [false, true],
    [false, false],
  ]) {
    const w = historyWorkspace();
    w.setResource('/api/sites?', siteRows);
    let tree = w.render();
    const row = () => tree.find((node) => node.props?.className === 'site-button');
    row().props.onClick();
    tree = w.render();
    const rowHost = w.host(row());
    const mapHeading = w.host(tree.find((node) => node.props?.id === 'map-heading'));
    const sitesHeading = w.host(tree.find((node) => node.props?.id === 'sites-heading'));
    rowHost.getClientRects = () => (rowVisible ? [{}] : []);
    mapHeading.getClientRects = () => (mapVisible ? [{}] : []);
    sitesHeading.getClientRects = () => [{}];
    const close = tree.find((node) => node.props?.className === 'popup-close');
    assert.equal(close.props['aria-label'], 'ปิดรายละเอียด');
    w.host(close).focus();
    close.props.onClick();
    tree = w.render();
    assert.equal(
      tree.some((node) => node.props?.role === 'dialog'),
      false,
    );
    assert.equal(w.document.activeElement, rowVisible ? rowHost : mapVisible ? mapHeading : sitesHeading);
  }
});

function popupMap(point = { x: 400, y: 300 }) {
  const selected = [];
  const h = mapHarness({}, undefined, (code) => selected.push(code));
  const element = { style: {}, offsetWidth: 200, offsetHeight: 100 };
  const projected = [];
  h.map.point = point;
  h.map.project = (lngLat) => {
    projected.push(JSON.parse(JSON.stringify(lngLat)));
    return { ...h.map.point };
  };
  return { h, element, projected, selected };
}

test('popup is anchored at the clicked location, kept inside the map and follows map moves', () => {
  const { h, element, projected, selected } = popupMap();
  let deselected = 0;
  const extra = { popupElement: element, onDeselect: () => deselected++ };
  h.map.clickedFeatures = [{ properties: { code: 'S1' } }];
  h.map.emit('click', { point: {}, lngLat: { toArray: () => [98.6, 7.4] } });
  assert.deepEqual(selected, ['S1']);
  h.render(undefined, { ...extra, popup: { key: 'site:S1' } });
  assert.deepEqual(projected.at(-1), [98.6, 7.4]);
  assert.equal(element.style.transform, 'translate(300px, 186px)', 'centred above the point');
  h.map.point = { x: 20, y: 40 };
  h.map.emit('move');
  assert.equal(element.style.transform, 'translate(8px, 54px)', 'clamped left and flipped below near the top');
  h.map.point = { x: 400, y: 900 };
  h.map.emit('move');
  assert.equal(element.style.transform, 'translate(300px, 492px)', 'an anchor below the canvas keeps the popup inside');
  h.map.clickedFeatures = [];
  h.map.emit('click', { point: {} });
  assert.equal(deselected, 1);
});

test('popup for a list selection points at the selection centre, not an older click on the same site', () => {
  const { h, element, projected } = popupMap();
  h.map.clickedFeatures = [{ properties: { code: 'S1' } }];
  h.map.emit('click', { point: {}, lngLat: { toArray: () => [98.6, 7.4] } });
  h.render(undefined, { popupElement: element, popup: { key: 'site:S1' } });
  h.render(undefined, { popupElement: element, popup: null });
  h.render(undefined, { selection: square, popupElement: element, popup: { key: 'site:S1' } });
  assert.deepEqual(projected.at(-1), [98.5, 7.5]);
});

test('popup without an anchor yet (details loading) or without a map stays visible at the top-left', () => {
  const { h, element, projected } = popupMap();
  h.render(undefined, { popupElement: element, popup: { key: 'site:S1' } });
  assert.equal(projected.length, 0);
  assert.equal(element.style.transform, 'translate(8px, 8px)');
  assert.equal(element.style.visibility, undefined, 'never hidden');

  const failing = componentHarness(
    '../src/components/site-map.tsx',
    {
      'maplibre-gl': {
        Map: class {
          constructor() {
            throw new Error('no WebGL');
          }
        },
        NavigationControl: class {},
        ScaleControl: class {},
        setWorkerUrl() {},
      },
      '../lib/map-state': { ...mapState, debounce: (fn) => ({ run: fn, cancel() {} }) },
    },
    {
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
  );
  const card = { style: {}, offsetWidth: 200, offsetHeight: 100 };
  failing.render(() =>
    failing.exports.default({
      onViewport() {},
      onSelect() {},
      selection: square,
      popupElement: card,
      popup: { key: 'site:S1' },
    }),
  );
  assert.equal(card.style.transform, 'translate(8px, 8px)', 'details stay reachable when the map cannot start');
});

test('popup position includes the canvas offset below a map warning banner', () => {
  const { h, element } = popupMap();
  h.map.clickedFeatures = [{ properties: { code: 'S1' } }];
  h.map.emit('click', { point: {}, lngLat: { toArray: () => [98.6, 7.4] } });
  const canvas = nodes(h.render(undefined, { popupElement: element, popup: { key: 'site:S1' } })).find(
    (node) => node.props?.className === 'map-canvas',
  );
  canvas.props.ref.current.offsetTop = 48;
  h.map.emit('move');
  assert.equal(element.style.transform, 'translate(300px, 234px)');
});

test('a click picks the nearest survey point within the hit radius before the polygon under it', () => {
  const sites = [];
  const surveysPicked = [];
  const h = mapHarness({}, undefined, (code) => sites.push(code));
  h.render(undefined, { onSelectSurvey: (id) => surveysPicked.push(id) });
  const at = { a: { x: 15, y: 10 }, b: { x: 12, y: 10 }, far: { x: 30, y: 10 } };
  h.map.project = (coordinates) => at[coordinates[0]];
  const point = (id, key) => ({ properties: { id, site_code: 'S1' }, geometry: { coordinates: [key, 0] } });
  h.map.clickedFeatures = [{ properties: { code: 'S1' } }];
  h.map.clickedPoints = [point(1, 'a'), point(2, 'b')];
  h.map.emit('click', { point: { x: 10, y: 10 } });
  assert.deepEqual(surveysPicked, ['2'], 'nearest point wins');
  assert.deepEqual(sites, [], 'the polygon is not selected under a point');
  h.map.clickedPoints = [point(3, 'far')];
  h.map.emit('click', { point: { x: 10, y: 10 }, lngLat: { toArray: () => [98, 7] } });
  assert.deepEqual(surveysPicked, ['2'], 'a point beyond the radius is ignored');
  assert.deepEqual(sites, ['S1']);
});

test('a still-drawn survey point opens its popup while the points layer reloads or has failed', () => {
  const w = historyWorkspace();
  const point = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [98.6, 8.1] },
    properties: { id: 17, site_code: 'S1', surveyed_on: '2025-03-28', cover_percent: 87, species: [], note: null },
  };
  w.setResource('/api/surveys.geojson', { data: { type: 'FeatureCollection', features: [point] }, loading: false });
  mapNode(w.render()).props.onViewport([98, 7, 99, 9]);
  w.render();
  for (const state of [{ loading: true }, { error: new Error('offline'), loading: false }]) {
    w.setResource('/api/surveys.geojson', state);
    mapNode(w.render()).props.onSelectSurvey('17');
    const dialog = w.render().find((node) => node.props?.role === 'dialog');
    assert.ok(dialog, 'popup opens from the last displayed points');
    assert.match(textOf(dialog), /จุดสำรวจ 2025-03-28/);
    const tree = w.render();
    for (const node of tree) if (node.props?.id === 'map-heading') w.host(node).getClientRects = () => [{}];
    tree.find((node) => node.props?.className === 'map-container').props.onKeyDown({ key: 'Escape' });
    w.render();
  }
});

test('a popup taller than the canvas is capped to the canvas below a warning banner', () => {
  const { h, element } = popupMap();
  element.offsetHeight = 900;
  h.map.container = { clientWidth: 800, clientHeight: 500 };
  const canvas = nodes(h.render(undefined, { popupElement: element, popup: { key: 'survey:1', point: [98, 7] } })).find(
    (node) => node.props?.className === 'map-canvas',
  );
  canvas.props.ref.current.offsetTop = 48;
  h.map.emit('move');
  assert.equal(element.style.maxHeight, '484px');
  assert.match(element.style.transform, /translate\(\d+px, 56px\)/);
});

test('Escape on the map closes an open popup even when focus is on the canvas', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onSelect('S1');
  const tree = w.render();
  w.host(tree.find((node) => node.props?.id === 'map-heading')).getClientRects = () => [{}];
  const container = tree.find((node) => node.props?.className === 'map-container');
  container.props.onKeyDown({ key: 'Escape' });
  assert.equal(
    w.render().some((node) => node.props?.role === 'dialog'),
    false,
  );
});

test('when rows are missing the oldest listed round is left out because it may be partial', () => {
  const w = historyWorkspace();
  mapNode(w.render()).props.onSelect('S1');
  const survey = (id, surveyed_on) => ({ id, surveyed_on, cover_percent: 50, species: [], note: null });
  w.setHistory({
    data: { items: [survey(1, '2026-06-24'), survey(2, '2025-03-28')], total: 120, page: 1 },
    loading: false,
  });
  const rounds = w.render().find((node) => node.props?.className === 'round-list');
  assert.deepEqual(
    nodes(rounds)
      .filter((node) => node.type === 'li')
      .map((node) => node.key),
    ['2026-06-24'],
  );
});

test('Escape from the canvas closes the popup without moving focus; a point gone from fresh data closes its popup', () => {
  const w = historyWorkspace();
  const canvas = { closest: () => null };
  w.document.activeElement = canvas;
  mapNode(w.render()).props.onSelect('S1');
  const tree = w.render();
  w.host(tree.find((node) => node.props?.id === 'map-heading')).getClientRects = () => [{}];
  tree.find((node) => node.props?.className === 'map-container').props.onKeyDown({ key: 'Escape' });
  w.render();
  assert.equal(w.document.activeElement, canvas, 'focus stays on the canvas');

  const point = (id) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [98.6, 8.1] },
    properties: { id, site_code: 'S1', surveyed_on: '2025-03-28', cover_percent: 87, species: [], note: null },
  });
  w.setResource('/api/surveys.geojson', { data: { type: 'FeatureCollection', features: [point(17)] }, loading: false });
  mapNode(w.render()).props.onViewport([98, 7, 99, 9]);
  w.render();
  mapNode(w.render()).props.onSelectSurvey('17');
  assert.ok(w.render().some((node) => node.props?.role === 'dialog'));
  w.setResource('/api/surveys.geojson', { data: { type: 'FeatureCollection', features: [point(18)] }, loading: false });
  w.render();
  assert.equal(
    w.render().some((node) => node.props?.role === 'dialog'),
    false,
  );
});
