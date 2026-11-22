import { Test } from '@nestjs/testing';
import { appModule } from '../src/app.module';
import { readAuthConfig, readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { assertTestDatabase, migrate } from './helpers';
import { signAccessToken } from '../src/auth/utils/crypto';

const config = readConfig(process.env);
assertTestDatabase(config.databaseUrl, 'demo-login');
const WEB = 'http://localhost:3000';
const csrf = { Origin: WEB, 'X-CSRF-Protection': '1' };
const roles = ['viewer', 'editor', 'admin'] as const;
let pool: ReturnType<typeof createPool>;
let app: any;
let base: string;

async function start(flag: string | undefined, database = pool, production = false, max = 1000) {
  const auth = readAuthConfig({
    JWT_SECRET: 'test-only-secret-at-least-32-characters-long',
    PUBLIC_WEB_ORIGIN: WEB,
    API_DOCS_ORIGIN: 'http://localhost:3001',
    DEMO_LOGIN_ENABLED: flag,
    NODE_ENV: production ? 'production' : 'test',
  });
  const moduleRef = await Test.createTestingModule({
    imports: [appModule(database, { auth, loginLimit: { max, windowMs: 60_000 } })],
  }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.listen(0, '127.0.0.1');
  return started;
}

function post(body: unknown, headers: Record<string, string> = csrf, url = base) {
  return fetch(`${url}/auth/demo-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const me = (cookie: string) => fetch(`${base}/auth/me`, { headers: { Cookie: cookie } });
const code = async (response: Response) => ((await response.json()) as any).error.code;

beforeAll(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  for (const role of roles) {
    await pool.query('INSERT INTO users(id,email,password_hash,role) VALUES(gen_random_uuid(),$1,$2,$3)', [
      `${role}@demo.local`,
      'disabled-password-hash',
      role,
    ]);
  }
  app = await start('true');
  base = await app.getUrl();
});

afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('demo login (real PostGIS)', () => {
  it('demo-login revokes both the existing cookie and supplied bearer session', async () => {
    const cookie = cookieOf(await post({ role: 'viewer' }));
    const bearer = cookieOf(await post({ role: 'admin' }));
    const response = await post(
      { role: 'editor' },
      { ...csrf, Cookie: cookie, Authorization: `Bearer ${bearer.split('=')[1]}` },
    );
    expect(response.status).toBe(200);
    expect((await me(cookieOf(response))).status).toBe(200);
    for (const old of [cookie, bearer]) {
      expect((await me(old)).status).toBe(401);
      expect(
        (await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${old.split('=')[1]}` } })).status,
      ).toBe(401);
    }
  });
  it.each([undefined, 'false', 'TRUE'])('flag %s returns normal 404 before CSRF and validation', async (flag) => {
    const disabled = await start(flag);
    try {
      const url = await disabled.getUrl();
      const expected = await (await fetch(`${url}/unknown-route`)).json();
      for (const response of [await fetch(`${url}/auth/demo-login`), await post({}, {}, url)]) {
        expect(response.status).toBe(404);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(await response.json()).toEqual(expected);
      }
    } finally {
      await disabled.close();
    }
  });

  it('flag true enables the routes even when NODE_ENV=production', async () => {
    const disabled = await start('true', pool, true);
    try {
      const url = await disabled.getUrl();
      expect((await fetch(`${url}/auth/demo-login`)).status).toBe(200);
      expect((await post({ role: 'viewer' }, csrf, url)).status).toBe(200);
    } finally {
      await disabled.close();
    }
  });

  it('GET returns fixed roles without authentication and no-store', async () => {
    const response = await fetch(`${base}/auth/demo-login`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ roles });
  });

  it.each([
    {},
    { Origin: WEB },
    { ...csrf, Origin: 'http://evil.example' },
    { ...csrf, 'Sec-Fetch-Site': 'cross-site' },
  ])('rejects CSRF before validation: %j', async (headers) => {
    const response = await post({}, headers);
    expect([response.status, await code(response)]).toEqual([403, 'CSRF_REJECTED']);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([
    { role: 'superuser' },
    {},
    { role: 'viewer', email: 'admin@demo.local' },
    { role: null },
    { role: 1 },
    { role: 'Viewer' },
    { role: ' viewer' },
    { role: ['viewer'] },
    JSON.parse('{"role":"viewer","__proto__":{"x":1}}'),
    { constructor: {} },
  ])('rejects invalid or extra fields: %j', async (body) => {
    const response = await post(body);
    expect([response.status, await code(response)]).toEqual([400, 'VALIDATION_ERROR']);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(roles)('creates a password-free %s session with safe response and cookie', async (role) => {
    const response = await post({ role });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toMatch(
      /^gis_access=[\w-]+\.[\w-]+\.[\w-]+; Max-Age=900; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    const body = (await response.json()) as any;
    expect(Object.keys(body).sort()).toEqual(['access_token', 'expires_at', 'expires_in', 'token_type', 'user']);
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token === cookieOf(response).split('=')[1]).toBe(true);
    expect(body).toEqual({
      access_token: expect.any(String),
      token_type: 'Bearer',
      user: { id: expect.any(String), email: `${role}@demo.local`, role },
      expires_in: 900,
      expires_at: expect.any(String),
    });
    expect(Date.parse(body.expires_at) - Date.now()).toBeGreaterThan(890_000);
    expect(Date.parse(body.expires_at) - Date.now()).toBeLessThanOrEqual(900_000);
    const restored = await me(cookieOf(response));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({ user: body.user, expires_at: body.expires_at });
  });

  it('revokes the previous session when switching roles', async () => {
    const old = cookieOf(await post({ role: 'viewer' }));
    const response = await post({ role: 'admin' }, { ...csrf, Cookie: old });
    expect(response.status).toBe(200);
    expect((await me(old)).status).toBe(401);
    expect((await me(cookieOf(response))).status).toBe(200);
  });

  it('returns generic 401 if the fixed user is missing', async () => {
    await pool.query("UPDATE users SET email = 'hidden@demo.local' WHERE email = 'editor@demo.local'");
    try {
      const response = await post({ role: 'editor' });
      expect([response.status, await code(response)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await pool.query("UPDATE users SET email = 'editor@demo.local' WHERE email = 'hidden@demo.local'");
    }
  });

  it('allows 11 successful demo logins for the same role in a row', async () => {
    const limited = await start('true', pool, false, 10);
    try {
      const url = await limited.getUrl();
      for (let attempt = 0; attempt < 11; attempt++) {
        expect((await post({ role: 'viewer' }, csrf, url)).status).toBe(200);
      }
    } finally {
      await limited.close();
    }
  });

  it.each([
    'invalid-token',
    signAccessToken(
      { sub: '00000000-0000-4000-8000-000000000001', sid: '00000000-0000-4000-8000-000000000002' },
      'test-only-secret-at-least-32-characters-long',
      Math.floor(Date.now() / 1000) - 1000,
    ),
  ])('allows demo login with an invalid or expired previous cookie (%#)', async (token) => {
    const response = await post({ role: 'viewer' }, { ...csrf, Cookie: `gis_access=${token}` });
    expect(response.status).toBe(200);
    expect((await me(cookieOf(response))).status).toBe(200);
  });

  it('keeps flag and CSRF checks ahead of cookie/database access; DB failures return 503', async () => {
    const cookie = cookieOf(await post({ role: 'viewer' }));
    const deadPool = createPool('postgresql://nobody:never@127.0.0.1:1/gis_api_test');
    const enabled = await start('true', deadPool);
    const disabled = await start('false', deadPool);
    try {
      const enabledUrl = await enabled.getUrl();
      const disabledUrl = await disabled.getUrl();
      expect((await fetch(`${disabledUrl}/auth/demo-login`, { headers: { Cookie: cookie } })).status).toBe(404);
      expect((await post({}, { Cookie: cookie }, disabledUrl)).status).toBe(404);
      expect((await fetch(`${enabledUrl}/auth/demo-login`, { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await post({}, { Cookie: cookie }, enabledUrl)).status).toBe(403);
      const response = await post({ role: 'viewer' }, { ...csrf, Cookie: cookie }, enabledUrl);
      expect([response.status, await code(response)]).toEqual([503, 'SERVICE_UNAVAILABLE']);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect((await me(cookie)).status).toBe(200);
    } finally {
      await enabled.close();
      await disabled.close();
      await deadPool.end();
    }
  });
});
