import 'reflect-metadata';
import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, Header, HttpException, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { isErrorBody } from './errors';
import { DatabaseQuery, checkHealth } from './health';
import { SITES_REPOSITORY, SitesController } from './sites/controller';
import { SitesDatabase, SitesRepository } from './sites/repository';

export const DATABASE = Symbol('DATABASE');
@Controller()
class HealthController {
  constructor(@Inject(DATABASE) private readonly database: DatabaseQuery) {}
  @Get('health')
  @Header('Cache-Control', 'no-store')
  health() { return checkHealth(this.database); }
}
@Catch()
class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const response = host.switchToHttp().getResponse();
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    if (isErrorBody(body) && status !== 500) {
      response.setHeader('Cache-Control', 'no-store');
      response.status(status).json(body);
      return;
    }
    const mapping: Record<number, [string, string]> = {
      400: ['VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง'],
      404: ['NOT_FOUND', 'Resource not found'],
      405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
      503: ['SERVICE_UNAVAILABLE', 'Database service is unavailable'],
    };
    const [code, message] = mapping[status] ?? ['INTERNAL_ERROR', 'Internal server error'];
    host.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    host.switchToHttp().getResponse().status(status).json({ error: { code, message, details: {} } });
  }
}
export async function createApp(database: SitesDatabase, onShutdown: () => Promise<void> = async () => {}) {
  @Module({ controllers: [HealthController, SitesController], providers: [
    { provide: DATABASE, useValue: database },
    { provide: SITES_REPOSITORY, useValue: new SitesRepository(database) },
    { provide: 'DATABASE_SHUTDOWN', useValue: { onApplicationShutdown: onShutdown } },
  ] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new SafeErrorFilter());
  return app;
}
