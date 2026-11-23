import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { componentHarness } from './component-harness.mjs';
import { createResourceStore } from '../src/stores/resource-store.ts';

test('resource loader identity changes do not add requests while key/retry/generation are stable', async () => {
  let calls = 0;
  const state = {
    phase: 'ready',
    generation: 1,
    session: null,
    busy: null,
    store: { isCurrent: () => true, unauthorized() {} },
  };
  const h = componentHarness('../src/features/map/use-resource.ts', {
    [fileURLToPath(new URL('../src/stores/session-context.tsx', import.meta.url))]: { useSession: () => state },
  });
  const resource = createResourceStore();
  const render = (key = '/same', retry = 0) =>
    h.render(() =>
      h.exports.useResource(
        key,
        async () => {
          calls++;
          return { key };
        },
        retry,
        resource,
      ),
    );
  render();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(render().data, { key: '/same' });
  assert.equal(calls, 1);
  render('/same', 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  state.busy = 'login';
  assert.equal(render('/same', 1).data, undefined);
  assert.equal(calls, 2);
  state.busy = null;
  render('/same', 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  state.generation++;
  assert.equal(render('/same', 1).data, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 4);
});
