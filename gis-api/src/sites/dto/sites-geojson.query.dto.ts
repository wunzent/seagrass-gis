import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, registerDecorator, ValidationOptions } from 'class-validator';
import { GeoJsonQuery } from '../entities/site.entity';
import { SiteFiltersDto } from './site-filters.dto';

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Exactly 4 plain decimals in range, min < max, no antimeridian wrap (BR-10). */
export function parseBbox(value: unknown): [number, number, number, number] | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (parts.length !== 4 || !parts.every((p) => DECIMAL.test(p))) return null;
  const [minLon, minLat, maxLon, maxLat] = parts.map(Number);
  const lonOk = (v: number) => v >= -180 && v <= 180;
  const latOk = (v: number) => v >= -90 && v <= 90;
  return [minLon, maxLon].every(lonOk) && [minLat, maxLat].every(latOk) && minLon < maxLon && minLat < maxLat
    ? [minLon, minLat, maxLon, maxLat]
    : null;
}

function IsBbox(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isBbox',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: { validate: (value: unknown) => parseBbox(value) !== null },
    });
}

/** GET /sites.geojson query. Any bbox problem (missing, repeated, malformed, out of range) is 400 INVALID_BBOX. */
export class SitesGeoJsonQueryDto extends SiteFiltersDto {
  @ApiProperty({ description: 'minLon,minLat,maxLon,maxLat', example: '99,7,100,8' })
  @IsDefined()
  @IsString()
  @IsBbox()
  bbox!: string;

  toGeoJsonQuery(): GeoJsonQuery {
    return { bbox: parseBbox(this.bbox)!, ...this.filters() };
  }
}
