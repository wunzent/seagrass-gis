import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, Database } from '../core/database/database.module';
import { Queryable, withTransaction } from '../core/database/transaction';
import { toDependencyError } from '../shared/errors/api-error';
import { GeoJsonQuery } from '../sites/entities/site.entity';
import { SITE_VIEW, siteFilterClauses } from '../sites/sites.repository';
import { PageQuery, SurveyFields, SurveyRow } from './entities/survey.entity';

/** DI token: upper bound of GET /surveys.geojson features (newest first); tests may override the provider. */
export const SURVEY_POINTS_LIMIT = Symbol('SURVEY_POINTS_LIMIT');
/** Production value; beyond it the map must zoom in to see older points. */
export const DEFAULT_SURVEY_POINTS_LIMIT = 5000;

const POINT = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)';

// Survey columns as the serializer needs them; lon/lat are projections of geom (no duplicated storage).
const SURVEY_COLUMNS = `
  sv.id::text AS id, sv.site_id, st.code AS site_code, ST_X(sv.geom) AS lon, ST_Y(sv.geom) AS lat,
  to_char(sv.surveyed_on, 'YYYY-MM-DD') AS surveyed_on, sv.cover_percent::float8 AS cover_percent, sv.note,
  COALESCE((SELECT array_agg(ss.species_code ORDER BY ss.species_code COLLATE "C") FROM survey_species ss
            WHERE ss.survey_id = sv.id), '{}') AS species,
  u.id AS created_by_id, u.email AS created_by_email`;
const SURVEY_FROM = `surveys sv JOIN sites st ON st.id = sv.site_id JOIN users u ON u.id = sv.created_by`;

@Injectable()
export class SurveysRepository {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SURVEY_POINTS_LIMIT) private readonly pointsLimit: number,
  ) {}

  private async run(sql: string, params: unknown[]) {
    try {
      return (await this.db.query(sql, params)).rows;
    } catch (error) {
      throw toDependencyError(error);
    }
  }

  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    return withTransaction(this.db, work);
  }

  /** History of one site, newest day first, then newest id (index surveys_site_date_idx). */
  async pageBySite(siteId: string, query: PageQuery) {
    const [countRow] = await this.run('SELECT count(*)::int AS total FROM surveys WHERE site_id = $1', [siteId]);
    const rows = await this.run(
      `SELECT ${SURVEY_COLUMNS} FROM ${SURVEY_FROM} WHERE sv.site_id = $1
       ORDER BY sv.surveyed_on DESC, sv.id DESC LIMIT $2 OFFSET $3`,
      [siteId, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return { rows: rows as unknown as SurveyRow[], total: countRow.total as number };
  }

  /** Survey points inside the bbox whose active parent site matches the same filters as /sites.geojson. */
  async points(query: GeoJsonQuery) {
    const params: unknown[] = [...query.bbox];
    const clauses = [
      'ST_Intersects(sv.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))',
      ...siteFilterClauses(query, params),
    ];
    params.push(this.pointsLimit);
    const rows = await this.run(
      `SELECT ${SURVEY_COLUMNS} FROM ${SURVEY_FROM} JOIN (${SITE_VIEW}) v ON v.id = sv.site_id
       WHERE ${clauses.join(' AND ')} ORDER BY sv.surveyed_on DESC, sv.id DESC LIMIT $${params.length}`,
      params,
    );
    return rows as unknown as SurveyRow[];
  }

  async byId(tx: Queryable, id: string | number): Promise<SurveyRow> {
    const { rows } = await tx.query(`SELECT ${SURVEY_COLUMNS} FROM ${SURVEY_FROM} WHERE sv.id = $1`, [id]);
    return rows[0] as unknown as SurveyRow;
  }

  /** Unlocked first read: which site to lock before the survey row is re-read (lock order site → survey). */
  async siteIdOf(tx: Queryable, id: number): Promise<string | null> {
    const { rows } = await tx.query('SELECT site_id FROM surveys WHERE id = $1', [id]);
    return (rows[0]?.site_id as string | undefined) ?? null;
  }

  /** Re-read under the parent lock and lock the survey row, so concurrent PATCHes merge onto the latest values. */
  async lockOnSite(tx: Queryable, id: number, siteId: string): Promise<SurveyRow | null> {
    const { rows } = await tx.query('SELECT id FROM surveys WHERE id = $1 AND site_id = $2 FOR UPDATE', [id, siteId]);
    return rows.length ? this.byId(tx, id) : null;
  }

  /** Codes not present in the species lookup (case-sensitive, as stored). */
  async unknownSpecies(tx: Queryable, codes: string[]): Promise<string[]> {
    const { rows } = await tx.query(
      `SELECT c FROM unnest($1::text[]) AS c WHERE NOT EXISTS (SELECT 1 FROM species s WHERE s.code = c)`,
      [codes],
    );
    return rows.map((r) => r.c as string);
  }

  /** BR-05: point within 50 m (geography, metres) of the site polygon; inside counts as distance 0. */
  async isWithinSite(tx: Queryable, siteId: string, lon: number, lat: number): Promise<boolean> {
    const { rows } = await tx.query(
      `SELECT ST_DWithin(${POINT}::geography, s.geom::geography, 50) AS ok FROM sites s WHERE s.id = $3`,
      [lon, lat, siteId],
    );
    return rows[0]?.ok === true;
  }

  async insert(tx: Queryable, siteId: string, survey: SurveyFields, actorId: string): Promise<string> {
    const { rows } = await tx.query(
      `INSERT INTO surveys(site_id, geom, surveyed_on, cover_percent, note, created_by, updated_by)
       VALUES($3, ${POINT}, $4::date, $5, $6, $7, $7) RETURNING id::text AS id`,
      [survey.lon, survey.lat, siteId, survey.surveyed_on, survey.cover_percent, survey.note, actorId],
    );
    const id = rows[0].id as string;
    await this.replaceSpecies(tx, id, survey.species);
    return id;
  }

  async update(tx: Queryable, id: number, survey: SurveyFields, actorId: string, replaceSpecies: boolean) {
    await tx.query(
      `UPDATE surveys SET geom = ${POINT}, surveyed_on = $4::date, cover_percent = $5, note = $6,
         updated_by = $7, updated_at = now()
       WHERE id = $3`,
      [survey.lon, survey.lat, id, survey.surveyed_on, survey.cover_percent, survey.note, actorId],
    );
    if (replaceSpecies) await this.replaceSpecies(tx, String(id), survey.species);
  }

  private async replaceSpecies(tx: Queryable, id: string, species: string[]) {
    await tx.query('DELETE FROM survey_species WHERE survey_id = $1', [id]);
    await tx.query('INSERT INTO survey_species(survey_id, species_code) SELECT $1, unnest($2::text[])', [id, species]);
  }

  /** Hard delete (survey_species cascades); false when the survey is gone or no longer on the locked site. */
  async delete(tx: Queryable, id: number, siteId: string): Promise<boolean> {
    const result = await tx.query('DELETE FROM surveys WHERE id = $1 AND site_id = $2', [id, siteId]);
    return result.rowCount === 1;
  }
}
