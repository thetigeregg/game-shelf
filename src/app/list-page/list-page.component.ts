import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MenuController,
  PopoverController,
  ToastController,
} from '@ionic/angular/standalone';
import {
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonTitle,
  IonSearchbar,
  IonContent,
  IonPopover,
  IonList,
  IonItem,
  IonModal,
  IonBadge,
  IonLoading,
} from '@ionic/angular/standalone';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameType,
  ListType,
} from '../core/models/game.models';
import {
  GameListComponent,
  GameListSelectionState,
  MetadataFilterSelection,
} from '../features/game-list/game-list.component';
import { GameSearchComponent } from '../features/game-search/game-search.component';
import { GameFiltersMenuComponent } from '../features/game-filters-menu/game-filters-menu.component';
import { GameShelfService } from '../core/services/game-shelf.service';
import {
  normalizeGameRatingFilterList,
  normalizeGameStatusFilterList,
  normalizeGameTypeList,
  normalizeNonNegativeNumber,
  normalizeStringList,
  normalizeTagFilterList,
} from '../core/utils/game-filter-utils';
import { addIcons } from 'ionicons';
import {
  close,
  filter,
  ellipsisHorizontal,
  checkbox,
  squareOutline,
  add,
  search,
} from 'ionicons/icons';

type ListPageConfig = {
  contentId: string;
  listType: ListType;
  menuId: string;
  pageTitle: 'Collection' | 'Wishlist';
  preferenceStorageKey: string;
  searchPlaceholder: string;
};

function buildConfig(listType: ListType): ListPageConfig {
  if (listType === 'wishlist') {
    return {
      contentId: 'wishlist-content',
      listType,
      menuId: 'wishlist-filters-menu',
      pageTitle: 'Wishlist',
      preferenceStorageKey: 'game-shelf:preferences:wishlist',
      searchPlaceholder: 'Search wishlist',
    };
  }

  return {
    contentId: 'collection-content',
    listType: 'collection',
    menuId: 'collection-filters-menu',
    pageTitle: 'Collection',
    preferenceStorageKey: 'game-shelf:preferences:collection',
    searchPlaceholder: 'Search collection',
  };
}

@Component({
  selector: 'app-list-page',
  templateUrl: './list-page.component.html',
  styleUrls: ['./list-page.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    GameListComponent,
    GameSearchComponent,
    GameFiltersMenuComponent,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonButton,
    IonIcon,
    IonTitle,
    IonSearchbar,
    IonContent,
    IonPopover,
    IonList,
    IonItem,
    IonBadge,
    IonModal,
    IonLoading,
  ],
})
export class ListPageComponent {
  readonly noneTagFilterValue = '__none__';
  readonly groupByOptions: { value: GameGroupByField; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'platform', label: 'Platform' },
    { value: 'developer', label: 'Developer' },
    { value: 'franchise', label: 'Franchise' },
    { value: 'collection', label: 'Series' },
    { value: 'tag', label: 'Tag' },
    { value: 'genre', label: 'Genre' },
    { value: 'publisher', label: 'Publisher' },
    { value: 'releaseYear', label: 'Release Year' },
  ];
  readonly listType: ListType;
  readonly preferenceStorageKey: string;
  readonly menuId: string;
  readonly contentId: string;
  readonly pageTitle: 'Collection' | 'Wishlist';
  readonly searchPlaceholder: string;

  filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
  platformOptions: string[] = [];
  collectionOptions: string[] = [];
  gameTypeOptions: GameType[] = [];
  genreOptions: string[] = [];
  tagOptions: string[] = [];
  displayedGames: GameEntry[] = [];
  totalGamesCount = 0;
  listSearchQuery = '';
  groupBy: GameGroupByField = 'none';
  isAddGameModalOpen = false;
  isSearchModalOpen = false;
  isSelectionMode = false;
  isInitialListLoading = true;
  selectedGamesCount = 0;
  allDisplayedSelected = false;
  isBulkActionsPopoverOpen = false;
  bulkActionsPopoverEvent: Event | undefined = undefined;
  isHeaderActionsPopoverOpen = false;
  headerActionsPopoverEvent: Event | undefined = undefined;
  @ViewChild(GameListComponent) private gameListComponent?: GameListComponent;
  @ViewChild('modalSearchbar') private modalSearchbar?: IonSearchbar;
  @ViewChild('pageContent', { read: ElementRef })
  private pageContentRef?: ElementRef<HTMLElement & { resize?: () => Promise<void> }>;
  private readonly menuController = inject(MenuController);
  private readonly popoverController = inject(PopoverController);
  private readonly toastController = inject(ToastController);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly gameShelfService = inject(GameShelfService);
  private receivedInitialListSnapshot = false;
  private searchbarFocusRetryHandle: ReturnType<typeof setTimeout> | null = null;
  private contentResizeRetryHandle: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const rawListType = this.route.snapshot.data['listType'];
    const config = buildConfig(
      rawListType === 'wishlist' ? 'wishlist' : 'collection',
    );
    this.listType = config.listType;
    this.preferenceStorageKey = config.preferenceStorageKey;
    this.menuId = config.menuId;
    this.contentId = config.contentId;
    this.pageTitle = config.pageTitle;
    this.searchPlaceholder = config.searchPlaceholder;

    this.restorePreferences();
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      void this.applyViewFromQueryParam(params.get('applyView'));
    });
    this.gameShelfService
      .watchList(this.listType)
      .pipe(takeUntilDestroyed())
      .subscribe((games) => {
        this.totalGamesCount = games.length;
        if (!this.receivedInitialListSnapshot) {
          this.receivedInitialListSnapshot = true;
          this.isInitialListLoading = false;
        }
      });
    addIcons({
      close,
      filter,
      ellipsisHorizontal,
      checkbox,
      squareOutline,
      add,
      search,
    });
  }

  onFiltersChange(filters: GameListFilters): void {
    const normalizedPlatforms = normalizeStringList(filters.platform);
    const normalizedGenres = normalizeStringList(filters.genres);
    const normalizedCollections = normalizeStringList(filters.collections);
    const normalizedDevelopers = normalizeStringList(filters.developers);
    const normalizedFranchises = normalizeStringList(filters.franchises);
    const normalizedPublishers = normalizeStringList(filters.publishers);
    const normalizedGameTypes = normalizeGameTypeList(filters.gameTypes);
    const normalizedStatuses = normalizeGameStatusFilterList(filters.statuses);
    const normalizedTags = normalizeTagFilterList(
      filters.tags,
      this.noneTagFilterValue,
    );
    const normalizedRatings = normalizeGameRatingFilterList(filters.ratings);
    const hltbMainHoursMin = normalizeNonNegativeNumber(
      filters.hltbMainHoursMin,
    );
    const hltbMainHoursMax = normalizeNonNegativeNumber(
      filters.hltbMainHoursMax,
    );

    this.filters = {
      ...filters,
      platform: normalizedPlatforms,
      collections: normalizedCollections,
      developers: normalizedDevelopers,
      franchises: normalizedFranchises,
      publishers: normalizedPublishers,
      gameTypes: normalizedGameTypes,
      genres: normalizedGenres,
      statuses: normalizedStatuses,
      tags: normalizedTags,
      ratings: normalizedRatings,
      hltbMainHoursMin:
        hltbMainHoursMin !== null &&
        hltbMainHoursMax !== null &&
        hltbMainHoursMin > hltbMainHoursMax
          ? hltbMainHoursMax
          : hltbMainHoursMin,
      hltbMainHoursMax:
        hltbMainHoursMin !== null &&
        hltbMainHoursMax !== null &&
        hltbMainHoursMin > hltbMainHoursMax
          ? hltbMainHoursMin
          : hltbMainHoursMax,
      sortField: this.isValidSortField(filters.sortField)
        ? filters.sortField
        : DEFAULT_GAME_LIST_FILTERS.sortField,
      sortDirection: filters.sortDirection === 'desc' ? 'desc' : 'asc',
    };
    this.persistPreferences();
  }

  onPlatformOptionsChange(platformOptions: string[]): void {
    this.platformOptions = platformOptions;
    const normalizedSelection = this.filters.platform.filter((platform) =>
      platformOptions.includes(platform),
    );

    if (normalizedSelection.length !== this.filters.platform.length) {
      this.filters = {
        ...this.filters,
        platform: normalizedSelection,
      };
    }
  }

  onGenreOptionsChange(genreOptions: string[]): void {
    this.genreOptions = genreOptions;
    const normalizedSelection = this.filters.genres.filter((genre) =>
      genreOptions.includes(genre),
    );

    if (normalizedSelection.length !== this.filters.genres.length) {
      this.filters = {
        ...this.filters,
        genres: normalizedSelection,
      };
    }
  }

  onCollectionOptionsChange(collectionOptions: string[]): void {
    this.collectionOptions = collectionOptions;
    const normalizedSelection = this.filters.collections.filter((collection) =>
      collectionOptions.includes(collection),
    );

    if (normalizedSelection.length !== this.filters.collections.length) {
      this.filters = {
        ...this.filters,
        collections: normalizedSelection,
      };
    }
  }

  onGameTypeOptionsChange(gameTypeOptions: GameType[]): void {
    this.gameTypeOptions = gameTypeOptions;
    const normalizedSelection = this.filters.gameTypes.filter((gameType) =>
      gameTypeOptions.includes(gameType),
    );

    if (normalizedSelection.length !== this.filters.gameTypes.length) {
      this.filters = {
        ...this.filters,
        gameTypes: normalizedSelection,
      };
    }
  }

  onTagOptionsChange(tagOptions: string[]): void {
    this.tagOptions = tagOptions;
    const normalizedSelection = this.filters.tags.filter(
      (tag) => tag === this.noneTagFilterValue || tagOptions.includes(tag),
    );

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

  openSearchModal(): void {
    this.isSearchModalOpen = true;
  }

  closeSearchModal(): void {
    this.isSearchModalOpen = false;
    if (this.searchbarFocusRetryHandle !== null) {
      clearTimeout(this.searchbarFocusRetryHandle);
      this.searchbarFocusRetryHandle = null;
    }
    if (this.contentResizeRetryHandle !== null) {
      clearTimeout(this.contentResizeRetryHandle);
      this.contentResizeRetryHandle = null;
    }
  }

  clearSearch(): void {
    this.listSearchQuery = '';
  }

  async focusSearchbar(): Promise<void> {
    if (!this.isSearchModalOpen) {
      return;
    }

    await this.modalSearchbar?.setFocus();

    if (this.searchbarFocusRetryHandle !== null) {
      clearTimeout(this.searchbarFocusRetryHandle);
    }

    this.searchbarFocusRetryHandle = setTimeout(() => {
      if (!this.isSearchModalOpen) {
        return;
      }

      void this.modalSearchbar?.setFocus();
      this.searchbarFocusRetryHandle = null;
    }, 120);
  }

  async onSearchModalDidPresent(): Promise<void> {
    this.resizePageContent();
    await this.focusSearchbar();
  }

  onSearchModalDidDismiss(): void {
    this.closeSearchModal();
    this.resizePageContent();
  }

  private resizePageContent(): void {
    void this.pageContentRef?.nativeElement.resize?.();

    if (this.contentResizeRetryHandle !== null) {
      clearTimeout(this.contentResizeRetryHandle);
    }

    this.contentResizeRetryHandle = setTimeout(() => {
      void this.pageContentRef?.nativeElement.resize?.();
      this.contentResizeRetryHandle = null;
    }, 120);
  }

  onDisplayedGamesChange(games: GameEntry[]): void {
    this.displayedGames = [...games];
  }

  onSelectionStateChange(state: GameListSelectionState): void {
    this.isSelectionMode = state.active;
    this.selectedGamesCount = state.selectedCount;
    this.allDisplayedSelected = state.allDisplayedSelected;

    if (!state.active) {
      this.closeBulkActionsPopover();
    }
  }

  onMetadataFilterSelected(selection: MetadataFilterSelection): void {
    const normalized =
      typeof selection.value === 'string' ? selection.value.trim() : '';

    if (normalized.length === 0) {
      return;
    }

    const nextFilters: GameListFilters = {
      ...DEFAULT_GAME_LIST_FILTERS,
    };

    if (selection.kind === 'series') {
      nextFilters.collections = [normalized];
    } else if (selection.kind === 'developer') {
      nextFilters.developers = [normalized];
    } else if (selection.kind === 'franchise') {
      nextFilters.franchises = [normalized];
    } else if (selection.kind === 'publisher') {
      nextFilters.publishers = [normalized];
    }

    this.filters = {
      ...nextFilters,
    };
    this.groupBy = 'none';
    this.listSearchQuery = '';
    this.persistPreferences();
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
    await this.closeHeaderActionsPopover();

    if (this.displayedGames.length === 0) {
      await this.presentToast(
        'No games available in current results.',
        'warning',
      );
      return;
    }

    const randomIndex = Math.floor(Math.random() * this.displayedGames.length);
    const randomGame = this.displayedGames[randomIndex];
    this.gameListComponent?.openGameDetail(randomGame);
  }

  async openSettingsFromPopover(): Promise<void> {
    await this.closeHeaderActionsPopover();
    await this.router.navigateByUrl('/settings');
  }

  async openTagsFromPopover(): Promise<void> {
    await this.closeHeaderActionsPopover();
    await this.router.navigateByUrl('/tags');
  }

  async openViewsFromPopover(): Promise<void> {
    await this.closeHeaderActionsPopover();
    await this.router.navigate(['/views'], {
      state: {
        listType: this.listType,
        filters: this.filters,
        groupBy: this.groupBy,
      },
    });
  }

  async activateMultiSelectFromPopover(): Promise<void> {
    await this.closeHeaderActionsPopover();
    this.gameListComponent?.activateSelectionMode();
  }

  getSelectionHeaderLabel(): string {
    return this.selectedGamesCount === 1
      ? '1 selected'
      : `${this.selectedGamesCount} selected`;
  }

  getMoveTargetLabel(): 'Collection' | 'Wishlist' {
    return this.listType === 'collection' ? 'Wishlist' : 'Collection';
  }

  getHeaderActionsAriaLabel(): string {
    return `Open ${this.listType} actions`;
  }

  getActiveFilterCount(): number {
    let count = 0;

    if (this.filters.platform.length > 0) {
      count += 1;
    }

    if (this.filters.genres.length > 0) {
      count += 1;
    }

    if (this.filters.collections.length > 0) {
      count += 1;
    }

    if (this.filters.developers.length > 0) {
      count += 1;
    }

    if (this.filters.franchises.length > 0) {
      count += 1;
    }

    if (this.filters.publishers.length > 0) {
      count += 1;
    }

    if (this.filters.gameTypes.length > 0) {
      count += 1;
    }

    if (this.filters.tags.length > 0) {
      count += 1;
    }

    if (this.filters.statuses.length > 0) {
      count += 1;
    }

    if (this.filters.ratings.length > 0) {
      count += 1;
    }

    if (
      this.filters.hltbMainHoursMin !== null ||
      this.filters.hltbMainHoursMax !== null
    ) {
      count += 1;
    }

    if (
      this.filters.releaseDateFrom !== null ||
      this.filters.releaseDateTo !== null
    ) {
      count += 1;
    }

    return count;
  }

  async clearSelectionMode(): Promise<void> {
    this.gameListComponent?.clearSelectionMode();
  }

  async toggleSelectAll(): Promise<void> {
    this.gameListComponent?.toggleSelectAllDisplayed();
  }

  async deleteSelectedGames(): Promise<void> {
    await this.gameListComponent?.deleteSelectedGames();
  }

  async moveSelectedGamesFromPopover(): Promise<void> {
    this.closeBulkActionsPopover();
    await this.gameListComponent?.moveSelectedGamesToOtherList();
  }

  async setTagsForSelectedGamesFromPopover(): Promise<void> {
    this.closeBulkActionsPopover();
    await this.gameListComponent?.setTagsForSelectedGames();
  }

  async setStatusForSelectedGamesFromPopover(): Promise<void> {
    this.closeBulkActionsPopover();
    await this.gameListComponent?.setStatusForSelectedGames();
  }

  async refreshMetadataForSelectedGamesFromPopover(): Promise<void> {
    this.closeBulkActionsPopover();
    await this.gameListComponent?.refreshMetadataForSelectedGames();
  }

  async updateHltbForSelectedGamesFromPopover(): Promise<void> {
    this.closeBulkActionsPopover();
    await this.gameListComponent?.updateHltbForSelectedGames();
  }

  openBulkActionsPopover(event: Event): void {
    this.bulkActionsPopoverEvent = event;
    this.isBulkActionsPopoverOpen = true;
  }

  openHeaderActionsPopover(event: Event): void {
    this.headerActionsPopoverEvent = event;
    this.isHeaderActionsPopoverOpen = true;
  }

  closeBulkActionsPopover(): void {
    this.isBulkActionsPopoverOpen = false;
    this.bulkActionsPopoverEvent = undefined;
  }

  async closeHeaderActionsPopover(): Promise<void> {
    this.isHeaderActionsPopoverOpen = false;
    this.headerActionsPopoverEvent = undefined;
    await this.popoverController.dismiss().catch(() => undefined);
  }

  onGroupByChange(value: GameGroupByField | null | undefined): void {
    const validValues = this.groupByOptions.map((option) => option.value);
    this.groupBy = value && validValues.includes(value) ? value : 'none';
    this.persistPreferences();
  }

  getDisplayedGamesLabel(): string {
    return this.displayedGames.length === 1
      ? '1 game'
      : `${this.displayedGames.length} games`;
  }

  getListCountSummary(): string {
    const count = Math.max(0, this.displayedGames.length);
    return count === 1 ? '1 game' : `${count} games`;
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'warning' = 'primary',
  ): Promise<void> {
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

      const sortField = this.isValidSortField(parsed.sortField)
        ? parsed.sortField
        : DEFAULT_GAME_LIST_FILTERS.sortField;
      const sortDirection = parsed.sortDirection === 'desc' ? 'desc' : 'asc';
      const validGroupByValues = this.groupByOptions.map(
        (option) => option.value,
      );
      const groupBy =
        parsed.groupBy && validGroupByValues.includes(parsed.groupBy)
          ? parsed.groupBy
          : 'none';

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
      localStorage.setItem(
        this.preferenceStorageKey,
        JSON.stringify({
          sortField: this.filters.sortField,
          sortDirection: this.filters.sortDirection,
          groupBy: this.groupBy,
        }),
      );
    } catch {
      // Ignore storage failures.
    }
  }

  private isValidSortField(
    value: unknown,
  ): value is GameListFilters['sortField'] {
    return (
      value === 'title' ||
      value === 'releaseDate' ||
      value === 'createdAt' ||
      value === 'platform'
    );
  }

  private async applyViewFromQueryParam(
    rawViewId: string | null,
  ): Promise<void> {
    const parsed = Number.parseInt(String(rawViewId ?? ''), 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      return;
    }

    try {
      const view = await this.gameShelfService.getView(parsed);

      if (!view || view.listType !== this.listType) {
        return;
      }

      this.filters = {
        ...DEFAULT_GAME_LIST_FILTERS,
        ...view.filters,
      };
      this.groupBy = view.groupBy;
      this.persistPreferences();
    } finally {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { applyView: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }
}
