import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { GameListComponent } from './game-list/game-list.component';
import { GameSearchComponent } from './game-search/game-search.component';

@NgModule({
  declarations: [GameListComponent, GameSearchComponent],
  imports: [CommonModule, FormsModule, IonicModule],
  exports: [GameListComponent, GameSearchComponent],
})
export class GameShelfFeaturesModule {}
