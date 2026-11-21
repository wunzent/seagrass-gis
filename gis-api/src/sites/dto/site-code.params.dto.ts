import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { Utf16Length } from '../../common/validation';

/** Path code: 1–64 chars, not whitespace-only, no control characters (importer stores trimmed codes). */
export class SiteCodeParamsDto {
  @ApiProperty({ maxLength: 64, example: 'KBI-001' })
  @IsString() @Utf16Length(1, 64) @Matches(/^(?=[\s\S]*\S)[^\u0000-\u001f\u007f]+$/)
  code!: string;
}
