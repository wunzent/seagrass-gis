import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { CreateSurvey } from '../entities/survey.entity';
import {
  IsCoverPercent,
  IsLatitude,
  IsLongitude,
  IsSpeciesList,
  IsSurveyDate,
  IsSurveyNote,
  MAX_SPECIES,
  NOTE_MAX,
} from './survey-fields.validator';

/** POST /sites/:code/surveys body. survey_ref, site_id and audit fields are server-owned (unknown field → 400). */
@ApiSchema({ name: 'CreateSurvey' })
export class CreateSurveyDto {
  @ApiProperty({ minimum: -180, maximum: 180, example: 99.35 })
  @IsLongitude()
  lon!: number;

  @ApiProperty({ minimum: -90, maximum: 90, example: 7.38 })
  @IsLatitude()
  lat!: number;

  @ApiProperty({ format: 'date', example: '2026-10-01', description: 'วันที่จริง ไม่เกินวันนี้ตามเวลา Asia/Bangkok' })
  @IsSurveyDate()
  surveyed_on!: string;

  @ApiProperty({ minimum: 0, maximum: 100, example: 45.5 })
  @IsCoverPercent()
  cover_percent!: number;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: MAX_SPECIES,
    uniqueItems: true,
    example: ['EA', 'HO'],
    description: 'รหัสชนิดจาก GET /species ไม่ซ้ำกัน',
  })
  @IsSpeciesList()
  species!: string[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: NOTE_MAX, example: 'น้ำขุ่น' })
  @IsSurveyNote()
  note?: string | null;

  toCreateSurvey(): CreateSurvey {
    return {
      lon: this.lon,
      lat: this.lat,
      surveyed_on: this.surveyed_on,
      cover_percent: this.cover_percent,
      species: this.species,
      note: this.note ?? null,
    };
  }
}
