const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, migrate } = require('../../dist/database/connection');
const { createApp } = require('../../dist/app.module');
const { readConfig } = require('../../dist/config/config');

const config = readConfig(process.env);
// Fixtures truncate domain tables, so refuse anything that is not an explicit test database.
if (!/test/i.test(new URL(config.databaseUrl).pathname)) throw new Error('sites integration tests require a *test* database in DATABASE_URL');

const ADMIN = '00000000-0000-4000-8000-000000000001';
const square = (lon, lat, d) => `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat}))',4326))`;
let pool, app, base;

async function site(id, code, name, province, polygon, deleted = false) {
  await pool.query(`INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by,deleted_at)
    VALUES($1,$2,$3,$4,${polygon},ST_Area(${polygon}::geography)/1600,$5,$5,$6)`, [id, code, name, province, ADMIN, deleted ? new Date() : null]);
}
async function survey(siteId, on, cover, lon = 99.305, lat = 7.305) {
  await pool.query(`INSERT INTO surveys(site_id,geom,surveyed_on,cover_percent,created_by,updated_by)
    VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,$6,$6)`, [siteId, lon, lat, on, cover, ADMIN]);
}
const get = async path => { const r = await fetch(base + path); return { status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json() }; };

before(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,'admin@test.local','x','admin')`, [ADMIN]);
  await pool.query(`INSERT INTO provinces(code,name_th,geom) VALUES('93','พัทลุง',${square(99, 7, 1)}),('80','นครศรีธรรมราช',${square(100, 7, 1)})`);
  const ids = n => `00000000-0000-4000-8000-0000000001${n}`;
  await site(ids(10), 'A-001', 'Alpha bay', '93', square(99.3, 7.3, 0.01));
  await site(ids(11), 'B-002', 'Beta reef', '93', square(99.5, 7.5, 0.01));
  await site(ids(12), 'C-003', 'Charlie', '80', square(100.3, 7.3, 0.01));
  await site(ids(13), 'D-004', 'Deleted site', '93', square(99.31, 7.31, 0.005), true);
  await site(ids(14), 'E-005', 'Echo 50%_cover', '93', square(99.7, 7.7, 0.01));
  await site(ids(15), 'F-006', 'Foxtrot', '93', square(99.8, 7.8, 0.01));
  // A: latest day averages exactly 75 (very_good) even though an older day is poor.
  await survey(ids(10), '2026-09-01', 10); await survey(ids(10), '2026-10-01', 80); await survey(ids(10), '2026-10-01', 70);
  await survey(ids(11), '2026-10-02', 50, 99.505, 7.505);
  await survey(ids(14), '2026-10-03', 24.99, 99.705, 7.705);
  await survey(ids(15), '2026-10-04', 25, 99.805, 7.805);
  app = await createApp(pool);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); await pool.end(); });

test('GET /sites lists active sites by code with computed status and no geometry', async () => {
  const { status, headers, body } = await get('/sites');
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(body.total, 5);
  assert.equal(body.page, 1);
  assert.deepEqual(body.items.map(i => [i.code, i.status]),
    [['A-001', 'very_good'], ['B-002', 'good'], ['C-003', 'no_data'], ['E-005', 'poor'], ['F-006', 'fair']]);
  for (const item of body.items) {
    assert.deepEqual(Object.keys(item).sort(), ['area_rai', 'code', 'name', 'province_code', 'status', 'version']);
    assert.equal(typeof item.area_rai, 'number');
    assert.equal(item.area_rai, Math.round(item.area_rai * 100) / 100);
  }
});

test('GET /sites filters, literal search and paging share one filter', async () => {
  assert.deepEqual((await get('/sites?province=80')).body.items.map(i => i.code), ['C-003']);
  assert.deepEqual((await get('/sites?status=good')).body.items.map(i => i.code), ['B-002']);
  assert.deepEqual((await get('/sites?q=a-0')).body.items.map(i => i.code), ['A-001']);
  assert.deepEqual((await get('/sites?q=REEF')).body.items.map(i => i.code), ['B-002']);
  assert.deepEqual((await get('/sites?q=%25')).body.items.map(i => i.code), ['E-005']);
  assert.deepEqual((await get('/sites?q=_')).body.items.map(i => i.code), ['E-005']);
  const filtered = await get('/sites?province=93&status=poor');
  assert.deepEqual([filtered.body.total, filtered.body.items.map(i => i.code)], [1, ['E-005']]);
  const page = await get('/sites?pageSize=2&page=2');
  assert.deepEqual([page.body.total, page.body.page, page.body.items.map(i => i.code)], [5, 2, ['C-003', 'E-005']]);
  const beyond = await get('/sites?page=9');
  assert.deepEqual([beyond.status, beyond.body.total, beyond.body.items], [200, 5, []]);
});

test('GET /sites rejects invalid input with the shared envelope', async () => {
  for (const path of ['/sites?page=0', '/sites?pageSize=101', '/sites?status=great', '/sites?sort=name', '/sites?q=a&q=b',
    '/sites?q=%00', '/sites/%ZZ', '/sites/%E0%A4%A']) {
    const { status, body } = await get(path);
    assert.equal(status, 400, path);
    assert.equal(body.error.code, 'VALIDATION_ERROR', path);
    assert.equal(typeof body.error.message, 'string');
  }
});

test('GET /sites.geojson returns only active sites intersecting the bbox', async () => {
  const { status, body } = await get('/sites.geojson?bbox=99.29,7.29,99.32,7.32');
  assert.equal(status, 200);
  assert.equal(body.type, 'FeatureCollection');
  assert.deepEqual(body.features.map(f => f.properties.code), ['A-001']);
  const [feature] = body.features;
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.geometry.type, 'MultiPolygon');
  assert.deepEqual(feature.geometry.coordinates[0][0][0], [99.3, 7.3]);
  assert.deepEqual(Object.keys(feature.properties).sort(), ['area_rai', 'code', 'id', 'latestSurvey', 'name', 'province_code', 'status', 'version']);
  const all = await get('/sites.geojson?bbox=98,6,102,9');
  assert.deepEqual(all.body.features.map(f => f.properties.code), ['A-001', 'B-002', 'C-003', 'E-005', 'F-006']);
  const filtered = await get('/sites.geojson?bbox=98,6,102,9&province=93&status=fair&q=fox');
  assert.deepEqual(filtered.body.features.map(f => f.properties.code), ['F-006']);
  assert.deepEqual((await get('/sites.geojson?bbox=0,0,1,1')).body, { type: 'FeatureCollection', features: [] });
});

test('GET /sites.geojson rejects bad bbox and unknown params', async () => {
  for (const path of ['/sites.geojson', '/sites.geojson?bbox=1,2,3', '/sites.geojson?bbox=100,7,99,8', '/sites.geojson?bbox=1,2,3,4&bbox=1,2,3,4']) {
    const { status, body } = await get(path);
    assert.deepEqual([status, body.error.code], [400, 'INVALID_BBOX'], path);
  }
  const page = await get('/sites.geojson?bbox=1,2,3,4&page=1');
  assert.deepEqual([page.status, page.body.error.code], [400, 'VALIDATION_ERROR']);
});

test('GET /sites/:code returns a Feature with the latest-day summary', async () => {
  const { status, body } = await get('/sites/A-001');
  assert.equal(status, 200);
  assert.equal(body.type, 'Feature');
  assert.equal(body.properties.status, 'very_good');
  assert.deepEqual(body.properties.latestSurvey, { surveyed_on: '2026-10-01', average_cover_percent: 75, count: 2 });
  assert.equal(body.properties.version, 1);
  assert.equal((await get('/sites/C-003')).body.properties.latestSurvey, null);
  assert.equal((await get('/sites/E-005')).body.properties.latestSurvey.average_cover_percent, 24.99);
  for (const code of ['D-004', 'NOPE']) {
    const missing = await get(`/sites/${code}`);
    assert.deepEqual([missing.status, missing.body.error.code], [404, 'SITE_NOT_FOUND'], code);
  }
  const tooLong = await get(`/sites/${'x'.repeat(65)}`);
  assert.deepEqual([tooLong.status, tooLong.body.error.code], [400, 'VALIDATION_ERROR']);
});

test('public reads ignore an invalid session cookie', async () => {
  const response = await fetch(`${base}/sites/A-001`, { headers: { Cookie: 'gis_access=not-a-jwt' } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).properties.code, 'A-001');
});

test('codes sort byte-wise regardless of database collation', async () => {
  await pool.query(`INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by)
    VALUES('00000000-0000-4000-8000-000000000199','A_002','Underscore','93',${square(99.9, 7.9, 0.01)},1,$1,$1)`, [ADMIN]);
  try {
    // "C" byte order: '-' (0x2D) < '_' (0x5F); en_US collation ignores punctuation and would compare 001 vs 002 first.
    assert.deepEqual((await get('/sites?q=A')).body.items.map(i => i.code).slice(0, 2), ['A-001', 'A_002']);
    assert.deepEqual((await get('/sites?pageSize=100')).body.items.map(i => i.code),
      [...(await get('/sites?pageSize=100')).body.items.map(i => i.code)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  } finally { await pool.query(`DELETE FROM sites WHERE code='A_002'`); }
});

test('unexpected errors return 500 without SQL or stack text', async () => {
  const broken = { query: async () => { throw Object.assign(new Error('relation "sites" SELECT secret_column'), { code: '42P01' }); } };
  const brokenApp = await createApp(broken);
  await brokenApp.listen(0, '127.0.0.1');
  try {
    const response = await fetch((await brokenApp.getUrl()) + '/sites');
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(text), { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} } });
    assert.doesNotMatch(text, /secret_column|relation|at /);
  } finally { await brokenApp.close(); }
});

test('database unavailable maps to 503 without leaking details', async () => {
  const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
  const deadApp = await createApp(deadPool);
  await deadApp.listen(0, '127.0.0.1');
  try {
    for (const path of ['/sites', '/sites.geojson?bbox=1,2,3,4', '/sites/A-001']) {
      const response = await fetch((await deadApp.getUrl()) + path);
      const body = await response.json();
      assert.deepEqual([response.status, body], [503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Database service is unavailable', details: {} } }], path);
    }
  } finally { await deadApp.close(); await deadPool.end(); }
});
