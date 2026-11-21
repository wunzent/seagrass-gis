import { LoginRateLimiter } from './login-rate-limiter';

const status = (fn: () => unknown): [number, string] | 'no error' => {
  try {
    fn();
  } catch (e: any) {
    return [e.getStatus(), e.getResponse().error.code];
  }
  return 'no error';
};

describe('LoginRateLimiter', () => {
  it('counts failures per client and email, and success resets it', () => {
    const limiter = new LoginRateLimiter(2, 60_000);
    const a = 'ip1|a@x',
      b = 'ip1|b@x';
    // Attempts are reserved synchronously, so concurrent requests cannot all pass before a failure is recorded.
    limiter.attempt(a);
    limiter.attempt(a);
    expect(status(() => limiter.attempt(a))).toEqual([429, 'AUTH_RATE_LIMITED']);
    limiter.attempt(b);
    limiter.succeed(a);
    limiter.attempt(a);
    for (let i = 0; i < 5; i++) {
      limiter.attempt(b);
      limiter.succeed(b);
    } // successful logins never accumulate
  });

  it('keeps the key map under a hard cap by evicting the oldest entries when pruning expired ones is not enough', () => {
    const limiter = new LoginRateLimiter(1, 60_000, 3);
    const now = 1_000_000;
    for (const key of ['k1', 'k2', 'k3', 'k4', 'k5']) limiter.attempt(key, now);
    expect(limiter.size).toBe(3);
    // k1 and k2 were evicted (oldest), so they start a fresh budget; k5 is still limited.
    expect(status(() => limiter.attempt('k5', now))).toEqual([429, 'AUTH_RATE_LIMITED']);
    expect(status(() => limiter.attempt('k1', now))).toBe('no error');
    expect(limiter.size).toBe(3);
  });

  it('prunes expired entries before evicting live ones', () => {
    const limiter = new LoginRateLimiter(1, 60_000, 2);
    limiter.attempt('old', 0);
    limiter.attempt('live', 59_000);
    limiter.attempt('new', 60_000); // 'old' expired at 60_000 and is pruned; 'live' survives
    expect(limiter.size).toBe(2);
    expect(status(() => limiter.attempt('live', 60_000))).toEqual([429, 'AUTH_RATE_LIMITED']);
  });
});
