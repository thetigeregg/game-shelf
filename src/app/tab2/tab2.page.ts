import { Component, ViewChild, inject } from '@angular/core';
import { MenuController, PopoverController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameGroupByField, GameListFilters, ListType } from '../core/models/game.models';
import { GameListComponent } from '../features/game-list/game-list.component';

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page {
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
  readonly listType: ListType = 'wishlist';
  readonly preferenceStorageKey = 'game-shelf:preferences:wishlist';
  readonly menuId = 'wishlist-filters-menu';
  readonly contentId = 'wishlist-content';
  readonly headerActionsTriggerId = 'wishlist-header-actions';

  filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  platformOptions: string[] = [];
  genreOptions: string[] = [];
  tagOptions: string[] = [];
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
    const normalizedPlatforms = Array.isArray(filters.platform)
      ? filters.platform.filter(platform => typeof platform === 'string' && platform.trim().length > 0)
      : [];
    const normalizedGenres = Array.isArray(filters.genres)
      ? filters.genres.filter(genre => typeof genre === 'string' && genre.trim().length > 0)
      : [];
    const normalizedTags = Array.isArray(filters.tags)
      ? filters.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0)
      : [];

    this.filters = {
      ...filters,
      platform: normalizedPlatforms,
      genres: normalizedGenres,
      tags: normalizedTags,
      sortField: this.isValidSortField(filters.sortField) ? filters.sortField : DEFAULT_GAME_LIST_FILTERS.sortField,
      sortDirection: filters.sortDirection === 'desc' ? 'desc' : 'asc',
    };
    this.persistPreferences();
  }

  onPlatformOptionsChange(platformOptions: string[]): void {
    this.platformOptions = platformOptions;
    const normalizedSelection = this.filters.platform.filter(platform => platformOptions.includes(platform));

    if (normalizedSelection.length !== this.filters.platform.length) {
      this.filters = {
        ...this.filters,
        platform: normalizedSelection,
      };
    }
  }

  onGenreOptionsChange(genreOptions: string[]): void {
    this.genreOptions = genreOptions;
    const normalizedSelection = this.filters.genres.filter(genre => genreOptions.includes(genre));

    if (normalizedSelection.length !== this.filters.genres.length) {
      this.filters = {
        ...this.filters,
        genres: normalizedSelection,
      };
    }
  }

  onTagOptionsChange(tagOptions: string[]): void {
    this.tagOptions = tagOptions;
    const normalizedSelection = this.filters.tags.filter(tag => tagOptions.includes(tag));

    if (normalizedSelection.length !== this.filters.tags.length) {
      this.filters = {
        ...this.filters,
        tags: normalizedSelection,
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
