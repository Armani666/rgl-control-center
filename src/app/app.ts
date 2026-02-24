import { AsyncPipe, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe, NgIf, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  readonly appName = 'rgl-control-center';
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly user$ = this.authService.user$;
  readonly profile$ = this.authService.profile$;

  async signOut(): Promise<void> {
    try {
      await this.authService.signOut();
      await this.router.navigate(['/auth/login']);
    } catch (error) {
      console.error(error);
    }
  }

  get canSeeAdminMenu(): boolean {
    return this.authService.hasAnyRole('super_admin', 'admin');
  }

  get canSeeProcurementMenu(): boolean {
    return this.authService.canManageProcurement();
  }

  get canSeeSalesMenu(): boolean {
    return this.authService.canRegisterSales();
  }

  get canSeeProductsMenu(): boolean {
    return this.authService.canManageProducts();
  }

  get canSeeInventoryMenu(): boolean {
    return this.authService.canManageInventory();
  }
}
