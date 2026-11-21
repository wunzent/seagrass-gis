import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'Species' })
export class SpeciesResponseDto {
  @ApiProperty({ maxLength: 16, example: 'EA' })
  code!: string;

  @ApiProperty()
  name_th!: string;

  @ApiProperty()
  name_sci!: string;

  static fromRow(r: SpeciesResponseDto): SpeciesResponseDto {
    return { code: r.code, name_th: r.name_th, name_sci: r.name_sci };
  }
}

@ApiSchema({ name: 'SpeciesList' })
export class SpeciesListResponseDto {
  @ApiProperty({ type: [SpeciesResponseDto] })
  items!: SpeciesResponseDto[];
}
