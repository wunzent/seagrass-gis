import { HttpException } from '@nestjs/common';
import type { ErrorResponseDto } from '../dto/error-response.dto';

/** Domain error carrying the shared envelope `{error:{code,message,details}}`. */
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } } satisfies ErrorResponseDto, status);
  }
}

export const validationError = (details: Record<string, unknown> = {}) =>
  new ApiError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', details);

export const invalidGeometry = () =>
  new ApiError(400, 'INVALID_GEOMETRY', 'geometry ต้องเป็น Polygon/MultiPolygon ที่ถูกต้องใน EPSG:4326 และมีพื้นที่');

export function isErrorBody(value: unknown): value is ErrorResponseDto {
  const error = (value as ErrorResponseDto | undefined)?.error;
  return typeof error?.code === 'string' && typeof error.message === 'string';
}

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '53300',
]);

/** Map driver failures to 503 when the database cannot serve, otherwise rethrow for the 500 path. */
export function toDependencyError(error: unknown): unknown {
  const e = error as { code?: string; message?: string };
  const unavailable =
    (e.code && (UNAVAILABLE_CODES.has(e.code) || e.code.startsWith('08'))) ||
    /timeout|terminated|Connection terminated/i.test(e.message ?? '');
  return unavailable ? new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database service is unavailable') : error;
}
