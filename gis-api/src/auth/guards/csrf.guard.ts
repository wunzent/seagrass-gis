import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AuthConfig } from '../../core/config/config';
import { ApiError } from '../../shared/errors/api-error';
import { AUTH_CONFIG } from '../auth.constants';
type Headers = Record<string, string | string[] | undefined>;

const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? undefined : value;
};

/** Exact Origin match + custom header + Fetch Metadata. Never touches the session, so a CSRF failure is not a forced logout. */
export function checkCsrf(headers: Headers, allowedOrigins: string[]) {
  const origin = header(headers, 'origin');
  const ok = origin !== undefined && allowedOrigins.includes(origin)
    && header(headers, 'x-csrf-protection') === '1'
    && header(headers, 'sec-fetch-site') !== 'cross-site';
  if (!ok) throw new ApiError(403, 'CSRF_REJECTED', 'คำขอถูกปฏิเสธเพื่อป้องกัน CSRF');
}

/** For unauthenticated unsafe endpoints (login, logout): CSRF runs before credentials or body validation. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  canActivate(context: ExecutionContext) {
    checkCsrf(context.switchToHttp().getRequest().headers, this.config.allowedOrigins);
    return true;
  }
}
