import { createApp } from './app.module';
import { readAuthConfig, readConfig } from './config/config';
import { assertDemoPasswords, seedDemoUsers } from './database/seeders/demo-users';
import { createPool, migrate } from './database/connection';
import { importSeed } from './database/seeders/seed-import';

async function main() {
  let config, auth;
  // Configuration errors name the variable only (no values), so print them for the operator.
  try { config = readConfig(process.env); auth = readAuthConfig(process.env); assertDemoPasswords(process.env); }
  catch (error) { console.error(`API startup failed: ${(error as Error).message}`); throw error; }
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    console.log(JSON.stringify({import:await importSeed(pool)}));
    await seedDemoUsers(pool, process.env);
    const app = await createApp(pool, { auth, onShutdown: () => pool.end() });
    app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    app.useLogger(false);
    await app.listen(config.port, '0.0.0.0');
  } catch {
    await pool.end();
    throw new Error('API startup failed; check configuration and database availability');
  }
}
void main().catch(() => { console.error('API startup failed'); process.exitCode = 1; });
