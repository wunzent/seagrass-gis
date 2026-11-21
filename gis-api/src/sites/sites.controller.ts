import { Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FieldRoles, Roles } from '../auth/decorators/roles.decorator';
import { ApiCsrfHeaders } from '../shared/decorators/api-csrf-headers.decorator';
import { ApiErrorResponse } from '../shared/decorators/api-error-response.decorator';
import { JsonBody } from '../shared/decorators/json-body.decorator';
import type { HttpRequest } from '../shared/types/http.types';
import { SitesService } from './sites.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { ListSitesQueryDto } from './dto/list-sites.query.dto';
import { SiteCodeParamsDto } from './dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from './dto/sites-geojson.query.dto';
import { SiteFeatureCollectionResponseDto } from './dto/site-feature-collection.response.dto';
import { SiteFeatureResponseDto } from './dto/site-feature.response.dto';
import { SitesPageResponseDto } from './dto/sites-page.response.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

/** RolesGuard ran (401 → 403 → CSRF) before any handler marked @Roles, so the actor is always present there. */
const actorOf = (request: HttpRequest) => request.auth!.user;

// Public reads: anonymous and authenticated callers get the same shapes (no creator fields on sites).
// Writes: @Roles marks them protected; RolesGuard enforces 401 → 403 (incl. @FieldRoles) → CSRF before DTO validation.
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

  @Post('sites')
  @Roles('admin')
  @ApiOperation({ summary: 'สร้างแหล่ง (admin): คำนวณ province_code และ area_rai จาก geometry, version 1' })
  @ApiCookieAuth('gis_access')
  @ApiCsrfHeaders()
  @ApiBody({ type: CreateSiteDto })
  @ApiCreatedResponse({ type: SiteFeatureResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR', 'INVALID_GEOMETRY'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(409, ['DUPLICATE_CODE'])
  @ApiErrorResponse(422, ['OUTSIDE_COVERAGE'])
  @Header('Cache-Control', 'no-store')
  create(@Req() request: HttpRequest, @JsonBody() body: CreateSiteDto): Promise<SiteFeatureResponseDto> {
    return this.sites.create(body.toCreateSite(), actorOf(request));
  }

  @Patch('sites/:code')
  @Roles('editor', 'admin')
  @FieldRoles({ geometry: ['admin'] })
  @ApiOperation({
    summary: 'แก้ไขแหล่งด้วย version ปัจจุบัน (editor แก้ name; admin แก้ name/geometry); สำเร็จแล้ว version+1',
  })
  @ApiCookieAuth('gis_access')
  @ApiCsrfHeaders()
  @ApiBody({ type: UpdateSiteDto })
  @ApiOkResponse({ type: SiteFeatureResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR', 'INVALID_GEOMETRY'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(404, ['SITE_NOT_FOUND'])
  @ApiErrorResponse(409, ['VERSION_CONFLICT'])
  @ApiErrorResponse(422, ['OUTSIDE_COVERAGE'])
  @Header('Cache-Control', 'no-store')
  update(
    @Req() request: HttpRequest,
    @Param() params: SiteCodeParamsDto,
    @JsonBody() body: UpdateSiteDto,
  ): Promise<SiteFeatureResponseDto> {
    return this.sites.update(params.code, body.toUpdateSite(), actorOf(request));
  }

  @Delete('sites/:code')
  @Roles('admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบแหล่งแบบ soft delete (admin) เมื่อไม่มีข้อมูลการสำรวจ' })
  @ApiCookieAuth('gis_access')
  @ApiCsrfHeaders()
  @ApiNoContentResponse({ description: 'No content' })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(404, ['SITE_NOT_FOUND'])
  @ApiErrorResponse(409, ['SITE_HAS_SURVEYS'])
  @Header('Cache-Control', 'no-store')
  async remove(@Req() request: HttpRequest, @Param() params: SiteCodeParamsDto): Promise<void> {
    await this.sites.remove(params.code, actorOf(request));
  }
}
