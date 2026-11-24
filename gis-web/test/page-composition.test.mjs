import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { componentHarness } from './component-harness.mjs';
import * as mapState from '../src/lib/map-state.ts';

const source = (name) => fileURLToPath(new URL('../src/' + name, import.meta.url));

test('filter reset uses the canonical emptyFilters object', () => {
  let changed;
  const h = componentHarness('../src/features/map/filters-panel.tsx');
  const tree = h.render(() =>
    h.exports.FiltersPanel({
      draft: { province: '81', status: 'good', q: 'x' },
      provinces: new Map(),
      change: (value) => {
        changed = value;
      },
      validation: '',
    }),
  );
  const children = tree.props.children;
  children.find((n) => n?.type === 'button').props.onClick();
  assert.equal(changed, mapState.emptyFilters);
});

test('survey history uses exported ROUNDS_PAGE_SIZE instead of a duplicated literal', () => {
  assert.equal(mapState.ROUNDS_PAGE_SIZE, 100);
  const h = componentHarness('../src/services/surveys-service.ts', {
    [source('lib/map-state.ts')]: { ...mapState, ROUNDS_PAGE_SIZE: 7 },
  });
  assert.equal(h.exports.surveysService.historyKey('A'), '/api/sites/A/surveys?page=1&pageSize=7');
});

test('home wires every session slot to its matching view inside MapWorkspace', () => {
  const h = componentHarness('../src/app/page.tsx', {
    [source('features/map/map-workspace.tsx')]: { default: 'workspace', __esModule: true },
    [source('features/auth/session-controls.tsx')]: { SessionControls: 'controls' },
    [source('guards/session-guard.tsx')]: { SessionRoute: 'route' },
  });
  const page = h.render(() => h.exports.default());
  assert.equal(page.type, 'workspace');
  const route = page.props.sessionControls;
  assert.equal(route.type, 'route');
  for (const slot of ['checking', 'account', 'guest']) {
    assert.equal(route.props[slot].type, 'controls');
    assert.equal(route.props[slot].props.view, slot);
  }
});

const loginPage = (env) =>
  componentHarness(
    '../src/app/login/page.tsx',
    {
      [source('features/auth/login-form.tsx')]: { LoginForm: 'login' },
      [source('guards/session-guard.tsx')]: { SessionRoute: 'route' },
    },
    { process: { env } },
  );

test('login wires checking to default form and account/guest to opposite visibility', () => {
  const h = loginPage({});
  const page = h.render(() => h.exports.default());
  assert.equal(page.type, 'route');
  for (const slot of ['checking', 'account', 'guest']) assert.equal(page.props[slot].type, 'login');
  assert.equal(page.props.checking.props.guest, undefined);
  assert.equal(page.props.account.props.guest, false);
  assert.equal(page.props.guest.props.guest, true);
});

test('login renders per request and passes env demo accounts to every LoginForm slot', () => {
  const h = loginPage({ DEMO_VIEWER_PASSWORD: 'viewer-from-env', DEMO_ADMIN_PASSWORD: 'admin-from-env' });
  assert.equal(h.exports.dynamic, 'force-dynamic');
  const page = h.render(() => h.exports.default());
  const expected = [
    ['viewer', 'viewer-from-env'],
    ['editor', 'editor-demo-only'],
    ['admin', 'admin-from-env'],
  ];
  for (const slot of ['checking', 'account', 'guest'])
    assert.deepEqual(
      page.props[slot].props.accounts.map((account) => [account.role, account.password]),
      expected,
    );
});

test('login falls back to the .env.example demo passwords when DEMO_*_PASSWORD is unset or empty', () => {
  for (const env of [{}, { DEMO_VIEWER_PASSWORD: '', DEMO_EDITOR_PASSWORD: '', DEMO_ADMIN_PASSWORD: '' }]) {
    const h = loginPage(env);
    const page = h.render(() => h.exports.default());
    for (const slot of ['checking', 'account', 'guest'])
      assert.deepEqual(
        page.props[slot].props.accounts.map((account) => [account.email, account.password]),
        [
          ['viewer@demo.local', 'viewer-demo-only'],
          ['editor@demo.local', 'editor-demo-only'],
          ['admin@demo.local', 'admin-demo-only'],
        ],
      );
  }
});

test('SessionProvider injects writable sink but exposes a stable read-only facade with service actions', () => {
  let sink,
    serviceSink,
    creates = 0,
    restores = 0;
  const listeners = new Map();
  const context = { Provider: 'provider' };
  const actions = {
    restore: async () => restores++,
    login() {},
    logout() {},
    unauthorized() {},
    dispose() {},
  };
  const h = componentHarness(
    '../src/features/auth/session-provider.tsx',
    {
      [source('stores/session-store.ts')]: {
        createSessionStore: () => {
          creates++;
          return (sink = { getSnapshot() {}, subscribe() {}, isCurrent() {}, setState() {} });
        },
      },
      [source('services/session-service.ts')]: {
        createSessionService: (value) => {
          serviceSink = value;
          return actions;
        },
        SESSION_STORAGE_KEY: 'gis-session',
      },
      [source('stores/session-context.tsx')]: { SessionContext: context },
    },
    {
      window: { addEventListener: (name, fn) => listeners.set(name, fn) },
      document: { visibilityState: 'hidden', addEventListener: (name, fn) => listeners.set(name, fn) },
    },
  );
  const first = h.render(() => h.exports.SessionProvider({ children: 'child' }));
  assert.equal(first.type, 'provider');
  assert.equal(first.props.children, 'child');
  assert.equal(serviceSink, sink);
  assert.equal(typeof serviceSink.setState, 'function');
  const facade = first.props.value;
  assert.equal('setState' in facade, false);
  for (const name of ['getSnapshot', 'subscribe', 'isCurrent']) assert.equal(facade[name], sink[name]);
  for (const [name, action] of Object.entries(actions)) assert.equal(facade[name], action);
  const second = h.render(() => h.exports.SessionProvider({ children: 'next' }));
  assert.equal(second.props.value, facade);
  assert.equal(creates, 1);
  assert.equal(restores, 1);
  // /auth/me runs once on load; afterwards the session is only re-checked by real API calls (401) and the expiry timer.
  assert.equal(listeners.has('focus'), false);
  assert.equal(listeners.has('visibilitychange'), false);
  // Another tab logging in or out changes storage; only the session key (or a full clear) re-reads it.
  listeners.get('storage')({ key: 'other' });
  assert.equal(restores, 1);
  listeners.get('storage')({ key: 'gis-session' });
  listeners.get('storage')({ key: null });
  assert.equal(restores, 3);
});
