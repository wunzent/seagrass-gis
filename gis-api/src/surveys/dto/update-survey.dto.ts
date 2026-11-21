import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { validationError } from '../../shared/errors/api-error';
import { SurveyFields, UpdateSurvey } from '../entities/survey.entity';
import {
  IfPresent,
  IsCoverPercent,
  IsLatitude,
  IsLongitude,
  IsSpeciesList,
  IsSurveyDate,
  IsSurveyNote,
  MAX_SPECIES,
  NOTE_MAX,
} from './survey-fields.validator';

const FIELDS = ['lon', 'lat', 'surveyed_on', 'cover_percent', 'species', 'note'] as const;

/** PATCH /surveys/:id body: at least one field; null only for note. The service validates the merged record again. */
@ApiSchema({ name: 'UpdateSurvey' })
export class UpdateSurveyDto {
  @ApiPropertyOptional({ minimum: -180, maximum: 180 })
  @IfPresent()
  @IsLongitude()
  lon?: number;

  @ApiPropertyOptional({ minimum: -90, maximum: 90 })
  @IfPresent()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ format: 'date', description: 'วันที่จริง ไม่เกินวันนี้ตามเวลา Asia/Bangkok' })
  @IfPresent()
  @IsSurveyDate()
  surveyed_on?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IfPresent()
  @IsCoverPercent()
  cover_percent?: number;

  @ApiPropertyOptional({ type: [String], minItems: 1, maxItems: MAX_SPECIES, uniqueItems: true })
  @IfPresent()
  @IsSpeciesList()
  species?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: NOTE_MAX, description: 'null = ล้างหมายเหตุ' })
  @IsSurveyNote()
  note?: string | null;

  toUpdateSurvey(): UpdateSurvey {
    const change: Partial<Record<keyof SurveyFields, unknown>> = {};
    for (const field of FIELDS) if (this[field] !== undefined) change[field] = this[field];
    if (!Object.keys(change).length) throw validationError({ fields: [...FIELDS] });
    return change as UpdateSurvey;
  }
}
