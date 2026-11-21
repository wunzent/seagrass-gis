import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';
import {
  HasOnlyGeometryMembers,
  IsPolygonGeometry,
  toMultiPolygon,
} from '../../shared/validators/polygon-geometry.validator';
import { validationError } from '../../shared/errors/api-error';
import { UpdateSite } from '../entities/site.entity';
import { IsSiteName } from './site-fields.validator';

const INT4_MAX = 2147483647;

/** PATCH body: null is validated, not treated as omitted (admin `geometry: null` → INVALID_GEOMETRY); `toUpdateSite()`
 * enforces "name or geometry" before any lookup. */
@ApiSchema({ name: 'UpdateSite' })
export class UpdateSiteDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: INT4_MAX, description: 'version ปัจจุบันที่ผู้แก้ไขเห็น' })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  version!: number;

  @ApiPropertyOptional({ maxLength: 255 })
  @ValidateIf((o: UpdateSiteDto) => o.name !== undefined)
  @IsSiteName()
  name?: string;

  @ApiPropertyOptional({
    type: Object,
    description: 'GeoJSON Polygon หรือ MultiPolygon (admin เท่านั้น แม้ส่งเป็น null)',
  })
  @ValidateIf((o: UpdateSiteDto) => o.geometry !== undefined)
  @HasOnlyGeometryMembers()
  @IsPolygonGeometry()
  geometry?: unknown;

  toUpdateSite(): UpdateSite {
    if (this.name === undefined && this.geometry === undefined) throw validationError({ fields: ['name', 'geometry'] });
    return {
      version: this.version,
      ...(this.name !== undefined ? { name: this.name } : {}),
      ...(this.geometry !== undefined ? { geometry: toMultiPolygon(this.geometry)! } : {}),
    };
  }
}
