import { LoginRateLimiter } from './login-rate-limiter';

const status = (fn: () => unknown): [number, string] | 'no error' => {
  try { fn(); } catch (e: any) { return [e.getStatus(), e.getResponse().error.code]; }
  return 'no error';
};

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
