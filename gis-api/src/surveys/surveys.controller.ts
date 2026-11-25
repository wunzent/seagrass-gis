import { Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ApiCsrfHeaders } from '../shared/decorators/api-csrf-headers.decorator';
import { ApiErrorResponse } from '../shared/decorators/api-error-response.decorator';
import { JsonBody } from '../shared/decorators/json-body.decorator';
import type { HttpRequest } from '../shared/types/http.types';
import { SiteCodeParamsDto } from '../sites/dto/site-code.params.dto';
import { SitesGeoJsonQueryDto } from '../sites/dto/sites-geojson.query.dto';
import { CreateSurveyDto } from './dto/create-survey.dto';
import { CreatedSurveyResponseDto } from './dto/created-survey.response.dto';
import { ListSurveysQueryDto } from './dto/list-surveys.query.dto';
import { SurveyFeatureCollectionResponseDto } from './dto/survey-feature-collection.response.dto';
import { SurveyIdParamsDto } from './dto/survey-id.params.dto';
import { SurveysPageResponseDto } from './dto/surveys-page.response.dto';
import { UpdateSurveyDto } from './dto/update-survey.dto';
import { SurveysService } from './surveys.service';

/** RolesGuard ran (401 → 403 → CSRF) before any handler marked @Roles, so the actor is always present there. */
const actorOf = (request: HttpRequest) => request.auth!.user;
/** created_by is shown to any authenticated role; an anonymous or unusable cookie (request.auth null) never sees it. */
const isAuthenticated = (request: HttpRequest) => Boolean(request.auth);

// Responses depend on the caller's identity (created_by), so every route is Cache-Control: no-store.
@ApiTags('surveys')
@ApiErrorResponse(503, ['SERVICE_UNAVAILABLE'])
@Controller()
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('sites/:code/surveys')
  @ApiOperation({ summary: 'ประวัติการสำรวจของแหล่ง เรียง surveyed_on DESC, id DESC (created_by เฉพาะผู้ login)' })
  @ApiOkResponse({ type: SurveysPageResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(404, ['SITE_NOT_FOUND'])
  @Header('Cache-Control', 'no-store')
  history(
    @Req() request: HttpRequest,
    @Param() params: SiteCodeParamsDto,
    @Query() query: ListSurveysQueryDto,
  ): Promise<SurveysPageResponseDto> {
    return this.surveys.history(params.code, query.toPageQuery(), isAuthenticated(request));
  }

  @Get('surveys.geojson')
  @ApiOperation({
    summary: 'จุดสำรวจใน bbox ของแหล่งที่ใช้งาน กรองแบบเดียวกับ /sites.geojson (ใหม่สุดก่อน สูงสุด 5000 จุด)',
  })
  @ApiOkResponse({ type: SurveyFeatureCollectionResponseDto })
  @ApiErrorResponse(400, ['INVALID_BBOX', 'VALIDATION_ERROR'])
  @Header('Cache-Control', 'no-store')
  points(
    @Req() request: HttpRequest,
    @Query() query: SitesGeoJsonQueryDto,
  ): Promise<SurveyFeatureCollectionResponseDto> {
    return this.surveys.points(query.toGeoJsonQuery(), isAuthenticated(request));
  }

  @Post('sites/:code/surveys')
  @Roles('editor', 'admin')
  @ApiOperation({
    summary: 'บันทึกการสำรวจ (editor/admin): จุดต้องห่างแหล่งไม่เกิน 50 m; ตอบ status ของแหล่งหลังบันทึก',
  })
  @ApiCookieAuth('gis_access')
  @ApiBearerAuth()
  @ApiCsrfHeaders(false)
  @ApiBody({ type: CreateSurveyDto })
  @ApiCreatedResponse({ type: CreatedSurveyResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(404, ['SITE_NOT_FOUND'])
  @ApiErrorResponse(422, ['OUTSIDE_SITE'])
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: HttpRequest,
    @Param() params: SiteCodeParamsDto,
    @JsonBody() body: CreateSurveyDto,
  ): Promise<CreatedSurveyResponseDto> {
    return this.surveys.create(params.code, body.toCreateSurvey(), actorOf(request));
  }

  @Patch('surveys/:id')
  @Roles('editor', 'admin')
  @ApiOperation({ summary: 'แก้ไขการสำรวจบางส่วน (editor/admin); ตรวจ record หลัง merge รวมระยะ 50 m' })
  @ApiCookieAuth('gis_access')
  @ApiBearerAuth()
  @ApiCsrfHeaders(false)
  @ApiBody({ type: UpdateSurveyDto })
  @ApiOkResponse({ type: CreatedSurveyResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(404, ['SURVEY_NOT_FOUND'])
  @ApiErrorResponse(422, ['OUTSIDE_SITE'])
  @Header('Cache-Control', 'no-store')
  update(
    @Req() request: HttpRequest,
    @Param() params: SurveyIdParamsDto,
    @JsonBody() body: UpdateSurveyDto,
  ): Promise<CreatedSurveyResponseDto> {
    return this.surveys.update(params.toId(), body.toUpdateSurvey(), actorOf(request));
  }

  @Delete('surveys/:id')
  @Roles('editor', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'ลบการสำรวจถาวร (editor/admin); status ของแหล่งคำนวณใหม่ตอนอ่านครั้งถัดไป' })
  @ApiCookieAuth('gis_access')
  @ApiBearerAuth()
  @ApiCsrfHeaders(false)
  @ApiNoContentResponse({ description: 'No content' })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, ['UNAUTHORIZED'])
  @ApiErrorResponse(403, ['FORBIDDEN', 'CSRF_REJECTED'])
  @ApiErrorResponse(404, ['SURVEY_NOT_FOUND'])
  @Header('Cache-Control', 'no-store')
  async remove(@Param() params: SurveyIdParamsDto): Promise<void> {
    await this.surveys.remove(params.toId());
  }
}
