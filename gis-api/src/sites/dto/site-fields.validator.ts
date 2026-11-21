import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { IsStorableText } from '../../shared/validators/storable-text.validator';
import { Utf16Length } from '../../shared/validators/utf16-length.validator';

/** Path `:code` rule: 1–64 UTF-16 units, not whitespace-only, no control characters. */
export const SITE_CODE_PATTERN = /^(?=[\s\S]*\S)[^\u0000-\u001f\u007f]+$/;
/** New codes also may not start or end with whitespace: rejected, never trimmed. */
const NO_EDGE_WHITESPACE = /^\S(?:[\s\S]*\S)?$/;
export const IsSiteCode = () =>
  applyDecorators(
    IsString(),
    Utf16Length(1, 64),
    Matches(SITE_CODE_PATTERN),
    Matches(NO_EDGE_WHITESPACE),
    IsStorableText(),
  );

/** Site name: 1–255 UTF-16 units, not whitespace-only, storable by PostgreSQL (no NUL, no lone surrogate). */
export const IsSiteName = () => applyDecorators(IsString(), Utf16Length(1, 255), Matches(/\S/), IsStorableText());
