import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import type { Role } from '../models/user.model';

/**
 * Factory that returns a CanActivateFn checking for specific roles.
 *
 * Usage in routes:
 *   canActivate: [authGuard, roleGuard('admin', 'manager')]
 *
 * Unauthenticated users → /login
 * Authenticated but wrong role → /unauthorized
 */
export const roleGuard = (...allowedRoles: Role[]): CanActivateFn => {
  return (_route, _state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isLoggedIn()) {
      return router.createUrlTree(['/login']);
    }

    if (auth.hasRole(...allowedRoles)) {
      return true;
    }

    return router.createUrlTree(['/unauthorized']);
  };
};
