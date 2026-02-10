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
        loadComponent: () => import('./list-page/list-page.component').then(m => m.ListPageComponent),
        data: { listType: 'collection' },
      },
      {
        path: 'wishlist',
        loadComponent: () => import('./list-page/list-page.component').then(m => m.ListPageComponent),
        data: { listType: 'wishlist' },
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
