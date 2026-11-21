import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ListQuery } from '../entities/site.entity';
import { SiteFiltersDto } from './site-filters.dto';

const POSITIVE_INT = /^[1-9]\d*$/;

@ValidatorConstraint({ name: 'intStringMax' })
class IntStringMax implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    return typeof value === 'string' && Number(value) <= (args.constraints[0] as number);
  }
}

/** GET /sites query. page/pageSize stay strings until validated so '1e2', '1.5' or ' 2' are rejected, never coerced. */
export class ListSitesQueryDto extends SiteFiltersDto {
  @ApiPropertyOptional({ type: 'integer', minimum: 1, default: 1 })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INT)
  @Validate(IntStringMax, [Number.MAX_SAFE_INTEGER])
  page?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsString()
  @Matches(POSITIVE_INT)
  @Validate(IntStringMax, [100])
  pageSize?: string;

  toListQuery(): ListQuery {
    return { page: Number(this.page ?? 1), pageSize: Number(this.pageSize ?? 20), ...this.filters() };
  }
}
