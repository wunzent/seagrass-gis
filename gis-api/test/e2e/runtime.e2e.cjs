const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, migrate } = require('../../dist/database/connection');
const { createApp } = require('../../dist/app.module');
const { readConfig } = require('../../dist/config/config');

test('real PostGIS migrations are idempotent and HTTP health reflects DB', async () => {
  const config = readConfig(process.env);
  const pool = createPool(config.databaseUrl);
  let app;
  try {
    await migrate(pool);
    const before = (await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version')).rows;
    assert.equal(before.length, 4);
    await migrate(pool);
    assert.deepEqual((await pool.query('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version')).rows, before);
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(r => r.table_name);
    for (const table of ['provinces','species','users','sites','surveys','survey_species','access_sessions']) assert.ok(tables.includes(table));
    const geometries = (await pool.query("SELECT f_table_name, type, srid FROM geometry_columns WHERE f_table_schema='public'")).rows;
    assert.equal(geometries.length, 3);
    assert.ok(geometries.every(g => g.srid === 4326));
    app = await createApp(pool);
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const response = await fetch(`${base}/health`, { headers: { Cookie: 'gis_access=invalid' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const actual = (await pool.query('SELECT postgis_lib_version() AS version')).rows[0].version;
    assert.deepEqual(await response.json(), { db: 'ok', postgis: actual.split('.').slice(0,2).join('.') });
    const unknown = await fetch(`${base}/missing?secret=never-echo`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: { code: 'NOT_FOUND', message: 'Resource not found', details: {} } });
  } finally { if (app) await app.close(); await pool.end(); }
});
