const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, migrate } = require('../../dist/database/connection');
const { createApp } = require('../../dist/app.module');
const { readConfig } = require('../../dist/config/config');
const { hashPassword, signAccessToken } = require('../../dist/auth/crypto');

const config = readConfig(process.env);
if (!/test/i.test(new URL(config.databaseUrl).pathname)) throw new Error('auth integration tests require a *test* database in DATABASE_URL');

const SECRET = 'integration-secret-integration-secret-0001';
const WEB = 'http://localhost:3000';
const auth = { jwtSecret: SECRET, allowedOrigins: [WEB, 'http://localhost:3001'], cookieSecure: false };
const USERS = { viewer: '00000000-0000-4000-8000-0000000000a1', admin: '00000000-0000-4000-8000-0000000000a3' };
let pool, app, base;

const csrf = { Origin: WEB, 'X-CSRF-Protection': '1' };
const login = (email, password, extra = {}) => fetch(`${base}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...csrf, ...extra }, body: JSON.stringify({ email, password }),
});
const cookieOf = response => (response.headers.get('set-cookie') ?? '').split(';')[0];
const me = cookie => fetch(`${base}/auth/me`, { headers: cookie ? { Cookie: cookie } : {} });
const sessions = async () => (await pool.query('SELECT user_id, revoked_at FROM access_sessions ORDER BY created_at')).rows;

before(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,'viewer@demo.local',$2,'viewer'),($3,'admin@demo.local',$4,'admin')`,
    [USERS.viewer, await hashPassword('viewer-pass'), USERS.admin, await hashPassword('admin-pass')]);
  app = await createApp(pool, { auth, loginLimit: { max: 1000, windowMs: 60_000 } });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); await pool.end(); });

test('login sets an HttpOnly host-only cookie and never returns the JWT in JSON', async () => {
  const response = await login('Viewer@Demo.Local', 'viewer-pass');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^gis_access=[\w-]+\.[\w-]+\.[\w-]+; Max-Age=900; Path=\/; HttpOnly; SameSite=Lax$/);
  assert.doesNotMatch(setCookie, /Domain=|Secure/);
  const text = await response.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body).sort(), ['expires_at', 'expires_in', 'user']);
  assert.deepEqual(body.user, { id: USERS.viewer, email: 'viewer@demo.local', role: 'viewer' });
  assert.equal(body.expires_in, 900);
  assert.ok(!text.includes(cookieOf(response).split('=')[1]), 'token not in body');
  const restored = await me(cookieOf(response));
  assert.equal(restored.status, 200);
  assert.equal(restored.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await restored.json(), { user: body.user, expires_at: body.expires_at });
});

test('wrong credentials give one generic 401 and create no session', async () => {
  const before = (await sessions()).length;
  for (const [email, password] of [['viewer@demo.local', 'nope'], ['ghost@demo.local', 'viewer-pass']]) {
    const response = await login(email, password);
    assert.equal(response.status, 401);
    assert.deepEqual((await response.json()).error.code, 'INVALID_CREDENTIALS');
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await sessions()).length, before);
});

test('login and logout reject CSRF before touching credentials or sessions', async () => {
  const before = await sessions();
  for (const headers of [{ Origin: 'http://evil.example' }, { 'X-CSRF-Protection': '0' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await login('viewer@demo.local', 'viewer-pass', headers);
    assert.deepEqual([response.status, (await response.json()).error.code], [403, 'CSRF_REJECTED']);
  }
  const good = cookieOf(await login('admin@demo.local', 'admin-pass'));
  const count = (await sessions()).length;
  for (const headers of [{ Origin: 'http://evil.example', 'X-CSRF-Protection': '1' }, { 'X-CSRF-Protection': '1' }, { ...csrf, 'Sec-Fetch-Site': 'cross-site' }]) {
    const blocked = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: good, ...headers } });
    assert.deepEqual([blocked.status, blocked.headers.get('set-cookie')], [403, null], 'CSRF failure is not a forced logout');
  }
  assert.equal((await me(good)).status, 200);
  assert.equal((await sessions()).length, count);
  assert.ok(before.length < count);
});

test('login validates the JSON body strictly', async () => {
  const send = (body, type = 'application/json') => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': type, ...csrf }, body });
  for (const body of ['{"email":"a@b.c"}', '{"email":"a@b.c","password":"x","role":"admin"}', '{"email":1,"password":"x"}', '[]', '{bad json'])
    assert.deepEqual([(await send(body)).status], [400], body);
  assert.equal((await send('email=a&password=b', 'application/x-www-form-urlencoded')).status, 400);
});

test('logout revokes the session; the captured cookie is then rejected', async () => {
  const response = await login('admin@demo.local', 'admin-pass');
  const cookie = cookieOf(response);
  const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...csrf } });
  assert.equal(out.status, 204);
  assert.equal(out.headers.get('set-cookie'), 'gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
  const { sid } = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url'));
  const [row] = (await pool.query('SELECT revoked_at FROM access_sessions WHERE id = $1', [sid])).rows;
  assert.ok(row.revoked_at instanceof Date, 'revoked_at recorded');
  const replay = await me(cookie);
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, 'UNAUTHORIZED');
  const again = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...csrf } });
  assert.equal(again.status, 204, 'logout is idempotent');
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: csrf })).status, 204);
});

test('re-login revokes the previous session atomically', async () => {
  const first = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
  const second = await login('viewer@demo.local', 'viewer-pass', { Cookie: first });
  assert.equal(second.status, 200);
  assert.equal((await me(first)).status, 401);
  assert.equal((await me(cookieOf(second))).status, 200);
});

test('me rejects missing, forged, expired and session-less tokens', async () => {
  assert.equal((await me()).status, 401);
  assert.equal((await me('gis_access=abc.def.ghi')).status, 401);
  const now = Math.floor(Date.now() / 1000);
  const expired = signAccessToken({ sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000dead' }, SECRET, now - 1000);
  assert.equal((await me(`gis_access=${expired}`)).status, 401);
  const unknownSession = signAccessToken({ sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000dead' }, SECRET, now);
  assert.equal((await me(`gis_access=${unknownSession}`)).status, 401);
  const res = await me('gis_access=abc.def.ghi');
  assert.match(res.headers.get('set-cookie') ?? '', /^gis_access=; Max-Age=0/);
  // Session owned by another user: sid valid, sub swapped.
  const viewerCookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
  const [, payload] = viewerCookie.split('=')[1].split('.');
  const { sid } = JSON.parse(Buffer.from(payload, 'base64url'));
  const swapped = signAccessToken({ sub: USERS.admin, sid }, SECRET, now);
  assert.equal((await me(`gis_access=${swapped}`)).status, 401);
  const bearer = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${viewerCookie.split('=')[1]}` } });
  assert.equal(bearer.status, 401, 'no Bearer fallback');
});

test('role changes in the database apply to the existing session', async () => {
  const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
  await pool.query(`UPDATE users SET role = 'editor' WHERE id = $1`, [USERS.viewer]);
  try { assert.equal((await (await me(cookie)).json()).user.role, 'editor'); }
  finally { await pool.query(`UPDATE users SET role = 'viewer' WHERE id = $1`, [USERS.viewer]); }
});

test('cross-site requests are rejected with 403 even when the database is down', async () => {
  const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
  const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
  const dead = await createApp(deadPool, { auth });
  await dead.listen(0, '127.0.0.1');
  try {
    for (const path of ['/auth/logout', '/auth/login']) {
      const response = await fetch(`${await dead.getUrl()}${path}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: 'http://evil.example', 'X-CSRF-Protection': '1' }, body: '{}' });
      assert.equal(response.status, 403, path);
    }
  } finally { await dead.close(); await deadPool.end(); }
});

test('a validly signed cookie while the database is down gives 503 from the auth middleware', async () => {
  const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
  const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
  const dead = await createApp(deadPool, { auth });
  await dead.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await dead.getUrl()}/auth/me`, { headers: { Cookie: cookie } });
    assert.deepEqual([response.status, response.headers.get('cache-control'), (await response.json()).error.code], [503, 'no-store', 'SERVICE_UNAVAILABLE']);
  } finally { await dead.close(); await deadPool.end(); }
});

test('credential attempts are rate limited per client', async () => {
  const limited = await createApp(pool, { auth, loginLimit: { max: 3, windowMs: 60_000 } });
  await limited.listen(0, '127.0.0.1');
  const url = `${await limited.getUrl()}/auth/login`;
  const attempt = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...csrf }, body: JSON.stringify({ email: 'viewer@demo.local', password: 'bad' }) });
  try {
    const good = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...csrf }, body: JSON.stringify({ email: 'admin@demo.local', password: 'admin-pass' }) });
    for (let i = 0; i < 5; i++) assert.equal((await good()).status, 200, 'successful logins are not counted');
    assert.deepEqual([(await attempt()).status, (await attempt()).status, (await attempt()).status], [401, 401, 401]);
    const blocked = await attempt();
    assert.deepEqual([blocked.status, (await blocked.json()).error.code], [429, 'AUTH_RATE_LIMITED']);
    assert.equal((await good()).status, 200, 'another account is not locked out by these failures');
    const parallel = await Promise.all(Array.from({ length: 8 }, () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...csrf },
      body: JSON.stringify({ email: 'parallel@demo.local', password: 'bad' }) }).then(r => r.status)));
    assert.equal(parallel.filter(s => s === 401).length, 3, `concurrent attempts cannot exceed the limit: ${parallel}`);
    assert.ok(parallel.filter(s => s === 429).length >= 5);
  } finally { await limited.close(); }
});

test('logout keeps the cookie when the database cannot revoke', async () => {
  const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
  const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
  const dead = await createApp(deadPool, { auth });
  await dead.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await dead.getUrl()}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...csrf } });
    assert.deepEqual([response.status, response.headers.get('set-cookie')], [503, null]);
    assert.equal((await me(cookie)).status, 200, 'session not silently revoked');
  } finally { await dead.close(); await deadPool.end(); }
});
