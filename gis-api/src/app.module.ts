import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { AuthConfig } from './core/config/config';
import { Database } from './core/database/database.module';
import { HealthModule } from './health/health.module';
import { SafeErrorFilter } from './shared/filters/http-exception.filter';
import { setupDocs } from './shared/openapi/openapi';
import { createValidationPipe } from './shared/pipes/strict-validation.pipe';
import { SitesModule } from './sites/sites.module';

export interface AppOptions {
  auth?: AuthConfig;
  loginLimit?: { max: number; windowMs: number };
  onShutdown?: () => Promise<void>;
}

/** Tests may omit `auth`: a random per-process secret and the loopback origins are used. main.ts passes readAuthConfig(). */
const localAuth = (): AuthConfig => ({
  jwtSecret: randomBytes(32).toString('hex'),
  allowedOrigins: ['http://localhost:3000', 'http://localhost:3001'],
  cookieSecure: false,
});

/** Root module, built per call so each app (and each test) gets its own database handle and auth config. */
export function appModule(database: Database, options: AppOptions = {}) {
  @Module({
    imports: [
      CoreModule.forRoot(database, options.onShutdown),
      AuthModule.forRoot({ config: options.auth ?? localAuth(), loginLimit: options.loginLimit }),
      HealthModule,
      SitesModule,
    ],
    providers: [
      { provide: APP_FILTER, useClass: SafeErrorFilter },
      { provide: APP_PIPE, useFactory: createValidationPipe },
    ],
  })
  class AppModule {}
  return AppModule;
}

export async function createApp(database: Database, options: AppOptions = {}) {
  const app = await NestFactory.create(appModule(database, options), { logger: false });
  setupDocs(app);
  return app;
}
