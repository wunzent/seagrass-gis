import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPool } from '../src/core/database/connection';
import { importReferenceParcels } from '../src/core/database/seeders/reference-import';
import { migrate } from './helpers';

const url = process.env.IMPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const isolated = Boolean(url && /^\/(?:gis_import_test(?:_[a-z0-9_]+)?|gis_test)$/.test(new URL(url).pathname));
if (!isolated && (process.env.IMPORT_TEST_DATABASE_URL || process.env.IMPORT_REQUIRED === '1')) {
  throw new Error('Reference import e2e requires an isolated gis_import_test database');
}
const suite = isolated ? describe : describe.skip;

suite('reference import (PostGIS)', () => {
  it('loads the repo archive in WGS84 with a GiST index and keeps its row count on rerun', async () => {
    const pool = createPool(url!);
    const reportDir = await mkdtemp(join(tmpdir(), 'gis-reference-e2e-'));
    const seedDir = resolve('../seed-data');
    try {
      await migrate(pool);
      const first = await importReferenceParcels(pool, seedDir, reportDir);
      expect(first.accepted + first.already_present + first.rejected).toBe(20000);
      const stats = async () =>
        (
          await pool.query(`SELECT count(*)::int AS count, bool_and(ST_SRID(geom) = 4326 AND ST_IsValid(geom, 0)
            AND ST_SRID(tile_geom) = 3857
            AND ST_XMin(geom) BETWEEN 97 AND 101 AND ST_YMin(geom) BETWEEN 5 AND 10) AS wgs84
            FROM reference_parcels`)
        ).rows[0];
      const before = await stats();
      expect(before).toEqual({ count: first.accepted + first.already_present, wgs84: true });
      expect(before.count).toBeGreaterThan(19000);
      const second = await importReferenceParcels(pool, seedDir, reportDir);
      expect(second).toEqual({ accepted: 0, already_present: before.count, rejected: first.rejected });
      expect(await stats()).toEqual(before);
      expect(
        (await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'reference_parcels_geom_gix'")).rows[0]
          .indexdef,
      ).toContain('USING gist (geom)');
      expect(
        (await pool.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'reference_parcels_tile_geom_gix'"))
          .rows[0].indexdef,
      ).toContain('USING gist (tile_geom)');
      const report = await readFile(join(reportDir, 'reference_import_report.csv'), 'utf8');
      expect(report.split('\r\n')).toHaveLength(first.rejected + 2);
    } finally {
      await pool.end();
      await rm(reportDir, { recursive: true, force: true });
    }
  }, 90000);
});
