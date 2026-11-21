import { createValidationPipe } from '../../shared/pipes/strict-validation.pipe';
import { ListSurveysQueryDto } from './list-surveys.query.dto';
import { SurveyIdParamsDto } from './survey-id.params.dto';

const pipe = createValidationPipe();
const surveyId = (value: unknown) =>
  pipe.transform(value, { type: 'param', metatype: SurveyIdParamsDto }) as Promise<SurveyIdParamsDto>;
const listQuery = (value: unknown) =>
  pipe.transform(value, { type: 'query', metatype: ListSurveysQueryDto }) as Promise<ListSurveysQueryDto>;

/** Resolves to [status, error.code] of the thrown ApiError, or 'no error'. */
async function outcome(run: () => Promise<unknown>): Promise<[number, string] | 'no error'> {
  try {
    await run();
  } catch (error: any) {
    return [error.getStatus(), error.getResponse().error.code];
  }
  return 'no error';
}

describe('survey id path parameter and history paging DTOs (UT-06-11/07-12/06-09)', () => {
  it('id is a strict positive safe integer string', async () => {
    expect((await surveyId({ id: '1' })).toId()).toBe(1);
    expect((await surveyId({ id: String(Number.MAX_SAFE_INTEGER) })).toId()).toBe(Number.MAX_SAFE_INTEGER);
    for (const id of ['0', '-1', '1.5', '1e2', ' 1', '01', 'abc', '', '9007199254740992'])
      expect([id, await outcome(() => surveyId({ id }))]).toEqual([id, [400, 'VALIDATION_ERROR']]);
  });

  it('history paging defaults to page 1 / 20 and rejects bad or unknown params', async () => {
    expect((await listQuery({})).toPageQuery()).toEqual({ page: 1, pageSize: 20 });
    expect((await listQuery({ page: '2', pageSize: '100' })).toPageQuery()).toEqual({ page: 2, pageSize: 100 });
    for (const query of [{ page: '0' }, { pageSize: '101' }, { page: '1.5' }, { pageSize: 'x' }, { sort: 'id' }])
      expect([JSON.stringify(query), await outcome(() => listQuery(query))]).toEqual([
        JSON.stringify(query),
        [400, 'VALIDATION_ERROR'],
      ]);
  });
});
