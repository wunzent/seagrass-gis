import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SITE_STATUSES, SiteStatus } from '../../sites/entities/site.entity';
import { SurveyResponseDto } from './survey.response.dto';

@ApiSchema({ name: 'CreatedSurvey' })
/** Shared POST/PATCH write response, including the parent status after the write. */
export class CreatedSurveyResponseDto extends SurveyResponseDto {
  @ApiProperty({ enum: SITE_STATUSES, description: 'status ของแหล่งหลังบันทึก (BR-04)' })
  siteStatus!: SiteStatus;
}
