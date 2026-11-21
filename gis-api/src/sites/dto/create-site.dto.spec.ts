import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { CreateSiteDto } from './create-site.dto';

const pipe = createValidationPipe();
const create = (value: unknown) =>
  pipe.transform(value, { type: 'custom', metatype: CreateSiteDto }) as Promise<CreateSiteDto>;

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
const polygon = { type: 'Polygon', coordinates: [ring] };
const feature = (patch: Record<string, unknown> = {}, properties: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: polygon,
  properties: { code: 'NEW-001', name: 'แหล่งใหม่', ...properties },
  ...patch,
});

describe('POST /sites body DTO (UT-05-06)', () => {
  it('accepts a Polygon or MultiPolygon Feature and normalizes to MultiPolygon', async () => {
    const dto = await create(feature());
    expect(dto.toCreateSite()).toEqual({
      code: 'NEW-001',
      name: 'แหล่งใหม่',
      geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
    });
    const multi = await create(feature({ geometry: { type: 'MultiPolygon', coordinates: [[ring]] } }));
    expect(multi.toCreateSite().geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring]] });
    const emoji = '\u{1F600}';
    const longest = await create(feature({}, { code: 'x'.repeat(64), name: emoji.repeat(127) + 'a' }));
    expect([longest.toCreateSite().code.length, longest.toCreateSite().name.length]).toEqual([64, 255]);
  });

  it('rejects unknown fields, wrong types and bad code/name with VALIDATION_ERROR', async () => {
    for (const body of [
      feature({ id: 'x' }),
      feature({ type: 'FeatureCollection' }),
      feature({}, { province_code: '93' }),
      feature({}, { area_rai: 1 }),
      feature({ properties: 'x' }),
      feature({ properties: [{ code: 'A', name: 'B' }] }),
      feature({ properties: null }),
      feature({}, { code: '' }),
      feature({}, { code: ' ' }),
      feature({}, { code: 'x'.repeat(65) }),
      feature({}, { code: 'A\u0000B' }),
      feature({}, { code: 'A\nB' }),
      feature({}, { code: 'A\ud800' }),
      feature({}, { code: ' A' }),
      feature({}, { code: 'A ' }),
      feature({}, { code: ' A' }),
      feature({}, { code: 'A ' }),
      feature({}, { code: 1 }),
      feature({}, { name: '' }),
      feature({}, { name: '   ' }),
      feature({}, { name: 'x'.repeat(256) }),
      feature({}, { name: 'a\u0000' }),
      feature({}, { name: null }),
      { type: 'Feature', geometry: polygon, properties: { code: 'A' } },
      JSON.parse('{"type":"Feature","properties":{"code":"A","name":"B"},"geometry":{},"__proto__":1}'),
    ]) {
      const label = JSON.stringify(body).slice(0, 90);
      expect([label, await outcome(() => create(body))]).toEqual([label, [400, 'VALIDATION_ERROR']]);
    }
  });

  it('rejects malformed GeoJSON geometry with INVALID_GEOMETRY and never repairs it', async () => {
    const open = ring.slice(0, 4);
    for (const geometry of [
      undefined,
      null,
      'POLYGON',
      { type: 'Point', coordinates: [99.3, 7.3] },
      { type: 'LineString', coordinates: ring },
      { type: 'Polygon', coordinates: [] },
      { type: 'Polygon', coordinates: [open] },
      { type: 'Polygon', coordinates: [[...open, [99.3, 7.3001]]] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lon + 100, lat])] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lon, lat + 90])] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lon, lat, 0])] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [String(lon), lat])] },
      { type: 'Polygon', coordinates: [ring.map(([lon, lat]) => [lon === 99.31 ? Infinity : lon, lat])] },
      { type: 'MultiPolygon', coordinates: [] },
      { type: 'MultiPolygon', coordinates: [ring] },
      { ...polygon, crs: { type: 'name', properties: { name: 'EPSG:3857' } } },
    ])
      expect([JSON.stringify(geometry), await outcome(() => create(feature({ geometry })))]).toEqual([
        JSON.stringify(geometry),
        [400, 'INVALID_GEOMETRY'],
      ]);
  });

  it('geometry members other than type, coordinates and crs are unknown fields (400 VALIDATION_ERROR)', async () => {
    const crs = { type: 'name', properties: { name: 'EPSG:4326' } };
    expect((await create(feature({ geometry: { ...polygon, crs } }))).toCreateSite().geometry.type).toBe(
      'MultiPolygon',
    );
    for (const [extra, unknown] of [
      [{ bbox: [99.3, 7.3, 99.31, 7.31] }, ['geometry.bbox']],
      [{ properties: {} }, ['geometry.properties']],
      [{ foo: 1, bar: 2 }, ['geometry.foo', 'geometry.bar']],
    ] as const) {
      const error: any = await create(feature({ geometry: { ...polygon, ...extra } })).catch((e) => e);
      expect([JSON.stringify(extra), error.getStatus?.(), error.getResponse?.().error]).toEqual([
        JSON.stringify(extra),
        400,
        expect.objectContaining({ code: 'VALIDATION_ERROR', details: { unknown } }),
      ]);
    }
  });
});
