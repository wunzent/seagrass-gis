import assert from 'node:assert/strict';
import { test } from 'node:test';

test('session service publishes safe identity to its injected store and isolates instances', async () => {
  const serviceModule = await import('../src/services/session-service.ts').catch(() => ({}));
  const storeModule = await import('../src/stores/session-store.ts');
  assert.equal(typeof serviceModule.createSessionService, 'function');
  assert.equal(typeof storeModule.createSessionStore, 'function');
  const sink = storeModule.createSessionStore(() => 1000);
  const other = storeModule.createSessionStore(() => 1000);
  const snapshots = [];
  sink.subscribe(() => snapshots.push(sink.getSnapshot()));
  const service = serviceModule.createSessionService(sink, {
    now: () => 1000,
    schedule: () => undefined,
    cancel: () => {},
    fetcher: async () => {
      throw new Error('no request expected');
    },
    storage: {
      getItem: () =>
        JSON.stringify({
          user: { id: 'a', email: 'a@demo.local', role: 'viewer', secret: 'discard' },
          expires_at: new Date(10000).toISOString(),
          access_token: 'discard',
        }),
      setItem() {},
      removeItem() {},
    },
  });
  await service.restore();
  assert.deepEqual(sink.getSnapshot().session.user, { id: 'a', email: 'a@demo.local', role: 'viewer' });
  assert.equal(sink.isCurrent(sink.getSnapshot().generation), true);
  assert.equal(other.getSnapshot().session, null);
  assert.equal(JSON.stringify(snapshots).includes('discard'), false);
  service.unauthorized();
  assert.equal(sink.getSnapshot().session, null);
  assert.equal(snapshots.length, 2); // restore from storage, then unauthorized
  service.dispose();
});
