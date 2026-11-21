import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

@ApiSchema({ name: 'MeResponse' })
export class MeResponseDto {
  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ format: 'date-time' })
  expires_at!: string;
}
