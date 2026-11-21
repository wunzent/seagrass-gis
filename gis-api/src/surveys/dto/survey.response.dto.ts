import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SurveyRow } from '../entities/survey.entity';

@ApiSchema({ name: 'SurveyCreator' })
export class SurveyCreatorResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;
}

@ApiSchema({ name: 'Survey' })
export class SurveyResponseDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty()
  lon!: number;

  @ApiProperty()
  lat!: number;

  @ApiProperty({ format: 'date' })
  surveyed_on!: string;

  @ApiProperty({ minimum: 0, maximum: 100 })
  cover_percent!: number;

  @ApiProperty({ type: [String], description: 'รหัสชนิด เรียงตาม code' })
  species!: string[];

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiPropertyOptional({
    type: () => SurveyCreatorResponseDto,
    description: 'มีเฉพาะผู้เรียกที่ login แล้ว (viewer/editor/admin); anonymous ไม่มี field นี้',
  })
  created_by?: SurveyCreatorResponseDto;

  /** Explicit allowlist; `withCreator` is true only for an authenticated caller (BR-08 privacy). */
  static fromRow(r: SurveyRow, withCreator: boolean): SurveyResponseDto {
    return {
      id: Number(r.id),
      lon: r.lon,
      lat: r.lat,
      surveyed_on: r.surveyed_on,
      cover_percent: r.cover_percent,
      species: r.species,
      note: r.note,
      ...(withCreator ? { created_by: { id: r.created_by_id, email: r.created_by_email } } : {}),
    };
  }
}
