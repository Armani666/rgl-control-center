import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  try {
    await authService.ensureInitialized();
  } catch {
    return router.createUrlTree(['/auth/login'], {
      queryParams: { redirectTo: state.url }
    });
  }

  if (authService.currentSession) {
    return true;
  }

  return router.createUrlTree(['/auth/login'], {
    queryParams: { redirectTo: state.url }
  });
};
