const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseListQuery, parseGeoJsonQuery, parseSiteCode } = require('../../dist/sites/pipes/sites-query.pipes');

const code = fn => { try { fn(); } catch (error) { return [error.getStatus(), error.getResponse().error.code]; } return 'no error'; };

test('list query defaults and strict paging', () => {
  assert.deepEqual(parseListQuery({}), { page: 1, pageSize: 20 });
  assert.deepEqual(parseListQuery({ page: '3', pageSize: '100', province: '93', status: 'no_data', q: 'Tr' }),
    { page: 3, pageSize: 100, province: '93', status: 'no_data', q: 'Tr' });
  for (const page of ['0', '-1', '1.5', '1e2', ' 2', '', '01x']) assert.deepEqual(code(() => parseListQuery({ page })), [400, 'VALIDATION_ERROR'], page);
  for (const pageSize of ['0', '101', 'abc']) assert.deepEqual(code(() => parseListQuery({ pageSize })), [400, 'VALIDATION_ERROR'], pageSize);
});

test('list query rejects unknown, repeated and malformed filters', () => {
  assert.deepEqual(code(() => parseListQuery({ sort: 'name' })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(code(() => parseListQuery({ q: ['a', 'b'] })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(code(() => parseListQuery({ status: 'great' })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(code(() => parseListQuery({ province: '' })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(code(() => parseListQuery({ province: 'ABC' })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(code(() => parseListQuery({ q: 'x'.repeat(101) })), [400, 'VALIDATION_ERROR']);
  assert.deepEqual(parseListQuery({ q: '' }), { page: 1, pageSize: 20 });
  for (const q of ['a\u0000b', 'x\ud800']) assert.deepEqual(code(() => parseListQuery({ q })), [400, 'VALIDATION_ERROR'], JSON.stringify(q));
  assert.equal(parseListQuery({ q: 'tab\there' }).q, 'tab\there');
  const many = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}${'z'.repeat(200)}`, '1']));
  assert.throws(() => parseListQuery(many), error => {
    const { unknown } = error.getResponse().error.details;
    return unknown.length === 10 && unknown.every(k => k.length <= 64);
  });
});

test('geojson query requires a valid bbox and rejects paging params', () => {
  assert.deepEqual(parseGeoJsonQuery({ bbox: '99.1,7.2,99.5,7.6', status: 'good' }),
    { bbox: [99.1, 7.2, 99.5, 7.6], status: 'good' });
  assert.deepEqual(parseGeoJsonQuery({ bbox: '-180,-90,180,90' }).bbox, [-180, -90, 180, 90]);
  for (const bbox of [undefined, '', '1,2,3', '1,2,3,4,5', '99,7,98,8', '99,8,100,7', '99,7,99,8', '181,7,182,8',
    '99,-91,100,8', 'a,b,c,d', '99,7,100,Infinity', '0x1,7,2,8', '99,7,100,8 ']) {
    assert.deepEqual(code(() => parseGeoJsonQuery(bbox === undefined ? {} : { bbox })), [400, 'INVALID_BBOX'], String(bbox));
  }
  assert.deepEqual(code(() => parseGeoJsonQuery({ bbox: '1,2,3,4', page: '1' })), [400, 'VALIDATION_ERROR']);
});

test('site code path parameter', () => {
  assert.equal(parseSiteCode('TRG-001'), 'TRG-001');
  assert.equal(parseSiteCode('x'.repeat(64)), 'x'.repeat(64));
  for (const bad of ['', 'x'.repeat(65), 'A\u0000B', ' ']) assert.deepEqual(code(() => parseSiteCode(bad)), [400, 'VALIDATION_ERROR'], JSON.stringify(bad));
});
