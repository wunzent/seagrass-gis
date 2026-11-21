export interface DatabaseQuery {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}
export async function checkHealth(db: DatabaseQuery) {
  try {
    const { rows } = await db.query('SELECT 1 AS ready, postgis_lib_version() AS postgis');
    const version = String(rows[0]?.postgis ?? '').match(/^(3\.\d+)(?:\.|$)/);
    if (rows[0]?.ready !== 1 || !version) throw new Error('Dependency not ready');
    return { db: 'ok', postgis: version[1] };
  } catch {
    throw new ServiceUnavailableException({ error: {
      code: 'SERVICE_UNAVAILABLE', message: 'Database service is unavailable', details: {},
    } });
  }
}
import { ServiceUnavailableException } from '@nestjs/common';
