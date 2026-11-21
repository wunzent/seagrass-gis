import { checkCsrf } from './csrf.guard';

const status = (fn: () => unknown): [number, string] | 'no error' => {
  try {
    fn();
  } catch (e: any) {
    return [e.getStatus(), e.getResponse().error.code];
  }
  return 'no error';
};

describe('CSRF', () => {
  it('requires exact allowed Origin and the custom header', () => {
    const allowed = ['http://localhost:3000', 'http://localhost:3001'];
    const ok = { origin: 'http://localhost:3000', 'x-csrf-protection': '1' };
    expect(checkCsrf(ok, allowed)).toBeUndefined();
    expect(
      checkCsrf({ ...ok, origin: 'http://localhost:3001', 'sec-fetch-site': 'same-origin' }, allowed),
    ).toBeUndefined();
    for (const headers of [
      { 'x-csrf-protection': '1' },
      { ...ok, origin: 'null' },
      { ...ok, origin: 'http://localhost:3000/' },
      { ...ok, origin: 'http://127.0.0.1:3000' },
      { ...ok, origin: 'http://evil.example' },
      { origin: ok.origin },
      { ...ok, 'x-csrf-protection': 'true' },
      { ...ok, 'sec-fetch-site': 'cross-site' },
    ])
      expect([JSON.stringify(headers), status(() => checkCsrf(headers, allowed))]).toEqual([
        JSON.stringify(headers),
        [403, 'CSRF_REJECTED'],
      ]);
  });
});
