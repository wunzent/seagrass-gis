import { readAuthConfig, readConfig } from './config';

const SECRET = 'unit-test-secret-that-is-at-least-32-bytes';

describe('config', () => {
  it('requires PostgreSQL URL, rejects invalid ports and preserves valid port', () => {
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
    expect(() => readConfig({ DATABASE_URL: 'https://secret.example' })).toThrow(/DATABASE_URL/);
    for (const PORT of ['0', '65536', '3.5', '3001garbage', '', '-1']) {
      expect(() => readConfig({ DATABASE_URL: 'postgres://localhost/gis', PORT })).toThrow(/PORT/);
    }
    expect(readConfig({ DATABASE_URL: 'postgres://localhost/gis', PORT: '4000' }).port).toBe(4000);
  });

  it('auth config: loopback HTTP allowed without Secure, other HTTP rejected', () => {
    const base = {
      JWT_SECRET: SECRET,
      PUBLIC_WEB_ORIGIN: 'http://localhost:3000',
      API_DOCS_ORIGIN: 'http://localhost:3001',
    };
    expect(readAuthConfig(base)).toEqual({
      jwtSecret: SECRET,
      allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
      cookieSecure: false,
    });
    expect(
      readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'https://gis.example', API_DOCS_ORIGIN: 'https://api.gis.example' })
        .cookieSecure,
    ).toBe(true);
    expect(() => readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'http://gis.example' })).toThrow(/HTTPS/);
    expect(() => readAuthConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => readAuthConfig({ ...base, PUBLIC_WEB_ORIGIN: 'http://localhost:3000/path' })).toThrow(/origin/);
    expect(() => readAuthConfig({ ...base, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
  });
});
