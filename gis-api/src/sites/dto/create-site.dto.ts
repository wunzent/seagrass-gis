import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsObject, ValidateNested } from 'class-validator';
import {
  HasOnlyGeometryMembers,
  IsPolygonGeometry,
  toMultiPolygon,
} from '../../shared/validators/polygon-geometry.validator';
import { CreateSite } from '../entities/site.entity';
import { IsSiteCode, IsSiteName } from './site-fields.validator';

@ApiSchema({ name: 'CreateSiteProperties' })
export class CreateSitePropertiesDto {
  @ApiProperty({ maxLength: 64, example: 'DEMO-001' })
  @IsSiteCode()
  code!: string;

  @ApiProperty({ maxLength: 255, example: 'แหล่งตัวอย่าง' })
  @IsSiteName()
  name!: string;
}

/** POST /sites body: a GeoJSON Feature; province_code, area_rai, version and status are computed by the server. */
@ApiSchema({ name: 'CreateSite' })
export class CreateSiteDto {
  @ApiProperty({ enum: ['Feature'] })
  @IsIn(['Feature'])
  type!: 'Feature';

  @ApiProperty({
    type: Object,
    description:
      'GeoJSON Polygon หรือ MultiPolygon, EPSG:4326, positions [lon,lat]; เก็บเป็น MultiPolygon ไม่ซ่อม geometry',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [99.3, 7.3],
          [99.31, 7.3],
          [99.31, 7.31],
          [99.3, 7.31],
          [99.3, 7.3],
        ],
      ],
    },
  })
  @HasOnlyGeometryMembers()
  @IsPolygonGeometry()
  geometry!: unknown;

  @ApiProperty({ type: () => CreateSitePropertiesDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CreateSitePropertiesDto)
  properties!: CreateSitePropertiesDto;

  toCreateSite(): CreateSite {
    return { code: this.properties.code, name: this.properties.name, geometry: toMultiPolygon(this.geometry)! };
  }
}
