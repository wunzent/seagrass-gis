import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { ApiError } from '../errors';
import { parseGeoJsonQuery, parseListQuery, parseSiteCode } from './query';
import { SitesRepository } from './repository';

export const SITES_REPOSITORY = Symbol('SITES_REPOSITORY');

// Public reads: no session is required and none is consulted yet; creator data is never part of these shapes.
@Controller()
export class SitesController {
  constructor(@Inject(SITES_REPOSITORY) private readonly sites: SitesRepository) {}

  @Get('sites')
  @Header('Cache-Control', 'no-store')
  list(@Query() query: Record<string, unknown>) {
    return this.sites.list(parseListQuery(query));
  }

  @Get('sites.geojson')
  @Header('Cache-Control', 'no-store')
  geojson(@Query() query: Record<string, unknown>) {
    return this.sites.geojson(parseGeoJsonQuery(query));
  }

  @Get('sites/:code')
  @Header('Cache-Control', 'no-store')
  async detail(@Param('code') code: string) {
    const site = await this.sites.byCode(parseSiteCode(code));
    if (!site) throw new ApiError(404, 'SITE_NOT_FOUND', 'ไม่พบแหล่งหญ้าทะเล');
    return site;
  }
}
