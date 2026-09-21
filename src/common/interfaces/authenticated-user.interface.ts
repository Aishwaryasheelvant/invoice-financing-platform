import { UserRole } from '../../users/enums/user-role.enum';

/** Shape of `req.user`, set by JwtStrategy.validate() once a request passes JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}
