import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

const status = (fn: () => unknown): [number, string] | 'no error' => {
  try { fn(); } catch (e: any) { return [e.getStatus(), e.getResponse().error.code]; }
  return 'no error';
};

describe('RolesGuard', () => {
  it('enforces roles declared on the controller class as well as the handler', () => {
    class ClassLevel { write() {} }
    Roles('admin')(ClassLevel);
    const config = { allowedOrigins: ['http://localhost:3000'] } as any;
    const guard = new RolesGuard(new Reflector(), config);
    const ctx = (auth: unknown) => ({
      getHandler: () => ClassLevel.prototype.write, getClass: () => ClassLevel,
      switchToHttp: () => ({ getRequest: () => ({ auth, headers: { origin: 'http://localhost:3000', 'x-csrf-protection': '1' } }) }),
    }) as any;
    expect(status(() => guard.canActivate(ctx(null)))).toEqual([401, 'UNAUTHORIZED']);
    expect(status(() => guard.canActivate(ctx({ user: { role: 'editor' } })))).toEqual([403, 'FORBIDDEN']);
    expect(guard.canActivate(ctx({ user: { role: 'admin' } }))).toBe(true);
  });
});
