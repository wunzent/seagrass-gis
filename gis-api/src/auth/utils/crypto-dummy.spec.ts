import { jest } from '@jest/globals';

// ESM namespaces cannot be spied on, so the module is mocked before crypto.ts is imported.
const real = await import('node:crypto');
let failNext = false;
jest.unstable_mockModule('node:crypto', () => ({
  ...real,
  scrypt: (...args: any[]) => {
    if (!failNext) return (real.scrypt as any)(...args);
    failNext = false;
    args[args.length - 1](new Error('transient scrypt failure'));
  },
}));
const { verifyAgainstDummy } = await import('./crypto');

describe('verifyAgainstDummy', () => {
  it('does not cache a failed dummy hash forever', async () => {
    failNext = true;
    await expect(verifyAgainstDummy('x')).rejects.toThrow('transient scrypt failure');
    await expect(verifyAgainstDummy('x')).resolves.toBe(false);
  });
});
