export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.DATABASE_URL;
  try {
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error();
  } catch { throw new Error('DATABASE_URL must be a PostgreSQL connection URL'); }
  const rawPort = env.PORT ?? '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return { databaseUrl: databaseUrl!, port: Number(rawPort) };
}
