import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { errorResponse, ref } from '../common/openapi-schemas';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'ความพร้อมของ API และ PostGIS (query ฐานข้อมูลจริง)' })
  @ApiResponse({ status: 200, schema: ref('Health') })
  @ApiResponse(errorResponse(503, ['SERVICE_UNAVAILABLE']))
  @Header('Cache-Control', 'no-store')
  health() { return this.healthService.check(); }
}
