import { Component, ViewChild, inject } from '@angular/core';
import { MenuController, PopoverController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameGroupByField, GameListFilters, ListType } from '../core/models/game.models';
import { GameListComponent } from '../features/game-list/game-list.component';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page {
  readonly groupByOptions: { value: GameGroupByField; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'platform', label: 'Platform' },
    { value: 'developer', label: 'Developer' },
    { value: 'franchise', label: 'Franchise' },
    { value: 'tag', label: 'Tag' },
    { value: 'genre', label: 'Genre' },
    { value: 'publisher', label: 'Publisher' },
    { value: 'releaseYear', label: 'Release Year' },
  ];
  readonly listType: ListType = 'collection';
  readonly preferenceStorageKey = 'game-shelf:preferences:collection';
  readonly menuId = 'collection-filters-menu';
  readonly contentId = 'collection-content';
  readonly headerActionsTriggerId = 'collection-header-actions';

  filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  platformOptions: string[] = [];
  displayedGames: GameEntry[] = [];
  listSearchQuery = '';
  groupBy: GameGroupByField = 'none';
  isAddGameModalOpen = false;
  @ViewChild(GameListComponent) private gameListComponent?: GameListComponent;
  private readonly menuController = inject(MenuController);
  private readonly popoverController = inject(PopoverController);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);

  constructor() {
    this.restorePreferences();
  }

  onFiltersChange(filters: GameListFilters): void {
    this.filters = {
      ...filters,
      sortField: this.isValidSortField(filters.sortField) ? filters.sortField : DEFAULT_GAME_LIST_FILTERS.sortField,
      sortDirection: filters.sortDirection === 'desc' ? 'desc' : 'asc',
    };
    this.persistPreferences();
  }

  onPlatformOptionsChange(platformOptions: string[]): void {
    this.platformOptions = platformOptions;

    if (this.filters.platform !== 'all' && !platformOptions.includes(this.filters.platform)) {
      this.filters = {
        ...this.filters,
        platform: 'all',
      };
    }
  }

  onListSearchChange(value: string | null | undefined): void {
    this.listSearchQuery = (value ?? '').replace(/^\s+/, '');
  }

  onDisplayedGamesChange(games: GameEntry[]): void {
    this.displayedGames = [...games];
  }

  openAddGameModal(): void {
    this.isAddGameModalOpen = true;
  }

  closeAddGameModal(): void {
    this.isAddGameModalOpen = false;
  }

  async openFiltersMenu(): Promise<void> {
    await this.menuController.open(this.menuId);
  }

  async pickRandomGameFromPopover(): Promise<void> {
    await this.popoverController.dismiss();

    if (this.displayedGames.length === 0) {
      await this.presentToast('No games available in current results.', 'warning');
      return;
    }

    const randomIndex = Math.floor(Math.random() * this.displayedGames.length);
    const randomGame = this.displayedGames[randomIndex];
    this.gameListComponent?.openGameDetail(randomGame);
  }

  async openSettingsFromPopover(): Promise<void> {
    await this.popoverController.dismiss();
    await this.router.navigateByUrl('/settings');
  }

  async openTagsFromPopover(): Promise<void> {
    await this.popoverController.dismiss();
    await this.router.navigateByUrl('/tags');
  }

  onGroupByChange(value: GameGroupByField | null | undefined): void {
    const validValues = this.groupByOptions.map(option => option.value);
    this.groupBy = value && validValues.includes(value) ? value : 'none';
    this.persistPreferences();
  }

  getDisplayedGamesLabel(): string {
    return this.displayedGames.length === 1 ? '1 game' : `${this.displayedGames.length} games`;
  }

  private async presentToast(message: string, color: 'primary' | 'warning' = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1500,
      position: 'bottom',
      color,
    });

    await toast.present();
  }

  private restorePreferences(): void {
    try {
      const raw = localStorage.getItem(this.preferenceStorageKey);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<{
        sortField: GameListFilters['sortField'];
        sortDirection: GameListFilters['sortDirection'];
        groupBy: GameGroupByField;
      }>;

      const sortField = this.isValidSortField(parsed.sortField) ? parsed.sortField : DEFAULT_GAME_LIST_FILTERS.sortField;
      const sortDirection = parsed.sortDirection === 'desc' ? 'desc' : 'asc';
      const validGroupByValues = this.groupByOptions.map(option => option.value);
      const groupBy = parsed.groupBy && validGroupByValues.includes(parsed.groupBy) ? parsed.groupBy : 'none';

      this.filters = {
        ...this.filters,
        sortField,
        sortDirection,
      };
      this.groupBy = groupBy;
    } catch {
      // Ignore invalid or unavailable storage and keep defaults.
    }
  }

  private persistPreferences(): void {
    try {
      localStorage.setItem(this.preferenceStorageKey, JSON.stringify({
        sortField: this.filters.sortField,
        sortDirection: this.filters.sortDirection,
        groupBy: this.groupBy,
      }));
    } catch {
      // Ignore storage failures.
    }
  }

  private isValidSortField(value: unknown): value is GameListFilters['sortField'] {
    return value === 'title' || value === 'releaseDate' || value === 'createdAt' || value === 'platform';
  }
}
