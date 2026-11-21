import { SetMetadata } from '@nestjs/common';
import { Role } from '../entities/user.entity';

export const ROLES_KEY = 'gis:roles';
/** Marks a protected write and the roles allowed to call it. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const FIELD_ROLES_KEY = 'gis:field-roles';
export const FieldRoles = (fields: Record<string, Role[]>) => SetMetadata(FIELD_ROLES_KEY, fields);
