import { registerDecorator, ValidationOptions } from 'class-validator';

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Text PostgreSQL can store and compare: no NUL and no lone UTF-16 surrogates. */
export function IsStorableText(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => registerDecorator({
    name: 'isStorableText', target: target.constructor, propertyName: propertyName as string, options,
    validator: { validate: (value: unknown) => typeof value === 'string' && !value.includes('\u0000') && !LONE_SURROGATE.test(value) },
  });
}
