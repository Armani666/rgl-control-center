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
  readonly pendingRoles = new Map<string, UserRole>();

  busyUserId = '';
  errorMessage = '';

  onRoleSelected(userId: string, role: string): void {
    if (!isRole(role)) return;
    this.pendingRoles.set(userId, role);
  }

  async onRoleChange(userId: string): Promise<void> {
    const role = this.pendingRoles.get(userId);
    if (!role) return;

    this.errorMessage = '';
    this.busyUserId = userId;
    try {
      await this.userAdminService.updateUserRole(userId, role);
      this.pendingRoles.delete(userId);
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

  get isSuperAdmin(): boolean {
    return this.authService.hasRole('super_admin');
  }

  get canEditUsers(): boolean {
    return this.authService.canEditUsers();
  }

  canEditProfile(profile: { id: string; role: UserRole }): boolean {
    return true;
  }

  canAssignRole(role: UserRole): boolean {
    return true;
  }

  getPendingRole(userId: string, currentRole: UserRole): UserRole {
    return this.pendingRoles.get(userId) ?? currentRole;
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
