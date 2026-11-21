import * as path from 'node:path';
import { createPool } from '../src/core/database/connection';
import { applyMigrations, loadMigrations } from '../src/core/database/migrator';

/** Database names accepted for suites that truncate tables: `test` must be a whole word, e.g. gis_api_test, gis-test, test. */
const TEST_DATABASE = /(^|[_-])test($|[_-])/i;

export function assertTestDatabase(databaseUrl: string, suite: string): void {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  if (!TEST_DATABASE.test(name)) throw new Error(`${suite} integration tests require a *_test database in DATABASE_URL`);
}

export async function migrate(pool: ReturnType<typeof createPool>): Promise<void> {
  const files = await loadMigrations(path.resolve(process.cwd(), 'migrations'));
  const client = await pool.connect();
  try { await applyMigrations(client, files); } finally { client.release(); }
}
