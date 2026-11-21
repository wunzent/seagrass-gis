import { createApp } from './app';
import { readConfig } from './config';
import { createPool, migrate } from './database';
import { importSeed } from './import/runner';

async function main() {
  const config = readConfig(process.env);
  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    console.log(JSON.stringify({import:await importSeed(pool)}));
    const app = await createApp(pool, () => pool.end());
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
