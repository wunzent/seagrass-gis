import { assertNoQuery } from './no-query.decorator';

const thrown = (query: unknown) => {
  try {
    assertNoQuery(query);
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error];
  }
  return 'no error';
};

describe('NoQuery (lookups: UT-06-14 / UT-11-13)', () => {
  it('accepts an empty query and rejects any parameter with the bounded unknown list', () => {
    expect(thrown({})).toBe('no error');
    expect(thrown(undefined)).toBe('no error');
    expect(thrown({ x: '1', page: ['1', '2'] })).toEqual([
      400,
      { code: 'VALIDATION_ERROR', message: expect.any(String), details: { unknown: ['x', 'page'] } },
    ]);
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${'k'.repeat(70)}${i}`, '1']));
    const [, error] = thrown(many) as [number, any];
    expect([error.details.unknown.length, error.details.unknown[0].length]).toEqual([10, 64]);
  });
});
