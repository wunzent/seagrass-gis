import { DynamicModule, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthConfig } from '../core/config/config';
import { AUTH_CONFIG, LOGIN_LIMITER } from './auth.constants';
import { AuthController } from './auth.controller';
import { AuthMiddleware } from './middleware/auth.middleware';
import { AuthService } from './auth.service';
import { CsrfGuard } from './guards/csrf.guard';
import { DemoLoginGuard } from './guards/demo-login.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginRateLimiter } from './utils/login-rate-limiter';
import { SessionsRepository } from './sessions.repository';
import { UsersRepository } from './users.repository';

export interface AuthModuleOptions {
  config: AuthConfig;
  loginLimit?: { max: number; windowMs: number };
}

/**
 * Cookie-JWT sessions. Registers RolesGuard globally (no-op unless a handler or class has @Roles) and resolves
 * request.auth for every route except those excluded in configure(). Exports AuthService for modules that need the actor.
 */
@Module({})
export class AuthModule implements NestModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: AUTH_CONFIG, useValue: options.config },
        {
          provide: LOGIN_LIMITER,
          useValue: new LoginRateLimiter(options.loginLimit?.max, options.loginLimit?.windowMs),
        },
        AuthService,
        UsersRepository,
        SessionsRepository,
        CsrfGuard,
        DemoLoginGuard,
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: [AuthService, AUTH_CONFIG],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    // Excluded: /health (readiness must not depend on sessions), /docs, and login/logout, which read their own cookie
    // after the CSRF guard so a cross-site request never reaches the session table.
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'docs{/*rest}', method: RequestMethod.ALL },
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/logout', method: RequestMethod.POST },
        { path: 'auth/demo-login', method: RequestMethod.ALL },
      )
      .forRoutes({ path: '{*rest}', method: RequestMethod.ALL });
  }
}
