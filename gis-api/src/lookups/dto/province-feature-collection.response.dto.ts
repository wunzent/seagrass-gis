import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'ProvinceProperties' })
export class ProvincePropertiesDto {
  @ApiProperty({ example: '81' })
  code!: string;

  @ApiProperty()
  name_th!: string;
}

@ApiSchema({ name: 'ProvinceFeature' })
export class ProvinceFeatureResponseDto {
  @ApiProperty({ enum: ['Feature'] })
  type!: 'Feature';

  @ApiProperty({ type: Object, description: 'GeoJSON MultiPolygon, SRID 4326, [lon,lat] (ขอบเขตจำลองจาก seed)' })
  geometry!: unknown;

  @ApiProperty({ type: () => ProvincePropertiesDto })
  properties!: ProvincePropertiesDto;

  static fromRow(r: { code: string; name_th: string; geometry: unknown }): ProvinceFeatureResponseDto {
    return { type: 'Feature', geometry: r.geometry, properties: { code: r.code, name_th: r.name_th } };
  }
}

@ApiSchema({ name: 'ProvinceFeatureCollection' })
export class ProvinceFeatureCollectionResponseDto {
  @ApiProperty({ enum: ['FeatureCollection'] })
  type!: 'FeatureCollection';

  @ApiProperty({ type: [ProvinceFeatureResponseDto] })
  features!: ProvinceFeatureResponseDto[];
}
