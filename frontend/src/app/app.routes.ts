import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'register', loadComponent: () => import('./pages/register/register').then((m) => m.Register) },
  {
    path: 'sme',
    canActivate: [authGuard, roleGuard(['sme'])],
    loadComponent: () => import('./pages/sme-dashboard/sme-dashboard').then((m) => m.SmeDashboard),
  },
  {
    path: 'buyer',
    canActivate: [authGuard, roleGuard(['buyer'])],
    loadComponent: () => import('./pages/buyer-dashboard/buyer-dashboard').then((m) => m.BuyerDashboard),
  },
  {
    path: 'financier',
    canActivate: [authGuard, roleGuard(['financier'])],
    loadComponent: () => import('./pages/financier-dashboard/financier-dashboard').then((m) => m.FinancierDashboard),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
