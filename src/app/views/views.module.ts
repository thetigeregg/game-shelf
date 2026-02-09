import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ViewsPageRoutingModule } from './views-routing.module';
import { ViewsPage } from './views.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ViewsPageRoutingModule,
  ],
  declarations: [ViewsPage],
})
export class ViewsPageModule {}
