import { applyDecorators } from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  registerDecorator,
  ValidateIf,
  ValidationOptions,
} from 'class-validator';
import { IsStorableText } from '../../shared/validators/storable-text.validator';
import { Utf16Length } from '../../shared/validators/utf16-length.validator';
import { isSurveyDate } from '../../shared/validators/geometry.validator';

const finite = { allowNaN: false, allowInfinity: false };
/** JSON numbers only (no numeric strings); range bounds inclusive. */
const IsBoundedNumber = (min: number, max: number) => applyDecorators(IsNumber(finite), Min(min), Max(max));

export const IsLongitude = () => IsBoundedNumber(-180, 180);
export const IsLatitude = () => IsBoundedNumber(-90, 90);
export const IsCoverPercent = () => IsBoundedNumber(0, 100);

/** BR-05: YYYY-MM-DD real calendar date, not later than today in Asia/Bangkok (evaluated per request). */
export function IsSurveyDate(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isSurveyDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: { validate: (value: unknown) => isSurveyDate(value) },
    });
}

export const MAX_SPECIES = 50;
/** Non-empty list of distinct species codes (varchar(16)); existence in `species` is checked by the service (400). */
export const IsSpeciesList = () =>
  applyDecorators(
    IsArray(),
    ArrayNotEmpty(),
    ArrayMaxSize(MAX_SPECIES),
    ArrayUnique(),
    IsString({ each: true }),
    Utf16Length(1, 16, { each: true }),
    IsStorableText({ each: true }),
  );

export const NOTE_MAX = 2000;
/** note: optional string up to 2000 UTF-16 units, or null (null is the only nullable survey field). */
export const IsSurveyNote = () => applyDecorators(IsOptional(), IsString(), Utf16Length(0, NOTE_MAX), IsStorableText());

/** PATCH: a present key is validated even when null; only `undefined` (omitted) skips it. */
export const IfPresent = () => ValidateIf((_o, value) => value !== undefined);
