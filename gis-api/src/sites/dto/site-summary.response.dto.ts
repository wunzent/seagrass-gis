import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SITE_STATUSES, SiteRow, SiteStatus } from '../entities/site.entity';

@ApiSchema({ name: 'SiteSummary' })
export class SiteSummaryResponseDto {
  @ApiProperty({ maxLength: 64, example: 'KBI-001' })
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '81' })
  province_code!: string;

  @ApiProperty({ description: 'ไร่ ปัด 2 ตำแหน่ง' })
  area_rai!: number;

  @ApiProperty({ enum: SITE_STATUSES })
  status!: SiteStatus;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  /** Explicit field list: the response never gains a column the repository happens to select. */
  static fromRow(r: SiteRow): SiteSummaryResponseDto {
    return { code: r.code, name: r.name, province_code: r.province_code, area_rai: r.area_rai, status: r.status, version: r.version };
  }
}
