import { assertDemoPasswords } from './demo-users';

describe('assertDemoPasswords', () => {
  it('accepts short demo passwords chosen by the owner', () => {
    expect(() =>
      assertDemoPasswords({ DEMO_VIEWER_PASSWORD: 'v', DEMO_EDITOR_PASSWORD: 'edit', DEMO_ADMIN_PASSWORD: 'admin' }),
    ).not.toThrow();
  });

  it('accepts unset demo passwords (that account is skipped)', () => {
    expect(() => assertDemoPasswords({})).not.toThrow();
  });
});
