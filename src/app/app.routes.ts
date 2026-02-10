import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings.page').then(m => m.SettingsPage),
  },
  {
    path: 'tags',
    loadComponent: () => import('./tags/tags.page').then(m => m.TagsPage),
  },
  {
    path: 'views',
    loadComponent: () => import('./views/views.page').then(m => m.ViewsPage),
  },
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'collection',
        loadComponent: () => import('./tab1/tab1.page').then(m => m.Tab1Page),
      },
      {
        path: 'wishlist',
        loadComponent: () => import('./tab2/tab2.page').then(m => m.Tab2Page),
      },
      {
        path: '',
        redirectTo: '/tabs/collection',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/collection',
    pathMatch: 'full',
  },
];
