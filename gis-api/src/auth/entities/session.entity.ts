import { Role } from './user.entity';

/** `access_sessions` row (migration 004). */
export interface AccessSessionRow {
  id: string; user_id: string; expires_at: Date; revoked_at: Date | null;
  created_at: Date; updated_at: Date; created_by: string; updated_by: string;
}

/** Row of SessionsRepository.findActive: the session joined with its current user. */
export type ActiveSessionRow = { id: string; email: string; role: Role; expires_at: AccessSessionRow['expires_at'] };
