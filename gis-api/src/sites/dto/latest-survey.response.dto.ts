import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'LatestSurvey' })
export class LatestSurveyResponseDto {
  @ApiProperty({ format: 'date' })
  surveyed_on!: string;

  @ApiProperty()
  average_cover_percent!: number;

  @ApiProperty({ type: 'integer' })
  count!: number;
}
