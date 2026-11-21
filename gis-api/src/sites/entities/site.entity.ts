export const SITE_STATUSES = ['very_good', 'good', 'fair', 'poor', 'no_data'] as const;
export type SiteStatus = (typeof SITE_STATUSES)[number];

/** Validated read criteria (built by the DTOs); repositories and services depend on these, not on HTTP input classes. */
export interface SiteFilters {
  province?: string;
  status?: SiteStatus;
  q?: string;
}
export interface ListQuery extends SiteFilters {
  page: number;
  pageSize: number;
}
export interface GeoJsonQuery extends SiteFilters {
  bbox: [number, number, number, number];
}

/** Row shape returned by SitesRepository (computed status and latest-day aggregate included). */
export interface SiteRow {
  id: string;
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  status: SiteStatus;
  version: number;
  surveyed_on: string | null;
  average_cover_percent: number | null;
  count: number | null;
  geometry?: unknown;
}

/** GeoJSON MultiPolygon after the BR-01/02 shape check (Polygon input is wrapped, never repaired). */
export interface MultiPolygonGeometry {
  type: string;
  coordinates: unknown;
}
/** Validated POST /sites input; computed fields come from PostGIS. */
export interface CreateSite {
  code: string;
  name: string;
  geometry: MultiPolygonGeometry;
}
/** Validated PATCH /sites/:code input. */
export interface UpdateSite {
  version: number;
  name?: string;
  geometry?: MultiPolygonGeometry;
}
