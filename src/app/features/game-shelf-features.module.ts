import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { GameListComponent } from './game-list/game-list.component';
import { GameSearchComponent } from './game-search/game-search.component';
import { GameFiltersMenuComponent } from './game-filters-menu/game-filters-menu.component';

@NgModule({
  declarations: [GameListComponent, GameSearchComponent, GameFiltersMenuComponent],
  imports: [CommonModule, FormsModule, IonicModule],
  exports: [GameListComponent, GameSearchComponent, GameFiltersMenuComponent],
})
export class GameShelfFeaturesModule {}
