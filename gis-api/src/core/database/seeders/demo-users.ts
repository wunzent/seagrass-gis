import { randomUUID } from 'node:crypto';
import { Database as DatabaseQuery } from '../database.module';
import { withTransaction } from '../transaction';
import { UsersRepository } from '../../../auth/users.repository';
import { hashPassword, verifyPassword } from '../../../auth/utils/crypto';

const DEMO = [
  { email: 'viewer@demo.local', role: 'viewer', env: 'DEMO_VIEWER_PASSWORD' },
  { email: 'editor@demo.local', role: 'editor', env: 'DEMO_EDITOR_PASSWORD' },
  { email: 'admin@demo.local', role: 'admin', env: 'DEMO_ADMIN_PASSWORD' },
] as const;

/** Fails fast (before DB work) when a configured demo password is too short; names the variable only. */
export function assertDemoPasswords(env: NodeJS.ProcessEnv) {
  for (const demo of DEMO) {
    const password = env[demo.env];
    if (password && password.length < 8) throw new Error(`${demo.env} must be at least 8 characters`);
  }
}

/**
 * Local demo accounts (deployment-managed, no signup API). A password comes only from the environment;
 * an account whose variable is unset is left untouched. Existing hashes are replaced only when the password changed;
 * replacing a hash or role revokes that user's active sessions.
 */
export async function seedDemoUsers(db: DatabaseQuery, env: NodeJS.ProcessEnv) {
  const users = new UsersRepository(db);
  const seeded: string[] = [];
  for (const demo of DEMO) {
    const password = env[demo.env];
    if (!password) continue;
    if (password.length < 8) throw new Error(`${demo.env} must be at least 8 characters`);
    const existing = await users.findByEmail(demo.email);
    if (existing && existing.role === demo.role && (await verifyPassword(password, existing.password_hash))) continue;
    const passwordHash = await hashPassword(password);
    // One transaction: a rotated password or reset role must not commit while sessions issued under the old
    // credentials stay alive (a failed revoke would otherwise never be retried, because the next start sees a match).
    await withTransaction(db, async (tx) => {
      await users.upsert({ id: randomUUID(), email: demo.email, role: demo.role, passwordHash }, tx);
      if (existing)
        await tx.query(
          `UPDATE access_sessions SET revoked_at = now(), updated_at = now(), updated_by = user_id
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [existing.id],
        );
    });
    seeded.push(demo.email);
  }
  return seeded;
}
