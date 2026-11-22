import { readAuthConfig } from '../core/config/config';

describe('demo login configuration', () => {
  it.each([undefined, 'false', 'TRUE', ' true', 'true ', '1'])('disables flag %s', (flag) => {
    expect(readAuthConfig(env(flag))).toMatchObject({ demoLoginEnabled: false });
  });

  it('enables only exact true, also in the production Docker image (the flag is the only switch)', () => {
    expect(readAuthConfig(env('true'))).toMatchObject({ demoLoginEnabled: true });
    expect(readAuthConfig({ ...env('true'), NODE_ENV: 'production' })).toMatchObject({ demoLoginEnabled: true });
  });
});

function env(flag: string | undefined): NodeJS.ProcessEnv {
  return {
    JWT_SECRET: 'test-only-secret-at-least-32-characters-long',
    PUBLIC_WEB_ORIGIN: 'http://localhost:3000',
    API_DOCS_ORIGIN: 'http://localhost:3001',
    NODE_ENV: 'test',
    DEMO_LOGIN_ENABLED: flag,
  };
}
