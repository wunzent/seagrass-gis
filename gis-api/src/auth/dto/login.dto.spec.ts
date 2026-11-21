import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { LoginDto } from './login.dto';

const pipe = createValidationPipe();
const loginBody = (value: unknown) => pipe.transform(value, { type: 'body', metatype: LoginDto }) as Promise<LoginDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try { await run(); } catch (error: any) { return [error.getStatus(), error.getResponse().error.code]; }
  return 'no error';
}

describe('login body DTO', () => {
  it('accepts a valid body and rejects unknown or mistyped properties', async () => {
    expect((await loginBody({ email: 'a@b.c', password: 'x' })).email).toBe('a@b.c');
    expect(await outcome(() => loginBody({ email: 'a@b.c' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 'a@b.c', password: 'x', role: 'admin' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => loginBody({ email: 1, password: 'x' }))).toEqual([400, 'VALIDATION_ERROR']);
  });
});
