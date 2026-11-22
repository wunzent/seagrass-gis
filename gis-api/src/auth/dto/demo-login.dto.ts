import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Role } from '../entities/user.entity';

export const DEMO_ROLES = ['viewer', 'editor', 'admin'] as const;

export class DemoLoginDto {
  @ApiProperty({ enum: DEMO_ROLES })
  @IsIn(DEMO_ROLES)
  role!: Role;
}

export class DemoLoginRolesDto {
  @ApiProperty({ enum: DEMO_ROLES, isArray: true, example: DEMO_ROLES })
  roles!: readonly Role[];
}
