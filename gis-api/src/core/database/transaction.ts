import type { PoolClient } from 'pg';
import { toDependencyError } from '../../shared/errors/api-error';
import { Database } from './database.module';

export type Queryable = Pick<PoolClient, 'query'>;

/**
 * Runs `work` in one READ COMMITTED transaction on a dedicated client. Any throw rolls back (domain ApiErrors pass through
 * unchanged); driver failures that mean the database cannot serve become 503 SERVICE_UNAVAILABLE.
 */
export async function withTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  if (!db.connect) throw new Error('database does not support transactions');
  let client: PoolClient;
  try {
    client = await db.connect();
  } catch (error) {
    throw toDependencyError(error);
  }
  // A client whose ROLLBACK failed is released with the error so the pool destroys it instead of reusing it.
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => (broken = rollbackError));
    throw toDependencyError(error);
  } finally {
    client.release(broken);
  }
}
