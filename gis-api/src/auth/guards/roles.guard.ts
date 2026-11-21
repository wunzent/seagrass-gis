import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthConfig } from '../../core/config/config';
import { Role } from '../entities/user.entity';
import { ApiError } from '../../shared/errors/api-error';
import type { HttpRequest } from '../../shared/types/http.types';
import { AUTH_CONFIG } from '../auth.constants';
import { FIELD_ROLES_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import { checkCsrf } from './csrf.guard';

export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ทำรายการนี้');
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Protected write order (AUTH-SESSION): authenticate 401 → role 403 → CSRF 403, all before DTO validation or resource lookup.
 * @FieldRoles is part of the role step: a restricted key present in the parsed body (even with value null) is 403 FORBIDDEN.
 * Registered globally (APP_GUARD) by AuthModule; relies on AuthMiddleware having set `request.auth`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}
  canActivate(context: ExecutionContext) {
    // Handler metadata overrides class metadata; reading both keeps a class-level @Roles from failing open.
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.auth) throw unauthorized();
    const role = request.auth.user.role;
    if (!roles.includes(role)) throw forbidden();
    // Class then handler: merged per field, the handler's rule wins (an empty result is []).
    const merged = this.reflector.getAllAndMerge<Record<string, Role[]>>(FIELD_ROLES_KEY, [
      context.getClass(),
      context.getHandler(),
    ]);
    const fieldRoles = Array.isArray(merged) ? {} : merged;
    const body = request.body;
    for (const [field, allowed] of Object.entries(fieldRoles))
      // A non-object body cannot prove the restricted key is absent, so it is denied too.
      if (!allowed.includes(role) && (!isObject(body) || Object.prototype.hasOwnProperty.call(body, field)))
        throw forbidden();
    checkCsrf(request.headers, this.config.allowedOrigins);
    return true;
  }
}
