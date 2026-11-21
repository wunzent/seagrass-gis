import { readConfig } from './config/config';
import { createPool, migrate } from './database/connection';
async function main() {
  const pool = createPool(readConfig(process.env).databaseUrl);
  try { await migrate(pool); } finally { await pool.end(); }
}
void main().catch(() => { console.error('Migration failed; check configuration and database availability'); process.exitCode = 1; });
