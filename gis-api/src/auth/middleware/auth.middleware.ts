import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { ACCESS_COOKIE, clearedAccessCookie, parseCookies } from '../utils/cookies';
import type { HttpRequest, HttpResponse } from '../../shared/types/http.types';

export const tokenOf = (request: Pick<HttpRequest, 'headers'>) => {
  const raw = request.headers.cookie;
  return parseCookies(typeof raw === 'string' ? raw : undefined)[ACCESS_COOKIE] || undefined;
};

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** Sets `request.auth` (null when the cookie is unusable; RolesGuard and /auth/me enforce 401). GET/HEAD also clear an
 * unusable cookie; unsafe methods never touch it, so a cross-site write cannot force a logout. */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}
  async use(request: HttpRequest & { method: string }, response: HttpResponse, next: (error?: unknown) => void) {
    try {
      const token = tokenOf(request);
      request.auth = await this.auth.authenticate(token);
      if (token && !request.auth && SAFE_METHODS.has(request.method))
        response.setHeader('Set-Cookie', clearedAccessCookie(this.auth.config.cookieSecure));
      next();
    } catch (error) {
      next(error);
    }
  }
}
