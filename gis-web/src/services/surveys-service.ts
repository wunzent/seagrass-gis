import { fetchJson } from './http-client.ts';
import { snapBbox, type MemoryCache } from '../lib/map-cache.ts';
import { fetchMapLayer } from './map-cache-service.ts';
import { mapQuery, ROUNDS_PAGE_SIZE, type Filters, type Bbox } from '../lib/map-state.ts';
import type { SurveyList, SurveysGeoJSON } from '../lib/sites.ts';
const historyKey = (code: string) =>
  `/api/sites/${encodeURIComponent(code)}/surveys?page=1&pageSize=${ROUNDS_PAGE_SIZE}`;
const geojsonKey = (filters: Filters, bbox: Bbox) => `/api/surveys.geojson?${mapQuery(filters, snapBbox(bbox))}`;
export const surveysService = {
  historyKey,
  geojsonKey,
  history: (code: string, signal: AbortSignal) => fetchJson<SurveyList>(historyKey(code), signal),
  geojson: (filters: Filters, bbox: Bbox, signal: AbortSignal, cache?: MemoryCache) =>
    fetchMapLayer<SurveysGeoJSON>(geojsonKey(filters, bbox), signal, cache),
};
