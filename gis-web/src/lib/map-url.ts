import { emptyFilters, filterState, PAGE_SIZE, pageSizeState, type ListState } from './map-state.ts';

export type MapUrlState = {
  list: ListState;
  site: string | null;
  view: 'map' | 'table';
};

function positiveInteger(value: string | null) {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function parseMapUrl(query: Pick<URLSearchParams, 'get'>): MapUrlState {
  let list: ListState = { filters: emptyFilters, page: 1, pageSize: PAGE_SIZE };
  for (const key of ['province', 'status', 'q'] as const) {
    const value = query.get(key);
    if (!value) continue;
    try {
      list = filterState(list, { [key]: value });
    } catch {
      // Each field is optional. Keep the valid fields in a partially invalid link.
    }
  }
  try {
    list = pageSizeState(list, positiveInteger(query.get('pageSize')) ?? PAGE_SIZE);
  } catch {
    // Keep the default page size.
  }
  const site = query.get('site');
  // Match the API's path-code length and character rules. Dot segments cannot address a site.
  const validSite =
    site &&
    site.length <= 64 &&
    /\S/.test(site) &&
    !/[\u0000-\u001f\u007f]/.test(site) &&
    site !== '.' &&
    site !== '..';
  return {
    list: { ...list, page: positiveInteger(query.get('page')) ?? 1 },
    site: validSite ? site : null,
    view: query.get('view') === 'table' ? 'table' : 'map',
  };
}

export function serializeMapUrl({ list, site, view }: MapUrlState) {
  const query = new URLSearchParams();
  for (const key of ['province', 'status', 'q'] as const) {
    if (list.filters[key]) query.set(key, list.filters[key]);
  }
  if (site) query.set('site', site);
  if (view !== 'map') query.set('view', view);
  if (list.page !== 1) query.set('page', String(list.page));
  if (list.pageSize !== PAGE_SIZE) query.set('pageSize', String(list.pageSize));
  return query;
}
