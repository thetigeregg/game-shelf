import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonItemSliding, LoadingController, PopoverController, ToastController } from '@ionic/angular/standalone';
import {
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonAccordionGroup,
    IonAccordion,
    IonIcon,
    IonBadge,
    IonItemOptions,
    IonItemOption,
    IonPopover,
    IonContent,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonSelect,
    IonSelectOption,
    IonSearchbar,
    IonSpinner,
    IonGrid,
    IonRow,
    IonCol,
    IonText,
    IonRange,
    IonNote,
    IonThumbnail,
    IonFab,
    IonFabButton,
    IonFabList
} from '@ionic/angular/standalone';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameCatalogResult,
    GameEntry,
    GameGroupByField,
    GameListFilters,
    HltbMatchCandidate,
    GameRatingFilterOption,
    GameRating,
    GameStatusFilterOption,
    GameStatus,
    GameType,
    ListType,
    Tag
} from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { GameListFilteringEngine, GameGroupSection, GroupedGamesView } from './game-list-filtering';
import { BulkActionResult, runBulkActionWithRetry } from './game-list-bulk-actions';
import { findSimilarLibraryGames, normalizeSimilarGameIds } from './game-list-similar';
import {
    createClosedHltbPickerState,
    createClosedImagePickerState,
    createOpenedHltbPickerState,
    createOpenedImagePickerState,
    dedupeHltbCandidates,
    normalizeMetadataOptions,
} from './game-list-detail-workflow';
import { GameSearchComponent } from '../game-search/game-search.component';
import { addIcons } from "ionicons";
import { star, ellipsisHorizontal, close, closeCircle, starOutline, play, trashBin, trophy, bookmark, pause, refresh, search, logoGoogle, logoYoutube, chevronBack } from "ionicons/icons";

export interface GameListSelectionState {
    active: boolean;
    selectedCount: number;
    allDisplayedSelected: boolean;
}

export type MetadataFilterKind = 'series' | 'developer' | 'franchise' | 'publisher';

export interface MetadataFilterSelection {
    kind: MetadataFilterKind;
    value: string;
}

@Component({
    selector: 'app-game-list',
    templateUrl: './game-list.component.html',
    styleUrls: ['./game-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: true,
    imports: [
        CommonModule,
        IonList,
        IonListHeader,
        IonItem,
        IonLabel,
        IonAccordionGroup,
        IonAccordion,
        IonItemSliding,
        IonIcon,
        IonBadge,
        IonItemOptions,
        IonItemOption,
        IonPopover,
        IonContent,
        IonModal,
        IonHeader,
        IonToolbar,
        IonTitle,
        IonButtons,
        IonButton,
        IonSelect,
        IonSelectOption,
        IonSearchbar,
        IonSpinner,
        IonGrid,
        IonRow,
        IonCol,
        IonText,
        IonRange,
        IonNote,
        IonThumbnail,
        IonFab,
        IonFabButton,
        IonFabList,
        GameSearchComponent,
    ],
})
export class GameListComponent implements OnChanges {
    private static readonly BULK_METADATA_CONCURRENCY = 3;
    private static readonly BULK_HLTB_CONCURRENCY = 2;
    private static readonly BULK_MAX_ATTEMPTS = 3;
    private static readonly BULK_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 15000;
    private static readonly BULK_RETRY_BASE_DELAY_MS = 1000;
    private static readonly BULK_HLTB_INTER_ITEM_DELAY_MS = 125;

    readonly noneTagFilterValue = '__none__';
    readonly ratingOptions: GameRating[] = [1, 2, 3, 4, 5];
    readonly statusOptions: { value: GameStatus; label: string }[] = [
        { value: 'playing', label: 'Playing' },
        { value: 'wantToPlay', label: 'Want to Play' },
        { value: 'completed', label: 'Completed' },
        { value: 'paused', label: 'Paused' },
        { value: 'dropped', label: 'Dropped' },
        { value: 'replay', label: 'Replay' },
    ];

    @Input({ required: true }) listType!: ListType;
    @Input() filters: GameListFilters = { ...DEFAULT_GAME_LIST_FILTERS };
    @Input() searchQuery = '';
    @Input() groupBy: GameGroupByField = 'none';
    @Output() platformOptionsChange = new EventEmitter<string[]>();
    @Output() collectionOptionsChange = new EventEmitter<string[]>();
    @Output() gameTypeOptionsChange = new EventEmitter<GameType[]>();
    @Output() genreOptionsChange = new EventEmitter<string[]>();
    @Output() tagOptionsChange = new EventEmitter<string[]>();
    @Output() displayedGamesChange = new EventEmitter<GameEntry[]>();
    @Output() selectionStateChange = new EventEmitter<GameListSelectionState>();
    @Output() metadataFilterSelected = new EventEmitter<MetadataFilterSelection>();

    games$: Observable<GameEntry[]> = of([]);
    groupedView$: Observable<GroupedGamesView> = of({ grouped: false, sections: [], totalCount: 0 });
    isGameDetailModalOpen = false;
    isImagePickerModalOpen = false;
    isFixMatchModalOpen = false;
    isRatingModalOpen = false;
    isHltbUpdateLoading = false;
    isHltbPickerModalOpen = false;
    isHltbPickerLoading = false;
    hasHltbPickerSearched = false;
    selectedGame: GameEntry | null = null;
    detailNavigationStack: GameEntry[] = [];
    similarLibraryGames: GameEntry[] = [];
    isSimilarLibraryGamesLoading = false;
    ratingTargetGame: GameEntry | null = null;
    ratingDraft: GameRating = 3;
    clearRatingOnSave = false;
    imagePickerQuery = '';
    imagePickerResults: string[] = [];
    isImagePickerLoading = false;
    imagePickerError: string | null = null;
    hltbPickerQuery = '';
    hltbPickerResults: HltbMatchCandidate[] = [];
    hltbPickerError: string | null = null;
    hltbPickerTargetGame: GameEntry | null = null;
    isMetadataPickerModalOpen = false;
    metadataPickerTitle = 'Select Value';
    metadataPickerKind: MetadataFilterKind | null = null;
    metadataPickerOptions: string[] = [];
    metadataPickerSelection: string | null = null;
    detailTextExpanded = {
        summary: false,
        storyline: false,
    };
    fixMatchInitialQuery = '';
    fixMatchInitialPlatformIgdbId: number | null = null;
    selectionModeActive = false;
    isRowActionsPopoverOpen = false;
    rowActionsPopoverEvent: Event | undefined = undefined;
    rowActionsGame: GameEntry | null = null;
    expandedSectionKeys: string[] = [];
    selectedGameKeys = new Set<string>();
    private readonly rowCoverUrlByGameKey = new Map<string, string>();
    private readonly detailCoverUrlByGameKey = new Map<string, string>();
    private readonly rowCoverLoadingGameKeys = new Set<string>();
    private readonly detailCoverLoadingGameKeys = new Set<string>();
    private displayedGames: GameEntry[] = [];
    private readonly filteringEngine = new GameListFilteringEngine(this.noneTagFilterValue);
    private imagePickerSearchRequestId = 0;
    private similarLibraryLoadRequestId = 0;
    private rowActionsSlidingItem: IonItemSliding | null = null;
    private longPressTimerId: ReturnType<typeof setTimeout> | null = null;
    private longPressTriggeredExternalId: string | null = null;
    private readonly gameShelfService = inject(GameShelfService);
    private readonly popoverController = inject(PopoverController);
    private readonly alertController = inject(AlertController);
    private readonly loadingController = inject(LoadingController);
    private readonly toastController = inject(ToastController);
    private readonly imageCacheService = inject(ImageCacheService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);
    private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });
    private readonly searchQuery$ = new BehaviorSubject<string>('');
    private readonly groupBy$ = new BehaviorSubject<GameGroupByField>('none');
    @ViewChild('detailContent') private detailContent?: IonContent;

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['listType']?.currentValue) {
            const allGames$ = this.gameShelfService.watchList(this.listType).pipe(
                tap(games => {
                    this.platformOptionsChange.emit(this.extractPlatforms(games));
                    this.collectionOptionsChange.emit(this.extractCollections(games));
                    this.gameTypeOptionsChange.emit(this.extractGameTypes(games));
                    this.genreOptionsChange.emit(this.extractGenres(games));
                    this.tagOptionsChange.emit(this.extractTags(games));
                })
            );

            this.games$ = combineLatest([allGames$, this.filters$, this.searchQuery$]).pipe(
                map(([games, filters, searchQuery]) => this.applyFiltersAndSort(games, filters, searchQuery)),
                tap(games => {
                    this.displayedGames = [...games];
                    this.syncSelectionWithDisplayedGames();
                    this.displayedGamesChange.emit(games);
                    this.emitSelectionState();
                })
            );

            this.groupedView$ = combineLatest([this.games$, this.groupBy$]).pipe(
                map(([games, groupBy]) => {
                    const groupedView = this.buildGroupedView(games, groupBy);

                    if (groupedView.grouped) {
                        this.syncExpandedSectionKeys(groupedView.sections);
                    } else if (this.expandedSectionKeys.length > 0) {
                        this.expandedSectionKeys = [];
                    }

                    return groupedView;
                })
            );
        }

        if (changes['filters']?.currentValue) {
            this.filters$.next(this.normalizeFilters(this.filters));
        }

        if (changes['searchQuery']) {
            this.searchQuery$.next((this.searchQuery ?? '').trim());
        }

        if (changes['groupBy']) {
            this.groupBy$.next(this.groupBy ?? 'none');
        }
    }

    async moveGame(game: GameEntry): Promise<void> {
        const targetList = this.getOtherListType();
        await this.gameShelfService.moveGame(game.igdbGameId, game.platformIgdbId, targetList);
        await this.presentToast(`Moved to ${this.getListLabel(targetList)}.`);
    }

    async removeGame(game: GameEntry): Promise<void> {
        await this.gameShelfService.removeGame(game.igdbGameId, game.platformIgdbId);
    }

    async moveGameFromPopover(game: GameEntry): Promise<void> {
        await this.moveGame(game);
        await this.popoverController.dismiss();
    }

    async removeGameFromPopover(game: GameEntry): Promise<void> {
        await this.popoverController.dismiss();

        const confirmed = await this.confirmDelete({
            header: 'Delete Game',
            message: `Delete ${game.title}?`,
            confirmText: 'Delete',
        });

        if (!confirmed) {
            return;
        }

        await this.removeGame(game);
    }

    async openTagsForGameFromPopover(game: GameEntry): Promise<void> {
        await this.popoverController.dismiss();
        await this.openTagsPicker(game);
    }

    async openStatusForGameFromPopover(game: GameEntry): Promise<void> {
        await this.popoverController.dismiss();
        await this.openStatusPicker(game);
    }

    async openRatingForGameFromPopover(game: GameEntry): Promise<void> {
        await this.popoverController.dismiss();
        await this.openRatingPicker(game);
    }

    getOtherListLabel(): string {
        return this.listType === 'collection' ? 'Wishlist' : 'Collection';
    }

    onGameRowClick(game: GameEntry, fromSimilarDetailSection = false): void {
        if (this.longPressTriggeredExternalId === this.getGameKey(game)) {
            this.longPressTriggeredExternalId = null;
            return;
        }

        if (this.selectionModeActive) {
            this.toggleGameSelection(this.getGameKey(game));
            return;
        }

        if (fromSimilarDetailSection) {
            this.openSimilarGameDetail(game);
            return;
        }

        this.openGameDetail(game);
    }

    onRowPressStart(game: GameEntry): void {
        this.clearLongPressTimer();
        this.longPressTimerId = setTimeout(() => {
            const gameKey = this.getGameKey(game);
            this.longPressTriggeredExternalId = gameKey;
            this.enterSelectionModeWithGame(gameKey);
        }, 450);
    }

    onRowPressEnd(): void {
        this.clearLongPressTimer();
    }

    isGameSelected(gameKey: string): boolean {
        return this.selectedGameKeys.has(gameKey);
    }

    isAllDisplayedSelected(): boolean {
        return this.displayedGames.length > 0 && this.selectedGameKeys.size === this.displayedGames.length;
    }

    clearSelectionMode(): void {
        this.selectionModeActive = false;
        this.selectedGameKeys.clear();
        this.emitSelectionState();
        this.changeDetectorRef.markForCheck();
    }

    toggleSelectAllDisplayed(): void {
        if (this.displayedGames.length === 0) {
            return;
        }

        if (this.isAllDisplayedSelected()) {
            this.clearSelectionMode();
            return;
        }

        this.selectedGameKeys = new Set(this.displayedGames.map(game => this.getGameKey(game)));
        this.selectionModeActive = true;
        this.emitSelectionState();
        this.changeDetectorRef.markForCheck();
    }

    async deleteSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        const confirmed = await this.confirmDelete({
            header: 'Delete Selected Games',
            message: `Delete ${selectedGames.length} selected game${selectedGames.length === 1 ? '' : 's'}?`,
            confirmText: 'Delete',
        });

        if (!confirmed) {
            return;
        }

        await Promise.all(selectedGames.map(game => this.gameShelfService.removeGame(game.igdbGameId, game.platformIgdbId)));
        this.clearSelectionMode();
        await this.presentToast(`${selectedGames.length} game${selectedGames.length === 1 ? '' : 's'} deleted.`);
    }

    async moveSelectedGamesToOtherList(): Promise<void> {
        const selectedGames = this.getSelectedGames();
        const targetList = this.getOtherListType();

        if (selectedGames.length === 0) {
            return;
        }

        await Promise.all(selectedGames.map(game => this.gameShelfService.moveGame(game.igdbGameId, game.platformIgdbId, targetList)));
        this.clearSelectionMode();
        await this.presentToast(`Moved ${selectedGames.length} game${selectedGames.length === 1 ? '' : 's'} to ${this.getListLabel(targetList)}.`);
    }

    async setStatusForSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        let nextStatus: GameStatus | null = null;
        const alert = await this.alertController.create({
            header: 'Set Status',
            message: `Apply status to ${selectedGames.length} selected game${selectedGames.length === 1 ? '' : 's'}.`,
            inputs: this.statusOptions.map(option => ({
                type: 'radio' as const,
                label: option.label,
                value: option.value,
                checked: false,
            })),
            buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                    text: 'Clear',
                    role: 'destructive',
                    handler: () => {
                        nextStatus = null;
                    },
                },
                {
                    text: 'Apply',
                    role: 'confirm',
                    handler: (value: string | null | undefined) => {
                        nextStatus = this.normalizeStatus(value);
                    },
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm' && role !== 'destructive') {
            return;
        }

        await Promise.all(selectedGames.map(game => this.gameShelfService.setGameStatus(game.igdbGameId, game.platformIgdbId, nextStatus)));
        this.clearSelectionMode();
        await this.presentToast('Status updated.');
    }

    async setTagsForSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        const tags = await this.gameShelfService.listTags();

        if (tags.length === 0) {
            await this.presentToast('Create a tag first from the Tags page.');
            return;
        }

        let nextTagIds: number[] = [];
        const alert = await this.alertController.create({
            header: 'Set Tags',
            message: `Apply tags to ${selectedGames.length} selected game${selectedGames.length === 1 ? '' : 's'}.`,
            inputs: tags.map(tag => this.buildTagInput(tag, [])),
            buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                    text: 'Apply',
                    role: 'confirm',
                    handler: (value: string[] | string | null | undefined) => {
                        nextTagIds = this.parseTagSelection(value);
                    },
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm') {
            return;
        }

        await Promise.all(selectedGames.map(game => this.gameShelfService.setGameTags(game.igdbGameId, game.platformIgdbId, nextTagIds)));
        this.clearSelectionMode();
        await this.presentToast('Tags updated.');
    }

    async refreshMetadataForSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        const results = await this.runBulkAction(
            selectedGames,
            {
                loadingPrefix: 'Refreshing metadata',
                concurrency: GameListComponent.BULK_METADATA_CONCURRENCY,
                interItemDelayMs: 0,
            },
            game => this.gameShelfService.refreshGameMetadata(game.igdbGameId, game.platformIgdbId),
        );
        const updatedCount = results.filter(result => result.ok).length;
        const failedCount = results.length - updatedCount;
        const failedRateLimitCount = results.filter(result => !result.ok && result.errorReason === 'rate_limit').length;
        const failedNonRateLimitCount = results.filter(result => !result.ok && result.errorReason !== 'rate_limit').length;

        this.clearSelectionMode();

        if (updatedCount > 0) {
            await this.presentToast(`Refreshed metadata for ${updatedCount} game${updatedCount === 1 ? '' : 's'}.`);
        }

        if (failedNonRateLimitCount > 0) {
            await this.presentToast(
                `Unable to refresh metadata for ${failedNonRateLimitCount} game${failedNonRateLimitCount === 1 ? '' : 's'}.`,
                'danger',
            );
            return;
        }

        if (failedRateLimitCount > 0) {
            await this.presentToast(
                `Rate limited for ${failedRateLimitCount} game${failedRateLimitCount === 1 ? '' : 's'} after retries. Try again shortly.`,
                'warning',
            );
            return;
        }

        if (failedCount > 0) {
            await this.presentToast('Unable to refresh metadata for selected games.', 'danger');
        }
    }

    async updateHltbForSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        const results = await this.runBulkAction(
            selectedGames,
            {
                loadingPrefix: 'Updating HLTB data',
                concurrency: GameListComponent.BULK_HLTB_CONCURRENCY,
                interItemDelayMs: GameListComponent.BULK_HLTB_INTER_ITEM_DELAY_MS,
            },
            game => this.gameShelfService.refreshGameCompletionTimes(game.igdbGameId, game.platformIgdbId),
        );
        const failedCount = results.filter(result => !result.ok).length;
        const updatedCount = results.filter(result => result.ok && result.value && this.hasHltbData(result.value)).length;
        const missingCount = results.length - failedCount - updatedCount;

        this.clearSelectionMode();

        if (updatedCount > 0) {
            await this.presentToast(`Updated HLTB data for ${updatedCount} game${updatedCount === 1 ? '' : 's'}.`);
        } else if (missingCount > 0 && failedCount === 0) {
            await this.presentToast('No HLTB matches found for selected games.', 'warning');
        }

        if (failedCount > 0) {
            await this.presentToast(`Unable to update HLTB data for ${failedCount} selected game${failedCount === 1 ? '' : 's'}.`, 'danger');
        }
    }

    openGameDetail(game: GameEntry): void {
        this.detailNavigationStack = [];
        this.openGameDetailInternal(game);
    }

    goBackInDetailNavigation(): void {
        const previous = this.detailNavigationStack.pop();

        if (!previous) {
            return;
        }

        this.openGameDetailInternal(previous);
    }

    private openSimilarGameDetail(game: GameEntry): void {
        if (!this.selectedGame) {
            this.openGameDetail(game);
            return;
        }

        if (this.getGameKey(this.selectedGame) === this.getGameKey(game)) {
            return;
        }

        this.detailNavigationStack.push(this.selectedGame);
        this.openGameDetailInternal(game);
    }

    private openGameDetailInternal(game: GameEntry): void {
        this.selectedGame = game;
        this.isGameDetailModalOpen = true;
        this.resetDetailTextExpansion();
        this.resetImagePickerState();
        this.changeDetectorRef.markForCheck();
        void this.loadDetailCoverUrl(game);
        void this.loadSimilarLibraryGamesForDetail(game);
        this.scrollDetailToTop();
    }

    private scrollDetailToTop(): void {
        window.requestAnimationFrame(() => {
            void this.detailContent?.scrollToTop(180);
        });
    }

    closeGameDetailModal(): void {
        this.isGameDetailModalOpen = false;
        this.isImagePickerModalOpen = false;
        this.isHltbPickerModalOpen = false;
        this.isMetadataPickerModalOpen = false;
        this.selectedGame = null;
        this.detailNavigationStack = [];
        this.similarLibraryGames = [];
        this.isSimilarLibraryGamesLoading = false;
        this.similarLibraryLoadRequestId += 1;
        this.resetDetailTextExpansion();
        this.resetImagePickerState();
        this.resetHltbPickerState();
        this.changeDetectorRef.markForCheck();
    }

    isDetailTextExpanded(field: 'summary' | 'storyline'): boolean {
        return this.detailTextExpanded[field];
    }

    toggleDetailText(field: 'summary' | 'storyline'): void {
        this.detailTextExpanded[field] = !this.detailTextExpanded[field];
        this.changeDetectorRef.markForCheck();
    }

    shouldShowDetailTextToggle(value: string | null | undefined): boolean {
        const normalized = typeof value === 'string' ? value.trim() : '';
        return normalized.length > 260;
    }

    onSeriesItemClick(game: GameEntry): void {
        this.openMetadataFilterSelection('series', game.collections, 'Select Series');
    }

    onDeveloperItemClick(game: GameEntry): void {
        this.openMetadataFilterSelection('developer', game.developers, 'Select Developer');
    }

    onFranchiseItemClick(game: GameEntry): void {
        this.openMetadataFilterSelection('franchise', game.franchises, 'Select Franchise');
    }

    onPublisherItemClick(game: GameEntry): void {
        this.openMetadataFilterSelection('publisher', game.publishers, 'Select Publisher');
    }

    closeMetadataPickerModal(): void {
        this.isMetadataPickerModalOpen = false;
        this.metadataPickerTitle = 'Select Value';
        this.metadataPickerKind = null;
        this.metadataPickerOptions = [];
        this.metadataPickerSelection = null;
        this.changeDetectorRef.markForCheck();
    }

    onMetadataPickerSelectionChange(value: string | null | undefined): void {
        const normalized = typeof value === 'string' ? value.trim() : '';
        this.metadataPickerSelection = normalized.length > 0 ? normalized : null;
    }

    applySelectedMetadataFilterFromPicker(): void {
        const selected = typeof this.metadataPickerSelection === 'string' ? this.metadataPickerSelection.trim() : '';

        if (selected.length === 0 || !this.metadataPickerKind) {
            return;
        }

        this.applyMetadataFilterSelection(this.metadataPickerKind, selected);
    }

    closeRatingModal(): void {
        this.isRatingModalOpen = false;
        this.ratingTargetGame = null;
        this.ratingDraft = 3;
        this.clearRatingOnSave = false;
        this.changeDetectorRef.markForCheck();
    }

    onRatingRangeChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: number | null }>;
        const normalized = this.normalizeRating(customEvent.detail?.value);

        if (normalized !== null) {
            this.ratingDraft = normalized;
            this.clearRatingOnSave = false;
        }
    }

    markRatingForClear(): void {
        this.clearRatingOnSave = true;
    }

    async saveRatingFromModal(): Promise<void> {
        if (!this.ratingTargetGame) {
            return;
        }

        const target = this.ratingTargetGame;
        const nextRating = this.clearRatingOnSave ? null : this.ratingDraft;

        try {
            const updated = await this.gameShelfService.setGameRating(target.igdbGameId, target.platformIgdbId, nextRating);

            if (this.selectedGame && this.getGameKey(this.selectedGame) === this.getGameKey(updated)) {
                this.selectedGame = updated;
            }

            await this.presentToast('Game rating updated.');
            this.closeRatingModal();
        } catch {
            await this.presentToast('Unable to update game rating.', 'danger');
        }
    }

    getDetailActionsTriggerId(): string {
        return `game-detail-actions-trigger-${this.listType}`;
    }

    getDetailActionsPopoverId(): string {
        return `game-detail-actions-popover-${this.listType}`;
    }

    trackByExternalId(_: number, game: GameEntry): string {
        return `${game.igdbGameId}::${game.platformIgdbId}`;
    }

    trackBySectionKey(_: number, section: GameGroupSection): string {
        return section.key;
    }

    onGroupedAccordionChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string | string[] | null }>;
        const rawValue = customEvent.detail?.value;

        if (Array.isArray(rawValue)) {
            this.expandedSectionKeys = rawValue
                .filter(value => typeof value === 'string')
                .map(value => value.trim())
                .filter(value => value.length > 0);
            return;
        }

        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
            this.expandedSectionKeys = [rawValue.trim()];
            return;
        }

        this.expandedSectionKeys = [];
        this.changeDetectorRef.markForCheck();
    }

    onImageError(event: Event): void {
        const target = event.target;

        if (target instanceof HTMLImageElement) {
            target.src = 'assets/icon/favicon.png';
        }
    }

    openRowActionsPopover(game: GameEntry, event: Event, slidingItem: IonItemSliding): void {
        event.stopPropagation();
        this.rowActionsGame = game;
        this.rowActionsPopoverEvent = event;
        this.rowActionsSlidingItem = slidingItem;
        this.isRowActionsPopoverOpen = true;
    }

    onActionsOptionSwipe(game: GameEntry, slidingItem: IonItemSliding, event?: Event): void {
        this.rowActionsGame = game;
        this.rowActionsPopoverEvent = this.resolveRowActionsPopoverEvent(event, slidingItem);
        this.rowActionsSlidingItem = slidingItem;
        this.isRowActionsPopoverOpen = true;
    }

    onRowActionsPopoverDismiss(): void {
        this.isRowActionsPopoverOpen = false;
        this.rowActionsPopoverEvent = undefined;
        this.rowActionsGame = null;
        const slidingItem = this.rowActionsSlidingItem;
        this.rowActionsSlidingItem = null;
        void slidingItem?.close();
    }

    async refreshSelectedGameMetadataFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();
        await this.refreshSelectedGameMetadata();
    }

    async refreshSelectedGameCompletionTimesFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();
        await this.refreshSelectedGameCompletionTimes();
    }

    async openImagePickerFromPopover(): Promise<void> {
        await this.openImagePickerModal();
        await this.dismissDetailActionsPopover();
    }

    async openFixMatchFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();
        this.openFixMatchModal();
    }

    async deleteSelectedGameFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();

        if (!this.selectedGame) {
            return;
        }

        const target = this.selectedGame;
        const confirmed = await this.confirmDelete({
            header: 'Delete Game',
            message: `Delete ${target.title}?`,
            confirmText: 'Delete',
        });

        if (!confirmed) {
            return;
        }

        await this.removeGame(target);
        this.closeGameDetailModal();
    }

    openFixMatchModal(): void {
        if (!this.selectedGame) {
            return;
        }

        this.fixMatchInitialQuery = this.selectedGame.title;
        this.fixMatchInitialPlatformIgdbId = this.selectedGame.platformIgdbId;
        this.isFixMatchModalOpen = true;
        this.changeDetectorRef.markForCheck();
    }

    closeFixMatchModal(): void {
        this.isFixMatchModalOpen = false;
        this.fixMatchInitialQuery = '';
        this.fixMatchInitialPlatformIgdbId = null;
        this.changeDetectorRef.markForCheck();
    }

    async onFixMatchSelected(result: GameCatalogResult): Promise<void> {
        if (!this.selectedGame) {
            this.closeFixMatchModal();
            return;
        }

        const current = this.selectedGame;

        try {
            const updated = await this.gameShelfService.rematchGame(current.igdbGameId, current.platformIgdbId, result);
            this.applyUpdatedGame(updated, { refreshCover: true });
            this.closeFixMatchModal();
            await this.presentToast('Game match updated.');
        } catch {
            await this.presentToast('Unable to update game match.', 'danger');
        }
    }

    async openSelectedGameTagsFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();

        if (!this.selectedGame) {
            return;
        }

        await this.openTagsPicker(this.selectedGame);
    }

    async openSelectedGameTagsFromDetail(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        await this.openTagsPicker(this.selectedGame);
    }

    async onSelectedGameStatusChange(value: GameStatus | null | undefined): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        const normalized = this.normalizeStatus(value);

        try {
            const updated = await this.gameShelfService.setGameStatus(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId, normalized);
            this.applyUpdatedGame(updated);
            await this.presentToast('Game status updated.');
        } catch {
            await this.presentToast('Unable to update game status.', 'danger');
        }
    }

    async clearSelectedGameStatus(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameStatus(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId, null);
            this.applyUpdatedGame(updated);
            await this.presentToast('Game status cleared.');
        } catch {
            await this.presentToast('Unable to clear game status.', 'danger');
        }
    }

    async onSelectedGameRatingChange(value: GameRating | number | null | undefined): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        const normalized = this.normalizeRating(value);

        try {
            const updated = await this.gameShelfService.setGameRating(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId, normalized);
            this.applyUpdatedGame(updated);
            await this.presentToast('Game rating updated.');
        } catch {
            await this.presentToast('Unable to update game rating.', 'danger');
        }
    }

    async clearSelectedGameRating(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameRating(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId, null);
            this.applyUpdatedGame(updated);
            await this.presentToast('Game rating cleared.');
        } catch {
            await this.presentToast('Unable to clear game rating.', 'danger');
        }
    }

    async refreshSelectedGameMetadata(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.refreshGameMetadata(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId);
            this.applyUpdatedGame(updated, { refreshCover: true });
            await this.presentToast('Game metadata refreshed.');
        } catch {
            await this.presentToast('Unable to refresh game metadata.', 'danger');
        }
    }

    async refreshSelectedGameCompletionTimes(): Promise<void> {
        if (!this.selectedGame || this.isHltbUpdateLoading) {
            return;
        }

        this.isHltbUpdateLoading = true;
        const loading = await this.loadingController.create({
            message: 'Updating HLTB data...',
            spinner: 'crescent',
        });
        await loading.present();

        try {
            const updated = await this.gameShelfService.refreshGameCompletionTimes(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId);
            this.applyUpdatedGame(updated);
            await loading.dismiss().catch(() => undefined);

            if (this.hasHltbData(updated)) {
                await this.presentToast('HLTB data updated.');
            } else {
                await this.openHltbPickerModal(updated);
            }
        } catch {
            await loading.dismiss().catch(() => undefined);
            await this.presentToast('Unable to update HLTB data.', 'danger');
        } finally {
            this.isHltbUpdateLoading = false;
        }
    }

    closeImagePickerModal(): void {
        const nextState = createClosedImagePickerState(this.imagePickerSearchRequestId);
        this.imagePickerSearchRequestId = nextState.imagePickerSearchRequestId;
        this.imagePickerQuery = nextState.imagePickerQuery;
        this.imagePickerResults = nextState.imagePickerResults;
        this.imagePickerError = nextState.imagePickerError;
        this.isImagePickerLoading = nextState.isImagePickerLoading;
        this.isImagePickerModalOpen = nextState.isImagePickerModalOpen;
        this.changeDetectorRef.markForCheck();
    }

    closeHltbPickerModal(): void {
        this.resetHltbPickerState();
        this.changeDetectorRef.markForCheck();
    }

    async runImagePickerSearch(): Promise<void> {
        const requestId = ++this.imagePickerSearchRequestId;
        const normalized = this.imagePickerQuery.trim();

        if (normalized.length < 2) {
            this.ngZone.run(() => {
                if (requestId !== this.imagePickerSearchRequestId) {
                    return;
                }

                this.imagePickerResults = [];
                this.imagePickerError = null;
                this.isImagePickerLoading = false;
                this.changeDetectorRef.markForCheck();
            });
            return;
        }

        this.ngZone.run(() => {
            if (requestId !== this.imagePickerSearchRequestId) {
                return;
            }

            this.isImagePickerLoading = true;
            this.imagePickerError = null;
            this.imagePickerResults = [];
            this.changeDetectorRef.markForCheck();
        });

        try {
            const results = await Promise.race([
                firstValueFrom(this.gameShelfService.searchBoxArtByTitle(
                    normalized,
                    this.selectedGame?.platform ?? null,
                    this.selectedGame?.platformIgdbId ?? null,
                    this.selectedGame?.igdbGameId,
                )),
                this.delayReject<string[]>(10000, 'image_picker_search_timeout'),
            ]);

            this.ngZone.run(() => {
                if (requestId !== this.imagePickerSearchRequestId) {
                    return;
                }

                this.imagePickerResults = results;
            });
        } catch {
            this.ngZone.run(() => {
                if (requestId !== this.imagePickerSearchRequestId) {
                    return;
                }

                this.imagePickerResults = [];
                this.imagePickerError = 'Unable to load box art results.';
            });
        } finally {
            this.ngZone.run(() => {
                if (requestId !== this.imagePickerSearchRequestId) {
                    return;
                }

                this.isImagePickerLoading = false;
                this.changeDetectorRef.markForCheck();
            });
        }
    }

    onImagePickerQueryChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string }>;
        this.imagePickerQuery = (customEvent.detail?.value ?? '').replace(/^\s+/, '');
    }

    onHltbPickerQueryChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string | null }>;
        this.hltbPickerQuery = String(customEvent.detail?.value ?? '');
    }

    async applySelectedImage(url: string): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const coverSource = this.gameShelfService.shouldUseIgdbCoverForPlatform(
                this.selectedGame.platform,
                this.selectedGame.platformIgdbId,
            ) ? 'igdb' : 'thegamesdb';
            const updated = await this.gameShelfService.updateGameCover(
                this.selectedGame.igdbGameId,
                this.selectedGame.platformIgdbId,
                url,
                coverSource,
            );
            this.applyUpdatedGame(updated, { refreshCover: true });
            this.closeImagePickerModal();
            await this.presentToast('Game image updated.');
        } catch {
            await this.presentToast('Unable to update game image.', 'danger');
        }
    }

    async runHltbPickerSearch(): Promise<void> {
        const normalized = this.hltbPickerQuery.trim();
        this.hasHltbPickerSearched = true;

        if (normalized.length < 2) {
            this.hltbPickerResults = [];
            this.hltbPickerError = 'Enter at least 2 characters.';
            this.changeDetectorRef.markForCheck();
            return;
        }

        this.isHltbPickerLoading = true;
        this.hltbPickerError = null;
        this.changeDetectorRef.markForCheck();

        try {
            const candidates = await firstValueFrom(this.gameShelfService.searchHltbCandidates(normalized, null, null));
            this.hltbPickerResults = dedupeHltbCandidates(candidates).slice(0, 30);
        } catch {
            this.hltbPickerResults = [];
            this.hltbPickerError = 'Unable to search HLTB right now.';
        } finally {
            this.isHltbPickerLoading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async applySelectedHltbCandidate(candidate: HltbMatchCandidate): Promise<void> {
        const target = this.hltbPickerTargetGame;

        if (!target) {
            return;
        }

        this.isHltbPickerLoading = true;
        this.changeDetectorRef.markForCheck();

        try {
            const updated = await this.gameShelfService.refreshGameCompletionTimesWithQuery(
                target.igdbGameId,
                target.platformIgdbId,
                {
                    title: candidate.title,
                    releaseYear: candidate.releaseYear,
                    platform: candidate.platform,
                },
            );
            this.applyUpdatedGame(updated);
            this.closeHltbPickerModal();
            if (this.hasHltbData(updated)) {
                await this.presentToast('HLTB data updated.');
            } else {
                await this.presentToast('No HLTB match found for this game.', 'warning');
            }
        } catch {
            this.isHltbPickerLoading = false;
            this.changeDetectorRef.markForCheck();
            await this.presentToast('Unable to update HLTB data.', 'danger');
        }
    }

    async useOriginalHltbLookup(): Promise<void> {
        const target = this.hltbPickerTargetGame;

        if (!target) {
            return;
        }

        this.isHltbPickerLoading = true;
        this.changeDetectorRef.markForCheck();

        try {
            const updated = await this.gameShelfService.refreshGameCompletionTimes(target.igdbGameId, target.platformIgdbId);
            this.applyUpdatedGame(updated);
            this.closeHltbPickerModal();
            if (this.hasHltbData(updated)) {
                await this.presentToast('HLTB data updated.');
            } else {
                await this.presentToast('No HLTB match found for this game.', 'warning');
            }
        } catch {
            this.isHltbPickerLoading = false;
            this.changeDetectorRef.markForCheck();
            await this.presentToast('Unable to update HLTB data.', 'danger');
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

    formatMetadataList(values: string[] | undefined): string {
        if (!Array.isArray(values)) {
            return 'Unknown';
        }

        const normalized = values
            .map(value => (typeof value === 'string' ? value.trim() : ''))
            .filter(value => value.length > 0);

        return normalized.length > 0 ? normalized.join(', ') : 'Unknown';
    }

    hasMetadataValue(values: string[] | undefined): boolean {
        return normalizeMetadataOptions(values).length > 0;
    }

    formatCompletionHours(value: number | null | undefined): string {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return 'Unknown';
        }

        const normalized = Math.round(value * 10) / 10;
        const hasDecimal = Math.abs(normalized - Math.trunc(normalized)) > 0;
        return `${normalized.toFixed(hasDecimal ? 1 : 0)} hours`;
    }

    formatRowMainHours(value: number | null | undefined): string | null {
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            return null;
        }

        const normalized = Math.round(value * 10) / 10;
        const hasDecimal = Math.abs(normalized - Math.trunc(normalized)) > 0;
        return `${normalized.toFixed(hasDecimal ? 1 : 0)} h`;
    }

    getGameTypeBadgeLabel(game: GameEntry): string | null {
        const gameType = game.gameType ?? null;

        if (!gameType || gameType === 'main_game') {
            return null;
        }

        if (gameType === 'dlc_addon') {
            return 'DLC Add-on';
        }

        if (gameType === 'standalone_expansion') {
            return 'Standalone Expansion';
        }

        if (gameType === 'expanded_game') {
            return 'Expanded Game';
        }

        return gameType
            .split('_')
            .filter(part => part.length > 0)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    openShortcutSearch(provider: 'google' | 'youtube' | 'wikipedia' | 'gamefaqs'): void {
        const query = this.selectedGame?.title?.trim();

        if (!query) {
            return;
        }

        const encodedQuery = encodeURIComponent(query);
        let url = '';

        if (provider === 'google') {
            url = `https://www.google.com/search?q=${encodedQuery}`;
        } else if (provider === 'youtube') {
            url = `https://www.youtube.com/results?search_query=${encodedQuery}`;
        } else if (provider === 'wikipedia') {
            url = `https://en.wikipedia.org/w/index.php?search=${encodedQuery}`;
        } else {
            url = `https://gamefaqs.gamespot.com/search?game=${encodedQuery}`;
        }

        const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');

        if (!openedWindow) {
            window.location.href = url;
        }
    }

    getTagTextColor(color: string): string {
        const normalized = color.trim();

        if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
            return '#ffffff';
        }

        const red = Number.parseInt(normalized.slice(1, 3), 16);
        const green = Number.parseInt(normalized.slice(3, 5), 16);
        const blue = Number.parseInt(normalized.slice(5, 7), 16);
        const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

        return luminance > 0.6 ? '#000000' : '#ffffff';
    }

    getGroupCountLabel(count: number): string {
        return count === 1 ? '1 game' : `${count} games`;
    }

    getStatusIconName(game: GameEntry): string | null {
        const status = this.normalizeStatus(game.status);

        if (status === 'playing') {
            return 'play';
        }

        if (status === 'dropped') {
            return 'trash-bin';
        }

        if (status === 'completed') {
            return 'trophy';
        }

        if (status === 'wantToPlay') {
            return 'bookmark';
        }

        if (status === 'paused') {
            return 'pause';
        }

        if (status === 'replay') {
            return 'refresh';
        }

        return null;
    }

    getStatusIconColor(game: GameEntry): string {
        const status = this.normalizeStatus(game.status);

        if (status === 'playing') {
            return '#2dd36f';
        }

        if (status === 'dropped') {
            return '#7f8c8d';
        }

        if (status === 'completed') {
            return '#d4af37';
        }

        if (status === 'wantToPlay') {
            return '#2196f3';
        }

        if (status === 'paused') {
            return '#8b5a2b';
        }

        if (status === 'replay') {
            return '#7e57c2';
        }

        return 'var(--ion-color-medium)';
    }

    getRating(game: GameEntry): GameRating | null {
        return this.normalizeRating(game.rating);
    }

    getGameKey(game: GameEntry): string {
        return `${game.igdbGameId}::${game.platformIgdbId}`;
    }

    getRowCoverUrl(game: GameEntry): string {
        const gameKey = this.getGameKey(game);
        const existing = this.rowCoverUrlByGameKey.get(gameKey);

        if (existing) {
            return existing;
        }

        if (!this.rowCoverLoadingGameKeys.has(gameKey)) {
            void this.loadRowCoverUrl(game);
        }

        return this.getFallbackCoverUrl(game.coverUrl, 'thumb');
    }

    getDetailCoverUrl(game: GameEntry): string {
        const gameKey = this.getGameKey(game);
        const existing = this.detailCoverUrlByGameKey.get(gameKey);

        if (existing) {
            return existing;
        }

        if (!this.detailCoverLoadingGameKeys.has(gameKey)) {
            void this.loadDetailCoverUrl(game);
        }

        return this.getFallbackCoverUrl(game.coverUrl, 'detail');
    }

    private getOtherListType(): ListType {
        return this.listType === 'collection' ? 'wishlist' : 'collection';
    }

    private getFallbackCoverUrl(coverUrl: string | null | undefined, variant: 'thumb' | 'detail'): string {
        const normalized = typeof coverUrl === 'string' ? coverUrl.trim() : '';

        if (!normalized) {
            return 'assets/icon/favicon.png';
        }

        if (variant === 'thumb' && normalized.includes('cdn.thegamesdb.net/images/')) {
            return normalized.replace(/\/images\/(?:original|large|medium)\//, '/images/small/');
        }

        return this.withIgdbRetinaVariant(normalized);
    }

    private withIgdbRetinaVariant(url: string): string {
        return url.replace(/(\/igdb\/image\/upload\/)(t_[^/]+)(\/)/, (_match, prefix: string, sizeToken: string, suffix: string) => {
            if (sizeToken.endsWith('_2x')) {
                return `${prefix}${sizeToken}${suffix}`;
            }

            return `${prefix}${sizeToken}_2x${suffix}`;
        });
    }

    private async loadRowCoverUrl(game: GameEntry): Promise<void> {
        const gameKey = this.getGameKey(game);

        if (this.rowCoverLoadingGameKeys.has(gameKey)) {
            return;
        }

        this.rowCoverLoadingGameKeys.add(gameKey);

        try {
            const resolved = await this.imageCacheService.resolveImageUrl(gameKey, game.coverUrl, 'thumb');
            this.rowCoverUrlByGameKey.set(gameKey, resolved);
            this.changeDetectorRef.markForCheck();
        } catch {
            this.rowCoverUrlByGameKey.set(gameKey, this.getFallbackCoverUrl(game.coverUrl, 'thumb'));
            this.changeDetectorRef.markForCheck();
        } finally {
            this.rowCoverLoadingGameKeys.delete(gameKey);
        }
    }

    private async loadDetailCoverUrl(game: GameEntry): Promise<void> {
        const gameKey = this.getGameKey(game);

        if (this.detailCoverLoadingGameKeys.has(gameKey)) {
            return;
        }

        this.detailCoverLoadingGameKeys.add(gameKey);

        try {
            const resolved = await this.imageCacheService.resolveImageUrl(gameKey, game.coverUrl, 'detail');
            this.detailCoverUrlByGameKey.set(gameKey, resolved);
            this.changeDetectorRef.markForCheck();
        } catch {
            this.detailCoverUrlByGameKey.set(gameKey, this.getFallbackCoverUrl(game.coverUrl, 'detail'));
            this.changeDetectorRef.markForCheck();
        } finally {
            this.detailCoverLoadingGameKeys.delete(gameKey);
        }
    }

    private enterSelectionModeWithGame(gameKey: string): void {
        this.selectionModeActive = true;
        this.selectedGameKeys.add(gameKey);
        this.emitSelectionState();
    }

    private toggleGameSelection(gameKey: string): void {
        if (this.selectedGameKeys.has(gameKey)) {
            this.selectedGameKeys.delete(gameKey);
        } else {
            this.selectedGameKeys.add(gameKey);
        }

        if (this.selectedGameKeys.size === 0) {
            this.selectionModeActive = false;
        }

        this.emitSelectionState();
    }

    private syncSelectionWithDisplayedGames(): void {
        if (!this.selectionModeActive) {
            return;
        }

        const displayedIds = new Set(this.displayedGames.map(game => this.getGameKey(game)));
        this.selectedGameKeys.forEach(gameKey => {
            if (!displayedIds.has(gameKey)) {
                this.selectedGameKeys.delete(gameKey);
            }
        });

        if (this.selectedGameKeys.size === 0) {
            this.selectionModeActive = false;
        }
    }

    private emitSelectionState(): void {
        this.selectionStateChange.emit({
            active: this.selectionModeActive,
            selectedCount: this.selectedGameKeys.size,
            allDisplayedSelected: this.isAllDisplayedSelected(),
        });
    }

    private syncExpandedSectionKeys(sections: GameGroupSection[]): void {
        const validSectionKeys = new Set(sections.map(section => section.key));
        const nextExpandedKeys = this.expandedSectionKeys.filter(sectionKey => validSectionKeys.has(sectionKey));

        if (nextExpandedKeys.length !== this.expandedSectionKeys.length) {
            this.expandedSectionKeys = nextExpandedKeys;
            return;
        }

        for (let index = 0; index < nextExpandedKeys.length; index += 1) {
            if (nextExpandedKeys[index] !== this.expandedSectionKeys[index]) {
                this.expandedSectionKeys = nextExpandedKeys;
                return;
            }
        }
    }

    private clearLongPressTimer(): void {
        if (this.longPressTimerId !== null) {
            clearTimeout(this.longPressTimerId);
            this.longPressTimerId = null;
        }
    }

    private getSelectedGames(): GameEntry[] {
        const selectedKeys = this.selectedGameKeys;
        return this.displayedGames.filter(game => selectedKeys.has(this.getGameKey(game)));
    }

    private getListLabel(listType: ListType): string {
        return listType === 'collection' ? 'Collection' : 'Wishlist';
    }

    private resolveRowActionsPopoverEvent(event: Event | undefined, slidingItem: IonItemSliding): Event | undefined {
        if (event instanceof MouseEvent && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
            return event;
        }

        const eventTarget = event?.target;

        if (eventTarget instanceof Element) {
            const rect = eventTarget.getBoundingClientRect();

            if (rect.width > 0 && rect.height > 0) {
                return new MouseEvent('click', {
                    bubbles: true,
                    clientX: Math.max(rect.left + 8, rect.right - 8),
                    clientY: rect.top + (rect.height / 2),
                });
            }
        }

        const slidingElement = (slidingItem as unknown as { el?: Element }).el;

        if (slidingElement instanceof Element) {
            const rect = slidingElement.getBoundingClientRect();

            if (rect.width > 0 && rect.height > 0) {
                return new MouseEvent('click', {
                    bubbles: true,
                    clientX: Math.max(rect.left + 8, rect.right - 8),
                    clientY: rect.top + (rect.height / 2),
                });
            }
        }

        return undefined;
    }

    private normalizeFilters(filters: GameListFilters): GameListFilters {
        return this.filteringEngine.normalizeFilters(filters);
    }

    private extractPlatforms(games: GameEntry[]): string[] {
        return this.filteringEngine.extractPlatforms(games);
    }

    private extractGenres(games: GameEntry[]): string[] {
        return this.filteringEngine.extractGenres(games);
    }

    private extractCollections(games: GameEntry[]): string[] {
        return this.filteringEngine.extractCollections(games);
    }

    private extractGameTypes(games: GameEntry[]): GameType[] {
        return this.filteringEngine.extractGameTypes(games);
    }

    private extractTags(games: GameEntry[]): string[] {
        return this.filteringEngine.extractTags(games);
    }

    private applyFiltersAndSort(games: GameEntry[], filters: GameListFilters, searchQuery: string): GameEntry[] {
        return this.filteringEngine.applyFiltersAndSort(games, filters, searchQuery);
    }

    private buildGroupedView(games: GameEntry[], groupBy: GameGroupByField): GroupedGamesView {
        return this.filteringEngine.buildGroupedView(games, groupBy);
    }

    private compareTitles(leftTitle: string, rightTitle: string): number {
        const normalizedLeft = this.normalizeTitleForSort(leftTitle);
        const normalizedRight = this.normalizeTitleForSort(rightTitle);
        const normalizedCompare = normalizedLeft.localeCompare(normalizedRight, undefined, { sensitivity: 'base' });

        if (normalizedCompare !== 0) {
            return normalizedCompare;
        }

        return leftTitle.localeCompare(rightTitle, undefined, { sensitivity: 'base' });
    }

    private normalizeTitleForSort(title: string): string {
        const normalized = typeof title === 'string' ? title.trim() : '';
        return normalized.replace(/^(?:the|a)\s+/i, '');
    }

    private hasHltbData(game: GameEntry): boolean {
        return this.isPositiveNumber(game.hltbMainHours)
            || this.isPositiveNumber(game.hltbMainExtraHours)
            || this.isPositiveNumber(game.hltbCompletionistHours);
    }

    private isPositiveNumber(value: number | null | undefined): boolean {
        return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }

    private async runBulkAction<T>(
        games: GameEntry[],
        options: {
            loadingPrefix: string;
            concurrency: number;
            interItemDelayMs: number;
        },
        action: (game: GameEntry) => Promise<T>,
    ): Promise<BulkActionResult<T>[]> {
        return runBulkActionWithRetry({
            loadingController: this.loadingController,
            games,
            options,
            retryConfig: {
                maxAttempts: GameListComponent.BULK_MAX_ATTEMPTS,
                retryBaseDelayMs: GameListComponent.BULK_RETRY_BASE_DELAY_MS,
                rateLimitFallbackCooldownMs: GameListComponent.BULK_RATE_LIMIT_FALLBACK_COOLDOWN_MS,
            },
            action,
            delay: (ms: number) => this.delay(ms),
        });
    }

    private openMetadataFilterSelection(kind: MetadataFilterKind, values: string[] | undefined, title: string): void {
        const options = normalizeMetadataOptions(values);

        if (options.length === 0) {
            return;
        }

        if (options.length === 1) {
            this.applyMetadataFilterSelection(kind, options[0]);
            return;
        }

        this.metadataPickerTitle = title;
        this.metadataPickerKind = kind;
        this.metadataPickerOptions = options;
        this.metadataPickerSelection = null;
        this.isMetadataPickerModalOpen = true;
        this.changeDetectorRef.markForCheck();
    }

    private applyMetadataFilterSelection(kind: MetadataFilterKind, value: string): void {
        const normalized = value.trim();

        if (normalized.length === 0) {
            return;
        }

        this.closeMetadataPickerModal();
        this.closeGameDetailModal();
        this.metadataFilterSelected.emit({ kind, value: normalized });
    }

    private async delay(ms: number): Promise<void> {
        await new Promise<void>(resolve => {
            window.setTimeout(resolve, ms);
        });
    }

    private async delayReject<T>(ms: number, message: string): Promise<T> {
        await this.delay(ms);
        throw new Error(message);
    }

    private async loadSimilarLibraryGamesForDetail(game: GameEntry): Promise<void> {
        const requestId = ++this.similarLibraryLoadRequestId;
        const similarIds = normalizeSimilarGameIds(game.similarGameIgdbIds);

        if (similarIds.length === 0) {
            if (requestId === this.similarLibraryLoadRequestId) {
                this.similarLibraryGames = [];
                this.isSimilarLibraryGamesLoading = false;
                this.changeDetectorRef.markForCheck();
            }
            return;
        }

        this.isSimilarLibraryGamesLoading = true;
        this.similarLibraryGames = [];
        this.changeDetectorRef.markForCheck();

        try {
            const libraryGames = await Promise.race([
                this.gameShelfService.listLibraryGames(),
                this.delayReject<GameEntry[]>(10000, 'similar_library_load_timeout'),
            ]);

            if (requestId !== this.similarLibraryLoadRequestId) {
                return;
            }

            this.similarLibraryGames = findSimilarLibraryGames({
                currentGame: game,
                libraryGames,
                similarIds,
                compareTitles: (left, right) => this.compareTitles(left, right),
            });
        } catch {
            if (requestId === this.similarLibraryLoadRequestId) {
                this.similarLibraryGames = [];
            }
        } finally {
            if (requestId === this.similarLibraryLoadRequestId) {
                this.isSimilarLibraryGamesLoading = false;
                this.changeDetectorRef.markForCheck();
            }
        }
    }

    getSimilarGameSubtitle(game: GameEntry): string {
        const year = Number.isInteger(game.releaseYear) ? String(game.releaseYear) : 'Unknown year';
        const platform = typeof game.platform === 'string' && game.platform.trim().length > 0 ? game.platform.trim() : 'Unknown platform';
        return `${year} · ${platform}`;
    }

    private normalizeFilterHours(value: number | null | undefined): number | null {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return null;
        }

        return Math.round(value * 10) / 10;
    }

    private async presentToast(message: string, color: 'primary' | 'danger' | 'warning' = 'primary'): Promise<void> {
        const toast = await this.toastController.create({
            message,
            duration: 1600,
            position: 'bottom',
            color,
        });

        await toast.present();
    }

    private async openImagePickerModal(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        const nextState = createOpenedImagePickerState(this.imagePickerSearchRequestId, this.selectedGame.title);
        this.imagePickerSearchRequestId = nextState.imagePickerSearchRequestId;
        this.imagePickerQuery = nextState.imagePickerQuery;
        this.imagePickerResults = nextState.imagePickerResults;
        this.imagePickerError = nextState.imagePickerError;
        this.isImagePickerLoading = nextState.isImagePickerLoading;
        this.isImagePickerModalOpen = nextState.isImagePickerModalOpen;
        this.changeDetectorRef.markForCheck();
        await this.runImagePickerSearch();
    }

    private async dismissDetailActionsPopover(): Promise<void> {
        await this.popoverController.dismiss(undefined, undefined, this.getDetailActionsPopoverId()).catch(() => undefined);
    }

    private async openTagsPicker(game: GameEntry): Promise<void> {
        const tags = await this.gameShelfService.listTags();

        if (tags.length === 0) {
            await this.presentToast('Create a tag first from the Tags page.');
            return;
        }

        let nextTagIds = this.normalizeTagIds(game.tagIds);
        const alert = await this.alertController.create({
            header: 'Game Tags',
            message: `Select tags for ${game.title}.`,
            inputs: tags.map(tag => this.buildTagInput(tag, nextTagIds)),
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Save',
                    role: 'confirm',
                    handler: (value: string[] | string | null | undefined) => {
                        nextTagIds = this.parseTagSelection(value);
                    },
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm' && role !== 'destructive') {
            return;
        }

        const updated = await this.gameShelfService.setGameTags(game.igdbGameId, game.platformIgdbId, nextTagIds);

        this.applyUpdatedGame(updated);

        await this.presentToast('Tags updated.');
    }

    private buildTagInput(tag: Tag, selectedTagIds: number[]): { type: 'checkbox'; label: string; value: string; checked: boolean } {
        const tagId = typeof tag.id === 'number' && Number.isInteger(tag.id) && tag.id > 0 ? tag.id : -1;

        return {
            type: 'checkbox',
            label: tag.name,
            value: String(tagId),
            checked: selectedTagIds.includes(tagId),
        };
    }

    private parseTagSelection(value: string[] | string | null | undefined): number[] {
        if (Array.isArray(value)) {
            return this.normalizeTagIds(value.map(entry => Number.parseInt(entry, 10)));
        }

        if (typeof value === 'string') {
            return this.normalizeTagIds([Number.parseInt(value, 10)]);
        }

        return [];
    }

    private normalizeTagIds(tagIds: number[] | undefined): number[] {
        if (!Array.isArray(tagIds)) {
            return [];
        }

        return [...new Set(
            tagIds
                .filter(tagId => Number.isInteger(tagId) && tagId > 0)
                .map(tagId => Math.trunc(tagId))
        )];
    }

    private resetDetailTextExpansion(): void {
        this.detailTextExpanded.summary = false;
        this.detailTextExpanded.storyline = false;
    }

    private resetImagePickerState(): void {
        const nextState = createClosedImagePickerState(this.imagePickerSearchRequestId);
        this.imagePickerSearchRequestId = nextState.imagePickerSearchRequestId;
        this.imagePickerQuery = nextState.imagePickerQuery;
        this.imagePickerResults = nextState.imagePickerResults;
        this.imagePickerError = nextState.imagePickerError;
        this.isImagePickerLoading = nextState.isImagePickerLoading;
        this.isImagePickerModalOpen = nextState.isImagePickerModalOpen;
    }

    private async openHltbPickerModal(game: GameEntry): Promise<void> {
        const nextState = createOpenedHltbPickerState(game);
        this.isHltbPickerModalOpen = nextState.isHltbPickerModalOpen;
        this.isHltbPickerLoading = nextState.isHltbPickerLoading;
        this.hasHltbPickerSearched = nextState.hasHltbPickerSearched;
        this.hltbPickerQuery = nextState.hltbPickerQuery;
        this.hltbPickerResults = nextState.hltbPickerResults;
        this.hltbPickerError = nextState.hltbPickerError;
        this.hltbPickerTargetGame = nextState.hltbPickerTargetGame;
        this.changeDetectorRef.markForCheck();
    }

    private resetHltbPickerState(): void {
        const nextState = createClosedHltbPickerState();
        this.isHltbPickerModalOpen = nextState.isHltbPickerModalOpen;
        this.isHltbPickerLoading = nextState.isHltbPickerLoading;
        this.hasHltbPickerSearched = nextState.hasHltbPickerSearched;
        this.hltbPickerQuery = nextState.hltbPickerQuery;
        this.hltbPickerResults = nextState.hltbPickerResults;
        this.hltbPickerError = nextState.hltbPickerError;
        this.hltbPickerTargetGame = nextState.hltbPickerTargetGame;
    }

    private async openStatusPicker(game: GameEntry): Promise<void> {
        const currentStatus = this.normalizeStatus(game.status);
        let nextStatus = currentStatus;

        const alert = await this.alertController.create({
            header: 'Set Status',
            message: `Choose a status for ${game.title}.`,
            inputs: [
                ...this.statusOptions.map(option => ({
                    type: 'radio' as const,
                    label: option.label,
                    value: option.value,
                    checked: currentStatus === option.value,
                })),
            ],
            buttons: [
                {
                    text: 'Clear',
                    role: 'destructive',
                    handler: () => {
                        nextStatus = null;
                    },
                },
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Save',
                    role: 'confirm',
                    handler: (value: string | null | undefined) => {
                        nextStatus = this.normalizeStatus(value);
                    },
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm' && role !== 'destructive') {
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameStatus(game.igdbGameId, game.platformIgdbId, nextStatus);

            this.applyUpdatedGame(updated);

            await this.presentToast('Game status updated.');
        } catch {
            await this.presentToast('Unable to update game status.', 'danger');
        }
    }

    private applyUpdatedGame(updated: GameEntry, options: { refreshCover?: boolean } = {}): void {
        if (this.selectedGame && this.getGameKey(this.selectedGame) === this.getGameKey(updated)) {
            this.selectedGame = updated;
            void this.loadSimilarLibraryGamesForDetail(updated);
        }

        if (options.refreshCover) {
            const gameKey = this.getGameKey(updated);
            this.rowCoverUrlByGameKey.delete(gameKey);
            this.detailCoverUrlByGameKey.delete(gameKey);
            void this.loadRowCoverUrl(updated);
            void this.loadDetailCoverUrl(updated);
        }

        this.changeDetectorRef.markForCheck();
    }

    private normalizeStatus(value: string | GameStatus | null | undefined): GameStatus | null {
        if (value === 'playing' || value === 'wantToPlay' || value === 'completed' || value === 'paused' || value === 'dropped' || value === 'replay') {
            return value;
        }

        return null;
    }

    private normalizeRating(value: number | string | GameRating | null | undefined): GameRating | null {
        const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

        if (numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5) {
            return numeric;
        }

        return null;
    }

    private async openRatingPicker(game: GameEntry): Promise<void> {
        const currentRating = this.normalizeRating(game.rating);
        this.ratingTargetGame = game;
        this.ratingDraft = currentRating ?? 3;
        this.clearRatingOnSave = false;
        this.isRatingModalOpen = true;
    }

    private async confirmDelete(options: { header: string; message: string; confirmText: string }): Promise<boolean> {
        const alert = await this.alertController.create({
            header: options.header,
            message: options.message,
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: options.confirmText,
                    role: 'confirm',
                    cssClass: 'alert-button-danger',
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();
        return role === 'confirm';
    }

    constructor() {
        addIcons({ star, ellipsisHorizontal, close, closeCircle, starOutline, play, trashBin, trophy, bookmark, pause, refresh, search, logoGoogle, logoYoutube, chevronBack });
    }
}
