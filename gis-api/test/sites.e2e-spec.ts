import { siteStatus } from '../src/sites/site-status';
import { Test } from '@nestjs/testing';
import { appModule } from '../src/app.module';
import { readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { assertTestDatabase, migrate } from './helpers';

const config = readConfig(process.env);
// Fixtures truncate domain tables, so refuse anything that is not an explicit test database.
assertTestDatabase(config.databaseUrl, 'sites');

const ADMIN = '00000000-0000-4000-8000-000000000001';
const square = (lon: number, lat: number, d: number) =>
  `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat}))',4326))`;
let pool: ReturnType<typeof createPool>;
let app: any;
let base: string;

async function startApp(database: any) {
  const moduleRef = await Test.createTestingModule({ imports: [appModule(database)] }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.listen(0, '127.0.0.1');
  return started;
}
async function site(id: string, code: string, name: string, province: string, polygon: string, deleted = false) {
  await pool.query(
    `INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by,deleted_at)
    VALUES($1,$2,$3,$4,${polygon},ST_Area(${polygon}::geography)/1600,$5,$5,$6)`,
    [id, code, name, province, ADMIN, deleted ? new Date() : null],
  );
}
async function survey(siteId: string, on: string, cover: number, lon = 99.305, lat = 7.305) {
  await pool.query(
    `INSERT INTO surveys(site_id,geom,surveyed_on,cover_percent,created_by,updated_by)
    VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,$6)`,
    [siteId, lon, lat, on, cover, ADMIN],
  );
}
const get = async (p: string) => {
  const r = await fetch(base + p);
  return { status: r.status, headers: r.headers, body: (r.status === 204 ? null : await r.json()) as any };
};

beforeAll(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,'admin@test.local','x','admin')`, [ADMIN]);
  await pool.query(
    `INSERT INTO provinces(code,name_th,geom) VALUES('93','พัทลุง',${square(99, 7, 1)}),('80','นครศรีธรรมราช',${square(100, 7, 1)})`,
  );
  const ids = (n: number) => `00000000-0000-4000-8000-0000000001${n}`;
  await site(ids(10), 'A-001', 'Alpha bay', '93', square(99.3, 7.3, 0.01));
  await site(ids(11), 'B-002', 'Beta reef', '93', square(99.5, 7.5, 0.01));
  await site(ids(12), 'C-003', 'Charlie', '80', square(100.3, 7.3, 0.01));
  await site(ids(13), 'D-004', 'Deleted site', '93', square(99.31, 7.31, 0.005), true);
  await site(ids(14), 'E-005', 'Echo 50%_cover', '93', square(99.7, 7.7, 0.01));
  await site(ids(15), 'F-006', 'Foxtrot', '93', square(99.8, 7.8, 0.01));
  // A: latest day averages exactly 75 (very_good) even though an older day is poor.
  await survey(ids(10), '2026-09-01', 10);
  await survey(ids(10), '2026-10-01', 80);
  await survey(ids(10), '2026-10-01', 70);
  await survey(ids(11), '2026-10-02', 50, 99.505, 7.505);
  await survey(ids(14), '2026-10-03', 24.99, 99.705, 7.705);
  await survey(ids(15), '2026-10-04', 25, 99.805, 7.805);
  app = await startApp(pool);
  base = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('sites (real PostGIS)', () => {
  it.each([
    ['E-005', 24.99],
    ['F-006', 25],
    ['B-002', 50],
    ['A-001', 75],
  ] as const)('GET /sites/%s agrees with siteStatus(%s)', async (code, average) => {
    const response = await get(`/sites/${code}`);
    expect(response.status).toBe(200);
    expect(response.body.properties.latestSurvey.average_cover_percent).toBe(average);
    expect(response.body.properties.status).toBe(siteStatus(average));
  });

  it('compares the raw latest-day average even when the displayed average rounds to 75', async () => {
    const id = '00000000-0000-4000-8000-000000000110';
    await survey(id, '2026-11-01', 74.99);
    await survey(id, '2026-11-01', 75);
    try {
      const response = await get('/sites/A-001');
      expect(response.body.properties.latestSurvey).toEqual({
        surveyed_on: '2026-11-01',
        average_cover_percent: 75,
        count: 2,
      });
      expect(response.body.properties.status).toBe(siteStatus(74.995));
    } finally {
      await pool.query("DELETE FROM surveys WHERE site_id = $1 AND surveyed_on = '2026-11-01'", [id]);
    }
  });

  it('GET /sites lists active sites by code with computed status and no geometry', async () => {
    const { status, headers, body } = await get('/sites');
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    expect(body.items.map((i: any) => [i.code, i.status])).toEqual([
      ['A-001', 'very_good'],
      ['B-002', 'good'],
      ['C-003', 'no_data'],
      ['E-005', 'poor'],
      ['F-006', 'fair'],
    ]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['area_rai', 'code', 'name', 'province_code', 'status', 'version']);
      expect(typeof item.area_rai).toBe('number');
      expect(item.area_rai).toBe(Math.round(item.area_rai * 100) / 100);
    }
  });

  it('GET /sites filters, literal search and paging share one filter', async () => {
    const codes = async (p: string) => (await get(p)).body.items.map((i: any) => i.code);
    expect(await codes('/sites?province=80')).toEqual(['C-003']);
    expect(await codes('/sites?status=good')).toEqual(['B-002']);
    expect(await codes('/sites?q=a-0')).toEqual(['A-001']);
    expect(await codes('/sites?q=REEF')).toEqual(['B-002']);
    expect(await codes('/sites?q=%25')).toEqual(['E-005']);
    expect(await codes('/sites?q=_')).toEqual(['E-005']);
    const filtered = await get('/sites?province=93&status=poor');
    expect([filtered.body.total, filtered.body.items.map((i: any) => i.code)]).toEqual([1, ['E-005']]);
    const page = await get('/sites?pageSize=2&page=2');
    expect([page.body.total, page.body.page, page.body.items.map((i: any) => i.code)]).toEqual([
      5,
      2,
      ['C-003', 'E-005'],
    ]);
    const beyond = await get('/sites?page=9');
    expect([beyond.status, beyond.body.total, beyond.body.items]).toEqual([200, 5, []]);
  });

  it('GET /sites rejects invalid input with the shared envelope', async () => {
    for (const p of [
      '/sites?page=0',
      '/sites?pageSize=101',
      '/sites?status=great',
      '/sites?sort=name',
      '/sites?q=a&q=b',
      '/sites?q=%00',
      '/sites?__proto__=x',
      '/sites?constructor=1',
      '/sites.geojson?bbox=1,2,3,4&__proto__=x',
      '/sites/%ZZ',
      '/sites/%E0%A4%A',
    ]) {
      const { status, body } = await get(p);
      expect([p, status]).toEqual([p, 400]);
      expect([p, body.error.code]).toEqual([p, 'VALIDATION_ERROR']);
      expect(typeof body.error.message).toBe('string');
    }
  });

  it('GET /sites.geojson returns only active sites intersecting the bbox', async () => {
    const { status, body } = await get('/sites.geojson?bbox=99.29,7.29,99.32,7.32');
    expect(status).toBe(200);
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.map((f: any) => f.properties.code)).toEqual(['A-001']);
    const [feature] = body.features;
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('MultiPolygon');
    expect(feature.geometry.coordinates[0][0][0]).toEqual([99.3, 7.3]);
    expect(Object.keys(feature.properties).sort()).toEqual([
      'area_rai',
      'code',
      'id',
      'latestSurvey',
      'name',
      'province_code',
      'status',
      'version',
    ]);
    const all = await get('/sites.geojson?bbox=98,6,102,9');
    expect(all.body.features.map((f: any) => f.properties.code)).toEqual(['A-001', 'B-002', 'C-003', 'E-005', 'F-006']);
    const filtered = await get('/sites.geojson?bbox=98,6,102,9&province=93&status=fair&q=fox');
    expect(filtered.body.features.map((f: any) => f.properties.code)).toEqual(['F-006']);
    expect((await get('/sites.geojson?bbox=0,0,1,1')).body).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('GET /sites.geojson rejects bad bbox and unknown params', async () => {
    for (const p of [
      '/sites.geojson',
      '/sites.geojson?bbox=1,2,3',
      '/sites.geojson?bbox=100,7,99,8',
      '/sites.geojson?bbox=1,2,3,4&bbox=1,2,3,4',
    ]) {
      const { status, body } = await get(p);
      expect([p, status, body.error.code]).toEqual([p, 400, 'INVALID_BBOX']);
    }
    const page = await get('/sites.geojson?bbox=1,2,3,4&page=1');
    expect([page.status, page.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('GET /sites/:code returns a Feature with the latest-day summary', async () => {
    const { status, body } = await get('/sites/A-001');
    expect(status).toBe(200);
    expect(body.type).toBe('Feature');
    expect(body.properties.status).toBe('very_good');
    expect(body.properties.latestSurvey).toEqual({ surveyed_on: '2026-10-01', average_cover_percent: 75, count: 2 });
    expect(body.properties.version).toBe(1);
    expect((await get('/sites/C-003')).body.properties.latestSurvey).toBeNull();
    expect((await get('/sites/E-005')).body.properties.latestSurvey.average_cover_percent).toBe(24.99);
    for (const code of ['D-004', 'NOPE']) {
      const missing = await get(`/sites/${code}`);
      expect([code, missing.status, missing.body.error.code]).toEqual([code, 404, 'SITE_NOT_FOUND']);
    }
    const tooLong = await get(`/sites/${'x'.repeat(65)}`);
    expect([tooLong.status, tooLong.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('public reads ignore an invalid session cookie', async () => {
    const response = await fetch(`${base}/sites/A-001`, { headers: { Cookie: 'gis_access=not-a-jwt' } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).properties.code).toBe('A-001');
  });

  it('codes sort byte-wise regardless of database collation', async () => {
    await pool.query(
      `INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by)
      VALUES('00000000-0000-4000-8000-000000000199','A_002','Underscore','93',${square(99.9, 7.9, 0.01)},1,$1,$1)`,
      [ADMIN],
    );
    try {
      // "C" byte order: '-' (0x2D) < '_' (0x5F); en_US collation ignores punctuation and would compare 001 vs 002 first.
      expect((await get('/sites?q=A')).body.items.map((i: any) => i.code).slice(0, 2)).toEqual(['A-001', 'A_002']);
      const listed = (await get('/sites?pageSize=100')).body.items.map((i: any) => i.code) as string[];
      expect(listed).toEqual([...listed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    } finally {
      await pool.query(`DELETE FROM sites WHERE code='A_002'`);
    }
  });

  it('unexpected errors return 500 without SQL or stack text', async () => {
    const broken = {
      query: async () => {
        throw Object.assign(new Error('relation "sites" SELECT secret_column'), { code: '42P01' });
      },
    };
    const brokenApp = await startApp(broken);
    try {
      const response = await fetch((await brokenApp.getUrl()) + '/sites');
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(JSON.parse(text)).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
      });
      expect(text).not.toMatch(/secret_column|relation|at /);
    } finally {
      await brokenApp.close();
    }
  });

  it('database unavailable maps to 503 without leaking details', async () => {
    const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
    const deadApp = await startApp(deadPool);
    try {
      for (const p of ['/sites', '/sites.geojson?bbox=1,2,3,4', '/sites/A-001']) {
        const response = await fetch((await deadApp.getUrl()) + p);
        const body = await response.json();
        expect([p, response.status, body]).toEqual([
          p,
          503,
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Database service is unavailable', details: {} } },
        ]);
      }
    } finally {
      await deadApp.close();
      await deadPool.end();
    }
  });
});
