import 'reflect-metadata';
import * as crypto from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { parseCookies } from './cookies';
import { hashPassword, signAccessToken, verifyAccessToken, verifyPassword } from './crypto';
import { checkCsrf } from './guards/csrf.guard';
import { Roles, RolesGuard } from './guards/roles.guard';
import { LoginRateLimiter } from './login-rate-limiter';

const SECRET = 'unit-test-secret-that-is-at-least-32-bytes';
const status = (fn: () => unknown): [number, string] | 'no error' => {
  try { fn(); } catch (e: any) { return [e.getStatus(), e.getResponse().error.code]; }
  return 'no error';
};

describe('crypto', () => {
  it('scrypt password hashes verify and never store the password', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash).not.toMatch(/correct horse/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', '!disabled-import-system-actor')).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('access token is HS256 with fixed claims and a 900 second lifetime', () => {
    const now = 1_800_000_000;
    const token = signAccessToken({ sub: 'u1', sid: 's1' }, SECRET, now);
    const [header] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = verifyAccessToken(token, SECRET, now + 899);
    expect(claims).toEqual({ sub: 'u1', sid: 's1', iat: now, exp: now + 900, iss: 'gis-api', aud: 'gis-web' });
    expect(verifyAccessToken(token, SECRET, now + 900)).toBeNull(); // expired at exp
    expect(verifyAccessToken(token, 'another-secret-another-secret-123456', now)).toBeNull(); // wrong key
    const [h, p] = token.split('.');
    expect(verifyAccessToken(`${h}.${p}.`, SECRET, now)).toBeNull(); // no signature
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyAccessToken(`${none}.${p}.`, SECRET, now)).toBeNull(); // alg none
    const forged = (payload: object, alg = 'HS256') => {
      const head = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
      return `${head}.${body}.${sig}`;
    };
    const good = { sub: 'u1', sid: 's1', iat: now, exp: now + 900, iss: 'gis-api', aud: 'gis-web' };
    expect(verifyAccessToken(forged(good), SECRET, now)).toBeTruthy();
    expect(verifyAccessToken(forged(good, 'HS512'), SECRET, now)).toBeNull(); // alg mismatch
    expect(verifyAccessToken(forged({ ...good, iss: 'x' }), SECRET, now)).toBeNull(); // issuer
    expect(verifyAccessToken(forged({ ...good, aud: 'x' }), SECRET, now)).toBeNull(); // audience
    expect(verifyAccessToken(forged({ ...good, exp: now + 3600 }), SECRET, now)).toBeNull(); // lifetime over 900
    expect(verifyAccessToken(forged({ ...good, iat: now + 60, exp: now + 960 }), SECRET, now)).toBeNull(); // issued in future
    expect(verifyAccessToken(forged({ ...good, sid: undefined }), SECRET, now)).toBeNull(); // missing sid
    expect(verifyAccessToken('garbage', SECRET, now)).toBeNull();
  });

  it('signature must be the canonical base64url encoding', () => {
    const token = signAccessToken({ sub: 'u1', sid: 's1' }, SECRET, 1_800_000_000);
    expect(verifyAccessToken(token, SECRET, 1_800_000_001)).toBeTruthy();
    expect(verifyAccessToken(`${token}!!`, SECRET, 1_800_000_001)).toBeNull();
    expect(verifyAccessToken(`${token}=`, SECRET, 1_800_000_001)).toBeNull();
  });
});

describe('CSRF', () => {
  it('requires exact allowed Origin and the custom header', () => {
    const allowed = ['http://localhost:3000', 'http://localhost:3001'];
    const ok = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
    expect(checkCsrf(ok, allowed)).toBeUndefined();
    expect(checkCsrf({ ...ok, origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin' }, allowed)).toBeUndefined();
    for (const headers of [
      { 'x-csrf-protection': '1' },
      { ...ok, origin: 'null' },
      { ...ok, origin: 'http://localhost:3000/' },
      { ...ok, origin: 'http://127.0.0.1:3000' },
      { ...ok, origin: 'http://evil.example' },
      { origin: ok.origin },
      { ...ok, 'x-csrf-protection': 'true' },
      { ...ok, 'sec-fetch-site': 'cross-site' },
    ]) expect([JSON.stringify(headers), status(() => checkCsrf(headers, allowed))]).toEqual([JSON.stringify(headers), [403, 'CSRF_REJECTED']]);
  });
});

describe('cookies', () => {
  it('cookie header parsing', () => {
    expect(parseCookies('a=1; gis_access=abc.def.ghi; b=x=y')).toEqual({ a: '1', gis_access: 'abc.def.ghi', b: 'x=y' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('broken; =x')).toEqual({});
  });
});

describe('RolesGuard', () => {
  it('enforces roles declared on the controller class as well as the handler', () => {
    class ClassLevel { write() {} }
    Roles('admin')(ClassLevel);
    const config = { allowedOrigins: ['http://localhost:3000'] } as any;
    const guard = new RolesGuard(new Reflector(), config);
    const ctx = (auth: unknown) => ({
      getHandler: () => ClassLevel.prototype.write, getClass: () => ClassLevel,
      switchToHttp: () => ({ getRequest: () => ({ auth, headers: { origin: 'http://localhost:3000', 'x-csrf-protection': '1' } }) }),
    }) as any;
    expect(status(() => guard.canActivate(ctx(null)))).toEqual([401, 'UNAUTHORIZED']);
    expect(status(() => guard.canActivate(ctx({ user: { role: 'editor' } })))).toEqual([403, 'FORBIDDEN']);
    expect(guard.canActivate(ctx({ user: { role: 'admin' } }))).toBe(true);
  });
});

describe('LoginRateLimiter', () => {
  it('counts failures per client and email, and success resets it', () => {
    const limiter = new LoginRateLimiter(2, 60_000);
    const a = 'ip1|a@x', b = 'ip1|b@x';
    // Attempts are reserved synchronously, so concurrent requests cannot all pass before a failure is recorded.
    limiter.attempt(a); limiter.attempt(a);
    expect(status(() => limiter.attempt(a))).toEqual([429, 'AUTH_RATE_LIMITED']);
    limiter.attempt(b);
    limiter.succeed(a); limiter.attempt(a);
    for (let i = 0; i < 5; i++) { limiter.attempt(b); limiter.succeed(b); } // successful logins never accumulate
  });
});
