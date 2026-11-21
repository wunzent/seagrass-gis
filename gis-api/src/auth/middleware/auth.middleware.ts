import { Injectable, NestMiddleware } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { ACCESS_COOKIE, parseCookies } from '../utils/cookies';
import type { HttpRequest } from '../../shared/types/http.types';

export const tokenOf = (request: Pick<HttpRequest, 'headers'>) => {
  const raw = request.headers.cookie;
  return parseCookies(typeof raw === 'string' ? raw : undefined)[ACCESS_COOKIE] || undefined;
};

/**
 * Verifies the gis_access JWT and its DB session and attaches `request.auth` (AuthenticatedContext | null).
 * Missing/invalid/expired/revoked cookies resolve to anonymous; RolesGuard (and GET /auth/me) enforce 401.
 * Excluded routes are listed in AuthModule.configure().
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}
  async use(request: HttpRequest, _response: unknown, next: (error?: unknown) => void) {
    try {
      request.auth = await this.auth.authenticate(tokenOf(request));
      next();
    } catch (error) {
      next(error);
    }
  }
}
