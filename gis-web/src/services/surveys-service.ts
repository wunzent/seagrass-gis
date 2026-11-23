import { fetchJson } from './http-client.ts';
import { mapQuery, ROUNDS_PAGE_SIZE, type Filters, type Bbox } from '../lib/map-state.ts';
import type { SurveyList, SurveysGeoJSON } from '../lib/sites.ts';
const historyKey = (code: string) =>
  `/api/sites/${encodeURIComponent(code)}/surveys?page=1&pageSize=${ROUNDS_PAGE_SIZE}`;
const geojsonKey = (filters: Filters, bbox: Bbox) => `/api/surveys.geojson?${mapQuery(filters, bbox)}`;
export const surveysService = {
  historyKey,
  geojsonKey,
  history: (code: string, signal: AbortSignal) => fetchJson<SurveyList>(historyKey(code), signal),
  geojson: (filters: Filters, bbox: Bbox, signal: AbortSignal) =>
    fetchJson<SurveysGeoJSON>(geojsonKey(filters, bbox), signal),
};
