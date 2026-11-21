import { ArgumentMetadata, ValidationError, ValidationPipe } from '@nestjs/common';
import { ApiError, validationError } from '../errors/api-error';

const flatten = (errors: ValidationError[]): ValidationError[] =>
  errors.flatMap((e) => [e, ...flatten(e.children ?? [])]);

/**
 * Maps class-validator failures to the shared envelope:
 * unknown properties → VALIDATION_ERROR (bounded echo), any failure on `bbox` → INVALID_BBOX (dedicated code per shared contract),
 * anything else → VALIDATION_ERROR with the failing field names. Messages never echo submitted values.
 */
export function toApiError(errors: ValidationError[]) {
  const all = flatten(errors);
  const unknown = all
    .filter((e) => e.constraints?.whitelistValidation)
    .map((e) => e.property.slice(0, 64))
    .slice(0, 10);
  if (unknown.length) return validationError({ unknown });
  // class-validator 0.15 does not keep `context` for custom constraints, so the dedicated code is keyed on the property name.
  if (all.some((e) => e.property === 'bbox' && e.constraints))
    return new ApiError(400, 'INVALID_BBOX', 'bbox ต้องเป็น minLon,minLat,maxLon,maxLat');
  return validationError({
    fields: [...new Set(all.filter((e) => e.constraints).map((e) => e.property))].slice(0, 10),
  });
}

/** class-transformer silently skips own `__proto__`/`constructor` keys, so whitelist never sees them; reject them here. */
const POLLUTING_KEYS = ['__proto__', 'constructor'];

export class StrictValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    const polluting =
      metadata.metatype && value !== null && typeof value === 'object' && !Array.isArray(value)
        ? POLLUTING_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key))
        : [];
    if (!polluting.length) return super.transform(value, metadata);
    let others: string[] = [];
    try {
      await super.transform(value, metadata);
    } catch (error) {
      const unknown = (error as ApiError).getResponse?.() as
        { error?: { details?: { unknown?: string[] } } } | undefined;
      others = unknown?.error?.details?.unknown ?? [];
    }
    throw validationError({ unknown: [...polluting, ...others].slice(0, 10) });
  }
}

/**
 * Global pipe (APP_PIPE): strict DTOs, no implicit type conversion (numbers arrive as validated strings and are converted
 * by the DTO), unknown properties rejected, custom param decorators (JsonBody) validated too.
 */
export const createValidationPipe = () =>
  new StrictValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validateCustomDecorators: true,
    stopAtFirstError: false,
    exceptionFactory: toApiError,
  });
