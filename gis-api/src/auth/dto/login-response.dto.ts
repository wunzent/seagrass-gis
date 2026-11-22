import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

@ApiSchema({ name: 'LoginResponse' })
export class LoginResponseDto {
  @ApiProperty({ description: 'JWT เดียวกับ HttpOnly cookie gis_access; อายุ 900 วินาที' })
  access_token!: string;

  @ApiProperty({ enum: ['Bearer'] })
  token_type!: 'Bearer';

  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;

  @ApiProperty({ type: 'integer', enum: [900] })
  expires_in!: number;

  @ApiProperty({ format: 'date-time' })
  expires_at!: string;
}
