import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { UpdateSiteDto } from './update-site.dto';

const pipe = createValidationPipe();
const update = (value: unknown) =>
  pipe.transform(value, { type: 'custom', metatype: UpdateSiteDto }) as Promise<UpdateSiteDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}

const ring = [
  [99.3, 7.3],
  [99.31, 7.3],
  [99.31, 7.31],
  [99.3, 7.31],
  [99.3, 7.3],
];

describe('PATCH /sites/:code body DTO (UT-10-07)', () => {
  it('accepts version with name and/or geometry', async () => {
    expect((await update({ version: 1, name: 'ใหม่' })).toUpdateSite()).toEqual({ version: 1, name: 'ใหม่' });
    const geometry = { type: 'Polygon', coordinates: [ring] };
    expect((await update({ version: 2147483647, geometry })).toUpdateSite()).toEqual({
      version: 2147483647,
      geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
    });
  });

  it('version must be a positive integer number; code, computed and unknown fields are forbidden', async () => {
    for (const body of [
      { name: 'x' },
      { version: 0, name: 'x' },
      { version: -1, name: 'x' },
      { version: 1.5, name: 'x' },
      { version: '1', name: 'x' },
      { version: null, name: 'x' },
      { version: true, name: 'x' },
      { version: 2147483648, name: 'x' },
      { version: 1 },
      { version: 1, name: '' },
      { version: 1, name: ' ' },
      { version: 1, name: null },
      { version: 1, name: 'x'.repeat(256) },
      { version: 1, name: 'x', code: 'NEW' },
      { version: 1, name: 'x', province_code: '93' },
      { version: 1, name: 'x', area_rai: 1 },
      { version: 1, name: 'x', status: 'good' },
      { version: 1, name: 'x', id: 'x' },
      { version: 1, geometry: { type: 'Polygon', coordinates: [ring], bbox: [99.3, 7.3, 99.31, 7.31] } },
    ])
      expect([JSON.stringify(body), await outcome(async () => (await update(body)).toUpdateSite())]).toEqual([
        JSON.stringify(body),
        [400, 'VALIDATION_ERROR'],
      ]);
  });

  it('geometry present but invalid, including null, is INVALID_GEOMETRY', async () => {
    for (const geometry of [null, {}, { type: 'Polygon', coordinates: [ring.slice(0, 3)] }])
      expect([JSON.stringify(geometry), await outcome(() => update({ version: 1, geometry }))]).toEqual([
        JSON.stringify(geometry),
        [400, 'INVALID_GEOMETRY'],
      ]);
  });
});
