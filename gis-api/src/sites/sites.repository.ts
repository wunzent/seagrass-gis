import { Inject, Injectable } from '@nestjs/common';
import { SiteRow } from './entities/site.entity';
import { DATABASE, Database } from '../core/database/database.module';
import { Queryable, withTransaction } from '../core/database/transaction';
import { ApiError, toDependencyError } from '../shared/errors/api-error';
import { GeoJsonQuery, ListQuery, SiteFilters } from './entities/site.entity';

/** Input geometry as GeoJSON text; only shape-checked GeoJSON (BR-01/02) reaches PostGIS. */
const INPUT_GEOM = 'ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)';

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
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.province) clauses.push(`v.province_code = ${add(filters.province)}`);
  if (filters.status) clauses.push(`v.status = ${add(filters.status)}`);
  if (filters.q) {
    const pattern = add(`%${escapeLike(filters.q)}%`);
    clauses.push(`(v.code ILIKE ${pattern} ESCAPE '\\' OR v.name ILIKE ${pattern} ESCAPE '\\')`);
  }
  return clauses;
}

@Injectable()
export class SitesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async run(sql: string, params: unknown[]) {
    try {
      return (await this.db.query(sql, params)).rows;
    } catch (error) {
      throw toDependencyError(error);
    }
  }

  async list(query: ListQuery) {
    const params: unknown[] = [];
    const clauses = where(query, params);
    const filter = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const [countRow] = await this.run(`SELECT count(*)::int AS total FROM (${SITE_VIEW}) v ${filter}`, params);
    // Two statements without a shared snapshot: under a concurrent write total and items may briefly disagree (accepted, read-only list).
    const rows = await this.run(
      `SELECT v.code, v.name, v.province_code, v.area_rai, v.status, v.version FROM (${SITE_VIEW}) v ${filter} ORDER BY v.code COLLATE "C" ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { rows: rows as unknown as SiteRow[], total: countRow.total as number };
  }

  async geojson(query: GeoJsonQuery) {
    const params: unknown[] = [...query.bbox];
    const clauses = ['ST_Intersects(v.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))', ...where(query, params)];
    const rows = await this.run(
      `SELECT v.*, ST_AsGeoJSON(v.geom)::json AS geometry FROM (${SITE_VIEW}) v WHERE ${clauses.join(' AND ')} ORDER BY v.code COLLATE "C" ASC`,
      params,
    );
    return rows as unknown as SiteRow[];
  }

  async byCode(code: string) {
    const [row] = await this.run(
      `SELECT v.*, ST_AsGeoJSON(v.geom)::json AS geometry FROM (${SITE_VIEW}) v WHERE v.code = $1`,
      [code],
    );
    return (row as unknown as SiteRow | undefined) ?? null;
  }

  /** One transaction for a multi-step write; the callback receives the transaction client. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    return withTransaction(this.db, work);
  }

  /** BR-02 PostGIS checks, never repaired: valid, non-empty, positive geography area. */
  async isValidArea(tx: Queryable, geojson: string): Promise<boolean> {
    const { rows } = await tx.query(
      `SELECT ST_IsValid(g) AND NOT ST_IsEmpty(g) AND ST_Area(g::geography) > 0 AS ok FROM (SELECT ${INPUT_GEOM} AS g) q`,
      [geojson],
    );
    return rows[0].ok === true;
  }

  /**
   * BR-03: province with the largest positive geography intersection, tie → lowest code (byte order); area_rai is the
   * unrounded geography area / 1600. Null when no province has a positive-area intersection (OUTSIDE_COVERAGE).
   */
  async coverage(tx: Queryable, geojson: string): Promise<{ province_code: string; area_rai: number } | null> {
    const { rows } = await tx.query(
      `WITH input AS (SELECT ${INPUT_GEOM} AS g)
       SELECT p.code AS province_code, ST_Area(i.g::geography) / 1600 AS area_rai,
         ST_Area(ST_Intersection(p.geom::geography, i.g::geography)) AS covered
       FROM provinces p CROSS JOIN input i WHERE ST_Intersects(p.geom, i.g)
       ORDER BY covered DESC, p.code COLLATE "C" ASC LIMIT 1`,
      [geojson],
    );
    const [row] = rows;
    return row && Number(row.covered) > 0 ? { province_code: row.province_code, area_rai: row.area_rai } : null;
  }

  /** Inserts an active site; the partial unique index sites_active_code_idx decides duplicates (also under races). */
  async insert(
    tx: Queryable,
    site: { id: string; code: string; name: string; geojson: string; province_code: string; area_rai: number },
    actorId: string,
  ) {
    try {
      await tx.query(
        `INSERT INTO sites(id, code, name, province_code, geom, area_rai, created_by, updated_by)
         VALUES($2, $3, $4, $5, ST_Multi(${INPUT_GEOM}), $6, $7, $7)`,
        [site.geojson, site.id, site.code, site.name, site.province_code, site.area_rai, actorId],
      );
    } catch (error) {
      const e = error as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'sites_active_code_idx')
        throw new ApiError(409, 'DUPLICATE_CODE', 'มีแหล่งที่ใช้ code นี้อยู่แล้ว');
      throw error;
    }
  }

  /** Locks the active site row for the rest of the transaction; a concurrent soft delete makes it disappear (404). */
  async lockActive(tx: Queryable, code: string): Promise<{ id: string; version: number } | null> {
    const { rows } = await tx.query('SELECT id, version FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE', [
      code,
    ]);
    return (rows[0] as { id: string; version: number } | undefined) ?? null;
  }

  async featureById(tx: Queryable, id: string): Promise<SiteRow> {
    const { rows } = await tx.query(
      `SELECT v.*, ST_AsGeoJSON(v.geom)::json AS geometry FROM (${SITE_VIEW}) v WHERE v.id = $1`,
      [id],
    );
    return rows[0] as unknown as SiteRow;
  }

  /** Version-guarded update (BR-09); returns false when the guard matched no row. */
  async update(
    tx: Queryable,
    site: { id: string; version: number },
    change: { name?: string; geojson?: string; province_code?: string; area_rai?: number },
    actorId: string,
  ): Promise<boolean> {
    const result = await tx.query(
      `UPDATE sites SET name = COALESCE($4, name), geom = COALESCE(ST_Multi(${INPUT_GEOM}), geom),
         province_code = COALESCE($5, province_code), area_rai = COALESCE($6, area_rai),
         version = version + 1, updated_by = $7, updated_at = now()
       WHERE id = $2 AND version = $3 AND deleted_at IS NULL`,
      [
        change.geojson ?? null,
        site.id,
        site.version,
        change.name ?? null,
        change.province_code ?? null,
        change.area_rai ?? null,
        actorId,
      ],
    );
    return result.rowCount === 1;
  }

  async hasSurveys(tx: Queryable, id: string): Promise<boolean> {
    const { rows } = await tx.query('SELECT EXISTS (SELECT 1 FROM surveys WHERE site_id = $1) AS found', [id]);
    return rows[0].found === true;
  }

  async softDelete(tx: Queryable, id: string, actorId: string) {
    await tx.query('UPDATE sites SET deleted_at = now(), updated_by = $2, updated_at = now() WHERE id = $1', [
      id,
      actorId,
    ]);
  }
}
