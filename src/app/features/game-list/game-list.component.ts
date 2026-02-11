import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertController, IonItemSliding, PopoverController, ToastController } from '@ionic/angular/standalone';
import {
    IonList,
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
    IonNote
} from '@ionic/angular/standalone';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameCatalogResult,
    GameEntry,
    GameGroupByField,
    GameListFilters,
    GameRatingFilterOption,
    GameRating,
    GameStatusFilterOption,
    GameStatus,
    ListType,
    Tag
} from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { ImageCacheService } from '../../core/services/image-cache.service';
import { GameSearchComponent } from '../game-search/game-search.component';
import { addIcons } from "ionicons";
import { star, ellipsisHorizontal, close, starOutline, play, trashBin, trophy, bookmark, pause, refresh } from "ionicons/icons";

interface GameGroupSection {
    key: string;
    title: string;
    games: GameEntry[];
}

interface GroupedGamesView {
    grouped: boolean;
    sections: GameGroupSection[];
    totalCount: number;
}

export interface GameListSelectionState {
    active: boolean;
    selectedCount: number;
    allDisplayedSelected: boolean;
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
        GameSearchComponent,
    ],
})
export class GameListComponent implements OnChanges {
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
    @Output() genreOptionsChange = new EventEmitter<string[]>();
    @Output() tagOptionsChange = new EventEmitter<string[]>();
    @Output() displayedGamesChange = new EventEmitter<GameEntry[]>();
    @Output() selectionStateChange = new EventEmitter<GameListSelectionState>();

    games$: Observable<GameEntry[]> = of([]);
    groupedView$: Observable<GroupedGamesView> = of({ grouped: false, sections: [], totalCount: 0 });
    isGameDetailModalOpen = false;
    isImagePickerModalOpen = false;
    isFixMatchModalOpen = false;
    isRatingModalOpen = false;
    selectedGame: GameEntry | null = null;
    ratingTargetGame: GameEntry | null = null;
    ratingDraft: GameRating = 3;
    clearRatingOnSave = false;
    imagePickerQuery = '';
    imagePickerResults: string[] = [];
    isImagePickerLoading = false;
    imagePickerError: string | null = null;
    fixMatchInitialQuery = '';
    fixMatchInitialPlatformIgdbId: number | null = null;
    selectionModeActive = false;
    isRowActionsPopoverOpen = false;
    rowActionsPopoverEvent: Event | undefined = undefined;
    rowActionsGame: GameEntry | null = null;
    selectedGameKeys = new Set<string>();
    private readonly rowCoverUrlByGameKey = new Map<string, string>();
    private readonly detailCoverUrlByGameKey = new Map<string, string>();
    private readonly rowCoverLoadingGameKeys = new Set<string>();
    private readonly detailCoverLoadingGameKeys = new Set<string>();
    private displayedGames: GameEntry[] = [];
    private rowActionsSlidingItem: IonItemSliding | null = null;
    private longPressTimerId: ReturnType<typeof setTimeout> | null = null;
    private longPressTriggeredExternalId: string | null = null;
    private readonly gameShelfService = inject(GameShelfService);
    private readonly popoverController = inject(PopoverController);
    private readonly alertController = inject(AlertController);
    private readonly toastController = inject(ToastController);
    private readonly imageCacheService = inject(ImageCacheService);
    private readonly changeDetectorRef = inject(ChangeDetectorRef);
    private readonly filters$ = new BehaviorSubject<GameListFilters>({ ...DEFAULT_GAME_LIST_FILTERS });
    private readonly searchQuery$ = new BehaviorSubject<string>('');
    private readonly groupBy$ = new BehaviorSubject<GameGroupByField>('none');

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['listType']?.currentValue) {
            const allGames$ = this.gameShelfService.watchList(this.listType).pipe(
                tap(games => {
                    this.platformOptionsChange.emit(this.extractPlatforms(games));
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
                map(([games, groupBy]) => this.buildGroupedView(games, groupBy))
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

    onGameRowClick(game: GameEntry): void {
        if (this.longPressTriggeredExternalId === this.getGameKey(game)) {
            this.longPressTriggeredExternalId = null;
            return;
        }

        if (this.selectionModeActive) {
            this.toggleGameSelection(this.getGameKey(game));
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

        try {
            await Promise.all(selectedGames.map(game => this.gameShelfService.refreshGameMetadata(game.igdbGameId, game.platformIgdbId)));
            this.clearSelectionMode();
            await this.presentToast(`Refreshed metadata for ${selectedGames.length} game${selectedGames.length === 1 ? '' : 's'}.`);
        } catch {
            await this.presentToast('Unable to refresh metadata for selected games.', 'danger');
        }
    }

    async updateHltbForSelectedGames(): Promise<void> {
        const selectedGames = this.getSelectedGames();

        if (selectedGames.length === 0) {
            return;
        }

        try {
            await Promise.all(selectedGames.map(game => this.gameShelfService.refreshGameCompletionTimes(game.igdbGameId, game.platformIgdbId)));
            this.clearSelectionMode();
            await this.presentToast(`Updated HLTB data for ${selectedGames.length} game${selectedGames.length === 1 ? '' : 's'}.`);
        } catch {
            await this.presentToast('Unable to update HLTB data for selected games.', 'danger');
        }
    }

    openGameDetail(game: GameEntry): void {
        this.selectedGame = game;
        this.isGameDetailModalOpen = true;
        this.resetImagePickerState();
        void this.loadDetailCoverUrl(game);
    }

    closeGameDetailModal(): void {
        this.isGameDetailModalOpen = false;
        this.isImagePickerModalOpen = false;
        this.selectedGame = null;
        this.resetImagePickerState();
    }

    closeRatingModal(): void {
        this.isRatingModalOpen = false;
        this.ratingTargetGame = null;
        this.ratingDraft = 3;
        this.clearRatingOnSave = false;
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

    trackByExternalId(_: number, game: GameEntry): string {
        return `${game.igdbGameId}::${game.platformIgdbId}`;
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
        await this.refreshSelectedGameMetadata();
        await this.popoverController.dismiss();
    }

    async refreshSelectedGameCompletionTimesFromPopover(): Promise<void> {
        await this.refreshSelectedGameCompletionTimes();
        await this.popoverController.dismiss();
    }

    async openImagePickerFromPopover(): Promise<void> {
        await this.popoverController.dismiss();
        await this.openImagePickerModal();
    }

    async openFixMatchFromPopover(): Promise<void> {
        this.openFixMatchModal();
        await this.popoverController.dismiss();
    }

    async deleteSelectedGameFromPopover(): Promise<void> {
        await this.popoverController.dismiss();

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
            this.selectedGame = updated;
            this.closeFixMatchModal();
            await this.presentToast('Game match updated.');
        } catch {
            await this.presentToast('Unable to update game match.', 'danger');
        }
    }

    async openSelectedGameTagsFromPopover(): Promise<void> {
        await this.popoverController.dismiss();

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
            this.selectedGame = updated;
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
            this.selectedGame = updated;
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
            this.selectedGame = updated;
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
            this.selectedGame = updated;
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
            this.selectedGame = updated;
            await this.presentToast('Game metadata refreshed.');
        } catch {
            await this.presentToast('Unable to refresh game metadata.', 'danger');
        }
    }

    async refreshSelectedGameCompletionTimes(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.refreshGameCompletionTimes(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId);
            this.selectedGame = updated;
            await this.presentToast('HLTB data updated.');
        } catch {
            await this.presentToast('Unable to update HLTB data.', 'danger');
        }
    }

    closeImagePickerModal(): void {
        this.isImagePickerModalOpen = false;
    }

    async runImagePickerSearch(): Promise<void> {
        const normalized = this.imagePickerQuery.trim();

        if (normalized.length < 2) {
            this.imagePickerResults = [];
            this.imagePickerError = null;
            return;
        }

        this.isImagePickerLoading = true;
        this.imagePickerError = null;

        try {
            this.imagePickerResults = await firstValueFrom(
                this.gameShelfService.searchBoxArtByTitle(
                    normalized,
                    this.selectedGame?.platform ?? null,
                    this.selectedGame?.platformIgdbId ?? null,
                )
            );
        } catch {
            this.imagePickerResults = [];
            this.imagePickerError = 'Unable to load box art results.';
        } finally {
            this.isImagePickerLoading = false;
        }
    }

    onImagePickerQueryChange(event: Event): void {
        const customEvent = event as CustomEvent<{ value?: string }>;
        this.imagePickerQuery = (customEvent.detail?.value ?? '').replace(/^\s+/, '');
    }

    async applySelectedImage(url: string): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        try {
            const updated = await this.gameShelfService.updateGameCover(this.selectedGame.igdbGameId, this.selectedGame.platformIgdbId, url);
            this.selectedGame = updated;
            this.closeImagePickerModal();
            await this.presentToast('Game image updated.');
        } catch {
            await this.presentToast('Unable to update game image.', 'danger');
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

        return normalized;
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
        const normalizedPlatforms = Array.isArray(filters.platform)
            ? [...new Set(
                filters.platform
                    .map(platform => (typeof platform === 'string' ? platform.trim() : ''))
                    .filter(platform => platform.length > 0)
            )]
            : [];
        const normalizedGenres = Array.isArray(filters.genres)
            ? [...new Set(
                filters.genres
                    .map(genre => (typeof genre === 'string' ? genre.trim() : ''))
                    .filter(genre => genre.length > 0)
            )]
            : [];
        const normalizedStatuses = Array.isArray(filters.statuses)
            ? [...new Set(
                filters.statuses.filter(status =>
                    status === 'none'
                    || status === 'playing'
                    || status === 'wantToPlay'
                    || status === 'completed'
                    || status === 'paused'
                    || status === 'dropped'
                    || status === 'replay'
                )
            )]
            : [];
        const normalizedTags = Array.isArray(filters.tags)
            ? [...new Set(
                filters.tags
                    .map(tag => (typeof tag === 'string' ? tag.trim() : ''))
                    .filter(tag => tag.length > 0)
            )]
            : [];
        const normalizedRatings = Array.isArray(filters.ratings)
            ? [...new Set(
                filters.ratings.filter(rating =>
                    rating === 'none'
                    || rating === 1
                    || rating === 2
                    || rating === 3
                    || rating === 4
                    || rating === 5
                )
            )]
            : [];
        const hasNoneTagFilter = normalizedTags.includes(this.noneTagFilterValue);
        const normalizedTagNames = normalizedTags.filter(tag => tag !== this.noneTagFilterValue);

        return {
            ...DEFAULT_GAME_LIST_FILTERS,
            ...filters,
            platform: normalizedPlatforms,
            genres: normalizedGenres,
            statuses: normalizedStatuses,
            tags: hasNoneTagFilter ? [this.noneTagFilterValue, ...normalizedTagNames] : normalizedTagNames,
            ratings: normalizedRatings,
        };
    }

    private extractPlatforms(games: GameEntry[]): string[] {
        return [...new Set(
            games
                .map(game => game.platform?.trim() ?? '')
                .filter(platform => platform.length > 0)
        )].sort((a, b) => this.compareTitles(a, b));
    }

    private extractGenres(games: GameEntry[]): string[] {
        const genreSet = new Set<string>();

        games.forEach((game: GameEntry) => {
            const genres = Array.isArray(game.genres) ? game.genres : [];

            genres.forEach((genre: string) => {
                const normalized = typeof genre === 'string' ? genre.trim() : '';

                if (normalized.length > 0) {
                    genreSet.add(normalized);
                }
            });
        });

        return Array.from(genreSet).sort((a, b) => this.compareTitles(a, b));
    }

    private extractTags(games: GameEntry[]): string[] {
        const tagSet = new Set<string>();

        games.forEach((game: GameEntry) => {
            const tags = Array.isArray(game.tags) ? game.tags : [];

            tags.forEach(tag => {
                const normalized = typeof tag?.name === 'string' ? tag.name.trim() : '';

                if (normalized.length > 0) {
                    tagSet.add(normalized);
                }
            });
        });

        return Array.from(tagSet).sort((a, b) => this.compareTitles(a, b));
    }

    private applyFiltersAndSort(games: GameEntry[], filters: GameListFilters, searchQuery: string): GameEntry[] {
        const filtered = games.filter(game => this.matchesFilters(game, filters, searchQuery));
        return this.sortGames(filtered, filters);
    }

    private buildGroupedView(games: GameEntry[], groupBy: GameGroupByField): GroupedGamesView {
        if (groupBy === 'none') {
            return {
                grouped: false,
                sections: [{ key: 'none', title: 'All Games', games }],
                totalCount: games.length,
            };
        }

        const sectionsMap = new Map<string, GameEntry[]>();

        games.forEach(game => {
            this.getGroupTitlesForGame(game, groupBy).forEach(title => {
                const normalized = title.trim();

                if (!sectionsMap.has(normalized)) {
                    sectionsMap.set(normalized, []);
                }

                sectionsMap.get(normalized)?.push(game);
            });
        });

        const sortedSections = [...sectionsMap.entries()]
            .sort(([left], [right]) => this.compareGroupTitles(left, right, groupBy))
            .map(([title, groupedGames]) => ({
                key: `${groupBy}-${title}`,
                title,
                games: groupedGames,
            }));

        return {
            grouped: true,
            sections: sortedSections,
            totalCount: games.length,
        };
    }

    private getGroupTitlesForGame(game: GameEntry, groupBy: GameGroupByField): string[] {
        const noGroupLabel = this.getNoGroupLabel(groupBy);

        if (groupBy === 'platform') {
            return [game.platform?.trim() || noGroupLabel];
        }

        if (groupBy === 'releaseYear') {
            return [game.releaseYear ? String(game.releaseYear) : noGroupLabel];
        }

        if (groupBy === 'tag') {
            const tagNames = (game.tags ?? [])
                .map(tag => tag.name.trim())
                .filter(name => name.length > 0);

            return tagNames.length > 0 ? [...new Set(tagNames)] : [noGroupLabel];
        }

        if (groupBy === 'developer') {
            return this.getMetadataGroupValues(game.developers, noGroupLabel);
        }

        if (groupBy === 'franchise') {
            return this.getMetadataGroupValues(game.franchises, noGroupLabel);
        }

        if (groupBy === 'genre') {
            return this.getMetadataGroupValues(game.genres, noGroupLabel);
        }

        if (groupBy === 'publisher') {
            return this.getMetadataGroupValues(game.publishers, noGroupLabel);
        }

        return ['All Games'];
    }

    private getMetadataGroupValues(values: string[] | undefined, fallback: string): string[] {
        if (!Array.isArray(values)) {
            return [fallback];
        }

        const normalizedValues = [...new Set(
            values
                .map(value => (typeof value === 'string' ? value.trim() : ''))
                .filter(value => value.length > 0)
        )];

        return normalizedValues.length > 0 ? normalizedValues : [fallback];
    }

    private compareGroupTitles(left: string, right: string, groupBy: GameGroupByField): number {
        const noGroupLabel = this.getNoGroupLabel(groupBy);

        if (left === noGroupLabel && right !== noGroupLabel) {
            return -1;
        }

        if (right === noGroupLabel && left !== noGroupLabel) {
            return 1;
        }

        if (groupBy === 'releaseYear') {
            const leftYear = Number.parseInt(left, 10);
            const rightYear = Number.parseInt(right, 10);

            if (!Number.isNaN(leftYear) && !Number.isNaN(rightYear) && leftYear !== rightYear) {
                return rightYear - leftYear;
            }
        }

        return this.compareTitles(left, right);
    }

    private getNoGroupLabel(groupBy: GameGroupByField): string {
        if (groupBy === 'platform') {
            return '[No Platform]';
        }

        if (groupBy === 'developer') {
            return '[No Developer]';
        }

        if (groupBy === 'franchise') {
            return '[No Franchise]';
        }

        if (groupBy === 'tag') {
            return '[No Tag]';
        }

        if (groupBy === 'genre') {
            return '[No Genre]';
        }

        if (groupBy === 'publisher') {
            return '[No Publisher]';
        }

        if (groupBy === 'releaseYear') {
            return '[No Release Year]';
        }

        return '[No Group]';
    }

    private matchesFilters(game: GameEntry, filters: GameListFilters, searchQuery: string): boolean {
        if (searchQuery.length > 0 && !game.title.toLowerCase().includes(searchQuery.toLowerCase())) {
            return false;
        }

        if (filters.platform.length > 0 && !filters.platform.includes(game.platform ?? '')) {
            return false;
        }

        if (filters.genres.length > 0) {
            const gameGenres = Array.isArray(game.genres)
                ? game.genres
                    .map(genre => (typeof genre === 'string' ? genre.trim() : ''))
                    .filter(genre => genre.length > 0)
                : [];

            if (!filters.genres.some(selectedGenre => gameGenres.includes(selectedGenre))) {
                return false;
            }
        }

        if (filters.statuses.length > 0) {
            const gameStatus = this.normalizeStatus(game.status);
            const matchesNone = gameStatus === null && filters.statuses.includes('none');
            const matchesStatus = gameStatus !== null && filters.statuses.includes(gameStatus as GameStatusFilterOption);

            if (!matchesNone && !matchesStatus) {
                return false;
            }
        }

        if (filters.tags.length > 0) {
            const matchesNoneTagFilter = filters.tags.includes(this.noneTagFilterValue);
            const selectedTagNames = filters.tags.filter(tag => tag !== this.noneTagFilterValue);
            const gameTagNames = Array.isArray(game.tags)
                ? game.tags
                    .map(tag => (typeof tag?.name === 'string' ? tag.name.trim() : ''))
                    .filter(tagName => tagName.length > 0)
                : [];

            const matchesSelectedTag = selectedTagNames.some(selectedTag => gameTagNames.includes(selectedTag));
            const matchesNoTags = matchesNoneTagFilter && gameTagNames.length === 0;

            if (!matchesSelectedTag && !matchesNoTags) {
                return false;
            }
        }

        if (filters.ratings.length > 0) {
            const gameRating = this.normalizeRating(game.rating);
            const matchesNone = gameRating === null && filters.ratings.includes('none');
            const matchesRating = gameRating !== null && filters.ratings.includes(gameRating as GameRatingFilterOption);

            if (!matchesNone && !matchesRating) {
                return false;
            }
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
            return this.compareTitles(left.title, right.title);
        }

        if (sortField === 'platform') {
            const leftPlatform = left.platform?.trim() || 'Unknown platform';
            const rightPlatform = right.platform?.trim() || 'Unknown platform';
            const platformCompare = leftPlatform.localeCompare(rightPlatform, undefined, { sensitivity: 'base' });

            if (platformCompare !== 0) {
                return platformCompare;
            }

            return this.compareTitles(left.title, right.title);
        }

        if (sortField === 'createdAt') {
            const leftCreatedAt = Date.parse(left.createdAt);
            const rightCreatedAt = Date.parse(right.createdAt);
            const leftValid = Number.isNaN(leftCreatedAt) ? null : leftCreatedAt;
            const rightValid = Number.isNaN(rightCreatedAt) ? null : rightCreatedAt;

            if (leftValid !== null && rightValid !== null && leftValid !== rightValid) {
                return leftValid - rightValid;
            }

            if (leftValid !== null && rightValid === null) {
                return -1;
            }

            if (leftValid === null && rightValid !== null) {
                return 1;
            }

            return this.compareTitles(left.title, right.title);
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

        return this.compareTitles(left.title, right.title);
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

    private async openImagePickerModal(): Promise<void> {
        if (!this.selectedGame) {
            return;
        }

        this.imagePickerQuery = this.selectedGame.title;
        this.imagePickerResults = [];
        this.imagePickerError = null;
        this.isImagePickerModalOpen = true;
        await this.runImagePickerSearch();
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

        if (this.selectedGame && this.getGameKey(this.selectedGame) === this.getGameKey(updated)) {
            this.selectedGame = updated;
        }

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

    private resetImagePickerState(): void {
        this.imagePickerQuery = '';
        this.imagePickerResults = [];
        this.imagePickerError = null;
        this.isImagePickerLoading = false;
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

        if (role !== 'confirm') {
            return;
        }

        try {
            const updated = await this.gameShelfService.setGameStatus(game.igdbGameId, game.platformIgdbId, nextStatus);

            if (this.selectedGame && this.getGameKey(this.selectedGame) === this.getGameKey(updated)) {
                this.selectedGame = updated;
            }

            await this.presentToast('Game status updated.');
        } catch {
            await this.presentToast('Unable to update game status.', 'danger');
        }
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
        addIcons({ star, ellipsisHorizontal, close, starOutline, play, trashBin, trophy, bookmark, pause, refresh });
    }
}
