import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SitesRepository } from './sites.repository';
import { Queryable } from '../core/database/transaction';
import { ApiError, invalidGeometry } from '../shared/errors/api-error';
import { SessionUser } from '../auth/entities/user.entity';
import { CreateSite, GeoJsonQuery, ListQuery, MultiPolygonGeometry, UpdateSite } from './entities/site.entity';
import { SiteFeatureCollectionResponseDto } from './dto/site-feature-collection.response.dto';
import { SiteFeatureResponseDto } from './dto/site-feature.response.dto';
import { SiteSummaryResponseDto } from './dto/site-summary.response.dto';
import { SitesPageResponseDto } from './dto/sites-page.response.dto';

const notFound = () => new ApiError(404, 'SITE_NOT_FOUND', 'ไม่พบแหล่งหญ้าทะเล');
const outsideCoverage = () =>
  new ApiError(422, 'OUTSIDE_COVERAGE', 'แหล่งต้องมีพื้นที่ซ้อนทับกับจังหวัดในระบบอย่างน้อยหนึ่งจังหวัด');

/**
 * Writes run after RolesGuard (401 → 403 → CSRF) and DTO validation. Inside one transaction the order is:
 * PostGIS geometry validity 400 → (PATCH/DELETE) lock active row 404 → version 409 / surveys 409 → coverage 422 → write.
 */
@Injectable()
export class SitesService {
  constructor(private readonly sites: SitesRepository) {}

  async list(query: ListQuery): Promise<SitesPageResponseDto> {
    const { rows, total } = await this.sites.list(query);
    return { items: rows.map(SiteSummaryResponseDto.fromRow), total, page: query.page };
  }

  async geojson(query: GeoJsonQuery): Promise<SiteFeatureCollectionResponseDto> {
    return {
      type: 'FeatureCollection' as const,
      features: (await this.sites.geojson(query)).map(SiteFeatureResponseDto.fromRow),
    };
  }

  async detail(code: string): Promise<SiteFeatureResponseDto> {
    const row = await this.sites.byCode(code);
    if (!row) throw notFound();
    return SiteFeatureResponseDto.fromRow(row);
  }

  private async placed(tx: Queryable, geometry: MultiPolygonGeometry) {
    const geojson = JSON.stringify(geometry);
    if (!(await this.sites.isValidArea(tx, geojson))) throw invalidGeometry();
    return { geojson, coverage: () => this.sites.coverage(tx, geojson) };
  }

  async create(input: CreateSite, actor: SessionUser): Promise<SiteFeatureResponseDto> {
    return this.sites.transaction(async (tx) => {
      const { geojson, coverage } = await this.placed(tx, input.geometry);
      const covered = await coverage();
      if (!covered) throw outsideCoverage();
      const id = randomUUID();
      await this.sites.insert(tx, { id, code: input.code, name: input.name, geojson, ...covered }, actor.id);
      return SiteFeatureResponseDto.fromRow(await this.sites.featureById(tx, id));
    });
  }

  async update(code: string, input: UpdateSite, actor: SessionUser): Promise<SiteFeatureResponseDto> {
    return this.sites.transaction(async (tx) => {
      const placed = input.geometry ? await this.placed(tx, input.geometry) : null;
      const site = await this.sites.lockActive(tx, code);
      if (!site) throw notFound();
      const conflict = async () =>
        new ApiError(409, 'VERSION_CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว', {
          current: SiteFeatureResponseDto.fromRow(await this.sites.featureById(tx, site.id)),
        });
      if (site.version !== input.version) throw await conflict();
      const covered = placed ? await placed.coverage() : null;
      if (placed && !covered) throw outsideCoverage();
      const change = { name: input.name, ...(placed ? { geojson: placed.geojson, ...covered } : {}) };
      if (!(await this.sites.update(tx, site, change, actor.id))) throw await conflict();
      return SiteFeatureResponseDto.fromRow(await this.sites.featureById(tx, site.id));
    });
  }

  async remove(code: string, actor: SessionUser): Promise<void> {
    await this.sites.transaction(async (tx) => {
      const site = await this.sites.lockActive(tx, code);
      if (!site) throw notFound();
      if (await this.sites.hasSurveys(tx, site.id))
        throw new ApiError(409, 'SITE_HAS_SURVEYS', 'ลบแหล่งที่มีข้อมูลการสำรวจไม่ได้');
      await this.sites.softDelete(tx, site.id, actor.id);
    });
  }
}
