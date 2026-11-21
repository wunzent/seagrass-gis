import { ApiProperty } from '@nestjs/swagger';
import { IsPositiveIntString } from '../../shared/validators/positive-int-string.validator';

/** Path id: strict positive integer string up to Number.MAX_SAFE_INTEGER (larger ids → 400, never rounded). */
export class SurveyIdParamsDto {
  @ApiProperty({ type: 'integer', minimum: 1, example: 1 })
  @IsPositiveIntString(Number.MAX_SAFE_INTEGER)
  id!: string;

  toId(): number {
    return Number(this.id);
  }
}
