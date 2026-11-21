import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const ACCESS_TTL_SECONDS = 900;
const ISSUER = 'gis-api';
const AUDIENCE = 'gis-web';

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keylen: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** Format: scrypt$N$r$p$saltB64$hashB64. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p, SCRYPT.keylen);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** True when `stored` is a scrypt record this module can verify (disabled accounts use a non-scrypt marker). */
export const isVerifiableHash = (stored: string) =>
  /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(stored);

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  const expected = Buffer.from(parts[5], 'base64');
  if (expected.length !== SCRYPT.keylen) return false;
  const actual = await derive(password, Buffer.from(parts[4], 'base64'), N, r, p, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Burn equivalent work for unknown users so response time does not reveal account existence. */
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}

export interface AccessClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const sign = (input: string, secret: string) => createHmac('sha256', secret).update(input).digest();

export function signAccessToken(
  subject: { sub: string; sid: string },
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const claims: AccessClaims = {
    sub: subject.sub,
    sid: subject.sid,
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
    iss: ISSUER,
    aud: AUDIENCE,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${HEADER}.${body}.${sign(`${HEADER}.${body}`, secret).toString('base64url')}`;
}

/** Returns verified claims or null. The algorithm is fixed (header must be exactly HS256/JWT); nothing is trusted from it. */
export function verifyAccessToken(
  token: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): AccessClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return null;
  // Compare the encoded text so only the canonical base64url signature is accepted (Buffer decoding ignores stray characters).
  const given = Buffer.from(parts[2]);
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret).toString('base64url'));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let c: Partial<AccessClaims>;
  try {
    c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof c !== 'object' || c === null) return null;
  const valid =
    typeof c.sub === 'string' &&
    c.sub.length > 0 &&
    typeof c.sid === 'string' &&
    c.sid.length > 0 &&
    Number.isInteger(c.iat) &&
    Number.isInteger(c.exp) &&
    c.iss === ISSUER &&
    c.aud === AUDIENCE &&
    c.iat! <= now &&
    c.exp! > now &&
    c.exp! - c.iat! <= ACCESS_TTL_SECONDS;
  return valid ? { sub: c.sub!, sid: c.sid!, iat: c.iat!, exp: c.exp!, iss: c.iss!, aud: c.aud! } : null;
}
