export function readConfig(env: NodeJS.ProcessEnv) {
  const databaseUrl = env.DATABASE_URL;
  try {
    if (!databaseUrl || !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const rawPort = env.PORT ?? '3001';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return { databaseUrl: databaseUrl!, port: Number(rawPort) };
}

export interface AuthConfig {
  jwtSecret: string;
  allowedOrigins: string[];
  cookieSecure: boolean;
  demoLoginEnabled?: boolean;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function origin(name: string, value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${name} must be an origin such as http://localhost:3000`);
  }
  if (url.origin !== value) throw new Error(`${name} must be an origin without path, such as http://localhost:3000`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new Error(`${name} must use HTTPS unless it is a loopback host`);
  }
  return url;
}

/** Cookie Secure follows the origins: HTTP is only allowed for loopback local Docker (AUTH-SESSION Local boundary). */
export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(jwtSecret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  const web = origin('PUBLIC_WEB_ORIGIN', env.PUBLIC_WEB_ORIGIN);
  const docs = origin('API_DOCS_ORIGIN', env.API_DOCS_ORIGIN);
  return {
    jwtSecret,
    allowedOrigins: [web.origin, docs.origin],
    cookieSecure: web.protocol === 'https:',
    // Explicit opt-in only; the Docker image always runs NODE_ENV=production, so the flag is the single switch.
    demoLoginEnabled: env.DEMO_LOGIN_ENABLED === 'true',
  };
}
