import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  filterState,
  listQuery,
  mapQuery,
  validBbox,
  latestRequest,
  debounce,
  createViewportUpdates,
  VIEWPORT_DEBOUNCE_MS,
} from '../src/lib/map-state.ts';

test('filter change resets pagination and gives list/map identical filter snapshot', () => {
  const state = filterState(
    { filters: { province: '', status: '', q: '' }, page: 4 },
    { province: '92', status: 'good', q: 'เกาะ & %' },
  );
  assert.equal(state.page, 1);
  const list = new URLSearchParams(listQuery(state));
  const map = new URLSearchParams(mapQuery(state.filters, [98, 6, 101, 10]));
  for (const key of ['province', 'status', 'q']) assert.equal(list.get(key), map.get(key));
  assert.equal(list.get('pageSize'), '20');
  assert.equal(map.has('page'), false);
  assert.equal(map.get('q'), 'เกาะ & %');
});

test('empty filters are omitted; invalid status/province/search are rejected', () => {
  assert.equal(listQuery({ filters: { province: '', status: '', q: '' }, page: 1 }), 'page=1&pageSize=20');
  for (const filters of [{ status: 'broken' }, { province: 'xx' }, { q: '\0' }, { q: 'x'.repeat(201) }]) {
    assert.throws(() => filterState({ filters: { province: '', status: '', q: '' }, page: 2 }, filters));
  }
});

test('bbox rejects nonfinite, reversed, wrapped and out-of-range coordinates', () => {
  assert.equal(validBbox([98, 6, 101, 10]), true);
  for (const box of [
    [1, 2, 1, 4],
    [180, 0, -180, 2],
    [0, -91, 10, 1],
    [0, 0, 181, 1],
    [NaN, 0, 1, 1],
    [0, 0, 1],
  ])
    assert.equal(validBbox(box), false);
});

test('new request aborts old request and ignores late success/failure even if abort is ignored', () => {
  const requests = latestRequest();
  const first = requests.start();
  const second = requests.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.current(), false);
  assert.equal(second.current(), true);
  requests.cancel();
  assert.equal(second.current(), false);
  assert.equal(second.signal.aborted, true);
});

test('debounce commits only latest snapshot at 300ms and cleanup cancels it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = [];
  const action = debounce((value) => values.push(value), 300);
  action.run('old');
  t.mock.timers.tick(200);
  action.run('new');
  t.mock.timers.tick(299);
  assert.deepEqual(values, []);
  t.mock.timers.tick(1);
  assert.deepEqual(values, ['new']);
  action.run('unmounted');
  action.cancel();
  t.mock.timers.tick(300);
  assert.deepEqual(values, ['new']);
});

test('first viewport publishes immediately and a layout resize keeps the current viewport until it settles', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let bounds = [98, 6, 101, 10];
  const published = [];
  const updates = createViewportUpdates(
    () => bounds,
    (box) => published.push(box),
  );

  updates.moveStart(true);
  updates.moveEnd();
  t.mock.timers.tick(600);
  assert.deepEqual(published, []);

  updates.ready();
  assert.deepEqual(published, [[98, 6, 101, 10]]);
  bounds = [98, 5, 101, 11];
  updates.moveStart(true);
  updates.moveEnd();
  t.mock.timers.tick(599);
  assert.deepEqual(published, [[98, 6, 101, 10]]);
  t.mock.timers.tick(1);
  assert.deepEqual(published, [
    [98, 6, 101, 10],
    [98, 5, 101, 11],
  ]);
});

test('camera movement invalidates immediately and publishes only after the last stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(VIEWPORT_DEBOUNCE_MS, 600);
  let bounds = [98, 6, 101, 10];
  const published = [];
  const updates = createViewportUpdates(
    () => bounds,
    (box) => published.push(box),
  );
  updates.ready();

  updates.moveStart(false);
  updates.moveEnd();
  assert.deepEqual(published, [[98, 6, 101, 10], null]);
  t.mock.timers.tick(400);
  updates.moveStart(false);
  t.mock.timers.tick(600);
  assert.deepEqual(published, [[98, 6, 101, 10], null, null]);

  bounds = [99, 6, 102, 10];
  updates.moveEnd();
  t.mock.timers.tick(599);
  assert.equal(published.length, 3);
  t.mock.timers.tick(1);
  assert.deepEqual(published.at(-1), bounds);
  updates.moveEnd();
  updates.cancel();
  t.mock.timers.tick(600);
  assert.equal(published.length, 4);
});

test('page size options: list asks for the chosen size, a new size or filter returns to page 1 and keeps the size', async () => {
  const { PAGE_SIZES, pageSizeState, pageCount } = await import('../src/lib/map-state.ts');
  assert.deepEqual([...PAGE_SIZES], [10, 20, 50, 100]);
  const base = { filters: { province: '', status: '', q: '' }, page: 3, pageSize: 20 };
  const bigger = pageSizeState(base, 50);
  assert.deepEqual(bigger, { ...base, page: 1, pageSize: 50 });
  assert.equal(new URLSearchParams(listQuery(bigger)).get('pageSize'), '50');
  assert.equal(filterState(bigger, { q: 'x' }).pageSize, 50, 'a filter change keeps the chosen size');
  for (const bad of [0, 7, 101, 1000, Number.NaN]) assert.throws(() => pageSizeState(base, bad));
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(30, 20), 2);
  assert.equal(pageCount(100, 50), 2);
  assert.equal(pageCount(101, 100), 2);
});
