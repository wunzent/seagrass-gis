import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG, LOGIN_LIMITER } from './auth.constants';
import { LoginRateLimiter } from './utils/login-rate-limiter';
import { AuthConfig } from '../core/config/config';
import { AuthenticatedContext, Role, SessionUser } from './entities/user.entity';
import { SessionsRepository } from './sessions.repository';
import { UsersRepository } from './users.repository';
import {
  ACCESS_TTL_SECONDS,
  isVerifiableHash,
  signAccessToken,
  verifyAccessToken,
  verifyAgainstDummy,
  verifyPassword,
} from './utils/crypto';
import { ApiError } from '../shared/errors/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    @Inject(AUTH_CONFIG) readonly config: AuthConfig,
    @Inject(LOGIN_LIMITER) private readonly limiter: LoginRateLimiter,
  ) {}

  private claims(token: string | undefined) {
    const claims = token ? verifyAccessToken(token, this.config.jwtSecret) : null;
    return claims && UUID.test(claims.sid) && UUID.test(claims.sub) ? claims : null;
  }

  /** Signature/claims first, then an active DB session owned by `sub`; the role is read from the current user row. */
  async authenticate(token: string | undefined): Promise<AuthenticatedContext | null> {
    const claims = this.claims(token);
    return claims ? this.sessions.findActive(claims.sid, claims.sub) : null;
  }

  /**
   * `clientAddress` is the socket address until the web proxy forwards a trusted client address; the email keeps accounts apart
   * behind one proxy. Every attempt is reserved before credential work; success clears it.
   */
  async login(email: string, password: string, previousToken: string | undefined, clientAddress: string) {
    const normalized = email.trim().toLowerCase();
    const throttleKey = `${clientAddress}|${normalized}`;
    this.limiter.attempt(throttleKey);
    const user = await this.users.findByEmail(normalized);
    // Unknown and disabled (non-scrypt) accounts burn the same scrypt work as real ones, so timing reveals neither.
    const ok =
      user && isVerifiableHash(user.password_hash)
        ? await verifyPassword(password, user.password_hash)
        : await verifyAgainstDummy(password);
    if (!user || !ok) throw invalidCredentials();
    const result = await this.createSession(user, previousToken);
    this.limiter.succeed(throttleKey);
    return result;
  }

  async demoLogin(role: Role, previousToken: string | undefined) {
    const key = `demo:${role}`;
    this.limiter.attempt(key);
    const user = await this.users.findSessionUserByEmail(`${role}@demo.local`);
    if (!user) throw invalidCredentials();
    const result = await this.createSession(user, previousToken);
    this.limiter.succeed(key);
    return result;
  }

  private async createSession(user: SessionUser, previousToken: string | undefined) {
    const previous = this.claims(previousToken);
    const sid = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const token = signAccessToken({ sub: user.id, sid }, this.config.jwtSecret, now);
    const expiresAt = new Date((now + ACCESS_TTL_SECONDS) * 1000);
    await this.sessions.replace(previous && { sid: previous.sid, userId: previous.sub }, {
      sid,
      userId: user.id,
      expiresAt,
    });
    return { token, user: { id: user.id, email: user.email, role: user.role }, expiresAt };
  }

  /** Revokes only the session named by a validly signed cookie, matched to its subject. */
  async logout(token: string | undefined) {
    const claims = this.claims(token);
    if (claims) await this.sessions.revoke(claims.sid, claims.sub);
  }
}
