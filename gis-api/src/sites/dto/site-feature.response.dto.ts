import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SiteRow } from '../entities/site.entity';
import { LatestSurveyResponseDto } from './latest-survey.response.dto';
import { SiteSummaryResponseDto } from './site-summary.response.dto';

@ApiSchema({ name: 'SiteFeatureProperties' })
export class SiteFeaturePropertiesDto extends SiteSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: () => LatestSurveyResponseDto, nullable: true })
  latestSurvey!: LatestSurveyResponseDto | null;
}

@ApiSchema({ name: 'SiteFeature' })
export class SiteFeatureResponseDto {
  @ApiProperty({ enum: ['Feature'] })
  type!: 'Feature';

  @ApiProperty({ type: Object, description: 'GeoJSON MultiPolygon, SRID 4326, [lon,lat]' })
  geometry!: unknown;

  @ApiProperty({ type: () => SiteFeaturePropertiesDto })
  properties!: SiteFeaturePropertiesDto;

  static fromRow(r: SiteRow): SiteFeatureResponseDto {
    return {
      type: 'Feature',
      geometry: r.geometry,
      properties: {
        id: r.id, ...SiteSummaryResponseDto.fromRow(r),
        latestSurvey: r.surveyed_on === null
          ? null
          : { surveyed_on: r.surveyed_on, average_cover_percent: r.average_cover_percent!, count: r.count! },
      },
    };
  }
}
