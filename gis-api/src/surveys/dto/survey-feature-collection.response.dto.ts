import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SurveyFeatureResponseDto } from './survey-feature.response.dto';

@ApiSchema({ name: 'SurveyFeatureCollection' })
export class SurveyFeatureCollectionResponseDto {
  @ApiProperty({ enum: ['FeatureCollection'] })
  type!: 'FeatureCollection';

  @ApiProperty({ type: [SurveyFeatureResponseDto] })
  features!: SurveyFeatureResponseDto[];
}
