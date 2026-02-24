import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'products' },
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'products',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-list/product-list.component').then(
        (m) => m.ProductListComponent
      )
  },
  {
    path: 'products/new',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-form/product-form.component').then(
        (m) => m.ProductFormComponent
      )
  },
  {
    path: 'products/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/products/product-form/product-form.component').then(
        (m) => m.ProductFormComponent
      )
  },
  {
    path: 'stock',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/inventory/stock/stock.component').then((m) => m.StockComponent)
  },
  {
    path: 'stock/move/:productId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/inventory/movement-form/movement-form.component').then(
        (m) => m.MovementFormComponent
      )
  },
  {
    path: 'stock/movements',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['super_admin', 'admin', 'almacen'] },
    loadComponent: () =>
      import('./features/inventory/movement-audit/movement-audit.component').then(
        (m) => m.MovementAuditComponent
      )
  },
  {
    path: 'procurement',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['super_admin', 'admin', 'almacen'] },
    loadComponent: () =>
      import('./features/procurement/procurement-dashboard/procurement-dashboard.component').then(
        (m) => m.ProcurementDashboardComponent
      )
  },
  {
    path: 'admin/users',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['super_admin', 'admin'] },
    loadComponent: () =>
      import('./features/admin/users/admin-users.component').then((m) => m.AdminUsersComponent)
  },
  {
    path: 'sales/commissions',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['super_admin', 'admin', 'ventas'] },
    loadComponent: () =>
      import('./features/sales/vendor-commissions/vendor-commissions.component').then(
        (m) => m.VendorCommissionsComponent
      )
  },
  { path: '**', redirectTo: 'products' }
];
