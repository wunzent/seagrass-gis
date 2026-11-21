import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorResponse, ref } from '../common/openapi-schemas';
import { SITE_STATUSES } from './site.model';
import { SitesService } from './sites.service';
import { GeoJsonQuery, ListQuery, ParseGeoJsonQueryPipe, ParseListQueryPipe, ParseSiteCodePipe } from './pipes/sites-query.pipes';

// Public reads: anonymous and authenticated callers get the same shapes (no creator fields on sites).
const FILTERS = [
  ApiQuery({ name: 'province', required: false, schema: { type: 'string', pattern: '^[0-9A-Za-z]{1,2}$' } }),
  ApiQuery({ name: 'status', required: false, schema: { type: 'string', enum: [...SITE_STATUSES] } }),
  ApiQuery({ name: 'q', required: false, description: 'ค้นหา code/name แบบ literal substring ไม่สนตัวพิมพ์', schema: { type: 'string', maxLength: 100 } }),
];
const applyAll = (...decorators: MethodDecorator[]): MethodDecorator => (target, key, descriptor) => { for (const d of decorators) d(target, key, descriptor); };

@ApiTags('sites')
@ApiResponse(errorResponse(503, ['SERVICE_UNAVAILABLE']))
@Controller()
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get('sites')
  @ApiOperation({ summary: 'รายการแหล่งหญ้าทะเลที่ใช้งาน (ไม่มี geometry) เรียง code' })
  @applyAll(...FILTERS)
  @ApiQuery({ name: 'page', required: false, schema: { type: 'integer', minimum: 1, default: 1 } })
  @ApiQuery({ name: 'pageSize', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } })
  @ApiResponse({ status: 200, schema: ref('SitesPage') })
  @ApiResponse(errorResponse(400, ['VALIDATION_ERROR']))
  @Header('Cache-Control', 'no-store')
  list(@Query(ParseListQueryPipe) query: ListQuery) {
    return this.sites.list(query);
  }

  @Get('sites.geojson')
  @ApiOperation({ summary: 'แหล่งที่ตัดกับ bbox ของแผนที่ (ไม่มี paging)' })
  @ApiQuery({ name: 'bbox', required: true, description: 'minLon,minLat,maxLon,maxLat', schema: { type: 'string', example: '99,7,100,8' } })
  @applyAll(...FILTERS)
  @ApiResponse({ status: 200, schema: ref('SiteFeatureCollection') })
  @ApiResponse(errorResponse(400, ['INVALID_BBOX', 'VALIDATION_ERROR']))
  @Header('Cache-Control', 'no-store')
  geojson(@Query(ParseGeoJsonQueryPipe) query: GeoJsonQuery) {
    return this.sites.geojson(query);
  }

  @Get('sites/:code')
  @ApiOperation({ summary: 'รายละเอียดแหล่งพร้อมสรุปวันสำรวจล่าสุด' })
  @ApiParam({ name: 'code', schema: { type: 'string', maxLength: 64 } })
  @ApiResponse({ status: 200, schema: ref('SiteFeature') })
  @ApiResponse(errorResponse(400, ['VALIDATION_ERROR']))
  @ApiResponse(errorResponse(404, ['SITE_NOT_FOUND']))
  @Header('Cache-Control', 'no-store')
  detail(@Param('code', ParseSiteCodePipe) code: string) {
    return this.sites.detail(code);
  }
}
