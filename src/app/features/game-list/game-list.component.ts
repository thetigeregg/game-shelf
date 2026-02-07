import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameListFilters, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

@Component({
  selector: 'app-game-list',
  templateUrl: './game-list.component.html',
  styleUrls: ['./game-list.component.scss'],
  standalone: false,
})
export class GameListComponent implements OnChanges {
  @Input({ required: true }) listType!: ListType;
  @Input() filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  @Output() platformOptionsChange = new EventEmitter<string[]>();

  games$: Observable<GameEntry[]> = of([]);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['listType']?.currentValue) {
      const allGames$ = this.gameShelfService.watchList(this.listType).pipe(
        tap(games => {
          this.platformOptionsChange.emit(this.extractPlatforms(games));
        })
      );

      this.games$ = combineLatest([allGames$, this.filters$]).pipe(
        map(([games, filters]) => this.applyFiltersAndSort(games, filters))
      );
    }

    if (changes['filters']?.currentValue) {
      this.filters$.next(this.normalizeFilters(this.filters));
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

  private normalizeFilters(filters: GameListFilters): GameListFilters {
    return {
      ...DEFAULT_GAME_LIST_FILTERS,
      ...filters,
    };
  }

  private extractPlatforms(games: GameEntry[]): string[] {
    return [...new Set(
      games
        .map(game => game.platform?.trim() ?? '')
        .filter(platform => platform.length > 0)
    )].sort((a, b) => a.localeCompare(b));
  }

  private applyFiltersAndSort(games: GameEntry[], filters: GameListFilters): GameEntry[] {
    const filtered = games.filter(game => this.matchesFilters(game, filters));
    return this.sortGames(filtered, filters);
  }

  private matchesFilters(game: GameEntry, filters: GameListFilters): boolean {
    if (filters.platform !== 'all' && game.platform !== filters.platform) {
      return false;
    }

    const gameDate = this.getDateOnly(game.releaseDate);

    if (filters.releaseDateFrom && (!gameDate || gameDate < filters.releaseDateFrom)) {
      return false;
    }

    if (filters.releaseDateTo && (!gameDate || gameDate > filters.releaseDateTo)) {
      return false;
    }

    return true;
  }

  private sortGames(games: GameEntry[], filters: GameListFilters): GameEntry[] {
    const sorted = [...games].sort((left, right) => this.compareGames(left, right, filters.sortField));
    return filters.sortDirection === 'desc' ? sorted.reverse() : sorted;
  }

  private compareGames(left: GameEntry, right: GameEntry, sortField: GameListFilters['sortField']): number {
    if (sortField === 'title') {
      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    }

    const leftDate = this.getDateOnly(left.releaseDate);
    const rightDate = this.getDateOnly(right.releaseDate);

    if (leftDate && rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    if (leftDate) {
      return -1;
    }

    if (rightDate) {
      return 1;
    }

    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
  }

  private getDateOnly(releaseDate: string | null): string | null {
    if (typeof releaseDate !== 'string' || releaseDate.length < 10) {
      return null;
    }

    return releaseDate.slice(0, 10);
  }
}
