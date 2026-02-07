import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { GameEntry, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
  standalone: false,
})
export class GameListComponent implements OnChanges {
  @Input({ required: true }) listType!: ListType;

  games$: Observable<GameEntry[]> = of([]);
  private readonly gameShelfService = inject(GameShelfService);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['listType']?.currentValue) {
      this.games$ = this.gameShelfService.watchList(this.listType);
    }
  }

  async moveGame(game: GameEntry): Promise<void> {
    await this.gameShelfService.moveGame(game.externalId, this.getOtherListType());
  }

  async removeGame(game: GameEntry): Promise<void> {
    await this.gameShelfService.removeGame(game.externalId);
  }

  getOtherListLabel(): string {
    return this.listType === 'collection' ? 'Wishlist' : 'Collection';
  }

  trackByExternalId(_: number, game: GameEntry): string {
    return game.externalId;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }

  private getOtherListType(): ListType {
    return this.listType === 'collection' ? 'wishlist' : 'collection';
  }
}
