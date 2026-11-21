import { Injectable } from '@nestjs/common';
import { toSiteFeature, toSiteSummary } from './entities/site.entity';
import { SitesRepository } from './sites.repository';
import { ApiError } from '../common/errors';
import { GeoJsonQuery, ListQuery } from './entities/site.entity';

@Injectable()
export class SitesService {
  constructor(private readonly sites: SitesRepository) {}

  async list(query: ListQuery) {
    const { rows, total } = await this.sites.list(query);
    return { items: rows.map(toSiteSummary), total, page: query.page };
  }

  async geojson(query: GeoJsonQuery) {
    return { type: 'FeatureCollection' as const, features: (await this.sites.geojson(query)).map(toSiteFeature) };
  }

  async detail(code: string) {
    const row = await this.sites.byCode(code);
    if (!row) throw new ApiError(404, 'SITE_NOT_FOUND', 'ไม่พบแหล่งหญ้าทะเล');
    return toSiteFeature(row);
  }
}
