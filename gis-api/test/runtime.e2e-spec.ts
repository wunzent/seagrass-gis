import { Test } from '@nestjs/testing';
import { appModule } from '../src/app.module';
import { readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { assertTestDatabase, migrate } from './helpers';

const config = readConfig(process.env);
// Truncating suites share this database; refuse anything that is not an explicit test database.
assertTestDatabase(config.databaseUrl, 'runtime');

describe('runtime (real PostGIS)', () => {
  it('migrations are idempotent and HTTP health reflects DB', async () => {
    const pool = createPool(config.databaseUrl);
    let app: any;
    try {
      await migrate(pool);
      const before = (await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version'))
        .rows;
      expect(before).toHaveLength(4);
      await migrate(pool);
      expect(
        (await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version')).rows,
      ).toEqual(before);
      const tables = (
        await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
      ).rows.map((r) => r.table_name);
      for (const table of ['provinces', 'species', 'users', 'sites', 'surveys', 'survey_species', 'access_sessions'])
        expect(tables).toContain(table);
      const geometries = (
        await pool.query("SELECT f_table_name, type, srid FROM geometry_columns WHERE f_table_schema='public'")
      ).rows;
      expect(geometries).toHaveLength(3);
      expect(geometries.every((g) => g.srid === 4326)).toBe(true);
      const moduleRef = await Test.createTestingModule({ imports: [appModule(pool)] }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const response = await fetch(`${base}/health`, { headers: { Cookie: 'gis_access=invalid' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const actual = (await pool.query('SELECT postgis_lib_version() AS version')).rows[0].version as string;
      expect(await response.json()).toEqual({ db: 'ok', postgis: actual.split('.').slice(0, 2).join('.') });
      const unknown = await fetch(`${base}/missing?secret=never-echo`);
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found', details: {} },
      });
    } finally {
      if (app) await app.close();
      await pool.end();
    }
  });
});
