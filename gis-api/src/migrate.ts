import { readConfig } from './core/config/config';
import { createPool, migrate } from './core/database/connection';
import { AppLogger } from './core/logger/app-logger';

const logger = new AppLogger();
async function main() {
  const pool = createPool(readConfig(process.env).databaseUrl);
  try { await migrate(pool); } finally { await pool.end(); }
}
void main().catch(() => { logger.error('Migration failed; check configuration and database availability'); process.exitCode = 1; });
