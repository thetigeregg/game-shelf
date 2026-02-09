import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { PopoverController, ToastController } from '@ionic/angular';
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
  @Input() searchQuery = '';
  @Output() platformOptionsChange = new EventEmitter<string[]>();

  games$: Observable<GameEntry[]> = of([]);
  isGameDetailModalOpen = false;
  selectedGame: GameEntry | null = null;
  private readonly gameShelfService = inject(GameShelfService);
  private readonly popoverController = inject(PopoverController);
  private readonly toastController = inject(ToastController);
  private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });
  private readonly searchQuery$ = new BehaviorSubject<string>('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['listType']?.currentValue) {
      const allGames$ = this.gameShelfService.watchList(this.listType).pipe(
        tap(games => {
          this.platformOptionsChange.emit(this.extractPlatforms(games));
        })
      );

      this.games$ = combineLatest([allGames$, this.filters$, this.searchQuery$]).pipe(
        map(([games, filters, searchQuery]) => this.applyFiltersAndSort(games, filters, searchQuery))
      );
    }

    if (changes['filters']?.currentValue) {
      this.filters$.next(this.normalizeFilters(this.filters));
    }

    if (changes['searchQuery']) {
      this.searchQuery$.next((this.searchQuery ?? '').trim());
    }
  }

  async moveGame(game: GameEntry): Promise<void> {
    const targetList = this.getOtherListType();
    await this.gameShelfService.moveGame(game.externalId, targetList);
    await this.presentToast(`Moved to ${this.getListLabel(targetList)}.`);
  }

  async removeGame(game: GameEntry): Promise<void> {
    await this.gameShelfService.removeGame(game.externalId);
  }

  async moveGameFromPopover(game: GameEntry): Promise<void> {
    await this.moveGame(game);
    await this.popoverController.dismiss();
  }

  async removeGameFromPopover(game: GameEntry): Promise<void> {
    await this.removeGame(game);
    await this.popoverController.dismiss();
  }

  getOtherListLabel(): string {
    return this.listType === 'collection' ? 'Wishlist' : 'Collection';
  }

  openGameDetail(game: GameEntry): void {
    this.selectedGame = game;
    this.isGameDetailModalOpen = true;
  }

  closeGameDetailModal(): void {
    this.isGameDetailModalOpen = false;
    this.selectedGame = null;
  }

  getDetailActionsTriggerId(): string {
    return `game-detail-actions-trigger-${this.listType}`;
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

  getActionsTriggerId(game: GameEntry): string {
    return `game-actions-trigger-${game.externalId}`;
  }

  onActionsButtonClick(event: Event): void {
    event.stopPropagation();
  }

  async refreshSelectedGameMetadataFromPopover(): Promise<void> {
    await this.refreshSelectedGameMetadata();
    await this.popoverController.dismiss();
  }

  async refreshSelectedGameMetadata(): Promise<void> {
    if (!this.selectedGame) {
      return;
    }

    try {
      const updated = await this.gameShelfService.refreshGameMetadata(this.selectedGame.externalId);
      this.selectedGame = updated;
      await this.presentToast('Game metadata refreshed.');
    } catch {
      await this.presentToast('Unable to refresh game metadata.', 'danger');
    }
  }

  formatDate(value: string | null): string {
    if (!value) {
      return 'Unknown';
    }

    const timestamp = Date.parse(value);

    if (Number.isNaN(timestamp)) {
      return value;
    }

    return new Date(timestamp).toLocaleDateString();
  }

  private getOtherListType(): ListType {
    return this.listType === 'collection' ? 'wishlist' : 'collection';
  }

  private getListLabel(listType: ListType): string {
    return listType === 'collection' ? 'Collection' : 'Wishlist';
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

  private applyFiltersAndSort(games: GameEntry[], filters: GameListFilters, searchQuery: string): GameEntry[] {
    const filtered = games.filter(game => this.matchesFilters(game, filters, searchQuery));
    return this.sortGames(filtered, filters);
  }

  private matchesFilters(game: GameEntry, filters: GameListFilters, searchQuery: string): boolean {
    if (searchQuery.length > 0 && !game.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

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

  private async presentToast(message: string, color: 'primary' | 'danger' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color,
    });

    await toast.present();
  }
}
