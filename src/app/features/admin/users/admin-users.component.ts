import { AsyncPipe, DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';

import { roleLabels, UserRole } from '../../../shared/models/auth-profile.model';
import { AuthService } from '../../../core/services/auth.service';
import { UserAdminService } from '../../../core/services/user-admin.service';

@Component({
  selector: 'app-admin-users',
  imports: [AsyncPipe, DatePipe, NgClass, NgFor, NgIf],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss'
})
export class AdminUsersComponent {
  private readonly userAdminService = inject(UserAdminService);
  readonly authService = inject(AuthService);
  readonly profiles$ = this.userAdminService.getProfiles$();
  readonly roles: UserRole[] = ['super_admin', 'admin', 'almacen', 'ventas'];
  readonly roleLabels = roleLabels;

  busyUserId = '';
  errorMessage = '';

  async onRoleChange(userId: string, role: string): Promise<void> {
    if (!isRole(role)) return;

    this.errorMessage = '';
    this.busyUserId = userId;
    try {
      await this.userAdminService.updateUserRole(userId, role);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo actualizar el rol.';
    } finally {
      this.busyUserId = '';
    }
  }

  async onToggleActive(userId: string, active: boolean): Promise<void> {
    this.errorMessage = '';
    this.busyUserId = userId;
    try {
      await this.userAdminService.setUserActive(userId, !active);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo actualizar el estado.';
    } finally {
      this.busyUserId = '';
    }
  }

  isCurrentUser(userId: string): boolean {
    return this.authService.currentUser?.id === userId;
  }

  countByRole(profiles: Array<{ role: UserRole }>, role: UserRole): number {
    return profiles.filter((profile) => profile.role === role).length;
  }

  countByActive(profiles: Array<{ active: boolean }>, active: boolean): number {
    return profiles.filter((profile) => profile.active === active).length;
  }
}

function isRole(value: string): value is UserRole {
  return value === 'super_admin' || value === 'admin' || value === 'almacen' || value === 'ventas';
}
