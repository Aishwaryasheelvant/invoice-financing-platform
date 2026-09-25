import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, dashboardPathForRole } from '../services/auth.service';
import { UserRole } from '../models/user.model';

/**
 * A guard *factory*, not a guard — call it with the roles a route allows
 * (`roleGuard(['sme'])`) and use the returned function in `canActivate`.
 * A logged-in user with the wrong role is sent to *their own* dashboard
 * rather than bounced to /login, since they're not unauthenticated, just
 * in the wrong place.
 */
export function roleGuard(allowedRoles: UserRole[]): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);
    const user = authService.currentUser();

    if (!user) {
      return router.parseUrl('/login');
    }
    if (!allowedRoles.includes(user.role)) {
      return router.parseUrl(dashboardPathForRole(user.role));
    }
    return true;
  };
}
