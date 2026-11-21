import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { bangkokToday } from '../../shared/validators/geometry.validator';
import { CreateSurveyDto } from './create-survey.dto';

const pipe = createValidationPipe();
const create = (value: unknown) =>
  pipe.transform(value, { type: 'custom', metatype: CreateSurveyDto }) as Promise<CreateSurveyDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}

const tomorrow = () => {
  const date = new Date(`${bangkokToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
const valid = { lon: 99.35, lat: 7.38, surveyed_on: '2026-10-01', cover_percent: 45.5, species: ['EA', 'HO'] };

describe('POST /sites/:code/surveys body DTO (UT-06-10)', () => {
  it('accepts the assessment example; note is optional and defaults to null', async () => {
    expect((await create(valid)).toCreateSurvey()).toEqual({ ...valid, note: null });
    expect((await create({ ...valid, note: 'น้ำขุ่น' })).toCreateSurvey().note).toBe('น้ำขุ่น');
    expect((await create({ ...valid, note: null })).toCreateSurvey().note).toBeNull();
    expect((await create({ ...valid, note: 'x'.repeat(2000) })).toCreateSurvey().note).toHaveLength(2000);
    for (const edge of [
      { lon: -180, lat: -90, cover_percent: 0 },
      { lon: 180, lat: 90, cover_percent: 100 },
      { surveyed_on: bangkokToday() },
      { surveyed_on: '2024-02-29' },
      { species: ['EA'] },
    ])
      expect([JSON.stringify(edge), await outcome(() => create({ ...valid, ...edge }))]).toEqual([
        JSON.stringify(edge),
        'no error',
      ]);
  });

  it('rejects missing, mistyped, out-of-range, future and unreal dates without coercion', async () => {
    const { lon: _lon, ...noLon } = valid;
    const { species: _species, ...noSpecies } = valid;
    for (const body of [
      noLon,
      noSpecies,
      { ...valid, lon: '99.35' },
      { ...valid, lon: 180.0001 },
      { ...valid, lat: -90.5 },
      { ...valid, lat: null },
      { ...valid, cover_percent: -0.01 },
      { ...valid, cover_percent: 100.01 },
      { ...valid, cover_percent: '45' },
      { ...valid, surveyed_on: '2026-02-30' },
      { ...valid, surveyed_on: '2026-13-01' },
      { ...valid, surveyed_on: '2025-02-29' },
      { ...valid, surveyed_on: '0000-01-01' },
      { ...valid, surveyed_on: '2026-10-1' },
      { ...valid, surveyed_on: '2026-10-01T00:00:00Z' },
      { ...valid, surveyed_on: 20261001 },
      { ...valid, surveyed_on: tomorrow() },
      { ...valid, species: [] },
      { ...valid, species: 'EA' },
      { ...valid, species: ['EA', 'EA'] },
      { ...valid, species: ['EA', 1] },
      { ...valid, species: [''] },
      { ...valid, species: ['x'.repeat(17)] },
      { ...valid, species: ['E\u0000A'] },
      { ...valid, note: 'x'.repeat(2001) },
      { ...valid, note: 5 },
      { ...valid, note: 'a\u0000b' },
      { ...valid, note: 'x\ud800' },
    ])
      expect([JSON.stringify(body), await outcome(async () => (await create(body)).toCreateSurvey())]).toEqual([
        JSON.stringify(body),
        [400, 'VALIDATION_ERROR'],
      ]);
  });

  it('server-owned fields are forbidden', async () => {
    for (const extra of [
      { survey_ref: 'S-1' },
      { site_id: '00000000-0000-4000-8000-000000000001' },
      { created_by: 'x' },
      { id: 1 },
      { siteStatus: 'good' },
    ]) {
      let details: any;
      try {
        await create({ ...valid, ...extra });
      } catch (error: any) {
        details = [error.getStatus(), error.getResponse().error];
      }
      expect(details).toEqual([
        400,
        { code: 'VALIDATION_ERROR', message: expect.any(String), details: { unknown: Object.keys(extra) } },
      ]);
    }
  });
});
