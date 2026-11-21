export interface Migration {
  version: string;
  sql: string;
}
export interface MigrationClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export async function loadMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => /^\d+-[a-z0-9-]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('No migrations found');
  return Promise.all(
    names.map(async (version) => ({ version, sql: await readFile(join(directory, version), 'utf8') })),
  );
}

export async function applyMigrations(client: MigrationClient, files: Migration[]): Promise<void> {
  await client.query('SELECT pg_advisory_lock(714031291)');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = (await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows;
    const sorted = [...files].sort((a, b) => a.version.localeCompare(b.version));
    const checksums = new Map(
      sorted.map((file) => [file.version, createHash('sha256').update(file.sql).digest('hex')]),
    );
    if (checksums.size !== files.length) throw new Error('Duplicate migration version');
    for (const row of applied) {
      if (checksums.get(String(row.version)) !== row.checksum) throw new Error('Migration checksum mismatch');
    }
    for (const file of sorted) {
      if (applied.some((row) => row.version === file.version)) continue;
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          file.version,
          checksums.get(file.version),
        ]);
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new Error('Migration failed; transaction rolled back');
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(714031291)');
  }
}
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
