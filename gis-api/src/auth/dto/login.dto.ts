import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { Utf16Length } from '../../shared/validators/utf16-length.validator';

/** POST /auth/login body; unknown properties are rejected by the global ValidationPipe. */
export class LoginDto {
  @ApiProperty({ maxLength: 254, example: 'admin@demo.local' })
  @IsString()
  @Utf16Length(3, 254)
  email!: string;

  @ApiProperty({ maxLength: 256 })
  @IsString()
  @Utf16Length(1, 256)
  password!: string;
}
