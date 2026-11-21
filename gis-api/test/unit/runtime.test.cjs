const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readConfig } = require('../../dist/config/config');
const { HealthService } = require('../../dist/health/health.service');
const { HealthRepository } = require('../../dist/health/health.repository');
const checkHealth = db => new HealthService(new HealthRepository(db)).check();
const { applyMigrations } = require('../../dist/database/migrator');
const { createApp } = require('../../dist/app.module');

test('config requires PostgreSQL URL, rejects invalid ports and preserves valid port', () => {
  assert.throws(() => readConfig({}), /DATABASE_URL/);
  assert.throws(() => readConfig({ DATABASE_URL: 'https://secret.example' }), /DATABASE_URL/);
  for (const PORT of ['0', '65536', '3.5', '3001garbage', '', '-1']) {
    assert.throws(() => readConfig({ DATABASE_URL: 'postgres://localhost/gis', PORT }), /PORT/);
  }
  assert.equal(readConfig({ DATABASE_URL: 'postgres://localhost/gis', PORT: '4000' }).port, 4000);
});
test('health executes DB query and serializes actual major.minor', async () => {
  let queried = false;
  const result = await checkHealth({ query: async sql => {
    assert.match(sql, /SELECT 1/); assert.match(sql, /postgis_lib_version/);
    queried = true; return { rows: [{ ready: 1, postgis: '3.5.4' }] };
  } });
  assert.equal(queried, true);
  assert.deepEqual(result, { db: 'ok', postgis: '3.5' });
});
test('health dependency error is safe 503', async () => {
  await assert.rejects(checkHealth({ query: async () => { throw new Error('password=secret'); } }), error => {
    assert.equal(error.getStatus(), 503);
    assert.equal(JSON.stringify(error.getResponse()).includes('secret'), false);
    return true;
  });
});
function fakeClient(applied = [], failSql) {
  const calls = [];
  return { calls, query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql === failSql) throw new Error('dependency secret');
    return { rows: sql.startsWith('SELECT version') ? applied : [] };
  } };
}
test('changed applied migration rejects before SQL executes and unlocks', async () => {
  const client = fakeClient([{ version: '001.sql', checksum: 'different' }]);
  await assert.rejects(applyMigrations(client, [{ version: '001.sql', sql: 'SELECT 42' }]), /checksum/i);
  assert.equal(client.calls.some(c => c.sql === 'SELECT 42'), false);
  assert.equal(client.calls.some(c => c.sql.includes('pg_advisory_unlock')), true);
});
test('failed migration rolls back and never records it', async () => {
  const client = fakeClient([], 'BROKEN SQL');
  await assert.rejects(applyMigrations(client, [{ version: '001.sql', sql: 'BROKEN SQL' }]), /Migration failed/);
  assert.equal(client.calls.some(c => c.sql === 'ROLLBACK'), true);
  assert.equal(client.calls.some(c => c.sql.startsWith('INSERT INTO schema_migrations')), false);
});
test('migrations sort, hash and skip previously applied files', async () => {
  const sql = 'SELECT 1';
  const client = fakeClient([{ version: '001.sql', checksum: createHash('sha256').update(sql).digest('hex') }]);
  await applyMigrations(client, [{ version: '002.sql', sql: 'SELECT 2' }, { version: '001.sql', sql }]);
  assert.equal(client.calls.some(c => c.sql === sql), false);
  const insert = client.calls.find(c => c.sql.startsWith('INSERT INTO schema_migrations'));
  assert.equal(insert.values[0], '002.sql');
  assert.equal(insert.values[1], createHash('sha256').update('SELECT 2').digest('hex'));
  assert.equal(client.calls.some(c => c.sql === 'COMMIT'), true);
});
test('HTTP dependency failure and unknown route use safe envelope; close awaits resource cleanup', async () => {
  let closed = false;
  const app = await createApp({ query: async () => { throw new Error('password=secret'); } }, { onShutdown: async () => { closed = true; } });
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/health`, { headers: { Cookie: 'gis_access=invalid' } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: { code: 'SERVICE_UNAVAILABLE', message: 'Database service is unavailable', details: {} } });
    const missing = await fetch(`${await app.getUrl()}/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Resource not found', details: {} } });
  } finally { await app.close(); }
  assert.equal(closed, true);
});
