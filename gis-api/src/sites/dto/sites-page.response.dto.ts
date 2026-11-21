import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SiteSummaryResponseDto } from './site-summary.response.dto';

@ApiSchema({ name: 'SitesPage' })
export class SitesPageResponseDto {
  @ApiProperty({ type: [SiteSummaryResponseDto] })
  items!: SiteSummaryResponseDto[];

  @ApiProperty({ type: 'integer' })
  total!: number;

  @ApiProperty({ type: 'integer' })
  page!: number;
}
