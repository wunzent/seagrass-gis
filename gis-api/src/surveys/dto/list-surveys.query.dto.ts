import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsPositiveIntString } from '../../shared/validators/positive-int-string.validator';
import { PageQuery } from '../entities/survey.entity';

/** GET /sites/:code/surveys query: the same strict paging rules as GET /sites (default 1/20, pageSize max 100). */
export class ListSurveysQueryDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @IsPositiveIntString(Number.MAX_SAFE_INTEGER)
  page?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsPositiveIntString(100)
  pageSize?: string;

  toPageQuery(): PageQuery {
    return { page: Number(this.page ?? 1), pageSize: Number(this.pageSize ?? 20) };
  }
}
