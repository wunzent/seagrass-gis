const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, signAccessToken, verifyAccessToken } = require('../../dist/auth/crypto');
const { parseCookies } = require('../../dist/auth/cookies');
const { checkCsrf } = require('../../dist/auth/guards/csrf.guard');
const { readAuthConfig } = require('../../dist/config/config');

const SECRET = 'unit-test-secret-that-is-at-least-32-bytes';
const status = fn => { try { fn(); } catch (e) { return [e.getStatus(), e.getResponse().error.code]; } return 'no error'; };

test('scrypt password hashes verify and never store the password', async () => {
  const hash = await hashPassword('correct horse');
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(hash, /correct horse/);
  assert.equal(await verifyPassword('correct horse', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('x', '!disabled-import-system-actor'), false);
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('access token is HS256 with fixed claims and a 900 second lifetime', () => {
  const now = 1_800_000_000;
  const token = signAccessToken({ sub: 'u1', sid: 's1' }, SECRET, now);
  const [header] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  const claims = verifyAccessToken(token, SECRET, now + 899);
  assert.deepEqual(claims, { sub: 'u1', sid: 's1', iat: now, exp: now + 900, iss: 'gis-api', aud: 'gis-web' });
  assert.equal(verifyAccessToken(token, SECRET, now + 900), null, 'expired at exp');
  assert.equal(verifyAccessToken(token, 'another-secret-another-secret-123456', now), null, 'wrong key');
  const [h, p] = token.split('.');
  assert.equal(verifyAccessToken(`${h}.${p}.`, SECRET, now), null, 'no signature');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verifyAccessToken(`${none}.${p}.`, SECRET, now), null, 'alg none');
  const forged = (payload, alg = 'HS256') => {
    const head = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
    return `${head}.${body}.${sig}`;
  };
  const good = { sub: 'u1', sid: 's1', iat: now, exp: now + 900, iss: 'gis-api', aud: 'gis-web' };
  assert.ok(verifyAccessToken(forged(good), SECRET, now));
  assert.equal(verifyAccessToken(forged(good, 'HS512'), SECRET, now), null, 'alg mismatch');
  assert.equal(verifyAccessToken(forged({ ...good, iss: 'x' }), SECRET, now), null, 'issuer');
  assert.equal(verifyAccessToken(forged({ ...good, aud: 'x' }), SECRET, now), null, 'audience');
  assert.equal(verifyAccessToken(forged({ ...good, exp: now + 3600 }), SECRET, now), null, 'lifetime over 900');
  assert.equal(verifyAccessToken(forged({ ...good, iat: now + 60, exp: now + 960 }), SECRET, now), null, 'issued in future');
  assert.equal(verifyAccessToken(forged({ ...good, sid: undefined }), SECRET, now), null, 'missing sid');
  assert.equal(verifyAccessToken('garbage', SECRET, now), null);
});

test('CSRF requires exact allowed Origin and the custom header', () => {
  const allowed = ['http://localhost:3000', 'http://localhost:3001'];
  const ok = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
  assert.equal(checkCsrf(ok, allowed), undefined);
  assert.equal(checkCsrf({ ...ok, origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin' }, allowed), undefined);
  for (const headers of [
    { 'x-csrf-protection': '1' },
    { ...ok, origin: 'null' },
    { ...ok, origin: 'http://localhost:3000/' },
    { ...ok, origin: 'http://127.0.0.1:3000' },
    { ...ok, origin: 'http://evil.example' },
    { origin: ok.origin },
    { ...ok, 'x-csrf-protection': 'true' },
    { ...ok, 'sec-fetch-site': 'cross-site' },
  ]) assert.deepEqual(status(() => checkCsrf(headers, allowed)), [403, 'CSRF_REJECTED'], JSON.stringify(headers));
});

test('cookie header parsing', () => {
  assert.deepEqual(parseCookies('a=1; gis_access=abc.def.ghi; b=x=y'), { a: '1', gis_access: 'abc.def.ghi', b: 'x=y' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('broken; =x'), {});
});

test('auth config: loopback HTTP allowed without Secure, other HTTP rejected', () => {
  const base = { JWT_SECRET: SECRET, PUBLIC_WEB_ORIGIN: 'http://localhost:3000', API_DOCS_ORIGIN: 'http://localhost:3001' };
  assert.deepEqual(readAuthConfig(base), { jwtSecret: SECRET, allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'], cookieSecure: false });
  assert.equal(readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'https://gis.example', API_DOCS_ORIGIN: 'https://api.gis.example' }).cookieSecure, true);
  assert.throws(() => readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'http://gis.example' }), /HTTPS/);
  assert.throws(() => readAuthConfig({ ...base, JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'http://localhost:3000/path' }), /origin/);
  assert.throws(() => readAuthConfig({ ...base, JWT_SECRET: undefined }), /JWT_SECRET/);
});

test('RBAC guard enforces roles declared on the controller class as well as the handler', () => {
  require('reflect-metadata');
  const { Reflector } = require('@nestjs/core');
  const { RolesGuard, Roles } = require('../../dist/auth/guards/roles.guard');
  class ClassLevel { write() {} }
  Roles('admin')(ClassLevel);
  const config = { allowedOrigins: ['http://localhost:3000'] };
  const guard = new RolesGuard(new Reflector(), config);
  const ctx = auth => ({ getHandler: () => ClassLevel.prototype.write, getClass: () => ClassLevel,
    switchToHttp: () => ({ getRequest: () => ({ auth, headers: { origin: 'http://localhost:3000', 'x-csrf-protection': '1' } }) }) });
  assert.deepEqual(status(() => guard.canActivate(ctx(null))), [401, 'UNAUTHORIZED']);
  assert.deepEqual(status(() => guard.canActivate(ctx({ user: { role: 'editor' } }))), [403, 'FORBIDDEN']);
  assert.equal(guard.canActivate(ctx({ user: { role: 'admin' } })), true);
});

test('signature must be the canonical base64url encoding', () => {
  const token = signAccessToken({ sub: 'u1', sid: 's1' }, SECRET, 1_800_000_000);
  assert.ok(verifyAccessToken(token, SECRET, 1_800_000_001));
  assert.equal(verifyAccessToken(`${token}!!`, SECRET, 1_800_000_001), null);
  assert.equal(verifyAccessToken(`${token}=`, SECRET, 1_800_000_001), null);
});

test('login limiter counts failures per client and email, and success resets it', () => {
  const { LoginRateLimiter } = require('../../dist/auth/login-rate-limiter');
  const limiter = new LoginRateLimiter(2, 60_000);
  const a = 'ip1|a@x', b = 'ip1|b@x';
  // Attempts are reserved synchronously, so concurrent requests cannot all pass before a failure is recorded.
  limiter.attempt(a); limiter.attempt(a);
  assert.deepEqual(status(() => limiter.attempt(a)), [429, 'AUTH_RATE_LIMITED']);
  limiter.attempt(b);
  limiter.succeed(a); limiter.attempt(a);
  for (let i = 0; i < 5; i++) { limiter.attempt(b); limiter.succeed(b); } // successful logins never accumulate
});
