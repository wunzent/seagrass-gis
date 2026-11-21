import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { UpdateSurveyDto } from './update-survey.dto';

const pipe = createValidationPipe();
const update = (value: unknown) =>
  pipe.transform(value, { type: 'custom', metatype: UpdateSurveyDto }) as Promise<UpdateSurveyDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}

describe('PATCH /surveys/:id body DTO (UT-06-11)', () => {
  it('accepts any non-empty subset; omitted fields stay omitted; note may be cleared with null', async () => {
    expect((await update({ cover_percent: 80 })).toUpdateSurvey()).toEqual({ cover_percent: 80 });
    expect((await update({ note: null })).toUpdateSurvey()).toEqual({ note: null });
    expect(
      (await update({ lon: 99.3, lat: 7.3, species: ['HO'], surveyed_on: '2026-01-31' })).toUpdateSurvey(),
    ).toEqual({ lon: 99.3, lat: 7.3, species: ['HO'], surveyed_on: '2026-01-31' });
  });

  it('an empty body, null for required fields, invalid values and server-owned fields are 400', async () => {
    for (const body of [
      {},
      { lon: null },
      { lat: null },
      { surveyed_on: null },
      { cover_percent: null },
      { species: null },
      { species: [] },
      { species: ['EA', 'EA'] },
      { cover_percent: 101 },
      { surveyed_on: '2026-02-30' },
      { lon: '99' },
      { note: 'x'.repeat(2001) },
      { note: 'x', site_id: '00000000-0000-4000-8000-000000000001' },
      { note: 'x', survey_ref: 'S-1' },
      { note: 'x', created_by: 'x' },
      { note: 'x', id: 2 },
    ])
      expect([JSON.stringify(body), await outcome(async () => (await update(body)).toUpdateSurvey())]).toEqual([
        JSON.stringify(body),
        [400, 'VALIDATION_ERROR'],
      ]);
  });
});
