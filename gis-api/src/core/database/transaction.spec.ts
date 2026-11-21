import { withTransaction } from './transaction';

function fakeDb(fail: Record<string, Error> = {}) {
  const calls: string[] = [];
  const released: unknown[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (fail[sql]) throw fail[sql];
      return { rows: [] };
    },
    release: (error?: unknown) => released.push(error),
  };
  return { db: { query: client.query, connect: async () => client as any }, calls, released };
}

describe('withTransaction', () => {
  it('commits and releases the client normally', async () => {
    const { db, calls, released } = fakeDb();
    expect(await withTransaction(db, async (tx) => (await tx.query('SELECT 1'), 'done'))).toBe('done');
    expect([calls, released]).toEqual([['BEGIN', 'SELECT 1', 'COMMIT'], [undefined]]);
  });

  it('rolls back and rethrows; a healthy client goes back to the pool', async () => {
    const { db, calls, released } = fakeDb({ 'SELECT 1': new Error('boom') });
    await expect(withTransaction(db, async (tx) => tx.query('SELECT 1'))).rejects.toThrow('boom');
    expect([calls, released]).toEqual([['BEGIN', 'SELECT 1', 'ROLLBACK'], [undefined]]);
  });

  it('a failed ROLLBACK releases the client with the error so the pool destroys it', async () => {
    const rollback = new Error('connection lost');
    const { db, released } = fakeDb({ 'SELECT 1': new Error('boom'), ROLLBACK: rollback });
    await expect(withTransaction(db, async (tx) => tx.query('SELECT 1'))).rejects.toThrow('boom');
    expect(released).toEqual([rollback]);
  });

  it('a connect failure that means the database is down is 503 and needs no release', async () => {
    const db = {
      query: async () => ({ rows: [] }),
      connect: async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      },
    };
    const error: any = await withTransaction(db, async () => 1).catch((e) => e);
    expect([error.getStatus(), error.getResponse().error.code]).toEqual([503, 'SERVICE_UNAVAILABLE']);
  });
});
