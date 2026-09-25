import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/enums/user-role.enum';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles. Requires the global JwtAuthGuard to have run first. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
