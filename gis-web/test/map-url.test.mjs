import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMapUrl, serializeMapUrl } from '../src/lib/map-url.ts';

test('map URL round trips filters, selected site, view and pagination', () => {
  const state = {
    list: { filters: { province: '92', status: 'good', q: 'หญ้าทะเล & เกาะ' }, page: 3, pageSize: 10 },
    site: 'TRG-001',
    view: 'table',
  };
  const query = serializeMapUrl(state);
  assert.equal(query.get('site'), 'TRG-001');
  assert.deepEqual(parseMapUrl(new URLSearchParams(query.toString())), state);
  assert.equal(serializeMapUrl(parseMapUrl(new URLSearchParams())).toString(), '');
});

test('invalid URL fields fall back independently and supported site codes keep their original text', () => {
  const invalid = new URLSearchParams({
    province: '92',
    status: 'constructor',
    q: 'x'.repeat(201),
    site: 'bad\0code',
    view: 'other',
    page: '1e2',
    pageSize: '500',
  });
  assert.deepEqual(parseMapUrl(invalid), {
    list: { filters: { province: '92', status: '', q: '' }, page: 1, pageSize: 20 },
    site: null,
    view: 'map',
  });
  for (const site of [' ', '..', 'x'.repeat(65)]) assert.equal(parseMapUrl(new URLSearchParams({ site })).site, null);
  assert.equal(parseMapUrl(new URLSearchParams({ site: 'แหล่ง A/B' })).site, 'แหล่ง A/B');
});
