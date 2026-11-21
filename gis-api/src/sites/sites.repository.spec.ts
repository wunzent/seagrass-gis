import { Database } from '../core/database/database.module';
import { Queryable } from '../core/database/transaction';
import { SitesRepository } from './sites.repository';

const failingTx = (error: object) =>
  ({
    query: async () => {
      throw Object.assign(new Error('boom'), error);
    },
  }) as unknown as Queryable;

async function thrown(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('SitesRepository.coverage', () => {
  const repo = new SitesRepository({} as Database);

  it('maps a GEOS topology failure (SQLSTATE XX000) to 400 INVALID_GEOMETRY instead of a 500', async () => {
    const error: any = await thrown(() =>
      repo.coverage(
        failingTx({ code: 'XX000', message: 'GEOSIntersects: TopologyException: side location conflict' }),
        '{}',
      ),
    );
    expect(error.getStatus?.()).toBe(400);
    expect(error.getResponse().error.code).toBe('INVALID_GEOMETRY');
    expect(JSON.stringify(error.getResponse())).not.toMatch(/GEOS|Topology/);
  });

  it('rethrows other database errors unchanged, including XX000 that is not a GEOS failure', async () => {
    const error: any = await thrown(() => repo.coverage(failingTx({ code: '57014' }), '{}'));
    expect(error.code).toBe('57014');
    const internal: any = await thrown(() =>
      repo.coverage(failingTx({ code: 'XX000', message: 'could not read block 0 in file "base/1/2"' }), '{}'),
    );
    expect([internal.code, internal.getStatus]).toEqual(['XX000', undefined]);
  });
});
