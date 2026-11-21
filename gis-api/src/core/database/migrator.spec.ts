import { createHash } from 'node:crypto';
import { applyMigrations } from './migrator';

type Call = { sql: string; values?: unknown[] };
function fakeClient(applied: Record<string, unknown>[] = [], failSql?: string) {
  const calls: Call[] = [];
  return { calls, query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql === failSql) throw new Error('dependency secret');
    return { rows: sql.startsWith('SELECT version') ? applied : [] };
  } };
}

describe('applyMigrations', () => {
  it('changed applied migration rejects before SQL executes and unlocks', async () => {
    const client = fakeClient([{ version: '001.sql', checksum: 'different' }]);
    await expect(applyMigrations(client as any, [{ version: '001.sql', sql: 'SELECT 42' }])).rejects.toThrow(/checksum/i);
    expect(client.calls.some(c => c.sql === 'SELECT 42')).toBe(false);
    expect(client.calls.some(c => c.sql.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('failed migration rolls back and never records it', async () => {
    const client = fakeClient([], 'BROKEN SQL');
    await expect(applyMigrations(client as any, [{ version: '001.sql', sql: 'BROKEN SQL' }])).rejects.toThrow(/Migration failed/);
    expect(client.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
    expect(client.calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations'))).toBe(false);
  });

  it('sorts, hashes and skips previously applied files', async () => {
    const sql = 'SELECT 1';
    const client = fakeClient([{ version: '001.sql', checksum: createHash('sha256').update(sql).digest('hex') }]);
    await applyMigrations(client as any, [{ version: '002.sql', sql: 'SELECT 2' }, { version: '001.sql', sql }]);
    expect(client.calls.some(c => c.sql === sql)).toBe(false);
    const insert = client.calls.find(c => c.sql.startsWith('INSERT INTO schema_migrations'))!;
    expect(insert.values![0]).toBe('002.sql');
    expect(insert.values![1]).toBe(createHash('sha256').update('SELECT 2').digest('hex'));
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });
});
