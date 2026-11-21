import { Database } from '../core/database/database.module';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';

const checkHealth = (db: Database) => new HealthService(new HealthRepository(db)).check();

describe('HealthService', () => {
  it('executes DB query and serializes actual major.minor', async () => {
    let queried = false;
    const result = await checkHealth({ query: async (sql: string) => {
      expect(sql).toMatch(/SELECT 1/); expect(sql).toMatch(/postgis_lib_version/);
      queried = true; return { rows: [{ ready: 1, postgis: '3.5.4' }] };
    } });
    expect(queried).toBe(true);
    expect(result).toEqual({ db: 'ok', postgis: '3.5' });
  });

  it('dependency error is safe 503', async () => {
    const error: any = await checkHealth({ query: async () => { throw new Error('password=secret'); } }).then(() => null, (e: unknown) => e);
    expect(error).not.toBeNull();
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse()).includes('secret')).toBe(false);
  });
});
