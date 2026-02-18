import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, Output, SimpleChanges, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
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
    IonFabList,
    IonInput
} from '@ionic/angular/standalone';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameCatalogPlatformOption,
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
    ManualCandidate
} from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { ManualService } from '../../core/services/manual.service';
import { PlatformOrderService } from '../../core/services/platform-order.service';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { DebugLogService } from '../../core/services/debug-log.service';
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
import {
    buildTagInput,
    hasHltbData,
    normalizeGameRating,
    normalizeGameStatus,
    normalizeTagIds,
    parseTagSelection,
} from './game-list-detail-actions';
import { formatRateLimitedUiError } from '../../core/utils/rate-limit-ui-error';
import { GameSearchComponent } from '../game-search/game-search.component';
import { GameDetailContentComponent } from '../game-detail/game-detail-content.component';
import { addIcons } from "ionicons";
import { star, ellipsisHorizontal, close, closeCircle, starOutline, play, trashBin, trophy, bookmark, pause, refresh, search, logoGoogle, logoYoutube, chevronBack, documentText } from "ionicons/icons";

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
        ScrollingModule,
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
        IonInput,
        GameSearchComponent,
        GameDetailContentComponent,
    ],
})
export class GameListComponent implements OnChanges {
    private static readonly BULK_METADATA_CONCURRENCY = 3;
    private static readonly BULK_HLTB_CONCURRENCY = 2;
    private static readonly BULK_MAX_ATTEMPTS = 3;
    private static readonly BULK_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 15000;
    private static readonly BULK_RETRY_BASE_DELAY_MS = 1000;
    private static readonly BULK_HLTB_INTER_ITEM_DELAY_MS = 125;
    private static readonly BULK_HLTB_ITEM_TIMEOUT_MS = 30000;
    private static readonly VIRTUAL_ROW_HEIGHT_PX = 112;
    private static readonly VIRTUAL_BUFFER_ROWS = 8;
    private static readonly IMAGE_ERROR_LOG_LIMIT = 120;
    private static readonly MAX_CUSTOM_COVER_DATA_URL_BYTES = 1024 * 1024;
    private static readonly MIN_CUSTOM_COVER_QUALITY = 0.5;
    private static readonly MAX_CUSTOM_COVER_QUALITY = 0.98;
    private static readonly CUSTOM_COVER_QUALITY_STEPS = 8;
    private static readonly CUSTOM_COVER_SCALE_FACTORS = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];

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
    imagePickerIgdbCoverUrl: string | null = null;
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
    isEditMetadataModalOpen = false;
    isEditMetadataSaving = false;
    editMetadataTitle = '';
    editMetadataPlatformIgdbId: number | null = null;
    editMetadataPlatformOptions: GameCatalogPlatformOption[] = [];
    isManualPickerModalOpen = false;
    isManualPickerLoading = false;
    manualPickerQuery = '';
    manualPickerResults: ManualCandidate[] = [];
    manualPickerError: string | null = null;
    manualResolvedUrl: string | null = null;
    manualResolvedRelativePath: string | null = null;
    manualResolvedSource: 'override' | 'fuzzy' | null = null;
    manualCatalogUnavailable = false;
    manualCatalogUnavailableReason: string | null = null;
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
    private readonly renderedSectionKeys = new Set<string>();
    selectedGameKeys = new Set<string>();
    private readonly rowCoverUrlByGameKey = new Map<string, string>();
    private readonly detailCoverUrlByGameKey = new Map<string, string>();
    private readonly rowCoverLoadingGameKeys = new Set<string>();
    private readonly detailCoverLoadingGameKeys = new Set<string>();
    private displayedGames: GameEntry[] = [];
    private readonly filteringEngine = new GameListFilteringEngine(this.noneTagFilterValue);
    private imagePickerSearchRequestId = 0;
    private similarLibraryLoadRequestId = 0;
    private manualResolutionRequestId = 0;
    private rowActionsSlidingItem: IonItemSliding | null = null;
    private readonly gameShelfService = inject(GameShelfService);
    private readonly popoverController = inject(PopoverController);
    private readonly alertController = inject(AlertController);
    private readonly loadingController = inject(LoadingController);
    private readonly toastController = inject(ToastController);
    private readonly imageCacheService = inject(ImageCacheService);
    private readonly manualService = inject(ManualService);
    private readonly platformOrderService = inject(PlatformOrderService);
    private readonly platformCustomizationService = inject(PlatformCustomizationService);
    private readonly debugLogService = inject(DebugLogService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly ngZone = inject(NgZone);
    private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });
    private readonly searchQuery$ = new BehaviorSubject<string>('');
    private readonly groupBy$ = new BehaviorSubject<GameGroupByField>('none');
    @ViewChild('detailContent') private detailContent?: IonContent;
    @ViewChild('customCoverFileInput') private customCoverFileInput?: ElementRef<HTMLInputElement>;
    @ViewChild('gameDetailModal', { read: ElementRef }) private gameDetailModalRef?: ElementRef<HTMLElement>;
    private imageErrorLogCount = 0;

    readonly virtualRowHeight = GameListComponent.VIRTUAL_ROW_HEIGHT_PX;
    readonly virtualMinBufferPx = GameListComponent.VIRTUAL_ROW_HEIGHT_PX * GameListComponent.VIRTUAL_BUFFER_ROWS;
    readonly virtualMaxBufferPx = GameListComponent.VIRTUAL_ROW_HEIGHT_PX * (GameListComponent.VIRTUAL_BUFFER_ROWS * 2);

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
            message: `Delete ${this.getGameDisplayTitle(game)}?`,
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
        const gameKey = this.getGameKey(game);

        if (this.selectionModeActive) {
            if (this.selectedGameKeys.size === 1 && this.selectedGameKeys.has(gameKey)) {
                this.clearSelectionMode();
                return;
            }

            this.toggleGameSelection(gameKey);
            return;
        }

        if (fromSimilarDetailSection) {
            this.openSimilarGameDetail(game);
            return;
        }

        this.openGameDetail(game);
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

    activateSelectionMode(): void {
        if (this.selectionModeActive) {
            return;
        }

        this.selectionModeActive = true;
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
                        nextStatus = normalizeGameStatus(value);
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
            inputs: tags.map(tag => buildTagInput(tag, [])),
            buttons: [
                { text: 'Cancel', role: 'cancel' },
                {
                    text: 'Apply',
                    role: 'confirm',
                    handler: (value: string[] | string | null | undefined) => {
                        nextTagIds = parseTagSelection(value);
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
                itemTimeoutMs: GameListComponent.BULK_HLTB_ITEM_TIMEOUT_MS,
            },
            game => this.gameShelfService.refreshGameCompletionTimes(game.igdbGameId, game.platformIgdbId),
        );
        const failedCount = results.filter(result => !result.ok).length;
        const updatedCount = results.filter(result => result.ok && result.value && hasHltbData(result.value)).length;
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
        this.resetManualPickerState();
        this.changeDetectorRef.markForCheck();
        void this.loadDetailCoverUrl(game);
        void this.loadSimilarLibraryGamesForDetail(game);
        void this.resolveManualForGame(game);
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
        this.isEditMetadataModalOpen = false;
        this.isEditMetadataSaving = false;
        this.isManualPickerModalOpen = false;
        this.selectedGame = null;
        this.detailNavigationStack = [];
        this.similarLibraryGames = [];
        this.isSimilarLibraryGamesLoading = false;
        this.similarLibraryLoadRequestId += 1;
        this.manualResolutionRequestId += 1;
        this.resetDetailTextExpansion();
        this.resetImagePickerState();
        this.resetHltbPickerState();
        this.resetManualPickerState();
        this.editMetadataTitle = '';
        this.editMetadataPlatformIgdbId = null;
        this.editMetadataPlatformOptions = [];
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

    onDetailDeveloperClick(): void {
        if (this.selectedGame) {
            this.onDeveloperItemClick(this.selectedGame);
        }
    }

    onDetailSeriesClick(): void {
        if (this.selectedGame) {
            this.onSeriesItemClick(this.selectedGame);
        }
    }

    onDetailFranchiseClick(): void {
        if (this.selectedGame) {
            this.onFranchiseItemClick(this.selectedGame);
        }
    }

    onDetailPublisherClick(): void {
        if (this.selectedGame) {
            this.onPublisherItemClick(this.selectedGame);
        }
    }

    getDetailGamePayload(game: GameEntry): GameCatalogResult {
        const displayPlatform = this.getGameDisplayPlatform(game);

        return {
            ...game,
            title: this.getGameDisplayTitle(game),
            coverUrl: this.getDetailCoverUrl(game),
            platforms: [displayPlatform.name],
            platform: displayPlatform.name,
            platformOptions: [{ id: displayPlatform.igdbId, name: displayPlatform.name }],
        };
    }

    get metadataPickerFieldLabel(): string {
        switch (this.metadataPickerKind) {
            case 'series':
                return 'Series';
            case 'developer':
                return 'Developer';
            case 'franchise':
                return 'Franchise';
            case 'publisher':
                return 'Publisher';
            default:
                return 'Value';
        }
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
        const normalized = normalizeGameRating(customEvent.detail?.value);

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

    get gameDetailModalElement(): HTMLElement | undefined {
        return this.gameDetailModalRef?.nativeElement;
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
            this.markExpandedSectionsAsRendered(this.expandedSectionKeys);
            this.changeDetectorRef.markForCheck();
            return;
        }

        if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
            this.expandedSectionKeys = [rawValue.trim()];
            this.markExpandedSectionsAsRendered(this.expandedSectionKeys);
            this.changeDetectorRef.markForCheck();
            return;
        }

        this.expandedSectionKeys = [];
        this.changeDetectorRef.markForCheck();
    }

    isSectionRendered(sectionKey: string): boolean {
        const normalized = String(sectionKey ?? '').trim();
        return normalized.length > 0 && this.renderedSectionKeys.has(normalized);
    }

    onImageError(event: Event, game?: GameEntry): void {
        const target = event.target;

        if (target instanceof HTMLImageElement) {
            if (this.imageErrorLogCount < GameListComponent.IMAGE_ERROR_LOG_LIMIT) {
                this.imageErrorLogCount += 1;
                this.debugLogService.warn('game_row_image_error', {
                    gameKey: game ? this.getGameKey(game) : null,
                    igdbGameId: game?.igdbGameId ?? null,
                    platformIgdbId: game?.platformIgdbId ?? null,
                    attemptedSrc: target.currentSrc || target.src || null,
                });
            }
            target.src = 'assets/icon/placeholder.png';
        }
    }

    async onCustomCoverFileSelected(event: Event): Promise<void> {
        const game = this.selectedGame;
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';

        if (!game || !file) {
            return;
        }

        const normalizedImage = await this.readImageFileAsDataUrl(file);

        if (!normalizedImage) {
            await this.presentToast('Unable to process image file.', 'danger');
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameCustomCover(
                game.igdbGameId,
                game.platformIgdbId,
                normalizedImage.dataUrl,
            );
            this.applyUpdatedGame(updated, { refreshCover: true });
            await this.presentToast(normalizedImage.compressed ? 'Custom image compressed and updated.' : 'Custom image updated.');
        } catch {
            await this.presentToast('Unable to set custom image.', 'danger');
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

    async openFixHltbMatchFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();

        if (!this.selectedGame) {
            return;
        }

        await this.openHltbPickerModal(this.selectedGame);
    }

    async openImagePickerFromPopover(): Promise<void> {
        await this.openImagePickerModal();
        await this.dismissDetailActionsPopover();
    }

    uploadCustomImageFromEditMetadata(): void {
        this.customCoverFileInput?.nativeElement.click();
    }

    async resetCustomImageFromEditMetadata(): Promise<void> {
        await this.resetSelectedGameCustomImage();
    }

    private async resetSelectedGameCustomImage(): Promise<void> {

        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameCustomCover(
                this.selectedGame.igdbGameId,
                this.selectedGame.platformIgdbId,
                null,
            );
            this.applyUpdatedGame(updated, { refreshCover: true });
            await this.presentToast('Custom image reset.');
        } catch {
            await this.presentToast('Unable to reset custom image.', 'danger');
        }
    }

    async openFixMatchFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();
        this.openFixMatchModal();
    }

    async openEditMetadataFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();
        await this.openEditMetadataModal();
    }

    async deleteSelectedGameFromPopover(): Promise<void> {
        await this.dismissDetailActionsPopover();

        if (!this.selectedGame) {
            return;
        }

        const target = this.selectedGame;
        const confirmed = await this.confirmDelete({
            header: 'Delete Game',
            message: `Delete ${this.getGameDisplayTitle(target)}?`,
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

    async openEditMetadataModal(): Promise<void> {
        const game = this.selectedGame;

        if (!game || this.isEditMetadataSaving) {
            return;
        }

        try {
            const platforms = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
            this.editMetadataPlatformOptions = platforms.filter(option => {
                return typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0;
            }) as GameCatalogPlatformOption[];
        } catch {
            this.editMetadataPlatformOptions = [];
            await this.presentToast('Unable to load platforms.', 'danger');
            return;
        }

        const displayPlatform = this.getGameDisplayPlatform(game);
        this.editMetadataTitle = this.getGameDisplayTitle(game);
        this.editMetadataPlatformIgdbId = this.normalizePlatformSelectionValue(displayPlatform.igdbId);
        this.isEditMetadataModalOpen = true;
        this.changeDetectorRef.markForCheck();
    }

    closeEditMetadataModal(): void {
        this.isEditMetadataModalOpen = false;
        this.isEditMetadataSaving = false;
        this.editMetadataTitle = '';
        this.editMetadataPlatformIgdbId = null;
        this.editMetadataPlatformOptions = [];
        this.changeDetectorRef.markForCheck();
    }

    onEditMetadataTitleChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string | null }>;
        this.editMetadataTitle = String(customEvent.detail?.value ?? '');
    }

    onEditMetadataPlatformChange(value: number | string | null | undefined): void {
        this.editMetadataPlatformIgdbId = this.normalizePlatformSelectionValue(value);
    }

    resetEditMetadataTitle(): void {
        if (!this.selectedGame) {
            this.editMetadataTitle = '';
            return;
        }

        this.editMetadataTitle = this.selectedGame.title;
    }

    resetEditMetadataPlatform(): void {
        if (!this.selectedGame) {
            this.editMetadataPlatformIgdbId = null;
            return;
        }

        this.editMetadataPlatformIgdbId = this.normalizePlatformSelectionValue(this.selectedGame.platformIgdbId);
    }

    async saveEditMetadata(): Promise<void> {
        const game = this.selectedGame;

        if (!game || this.isEditMetadataSaving) {
            return;
        }

        const title = this.editMetadataTitle.trim();
        const platformSelection = this.resolveEditMetadataPlatformSelection();

        if (this.editMetadataPlatformIgdbId !== null && platformSelection === null) {
            await this.presentToast('Select a valid platform.', 'warning');
            return;
        }

        this.isEditMetadataSaving = true;

        try {
            const updated = await this.gameShelfService.setGameCustomMetadata(game.igdbGameId, game.platformIgdbId, {
                title: title.length > 0 ? title : null,
                platform: platformSelection,
            });
            this.applyUpdatedGame(updated);
            this.isEditMetadataSaving = false;
            this.closeEditMetadataModal();
            await this.presentToast('Metadata updated.');
        } catch {
            await this.presentToast('Unable to update metadata.', 'danger');
        } finally {
            this.isEditMetadataSaving = false;
        }
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

        const normalized = normalizeGameStatus(value);

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

        const normalized = normalizeGameRating(value);

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

            if (hasHltbData(updated)) {
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
                this.imagePickerIgdbCoverUrl = null;
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

                this.imagePickerResults = this.filterOutImagePickerIgdbCover(results);
            });
        } catch (error: unknown) {
            this.ngZone.run(() => {
                if (requestId !== this.imagePickerSearchRequestId) {
                    return;
                }

                this.imagePickerResults = [];
                this.imagePickerError = formatRateLimitedUiError(error, 'Unable to load box art results.');
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
            const coverSource = this.isIgdbCoverUrl(url)
                ? 'igdb'
                : this.gameShelfService.shouldUseIgdbCoverForPlatform(
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
        } catch (error: unknown) {
            this.hltbPickerResults = [];
            this.hltbPickerError = formatRateLimitedUiError(error, 'Unable to search HLTB right now.');
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
            if (hasHltbData(updated)) {
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
            if (hasHltbData(updated)) {
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

    getRowHltbHoursLabel(game: GameEntry): string | null {
        const preferred = this.selectRowHltbHours(game);
        return this.formatRowMainHours(preferred);
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

        this.openExternalUrl(url);
    }

    get shouldShowOpenManualButton(): boolean {
        return this.manualResolvedUrl !== null;
    }

    get shouldShowFindManualButton(): boolean {
        return this.manualResolvedUrl === null;
    }

    openManualPdf(): void {
        const url = this.manualResolvedUrl;

        if (!url) {
            return;
        }

        this.openExternalUrl(url);
    }

    openManualPickerModal(): void {
        if (this.manualCatalogUnavailable) {
            const reason = this.manualCatalogUnavailableReason ?? 'Manual catalog is unavailable.';
            void this.presentToast(reason, 'warning');
            return;
        }

        const game = this.selectedGame;

        if (!game) {
            return;
        }

        this.isManualPickerModalOpen = true;
        this.manualPickerQuery = game.title.trim();
        this.manualPickerResults = [];
        this.manualPickerError = null;
        this.isManualPickerLoading = false;
        this.changeDetectorRef.markForCheck();
        void this.runManualPickerSearch();
    }

    closeManualPickerModal(): void {
        this.isManualPickerModalOpen = false;
        this.manualPickerQuery = '';
        this.manualPickerResults = [];
        this.manualPickerError = null;
        this.isManualPickerLoading = false;
        this.changeDetectorRef.markForCheck();
    }

    onManualPickerQueryInput(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string | null }>;
        this.manualPickerQuery = (customEvent.detail?.value ?? '').replace(/^\s+/, '');
    }

    async runManualPickerSearch(): Promise<void> {
        const game = this.selectedGame;

        if (!game) {
            return;
        }

        this.isManualPickerLoading = true;
        this.manualPickerError = null;
        this.changeDetectorRef.markForCheck();

        try {
            const response = await firstValueFrom(this.manualService.searchManuals(game.platformIgdbId, this.manualPickerQuery));
            this.manualCatalogUnavailable = response.unavailable;
            this.manualCatalogUnavailableReason = response.reason;
            this.manualPickerResults = response.items;

            if (response.unavailable) {
                this.manualPickerError = response.reason ?? 'Manual catalog is unavailable.';
            } else if (response.items.length === 0) {
                this.manualPickerError = 'No manuals found for this search.';
            }
        } catch {
            this.manualPickerError = 'Unable to search manuals right now.';
            this.manualPickerResults = [];
        } finally {
            this.isManualPickerLoading = false;
            this.changeDetectorRef.markForCheck();
        }
    }

    async applyManualMatch(candidate: ManualCandidate): Promise<void> {
        const game = this.selectedGame;

        if (!game) {
            return;
        }

        this.manualService.setOverride(game, candidate.relativePath);
        this.closeManualPickerModal();
        await this.resolveManualForGame(game);
        await this.presentToast('Manual match saved.');
    }

    async clearManualMatchOverride(): Promise<void> {
        const game = this.selectedGame;

        if (!game) {
            return;
        }

        this.manualService.clearOverride(game);
        await this.resolveManualForGame(game);
        await this.presentToast('Manual override cleared.');
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
        const status = normalizeGameStatus(game.status);

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
        const status = normalizeGameStatus(game.status);

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
        return normalizeGameRating(game.rating);
    }

    getGameKey(game: GameEntry): string {
        return `${game.igdbGameId}::${game.platformIgdbId}`;
    }

    getRowCoverUrl(game: GameEntry): string {
        const displayCoverUrl = this.getDisplayCoverUrl(game);

        if (typeof displayCoverUrl === 'string' && displayCoverUrl.startsWith('data:image/')) {
            return displayCoverUrl;
        }

        const gameKey = this.getGameKey(game);
        const existing = this.rowCoverUrlByGameKey.get(gameKey);

        if (existing) {
            return existing;
        }

        if (!this.rowCoverLoadingGameKeys.has(gameKey)) {
            void this.loadRowCoverUrl(game);
        }

        return this.getFallbackCoverUrl(displayCoverUrl, 'thumb');
    }

    getDetailCoverUrl(game: GameEntry): string {
        const displayCoverUrl = this.getDisplayCoverUrl(game);

        if (typeof displayCoverUrl === 'string' && displayCoverUrl.startsWith('data:image/')) {
            return displayCoverUrl;
        }

        const gameKey = this.getGameKey(game);
        const existing = this.detailCoverUrlByGameKey.get(gameKey);

        if (existing) {
            return existing;
        }

        if (!this.detailCoverLoadingGameKeys.has(gameKey)) {
            void this.loadDetailCoverUrl(game);
        }

        return this.getFallbackCoverUrl(displayCoverUrl, 'detail');
    }

    private getOtherListType(): ListType {
        return this.listType === 'collection' ? 'wishlist' : 'collection';
    }

    private getFallbackCoverUrl(coverUrl: string | null | undefined, variant: 'thumb' | 'detail'): string {
        const normalized = typeof coverUrl === 'string' ? coverUrl.trim() : '';

        if (!normalized) {
            return 'assets/icon/placeholder.png';
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

    private getDisplayCoverUrl(game: GameEntry): string | null {
        const customCoverUrl = typeof game.customCoverUrl === 'string' ? game.customCoverUrl.trim() : '';

        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(customCoverUrl)) {
            return customCoverUrl;
        }

        return game.coverUrl;
    }

    private async loadRowCoverUrl(game: GameEntry): Promise<void> {
        const gameKey = this.getGameKey(game);
        const displayCoverUrl = this.getDisplayCoverUrl(game);

        if (typeof displayCoverUrl === 'string' && displayCoverUrl.startsWith('data:image/')) {
            this.rowCoverUrlByGameKey.set(gameKey, displayCoverUrl);
            this.changeDetectorRef.markForCheck();
            return;
        }

        if (this.rowCoverLoadingGameKeys.has(gameKey)) {
            return;
        }

        this.rowCoverLoadingGameKeys.add(gameKey);

        try {
            const resolved = await this.imageCacheService.resolveImageUrl(gameKey, displayCoverUrl, 'thumb');
            this.rowCoverUrlByGameKey.set(gameKey, resolved);
            this.changeDetectorRef.markForCheck();
        } catch {
            this.rowCoverUrlByGameKey.set(gameKey, this.getFallbackCoverUrl(displayCoverUrl, 'thumb'));
            this.changeDetectorRef.markForCheck();
        } finally {
            this.rowCoverLoadingGameKeys.delete(gameKey);
        }
    }

    private async loadDetailCoverUrl(game: GameEntry): Promise<void> {
        const gameKey = this.getGameKey(game);
        const displayCoverUrl = this.getDisplayCoverUrl(game);

        if (typeof displayCoverUrl === 'string' && displayCoverUrl.startsWith('data:image/')) {
            this.detailCoverUrlByGameKey.set(gameKey, displayCoverUrl);
            this.changeDetectorRef.markForCheck();
            return;
        }

        if (this.detailCoverLoadingGameKeys.has(gameKey)) {
            return;
        }

        this.detailCoverLoadingGameKeys.add(gameKey);

        try {
            const resolved = await this.imageCacheService.resolveImageUrl(gameKey, displayCoverUrl, 'detail');
            this.detailCoverUrlByGameKey.set(gameKey, resolved);
            this.changeDetectorRef.markForCheck();
        } catch {
            this.detailCoverUrlByGameKey.set(gameKey, this.getFallbackCoverUrl(displayCoverUrl, 'detail'));
            this.changeDetectorRef.markForCheck();
        } finally {
            this.detailCoverLoadingGameKeys.delete(gameKey);
        }
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
        let removedRenderedKey = false;

        for (const renderedKey of this.renderedSectionKeys) {
            if (!validSectionKeys.has(renderedKey)) {
                this.renderedSectionKeys.delete(renderedKey);
                removedRenderedKey = true;
            }
        }

        if (nextExpandedKeys.length !== this.expandedSectionKeys.length) {
            this.expandedSectionKeys = nextExpandedKeys;
            this.markExpandedSectionsAsRendered(nextExpandedKeys);
            if (removedRenderedKey) {
                this.changeDetectorRef.markForCheck();
            }
            return;
        }

        for (let index = 0; index < nextExpandedKeys.length; index += 1) {
            if (nextExpandedKeys[index] !== this.expandedSectionKeys[index]) {
                this.expandedSectionKeys = nextExpandedKeys;
                this.markExpandedSectionsAsRendered(nextExpandedKeys);
                if (removedRenderedKey) {
                    this.changeDetectorRef.markForCheck();
                }
                return;
            }
        }

        this.markExpandedSectionsAsRendered(nextExpandedKeys);
        if (removedRenderedKey) {
            this.changeDetectorRef.markForCheck();
        }
    }

    private markExpandedSectionsAsRendered(sectionKeys: readonly string[]): void {
        sectionKeys.forEach(sectionKey => {
            const normalized = String(sectionKey ?? '').trim();

            if (normalized.length > 0) {
                this.renderedSectionKeys.add(normalized);
            }
        });
    }

    private openExternalUrl(url: string): void {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer external';
        anchor.click();
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
        this.configureFilteringEngine();
        return this.filteringEngine.normalizeFilters(filters);
    }

    private extractPlatforms(games: GameEntry[]): string[] {
        this.configureFilteringEngine();
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
        this.configureFilteringEngine();
        return this.filteringEngine.applyFiltersAndSort(games, filters, searchQuery);
    }

    private buildGroupedView(games: GameEntry[], groupBy: GameGroupByField): GroupedGamesView {
        this.configureFilteringEngine();
        return this.filteringEngine.buildGroupedView(games, groupBy);
    }

    private configureFilteringEngine(): void {
        this.filteringEngine.setPlatformOrder(this.platformOrderService.getDefaultOrder());
        this.filteringEngine.setPlatformDisplayNames(this.platformCustomizationService.getDisplayNames());
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

    private async runBulkAction<T>(
        games: GameEntry[],
        options: {
            loadingPrefix: string;
            concurrency: number;
            interItemDelayMs: number;
            itemTimeoutMs?: number;
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
        const displayPlatform = this.getGameDisplayPlatform(game);
        const platform = this.getPlatformLabel(displayPlatform.name, displayPlatform.igdbId);
        return `${year} · ${platform}`;
    }

    getGameDisplayTitle(game: GameEntry): string {
        const customTitle = typeof game.customTitle === 'string' ? game.customTitle.trim() : '';

        if (customTitle.length > 0) {
            return customTitle;
        }

        const title = typeof game.title === 'string' ? game.title.trim() : '';
        return title.length > 0 ? title : 'Unknown title';
    }

    getGameDisplayPlatform(game: GameEntry): { name: string; igdbId: number } {
        const customPlatformName = typeof game.customPlatform === 'string' ? game.customPlatform.trim() : '';
        const customPlatformIgdbId = this.normalizePlatformSelectionValue(game.customPlatformIgdbId);

        if (customPlatformName.length > 0 && customPlatformIgdbId !== null) {
            return {
                name: customPlatformName,
                igdbId: customPlatformIgdbId,
            };
        }

        return {
            name: game.platform,
            igdbId: game.platformIgdbId,
        };
    }

    getGameDisplayPlatformLabel(game: GameEntry): string {
        const displayPlatform = this.getGameDisplayPlatform(game);
        const label = this.platformCustomizationService.getDisplayNameWithAliasSource(displayPlatform.name, displayPlatform.igdbId).trim();
        return label.length > 0 ? label : 'Unknown platform';
    }

    getPlatformLabel(platform: string | null | undefined, platformIgdbId: number | null | undefined): string {
        const label = this.platformCustomizationService.getDisplayName(platform, platformIgdbId).trim();
        return label.length > 0 ? label : 'Unknown platform';
    }

    private normalizeFilterHours(value: number | null | undefined): number | null {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            return null;
        }

        return Math.round(value * 10) / 10;
    }

    private selectRowHltbHours(game: GameEntry): number | null {
        const candidates = [
            game.hltbMainHours,
            game.hltbMainExtraHours,
            game.hltbCompletionistHours,
        ];

        for (const candidate of candidates) {
            if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
                return candidate;
            }
        }

        return null;
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
        this.imagePickerIgdbCoverUrl = null;
        this.imagePickerError = nextState.imagePickerError;
        this.isImagePickerLoading = nextState.isImagePickerLoading;
        this.isImagePickerModalOpen = nextState.isImagePickerModalOpen;
        this.changeDetectorRef.markForCheck();
        void this.loadImagePickerIgdbCover(this.selectedGame.igdbGameId);
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

        let nextTagIds = normalizeTagIds(game.tagIds);
        const alert = await this.alertController.create({
            header: 'Game Tags',
            message: `Select tags for ${this.getGameDisplayTitle(game)}.`,
            inputs: tags.map(tag => buildTagInput(tag, nextTagIds)),
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Save',
                    role: 'confirm',
                    handler: (value: string[] | string | null | undefined) => {
                        nextTagIds = parseTagSelection(value);
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

    private resetDetailTextExpansion(): void {
        this.detailTextExpanded.summary = false;
        this.detailTextExpanded.storyline = false;
    }

    private resetManualPickerState(): void {
        this.isManualPickerModalOpen = false;
        this.isManualPickerLoading = false;
        this.manualPickerQuery = '';
        this.manualPickerResults = [];
        this.manualPickerError = null;
        this.manualResolvedUrl = null;
        this.manualResolvedRelativePath = null;
        this.manualResolvedSource = null;
        this.manualCatalogUnavailable = false;
        this.manualCatalogUnavailableReason = null;
    }

    private resetImagePickerState(): void {
        const nextState = createClosedImagePickerState(this.imagePickerSearchRequestId);
        this.imagePickerSearchRequestId = nextState.imagePickerSearchRequestId;
        this.imagePickerQuery = nextState.imagePickerQuery;
        this.imagePickerResults = nextState.imagePickerResults;
        this.imagePickerIgdbCoverUrl = null;
        this.imagePickerError = nextState.imagePickerError;
        this.isImagePickerLoading = nextState.isImagePickerLoading;
        this.isImagePickerModalOpen = nextState.isImagePickerModalOpen;
    }

    private async loadImagePickerIgdbCover(igdbGameId: string): Promise<void> {
        const coverUrl = await firstValueFrom(this.gameShelfService.getIgdbCoverByGameId(igdbGameId));

        this.ngZone.run(() => {
            if (!this.isImagePickerModalOpen) {
                return;
            }

            if (!this.selectedGame || this.selectedGame.igdbGameId !== igdbGameId) {
                return;
            }

            this.imagePickerIgdbCoverUrl = coverUrl;
            this.imagePickerResults = this.filterOutImagePickerIgdbCover(this.imagePickerResults);
            this.changeDetectorRef.markForCheck();
        });
    }

    private filterOutImagePickerIgdbCover(results: string[]): string[] {
        const igdbCover = this.imagePickerIgdbCoverUrl;

        if (!igdbCover) {
            return results;
        }

        return results.filter(url => url !== igdbCover);
    }

    private isIgdbCoverUrl(url: string): boolean {
        return /^https:\/\/images\.igdb\.com\/igdb\/image\/upload\//i.test(url.trim());
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

    private async resolveManualForGame(game: GameEntry): Promise<void> {
        const requestId = ++this.manualResolutionRequestId;
        const override = this.manualService.getOverride(game);

        try {
            const result = await firstValueFrom(this.manualService.resolveManual(game, override?.relativePath));

            if (requestId !== this.manualResolutionRequestId) {
                return;
            }

            if (!this.selectedGame || this.getGameKey(this.selectedGame) !== this.getGameKey(game)) {
                return;
            }

            this.manualCatalogUnavailable = result.unavailable === true;
            this.manualCatalogUnavailableReason = result.reason ?? null;

            if (result.bestMatch) {
                this.manualResolvedUrl = result.bestMatch.url;
                this.manualResolvedRelativePath = result.bestMatch.relativePath;
                this.manualResolvedSource = result.bestMatch.source;
            } else {
                this.manualResolvedUrl = null;
                this.manualResolvedRelativePath = null;
                this.manualResolvedSource = null;
            }

            if (override && result.bestMatch?.source !== 'override' && !this.manualCatalogUnavailable) {
                const shouldRemove = await this.confirmManualOverrideRemoval(game);

                if (shouldRemove && this.selectedGame && this.getGameKey(this.selectedGame) === this.getGameKey(game)) {
                    this.manualService.clearOverride(game);
                    await this.resolveManualForGame(game);
                    return;
                }
            }

            this.changeDetectorRef.markForCheck();
        } catch {
            if (requestId !== this.manualResolutionRequestId) {
                return;
            }

            this.manualResolvedUrl = null;
            this.manualResolvedRelativePath = null;
            this.manualResolvedSource = null;
            this.manualCatalogUnavailable = true;
            this.manualCatalogUnavailableReason = 'Manual catalog is unavailable.';
            this.changeDetectorRef.markForCheck();
        }
    }

    private async confirmManualOverrideRemoval(game: GameEntry): Promise<boolean> {
        const alert = await this.alertController.create({
            header: 'Manual Not Found',
            message: `Your saved manual match for ${this.getGameDisplayTitle(game)} is no longer available. Remove the custom match and retry auto-match?`,
            buttons: [
                {
                    text: 'Keep',
                    role: 'cancel',
                },
                {
                    text: 'Remove',
                    role: 'confirm',
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();
        return role === 'confirm';
    }

    private async openStatusPicker(game: GameEntry): Promise<void> {
        const currentStatus = normalizeGameStatus(game.status);
        let nextStatus = currentStatus;

        const alert = await this.alertController.create({
            header: 'Set Status',
            message: `Choose a status for ${this.getGameDisplayTitle(game)}.`,
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
                        nextStatus = normalizeGameStatus(value);
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
            void this.resolveManualForGame(updated);
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

    private async openRatingPicker(game: GameEntry): Promise<void> {
        const currentRating = normalizeGameRating(game.rating);
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

    private resolveEditMetadataPlatformSelection(): { name: string; igdbId: number } | null {
        const selectedId = this.editMetadataPlatformIgdbId;

        if (selectedId === null) {
            return null;
        }

        const selected = this.editMetadataPlatformOptions.find(option => option.id === selectedId);
        const selectedName = typeof selected?.name === 'string' ? selected.name.trim() : '';
        const normalizedId = this.normalizePlatformSelectionValue(selected?.id);

        if (selectedName.length === 0 || normalizedId === null) {
            return null;
        }

        return {
            name: selectedName,
            igdbId: normalizedId,
        };
    }

    private normalizePlatformSelectionValue(value: unknown): number | null {
        const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    private async readImageFileAsDataUrl(file: File): Promise<{ dataUrl: string; compressed: boolean } | null> {
        if (!file.type.startsWith('image/')) {
            return null;
        }

        const originalDataUrl = await this.readFileAsDataUrl(file);

        if (!originalDataUrl) {
            return null;
        }

        if (this.getApproximateStringBytes(originalDataUrl) <= GameListComponent.MAX_CUSTOM_COVER_DATA_URL_BYTES) {
            return { dataUrl: originalDataUrl, compressed: false };
        }

        const compressedDataUrl = await this.compressImageDataUrlToFitLimit(
            originalDataUrl,
            GameListComponent.MAX_CUSTOM_COVER_DATA_URL_BYTES,
            this.getCompressionOutputMimeType(file.type),
        );

        if (!compressedDataUrl) {
            return null;
        }

        return { dataUrl: compressedDataUrl, compressed: true };
    }

    private async readFileAsDataUrl(file: File): Promise<string | null> {
        return await new Promise<string | null>(resolve => {
            const reader = new FileReader();

            reader.onload = () => {
                const dataUrl = typeof reader.result === 'string' ? reader.result : '';
                resolve(/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) ? dataUrl : null);
            };
            reader.onerror = () => resolve(null);
            reader.onabort = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    private async compressImageDataUrlToFitLimit(
        sourceDataUrl: string,
        maxBytes: number,
        mimeType: 'image/webp' | 'image/jpeg',
    ): Promise<string | null> {
        const image = await this.loadImageFromDataUrl(sourceDataUrl);

        if (!image) {
            return null;
        }

        for (const scaleFactor of GameListComponent.CUSTOM_COVER_SCALE_FACTORS) {
            const targetWidth = Math.max(1, Math.round(image.naturalWidth * scaleFactor));
            const targetHeight = Math.max(1, Math.round(image.naturalHeight * scaleFactor));
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const context = canvas.getContext('2d');

            if (!context) {
                continue;
            }

            context.drawImage(image, 0, 0, targetWidth, targetHeight);

            let bestDataUrl: string | null = null;
            let low = GameListComponent.MIN_CUSTOM_COVER_QUALITY;
            let high = GameListComponent.MAX_CUSTOM_COVER_QUALITY;

            for (let index = 0; index < GameListComponent.CUSTOM_COVER_QUALITY_STEPS; index += 1) {
                const quality = (low + high) / 2;
                const candidate = this.encodeCanvasAsDataUrl(canvas, mimeType, quality);

                if (!candidate) {
                    break;
                }

                if (this.getApproximateStringBytes(candidate) <= maxBytes) {
                    bestDataUrl = candidate;
                    low = quality;
                } else {
                    high = quality;
                }
            }

            if (bestDataUrl) {
                return bestDataUrl;
            }
        }

        return null;
    }

    private loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
        return new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = dataUrl;
        });
    }

    private encodeCanvasAsDataUrl(
        canvas: HTMLCanvasElement,
        mimeType: 'image/webp' | 'image/jpeg',
        quality: number,
    ): string | null {
        const dataUrl = canvas.toDataURL(mimeType, quality);
        return /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) ? dataUrl : null;
    }

    private getCompressionOutputMimeType(inputMimeType: string): 'image/webp' | 'image/jpeg' {
        return inputMimeType === 'image/jpeg' || inputMimeType === 'image/jpg' ? 'image/jpeg' : 'image/webp';
    }

    private getApproximateStringBytes(value: string): number {
        return value.length;
    }

    constructor() {
        addIcons({ star, ellipsisHorizontal, close, closeCircle, starOutline, play, trashBin, trophy, bookmark, pause, refresh, search, logoGoogle, logoYoutube, chevronBack, documentText });
    }
}
