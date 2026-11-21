import { ApiError } from '../../shared/errors/api-error';

/**
 * Attempt budget per client + normalized email, fixed window, in-process (single API container in Compose).
 * `attempt` reserves synchronously before any async credential work, so concurrent requests cannot exceed the budget;
 * `succeed` clears the key, so successful logins never accumulate and one account's failures do not block others.
 */
export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max = 10, private readonly windowMs = 15 * 60_000) {}

  attempt(key: string, now = Date.now()) {
    let entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.attempts.size > 10_000) for (const [k, v] of this.attempts) if (v.resetAt <= now) this.attempts.delete(k);
      entry = { count: 0, resetAt: now + this.windowMs };
      this.attempts.set(key, entry);
    }
    if (entry.count >= this.max) throw new ApiError(429, 'AUTH_RATE_LIMITED', 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่');
    entry.count += 1;
  }

  succeed(key: string) { this.attempts.delete(key); }
}
