import { parseCookies } from './cookies';

describe('cookies', () => {
  it('cookie header parsing', () => {
    expect(parseCookies('a=1; gis_access=abc.def.ghi; b=x=y')).toEqual({ a: '1', gis_access: 'abc.def.ghi', b: 'x=y' });
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('broken; =x')).toEqual({});
  });
});
