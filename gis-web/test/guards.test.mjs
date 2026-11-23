import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { componentHarness } from './component-harness.mjs';

test('route guard selects checking, account and guest feature slots without navigation', () => {
  const state = { session: null, phase: 'checking' };
  const h = componentHarness('../src/guards/session-guard.tsx', {
    [fileURLToPath(new URL('../src/stores/session-context.tsx', import.meta.url))]: { useSession: () => state },
  });
  assert.equal(typeof h.exports.SessionRoute, 'function');
  const slots = { checking: 'checking', account: 'account', guest: 'guest' };
  assert.equal(h.exports.SessionRoute(slots), 'checking');
  state.phase = 'ready';
  assert.equal(h.exports.SessionRoute(slots), 'guest');
  state.session = { user: { role: 'viewer' } };
  assert.equal(h.exports.SessionRoute(slots), 'account');
});

test('RequireRole shows only an allowed established role', () => {
  const state = { session: null, phase: 'ready' };
  const h = componentHarness('../src/guards/session-guard.tsx', {
    [fileURLToPath(new URL('../src/stores/session-context.tsx', import.meta.url))]: { useSession: () => state },
  });
  assert.equal(typeof h.exports.RequireRole, 'function');
  const props = { roles: ['editor', 'admin'], children: 'write', fallback: 'read' };
  assert.equal(h.exports.RequireRole(props), 'read');
  state.session = { user: { role: 'viewer' } };
  assert.equal(h.exports.RequireRole(props), 'read');
  state.session.user.role = 'editor';
  assert.equal(h.exports.RequireRole(props), 'write');
  state.session.user.role = 'admin';
  assert.equal(h.exports.RequireRole(props), 'write');
});
