import { Injectable } from '@nestjs/common';
import { SitesRepository } from './sites.repository';
import { ApiError } from '../shared/errors/api-error';
import { GeoJsonQuery, ListQuery } from './entities/site.entity';
import { SiteFeatureCollectionResponseDto } from './dto/site-feature-collection.response.dto';
import { SiteFeatureResponseDto } from './dto/site-feature.response.dto';
import { SiteSummaryResponseDto } from './dto/site-summary.response.dto';
import { SitesPageResponseDto } from './dto/sites-page.response.dto';

@Injectable()
export class SitesService {
  constructor(private readonly sites: SitesRepository) {}

  async list(query: ListQuery): Promise<SitesPageResponseDto> {
    const { rows, total } = await this.sites.list(query);
    return { items: rows.map(SiteSummaryResponseDto.fromRow), total, page: query.page };
  }

  async geojson(query: GeoJsonQuery): Promise<SiteFeatureCollectionResponseDto> {
    return { type: 'FeatureCollection' as const, features: (await this.sites.geojson(query)).map(SiteFeatureResponseDto.fromRow) };
  }

  async detail(code: string): Promise<SiteFeatureResponseDto> {
    const row = await this.sites.byCode(code);
    if (!row) throw new ApiError(404, 'SITE_NOT_FOUND', 'ไม่พบแหล่งหญ้าทะเล');
    return SiteFeatureResponseDto.fromRow(row);
  }
}
