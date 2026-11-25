import { resolve } from 'node:path';
import { parseReferenceFeature, readReferenceFeatures, REFERENCE_SOURCE_SRID } from './reference-import';

it('reads the checked-in SHP and DBF without a PRJ, preserving UTM coordinates and record numbers', async () => {
  const rows = readReferenceFeatures(resolve('../seed-data/seagrass_large_utm.zip'));
  try {
    const first = (await rows.next()).value!;
    expect(REFERENCE_SOURCE_SRID).toBe(32647);
    expect(first).toMatchObject({ row: 1, ref_id: 1, density: 'dense' });
    const x = first.geometry!.coordinates.flat(Infinity).at(0);
    expect(x).toBeGreaterThan(300000);
    expect(x).toBeLessThan(600000);
    expect((await rows.next()).value).toMatchObject({ row: 2, ref_id: 2 });
  } finally {
    await rows.return(undefined);
  }
});

it('keeps rejected rows identifiable by their original row number and REF_ID', () => {
  expect(parseReferenceFeature({ properties: { REF_ID: 12, DENSITY: ' sparse ' }, geometry: null }, 7)).toEqual({
    row: 7,
    ref_id: 12,
    density: 'sparse',
    geometry: null,
  });
  expect(parseReferenceFeature({ properties: { REF_ID: 1.5, DENSITY: '' }, geometry: null }, 8)).toMatchObject({
    row: 8,
    ref_id: null,
    density: null,
  });
  const openRing = {
    type: 'Polygon',
    coordinates: [
      [
        [400000, 900000],
        [400010, 900000],
        [400010, 900010],
        [400000, 900010],
      ],
    ],
  };
  expect(parseReferenceFeature({ properties: { REF_ID: 13, DENSITY: 'medium' }, geometry: openRing }, 9)).toMatchObject(
    {
      row: 9,
      geometry: null,
    },
  );
});
