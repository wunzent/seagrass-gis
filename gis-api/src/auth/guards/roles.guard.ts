import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthConfig } from '../../config/config';
import { Role } from '../user.model';
import { ApiError } from '../../common/errors';
import type { HttpRequest } from '../../common/http-types';
import { AUTH_CONFIG } from '../auth.constants';
import { checkCsrf } from './csrf.guard';

const ROLES = 'gis:roles';
/** Marks a protected write and the roles allowed to call it. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');

/**
 * Protected write order (AUTH-SESSION): authenticate 401 → role 403 → CSRF 403, all before DTO validation or resource lookup.
 * Registered globally (APP_GUARD) by AuthModule; relies on AuthMiddleware having set `request.auth`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}
  canActivate(context: ExecutionContext) {
    // Handler metadata overrides class metadata; reading both keeps a class-level @Roles from failing open.
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles) return true;
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!request.auth) throw unauthorized();
    if (!roles.includes(request.auth.user.role)) throw new ApiError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ทำรายการนี้');
    checkCsrf(request.headers, this.config.allowedOrigins);
    return true;
  }
}
