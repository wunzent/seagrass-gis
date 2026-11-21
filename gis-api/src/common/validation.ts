import { ArgumentMetadata, ValidationError, ValidationPipe } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { ApiError, validationError } from './errors';

const flatten = (errors: ValidationError[]): ValidationError[] => errors.flatMap(e => [e, ...flatten(e.children ?? [])]);

/**
 * Maps class-validator failures to the shared envelope:
 * unknown properties → VALIDATION_ERROR (bounded echo), any failure on `bbox` → INVALID_BBOX (dedicated code per shared contract),
 * anything else → VALIDATION_ERROR with the failing field names. Messages never echo submitted values.
 */
export function toApiError(errors: ValidationError[]) {
  const all = flatten(errors);
  const unknown = all.filter(e => e.constraints?.whitelistValidation).map(e => e.property.slice(0, 64)).slice(0, 10);
  if (unknown.length) return validationError({ unknown });
  // class-validator 0.15 does not keep `context` for custom constraints, so the dedicated code is keyed on the property name.
  if (all.some(e => e.property === 'bbox' && e.constraints)) return new ApiError(400, 'INVALID_BBOX', 'bbox ต้องเป็น minLon,minLat,maxLon,maxLat');
  return validationError({ fields: [...new Set(all.filter(e => e.constraints).map(e => e.property))].slice(0, 10) });
}

/** class-transformer silently skips own `__proto__`/`constructor` keys, so whitelist never sees them; reject them here. */
const POLLUTING_KEYS = ['__proto__', 'constructor'];

class StrictValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    const polluting = metadata.metatype && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? POLLUTING_KEYS.filter(key => Object.prototype.hasOwnProperty.call(value, key)) : [];
    if (!polluting.length) return super.transform(value, metadata);
    let others: string[] = [];
    try { await super.transform(value, metadata); } catch (error) {
      const unknown = (error as ApiError).getResponse?.() as { error?: { details?: { unknown?: string[] } } } | undefined;
      others = unknown?.error?.details?.unknown ?? [];
    }
    throw validationError({ unknown: [...polluting, ...others].slice(0, 10) });
  }
}

/**
 * Global pipe (APP_PIPE): strict DTOs, no implicit type conversion (numbers arrive as validated strings and are converted
 * by the DTO), unknown properties rejected, custom param decorators (JsonBody) validated too.
 */
export const createValidationPipe = () => new StrictValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  validateCustomDecorators: true,
  stopAtFirstError: false,
  exceptionFactory: toApiError,
});

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Length in UTF-16 code units (string.length, as the former hand-written parsers did), not validator.js code points. */
export function Utf16Length(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => registerDecorator({
    name: 'utf16Length', target: target.constructor, propertyName: propertyName as string, constraints: [min, max], options,
    validator: { validate: (value: unknown) => typeof value === 'string' && value.length >= min && value.length <= max },
  });
}

/** Text PostgreSQL can store and compare: no NUL and no lone UTF-16 surrogates. */
export function IsStorableText(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => registerDecorator({
    name: 'isStorableText', target: target.constructor, propertyName: propertyName as string, options,
    validator: { validate: (value: unknown) => typeof value === 'string' && !value.includes('\u0000') && !LONE_SURROGATE.test(value) },
  });
}
