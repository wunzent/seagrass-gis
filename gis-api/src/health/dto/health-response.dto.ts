import { ApiProperty, ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'Health' })
export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] })
  db!: 'ok';

  @ApiProperty({ example: '3.5' })
  postgis!: string;
}
