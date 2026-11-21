import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SurveyRow } from '../entities/survey.entity';
import { SurveyResponseDto } from './survey.response.dto';

@ApiSchema({ name: 'SurveyFeatureProperties' })
export class SurveyFeaturePropertiesDto extends SurveyResponseDto {
  @ApiProperty({ maxLength: 64 })
  site_code!: string;
}

@ApiSchema({ name: 'SurveyFeature' })
export class SurveyFeatureResponseDto {
  @ApiProperty({ enum: ['Feature'] })
  type!: 'Feature';

  @ApiProperty({ type: Object, description: 'GeoJSON Point, SRID 4326, [lon,lat]' })
  geometry!: { type: 'Point'; coordinates: [number, number] };

  @ApiProperty({ type: () => SurveyFeaturePropertiesDto })
  properties!: SurveyFeaturePropertiesDto;

  static fromRow(r: SurveyRow, withCreator: boolean): SurveyFeatureResponseDto {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { ...SurveyResponseDto.fromRow(r, withCreator), site_code: r.site_code },
    };
  }
}
