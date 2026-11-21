import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../shared/decorators/api-error-response.decorator';
import { SitesService } from './sites.service';
import { ListSitesQueryDto } from './dto/list-sites.query.dto';
import { SiteCodeParamsDto } from './dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from './dto/sites-geojson.query.dto';
import { SiteFeatureCollectionResponseDto } from './dto/site-feature-collection.response.dto';
import { SiteFeatureResponseDto } from './dto/site-feature.response.dto';
import { SitesPageResponseDto } from './dto/sites-page.response.dto';

// Public reads: anonymous and authenticated callers get the same shapes (no creator fields on sites).
@ApiTags('sites')
@ApiErrorResponse(503, ['SERVICE_UNAVAILABLE'])
@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get('sites')
  @ApiOperation({ summary: 'รายการแหล่งหญ้าทะเลที่ใช้งาน (ไม่มี geometry) เรียง code' })
  @ApiOkResponse({ type: SitesPageResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ListSitesQueryDto): Promise<SitesPageResponseDto> {
    return this.sites.list(query.toListQuery());
  }

  @Get('sites.geojson')
  @ApiOperation({ summary: 'แหล่งที่ตัดกับ bbox ของแผนที่ (ไม่มี paging)' })
  @ApiOkResponse({ type: SiteFeatureCollectionResponseDto })
  @ApiErrorResponse(400, ['INVALID_BBOX', 'VALIDATION_ERROR'])
  @Header('Cache-Control', 'no-store')
  geojson(@Query() query: SitesGeoJsonQueryDto): Promise<SiteFeatureCollectionResponseDto> {
    return this.sites.geojson(query.toGeoJsonQuery());
  }

  @Get('sites/:code')
  @ApiOperation({ summary: 'รายละเอียดแหล่งพร้อมสรุปวันสำรวจล่าสุด' })
  @ApiOkResponse({ type: SiteFeatureResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(404, ['SITE_NOT_FOUND'])
  @Header('Cache-Control', 'no-store')
  detail(@Param() params: SiteCodeParamsDto): Promise<SiteFeatureResponseDto> {
    return this.sites.detail(params.code);
  }
}
