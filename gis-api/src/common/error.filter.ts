import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { isErrorBody } from './errors';

const FALLBACK: Record<number, [string, string]> = {
  400: ['VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง'],
  404: ['NOT_FOUND', 'Resource not found'],
  405: ['METHOD_NOT_ALLOWED', 'Method not allowed'],
  413: ['PAYLOAD_TOO_LARGE', 'Request body is too large'],
  503: ['SERVICE_UNAVAILABLE', 'Database service is unavailable'],
};

/** Every error uses the shared envelope with no-store; unexpected errors become 500 without SQL, stack or secrets. */
@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    response.setHeader('Cache-Control', 'no-store');
    if (isErrorBody(body) && status !== 500) {
      response.status(status).json(body);
      return;
    }
    const [code, message] = FALLBACK[status] ?? ['INTERNAL_ERROR', 'Internal server error'];
    if (!FALLBACK[status]) {
      // Operator diagnostics for UAT: error class and route only; never the body, cookies, JWT or the error message.
      const request = host.switchToHttp().getRequest();
      console.error(JSON.stringify({ level: 'error', code: 'INTERNAL_ERROR', error: (error as Error)?.constructor?.name ?? 'unknown', method: request?.method, path: request?.route?.path ?? 'unmatched' }));
    }
    response.status(FALLBACK[status] ? status : 500).json({ error: { code, message, details: {} } });
  }
}
