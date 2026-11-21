import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsPositiveIntString } from '../../shared/validators/positive-int-string.validator';
import { ListQuery } from '../entities/site.entity';
import { SiteFiltersDto } from './site-filters.dto';

/** GET /sites query. page/pageSize stay strings until validated so '1e2', '1.5' or ' 2' are rejected, never coerced. */
export class ListSitesQueryDto extends SiteFiltersDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @IsPositiveIntString(Number.MAX_SAFE_INTEGER)
  page?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsPositiveIntString(100)
  pageSize?: string;

  toListQuery(): ListQuery {
    return { page: Number(this.page ?? 1), pageSize: Number(this.pageSize ?? 20), ...this.filters() };
  }
}
