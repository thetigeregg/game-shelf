import { Component, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MenuController, PopoverController, ToastController } from '@ionic/angular/standalone';
import { IonHeader, IonToolbar, IonButtons, IonButton, IonIcon, IonTitle, IonSearchbar, IonContent, IonPopover, IonList, IonItem, IonFab, IonFabButton, IonModal, IonBadge } from '@ionic/angular/standalone';
import { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameGroupByField, GameListFilters, ListType } from '../core/models/game.models';
import { GameListComponent, GameListSelectionState } from '../features/game-list/game-list.component';
import { GameSearchComponent } from '../features/game-search/game-search.component';
import { GameFiltersMenuComponent } from '../features/game-filters-menu/game-filters-menu.component';
import { GameShelfService } from '../core/services/game-shelf.service';
import { addIcons } from 'ionicons';
import { close, filter, ellipsisHorizontal, checkbox, squareOutline, add } from 'ionicons/icons';

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
        IonFab,
        IonFabButton,
        IonModal,
    ],
})
export class ListPageComponent {
    readonly noneTagFilterValue = '__none__';
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
    readonly listType: ListType;
    readonly preferenceStorageKey: string;
    readonly menuId: string;
    readonly contentId: string;
    readonly pageTitle: 'Collection' | 'Wishlist';
    readonly searchPlaceholder: string;

    filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
    platformOptions: string[] = [];
    genreOptions: string[] = [];
    tagOptions: string[] = [];
    displayedGames: GameEntry[] = [];
    listSearchQuery = '';
    groupBy: GameGroupByField = 'none';
    isAddGameModalOpen = false;
    isSelectionMode = false;
    selectedGamesCount = 0;
    allDisplayedSelected = false;
    isBulkActionsPopoverOpen = false;
    bulkActionsPopoverEvent: Event | undefined = undefined;
    isHeaderActionsPopoverOpen = false;
    headerActionsPopoverEvent: Event | undefined = undefined;
    @ViewChild(GameListComponent) private gameListComponent?: GameListComponent;
    private readonly menuController = inject(MenuController);
    private readonly popoverController = inject(PopoverController);
    private readonly toastController = inject(ToastController);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly gameShelfService = inject(GameShelfService);

    constructor() {
        const rawListType = this.route.snapshot.data['listType'];
        const config = buildConfig(rawListType === 'wishlist' ? 'wishlist' : 'collection');
        this.listType = config.listType;
        this.preferenceStorageKey = config.preferenceStorageKey;
        this.menuId = config.menuId;
        this.contentId = config.contentId;
        this.pageTitle = config.pageTitle;
        this.searchPlaceholder = config.searchPlaceholder;

        this.restorePreferences();
        this.route.queryParamMap.subscribe(params => {
            void this.applyViewFromQueryParam(params.get('applyView'));
        });
        addIcons({ close, filter, ellipsisHorizontal, checkbox, squareOutline, add });
    }

    onFiltersChange(filters: GameListFilters): void {
        const normalizedPlatforms = Array.isArray(filters.platform)
            ? filters.platform.filter(platform => typeof platform === 'string' && platform.trim().length > 0)
            : [];
        const normalizedGenres = Array.isArray(filters.genres)
            ? filters.genres.filter(genre => typeof genre === 'string' && genre.trim().length > 0)
            : [];
        const normalizedStatuses = Array.isArray(filters.statuses)
            ? filters.statuses.filter(status =>
                status === 'none'
                || status === 'playing'
                || status === 'wantToPlay'
                || status === 'completed'
                || status === 'paused'
                || status === 'dropped'
                || status === 'replay'
            )
            : [];
        const normalizedTags = Array.isArray(filters.tags)
            ? filters.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0)
            : [];
        const normalizedRatings = Array.isArray(filters.ratings)
            ? filters.ratings.filter(rating =>
                rating === 'none'
                || rating === 1
                || rating === 2
                || rating === 3
                || rating === 4
                || rating === 5
            )
            : [];

        this.filters = {
            ...filters,
            platform: normalizedPlatforms,
            genres: normalizedGenres,
            statuses: normalizedStatuses,
            tags: normalizedTags,
            ratings: normalizedRatings,
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
        const normalizedSelection = this.filters.tags.filter(tag => tag === this.noneTagFilterValue || tagOptions.includes(tag));

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

    onSelectionStateChange(state: GameListSelectionState): void {
        this.isSelectionMode = state.active;
        this.selectedGamesCount = state.selectedCount;
        this.allDisplayedSelected = state.allDisplayedSelected;

        if (!state.active) {
            this.closeBulkActionsPopover();
        }
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
            await this.presentToast('No games available in current results.', 'warning');
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

    getSelectionHeaderLabel(): string {
        return this.selectedGamesCount === 1 ? '1 selected' : `${this.selectedGamesCount} selected`;
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

        if (this.filters.tags.length > 0) {
            count += 1;
        }

        if (this.filters.statuses.length > 0) {
            count += 1;
        }

        if (this.filters.ratings.length > 0) {
            count += 1;
        }

        if (this.filters.releaseDateFrom !== null || this.filters.releaseDateTo !== null) {
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

    private async applyViewFromQueryParam(rawViewId: string | null): Promise<void> {
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
