import 'reflect-metadata';
import { ArgumentsHost, Catch, Controller, ExceptionFilter, Get, Header, HttpException, Inject, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseQuery, checkHealth } from './health';

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
    const mapping: Record<number, [string, string]> = {
      400: ['BAD_REQUEST', 'Invalid request'],
      404: ['NOT_FOUND', 'Resource not found'],
      405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
      503: ['SERVICE_UNAVAILABLE', 'Database service is unavailable'],
    };
    const [code, message] = mapping[status] ?? ['INTERNAL_ERROR', 'Internal server error'];
    host.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    host.switchToHttp().getResponse().status(status).json({ error: { code, message, details: {} } });
  }
}
export async function createApp(database: DatabaseQuery, onShutdown: () => Promise<void> = async () => {}) {
  @Module({ controllers: [HealthController], providers: [
    { provide: DATABASE, useValue: database },
    { provide: 'DATABASE_SHUTDOWN', useValue: { onApplicationShutdown: onShutdown } },
  ] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new SafeErrorFilter());
  return app;
}
