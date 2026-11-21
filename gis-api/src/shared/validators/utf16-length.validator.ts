import { registerDecorator, ValidationOptions } from 'class-validator';

/** Length in UTF-16 code units (string.length, as the former hand-written parsers did), not validator.js code points. */
export function Utf16Length(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'utf16Length',
      target: target.constructor,
      propertyName: propertyName as string,
      constraints: [min, max],
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && value.length >= min && value.length <= max,
      },
    });
}
