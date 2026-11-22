import { Test } from '@nestjs/testing';
import { appModule } from '../src/app.module';
import { hashPassword, signAccessToken } from '../src/auth/utils/crypto';
import { readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { assertTestDatabase, migrate } from './helpers';

const config = readConfig(process.env);
// Fixtures truncate domain tables, so refuse anything that is not an explicit test database.
assertTestDatabase(config.databaseUrl, 'sites-write');

const SECRET = 'integration-secret-sites-write-0000000001';
const WEB = 'http://localhost:3000';
const auth = { jwtSecret: SECRET, allowedOrigins: [WEB, 'http://localhost:3001'], cookieSecure: false };
const USERS = {
  viewer: '00000000-0000-4000-8000-0000000000b1',
  editor: '00000000-0000-4000-8000-0000000000b2',
  admin: '00000000-0000-4000-8000-0000000000b3',
};
const CLEARED = 'gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax';
const csrf = { Origin: WEB, 'X-CSRF-Protection': '1' };
const square = (lon: number, lat: number, d: number) =>
  `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat}))',4326))`;
const ring = (lon: number, lat: number, d: number) => [
  [lon, lat],
  [lon + d, lat],
  [lon + d, lat + d],
  [lon, lat + d],
  [lon, lat],
];
const polygon = (lon: number, lat: number, d = 0.01) => ({ type: 'Polygon', coordinates: [ring(lon, lat, d)] });
const feature = (code: string, geometry: unknown = polygon(99.3, 7.3), name = `Site ${code}`) => ({
  type: 'Feature',
  geometry,
  properties: { code, name },
});

let pool: ReturnType<typeof createPool>;
let app: any;
let base: string;
const cookies: Record<keyof typeof USERS, string> = { viewer: '', editor: '', admin: '' };

async function startApp(database: any) {
  const moduleRef = await Test.createTestingModule({
    imports: [appModule(database, { auth, loginLimit: { max: 1000, windowMs: 60_000 } })],
  }).compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.listen(0, '127.0.0.1');
  return started;
}
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
async function login(email: string, password: string) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrf },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return cookieOf(response);
}
type Sent = { status: number; headers: Headers; text: string; body: any };
async function send(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; headers?: Record<string, string>; url?: string } = {},
): Promise<Sent> {
  const response = await fetch(`${options.url ?? base}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...csrf,
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...options.headers,
    },
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
}
const outcome = (r: Sent) => [r.status, r.body?.error?.code ?? null];
const siteRows = async () =>
  (
    await pool.query(
      `SELECT id, code, name, province_code, version, deleted_at, created_by, updated_by, updated_at, ST_AsText(geom) AS wkt
       FROM sites ORDER BY code, created_at`,
    )
  ).rows;
async function insertSite(code: string, polygonSql: string, province = '93') {
  const { rows } = await pool.query(
    `INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by)
     VALUES(gen_random_uuid(),$1,$2,$3,${polygonSql},ST_Area(${polygonSql}::geography)/1600,$4,$4) RETURNING id`,
    [code, `Seed ${code}`, province, USERS.admin],
  );
  return rows[0].id as string;
}
async function addSurvey(siteId: string, lon: number, lat: number) {
  await pool.query(
    `INSERT INTO surveys(site_id,geom,surveyed_on,cover_percent,created_by,updated_by)
     VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326),'2026-10-01',40,$4,$4)`,
    [siteId, lon, lat, USERS.admin],
  );
}

beforeAll(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  for (const [role, id] of Object.entries(USERS))
    await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, [
      id,
      `${role}@write.test`,
      await hashPassword(`${role}-pass`),
      role,
    ]);
  // 82 is inserted before 81 with the same geometry: a tie must still pick the lowest code.
  await pool.query(
    `INSERT INTO provinces(code,name_th,geom) VALUES('93','พัทลุง',${square(99, 7, 1)}),('80','นครศรีธรรมราช',${square(100, 7, 1)}),
     ('82','พังงา',${square(101, 7, 1)}),('81','กระบี่',${square(101, 7, 1)})`,
  );
  app = await startApp(pool);
  base = await app.getUrl();
  for (const role of Object.keys(USERS) as (keyof typeof USERS)[])
    cookies[role] = await login(`${role}@write.test`, `${role}-pass`);
});
afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('POST /sites (real PostGIS)', () => {
  it('IT-05-06: admin creates a MultiPolygon site with computed province, area and version 1', async () => {
    const created = await send('POST', '/sites', { cookie: cookies.admin, body: feature('NEW-001') });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const { body } = created;
    expect(body.type).toBe('Feature');
    expect(body.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring(99.3, 7.3, 0.01)]] });
    expect(Object.keys(body.properties).sort()).toEqual([
      'area_rai',
      'code',
      'id',
      'latestSurvey',
      'name',
      'province_code',
      'status',
      'version',
    ]);
    const [{ area }] = (
      await pool.query(`SELECT round((ST_Area(${square(99.3, 7.3, 0.01)}::geography)/1600)::numeric,2)::float8 AS area`)
    ).rows;
    expect(body.properties).toMatchObject({
      code: 'NEW-001',
      name: 'Site NEW-001',
      province_code: '93',
      area_rai: area,
      status: 'no_data',
      version: 1,
      latestSurvey: null,
    });
    const [row] = (await siteRows()).filter((r) => r.code === 'NEW-001');
    expect([row.id, row.created_by, row.updated_by, row.deleted_at]).toEqual([
      body.properties.id,
      USERS.admin,
      USERS.admin,
      null,
    ]);
    const read = await send('GET', '/sites/NEW-001');
    expect(read.body).toEqual(body);
  });

  it('BR-03: largest geography intersection wins; an exact tie picks the lowest province code', async () => {
    const largest = await send('POST', '/sites', {
      cookie: cookies.admin,
      body: feature('EDGE-001', {
        type: 'Polygon',
        coordinates: [
          [
            [99.99, 7.5],
            [100.002, 7.5],
            [100.002, 7.51],
            [99.99, 7.51],
            [99.99, 7.5],
          ],
        ],
      }),
    });
    expect([largest.status, largest.body.properties.province_code]).toEqual([201, '93']);
    const tie = await send('POST', '/sites', { cookie: cookies.admin, body: feature('TIE-001', polygon(101.5, 7.5)) });
    expect([tie.status, tie.body.properties.province_code]).toEqual([201, '81']);
    const multi = await send('POST', '/sites', {
      cookie: cookies.admin,
      body: feature('MULTI-001', {
        type: 'MultiPolygon',
        coordinates: [[ring(99.4, 7.4, 0.01)], [ring(100.4, 7.4, 0.02)]],
      }),
    });
    expect([multi.status, multi.body.properties.province_code, multi.body.geometry.coordinates.length]).toEqual([
      201,
      '80',
      2,
    ]);
  });

  it('IT-05-06-F: invalid input and domain failures return the documented code and write nothing', async () => {
    const before = await siteRows();
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [99.3, 7.3],
          [99.31, 7.31],
          [99.31, 7.3],
          [99.3, 7.31],
          [99.3, 7.3],
        ],
      ],
    };
    const flat = {
      type: 'Polygon',
      coordinates: [
        [
          [99.3, 7.3],
          [99.31, 7.3],
          [99.32, 7.3],
          [99.3, 7.3],
        ],
      ],
    };
    const cases: [unknown, [number, string]][] = [
      [feature('BAD-1', bowtie), [400, 'INVALID_GEOMETRY']],
      [feature('BAD-2', flat), [400, 'INVALID_GEOMETRY']],
      [
        feature('BAD-3', { type: 'Polygon', coordinates: [ring(99.3, 7.3, 0.01).slice(0, 4)] }),
        [400, 'INVALID_GEOMETRY'],
      ],
      [feature('BAD-4', polygon(200, 7.3)), [400, 'INVALID_GEOMETRY']],
      [feature('BAD-5', null), [400, 'INVALID_GEOMETRY']],
      [feature('OUT-1', polygon(50, 50)), [422, 'OUTSIDE_COVERAGE']],
      [feature('OUT-2', polygon(98.99, 7.5)), [422, 'OUTSIDE_COVERAGE']], // touches the province edge only: zero-area intersection
      [feature('NEW-001'), [409, 'DUPLICATE_CODE']],
      [{ ...feature('BAD-6'), id: 'x' }, [400, 'VALIDATION_ERROR']],
      [
        { ...feature('BAD-7'), properties: { code: 'BAD-7', name: 'x', province_code: '80' } },
        [400, 'VALIDATION_ERROR'],
      ],
      [feature('', polygon(99.3, 7.3)), [400, 'VALIDATION_ERROR']],
      [feature('x'.repeat(65)), [400, 'VALIDATION_ERROR']],
      [feature('BAD-8', polygon(99.3, 7.3), 'x'.repeat(256)), [400, 'VALIDATION_ERROR']],
      ['[]', [400, 'VALIDATION_ERROR']],
    ];
    for (const [body, expected] of cases) {
      const response = await send('POST', '/sites', { cookie: cookies.admin, body });
      expect([JSON.stringify(body).slice(0, 60), outcome(response)]).toEqual([
        JSON.stringify(body).slice(0, 60),
        expected,
      ]);
      expect(response.text).not.toMatch(/ST_|SELECT|INSERT|at .*\.ts/);
    }
    const form = await send('POST', '/sites', {
      cookie: cookies.admin,
      body: 'type=Feature',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(outcome(form)).toEqual([400, 'VALIDATION_ERROR']);
    expect(await siteRows()).toEqual(before);
  });

  it('concurrent creates with the same code: exactly one 201 and one 409 DUPLICATE_CODE', async () => {
    const results = await Promise.all(
      [polygon(99.6, 7.6), polygon(99.7, 7.7)].map((g) =>
        send('POST', '/sites', { cookie: cookies.admin, body: feature('RACE-001', g) }),
      ),
    );
    expect(results.map(outcome).sort()).toEqual([
      [201, null],
      [409, 'DUPLICATE_CODE'],
    ]);
    expect((await siteRows()).filter((r) => r.code === 'RACE-001')).toHaveLength(1);
  });
});

describe('PATCH /sites/:code (real PostGIS)', () => {
  it('IT-10-07: editor renames with the current version; version+1 and audit fields set', async () => {
    const id = await insertSite('PAT-001', square(99.2, 7.2, 0.01));
    const [before] = (await siteRows()).filter((r) => r.id === id);
    const response = await send('PATCH', '/sites/PAT-001', {
      cookie: cookies.editor,
      body: { version: 1, name: 'ชื่อใหม่' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body.properties).toMatchObject({
      id,
      code: 'PAT-001',
      name: 'ชื่อใหม่',
      version: 2,
      province_code: '93',
    });
    const [after] = (await siteRows()).filter((r) => r.id === id);
    expect([after.version, after.name, after.updated_by, after.created_by, after.wkt]).toEqual([
      2,
      'ชื่อใหม่',
      USERS.editor,
      USERS.admin,
      before.wkt,
    ]);
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect((await send('GET', '/sites/PAT-001')).body).toEqual(response.body);
  });

  it('admin changes geometry: province and area are recomputed', async () => {
    const id = await insertSite('PAT-002', square(99.2, 7.4, 0.01));
    // Last writer was the editor, so updated_by=admin below proves the PATCH set it.
    await pool.query('UPDATE sites SET updated_by = $2 WHERE id = $1', [id, USERS.editor]);
    const geometry = polygon(100.2, 7.4, 0.02);
    const response = await send('PATCH', '/sites/PAT-002', { cookie: cookies.admin, body: { version: 1, geometry } });
    expect(response.status).toBe(200);
    const [{ area }] = (
      await pool.query(
        `SELECT round((ST_Area(${square(100.2, 7.4, 0.02)}::geography)/1600)::numeric,2)::float8 AS area`,
      )
    ).rows;
    expect(response.body.properties).toMatchObject({
      province_code: '80',
      area_rai: area,
      version: 2,
      name: 'Seed PAT-002',
    });
    expect(response.body.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring(100.2, 7.4, 0.02)]] });
    const [patched] = (await siteRows()).filter((r) => r.id === id);
    expect([patched.updated_by, patched.created_by, patched.province_code]).toEqual([USERS.admin, USERS.admin, '80']);
    const both = await send('PATCH', '/sites/PAT-002', {
      cookie: cookies.admin,
      body: { version: 2, name: 'Both', geometry: polygon(99.2, 7.4) },
    });
    expect([
      both.status,
      both.body.properties.version,
      both.body.properties.name,
      both.body.properties.province_code,
    ]).toEqual([200, 3, 'Both', '93']);
  });

  it('IT-10-07-F: stale version is 409 with the current Feature; other failures change nothing', async () => {
    await insertSite('PAT-003', square(99.2, 7.6, 0.01));
    await insertSite('PAT-DEL', square(99.2, 7.7, 0.01));
    await pool.query(`UPDATE sites SET deleted_at = now() WHERE code = 'PAT-DEL'`);
    await send('PATCH', '/sites/PAT-003', { cookie: cookies.editor, body: { version: 1, name: 'v2' } });
    const current = (await send('GET', '/sites/PAT-003')).body;
    const before = await siteRows();
    const stale = await send('PATCH', '/sites/PAT-003', { cookie: cookies.editor, body: { version: 1, name: 'late' } });
    expect(outcome(stale)).toEqual([409, 'VERSION_CONFLICT']);
    expect(stale.body.error.details.current).toEqual(current);
    const cases: [string, unknown, string, [number, string]][] = [
      ['PAT-003', { version: 2, geometry: polygon(50, 50) }, 'admin', [422, 'OUTSIDE_COVERAGE']],
      ['PAT-003', { version: 2, geometry: null }, 'admin', [400, 'INVALID_GEOMETRY']],
      [
        'PAT-003',
        {
          version: 2,
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [99.2, 7.6],
                [99.21, 7.61],
                [99.21, 7.6],
                [99.2, 7.61],
                [99.2, 7.6],
              ],
            ],
          },
        },
        'admin',
        [400, 'INVALID_GEOMETRY'],
      ],
      ['PAT-003', { version: 2, name: 'x', code: 'NEW' }, 'admin', [400, 'VALIDATION_ERROR']],
      ['PAT-003', { version: 2, name: 'x', area_rai: 5 }, 'admin', [400, 'VALIDATION_ERROR']],
      ['PAT-003', { version: '2', name: 'x' }, 'editor', [400, 'VALIDATION_ERROR']],
      ['PAT-003', { version: 0, name: 'x' }, 'editor', [400, 'VALIDATION_ERROR']],
      ['PAT-003', { version: 2 }, 'editor', [400, 'VALIDATION_ERROR']],
      ['PAT-003', { version: 2, name: '' }, 'editor', [400, 'VALIDATION_ERROR']],
      ['NOPE', { version: 1, name: 'x' }, 'editor', [404, 'SITE_NOT_FOUND']],
      ['PAT-DEL', { version: 1, name: 'x' }, 'admin', [404, 'SITE_NOT_FOUND']],
      ['x'.repeat(65), { version: 1, name: 'x' }, 'admin', [400, 'VALIDATION_ERROR']],
    ];
    for (const [code, body, role, expected] of cases) {
      const response = await send('PATCH', `/sites/${encodeURIComponent(code)}`, {
        cookie: cookies[role as keyof typeof USERS],
        body,
      });
      expect([code.slice(0, 10), JSON.stringify(body).slice(0, 50), outcome(response)]).toEqual([
        code.slice(0, 10),
        JSON.stringify(body).slice(0, 50),
        expected,
      ]);
    }
    expect(await siteRows()).toEqual(before);
  });

  it('editor sending geometry (even null) is 403 FORBIDDEN before lookup', async () => {
    const before = await siteRows();
    for (const [code, body] of [
      ['PAT-003', { version: 2, geometry: polygon(99.2, 7.6) }],
      ['PAT-003', { version: 2, name: 'x', geometry: null }],
      ['NOPE', { version: 1, geometry: null }],
    ] as const) {
      const response = await send('PATCH', `/sites/${code}`, { cookie: cookies.editor, body });
      expect([code, JSON.stringify(body), outcome(response)]).toEqual([code, JSON.stringify(body), [403, 'FORBIDDEN']]);
    }
    expect(await siteRows()).toEqual(before);
  });

  it('two concurrent PATCHes with the same version: exactly one 200 and one 409', async () => {
    await insertSite('RACE-PATCH', square(99.2, 7.8, 0.01));
    const results = await Promise.all(
      ['first', 'second'].map((name) =>
        send('PATCH', '/sites/RACE-PATCH', { cookie: cookies.editor, body: { version: 1, name } }),
      ),
    );
    expect(results.map(outcome).sort()).toEqual([
      [200, null],
      [409, 'VERSION_CONFLICT'],
    ]);
    const winner = results.find((r) => r.status === 200)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.details.current).toEqual(winner.body);
    const [row] = (await siteRows()).filter((r) => r.code === 'RACE-PATCH');
    expect([row.version, row.name]).toEqual([2, winner.body.properties.name]);
  });
});

describe('DELETE /sites/:code (real PostGIS)', () => {
  it('IT-05-08: admin soft deletes; reads hide the site and its code can be reused', async () => {
    const id = await insertSite('DEL-001', square(99.1, 7.1, 0.01));
    await pool.query('UPDATE sites SET updated_by = $2 WHERE id = $1', [id, USERS.editor]);
    const [before] = (await siteRows()).filter((r) => r.id === id);
    const response = await send('DELETE', '/sites/DEL-001', { cookie: cookies.admin });
    expect([response.status, response.text]).toEqual([204, '']);
    const [row] = (await siteRows()).filter((r) => r.id === id);
    expect(row.deleted_at).toBeInstanceOf(Date);
    expect([row.updated_by, row.version]).toEqual([USERS.admin, before.version]);
    expect(row.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect(outcome(await send('GET', '/sites/DEL-001'))).toEqual([404, 'SITE_NOT_FOUND']);
    expect((await send('GET', '/sites?q=DEL-001')).body.total).toBe(0);
    expect(
      (await send('GET', '/sites.geojson?bbox=99,7,99.2,7.2')).body.features.map((f: any) => f.properties.code),
    ).not.toContain('DEL-001');
    expect(outcome(await send('DELETE', '/sites/DEL-001', { cookie: cookies.admin }))).toEqual([404, 'SITE_NOT_FOUND']);
    const reused = await send('POST', '/sites', {
      cookie: cookies.admin,
      body: feature('DEL-001', polygon(99.1, 7.1)),
    });
    expect(reused.status).toBe(201);
    expect(reused.body.properties.id).not.toBe(id);
  });

  it('IT-05-08-F: a site with surveys is 409 SITE_HAS_SURVEYS and stays active', async () => {
    const id = await insertSite('DEL-002', square(99.1, 7.3, 0.01));
    await addSurvey(id, 99.105, 7.305);
    const before = await siteRows();
    expect(outcome(await send('DELETE', '/sites/DEL-002', { cookie: cookies.admin }))).toEqual([
      409,
      'SITE_HAS_SURVEYS',
    ]);
    expect(outcome(await send('DELETE', '/sites/NOPE', { cookie: cookies.admin }))).toEqual([404, 'SITE_NOT_FOUND']);
    expect(outcome(await send('DELETE', `/sites/${'x'.repeat(65)}`, { cookie: cookies.admin }))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
    expect(await siteRows()).toEqual(before);
    expect((await send('GET', '/sites/DEL-002')).status).toBe(200);
  });
});

describe('site writes: authentication, role and CSRF order (IT-05-06/10-07/05-08-AUTH)', () => {
  it('401 for missing, forged, expired, revoked and malformed Bearer credentials, before validation or lookup', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signAccessToken(
      { sub: USERS.admin, sid: '00000000-0000-4000-8000-00000000beef' },
      SECRET,
      now - 1000,
    );
    const revoked = await login('admin@write.test', 'admin-pass');
    expect((await send('POST', '/auth/logout', { cookie: revoked })).status).toBe(204);
    const before = await siteRows();
    for (const [label, options] of [
      ['none', {}],
      ['forged', { cookie: 'gis_access=abc.def.ghi' }],
      ['expired', { cookie: `gis_access=${expired}` }],
      ['revoked', { cookie: revoked }],
      ['bearer', { headers: { Authorization: 'Bearer invalid' } }],
    ] as const) {
      for (const [method, path, body] of [
        ['POST', '/sites', feature('AUTH-001')],
        ['POST', '/sites', { junk: true }],
        ['PATCH', '/sites/NOPE', { version: 1, name: 'x' }],
        ['PATCH', '/sites/NEW-001', { version: 1, geometry: null }],
        ['DELETE', '/sites/NOPE', undefined],
        ['DELETE', '/sites/NEW-001', undefined],
      ] as const) {
        const response = await send(method, path, { ...options, body });
        expect([label, method, path, outcome(response)]).toEqual([label, method, path, [401, 'UNAUTHORIZED']]);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
    }
    expect(await siteRows()).toEqual(before);
  });

  it('403 FORBIDDEN for denied roles before lookup, and role is checked before CSRF', async () => {
    const before = await siteRows();
    for (const [role, method, path, body] of [
      ['viewer', 'POST', '/sites', feature('AUTH-002')],
      ['editor', 'POST', '/sites', feature('AUTH-002')],
      ['viewer', 'PATCH', '/sites/NEW-001', { version: 1, name: 'x' }],
      ['viewer', 'PATCH', '/sites/NOPE', { version: 1, name: 'x' }],
      ['viewer', 'DELETE', '/sites/NEW-001', undefined],
      ['editor', 'DELETE', '/sites/NEW-001', undefined],
      ['editor', 'DELETE', '/sites/NOPE', undefined],
    ] as const) {
      const response = await send(method, path, { cookie: cookies[role], body });
      expect([role, method, path, outcome(response)]).toEqual([role, method, path, [403, 'FORBIDDEN']]);
      const crossSite = await send(method, path, {
        cookie: cookies[role],
        body,
        headers: { Origin: 'http://evil.example' },
      });
      expect([role, method, path, outcome(crossSite)]).toEqual([role, method, path, [403, 'FORBIDDEN']]);
    }
    expect(await siteRows()).toEqual(before);
  });

  it('403 CSRF_REJECTED for allowed roles before validation; no write and the session survives', async () => {
    const before = await siteRows();
    for (const headers of [
      { Origin: 'http://evil.example' },
      { Origin: 'null' },
      { 'X-CSRF-Protection': '0' },
      { 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      for (const [role, method, path, body] of [
        ['admin', 'POST', '/sites', feature('CSRF-001')],
        ['admin', 'POST', '/sites', { junk: true }],
        ['editor', 'PATCH', '/sites/NEW-001', { version: 1, name: 'csrf' }],
        ['admin', 'PATCH', '/sites/NOPE', { version: 1, name: 'csrf' }],
        ['admin', 'DELETE', '/sites/NEW-001', undefined],
      ] as const) {
        const response = await send(method, path, { cookie: cookies[role], body, headers });
        expect([JSON.stringify(headers), method, path, outcome(response), response.headers.get('set-cookie')]).toEqual([
          JSON.stringify(headers),
          method,
          path,
          [403, 'CSRF_REJECTED'],
          null,
        ]);
      }
    }
    expect(await siteRows()).toEqual(before);
    expect((await send('GET', '/auth/me', { cookie: cookies.admin })).status).toBe(200);
  });
});

describe('public reads with an unusable cookie (deferred T009a item)', () => {
  it('invalid, expired or revoked cookie: anonymous 200, cookie cleared, no-store; valid cookie untouched', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signAccessToken(
      { sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000cafe' },
      SECRET,
      now - 1000,
    );
    const revoked = await login('viewer@write.test', 'viewer-pass');
    await send('POST', '/auth/logout', { cookie: revoked });
    for (const cookie of ['gis_access=not-a-jwt', `gis_access=${expired}`, revoked])
      for (const path of ['/sites', '/sites.geojson?bbox=98,6,102,9', '/sites/NEW-001']) {
        const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
        expect([
          cookie.slice(0, 20),
          path,
          response.status,
          response.headers.get('set-cookie'),
          response.headers.get('cache-control'),
        ]).toEqual([cookie.slice(0, 20), path, 200, CLEARED, 'no-store']);
      }
    const valid = await fetch(`${base}/sites/NEW-001`, { headers: { Cookie: cookies.viewer } });
    expect([valid.status, valid.headers.get('set-cookie')]).toEqual([200, null]);
    const missing = await fetch(`${base}/sites/MISSING`, { headers: { Cookie: 'gis_access=bad' } });
    expect([missing.status, missing.headers.get('set-cookie')]).toEqual([404, CLEARED]);
    const head = await fetch(`${base}/sites/NEW-001`, { method: 'HEAD', headers: { Cookie: 'gis_access=garbage' } });
    expect([head.status, head.headers.get('set-cookie'), head.headers.get('cache-control')]).toEqual([
      200,
      CLEARED,
      'no-store',
    ]);
  });
});

describe('site writes: dependency failures', () => {
  it('database unavailable during a write → 503; unexpected error → 500 without SQL; nothing written', async () => {
    const before = await siteRows();
    const unavailable = {
      query: (sql: string, params?: unknown[]) => pool.query(sql, params), // session lookups still work
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
      },
    };
    const broken = {
      query: (sql: string, params?: unknown[]) => pool.query(sql, params),
      connect: async () => ({
        query: async (sql: string) => {
          if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
          throw Object.assign(new Error('relation "sites" secret_column SELECT'), { code: '42P01' });
        },
        release: () => undefined,
      }),
    };
    for (const [database, expected] of [
      [unavailable, [503, 'SERVICE_UNAVAILABLE']],
      [broken, [500, 'INTERNAL_ERROR']],
    ] as const) {
      const isolated = await startApp(database);
      const url = await isolated.getUrl();
      try {
        for (const [role, method, path, body] of [
          ['admin', 'POST', '/sites', feature('DEP-001')],
          ['editor', 'PATCH', '/sites/NEW-001', { version: 1, name: 'dep' }],
          ['admin', 'DELETE', '/sites/NEW-001', undefined],
        ] as const) {
          const response = await send(method, path, { url, cookie: cookies[role], body });
          expect([method, outcome(response)]).toEqual([method, expected]);
          expect(response.text).not.toMatch(/secret_column|relation|ECONNREFUSED|5432|at /);
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
      } finally {
        await isolated.close();
      }
    }
    expect(await siteRows()).toEqual(before);
  });
});

describe('site writes: failure after a real write rolls back', () => {
  /** Real pool; on each transaction client the first statement after the matching write throws a non-dependency error. */
  const failingAfter = (write: RegExp) => ({
    query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    connect: async () => {
      const client = await pool.connect();
      let written = false;
      return {
        query: async (sql: string, params?: unknown[]) => {
          if (written && sql !== 'ROLLBACK' && sql !== 'COMMIT') throw new Error('injected failure after write');
          const result = await client.query(sql, params);
          if (write.test(sql)) written = true;
          return result;
        },
        release: (error?: Error) => client.release(error),
      };
    },
  });

  it('POST: a failure after the INSERT leaves no site row; PATCH: a failure after the UPDATE keeps the version', async () => {
    await insertSite('ROLL-001', square(99.2, 7.9, 0.01));
    const before = await siteRows();
    for (const [write, role, method, path, body] of [
      [/^\s*INSERT INTO sites/, 'admin', 'POST', '/sites', feature('ROLL-NEW', polygon(99.5, 7.9))],
      [/^\s*UPDATE sites SET name/, 'editor', 'PATCH', '/sites/ROLL-001', { version: 1, name: 'never' }],
    ] as const) {
      const isolated = await startApp(failingAfter(write));
      try {
        const response = await send(method, path, { url: await isolated.getUrl(), cookie: cookies[role], body });
        expect([method, outcome(response)]).toEqual([method, [500, 'INTERNAL_ERROR']]);
        expect(response.text).not.toMatch(/injected|INSERT|UPDATE/);
      } finally {
        await isolated.close();
      }
    }
    expect(await siteRows()).toEqual(before); // no ROLL-NEW row; ROLL-001 still version 1 and not renamed
  });
});

describe('Bearer writes (real PostGIS)', () => {
  it('admin writes without Origin/CSRF; cookie needs CSRF; viewer and bad bearer cannot write', async () => {
    const code = 'BEARER-TEST';
    await insertSite(code, square(99.3, 7.3, 0.01));
    const patch = (headers: Record<string, string>) =>
      fetch(`${base}/sites/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ version: 1, name: 'Bearer updated' }),
      });
    const cookie = await patch({ Cookie: cookies.admin });
    expect([cookie.status, ((await cookie.json()) as any).error.code]).toEqual([403, 'CSRF_REJECTED']);
    const viewer = await patch({ Authorization: `Bearer ${cookies.viewer.split('=')[1]}` });
    expect([viewer.status, ((await viewer.json()) as any).error.code]).toEqual([403, 'FORBIDDEN']);
    const bad = await patch({ Authorization: 'Bearer invalid', Cookie: cookies.admin });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('set-cookie')).toBeNull();
    const admin = await patch({ Authorization: `Bearer ${cookies.admin.split('=')[1]}` });
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as any).properties.version).toBe(2);
  });
});
