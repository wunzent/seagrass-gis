import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { ListSitesQueryDto } from './list-sites.query.dto';

const pipe = createValidationPipe();
const listQuery = (value: unknown) =>
  pipe.transform(value, { type: 'query', metatype: ListSitesQueryDto }) as Promise<ListSitesQueryDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}
async function thrown(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected an error');
}

describe('GET /sites query DTO', () => {
  it('list query defaults and strict paging', async () => {
    expect((await listQuery({})).toListQuery()).toEqual({ page: 1, pageSize: 20 });
    expect(
      (await listQuery({ page: '3', pageSize: '100', province: '93', status: 'no_data', q: 'Tr' })).toListQuery(),
    ).toEqual({ page: 3, pageSize: 100, province: '93', status: 'no_data', q: 'Tr' });
    for (const page of ['0', '-1', '1.5', '1e2', ' 2', '', '01x'])
      expect([page, await outcome(() => listQuery({ page }))]).toEqual([page, [400, 'VALIDATION_ERROR']]);
    for (const pageSize of ['0', '101', 'abc'])
      expect([pageSize, await outcome(() => listQuery({ pageSize }))]).toEqual([pageSize, [400, 'VALIDATION_ERROR']]);
  });

  it('list query rejects unknown, repeated and malformed filters', async () => {
    expect(await outcome(() => listQuery({ sort: 'name' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ q: ['a', 'b'] }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ status: 'great' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ province: '' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ province: 'ABC' }))).toEqual([400, 'VALIDATION_ERROR']);
    expect(await outcome(() => listQuery({ q: 'x'.repeat(101) }))).toEqual([400, 'VALIDATION_ERROR']);
    expect((await listQuery({ q: '' })).toListQuery()).toEqual({ page: 1, pageSize: 20 });
    for (const q of ['a\u0000b', 'x\ud800'])
      expect([JSON.stringify(q), await outcome(() => listQuery({ q }))]).toEqual([
        JSON.stringify(q),
        [400, 'VALIDATION_ERROR'],
      ]);
    expect((await listQuery({ q: 'tab\there' })).toListQuery().q).toBe('tab\there');
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}${'z'.repeat(200)}`, '1']));
    const error = await thrown(() => listQuery(many));
    const { unknown } = error.getResponse().error.details as { unknown: string[] };
    expect(unknown).toHaveLength(10);
    expect(unknown.every((k) => k.length <= 64)).toBe(true);
  });
});
