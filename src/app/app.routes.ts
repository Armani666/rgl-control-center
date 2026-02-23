import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';

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
  { path: '**', redirectTo: 'products' }
];
