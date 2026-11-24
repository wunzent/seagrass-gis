import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { ACCESS_COOKIE, clearedAccessCookie, parseCookies } from '../utils/cookies';
import type { HttpRequest, HttpResponse } from '../../shared/types/http.types';

export const hasAuthorization = (request: Pick<HttpRequest, 'headers'>) =>
  Object.prototype.hasOwnProperty.call(request.headers, 'authorization');

export const cookieTokenOf = (request: Pick<HttpRequest, 'headers'>) => {
  const raw = request.headers.cookie;
  return parseCookies(typeof raw === 'string' ? raw : undefined)[ACCESS_COOKIE] || undefined;
};

export const tokenOf = (request: Pick<HttpRequest, 'headers'>) => {
  if (hasAuthorization(request)) {
    const header = request.headers.authorization;
    return typeof header === 'string' ? /^Bearer +([^\s,]+)$/i.exec(header)?.[1] : undefined;
  }
  return cookieTokenOf(request);
};

const SAFE_METHODS = new Set(['GET', 'HEAD']);
export const AUTH_SESSION_HEADER = 'X-Auth-Session';

/** Header credentials take precedence, including malformed ones. Only cookie failures on safe methods clear cookies. */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}
  async use(request: HttpRequest & { method: string }, response: HttpResponse, next: (error?: unknown) => void) {
    try {
      const token = tokenOf(request);
      request.auth = await this.auth.authenticate(token);
      request.authSource = request.auth ? (hasAuthorization(request) ? 'bearer' : 'cookie') : undefined;
      // A token was sent but its session is gone (expired, revoked, forged): every response says so, so the web can drop
      // the identity it remembers from login without polling /auth/me. Public reads still answer anonymously.
      if (token && !request.auth) response.setHeader(AUTH_SESSION_HEADER, 'invalid');
      if (!hasAuthorization(request) && token && !request.auth && SAFE_METHODS.has(request.method))
        response.setHeader('Set-Cookie', clearedAccessCookie(this.auth.config.cookieSecure));
      next();
    } catch (error) {
      next(error);
    }
  }
}
