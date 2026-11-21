import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorResponse, ref } from '../common/openapi-schemas';
import { SitesService } from './sites.service';
import { ListSitesQueryDto } from './dto/list-sites.query.dto';
import { SiteCodeParamsDto } from './dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from './dto/sites-geojson.query.dto';

// Public reads: anonymous and authenticated callers get the same shapes (no creator fields on sites).
@ApiTags('sites')
@ApiResponse(errorResponse(503, ['SERVICE_UNAVAILABLE']))
@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get('sites')
  @ApiOperation({ summary: 'รายการแหล่งหญ้าทะเลที่ใช้งาน (ไม่มี geometry) เรียง code' })
  @ApiResponse({ status: 200, schema: ref('SitesPage') })
  @ApiResponse(errorResponse(400, ['VALIDATION_ERROR']))
  @Header('Cache-Control', 'no-store')
  list(@Query() query: ListSitesQueryDto) {
    return this.sites.list(query.toListQuery());
  }

  @Get('sites.geojson')
  @ApiOperation({ summary: 'แหล่งที่ตัดกับ bbox ของแผนที่ (ไม่มี paging)' })
  @ApiResponse({ status: 200, schema: ref('SiteFeatureCollection') })
  @ApiResponse(errorResponse(400, ['INVALID_BBOX', 'VALIDATION_ERROR']))
  @Header('Cache-Control', 'no-store')
  geojson(@Query() query: SitesGeoJsonQueryDto) {
    return this.sites.geojson(query.toGeoJsonQuery());
  }

  @Get('sites/:code')
  @ApiOperation({ summary: 'รายละเอียดแหล่งพร้อมสรุปวันสำรวจล่าสุด' })
  @ApiResponse({ status: 200, schema: ref('SiteFeature') })
  @ApiResponse(errorResponse(400, ['VALIDATION_ERROR']))
  @ApiResponse(errorResponse(404, ['SITE_NOT_FOUND']))
  @Header('Cache-Control', 'no-store')
  detail(@Param() params: SiteCodeParamsDto) {
    return this.sites.detail(params.code);
  }
}
