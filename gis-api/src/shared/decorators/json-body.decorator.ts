import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { HttpRequest } from '../types/http.types';
import { validationError } from '../errors/api-error';

/** Request body accepted only as application/json; the global ValidationPipe then validates it against the DTO type. */
export const JsonBody = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<HttpRequest & { body: unknown }>();
  if (!request.is('application/json')) throw validationError({ reason: 'Content-Type must be application/json' });
  const body = request.body;
  // class-transformer would turn an array into an array of DTOs; the login body must be one object.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationError();
  return body;
});
