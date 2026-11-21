import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { Role } from '../entities/user.entity';

@ApiSchema({ name: 'User' })
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: ['viewer', 'editor', 'admin'] })
  role!: Role;
}
