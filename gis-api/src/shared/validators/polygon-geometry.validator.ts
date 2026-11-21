import { registerDecorator, ValidationOptions } from 'class-validator';
import { Geometry, RowRejection, validateGeometry } from './geometry.validator';

/** Shape check of BR-01/02 (the same rules as the importer); PostGIS validity/area is checked later by the repository. */
export function toMultiPolygon(value: unknown): Geometry | null {
  try {
    return validateGeometry(value, 'polygon');
  } catch (error) {
    if (error instanceof RowRejection) return null;
    throw error;
  }
}

/** Geometry object members accepted on input; anything else (bbox included) is an unknown field. */
const GEOMETRY_MEMBERS = new Set(['type', 'coordinates', 'crs']);
export const unknownGeometryMembers = (value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).filter((key) => !GEOMETRY_MEMBERS.has(key))
    : [];

/** Reported by the validation pipe as `details.unknown: ['geometry.<member>']` (400 VALIDATION_ERROR). */
export function HasOnlyGeometryMembers(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: GEOMETRY_MEMBERS_CONSTRAINT,
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: { validate: (value: unknown) => unknownGeometryMembers(value).length === 0 },
    });
}
export const GEOMETRY_MEMBERS_CONSTRAINT = 'geometryMembers';

/**
 * GeoJSON Polygon | MultiPolygon with finite [lon,lat] positions in range and closed rings; never repaired.
 * A failure on a property named `geometry` is reported as 400 INVALID_GEOMETRY by the validation pipe.
 */
export function IsPolygonGeometry(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isPolygonGeometry',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: { validate: (value: unknown) => toMultiPolygon(value) !== null },
    });
}
