'use client';
import { useState, useSyncExternalStore } from 'react';
import { createExternalStore } from './external-store.ts';
import { emptyFilters, PAGE_SIZE, type Filters, type ListState, type Bbox } from '../lib/map-state.ts';
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
export type Popup = { kind: 'site'; code: string } | { kind: 'survey'; survey: Survey & { site_code: string } };
type MapState = { draft: Filters; state: ListState; bbox: Bbox | null; popup: Popup | null; view: 'map' | 'table' };
type Update<T> = T | ((previous: T) => T);
export function createMapStore() {
  const store = createExternalStore<MapState>({
    draft: emptyFilters,
    state: { filters: emptyFilters, page: 1, pageSize: PAGE_SIZE },
    bbox: null,
    popup: null,
    view: 'map',
  });
  const setter =
    <K extends keyof MapState>(key: K) =>
    (update: Update<MapState[K]>) =>
      store.setState((previous) => {
        const next =
          typeof update === 'function' ? (update as (value: MapState[K]) => MapState[K])(previous[key]) : update;
        return Object.is(next, previous[key]) ? previous : { ...previous, [key]: next };
      });
  return {
    ...store,
    resources: {
      provinces: createResourceStore<ProvinceCollection>(),
      list: createResourceStore<SiteList>(),
      sites: createResourceStore<SitesGeoJSON>(),
      surveys: createResourceStore<SurveysGeoJSON>(),
      detail: createResourceStore<SiteFeature>(),
      history: createResourceStore<SurveyList>(),
    },
    setDraft: setter('draft'),
    setState: setter('state'),
    setBbox: setter('bbox'),
    setPopup: setter('popup'),
    setView: setter('view'),
  };
}
export function useMapStore() {
  const [store] = useState(createMapStore);
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot), ...store };
}
