import { Inject, Injectable } from '@nestjs/common';
import { Role, SessionUser, UserRecord } from './entities/user.entity';
import { DATABASE, Database } from '../core/database/database.module';
import { Queryable } from '../core/database/transaction';
import { toDependencyError } from '../shared/errors/api-error';

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findSessionUserByEmail(email: string): Promise<SessionUser | null> {
    try {
      const { rows } = await this.db.query('SELECT id, email, role FROM users WHERE email = $1', [email]);
      return (rows[0] as unknown as SessionUser | undefined) ?? null;
    } catch (error) {
      throw toDependencyError(error);
    }
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    try {
      const { rows } = await this.db.query('SELECT id, email, role, password_hash FROM users WHERE email = $1', [
        email,
      ]);
      return (rows[0] as unknown as UserRecord | undefined) ?? null;
    } catch (error) {
      throw toDependencyError(error);
    }
  }

  /** Runs on `tx` when given, so callers can combine it with other writes in one transaction. */
  async upsert(user: { id: string; email: string; role: Role; passwordHash: string }, tx?: Queryable) {
    const sql = `INSERT INTO users(id, email, password_hash, role) VALUES($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`;
    const params = [user.id, user.email, user.passwordHash, user.role];
    await (tx ? tx.query(sql, params) : this.db.query(sql, params));
  }
}
