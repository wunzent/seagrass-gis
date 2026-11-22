import type { PoolClient } from 'pg';
import { SessionsRepository } from './sessions.repository';

it('locks previous sessions in the same order when cookie and bearer credentials are swapped', async () => {
  const a = { sid: '00000000-0000-4000-8000-000000000001', userId: 'user-a' };
  const b = { sid: '00000000-0000-4000-8000-000000000002', userId: 'user-b' };
  const orders: unknown[][] = [];
  for (const previous of [
    [a, b],
    [b, a],
  ]) {
    const locks: unknown[] = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('UPDATE access_sessions')) locks.push(params?.[0]);
        return { rows: [] };
      },
      release: () => undefined,
    } as unknown as PoolClient;
    const repository = new SessionsRepository({ query: async () => ({ rows: [] }), connect: async () => client });
    await repository.replace(previous, { sid: 'new-session', userId: 'user-a', expiresAt: new Date() });
    expect(locks).toHaveLength(2);
    orders.push(locks);
  }
  expect(orders[0]).toEqual(orders[1]);
});
