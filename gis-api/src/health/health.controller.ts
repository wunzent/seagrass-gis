import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../shared/decorators/api-error-response.decorator';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'ความพร้อมของ API และ PostGIS (query ฐานข้อมูลจริง)' })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiErrorResponse(503, ['SERVICE_UNAVAILABLE'])
  @Header('Cache-Control', 'no-store')
  health(): Promise<HealthResponseDto> { return this.healthService.check(); }
}
