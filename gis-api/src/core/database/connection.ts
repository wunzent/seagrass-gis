import { Pool } from 'pg';
import { resolve } from 'node:path';
import { applyMigrations, loadMigrations } from './migrator';

export function createPool(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
    idleTimeoutMillis: 30000,
  });
  // Background idle-connection errors must not expose connection details or terminate HTTP.
  pool.on('error', () => {});
  return pool;
}
export async function migrate(pool: Pool) {
  const files = await loadMigrations(resolve(__dirname, '../../../migrations'));
  const client = await pool.connect();
  try {
    await applyMigrations(client, files);
  } finally {
    client.release();
  }
}
