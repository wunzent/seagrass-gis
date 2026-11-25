import { Injectable } from '@nestjs/common';
import { SessionUser } from '../auth/entities/user.entity';
import { Queryable } from '../core/database/transaction';
import { ApiError, validationError } from '../shared/errors/api-error';
import { isSurveyDate } from '../shared/validators/geometry.validator';
import { GeoJsonQuery } from '../sites/entities/site.entity';
import { SitesRepository } from '../sites/sites.repository';
import { CreatedSurveyResponseDto } from './dto/created-survey.response.dto';
import { SurveyFeatureCollectionResponseDto } from './dto/survey-feature-collection.response.dto';
import { SurveyFeatureResponseDto } from './dto/survey-feature.response.dto';
import { SurveyResponseDto } from './dto/survey.response.dto';
import { SurveysPageResponseDto } from './dto/surveys-page.response.dto';
import { CreateSurvey, PageQuery, SurveyFields, UpdateSurvey } from './entities/survey.entity';
import { SurveysRepository } from './surveys.repository';

const siteNotFound = () => new ApiError(404, 'SITE_NOT_FOUND', 'ไม่พบแหล่งหญ้าทะเล');
const surveyNotFound = () => new ApiError(404, 'SURVEY_NOT_FOUND', 'ไม่พบข้อมูลการสำรวจ');
const outsideSite = () =>
  new ApiError(422, 'OUTSIDE_SITE', 'จุดสำรวจต้องอยู่ในแหล่งหรือห่างจากขอบแหล่งไม่เกิน 50 เมตร');

/** Writes run after RolesGuard and DTO validation; per transaction: lock parent site FOR SHARE 404 → re-read survey 404 →
 * merged record 400 → unknown species 400 → 50 m 422 → write. Status (BR-04) is computed on read, never stored. */
@Injectable()
export class SurveysService {
  constructor(
    private readonly surveys: SurveysRepository,
    private readonly sites: SitesRepository,
  ) {}

  async history(code: string, query: PageQuery, withCreator: boolean): Promise<SurveysPageResponseDto> {
    const siteId = await this.sites.activeIdByCode(code);
    if (!siteId) throw siteNotFound();
    const { rows, total } = await this.surveys.pageBySite(siteId, query);
    return { items: rows.map((r) => SurveyResponseDto.fromRow(r, withCreator)), total, page: query.page };
  }

  async points(query: GeoJsonQuery, withCreator: boolean): Promise<SurveyFeatureCollectionResponseDto> {
    const rows = await this.surveys.points(query);
    return { type: 'FeatureCollection', features: rows.map((r) => SurveyFeatureResponseDto.fromRow(r, withCreator)) };
  }

  /** BR-05 on the complete record (after a PATCH merge too); species and distance need the database. */
  private async check(tx: Queryable, siteId: string, survey: SurveyFields, speciesChanged: boolean) {
    const fields = [
      ...(isSurveyDate(survey.surveyed_on) ? [] : ['surveyed_on']),
      ...(survey.cover_percent >= 0 && survey.cover_percent <= 100 ? [] : ['cover_percent']),
    ];
    if (fields.length) throw validationError({ fields });
    if (speciesChanged && (await this.surveys.unknownSpecies(tx, survey.species)).length)
      throw validationError({ fields: ['species'], reason: 'unknown species code' });
    if (!(await this.surveys.isWithinSite(tx, siteId, survey.lon, survey.lat))) throw outsideSite();
  }

  async create(code: string, input: CreateSurvey, actor: SessionUser): Promise<CreatedSurveyResponseDto> {
    return this.surveys.transaction(async (tx) => {
      const site = await this.sites.shareLockActive(tx, { code });
      if (!site) throw siteNotFound();
      await this.check(tx, site.id, input, true);
      const id = await this.surveys.insert(tx, site.id, input, actor.id);
      const { status } = await this.sites.featureById(tx, site.id);
      return { ...SurveyResponseDto.fromRow(await this.surveys.byId(tx, id), true), siteStatus: status };
    });
  }

  /** Lock order everywhere: parent site, then survey row; the survey is re-read after the parent lock. */
  private async lockSurvey(tx: Queryable, id: number) {
    const siteId = await this.surveys.siteIdOf(tx, id);
    const site = siteId ? await this.sites.shareLockActive(tx, { id: siteId }) : null;
    if (!site) throw surveyNotFound();
    return site;
  }

  async update(id: number, change: UpdateSurvey, actor: SessionUser): Promise<CreatedSurveyResponseDto> {
    return this.surveys.transaction(async (tx) => {
      const site = await this.lockSurvey(tx, id);
      const current = await this.surveys.lockOnSite(tx, id, site.id);
      if (!current) throw surveyNotFound();
      const merged: SurveyFields = {
        lon: change.lon ?? current.lon,
        lat: change.lat ?? current.lat,
        surveyed_on: change.surveyed_on ?? current.surveyed_on,
        cover_percent: change.cover_percent ?? current.cover_percent,
        species: change.species ?? current.species,
        note: change.note !== undefined ? change.note : current.note,
      };
      await this.check(tx, site.id, merged, change.species !== undefined);
      await this.surveys.update(tx, id, merged, actor.id, change.species !== undefined);
      const { status } = await this.sites.featureById(tx, site.id);
      return { ...SurveyResponseDto.fromRow(await this.surveys.byId(tx, id), true), siteStatus: status };
    });
  }

  async remove(id: number): Promise<void> {
    await this.surveys.transaction(async (tx) => {
      const site = await this.lockSurvey(tx, id);
      if (!(await this.surveys.delete(tx, id, site.id))) throw surveyNotFound();
    });
  }
}
