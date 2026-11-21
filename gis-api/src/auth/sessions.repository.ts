import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuthenticatedContext, Role } from './user.model';
import { DATABASE, Database } from '../database/database.module';
import { toDependencyError } from '../common/errors';


const REVOKE = `UPDATE access_sessions SET revoked_at = now(), updated_at = now(), updated_by = user_id
  WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`;

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Active = owned by `userId`, not revoked, not expired by the server clock. */
  async findActive(sid: string, userId: string): Promise<AuthenticatedContext | null> {
    try {
      const { rows } = await this.db.query(
        `SELECT u.id, u.email, u.role, s.expires_at FROM access_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`, [sid, userId]);
      const row = rows[0] as { id: string; email: string; role: Role; expires_at: Date } | undefined;
      return row ? { user: { id: row.id, email: row.email, role: row.role }, sid, expiresAt: row.expires_at } : null;
    } catch (error) { throw toDependencyError(error); }
  }

  /** Revokes the previous session (when given) and creates the new one in one transaction. */
  async replace(previous: { sid: string; userId: string } | null, next: { sid: string; userId: string; expiresAt: Date }) {
    if (!this.db.connect) throw new Error('database does not support transactions');
    let client: PoolClient;
    try { client = await this.db.connect(); } catch (error) { throw toDependencyError(error); }
    try {
      await client.query('BEGIN');
      if (previous) await client.query(REVOKE, [previous.sid, previous.userId]);
      await client.query(`INSERT INTO access_sessions(id, user_id, expires_at, created_by, updated_by) VALUES($1, $2, $3, $2, $2)`,
        [next.sid, next.userId, next.expiresAt]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw toDependencyError(error);
    } finally { client.release(); }
  }

  async revoke(sid: string, userId: string) {
    try { await this.db.query(REVOKE, [sid, userId]); } catch (error) { throw toDependencyError(error); }
  }
}
