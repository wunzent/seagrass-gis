import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { SitesGeoJsonQueryDto } from './sites-geojson.query.dto';

const pipe = createValidationPipe();
const geoQuery = (value: unknown) =>
  pipe.transform(value, { type: 'query', metatype: SitesGeoJsonQueryDto }) as Promise<SitesGeoJsonQueryDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}

describe('GET /sites.geojson query DTO', () => {
  it('requires a valid bbox and rejects paging params', async () => {
    expect((await geoQuery({ bbox: '99.1,7.2,99.5,7.6', status: 'good' })).toGeoJsonQuery()).toEqual({
      bbox: [99.1, 7.2, 99.5, 7.6],
      status: 'good',
    });
    expect((await geoQuery({ bbox: '-180,-90,180,90' })).toGeoJsonQuery().bbox).toEqual([-180, -90, 180, 90]);
    for (const bbox of [
      undefined,
      '',
      '1,2,3',
      '1,2,3,4,5',
      '99,7,98,8',
      '99,8,100,7',
      '99,7,99,8',
      '181,7,182,8',
      '99,-91,100,8',
      'a,b,c,d',
      '99,7,100,Infinity',
      '0x1,7,2,8',
      '99,7,100,8 ',
    ]) {
      expect([String(bbox), await outcome(() => geoQuery(bbox === undefined ? {} : { bbox }))]).toEqual([
        String(bbox),
        [400, 'INVALID_BBOX'],
      ]);
    }
    expect(await outcome(() => geoQuery({ bbox: '1,2,3,4', page: '1' }))).toEqual([400, 'VALIDATION_ERROR']);
  });
});
