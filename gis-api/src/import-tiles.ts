import { performance } from 'node:perf_hooks';
import { readConfig } from './core/config/config';
import { createPool, migrate } from './core/database/connection';
import { importReferenceParcels } from './core/database/seeders/reference-import';
import { importPaths } from './core/database/seeders/seed-import';

async function main() {
  const started = performance.now();
  const pool = createPool(readConfig(process.env).databaseUrl);
  try {
    // The existing migrator serializes concurrent runs. The API does not depend on this job.
    await migrate(pool);
    const { seedDir, reportDir } = importPaths();
    const result = await importReferenceParcels(pool, seedDir, reportDir);
    console.log(JSON.stringify({ reference_import: result, elapsed_ms: Math.round(performance.now() - started) }));
  } finally {
    await pool.end();
  }
}

void main().catch(() => {
  console.error('Reference parcel import failed; check PostGIS, the seed archive and the report directory');
  process.exitCode = 1;
});
