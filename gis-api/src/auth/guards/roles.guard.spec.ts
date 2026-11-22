import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { FieldRoles, Roles } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

const status = (fn: () => unknown): [number, string] | 'no error' => {
  try {
    fn();
  } catch (e: any) {
    return [e.getStatus(), e.getResponse().error.code];
  }
  return 'no error';
};

describe('RolesGuard', () => {
  it('enforces roles declared on the controller class as well as the handler', () => {
    class ClassLevel {
      write() {}
    }
    Roles('admin')(ClassLevel);
    const config = { allowedOrigins: ['http://localhost:3000'] } as any;
    const guard = new RolesGuard(new Reflector(), config);
    const ctx = (auth: unknown) =>
      ({
        getHandler: () => ClassLevel.prototype.write,
        getClass: () => ClassLevel,
        switchToHttp: () => ({
          getRequest: () => ({ auth, headers: { origin: 'http://localhost:3000', 'x-csrf-protection': '1' } }),
        }),
      }) as any;
    expect(status(() => guard.canActivate(ctx(null)))).toEqual([401, 'UNAUTHORIZED']);
    expect(status(() => guard.canActivate(ctx({ user: { role: 'editor' } })))).toEqual([403, 'FORBIDDEN']);
    expect(guard.canActivate(ctx({ user: { role: 'admin' } }))).toBe(true);
  });

  it('a body field restricted by @FieldRoles is refused with 403 before CSRF, even when null', () => {
    class Handler {
      patch() {}
    }
    Roles('editor', 'admin')(Handler.prototype, 'patch', Object.getOwnPropertyDescriptor(Handler.prototype, 'patch')!);
    FieldRoles({ geometry: ['admin'] })(
      Handler.prototype,
      'patch',
      Object.getOwnPropertyDescriptor(Handler.prototype, 'patch')!,
    );
    const guard = new RolesGuard(new Reflector(), { allowedOrigins: ['http://localhost:3000'] } as any);
    const ctx = (role: string, body: unknown, headers: Record<string, string> = {}) =>
      ({
        getHandler: () => Handler.prototype.patch,
        getClass: () => Handler,
        switchToHttp: () => ({ getRequest: () => ({ auth: { user: { role } }, body, headers }) }),
      }) as any;
    const okHeaders = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
    for (const body of [
      { version: 1, geometry: null },
      { version: 1, geometry: {} },
    ])
      expect(status(() => guard.canActivate(ctx('editor', body)))).toEqual([403, 'FORBIDDEN']); // no CSRF headers: FORBIDDEN wins
    expect(guard.canActivate(ctx('editor', { version: 1, name: 'x' }, okHeaders))).toBe(true);
    // A body that is not a plain object cannot prove the restricted key is absent: deny roles lacking that field.
    for (const body of [[{ geometry: 1 }], undefined, null, 'geometry=1'])
      expect([JSON.stringify(body), status(() => guard.canActivate(ctx('editor', body, okHeaders)))]).toEqual([
        JSON.stringify(body),
        [403, 'FORBIDDEN'],
      ]);
    expect(guard.canActivate(ctx('admin', [{ geometry: 1 }], okHeaders))).toBe(true); // admin may send it: 400 later
    expect(guard.canActivate(ctx('admin', { version: 1, geometry: null }, okHeaders))).toBe(true);
    expect(status(() => guard.canActivate(ctx('admin', { geometry: null })))).toEqual([403, 'CSRF_REJECTED']);
  });

  it('@FieldRoles on the class and the handler are merged; the handler wins per field', () => {
    class Merged {
      patch() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(Merged.prototype, 'patch')!;
    Roles('editor', 'admin')(Merged.prototype, 'patch', descriptor);
    FieldRoles({ geometry: ['admin'], name: ['admin'] })(Merged);
    FieldRoles({ name: ['editor', 'admin'] })(Merged.prototype, 'patch', descriptor);
    const guard = new RolesGuard(new Reflector(), { allowedOrigins: ['http://localhost:3000'] } as any);
    const headers = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
    const ctx = (body: unknown) =>
      ({
        getHandler: () => Merged.prototype.patch,
        getClass: () => Merged,
        switchToHttp: () => ({ getRequest: () => ({ auth: { user: { role: 'editor' } }, body, headers }) }),
      }) as any;
    expect(status(() => guard.canActivate(ctx({ geometry: null })))).toEqual([403, 'FORBIDDEN']); // class-level rule kept
    expect(guard.canActivate(ctx({ name: 'x' }))).toBe(true); // handler overrides the class rule for `name`
  });
});

describe('Bearer CSRF exemption', () => {
  it('skips CSRF only for an authenticated Bearer source and still enforces roles', () => {
    class Handler {
      patch() {}
    }
    Roles('admin')(Handler.prototype, 'patch', Object.getOwnPropertyDescriptor(Handler.prototype, 'patch')!);
    const guard = new RolesGuard(new Reflector(), { allowedOrigins: ['http://localhost:3000'] } as any);
    const ctx = (auth: unknown, authSource?: string) =>
      ({
        getHandler: () => Handler.prototype.patch,
        getClass: () => Handler,
        switchToHttp: () => ({
          getRequest: () => ({ auth, authSource, headers: { authorization: 'Bearer supplied' } }),
        }),
      }) as any;
    expect(guard.canActivate(ctx({ user: { role: 'admin' } }, 'bearer'))).toBe(true);
    expect(status(() => guard.canActivate(ctx({ user: { role: 'admin' } }, 'cookie')))).toEqual([403, 'CSRF_REJECTED']);
    expect(status(() => guard.canActivate(ctx(null, 'bearer')))).toEqual([401, 'UNAUTHORIZED']);
    expect(status(() => guard.canActivate(ctx({ user: { role: 'viewer' } }, 'bearer')))).toEqual([403, 'FORBIDDEN']);
  });
});
