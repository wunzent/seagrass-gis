import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, registerDecorator, ValidationOptions } from 'class-validator';

const POSITIVE_INT = /^[1-9]\d*$/;

function IntStringMax(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'intStringMax',
      target: target.constructor,
      propertyName: propertyName as string,
      constraints: [max],
      options,
      validator: { validate: (value: unknown) => typeof value === 'string' && Number(value) <= max },
    });
}

/** Query/path integer kept as a string until validated: '1e2', '1.5', ' 2' or '01' are rejected, never coerced. */
export const IsPositiveIntString = (max: number) =>
  applyDecorators(IsString(), Matches(POSITIVE_INT), IntStringMax(max));
