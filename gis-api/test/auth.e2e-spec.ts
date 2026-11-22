import { Test } from '@nestjs/testing';
import { appModule, AppOptions } from '../src/app.module';
import { hashPassword, signAccessToken } from '../src/auth/utils/crypto';
import { readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { seedDemoUsers } from '../src/core/database/seeders/demo-users';
import { assertTestDatabase, migrate } from './helpers';

const config = readConfig(process.env);
// Fixtures truncate domain tables, so refuse anything that is not an explicit test database.
assertTestDatabase(config.databaseUrl, 'auth');

const SECRET = 'integration-secret-integration-secret-0001';
const WEB = 'http://localhost:3000';
const auth = { jwtSecret: SECRET, allowedOrigins: [WEB, 'http://localhost:3001'], cookieSecure: false };
const USERS = { viewer: '00000000-0000-4000-8000-0000000000a1', admin: '00000000-0000-4000-8000-0000000000a3' };
let pool: ReturnType<typeof createPool>;
let app: any;
let base: string;

async function startApp(database: any, options: AppOptions) {
  const moduleRef = await Test.createTestingModule({ imports: [appModule(database, options)] }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.listen(0, '127.0.0.1');
  return started;
}
const csrf = { Origin: WEB, 'X-CSRF-Protection': '1' };
const login = (email: string, password: string, extra: Record<string, string> = {}) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrf, ...extra },
    body: JSON.stringify({ email, password }),
  });
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const me = (cookie?: string) => fetch(`${base}/auth/me`, { headers: cookie ? { Cookie: cookie } : {} });
const sessions = async () =>
  (await pool.query('SELECT user_id, revoked_at FROM access_sessions ORDER BY created_at')).rows;
const errorCode = async (response: Response) => ((await response.json()) as any).error.code;

beforeAll(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  await pool.query(
    `INSERT INTO users(id,email,password_hash,role) VALUES($1,'viewer@demo.local',$2,'viewer'),($3,'admin@demo.local',$4,'admin')`,
    [USERS.viewer, await hashPassword('viewer-pass'), USERS.admin, await hashPassword('admin-pass')],
  );
  app = await startApp(pool, { auth, loginLimit: { max: 1000, windowMs: 60_000 } });
  base = await app.getUrl();
});
afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('auth (real PostGIS)', () => {
  it('GET /auth/me accepts only the Bearer header', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const response = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${cookie.split('=')[1]}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(((await response.json()) as any).user.id).toBe(USERS.viewer);
  });

  it('a valid Bearer header wins over a different valid cookie', async () => {
    const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const viewer = cookieOf(await login('viewer@demo.local', 'viewer-pass')).split('=')[1];
    const response = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie, Authorization: `Bearer ${viewer}` } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).user.role).toBe('viewer');
  });

  it.each(['Bearer invalid', 'Basic invalid', 'Bearer', 'Bearer a b', '', 'Bearer '])(
    'unusable Authorization header (%#) never falls back or clears the valid cookie',
    async (authorization) => {
      const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
      for (const path of ['/auth/me', '/sites']) {
        const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie, Authorization: authorization } });
        expect(response.status).toBe(path === '/auth/me' ? 401 : 200);
        expect(response.headers.get('set-cookie')).toBeNull();
      }
      expect((await me(cookie)).status).toBe(200);
    },
  );

  it('bearer logout still requires CSRF and revokes both header and cookie sessions', async () => {
    const headerCookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const otherCookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const headers = { Authorization: `Bearer ${headerCookie.split('=')[1]}`, Cookie: otherCookie };
    const blocked = await fetch(`${base}/auth/logout`, { method: 'POST', headers });
    expect([blocked.status, await errorCode(blocked)]).toEqual([403, 'CSRF_REJECTED']);
    expect(blocked.headers.get('set-cookie')).toBeNull();
    expect((await me(headerCookie)).status).toBe(200);
    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...headers, ...csrf } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toBe('gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    expect((await me(headerCookie)).status).toBe(401);
    const replay = await fetch(`${base}/auth/me`, { headers: { Authorization: headers.Authorization } });
    expect(replay.status).toBe(401);
    expect(replay.headers.get('set-cookie')).toBeNull();
    expect((await me(otherCookie)).status).toBe(401);
  });

  it('bearer-only logout does not clear an absent cookie and blocks a subsequent PATCH', async () => {
    const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const Authorization = `Bearer ${cookie.split('=')[1]}`;
    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...csrf, Authorization } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toBeNull();
    const patch = await fetch(`${base}/sites/REVOKED`, {
      method: 'PATCH',
      headers: { Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 1, name: 'Denied' }),
    });
    expect(patch.status).toBe(401);
    expect(await errorCode(patch)).toBe('UNAUTHORIZED');
  });

  it('bearer logout clears and revokes the matching cookie session', async () => {
    const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const out = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { ...csrf, Cookie: cookie, Authorization: `Bearer ${cookie.split('=')[1]}` },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toBe('gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    expect((await me(cookie)).status).toBe(401);
  });

  it('login revokes both the existing cookie and the supplied bearer session', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const bearer = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const response = await login('viewer@demo.local', 'viewer-pass', {
      Cookie: cookie,
      Authorization: `Bearer ${bearer.split('=')[1]}`,
    });
    expect(response.status).toBe(200);
    expect((await me(cookieOf(response))).status).toBe(200);
    for (const old of [cookie, bearer]) {
      expect((await me(old)).status).toBe(401);
      expect(
        (await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${old.split('=')[1]}` } })).status,
      ).toBe(401);
    }
  });

  it('bad bearer logout does not fall back to the cookie session', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const revoked = cookieOf(await login('admin@demo.local', 'admin-pass'));
    expect((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...csrf, Cookie: revoked } })).status).toBe(
      204,
    );
    const expired = signAccessToken(
      { sub: USERS.viewer, sid: '00000000-0000-4000-8000-000000000123' },
      SECRET,
      Math.floor(Date.now() / 1000) - 1000,
    );
    for (const authorization of [
      'Bearer invalid',
      'Basic invalid',
      '',
      `Bearer ${expired}`,
      `Bearer ${revoked.split('=')[1]}`,
    ]) {
      const response = await fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { ...csrf, Cookie: cookie, Authorization: authorization },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect((await me(cookie)).status).toBe(200);
    }
  });

  it('dual-session logout rolls back both revocations on failure and can be retried', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const bearer = cookieOf(await login('admin@demo.local', 'admin-pass'));
    let updates = 0;
    const query = async (client: any, sql: string, params?: unknown[]) => {
      if (sql.startsWith('UPDATE access_sessions') && ++updates === 2)
        throw Object.assign(new Error('injected unavailable database'), { code: '08006' });
      return client.query(sql, params);
    };
    const flaky = await startApp(
      {
        query: (sql: string, params?: unknown[]) => query(pool, sql, params),
        connect: async () => {
          const client = await pool.connect();
          return {
            query: (sql: string, params?: unknown[]) => query(client, sql, params),
            release: () => client.release(),
          };
        },
      },
      { auth },
    );
    try {
      const url = `${await flaky.getUrl()}/auth/logout`;
      const headers = { ...csrf, Cookie: cookie, Authorization: `Bearer ${bearer.split('=')[1]}` };
      const failed = await fetch(url, { method: 'POST', headers });
      expect(failed.status).toBe(503);
      expect(failed.headers.get('set-cookie')).toBeNull();
      expect((await me(cookie)).status).toBe(200);
      expect((await me(bearer)).status).toBe(200);
      const retry = await fetch(url, { method: 'POST', headers });
      expect(retry.status).toBe(204);
      expect(retry.headers.get('set-cookie')).toBe('gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
      expect((await me(cookie)).status).toBe(401);
      expect((await me(bearer)).status).toBe(401);
    } finally {
      await flaky.close();
    }
  });

  it('login returns the cookie JWT and Bearer token type while preserving cookie attributes', async () => {
    const response = await login('Viewer@Demo.Local', 'viewer-pass');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^gis_access=[\w-]+\.[\w-]+\.[\w-]+; Max-Age=900; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(setCookie).not.toMatch(/Domain=|Secure/);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_at', 'expires_in', 'token_type', 'user']);
    expect(body.user).toEqual({ id: USERS.viewer, email: 'viewer@demo.local', role: 'viewer' });
    expect(body.expires_in).toBe(900);
    expect(body.token_type).toBe('Bearer');
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token === cookieOf(response).split('=')[1]).toBe(true);
    const restored = await me(cookieOf(response));
    expect(restored.status).toBe(200);
    expect(restored.headers.get('cache-control')).toBe('no-store');
    expect(await restored.json()).toEqual({ user: body.user, expires_at: body.expires_at });
  });

  it('wrong credentials give one generic 401 and create no session', async () => {
    const countBefore = (await sessions()).length;
    for (const [email, password] of [
      ['viewer@demo.local', 'nope'],
      ['ghost@demo.local', 'viewer-pass'],
    ]) {
      const response = await login(email, password);
      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe('INVALID_CREDENTIALS');
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect((await sessions()).length).toBe(countBefore);
  });

  it('login and logout reject CSRF before touching credentials or sessions', async () => {
    const before = await sessions();
    for (const headers of [
      { Origin: 'http://evil.example' },
      { 'X-CSRF-Protection': '0' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const response = await login('viewer@demo.local', 'viewer-pass', headers);
      expect([response.status, await errorCode(response)]).toEqual([403, 'CSRF_REJECTED']);
    }
    const good = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const count = (await sessions()).length;
    for (const headers of [
      { Origin: 'http://evil.example', 'X-CSRF-Protection': '1' },
      { 'X-CSRF-Protection': '1' },
      { ...csrf, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      const blocked = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: good, ...headers } });
      expect([blocked.status, blocked.headers.get('set-cookie')]).toEqual([403, null]); // CSRF failure is not a forced logout
    }
    expect((await me(good)).status).toBe(200);
    expect((await sessions()).length).toBe(count);
    expect(before.length).toBeLessThan(count);
  });

  it('login validates the JSON body strictly', async () => {
    const send = (body: string, type = 'application/json') =>
      fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': type, ...csrf }, body });
    for (const body of [
      '{"email":"a@b.c"}',
      '{"email":"a@b.c","password":"x","role":"admin"}',
      '{"email":1,"password":"x"}',
      '{"email":"a@b.c","password":"x","__proto__":{"role":"admin"}}',
      '{"email":"a@b.c","password":"x","constructor":1}',
      '[]',
      '{bad json',
    ])
      expect([body, (await send(body)).status]).toEqual([body, 400]);
    expect((await send('email=a&password=b', 'application/x-www-form-urlencoded')).status).toBe(400);
  });

  it('logout revokes the session; the captured cookie is then rejected', async () => {
    const response = await login('admin@demo.local', 'admin-pass');
    const cookie = cookieOf(response);
    const out = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...csrf } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toBe('gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    const { sid } = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[1], 'base64url').toString());
    const [row] = (await pool.query('SELECT revoked_at FROM access_sessions WHERE id = $1', [sid])).rows;
    expect(row.revoked_at).toBeInstanceOf(Date); // revoked_at recorded
    const replay = await me(cookie);
    expect(replay.status).toBe(401);
    expect(await errorCode(replay)).toBe('UNAUTHORIZED');
    const again = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...csrf } });
    expect(again.status).toBe(204); // logout is idempotent
    expect((await fetch(`${base}/auth/logout`, { method: 'POST', headers: csrf })).status).toBe(204);
  });

  it('re-login revokes the previous session atomically', async () => {
    const first = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const second = await login('viewer@demo.local', 'viewer-pass', { Cookie: first });
    expect(second.status).toBe(200);
    expect((await me(first)).status).toBe(401);
    expect((await me(cookieOf(second))).status).toBe(200);
  });

  it('me rejects missing, forged, expired and session-less tokens', async () => {
    expect((await me()).status).toBe(401);
    expect((await me('gis_access=abc.def.ghi')).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    const expired = signAccessToken(
      { sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000dead' },
      SECRET,
      now - 1000,
    );
    expect((await me(`gis_access=${expired}`)).status).toBe(401);
    const unknownSession = signAccessToken(
      { sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000dead' },
      SECRET,
      now,
    );
    expect((await me(`gis_access=${unknownSession}`)).status).toBe(401);
    const res = await me('gis_access=abc.def.ghi');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/^gis_access=; Max-Age=0/);
    // Session owned by another user: sid valid, sub swapped.
    const viewerCookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const [, payload] = viewerCookie.split('=')[1].split('.');
    const { sid } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const swapped = signAccessToken({ sub: USERS.admin, sid }, SECRET, now);
    expect((await me(`gis_access=${swapped}`)).status).toBe(401);
    const bearer = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${viewerCookie.split('=')[1]}` },
    });
    expect(bearer.status).toBe(200);
  });

  it('role changes in the database apply to the existing session', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    await pool.query(`UPDATE users SET role = 'editor' WHERE id = $1`, [USERS.viewer]);
    try {
      expect(((await (await me(cookie)).json()) as any).user.role).toBe('editor');
    } finally {
      await pool.query(`UPDATE users SET role = 'viewer' WHERE id = $1`, [USERS.viewer]);
    }
  });

  it('cross-site requests are rejected with 403 even when the database is down', async () => {
    const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
    const dead = await startApp(deadPool, { auth });
    try {
      for (const p of ['/auth/logout', '/auth/login']) {
        const response = await fetch(`${await dead.getUrl()}${p}`, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/json',
            Origin: 'http://evil.example',
            'X-CSRF-Protection': '1',
          },
          body: '{}',
        });
        expect([p, response.status]).toEqual([p, 403]);
      }
    } finally {
      await dead.close();
      await deadPool.end();
    }
  });

  it('a validly signed cookie while the database is down gives 503 from the auth middleware', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
    const dead = await startApp(deadPool, { auth });
    try {
      const response = await fetch(`${await dead.getUrl()}/auth/me`, { headers: { Cookie: cookie } });
      expect([response.status, response.headers.get('cache-control'), await errorCode(response)]).toEqual([
        503,
        'no-store',
        'SERVICE_UNAVAILABLE',
      ]);
    } finally {
      await dead.close();
      await deadPool.end();
    }
  });

  it('credential attempts are rate limited per client', async () => {
    const limited = await startApp(pool, { auth, loginLimit: { max: 3, windowMs: 60_000 } });
    const url = `${await limited.getUrl()}/auth/login`;
    const post = (email: string, password: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrf },
        body: JSON.stringify({ email, password }),
      });
    const attempt = () => post('viewer@demo.local', 'bad');
    try {
      const good = () => post('admin@demo.local', 'admin-pass');
      for (let i = 0; i < 5; i++) expect((await good()).status).toBe(200); // successful logins are not counted
      expect([(await attempt()).status, (await attempt()).status, (await attempt()).status]).toEqual([401, 401, 401]);
      const blocked = await attempt();
      expect([blocked.status, await errorCode(blocked)]).toEqual([429, 'AUTH_RATE_LIMITED']);
      expect((await good()).status).toBe(200); // another account is not locked out by these failures
      const parallel = await Promise.all(
        Array.from({ length: 8 }, () => post('parallel@demo.local', 'bad').then((r) => r.status)),
      );
      expect([parallel.join(','), parallel.filter((s) => s === 401).length]).toEqual([parallel.join(','), 3]); // concurrent attempts cannot exceed the limit
      expect(parallel.filter((s) => s === 429).length).toBeGreaterThanOrEqual(5);
    } finally {
      await limited.close();
    }
  });

  it('logout keeps the cookie when the database cannot revoke', async () => {
    const cookie = cookieOf(await login('admin@demo.local', 'admin-pass'));
    const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/none');
    const dead = await startApp(deadPool, { auth });
    try {
      const response = await fetch(`${await dead.getUrl()}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie, ...csrf },
      });
      expect([response.status, response.headers.get('set-cookie')]).toEqual([503, null]);
      expect((await me(cookie)).status).toBe(200); // session not silently revoked
    } finally {
      await dead.close();
      await deadPool.end();
    }
  });

  it('the demo-user seeder revokes active sessions only when it changes the password hash or role', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    try {
      expect(await seedDemoUsers(pool, { DEMO_VIEWER_PASSWORD: 'viewer-pass' })).toEqual([]); // unchanged: untouched
      expect((await me(cookie)).status).toBe(200);
      expect(await seedDemoUsers(pool, { DEMO_VIEWER_PASSWORD: 'viewer-pass-rotated' })).toEqual(['viewer@demo.local']);
      expect((await me(cookie)).status).toBe(401); // old password's session no longer works
      const rotated = cookieOf(await login('viewer@demo.local', 'viewer-pass-rotated'));
      await pool.query(`UPDATE users SET role = 'editor' WHERE id = $1`, [USERS.viewer]);
      expect(await seedDemoUsers(pool, { DEMO_VIEWER_PASSWORD: 'viewer-pass-rotated' })).toEqual(['viewer@demo.local']);
      expect((await me(rotated)).status).toBe(401); // role reset by the seeder also revokes
      const active = await pool.query(
        'SELECT count(*)::int AS n FROM access_sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [USERS.viewer],
      );
      expect(active.rows[0].n).toBe(0);
    } finally {
      await pool.query(`UPDATE users SET password_hash = $2, role = 'viewer' WHERE id = $1`, [
        USERS.viewer,
        await hashPassword('viewer-pass'),
      ]);
    }
  });

  it('the demo-user seeder changes the hash and revokes sessions atomically', async () => {
    const cookie = cookieOf(await login('viewer@demo.local', 'viewer-pass'));
    // Same pool, but the session revoke fails inside any transaction client (and on the pool itself).
    const revokeFails = (sql: string) => /UPDATE access_sessions/.test(sql);
    const failing = {
      query: (sql: string, params?: unknown[]) =>
        revokeFails(sql) ? Promise.reject(new Error('revoke failed')) : pool.query(sql, params),
      connect: async () => {
        const client = await pool.connect();
        // A wrapper, not a mutation: the pooled client is reused unchanged after release.
        return {
          query: (sql: string, params?: unknown[]) =>
            revokeFails(sql) ? Promise.reject(new Error('revoke failed')) : client.query(sql, params),
          release: (error?: Error) => client.release(error),
        };
      },
    };
    try {
      await expect(seedDemoUsers(failing as any, { DEMO_VIEWER_PASSWORD: 'viewer-pass-rotated' })).rejects.toThrow();
      expect((await login('viewer@demo.local', 'viewer-pass-rotated')).status).toBe(401); // hash change rolled back
      expect((await me(cookie)).status).toBe(200);
      expect(await seedDemoUsers(pool, { DEMO_VIEWER_PASSWORD: 'viewer-pass-rotated' })).toEqual(['viewer@demo.local']);
      expect((await me(cookie)).status).toBe(401); // the retry still revokes
    } finally {
      await pool.query(`UPDATE users SET password_hash = $2, role = 'viewer' WHERE id = $1`, [
        USERS.viewer,
        await hashPassword('viewer-pass'),
      ]);
    }
  });
});
