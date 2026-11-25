import { fetchJson } from './http-client.ts';
import { snapBbox, type MemoryCache } from '../lib/map-cache.ts';
import { fetchMapLayer } from './map-cache-service.ts';
import { listQuery, mapQuery, type ListState, type Filters, type Bbox } from '../lib/map-state.ts';
import type { SiteFeature, SiteList, SitesGeoJSON } from '../lib/sites.ts';
const listKey = (state: ListState) => `/api/sites?${listQuery(state)}`;
const getKey = (code: string) => `/api/sites/${encodeURIComponent(code)}`;
const geojsonKey = (filters: Filters, bbox: Bbox) => `/api/sites.geojson?${mapQuery(filters, snapBbox(bbox))}`;
export const sitesService = {
  listKey,
  getKey,
  geojsonKey,
  list: (state: ListState, signal: AbortSignal) => fetchJson<SiteList>(listKey(state), signal),
  get: (code: string, signal: AbortSignal) => fetchJson<SiteFeature>(getKey(code), signal),
  geojson: (filters: Filters, bbox: Bbox, signal: AbortSignal, cache?: MemoryCache) =>
    fetchMapLayer<SitesGeoJSON>(geojsonKey(filters, bbox), signal, cache),
};
