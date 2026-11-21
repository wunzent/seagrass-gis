import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { IsStorableText } from '../../shared/validators/storable-text.validator';
import { Utf16Length } from '../../shared/validators/utf16-length.validator';
import { SITE_STATUSES, SiteFilters, SiteStatus } from '../entities/site.entity';

/** Filters shared by GET /sites and GET /sites.geojson (one snapshot for table and map). */
export class SiteFiltersDto {
  @ApiPropertyOptional({ pattern: '^[0-9A-Za-z]{1,2}$', example: '81' })
  @IsOptional() @IsString() @Matches(/^[0-9A-Za-z]{1,2}$/)
  province?: string;

  @ApiPropertyOptional({ enum: SITE_STATUSES })
  @IsOptional() @IsString() @IsIn(SITE_STATUSES)
  status?: SiteStatus;

  @ApiPropertyOptional({ maxLength: 100, description: 'ค้นหา code/name แบบ literal substring ไม่สนตัวพิมพ์' })
  @IsOptional() @IsString() @Utf16Length(0, 100) @IsStorableText()
  q?: string;

  protected filters(): SiteFilters {
    return { ...(this.province ? { province: this.province } : {}), ...(this.status ? { status: this.status } : {}), ...(this.q ? { q: this.q } : {}) };
  }
}
