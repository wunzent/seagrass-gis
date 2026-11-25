import { Test } from '@nestjs/testing';
import { appModule } from '../src/app.module';
import { hashPassword, signAccessToken } from '../src/auth/utils/crypto';
import { readConfig } from '../src/core/config/config';
import { createPool } from '../src/core/database/connection';
import { bangkokToday } from '../src/shared/validators/geometry.validator';
import { SURVEY_POINTS_LIMIT } from '../src/surveys/surveys.repository';
import { assertTestDatabase, migrate } from './helpers';

const config = readConfig(process.env);
// Fixtures truncate domain tables, so refuse anything that is not an explicit test database.
assertTestDatabase(config.databaseUrl, 'surveys');

const SECRET = 'integration-secret-surveys-000000000001';
const WEB = 'http://localhost:3000';
const auth = { jwtSecret: SECRET, allowedOrigins: [WEB, 'http://localhost:3001'], cookieSecure: false };
const USERS = {
  viewer: '00000000-0000-4000-8000-0000000000c1',
  editor: '00000000-0000-4000-8000-0000000000c2',
  admin: '00000000-0000-4000-8000-0000000000c3',
};
const EMAIL = (role: keyof typeof USERS) => `${role}@surveys.test`;
const CLEARED = 'gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax';
const csrf = { Origin: WEB, 'X-CSRF-Protection': '1' };
const square = (lon: number, lat: number, d: number) =>
  `ST_Multi(ST_GeomFromText('POLYGON((${lon} ${lat},${lon + d} ${lat},${lon + d} ${lat + d},${lon} ${lat + d},${lon} ${lat}))',4326))`;

let pool: ReturnType<typeof createPool>;
let app: any;
let base: string;
const cookies: Record<keyof typeof USERS, string> = { viewer: '', editor: '', admin: '' };

async function startApp(database: any, pointsLimit?: number) {
  const builder = Test.createTestingModule({
    imports: [appModule(database, { auth, loginLimit: { max: 1000, windowMs: 60_000 } })],
  });
  if (pointsLimit !== undefined) builder.overrideProvider(SURVEY_POINTS_LIMIT).useValue(pointsLimit);
  const moduleRef = await builder.compile();
  const started = moduleRef.createNestApplication({ logger: false });
  await started.listen(0, '127.0.0.1');
  return started;
}
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
async function login(role: keyof typeof USERS) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrf },
    body: JSON.stringify({ email: EMAIL(role), password: `${role}-pass` }),
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
      ...(method === 'GET' ? {} : csrf),
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

async function insertSite(code: string, lon: number, lat: number, d = 0.01, province = '93') {
  const polygon = square(lon, lat, d);
  const { rows } = await pool.query(
    `INSERT INTO sites(id,code,name,province_code,geom,area_rai,created_by,updated_by)
     VALUES(gen_random_uuid(),$1,$2,$3,${polygon},ST_Area(${polygon}::geography)/1600,$4,$4) RETURNING id`,
    [code, `Seed ${code}`, province, USERS.admin],
  );
  return rows[0].id as string;
}
async function addSurvey(siteId: string, lon: number, lat: number, on = '2026-10-01', cover = 40, species = ['EA']) {
  const { rows } = await pool.query(
    `INSERT INTO surveys(site_id,geom,surveyed_on,cover_percent,note,created_by,updated_by)
     VALUES($1,ST_SetSRID(ST_MakePoint($2,$3),4326),$4,$5,'seed',$6,$6) RETURNING id::int AS id`,
    [siteId, lon, lat, on, cover, USERS.admin],
  );
  const id = rows[0].id as number;
  for (const code of species) await pool.query('INSERT INTO survey_species VALUES($1,$2)', [id, code]);
  return id;
}
/** Snapshot of every survey (and its species) for "nothing changed" assertions. */
const surveyRows = async () =>
  (
    await pool.query(
      `SELECT v.id::int, v.site_id, v.survey_ref, ST_AsText(v.geom) AS wkt, v.surveyed_on::text, v.cover_percent::text,
         v.note, v.created_by, v.updated_by, v.updated_at,
         (SELECT array_agg(species_code ORDER BY species_code) FROM survey_species s WHERE s.survey_id = v.id) AS species
       FROM surveys v ORDER BY v.id`,
    )
  ).rows;
const surveysOf = async (siteId: string) =>
  (await pool.query('SELECT count(*)::int AS n FROM surveys WHERE site_id = $1', [siteId])).rows[0].n as number;
const tomorrow = () => {
  const date = new Date(`${bangkokToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const body = (overrides: Record<string, unknown> = {}) => ({
  lon: 99.305,
  lat: 7.305,
  surveyed_on: '2026-10-01',
  cover_percent: 45.5,
  species: ['HO', 'EA'],
  ...overrides,
});
/** Waits until some backend of this database is blocked on a row/transaction lock. */
async function waitForLockWait() {
  for (let i = 0; i < 100; i++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no request blocked on the site lock');
}
const statusOf = async (code: string) => (await send('GET', `/sites/${code}`)).body.properties.status;

beforeAll(async () => {
  pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.query('TRUNCATE survey_species, surveys, sites, access_sessions, users, species, provinces CASCADE');
  for (const [role, id] of Object.entries(USERS) as [keyof typeof USERS, string][])
    await pool.query(`INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)`, [
      id,
      EMAIL(role),
      await hashPassword(`${role}-pass`),
      role,
    ]);
  await pool.query(
    `INSERT INTO provinces(code,name_th,geom) VALUES('93','พัทลุง',${square(99, 7, 1)}),('80','นครศรีธรรมราช',${square(100, 7, 1)})`,
  );
  // Inserted out of order: GET /species must sort by code.
  await pool.query(
    `INSERT INTO species(code,name_th,name_sci) VALUES('HO','หญ้าใบมะกรูด','Halophila ovalis'),
     ('EA','หญ้าคาทะเล','Enhalus acoroides'),('CR','หญ้าชะเงาใบมน','Cymodocea rotundata')`,
  );
  app = await startApp(pool);
  base = await app.getUrl();
  for (const role of Object.keys(USERS) as (keyof typeof USERS)[]) cookies[role] = await login(role);
});
afterAll(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
});

describe('lookups (real PostGIS)', () => {
  it('IT-06-14 / IT-11-13: GET /species lists every species sorted by code; GET /provinces.geojson returns province outlines', async () => {
    const species = await send('GET', '/species');
    expect([species.status, species.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(species.body).toEqual({
      items: [
        { code: 'CR', name_th: 'หญ้าชะเงาใบมน', name_sci: 'Cymodocea rotundata' },
        { code: 'EA', name_th: 'หญ้าคาทะเล', name_sci: 'Enhalus acoroides' },
        { code: 'HO', name_th: 'หญ้าใบมะกรูด', name_sci: 'Halophila ovalis' },
      ],
    });
    const provinces = await send('GET', '/provinces.geojson');
    expect([provinces.status, provinces.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(provinces.body.type).toBe('FeatureCollection');
    expect(provinces.body.features.map((f: any) => [f.type, f.geometry.type, f.properties])).toEqual([
      ['Feature', 'MultiPolygon', { code: '80', name_th: 'นครศรีธรรมราช' }],
      ['Feature', 'MultiPolygon', { code: '93', name_th: 'พัทลุง' }],
    ]);
    expect(provinces.body.features[1].geometry.coordinates[0][0][0]).toEqual([99, 7]);
    // Strict empty query DTO: unknown params are rejected like on every other endpoint.
    for (const path of ['/species?x=1', '/provinces.geojson?bbox=1,2,3,4', '/species?page=1&page=2']) {
      const rejected = await send('GET', path);
      expect([path, outcome(rejected), rejected.headers.get('cache-control')]).toEqual([
        path,
        [400, 'VALIDATION_ERROR'],
        'no-store',
      ]);
    }
  });
});

describe('POST /sites/:code/surveys (real PostGIS)', () => {
  it('IT-06-10: editor creates a survey inside the site; 201 Survey + siteStatus, audit and species stored', async () => {
    const siteId = await insertSite('SV-001', 99.3, 7.3);
    const created = await send('POST', '/sites/SV-001/surveys', { cookie: cookies.editor, body: body() });
    expect([created.status, created.headers.get('cache-control')]).toEqual([201, 'no-store']);
    expect(created.body).toEqual({
      id: expect.any(Number),
      lon: 99.305,
      lat: 7.305,
      surveyed_on: '2026-10-01',
      cover_percent: 45.5,
      species: ['EA', 'HO'],
      note: null,
      created_by: { id: USERS.editor, email: EMAIL('editor') },
      siteStatus: 'fair',
    });
    const [row] = (await surveyRows()).filter((r) => r.id === created.body.id);
    expect(row).toMatchObject({
      site_id: siteId,
      survey_ref: null,
      wkt: 'POINT(99.305 7.305)',
      surveyed_on: '2026-10-01',
      cover_percent: '45.5',
      note: null,
      created_by: USERS.editor,
      updated_by: USERS.editor,
      species: ['EA', 'HO'],
    });
    // Today in Asia/Bangkok is accepted; a note is stored as given.
    const today = await send('POST', '/sites/SV-001/surveys', {
      cookie: cookies.admin,
      body: body({ surveyed_on: bangkokToday(), cover_percent: 100, species: ['CR'], note: 'น้ำขุ่น' }),
    });
    expect([today.status, today.body.note, today.body.siteStatus, today.body.created_by.id]).toEqual([
      201,
      'น้ำขุ่น',
      'very_good',
      USERS.admin,
    ]);
  });

  it('BR-05 50 m: a point 33 m outside the polygon is accepted, 66 m is 422 OUTSIDE_SITE and nothing is written', async () => {
    await insertSite('SV-050', 99.3, 7.5);
    // Polygon east edge lon 99.31 at lat ~7.505; 1e-4 degrees of longitude is about 11 m there.
    expect(
      (
        await send('POST', '/sites/SV-050/surveys', {
          cookie: cookies.editor,
          body: body({ lon: 99.3103, lat: 7.505 }),
        })
      ).status,
    ).toBe(201);
    const before = await surveyRows();
    expect(
      outcome(
        await send('POST', '/sites/SV-050/surveys', {
          cookie: cookies.editor,
          body: body({ lon: 99.3106, lat: 7.505 }),
        }),
      ),
    ).toEqual([422, 'OUTSIDE_SITE']);
    expect(await surveyRows()).toEqual(before);
  });

  it('IT-06-10-F: missing/deleted site 404, unknown species and invalid bodies 400; no partial write', async () => {
    const deletedId = await insertSite('SV-DEL', 99.3, 7.7);
    await pool.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [deletedId]);
    const before = await surveyRows();
    for (const [path, payload, expected, headers] of [
      ['/sites/NOPE/surveys', body(), [404, 'SITE_NOT_FOUND']],
      ['/sites/SV-DEL/surveys', body({ lon: 99.305, lat: 7.705 }), [404, 'SITE_NOT_FOUND']],
      ['/sites/SV-001/surveys', body({ species: ['EA', 'ZZ'] }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ species: ['ea'] }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ species: ['EA', 'EA'] }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ species: [] }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ surveyed_on: tomorrow() }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ surveyed_on: '2026-02-30' }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ cover_percent: 100.5 }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ lon: '99.305' }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ note: 'x'.repeat(2001) }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ survey_ref: 'API-1' }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ site_id: deletedId }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', body({ created_by: USERS.viewer }), [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', '[1]', [400, 'VALIDATION_ERROR']],
      ['/sites/SV-001/surveys', JSON.stringify(body()), [400, 'VALIDATION_ERROR'], { 'Content-Type': 'text/plain' }],
      [`/sites/${'x'.repeat(65)}/surveys`, body(), [400, 'VALIDATION_ERROR']],
    ] as const) {
      const response = await send('POST', path, { cookie: cookies.editor, body: payload, headers });
      expect([path, JSON.stringify(payload).slice(0, 80), outcome(response)]).toEqual([
        path,
        JSON.stringify(payload).slice(0, 80),
        expected,
      ]);
      expect(response.text).not.toMatch(/ZZ|API-1|survey_species|SELECT/);
    }
    expect(await surveyRows()).toEqual(before);
  });
});

describe('GET /sites/:code/surveys (real PostGIS)', () => {
  it('IT-06-09: newest day first, then newest id; paging total; created_by only for authenticated callers', async () => {
    const siteId = await insertSite('HIS-001', 99.5, 7.3);
    const a = await addSurvey(siteId, 99.505, 7.305, '2026-09-01', 10);
    const b = await addSurvey(siteId, 99.505, 7.305, '2026-10-01', 20, ['HO', 'CR']);
    const c = await addSurvey(siteId, 99.505, 7.305, '2026-10-01', 30, []);
    const d = await addSurvey(siteId, 99.505, 7.305, '2026-08-01', 40);
    const anonymous = await send('GET', '/sites/HIS-001/surveys');
    expect([anonymous.status, anonymous.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(anonymous.body).toEqual({
      items: [
        { id: c, lon: 99.505, lat: 7.305, surveyed_on: '2026-10-01', cover_percent: 30, species: [], note: 'seed' },
        {
          id: b,
          lon: 99.505,
          lat: 7.305,
          surveyed_on: '2026-10-01',
          cover_percent: 20,
          species: ['CR', 'HO'],
          note: 'seed',
        },
        { id: a, lon: 99.505, lat: 7.305, surveyed_on: '2026-09-01', cover_percent: 10, species: ['EA'], note: 'seed' },
        { id: d, lon: 99.505, lat: 7.305, surveyed_on: '2026-08-01', cover_percent: 40, species: ['EA'], note: 'seed' },
      ],
      total: 4,
      page: 1,
    });
    expect(anonymous.text).not.toMatch(/created_by|@surveys\.test|updated_by/);
    for (const role of ['viewer', 'editor', 'admin'] as const) {
      const authed = await send('GET', '/sites/HIS-001/surveys?page=2&pageSize=3', { cookie: cookies[role] });
      expect([role, authed.status, authed.body]).toEqual([
        role,
        200,
        {
          items: [
            {
              id: d,
              lon: 99.505,
              lat: 7.305,
              surveyed_on: '2026-08-01',
              cover_percent: 40,
              species: ['EA'],
              note: 'seed',
              created_by: { id: USERS.admin, email: EMAIL('admin') },
            },
          ],
          total: 4,
          page: 2,
        },
      ]);
    }
    expect((await send('GET', '/sites/HIS-001/surveys?page=9')).body).toEqual({ items: [], total: 4, page: 9 });
  });

  it('IT-06-09-F: unknown or deleted site 404, invalid paging 400; an unusable cookie reads anonymously', async () => {
    const deletedId = await insertSite('HIS-DEL', 99.5, 7.5);
    await addSurvey(deletedId, 99.505, 7.505);
    await pool.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [deletedId]);
    for (const [path, expected] of [
      ['/sites/NOPE/surveys', [404, 'SITE_NOT_FOUND']],
      ['/sites/HIS-DEL/surveys', [404, 'SITE_NOT_FOUND']],
      ['/sites/HIS-001/surveys?page=0', [400, 'VALIDATION_ERROR']],
      ['/sites/HIS-001/surveys?pageSize=101', [400, 'VALIDATION_ERROR']],
      ['/sites/HIS-001/surveys?page=1.5', [400, 'VALIDATION_ERROR']],
      ['/sites/HIS-001/surveys?sort=id', [400, 'VALIDATION_ERROR']],
    ] as const)
      expect([path, outcome(await send('GET', path))]).toEqual([path, expected]);
    const expired = signAccessToken(
      { sub: USERS.viewer, sid: '00000000-0000-4000-8000-00000000cafe' },
      SECRET,
      Math.floor(Date.now() / 1000) - 1000,
    );
    for (const cookie of ['gis_access=not-a-jwt', `gis_access=${expired}`]) {
      const response = await send('GET', '/sites/HIS-001/surveys', { cookie });
      expect([response.status, response.headers.get('set-cookie'), /created_by/.test(response.text)]).toEqual([
        200,
        CLEARED,
        false,
      ]);
    }
  });
});

describe('GET /surveys.geojson (real PostGIS)', () => {
  it('IT-11-15: points in the bbox of active sites only, with the same filters as /sites.geojson', async () => {
    const p1 = await insertSite('PT-001', 99.6, 7.6);
    const p2 = await insertSite('PT-002', 100.6, 7.6, 0.01, '80');
    const gone = await insertSite('PT-DEL', 99.62, 7.6);
    const s1 = await addSurvey(p1, 99.605, 7.605, '2026-10-01', 80, ['HO', 'EA']);
    const s2 = await addSurvey(p2, 100.605, 7.605, '2026-10-02', 10);
    await addSurvey(gone, 99.625, 7.605);
    await pool.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [gone]);
    const ids = async (query: string, cookie?: string) => {
      const response = await send('GET', `/surveys.geojson?${query}`, { cookie });
      expect([query, response.status, response.headers.get('cache-control')]).toEqual([query, 200, 'no-store']);
      return response.body.features.map((f: any) => f.properties.id);
    };
    expect(await ids('bbox=99.59,7.59,100.7,7.7')).toEqual([s2, s1]);
    expect(await ids('bbox=99.59,7.59,99.7,7.7')).toEqual([s1]);
    expect(await ids('bbox=99.59,7.59,100.7,7.7&province=80')).toEqual([s2]);
    expect(await ids('bbox=99.59,7.59,100.7,7.7&status=very_good')).toEqual([s1]);
    expect(await ids('bbox=99.59,7.59,100.7,7.7&status=poor')).toEqual([s2]);
    expect(await ids('bbox=99.59,7.59,100.7,7.7&q=pt-00')).toEqual([s2, s1]);
    expect(await ids('bbox=99.59,7.59,100.7,7.7&q=pt-del')).toEqual([]);
    const anonymous = await send('GET', '/surveys.geojson?bbox=99.59,7.59,99.7,7.7');
    expect(anonymous.body).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [99.605, 7.605] },
          properties: {
            id: s1,
            lon: 99.605,
            lat: 7.605,
            surveyed_on: '2026-10-01',
            cover_percent: 80,
            species: ['EA', 'HO'],
            note: 'seed',
            site_code: 'PT-001',
          },
        },
      ],
    });
    const viewer = await send('GET', '/surveys.geojson?bbox=99.59,7.59,99.7,7.7', { cookie: cookies.viewer });
    expect(viewer.body.features[0].properties.created_by).toEqual({ id: USERS.admin, email: EMAIL('admin') });
    const invalid = await send('GET', '/surveys.geojson?bbox=99.59,7.59,99.7,7.7', { cookie: 'gis_access=bad' });
    expect([invalid.status, invalid.headers.get('set-cookie'), /created_by/.test(invalid.text)]).toEqual([
      200,
      CLEARED,
      false,
    ]);
  });

  it('IT-11-15-F: bbox rules and unknown params match /sites.geojson', async () => {
    for (const [query, expected] of [
      ['', [400, 'INVALID_BBOX']],
      ['bbox=1,2,3', [400, 'INVALID_BBOX']],
      ['bbox=3,2,1,4', [400, 'INVALID_BBOX']],
      ['bbox=1,2,3,4&bbox=1,2,3,4', [400, 'INVALID_BBOX']],
      ['bbox=-181,0,1,1', [400, 'INVALID_BBOX']],
      ['bbox=1,2,3,4&status=great', [400, 'VALIDATION_ERROR']],
      ['bbox=1,2,3,4&page=1', [400, 'VALIDATION_ERROR']],
    ] as const)
      expect([query, outcome(await send('GET', `/surveys.geojson?${query}`))]).toEqual([query, expected]);
  });

  it('result cap: production limit is 5000; with a small injected limit only the newest points are returned', async () => {
    expect(app.get(SURVEY_POINTS_LIMIT)).toBe(5000);
    const siteId = await insertSite('CAP-001', 98.5, 8.5);
    const ids: number[] = [];
    for (const [on, lon] of [
      ['2026-09-01', 98.501],
      ['2026-10-03', 98.502],
      ['2026-10-01', 98.503],
      ['2026-10-03', 98.504],
      ['2026-08-01', 98.505],
    ] as const)
      ids.push(await addSurvey(siteId, lon, 8.505, on));
    const bbox = '/surveys.geojson?bbox=98.49,8.49,98.52,8.52';
    expect((await send('GET', bbox)).body.features).toHaveLength(5);
    const capped = await startApp(pool, 3);
    try {
      const response = await send('GET', bbox, { url: await capped.getUrl() });
      // surveyed_on DESC, id DESC: the two 2026-10-03 points (newer id first), then 2026-10-01.
      expect([response.status, response.body.features.map((f: any) => f.properties.id)]).toEqual([
        200,
        [ids[3], ids[1], ids[2]],
      ]);
    } finally {
      await capped.close();
    }
  });
});

describe('PATCH /surveys/:id (real PostGIS)', () => {
  it('IT-06-11: partial update merges onto stored values; species replaced; updated_by set, created_by kept', async () => {
    const siteId = await insertSite('PA-001', 99.7, 7.3);
    const id = await addSurvey(siteId, 99.705, 7.305, '2026-10-01', 40, ['EA']);
    const [before] = (await surveyRows()).filter((r) => r.id === id);
    const note = await send('PATCH', `/surveys/${id}`, { cookie: cookies.editor, body: { note: null } });
    expect([note.status, note.headers.get('cache-control'), note.body]).toEqual([
      200,
      'no-store',
      {
        id,
        lon: 99.705,
        lat: 7.305,
        surveyed_on: '2026-10-01',
        cover_percent: 40,
        species: ['EA'],
        note: null,
        created_by: { id: USERS.admin, email: EMAIL('admin') },
        siteStatus: 'fair',
      },
    ]);
    const full = await send('PATCH', `/surveys/${id}`, {
      cookie: cookies.admin,
      body: { lon: 99.7103, cover_percent: 90, species: ['HO', 'CR'], surveyed_on: '2026-10-05', note: 'แก้ไข' },
    });
    expect([full.status, full.body]).toEqual([
      200,
      {
        id,
        lon: 99.7103,
        lat: 7.305,
        surveyed_on: '2026-10-05',
        cover_percent: 90,
        species: ['CR', 'HO'],
        note: 'แก้ไข',
        created_by: { id: USERS.admin, email: EMAIL('admin') },
        siteStatus: 'very_good',
      },
    ]);
    const [after] = (await surveyRows()).filter((r) => r.id === id);
    expect(after).toMatchObject({ created_by: USERS.admin, updated_by: USERS.admin, species: ['CR', 'HO'] });
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    expect(await statusOf('PA-001')).toBe('very_good');
  });

  it('IT-06-11-F: merged record must stay within 50 m; invalid bodies 400; unknown id or deleted parent 404', async () => {
    const siteId = await insertSite('PA-002', 99.7, 7.5);
    const id = await addSurvey(siteId, 99.705, 7.505);
    const orphanSite = await insertSite('PA-DEL', 99.7, 7.7);
    const orphan = await addSurvey(orphanSite, 99.705, 7.705);
    // Not reachable through the API (SITE_HAS_SURVEYS); simulates a parent that is no longer active.
    await pool.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [orphanSite]);
    const before = await surveyRows();
    for (const [path, payload, expected] of [
      [`/surveys/${id}`, { lon: 99.7106 }, [422, 'OUTSIDE_SITE']],
      [`/surveys/${id}`, { lat: 7.6 }, [422, 'OUTSIDE_SITE']],
      [`/surveys/${id}`, {}, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { lon: null }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { species: ['ZZ'] }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { species: [] }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { cover_percent: -1 }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { surveyed_on: tomorrow() }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { note: 'x', site_id: orphanSite }, [400, 'VALIDATION_ERROR']],
      [`/surveys/${id}`, { note: 'x', survey_ref: 'R' }, [400, 'VALIDATION_ERROR']],
      ['/surveys/0', { note: 'x' }, [400, 'VALIDATION_ERROR']],
      ['/surveys/abc', { note: 'x' }, [400, 'VALIDATION_ERROR']],
      ['/surveys/9007199254740992', { note: 'x' }, [400, 'VALIDATION_ERROR']],
      ['/surveys/999999999', { note: 'x' }, [404, 'SURVEY_NOT_FOUND']],
      [`/surveys/${orphan}`, { note: 'x' }, [404, 'SURVEY_NOT_FOUND']],
    ] as const)
      expect([
        path,
        JSON.stringify(payload),
        outcome(await send('PATCH', path, { cookie: cookies.editor, body: payload })),
      ]).toEqual([path, JSON.stringify(payload), expected]);
    expect(await surveyRows()).toEqual(before);
  });
});

describe('DELETE /surveys/:id (real PostGIS)', () => {
  it('IT-07-12: hard delete with species; 204 without body; repeated delete 404; deleted parent 404', async () => {
    const siteId = await insertSite('DS-001', 99.9, 7.3);
    const id = await addSurvey(siteId, 99.905, 7.305, '2026-10-01', 40, ['EA', 'HO']);
    const removed = await send('DELETE', `/surveys/${id}`, { cookie: cookies.editor });
    expect([removed.status, removed.text, removed.headers.get('cache-control')]).toEqual([204, '', 'no-store']);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM survey_species WHERE survey_id = $1', [id])).rows[0].n,
    ).toBe(0);
    expect(await surveysOf(siteId)).toBe(0);
    expect(outcome(await send('DELETE', `/surveys/${id}`, { cookie: cookies.admin }))).toEqual([
      404,
      'SURVEY_NOT_FOUND',
    ]);
    expect(outcome(await send('DELETE', '/surveys/-1', { cookie: cookies.admin }))).toEqual([400, 'VALIDATION_ERROR']);
    const orphanSite = await insertSite('DS-DEL', 99.9, 7.5);
    const orphan = await addSurvey(orphanSite, 99.905, 7.505);
    await pool.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [orphanSite]);
    expect(outcome(await send('DELETE', `/surveys/${orphan}`, { cookie: cookies.admin }))).toEqual([
      404,
      'SURVEY_NOT_FOUND',
    ]);
    expect(await surveysOf(orphanSite)).toBe(1);
    // With its survey gone the site can now be soft deleted.
    expect((await send('DELETE', '/sites/DS-001', { cookie: cookies.admin })).status).toBe(204);
  });
});

describe('BR-04 site status reflects survey CRUD immediately', () => {
  it('latest-day average thresholds across POST, PATCH and DELETE on detail, list and map', async () => {
    await insertSite('ST-001', 99.4, 7.9);
    const at = { lon: 99.405, lat: 7.905 };
    const everywhere = async () => {
      const detail = (await send('GET', '/sites/ST-001')).body.properties;
      const list = (await send('GET', '/sites?q=ST-001')).body.items[0].status;
      const map = (await send('GET', '/sites.geojson?bbox=99.3,7.8,99.5,8&q=ST-001')).body.features[0].properties
        .status;
      expect([list, map]).toEqual([detail.status, detail.status]);
      return [detail.status, detail.latestSurvey];
    };
    expect(await everywhere()).toEqual(['no_data', null]);
    const post = async (surveyed_on: string, cover_percent: number) =>
      (
        await send('POST', '/sites/ST-001/surveys', {
          cookie: cookies.editor,
          body: body({ ...at, surveyed_on, cover_percent }),
        })
      ).body;
    const older = await post('2026-09-01', 100);
    expect(older.siteStatus).toBe('very_good');
    const a = await post('2026-10-01', 80);
    expect(a.siteStatus).toBe('very_good'); // latest day only: 80
    const b = await post('2026-10-01', 69.98);
    expect(b.siteStatus).toBe('good'); // (80 + 69.98) / 2 = 74.99, unrounded before comparing
    expect(await everywhere()).toEqual(['good', { surveyed_on: '2026-10-01', average_cover_percent: 74.99, count: 2 }]);
    const patch = async (id: number, change: Record<string, unknown>, siteStatus: string) => {
      const response = await send('PATCH', `/surveys/${id}`, { cookie: cookies.editor, body: change });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id, ...change, siteStatus });
      expect(response.headers.get('cache-control')).toBe('no-store');
    };
    await patch(b.id, { cover_percent: 70 }, 'very_good');
    expect(await everywhere()).toEqual([
      'very_good',
      { surveyed_on: '2026-10-01', average_cover_percent: 75, count: 2 },
    ]);
    await patch(a.id, { cover_percent: 30 }, 'good');
    expect((await everywhere())[0]).toBe('good'); // 50
    await patch(a.id, { cover_percent: 29.98 }, 'fair');
    expect((await everywhere())[0]).toBe('fair'); // 49.99
    await patch(b.id, { cover_percent: 20 }, 'poor');
    expect((await everywhere())[0]).toBe('poor'); // (29.98 + 20) / 2 = 24.99
    await patch(b.id, { cover_percent: 20.02 }, 'fair');
    expect((await everywhere())[0]).toBe('fair'); // 25
    // Moving one survey to a newer day makes it the only one on the latest day.
    await patch(b.id, { surveyed_on: '2026-10-02' }, 'poor');
    expect(await everywhere()).toEqual(['poor', { surveyed_on: '2026-10-02', average_cover_percent: 20.02, count: 1 }]);
    // Deleting the latest day falls back to the remaining latest day, then to no_data.
    for (const id of [b.id, a.id])
      expect((await send('DELETE', `/surveys/${id}`, { cookie: cookies.editor })).status).toBe(204);
    expect(await everywhere()).toEqual([
      'very_good',
      { surveyed_on: '2026-09-01', average_cover_percent: 100, count: 1 },
    ]);
    await send('DELETE', `/surveys/${older.id}`, { cookie: cookies.editor });
    expect(await everywhere()).toEqual(['no_data', null]);
  });
});

describe('survey writes: authentication, role and CSRF order (IT-06-10/06-11/07-12-AUTH)', () => {
  let target = 0;
  beforeAll(async () => {
    const siteId = await insertSite('AU-001', 99.2, 7.2);
    target = await addSurvey(siteId, 99.205, 7.205);
  });
  const writes = () =>
    [
      ['POST', '/sites/AU-001/surveys', body({ lon: 99.205, lat: 7.205 })],
      ['POST', '/sites/NOPE/surveys', { junk: true }],
      ['PATCH', `/surveys/${target}`, { note: 'x' }],
      ['PATCH', '/surveys/999999999', { junk: true }],
      ['DELETE', `/surveys/${target}`, undefined],
      ['DELETE', '/surveys/999999999', undefined],
    ] as const;

  it('401 for missing, forged, expired, revoked and malformed Bearer credentials, before validation or lookup', async () => {
    const expired = signAccessToken(
      { sub: USERS.editor, sid: '00000000-0000-4000-8000-00000000beef' },
      SECRET,
      Math.floor(Date.now() / 1000) - 1000,
    );
    const revoked = await login('editor');
    expect((await send('POST', '/auth/logout', { cookie: revoked })).status).toBe(204);
    const before = await surveyRows();
    for (const [label, options] of [
      ['none', {}],
      ['forged', { cookie: 'gis_access=abc.def.ghi' }],
      ['expired', { cookie: `gis_access=${expired}` }],
      ['revoked', { cookie: revoked }],
      ['bearer', { headers: { Authorization: 'Bearer invalid' } }],
    ] as const)
      for (const [method, path, payload] of writes()) {
        const response = await send(method, path, { ...options, body: payload });
        expect([label, method, path, outcome(response), response.headers.get('cache-control')]).toEqual([
          label,
          method,
          path,
          [401, 'UNAUTHORIZED'],
          'no-store',
        ]);
      }
    expect(await surveyRows()).toEqual(before);
  });

  it('403 FORBIDDEN for viewer before lookup (also cross-site); 403 CSRF_REJECTED for editor/admin; no write', async () => {
    const before = await surveyRows();
    for (const [method, path, payload] of writes()) {
      for (const headers of [{}, { Origin: 'http://evil.example' }])
        expect([
          method,
          path,
          outcome(await send(method, path, { cookie: cookies.viewer, body: payload, headers })),
        ]).toEqual([method, path, [403, 'FORBIDDEN']]);
      for (const role of ['editor', 'admin'] as const)
        for (const headers of [
          { Origin: 'http://evil.example' },
          { Origin: 'null' },
          { 'X-CSRF-Protection': '0' },
          { 'Sec-Fetch-Site': 'cross-site' },
        ]) {
          const response = await send(method, path, { cookie: cookies[role], body: payload, headers });
          expect([
            role,
            method,
            path,
            JSON.stringify(headers),
            outcome(response),
            response.headers.get('set-cookie'),
          ]).toEqual([role, method, path, JSON.stringify(headers), [403, 'CSRF_REJECTED'], null]);
        }
    }
    expect(await surveyRows()).toEqual(before);
    expect((await send('GET', '/auth/me', { cookie: cookies.editor })).status).toBe(200);
  });
});

describe('concurrency: survey writes vs site delete/update never leave a survey on a deleted site or outside 50 m', () => {
  it('site delete holding the lock first: a waiting POST survey ends 404 and writes nothing', async () => {
    const siteId = await insertSite('RC-001', 99.1, 7.1);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM sites WHERE id = $1 FOR UPDATE', [siteId]); // what DELETE /sites/:code takes
      const post = send('POST', '/sites/RC-001/surveys', {
        cookie: cookies.editor,
        body: body({ lon: 99.105, lat: 7.105 }),
      });
      await waitForLockWait();
      await blocker.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [siteId]);
      await blocker.query('COMMIT');
      expect(outcome(await post)).toEqual([404, 'SITE_NOT_FOUND']);
    } finally {
      blocker.release();
    }
    expect(await surveysOf(siteId)).toBe(0);
  });

  it('site geometry update holding the lock first: a waiting POST survey checks 50 m on the new geometry (422)', async () => {
    const siteId = await insertSite('RC-GEO', 99.1, 6.5);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM sites WHERE id = $1 FOR UPDATE', [siteId]); // what PATCH /sites/:code takes
      const post = send('POST', '/sites/RC-GEO/surveys', {
        cookie: cookies.editor,
        body: body({ lon: 99.105, lat: 6.505 }),
      });
      await waitForLockWait();
      await blocker.query(`UPDATE sites SET geom = ${square(99.3, 6.5, 0.01)}, version = version + 1 WHERE id = $1`, [
        siteId,
      ]);
      await blocker.query('COMMIT');
      expect(outcome(await post)).toEqual([422, 'OUTSIDE_SITE']);
    } finally {
      blocker.release();
    }
    expect(await surveysOf(siteId)).toBe(0);
  });

  it('site-delete side: while a survey write holds FOR SHARE, DELETE /sites/:code waits, re-reads and is 409', async () => {
    const siteId = await insertSite('RC-002', 99.1, 7.3);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM sites WHERE id = $1 FOR SHARE', [siteId]); // what survey writes take
      const remove = send('DELETE', '/sites/RC-002', { cookie: cookies.admin });
      await waitForLockWait();
      await blocker.query(
        `INSERT INTO surveys(site_id,geom,surveyed_on,cover_percent,created_by,updated_by)
         VALUES($1,ST_SetSRID(ST_MakePoint(99.105,7.305),4326),'2026-10-01',10,$2,$2)`,
        [siteId, USERS.editor],
      );
      await blocker.query('COMMIT');
      expect(outcome(await remove)).toEqual([409, 'SITE_HAS_SURVEYS']);
    } finally {
      blocker.release();
    }
    expect((await pool.query('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at).toBeNull();
  });

  it('site delete holding the lock first: a waiting PATCH or DELETE survey ends 404 and changes nothing', async () => {
    for (const [code, lat, method, payload] of [
      ['RC-003', 7.5, 'PATCH', { note: 'late' }],
      ['RC-004', 7.7, 'DELETE', undefined],
    ] as const) {
      const siteId = await insertSite(code, 99.1, lat);
      const id = await addSurvey(siteId, 99.105, lat + 0.005);
      const before = await surveyRows();
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('SELECT id FROM sites WHERE id = $1 FOR UPDATE', [siteId]);
        const write = send(method, `/surveys/${id}`, { cookie: cookies.editor, body: payload });
        await waitForLockWait();
        await blocker.query('UPDATE sites SET deleted_at = now() WHERE id = $1', [siteId]);
        await blocker.query('COMMIT');
        expect([method, outcome(await write)]).toEqual([method, [404, 'SURVEY_NOT_FOUND']]);
      } finally {
        blocker.release();
      }
      expect(await surveyRows()).toEqual(before);
    }
  });

  it('real API races: POST survey vs DELETE site, PATCH/DELETE survey vs DELETE site', async () => {
    for (let round = 0; round < 8; round++) {
      const lat = 6.1 + round * 0.02;
      await insertSite(`RR-P${round}`, 98.1, lat);
      const [created, removed] = await Promise.all([
        send('POST', `/sites/RR-P${round}/surveys`, {
          cookie: cookies.editor,
          body: body({ lon: 98.105, lat: lat + 0.005 }),
        }),
        send('DELETE', `/sites/RR-P${round}`, { cookie: cookies.admin }),
      ]);
      expect([
        [201, null, 409, 'SITE_HAS_SURVEYS'],
        [404, 'SITE_NOT_FOUND', 204, null],
      ]).toContainEqual([...outcome(created), ...outcome(removed)]);
      const siteId = await insertSite(`RR-U${round}`, 98.3, lat);
      const id = await addSurvey(siteId, 98.305, lat + 0.005);
      const [patched, blocked] = await Promise.all([
        send('PATCH', `/surveys/${id}`, { cookie: cookies.editor, body: { cover_percent: 55 } }),
        send('DELETE', `/sites/RR-U${round}`, { cookie: cookies.admin }),
      ]);
      expect([...outcome(patched), ...outcome(blocked)]).toEqual([200, null, 409, 'SITE_HAS_SURVEYS']);
      const [surveyGone, site] = await Promise.all([
        send('DELETE', `/surveys/${id}`, { cookie: cookies.editor }),
        send('DELETE', `/sites/RR-U${round}`, { cookie: cookies.admin }),
      ]);
      expect([
        [204, null, 204, null],
        [204, null, 409, 'SITE_HAS_SURVEYS'],
      ]).toContainEqual([...outcome(surveyGone), ...outcome(site)]);
    }
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM surveys v JOIN sites s ON s.id = v.site_id
       WHERE s.deleted_at IS NOT NULL AND s.code LIKE 'RR-%'`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('survey endpoints: dependency failures and rollback', () => {
  it('database unavailable → 503; unexpected error → 500 without SQL; nothing written', async () => {
    const siteId = await insertSite('DP-001', 99.1, 7.9);
    const id = await addSurvey(siteId, 99.105, 7.905);
    const before = await surveyRows();
    const failing = (error: Error) => ({
      // Session lookups (cookie callers) still work; every domain query and transaction fails.
      query: (sql: string, params?: unknown[]) =>
        /access_sessions|FROM users/.test(sql) ? pool.query(sql, params) : Promise.reject(error),
      connect: async () => {
        throw error;
      },
    });
    const unavailable = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const broken = Object.assign(new Error('relation "surveys" secret_column SELECT'), { code: '42P01' });
    for (const [database, expected] of [
      [failing(unavailable), [503, 'SERVICE_UNAVAILABLE']],
      [failing(broken), [500, 'INTERNAL_ERROR']],
    ] as const) {
      const isolated = await startApp(database);
      const url = await isolated.getUrl();
      try {
        for (const [method, path, payload, cookie] of [
          ['GET', '/sites/DP-001/surveys', undefined, undefined],
          ['GET', '/surveys.geojson?bbox=99,7,100,8', undefined, undefined],
          ['GET', '/species', undefined, undefined],
          ['GET', '/provinces.geojson', undefined, undefined],
          ['POST', '/sites/DP-001/surveys', body({ lon: 99.105, lat: 7.905 }), cookies.editor],
          ['PATCH', `/surveys/${id}`, { note: 'dep' }, cookies.editor],
          ['DELETE', `/surveys/${id}`, undefined, cookies.editor],
        ] as const) {
          const response = await send(method, path, { url, cookie, body: payload });
          expect([method, path, outcome(response)]).toEqual([method, path, expected]);
          expect(response.text).not.toMatch(/secret_column|relation|ECONNREFUSED|5432|at /);
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
      } finally {
        await isolated.close();
      }
    }
    expect(await surveyRows()).toEqual(before);
  });

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

  it('POST: failure after INSERT surveys leaves no row; PATCH: failure after UPDATE keeps values and species', async () => {
    const siteId = await insertSite('RB-001', 99.1, 8.1);
    const id = await addSurvey(siteId, 99.105, 8.105, '2026-10-01', 40, ['EA']);
    const before = await surveyRows();
    for (const [write, method, path, payload] of [
      [/^\s*INSERT INTO surveys/, 'POST', '/sites/RB-001/surveys', body({ lon: 99.105, lat: 8.105 })],
      [/^\s*UPDATE surveys SET/, 'PATCH', `/surveys/${id}`, { cover_percent: 99, species: ['HO'] }],
    ] as const) {
      const isolated = await startApp(failingAfter(write));
      try {
        const response = await send(method, path, {
          url: await isolated.getUrl(),
          cookie: cookies.editor,
          body: payload,
        });
        expect([method, outcome(response)]).toEqual([method, [500, 'INTERNAL_ERROR']]);
        expect(response.text).not.toMatch(/injected|INSERT|UPDATE/);
      } finally {
        await isolated.close();
      }
    }
    expect(await surveyRows()).toEqual(before);
  });
});
