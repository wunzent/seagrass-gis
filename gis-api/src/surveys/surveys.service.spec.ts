import { SessionUser } from '../auth/entities/user.entity';
import { SitesRepository } from '../sites/sites.repository';
import { SurveyFields } from './entities/survey.entity';
import { SurveysRepository } from './surveys.repository';
import { SurveysService } from './surveys.service';

const valid: SurveyFields = {
  lon: 100,
  lat: 13,
  surveyed_on: '2024-01-15',
  cover_percent: 40,
  species: ['EA'],
  note: null,
};

/** Service with stubbed repositories: the parent site exists and every species is known. */
const service = () =>
  new SurveysService(
    {
      transaction: (run: (tx: unknown) => unknown) => run({}),
      unknownSpecies: async () => [],
      isWithinSite: async () => true,
    } as unknown as SurveysRepository,
    { shareLockActive: async () => ({ id: '1' }) } as unknown as SitesRepository,
  );

/** details.fields of the VALIDATION_ERROR the BR-05 recheck throws. */
async function failingFields(input: SurveyFields) {
  try {
    await service().create('SITE-1', input, { id: '1' } as SessionUser);
  } catch (error: any) {
    expect([error.getStatus(), error.getResponse().error.code]).toEqual([400, 'VALIDATION_ERROR']);
    return error.getResponse().error.details.fields;
  }
  throw new Error('expected a validation error');
}

describe('SurveysService BR-05 recheck', () => {
  it('reports only the failing field(s)', async () => {
    expect(await failingFields({ ...valid, cover_percent: 101 })).toEqual(['cover_percent']);
    expect(await failingFields({ ...valid, surveyed_on: '2024-02-30' })).toEqual(['surveyed_on']);
    expect(await failingFields({ ...valid, surveyed_on: '2024-02-30', cover_percent: -1 })).toEqual([
      'surveyed_on',
      'cover_percent',
    ]);
  });
});
