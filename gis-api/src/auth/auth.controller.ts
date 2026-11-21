import { Controller, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorResponse, ref } from '../common/openapi-schemas';
import { tokenOf } from './auth.middleware';
import { CsrfGuard } from './guards/csrf.guard';
import { unauthorized } from './guards/roles.guard';
import { AuthService } from './auth.service';
import { accessCookie, clearedAccessCookie } from './cookies';
import { ACCESS_TTL_SECONDS } from './crypto';
import type { HttpRequest, HttpResponse } from '../common/http-types';
import { JsonBody, LoginBodyPipe, LoginInput } from './pipes/login-body.pipe';

const CSRF_HEADERS: MethodDecorator = (target, key, descriptor) => {
  ApiHeader({ name: 'X-CSRF-Protection', required: true, schema: { type: 'string', enum: ['1'] } })(target, key, descriptor);
  ApiHeader({ name: 'Origin', required: true, description: 'ต้องตรงกับ PUBLIC_WEB_ORIGIN หรือ API_DOCS_ORIGIN' })(target, key, descriptor);
  ApiResponse(errorResponse(403, ['CSRF_REJECTED']))(target, key, descriptor);
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'เข้าสู่ระบบ: ตั้ง HttpOnly cookie gis_access (JWT 15 นาที) ไม่คืน token ใน JSON' })
  @CSRF_HEADERS
  @ApiBody({ schema: ref('LoginRequest') })
  @ApiResponse({ status: 200, schema: ref('LoginResponse'), headers: { 'Set-Cookie': { schema: { type: 'string' }, description: 'gis_access=<JWT>; Max-Age=900; Path=/; HttpOnly; SameSite=Lax' } } })
  @ApiResponse(errorResponse(400, ['VALIDATION_ERROR']))
  @ApiResponse(errorResponse(401, ['INVALID_CREDENTIALS']))
  @ApiResponse(errorResponse(429, ['AUTH_RATE_LIMITED']))
  @ApiResponse(errorResponse(503, ['SERVICE_UNAVAILABLE']))
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  async login(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse, @JsonBody(LoginBodyPipe) body: LoginInput) {
    const result = await this.auth.login(body.email, body.password, tokenOf(request), request.socket.remoteAddress ?? 'unknown');
    response.setHeader('Set-Cookie', accessCookie(result.token, ACCESS_TTL_SECONDS, this.auth.config.cookieSecure));
    return { user: result.user, expires_in: ACCESS_TTL_SECONDS, expires_at: result.expiresAt.toISOString() };
  }

  @Get('me')
  @ApiOperation({ summary: 'ผู้ใช้ปัจจุบันจาก cookie session (ไม่ต่ออายุ)' })
  @ApiCookieAuth('gis_access')
  @ApiResponse({ status: 200, schema: ref('MeResponse') })
  @ApiResponse(errorResponse(401, ['UNAUTHORIZED']))
  @Header('Cache-Control', 'no-store')
  me(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    if (!request.auth) {
      if (tokenOf(request)) response.setHeader('Set-Cookie', clearedAccessCookie(this.auth.config.cookieSecure));
      throw unauthorized();
    }
    return { user: request.auth.user, expires_at: request.auth.expiresAt.toISOString() };
  }

  @Post('logout')
  @ApiOperation({ summary: 'ออกจากระบบ: เพิกถอน session และล้าง cookie (idempotent)' })
  @ApiCookieAuth('gis_access')
  @CSRF_HEADERS
  @ApiResponse({ status: 204, description: 'No content' })
  @ApiResponse(errorResponse(503, ['SERVICE_UNAVAILABLE']))
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  async logout(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    await this.auth.logout(tokenOf(request));
    response.setHeader('Set-Cookie', clearedAccessCookie(this.auth.config.cookieSecure));
  }
}
