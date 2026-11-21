import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Utf16Length } from '../../shared/validators/utf16-length.validator';
import { SITE_CODE_PATTERN } from './site-fields.validator';

/** Path code: 1–64 chars, not whitespace-only, no control characters (importer stores trimmed codes). */
export class SiteCodeParamsDto {
  @ApiProperty({ maxLength: 64, example: 'KBI-001' })
  @IsString()
  @Utf16Length(1, 64)
  @Matches(SITE_CODE_PATTERN)
  code!: string;
}
