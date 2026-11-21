import { AuthMiddleware } from './auth.middleware';

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
