import { toDependencyError } from '../errors';
import { DatabaseQuery } from '../health';
import { GeoJsonQuery, ListQuery, SiteFilters } from './query';

export interface SitesDatabase extends DatabaseQuery {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// BR-04: status uses the unrounded AVG of every survey on the site's latest survey day; computed on read, never cached.
const SITE_VIEW = `
  SELECT s.id, s.code, s.name, s.province_code, round(s.area_rai, 2)::float8 AS area_rai, s.version, s.geom,
    l.surveyed_on, round(l.average, 2)::float8 AS average_cover_percent, l.count,
    CASE WHEN l.average IS NULL THEN 'no_data' WHEN l.average >= 75 THEN 'very_good' WHEN l.average >= 50 THEN 'good'
         WHEN l.average >= 25 THEN 'fair' ELSE 'poor' END AS status
  FROM sites s
  LEFT JOIN LATERAL (
    SELECT to_char(v.surveyed_on, 'YYYY-MM-DD') AS surveyed_on, avg(v.cover_percent) AS average, count(*)::int AS count
    FROM surveys v
    WHERE v.site_id = s.id AND v.surveyed_on = (SELECT max(m.surveyed_on) FROM surveys m WHERE m.site_id = s.id)
    GROUP BY v.surveyed_on
  ) l ON true
  WHERE s.deleted_at IS NULL`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

function where(filters: SiteFilters, params: unknown[]) {
  const clauses: string[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  if (filters.province) clauses.push(`v.province_code = ${add(filters.province)}`);
  if (filters.status) clauses.push(`v.status = ${add(filters.status)}`);
  if (filters.q) {
    const pattern = add(`%${escapeLike(filters.q)}%`);
    clauses.push(`(v.code ILIKE ${pattern} ESCAPE '\\' OR v.name ILIKE ${pattern} ESCAPE '\\')`);
  }
  return clauses;
}

const summary = (r: Record<string, unknown>) => ({
  code: r.code, name: r.name, province_code: r.province_code, area_rai: r.area_rai, status: r.status, version: r.version,
});

const feature = (r: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: r.geometry,
  properties: {
    id: r.id, ...summary(r),
    latestSurvey: r.surveyed_on === null
      ? null
      : { surveyed_on: r.surveyed_on, average_cover_percent: r.average_cover_percent, count: r.count },
  },
});

export class SitesRepository {
  constructor(private readonly db: SitesDatabase) {}

  private async run(sql: string, params: unknown[]) {
    try { return (await this.db.query(sql, params)).rows; } catch (error) { throw toDependencyError(error); }
  }

  async list(query: ListQuery) {
    const params: unknown[] = [];
    const clauses = where(query, params);
    const filter = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [countRow] = await this.run(`SELECT count(*)::int AS total FROM (${SITE_VIEW}) v ${filter}`, params);
    // Two statements without a shared snapshot: under a concurrent write total and items may briefly disagree (accepted, read-only list).
    const rows = await this.run(
      `SELECT v.code, v.name, v.province_code, v.area_rai, v.status, v.version FROM (${SITE_VIEW}) v ${filter} ORDER BY v.code COLLATE "C" ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize]);
    return { items: rows.map(summary), total: countRow.total, page: query.page };
  }

  async geojson(query: GeoJsonQuery) {
    const params: unknown[] = [...query.bbox];
    const clauses = ['ST_Intersects(v.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))', ...where(query, params)];
    const rows = await this.run(
      `SELECT v.*, ST_AsGeoJSON(v.geom)::json AS geometry FROM (${SITE_VIEW}) v WHERE ${clauses.join(' AND ')} ORDER BY v.code COLLATE "C" ASC`, params);
    return { type: 'FeatureCollection', features: rows.map(feature) };
  }

  async byCode(code: string) {
    const [row] = await this.run(`SELECT v.*, ST_AsGeoJSON(v.geom)::json AS geometry FROM (${SITE_VIEW}) v WHERE v.code = $1`, [code]);
    return row ? feature(row) : null;
  }
}
