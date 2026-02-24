import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

import { UserRole } from '../../shared/models/auth-profile.model';
import { AuthService } from '../services/auth.service';

export const roleGuard: CanActivateFn = async (route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  try {
    await authService.ensureInitialized();
  } catch {
    return false;
  }

  const requiredRoles = (route.data?.['roles'] as UserRole[] | undefined) ?? [];
  if (requiredRoles.length === 0) {
    return authService.currentSession ? true : router.createUrlTree(['/auth/login']);
  }

  return authService.hasAnyRole(...requiredRoles) ? true : router.createUrlTree(['/stock']);
};
