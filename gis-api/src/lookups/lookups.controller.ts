import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponse } from '../shared/decorators/api-error-response.decorator';
import { NoQuery } from '../shared/decorators/no-query.decorator';
import {
  ProvinceFeatureCollectionResponseDto,
  ProvinceFeatureResponseDto,
} from './dto/province-feature-collection.response.dto';
import { SpeciesListResponseDto, SpeciesResponseDto } from './dto/species.response.dto';
import { LookupsRepository } from './lookups.repository';

/** Public lookups; no-store like the other reads (a GET with an unusable cookie also carries a clearing Set-Cookie). */
@ApiTags('lookups')
@ApiErrorResponse(503, ['SERVICE_UNAVAILABLE'])
@Controller()
export class LookupsController {
  constructor(private readonly lookups: LookupsRepository) {}

  @Get('provinces.geojson')
  @ApiOperation({ summary: 'ขอบเขตจังหวัด (ข้อมูลจำลองจาก seed) เรียง code' })
  @ApiOkResponse({ type: ProvinceFeatureCollectionResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @Header('Cache-Control', 'no-store')
  async provinces(@NoQuery() _query: void): Promise<ProvinceFeatureCollectionResponseDto> {
    return {
      type: 'FeatureCollection',
      features: (await this.lookups.provinces()).map(ProvinceFeatureResponseDto.fromRow),
    };
  }

  @Get('species')
  @ApiOperation({ summary: 'รายการชนิดหญ้าทะเล เรียง code' })
  @ApiOkResponse({ type: SpeciesListResponseDto })
  @ApiErrorResponse(400, ['VALIDATION_ERROR'])
  @Header('Cache-Control', 'no-store')
  async species(@NoQuery() _query: void): Promise<SpeciesListResponseDto> {
    return { items: (await this.lookups.species()).map(SpeciesResponseDto.fromRow) };
  }
}
