export const SITE_STATUSES = ['very_good', 'good', 'fair', 'poor', 'no_data'] as const;
export type SiteStatus = typeof SITE_STATUSES[number];

/** Validated read criteria (built by the DTOs); repositories and services depend on these, not on HTTP input classes. */
export interface SiteFilters { province?: string; status?: SiteStatus; q?: string }
export interface ListQuery extends SiteFilters { page: number; pageSize: number }
export interface GeoJsonQuery extends SiteFilters { bbox: [number, number, number, number] }

/** Row shape returned by SitesRepository (computed status and latest-day aggregate included). */
export interface SiteRow {
  id: string; code: string; name: string; province_code: string; area_rai: number; status: SiteStatus; version: number;
  surveyed_on: string | null; average_cover_percent: number | null; count: number | null; geometry?: unknown;
}

export interface SiteSummary { code: string; name: string; province_code: string; area_rai: number; status: SiteStatus; version: number }
export interface LatestSurvey { surveyed_on: string; average_cover_percent: number; count: number }
export interface SiteFeature {
  type: 'Feature';
  geometry: unknown;
  properties: SiteSummary & { id: string; latestSurvey: LatestSurvey | null };
}

export const toSiteSummary = (r: SiteRow): SiteSummary => ({
  code: r.code, name: r.name, province_code: r.province_code, area_rai: r.area_rai, status: r.status, version: r.version,
});

export const toSiteFeature = (r: SiteRow): SiteFeature => ({
  type: 'Feature',
  geometry: r.geometry,
  properties: {
    id: r.id, ...toSiteSummary(r),
    latestSurvey: r.surveyed_on === null
      ? null
      : { surveyed_on: r.surveyed_on, average_cover_percent: r.average_cover_percent!, count: r.count! },
  },
});
