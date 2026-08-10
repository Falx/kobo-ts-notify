import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'deals' },
  {
    path: 'deals',
    loadComponent: () =>
      import('./pages/deals/deals').then((m) => m.DealsPage),
    title: 'Deals',
  },
  {
    path: 'runs',
    loadComponent: () => import('./pages/runs/runs').then((m) => m.RunsPage),
    title: 'Runs',
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings/settings').then((m) => m.SettingsPage),
    title: 'Settings',
  },
  { path: '**', redirectTo: 'deals' },
];