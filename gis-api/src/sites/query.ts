import { ApiError, validationError } from '../errors';

export const SITE_STATUSES = ['very_good', 'good', 'fair', 'poor', 'no_data'] as const;
export type SiteStatus = typeof SITE_STATUSES[number];

export interface SiteFilters { province?: string; status?: SiteStatus; q?: string }
export interface ListQuery extends SiteFilters { page: number; pageSize: number }
export interface GeoJsonQuery extends SiteFilters { bbox: [number, number, number, number] }

type RawQuery = Record<string, unknown>;

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const POSITIVE_INT = /^[1-9]\d*$/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function single(query: RawQuery, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw validationError({ field: key, reason: 'must be a single value' });
  return value;
}

function rejectUnknown(query: RawQuery, allowed: string[]) {
  const unknown = Object.keys(query).filter(key => !allowed.includes(key));
  // Echo only a bounded sample of the rejected names.
  if (unknown.length) throw validationError({ unknown: unknown.slice(0, 10).map(key => key.slice(0, 64)) });
}

function filters(query: RawQuery): SiteFilters {
  const result: SiteFilters = {};
  const province = single(query, 'province');
  if (province !== undefined) {
    if (!/^[0-9A-Za-z]{1,2}$/.test(province)) throw validationError({ field: 'province' });
    result.province = province;
  }
  const status = single(query, 'status');
  if (status !== undefined) {
    if (!(SITE_STATUSES as readonly string[]).includes(status)) throw validationError({ field: 'status', allowed: SITE_STATUSES });
    result.status = status as SiteStatus;
  }
  const q = single(query, 'q');
  if (q !== undefined) {
    if (q.length > 100) throw validationError({ field: 'q', reason: 'max 100 characters' });
    // PostgreSQL text cannot hold NUL, and lone surrogates are not valid UTF-8; reject them as input errors, not 500s.
    if (q.includes('\u0000') || LONE_SURROGATE.test(q)) throw validationError({ field: 'q', reason: 'invalid characters' });
    if (q.length) result.q = q;
  }
  return result;
}

function positiveInt(query: RawQuery, key: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const raw = single(query, key);
  if (raw === undefined) return fallback;
  if (!POSITIVE_INT.test(raw) || Number(raw) > max) throw validationError({ field: key });
  return Number(raw);
}

export function parseListQuery(query: RawQuery): ListQuery {
  rejectUnknown(query, ['province', 'status', 'q', 'page', 'pageSize']);
  return { page: positiveInt(query, 'page', 1), pageSize: positiveInt(query, 'pageSize', 20, 100), ...filters(query) };
}

export function parseGeoJsonQuery(query: RawQuery): GeoJsonQuery {
  rejectUnknown(query, ['bbox', 'province', 'status', 'q']);
  const invalid = () => new ApiError(400, 'INVALID_BBOX', 'bbox ต้องเป็น minLon,minLat,maxLon,maxLat');
  let raw: string | undefined;
  try { raw = single(query, 'bbox'); } catch { throw invalid(); }
  const parts = raw?.split(',') ?? [];
  if (parts.length !== 4 || !parts.every(p => DECIMAL.test(p))) throw invalid();
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number);
  const lonOk = (v: number) => v >= -180 && v <= 180;
  const latOk = (v: number) => v >= -90 && v <= 90;
  if (![minLon, maxLon].every(lonOk) || ![minLat, maxLat].every(latOk) || minLon >= maxLon || minLat >= maxLat) throw invalid();
  return { bbox: [minLon, minLat, maxLon, maxLat], ...filters(query) };
}

export function parseSiteCode(code: string): string {
  // Codes are stored trimmed by the importer; whitespace-only or control characters can never match.
  if (code.length < 1 || code.length > 64 || !code.trim() || /[\u0000-\u001f\u007f]/.test(code)) throw validationError({ field: 'code' });
  return code;
}
