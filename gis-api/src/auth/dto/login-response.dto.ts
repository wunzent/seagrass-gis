import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

@ApiSchema({ name: 'LoginResponse' })
export class LoginResponseDto {
  @ApiProperty({ description: 'JWT เดียวกับ HttpOnly cookie gis_access; อายุ 900 วินาที (ดูเวลาหมดอายุจาก claim exp)' })
  access_token!: string;

  @ApiProperty({ type: () => UserResponseDto })
  user!: UserResponseDto;
}
