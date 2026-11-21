import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SurveyResponseDto } from './survey.response.dto';

@ApiSchema({ name: 'SurveysPage' })
export class SurveysPageResponseDto {
  @ApiProperty({ type: [SurveyResponseDto] })
  items!: SurveyResponseDto[];

  @ApiProperty({ type: 'integer' })
  total!: number;

  @ApiProperty({ type: 'integer' })
  page!: number;
}
