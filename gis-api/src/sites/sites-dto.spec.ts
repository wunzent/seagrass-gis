import { createValidationPipe } from '../common/validation';
import { LoginDto } from '../auth/dto/login.dto';
import { ListSitesQueryDto } from './dto/list-sites.query.dto';
import { SiteCodeParamsDto } from './dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from './dto/sites-geojson.query.dto';

const pipe = createValidationPipe();
const listQuery = (value: unknown) => pipe.transform(value, { type: 'query', metatype: ListSitesQueryDto }) as Promise<ListSitesQueryDto>;
const geoQuery = (value: unknown) => pipe.transform(value, { type: 'query', metatype: SitesGeoJsonQueryDto }) as Promise<SitesGeoJsonQueryDto>;
const siteCode = (value: unknown) => pipe.transform(value, { type: 'param', metatype: SiteCodeParamsDto }) as Promise<SiteCodeParamsDto>;
const loginBody = (value: unknown) => pipe.transform(value, { type: 'body', metatype: LoginDto }) as Promise<LoginDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try { await run(); } catch (error: any) { return [error.getStatus(), error.getResponse().error.code]; }
  return 'no error';
}
async function thrown(run: () => Promise<unknown>): Promise<any> {
  try { await run(); } catch (error) { return error; }
  throw new Error('expected an error');
}

describe('GET /sites query DTO', () => {
  it('list query defaults and strict paging', async () => {
    expect((await listQuery({})).toListQuery()).toEqual({ page: 1, pageSize: 20 });
    expect((await listQuery({ page: '3', pageSize: '100', province: '93', status: 'no_data', q: 'Tr' })).toListQuery())
      .toEqual({ page: 3, pageSize: 100, province: '93', status: 'no_data', q: 'Tr' });
    for (const page of ['0', '-1', '1.5', '1e2', ' 2', '', '01x']) expect([page, await outcome(() => listQuery({ page }))]).toEqual([page, [400, 'VALIDATION_ERROR']]);
    for (const pageSize of ['0', '101', 'abc']) expect([pageSize, await outcome(() => listQuery({ pageSize }))]).toEqual([pageSize, [400, 'VALIDATION_ERROR']]);
  });

  it('list query rejects unknown, repeated and malformed filters', async () => {
    expect(await outcome(() => listQuery({ sort: 'name' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ q: ['a', 'b'] }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ status: 'great' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ province: '' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ province: 'ABC' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ q: 'x'.repeat(101) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect((await listQuery({ q: '' })).toListQuery()).toEqual({ page: 1, pageSize: 20 });
    for (const q of ['a\u0000b', 'x\ud800']) expect([JSON.stringify(q), await outcome(() => listQuery({ q }))]).toEqual([JSON.stringify(q), [400, 'VALIDATION_ERROR']]);
    expect((await listQuery({ q: 'tab\there' })).toListQuery().q).toBe('tab\there');
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}${'z'.repeat(200)}`, '1']));
    const error = await thrown(() => listQuery(many));
    const { unknown } = error.getResponse().error.details as { unknown: string[] };
    expect(unknown).toHaveLength(10);
    expect(unknown.every(k => k.length <= 64)).toBe(true);
  });
});

describe('GET /sites.geojson query DTO', () => {
  it('requires a valid bbox and rejects paging params', async () => {
    expect((await geoQuery({ bbox: '99.1,7.2,99.5,7.6', status: 'good' })).toGeoJsonQuery()).toEqual({ bbox: [99.1, 7.2, 99.5, 7.6], status: 'good' });
    expect((await geoQuery({ bbox: '-180,-90,180,90' })).toGeoJsonQuery().bbox).toEqual([-180, -90, 180, 90]);
    for (const bbox of [undefined, '', '1,2,3', '1,2,3,4,5', '99,7,98,8', '99,8,100,7', '99,7,99,8', '181,7,182,8',
      '99,-91,100,8', 'a,b,c,d', '99,7,100,Infinity', '0x1,7,2,8', '99,7,100,8 ']) {
      expect([String(bbox), await outcome(() => geoQuery(bbox === undefined ? {} : { bbox }))]).toEqual([String(bbox), [400, 'INVALID_BBOX']]);
    }
    expect(await outcome(() => geoQuery({ bbox: '1,2,3,4', page: '1' }))).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('site code path parameter DTO', () => {
  it('accepts 1-64 printable characters and rejects the rest', async () => {
    expect((await siteCode({ code: 'TRG-001' })).code).toBe('TRG-001');
    expect((await siteCode({ code: 'x'.repeat(64) })).code).toBe('x'.repeat(64));
    for (const bad of ['', 'x'.repeat(65), 'A\u0000B', ' ']) expect([JSON.stringify(bad), await outcome(() => siteCode({ code: bad }))]).toEqual([JSON.stringify(bad), [400, 'VALIDATION_ERROR']]);
  });
});

describe('login body DTO', () => {
  it('accepts a valid body and rejects unknown or mistyped properties', async () => {
    expect((await loginBody({ email: 'a@b.c', password: 'x' })).email).toBe('a@b.c');
    expect(await outcome(() => loginBody({ email: 'a@b.c' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: 'x', role: 'admin' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 1, password: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('prototype-polluting own keys and UTF-16 length limits', () => {
  const own = (key: string) => JSON.parse(`{"${key}":"x"}`);

  it('own __proto__ / constructor keys are unknown properties, with the same capping', async () => {
    for (const key of ['__proto__', 'constructor']) {
      const error = await thrown(() => listQuery(own(key)));
      expect([key, error.getResponse().error.code, error.getResponse().error.details]).toEqual([key, 'VALIDATION_ERROR', { unknown: [key] }]);
      expect(await outcome(() => geoQuery({ bbox: '1,2,3,4', ...own(key) }))).toEqual([400, 'VALIDATION_ERROR']);
      expect(await outcome(() => siteCode({ code: 'A', ...own(key) }))).toEqual([400, 'VALIDATION_ERROR']);
      expect(await outcome(() => loginBody(JSON.parse(`{"email":"a@b.c","password":"x","${key}":"x"}`)))).toEqual([400, 'VALIDATION_ERROR']);
    }
    const both = await thrown(() => listQuery(JSON.parse('{"__proto__":"x","constructor":"y","sort":"z"}')));
    expect((both.getResponse().error.details as { unknown: string[] }).unknown.sort()).toEqual(['__proto__', 'constructor', 'sort']);
    const many = JSON.parse(`{"__proto__":"x",${Array.from({ length: 20 }, (_, i) => `"k${i}":"1"`).join(',')}}`);
    expect((await thrown(() => listQuery(many))).getResponse().error.details.unknown).toHaveLength(10);
  });

  it('lengths count UTF-16 code units, like string.length', async () => {
    const emoji = '\u{1F600}'; // 2 code units, 1 code point
    expect(emoji.length).toBe(2);
    expect((await listQuery({ q: emoji.repeat(50) })).q).toHaveLength(100);
    expect(await outcome(() => listQuery({ q: emoji.repeat(51) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ q: 'a\u{FE0F}'.repeat(51) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect((await siteCode({ code: emoji.repeat(32) })).code).toHaveLength(64);
    expect(await outcome(() => siteCode({ code: emoji.repeat(33) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect((await loginBody({ email: 'a@b.c', password: emoji.repeat(128) })).password).toHaveLength(256);
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: emoji.repeat(129) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect((await loginBody({ email: `${emoji.repeat(126)}@b`, password: 'x' })).email).toHaveLength(254);
    expect(await outcome(() => loginBody({ email: `${emoji.repeat(127)}@b`, password: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 'ab', password: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: '' }))).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('U+2028 / U+2029 only codes are whitespace-only like trim()', async () => {
    for (const bad of ['\u2028', '\u2029\u2028']) expect(await outcome(() => siteCode({ code: bad }))).toEqual([400, 'VALIDATION_ERROR']);
    for (const ok of ['A\u2028B', '\u2028A', '\u2029 A']) expect((await siteCode({ code: ok })).code).toBe(ok);
  });
});
