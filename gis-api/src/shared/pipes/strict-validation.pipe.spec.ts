import { LoginDto } from '../../auth/dto/login.dto';
import { ListSitesQueryDto } from '../../sites/dto/list-sites.query.dto';
import { SiteCodeParamsDto } from '../../sites/dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from '../../sites/dto/sites-geojson.query.dto';
import { createValidationPipe } from './strict-validation.pipe';

const pipe = createValidationPipe();
const listQuery = (value: unknown) =>
  pipe.transform(value, { type: 'query', metatype: ListSitesQueryDto }) as Promise<ListSitesQueryDto>;
const geoQuery = (value: unknown) =>
  pipe.transform(value, { type: 'query', metatype: SitesGeoJsonQueryDto }) as Promise<SitesGeoJsonQueryDto>;
const siteCode = (value: unknown) =>
  pipe.transform(value, { type: 'param', metatype: SiteCodeParamsDto }) as Promise<SiteCodeParamsDto>;
const loginBody = (value: unknown) => pipe.transform(value, { type: 'body', metatype: LoginDto }) as Promise<LoginDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}
async function thrown(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('prototype-polluting own keys and UTF-16 length limits', () => {
  const own = (key: string) => JSON.parse(`{"${key}":"x"}`);

  it('own __proto__ / constructor keys are unknown properties, with the same capping', async () => {
    for (const key of ['__proto__', 'constructor']) {
      const error = await thrown(() => listQuery(own(key)));
      expect([key, error.getResponse().error.code, error.getResponse().error.details]).toEqual([
        key,
        'VALIDATION_ERROR',
        { unknown: [key] },
      ]);
      expect(await outcome(() => geoQuery({ bbox: '1,2,3,4', ...own(key) }))).toEqual([400, 'VALIDATION_ERROR']);
      expect(await outcome(() => siteCode({ code: 'A', ...own(key) }))).toEqual([400, 'VALIDATION_ERROR']);
      expect(await outcome(() => loginBody(JSON.parse(`{"email":"a@b.c","password":"x","${key}":"x"}`)))).toEqual([
        400,
        'VALIDATION_ERROR',
      ]);
    }
    const both = await thrown(() => listQuery(JSON.parse('{"__proto__":"x","constructor":"y","sort":"z"}')));
    expect((both.getResponse().error.details as { unknown: string[] }).unknown.sort()).toEqual([
      '__proto__',
      'constructor',
      'sort',
    ]);
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
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: emoji.repeat(129) }))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
    expect((await loginBody({ email: `${emoji.repeat(126)}@b`, password: 'x' })).email).toHaveLength(254);
    expect(await outcome(() => loginBody({ email: `${emoji.repeat(127)}@b`, password: 'x' }))).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
    expect(await outcome(() => loginBody({ email: 'ab', password: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: '' }))).toEqual([400, 'VALIDATION_ERROR']);
  });
});
