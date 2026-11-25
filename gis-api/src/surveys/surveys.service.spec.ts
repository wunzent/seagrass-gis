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

describe('SurveysService PATCH response', () => {
  it.each(['very_good', 'good', 'fair', 'poor', 'no_data'] as const)(
    'returns the recomputed parent status %s after updating, in the same transaction',
    async (status) => {
      const tx = {};
      const events: string[] = [];
      const actor = { id: 'editor-id' } as SessionUser;
      const row = { ...valid, id: '7', created_by_id: 'creator-id', created_by_email: 'creator@example.test' };
      const updated = { ...row, cover_percent: 60 };
      const instance = new SurveysService(
        {
          transaction: (run: (transaction: unknown) => unknown) => run(tx),
          siteIdOf: async () => 'site-id',
          lockOnSite: async () => row,
          isWithinSite: async () => true,
          update: async (...args: unknown[]) => {
            expect(args).toEqual([tx, 7, { ...valid, cover_percent: 60 }, actor.id, false]);
            events.push('update');
          },
          byId: async () => updated,
        } as unknown as SurveysRepository,
        {
          shareLockActive: async () => ({ id: 'site-id' }),
          featureById: async (transaction: unknown, siteId: string) => {
            expect([transaction, siteId, events]).toEqual([tx, 'site-id', ['update']]);
            events.push('status');
            return { status };
          },
        } as unknown as SitesRepository,
      );

      expect(await instance.update(7, { cover_percent: 60 }, actor)).toEqual({
        ...valid,
        id: 7,
        cover_percent: 60,
        created_by: { id: 'creator-id', email: 'creator@example.test' },
        siteStatus: status,
      });
      expect(events).toEqual(['update', 'status']);
    },
  );
});
