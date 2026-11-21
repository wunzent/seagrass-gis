import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { SiteCodeParamsDto } from './site-code.params.dto';

const pipe = createValidationPipe();
const siteCode = (value: unknown) => pipe.transform(value, { type: 'param', metatype: SiteCodeParamsDto }) as Promise<SiteCodeParamsDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try { await run(); } catch (error: any) { return [error.getStatus(), error.getResponse().error.code]; }
  return 'no error';
}

describe('site code path parameter DTO', () => {
  it('accepts 1-64 printable characters and rejects the rest', async () => {
    expect((await siteCode({ code: 'TRG-001' })).code).toBe('TRG-001');
    expect((await siteCode({ code: 'x'.repeat(64) })).code).toBe('x'.repeat(64));
    for (const bad of ['', 'x'.repeat(65), 'A\u0000B', ' ']) expect([JSON.stringify(bad), await outcome(() => siteCode({ code: bad }))]).toEqual([JSON.stringify(bad), [400, 'VALIDATION_ERROR']]);
  });

  it('U+2028 / U+2029 only codes are whitespace-only like trim()', async () => {
    for (const bad of ['\u2028', '\u2029\u2028']) expect(await outcome(() => siteCode({ code: bad }))).toEqual([400, 'VALIDATION_ERROR']);
    for (const ok of ['A\u2028B', '\u2028A', '\u2029 A']) expect((await siteCode({ code: ok })).code).toBe(ok);
  });
});
