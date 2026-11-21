import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

@ApiSchema({ name: 'LoginResponse' })
export class LoginResponseDto {
  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ type: 'integer', enum: [900] })
  expires_in!: number;

  @ApiProperty({ format: 'date-time' })
  expires_at!: string;
}
