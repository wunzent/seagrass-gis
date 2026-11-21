import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { validationError } from '../errors/api-error';

/** Any query parameter → 400 VALIDATION_ERROR `details.unknown` (bounded like the validation pipe; values never echoed). */
export function assertNoQuery(query: unknown): void {
  const keys = query && typeof query === 'object' ? Object.keys(query) : [];
  if (keys.length) throw validationError({ unknown: keys.map((key) => key.slice(0, 64)).slice(0, 10) });
}

/**
 * Strict "no query" for endpoints without parameters. An empty DTO class cannot be used: the global pipe's
 * forbidUnknownValues rejects even `{}` for a class without validation metadata.
 */
export const NoQuery = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  assertNoQuery(context.switchToHttp().getRequest<{ query?: unknown }>().query);
});
