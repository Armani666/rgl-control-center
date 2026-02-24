export type UserRole = 'super_admin' | 'admin' | 'almacen' | 'ventas';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  commissionRate?: number;
  active: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface UserProfileUpdatePayload {
  fullName?: string;
  role?: UserRole;
  active?: boolean;
}

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super admin',
  admin: 'Administrador',
  almacen: 'Almacen',
  ventas: 'Ventas'
};
