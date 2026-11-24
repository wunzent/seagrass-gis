import { AuthMiddleware, tokenOf } from './auth.middleware';

const context = { user: { id: 'u', email: 'a@b.c', role: 'viewer' }, sid: 's', expiresAt: new Date() };

async function run(method: string, cookie: string | undefined, resolved: unknown, secure = false) {
  const auth = { authenticate: async () => resolved, config: { cookieSecure: secure } } as any;
  const headers: Record<string, string> = {};
  const request: any = { method, headers: cookie ? { cookie } : {} };
  const response = { setHeader: (name: string, value: string) => (headers[name.toLowerCase()] = value) };
  let nextError: unknown = 'not called';
  await new AuthMiddleware(auth).use(request, response, (error?: unknown) => (nextError = error));
  return { auth: request.auth, setCookie: headers['set-cookie'], nextError };
}

describe('AuthMiddleware', () => {
  it('a public read with an invalid, expired or revoked cookie is anonymous and clears the cookie', async () => {
    for (const method of ['GET', 'HEAD']) {
      const result = await run(method, 'gis_access=stale', null);
      expect([method, result.auth, result.setCookie, result.nextError]).toEqual([
        method,
        null,
        'gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
        undefined,
      ]);
    }
    expect((await run('GET', 'gis_access=stale', null, true)).setCookie).toBe(
      'gis_access=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure',
    );
  });

  it('valid, missing cookies and unsafe methods leave the cookie alone', async () => {
    expect(await run('GET', 'gis_access=good', context)).toEqual({
      auth: context,
      setCookie: undefined,
      nextError: undefined,
    });
    expect((await run('GET', undefined, null)).setCookie).toBeUndefined();
    expect((await run('GET', 'other=1', null)).setCookie).toBeUndefined();
    // A cross-site write with a stale cookie must not be able to force any cookie change (CSRF is checked later).
    for (const method of ['POST', 'PATCH', 'DELETE'])
      expect((await run(method, 'gis_access=stale', null)).setCookie).toBeUndefined();
  });
});

describe('Bearer credential selection', () => {
  it.each([
    ['Bearer header-jwt', 'header-jwt'],
    ['bearer header-jwt', 'header-jwt'],
    ['Basic header-jwt', undefined],
    ['Bearer', undefined],
    ['Bearer a b', undefined],
    ['', undefined],
  ])('header (%#) takes precedence over cookies', (authorization, expected) => {
    expect(tokenOf({ headers: { cookie: 'gis_access=cookie-jwt', authorization } })).toBe(expected);
  });

  it('array headers are unusable without cookie fallback', () => {
    expect(
      tokenOf({ headers: { cookie: 'gis_access=cookie-jwt', authorization: ['Bearer a', 'Bearer b'] } }),
    ).toBeUndefined();
  });

  it('marks only authenticated Bearer requests and never clears cookies on header failures', async () => {
    for (const resolved of [context, null]) {
      const request: any = {
        method: 'GET',
        headers: { authorization: 'Bearer header-jwt', cookie: 'gis_access=cookie-jwt' },
      };
      const changed: string[] = [];
      const auth = { authenticate: async () => resolved, config: { cookieSecure: false } } as any;
      await new AuthMiddleware(auth).use(request, { setHeader: (key) => changed.push(key) }, () => {});
      expect(request.authSource).toBe(resolved ? 'bearer' : undefined);
      // A dead Bearer token is flagged, but the cookie is never cleared because of a header failure.
      expect(changed).toEqual(resolved ? [] : ['X-Auth-Session']);
    }
  });
});
