'use client';
import { useState, useSyncExternalStore } from 'react';
import { createExternalStore } from './external-store.ts';
import { type Filters, type ListState, type Bbox } from '../lib/map-state.ts';
import { parseMapUrl, type MapUrlState } from '../lib/map-url.ts';
import type {
  Survey,
  ProvinceCollection,
  SiteList,
  SitesGeoJSON,
  SurveysGeoJSON,
  SiteFeature,
  SurveyList,
} from '../lib/sites.ts';
import { createResourceStore } from './resource-store.ts';
import { createMemoryCache } from '../lib/map-cache.ts';
export type Popup = { kind: 'site'; code: string } | { kind: 'survey'; survey: Survey & { site_code: string } };
type MapState = {
  draft: Filters;
  state: ListState;
  bbox: Bbox | null;
  popup: Popup | null;
  view: MapUrlState['view'];
  selectedSite: string | null;
};
type Update<T> = T | ((previous: T) => T);
export function createMapStore(initial = parseMapUrl(new URLSearchParams())) {
  const layerCache = createMemoryCache();
  const store = createExternalStore<MapState>({
    ...restoredState(initial),
    bbox: null,
  });
  function restoredState({ list, site, view }: MapUrlState) {
    return {
      draft: list.filters,
      state: list,
      popup: site ? ({ kind: 'site', code: site } as const) : null,
      selectedSite: site,
      view,
    };
  }
  function clearOnFilterChange(previous: Filters, next: Filters) {
    if (previous.province !== next.province || previous.status !== next.status || previous.q !== next.q) {
      layerCache.clear();
    }
  }
  const setter =
    <K extends keyof MapState>(key: K) =>
    (update: Update<MapState[K]>) =>
      store.setState((previous) => {
        const next =
          typeof update === 'function' ? (update as (value: MapState[K]) => MapState[K])(previous[key]) : update;
        if (key === 'state') clearOnFilterChange(previous.state.filters, (next as ListState).filters);
        return Object.is(next, previous[key]) ? previous : { ...previous, [key]: next };
      });
  return {
    ...store,
    layerCache,
    resources: {
      provinces: createResourceStore<ProvinceCollection>(),
      list: createResourceStore<SiteList>(),
      sites: createResourceStore<SitesGeoJSON>(),
      surveys: createResourceStore<SurveysGeoJSON>(),
      detail: createResourceStore<SiteFeature>(),
      history: createResourceStore<SurveyList>(),
    },
    restoreUrl(url: MapUrlState) {
      store.setState((previous) => {
        clearOnFilterChange(previous.state.filters, url.list.filters);
        return { ...previous, ...restoredState(url) };
      });
    },
    selectSite(site: string | null) {
      store.setState((previous) => ({
        ...previous,
        selectedSite: site,
        popup: site ? { kind: 'site', code: site } : null,
      }));
    },
    setDraft: setter('draft'),
    setState: setter('state'),
    setBbox: setter('bbox'),
    setPopup: setter('popup'),
    setView: setter('view'),
  };
}
export function useMapStore(initial: MapUrlState) {
  const [store] = useState(() => createMapStore(initial));
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), ...store };
}
