import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const guestGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  try {
    await authService.ensureInitialized();
  } catch {
    return true;
  }

  if (authService.currentSession) {
    return router.createUrlTree(['/products']);
  }

  return true;
};
