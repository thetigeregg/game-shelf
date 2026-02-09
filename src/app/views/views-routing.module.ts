import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ViewsPage } from './views.page';

const routes: Routes = [
  {
    path: '',
    component: ViewsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ViewsPageRoutingModule {}
