import { createParamDecorator, ExecutionContext, Injectable, PipeTransform } from '@nestjs/common';
import type { HttpRequest } from '../../common/http-types';
import { validationError } from '../../common/errors';

export interface LoginInput { email: string; password: string }

/** Request body, accepted only when Content-Type is application/json (form posts are rejected before the pipe). */
export const JsonBody = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<HttpRequest & { body: unknown }>();
  if (!request.is('application/json')) throw validationError({ reason: 'Content-Type must be application/json' });
  return request.body;
});

/** Exactly {email, password}; unknown fields rejected. */
export function parseLogin(body: unknown): LoginInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw validationError();
  const { email, password } = body as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof email !== 'string' || typeof password !== 'string'
    || email.length < 3 || email.length > 254 || password.length < 1 || password.length > 256) throw validationError();
  return { email, password };
}

@Injectable()
export class LoginBodyPipe implements PipeTransform<unknown, LoginInput> {
  transform(body: unknown) { return parseLogin(body); }
}
