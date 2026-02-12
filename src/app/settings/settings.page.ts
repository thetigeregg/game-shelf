import { Component, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSelect, IonSelectOption, IonListHeader, IonButton, IonModal, IonIcon, IonFooter, IonSearchbar, IonThumbnail, IonLoading } from "@ionic/angular/standalone";
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import {
    DEFAULT_GAME_LIST_FILTERS,
    GameCatalogPlatformOption,
    GameCatalogResult,
    GameEntry,
    GameGroupByField,
    GameListFilters,
    GameListView,
    GameRating,
    GameStatus,
    ListType,
    Tag,
} from '../core/models/game.models';
import { COLOR_SCHEME_STORAGE_KEY, ColorSchemePreference, PRIMARY_COLOR_STORAGE_KEY, ThemeService } from '../core/services/theme.service';
import { GAME_REPOSITORY, GameRepository } from '../core/data/game-repository';
import { GameShelfService } from '../core/services/game-shelf.service';
import { ImageCacheService } from '../core/services/image-cache.service';
import { PlatformOrderService } from '../core/services/platform-order.service';
import { addIcons } from "ionicons";
import { close, trash, alertCircle, download, share, fileTrayFull, chevronUp, chevronDown, swapVertical, refresh } from "ionicons/icons";

interface ThemePreset {
    label: string;
    value: string;
}

type ExportRowType = 'game' | 'tag' | 'view' | 'setting';

interface ExportCsvRow {
    type: ExportRowType;
    listType: string;
    igdbGameId: string;
    platformIgdbId: string;
    title: string;
    coverUrl: string;
    coverSource: string;
    platform: string;
    releaseDate: string;
    releaseYear: string;
    hltbMainHours: string;
    hltbMainExtraHours: string;
    hltbCompletionistHours: string;
    status: string;
    rating: string;
    developers: string;
    franchises: string;
    genres: string;
    publishers: string;
    tags: string;
    gameTagIds: string;
    tagId: string;
    name: string;
    color: string;
    groupBy: string;
    filters: string;
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
}

interface ParsedGameImportRow {
    kind: 'game';
    listType: ListType;
    catalog: GameCatalogResult;
    status: GameStatus | null;
    rating: GameRating | null;
    tagNames: string[];
    tagIds: number[];
}

interface ParsedTagImportRow {
    kind: 'tag';
    tagId: number | null;
    name: string;
    color: string;
}

interface ParsedViewImportRow {
    kind: 'view';
    name: string;
    listType: ListType;
    groupBy: GameGroupByField;
    filters: GameListFilters;
}

interface ParsedSettingImportRow {
    kind: 'setting';
    key: string;
    value: string;
}

type ParsedImportRow = ParsedGameImportRow | ParsedTagImportRow | ParsedViewImportRow | ParsedSettingImportRow;

interface ImportPreviewRow {
    id: number;
    rowNumber: number;
    type: ExportRowType | 'unknown';
    summary: string;
    error: string | null;
    warning: string | null;
    parsed: ParsedImportRow | null;
}

type MgcRowStatus = 'pending' | 'searching' | 'resolved' | 'multiple' | 'noMatch' | 'error';

interface MgcImportRow {
    id: number;
    rowNumber: number;
    name: string;
    platformInput: string;
    platform: string;
    platformIgdbId: number | null;
    labelsRaw: string;
    labels: string[];
    status: MgcRowStatus;
    statusDetail: string;
    warning: string | null;
    error: string | null;
    duplicateError: string | null;
    candidates: GameCatalogResult[];
    selected: GameCatalogResult | null;
}

const CSV_HEADERS: Array<keyof ExportCsvRow> = [
    'type',
    'listType',
    'igdbGameId',
    'platformIgdbId',
    'title',
    'coverUrl',
    'coverSource',
    'platform',
    'releaseDate',
    'releaseYear',
    'hltbMainHours',
    'hltbMainExtraHours',
    'hltbCompletionistHours',
    'status',
    'rating',
    'developers',
    'franchises',
    'genres',
    'publishers',
    'tags',
    'gameTagIds',
    'tagId',
    'name',
    'color',
    'groupBy',
    'filters',
    'key',
    'value',
    'createdAt',
    'updatedAt',
];

const REQUIRED_CSV_HEADERS: Array<keyof ExportCsvRow> = [
    'type',
    'listType',
    'igdbGameId',
    'platformIgdbId',
    'title',
    'coverUrl',
    'coverSource',
    'platform',
    'releaseDate',
    'releaseYear',
    'status',
    'rating',
    'developers',
    'franchises',
    'genres',
    'publishers',
    'tags',
    'name',
    'color',
    'groupBy',
    'filters',
    'key',
    'value',
    'createdAt',
    'updatedAt',
];

@Component({
    selector: 'app-settings',
    templateUrl: './settings.page.html',
    styleUrls: ['./settings.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        IonHeader,
        IonToolbar,
        IonButtons,
        IonBackButton,
        IonTitle,
        IonContent,
        IonList,
        IonItem,
        IonLabel,
        IonSelect,
        IonSelectOption,
        IonListHeader,
        IonButton,
        IonModal,
        IonIcon,
        IonFooter,
        IonSearchbar,
        IonThumbnail,
        IonLoading,
    ],
})
export class SettingsPage {
    private static readonly MGC_RESOLVE_BASE_INTERVAL_MS = 450;
    private static readonly MGC_RESOLVE_MIN_INTERVAL_MS = 350;
    private static readonly MGC_RESOLVE_MAX_INTERVAL_MS = 1600;
    private static readonly MGC_BOX_ART_MIN_INTERVAL_MS = 350;
    private static readonly MGC_RESOLVE_MAX_ATTEMPTS = 3;
    private static readonly MGC_BOX_ART_MAX_ATTEMPTS = 3;
    private static readonly MGC_RATE_LIMIT_FALLBACK_COOLDOWN_MS = 1000;
    private static readonly MGC_RATE_LIMIT_MAX_COOLDOWN_MS = 60000;
    private static readonly IMAGE_CACHE_MIN_MB = 20;
    private static readonly IMAGE_CACHE_MAX_MB = 2048;

    readonly presets: ThemePreset[] = [
        { label: 'Ionic Blue', value: '#3880ff' },
        { label: 'Emerald', value: '#2ecc71' },
        { label: 'Sunset Orange', value: '#ff6b35' },
        { label: 'Rose', value: '#e91e63' },
        { label: 'Slate', value: '#546e7a' },
    ];
    readonly colorSchemeOptions: Array<{ label: string; value: ColorSchemePreference }> = [
        { label: 'System', value: 'system' },
        { label: 'Light', value: 'light' },
        { label: 'Dark', value: 'dark' },
    ];

    selectedColor = '';
    customColor = '';
    selectedColorScheme: ColorSchemePreference = 'system';
    imageCacheLimitMb = 200;
    imageCacheUsageMb = 0;
    isPlatformOrderModalOpen = false;
    isPlatformOrderLoading = false;
    platformOrderItems: GameCatalogPlatformOption[] = [];
    isImportPreviewOpen = false;
    isApplyingImport = false;
    importPreviewRows: ImportPreviewRow[] = [];
    isMgcImportOpen = false;
    isResolvingMgcPage = false;
    isApplyingMgcImport = false;
    mgcRows: MgcImportRow[] = [];
    mgcTargetListType: ListType | null = null;
    mgcPageSize = 50;
    mgcPageIndex = 0;
    isMgcResolverOpen = false;
    mgcResolverRowId: number | null = null;
    mgcResolverQuery = '';
    mgcResolverResults: GameCatalogResult[] = [];
    isMgcResolverSearching = false;
    mgcResolverError = '';
    isImportLoadingOpen = false;
    importLoadingMessage = '';
    isSummaryModalOpen = false;
    summaryModalTitle = '';
    summaryModalLines: string[] = [];
    readonly mgcPageSizeOptions = [25, 50, 100];
    private mgcSearchPlatforms: GameCatalogPlatformOption[] = [];
    private readonly mgcPlatformLookup = new Map<string, GameCatalogPlatformOption>();
    private mgcPlatformLookupLoaded = false;
    private mgcExistingGameKeys = new Set<string>();
    private mgcRateLimitCooldownUntilMs = 0;

    private readonly themeService = inject(ThemeService);
    private readonly repository: GameRepository = inject(GAME_REPOSITORY);
    private readonly gameShelfService = inject(GameShelfService);
    private readonly imageCacheService = inject(ImageCacheService);
    private readonly platformOrderService = inject(PlatformOrderService);
    private readonly toastController = inject(ToastController);
    private readonly alertController = inject(AlertController);
    private readonly router = inject(Router);

    constructor() {
        const currentColor = this.themeService.getPrimaryColor();
        this.selectedColor = this.findPresetColor(currentColor) ?? 'custom';
        this.customColor = currentColor;
        this.selectedColorScheme = this.themeService.getColorSchemePreference();
        this.imageCacheLimitMb = this.imageCacheService.getLimitMb();
        void this.refreshImageCacheUsage();
        addIcons({ close, trash, alertCircle, download, share, fileTrayFull, chevronUp, chevronDown, swapVertical, refresh });
    }

    onColorSchemePreferenceChange(value: ColorSchemePreference | string): void {
        if (value !== 'system' && value !== 'light' && value !== 'dark') {
            return;
        }

        this.selectedColorScheme = value;
        this.themeService.setColorSchemePreference(value);
    }

    onImageCacheLimitChange(value: number | string | null | undefined): void {
        const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

        if (!Number.isInteger(parsed)) {
            this.imageCacheLimitMb = this.imageCacheService.getLimitMb();
            return;
        }

        const normalized = Math.max(
            SettingsPage.IMAGE_CACHE_MIN_MB,
            Math.min(parsed, SettingsPage.IMAGE_CACHE_MAX_MB),
        );
        this.imageCacheLimitMb = this.imageCacheService.setLimitMb(normalized);
        void this.refreshImageCacheUsage();
    }

    async openPlatformOrderModal(): Promise<void> {
        this.isPlatformOrderLoading = true;

        try {
            this.platformOrderItems = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
            this.isPlatformOrderModalOpen = true;
        } catch {
            await this.presentToast('Unable to load platforms.', 'danger');
            this.platformOrderItems = [];
            this.isPlatformOrderModalOpen = false;
        } finally {
            this.isPlatformOrderLoading = false;
        }
    }

    closePlatformOrderModal(): void {
        this.isPlatformOrderModalOpen = false;
    }

    async resetPlatformOrder(): Promise<void> {
        this.platformOrderService.clearOrder();
        this.platformOrderItems = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
    }

    movePlatformOrderItemUp(index: number): void {
        this.movePlatformOrderItem(index, -1);
    }

    movePlatformOrderItemDown(index: number): void {
        this.movePlatformOrderItem(index, 1);
    }

    trackByPlatformOrderItem(_index: number, item: GameCatalogPlatformOption): string {
        return `${item.id ?? 'none'}::${item.name}`;
    }

    private movePlatformOrderItem(index: number, delta: number): void {
        const target = index + delta;

        if (index < 0 || target < 0 || index >= this.platformOrderItems.length || target >= this.platformOrderItems.length) {
            return;
        }

        const next = [...this.platformOrderItems];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        this.platformOrderItems = next;
        this.platformOrderService.setOrder(next.map(option => option.name));
    }

    private async refreshImageCacheUsage(): Promise<void> {
        const usageBytes = await this.imageCacheService.getUsageBytes();
        this.imageCacheUsageMb = Math.round((usageBytes / (1024 * 1024)) * 10) / 10;
    }

    get importErrorCount(): number {
        return this.importPreviewRows.filter(row => row.error !== null).length;
    }

    get importWarningCount(): number {
        return this.importPreviewRows.filter(row => row.warning !== null).length;
    }

    get canApplyImport(): boolean {
        return this.importPreviewRows.length > 0 && this.importErrorCount === 0 && !this.isApplyingImport;
    }

    get mgcPageCount(): number {
        if (this.mgcRows.length === 0) {
            return 1;
        }

        return Math.max(1, Math.ceil(this.mgcRows.length / this.mgcPageSize));
    }

    get mgcCurrentPageRows(): MgcImportRow[] {
        const start = this.mgcPageIndex * this.mgcPageSize;
        return this.mgcRows.slice(start, start + this.mgcPageSize);
    }

    get mgcResolvedCount(): number {
        return this.mgcRows.filter(row => this.isMgcRowReady(row)).length;
    }

    get mgcBlockedCount(): number {
        return this.mgcRows.filter(row => !this.isMgcRowReady(row)).length;
    }

    get canApplyMgcImport(): boolean {
        return this.mgcTargetListType !== null
            && this.mgcRows.length > 0
            && this.mgcBlockedCount === 0
            && !this.isApplyingMgcImport
            && !this.isResolvingMgcPage;
    }

    onPresetColorChange(value: string): void {
        if (value === 'custom') {
            this.selectedColor = value;
            this.themeService.setPrimaryColor(this.customColor);
            return;
        }

        this.selectedColor = value;
        this.customColor = value;
        this.themeService.setPrimaryColor(value);
    }

    onCustomColorChange(value: string): void {
        if (!value) {
            return;
        }

        this.customColor = value;
        this.selectedColor = 'custom';
        this.themeService.setPrimaryColor(value);
    }

    async exportCsv(): Promise<void> {
        try {
            const csv = await this.buildExportCsv();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `game-shelf-export-${timestamp}.csv`;
            await this.presentShareDialog(csv, filename);
            await this.presentToast('CSV export prepared.');
        } catch {
            await this.presentToast('Unable to export CSV.', 'danger');
        }
    }

    triggerImport(fileInput: HTMLInputElement): void {
        fileInput.value = '';
        fileInput.click();
    }

    async onImportFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            this.importPreviewRows = await this.parseImportCsv(text);
            this.isImportPreviewOpen = true;
        } catch {
            this.importPreviewRows = [];
            this.isImportPreviewOpen = false;
            await this.presentToast('Unable to read CSV file.', 'danger');
        }
    }

    async confirmRemoveImportRow(rowId: number): Promise<void> {
        const alert = await this.alertController.create({
            header: 'Remove Import Row',
            message: 'Remove this row from the import?',
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Remove',
                    role: 'confirm',
                    cssClass: 'alert-button-danger',
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm') {
            return;
        }

        this.importPreviewRows = this.importPreviewRows.filter(row => row.id !== rowId);
    }

    closeImportPreview(): void {
        this.isImportPreviewOpen = false;
    }

    triggerMgcImport(fileInput: HTMLInputElement): void {
        fileInput.value = '';
        fileInput.click();
    }

    openMetadataValidator(): void {
        void this.router.navigateByUrl('/metadata-validator');
    }

    async onMgcImportFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            const rows = await this.parseMgcCsv(text);
            this.mgcRows = rows;
            this.mgcPageIndex = 0;
            this.mgcPageSize = 50;
            this.mgcTargetListType = null;
            this.isMgcImportOpen = true;
            this.isMgcResolverOpen = false;
            this.mgcResolverRowId = null;
        } catch {
            await this.presentToast('Unable to parse MGC CSV file.', 'danger');
        }
    }

    closeMgcImport(): void {
        this.isMgcImportOpen = false;
        this.isMgcResolverOpen = false;
        this.isResolvingMgcPage = false;
        this.isApplyingMgcImport = false;
        this.mgcResolverRowId = null;
        this.mgcResolverResults = [];
        this.mgcResolverError = '';
        this.isImportLoadingOpen = false;
        this.importLoadingMessage = '';
    }

    closeSummaryModal(): void {
        this.isSummaryModalOpen = false;
        this.summaryModalTitle = '';
        this.summaryModalLines = [];
    }

    async confirmRemoveMgcRow(rowId: number): Promise<void> {
        const alert = await this.alertController.create({
            header: 'Remove Import Row',
            message: 'Remove this row from the MGC import?',
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Remove',
                    role: 'confirm',
                    cssClass: 'alert-button-danger',
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm') {
            return;
        }

        this.mgcRows = this.mgcRows.filter(row => row.id !== rowId);
        this.recomputeMgcDuplicateErrors();

        if (this.mgcPageIndex >= this.mgcPageCount) {
            this.mgcPageIndex = Math.max(this.mgcPageCount - 1, 0);
        }
    }

    onMgcTargetListTypeChange(value: ListType | string | null | undefined): void {
        if (value === 'collection' || value === 'wishlist') {
            this.mgcTargetListType = value;
            return;
        }

        this.mgcTargetListType = null;
    }

    onMgcPageSizeChange(value: number | string | null | undefined): void {
        const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);

        if (!Number.isInteger(parsed) || !this.mgcPageSizeOptions.includes(parsed)) {
            return;
        }

        this.mgcPageSize = parsed;
        this.mgcPageIndex = 0;
    }

    goToPreviousMgcPage(): void {
        if (this.mgcPageIndex <= 0) {
            return;
        }

        this.mgcPageIndex -= 1;
    }

    goToNextMgcPage(): void {
        if (this.mgcPageIndex >= this.mgcPageCount - 1) {
            return;
        }

        this.mgcPageIndex += 1;
    }

    async resolveCurrentMgcPage(): Promise<void> {
        if (this.isResolvingMgcPage || this.isApplyingMgcImport) {
            return;
        }

        const rowsToResolve = this.mgcCurrentPageRows.filter(row => {
            return row.error === null && !this.isMgcRowReady(row);
        });

        if (rowsToResolve.length === 0) {
            await this.presentToast('No unresolved rows on this page.', 'warning');
            return;
        }

        this.isResolvingMgcPage = true;

        try {
            let lastRequestStartedAt = 0;
            let currentIntervalMs = SettingsPage.MGC_RESOLVE_BASE_INTERVAL_MS;

            for (const row of rowsToResolve) {
                const nowMs = Date.now();
                const cooldownWaitMs = Math.max(this.mgcRateLimitCooldownUntilMs - nowMs, 0);
                const waitMs = Math.max(
                    currentIntervalMs - (nowMs - lastRequestStartedAt),
                    cooldownWaitMs,
                    0,
                );

                if (waitMs > 0) {
                    await this.delay(waitMs);
                }

                lastRequestStartedAt = Date.now();
                await this.resolveMgcRowFromSearchWithRetry(row);

                if (row.status === 'error' && this.isRateLimitStatusDetail(row.statusDetail)) {
                    currentIntervalMs = Math.min(
                        SettingsPage.MGC_RESOLVE_MAX_INTERVAL_MS,
                        Math.round(currentIntervalMs * 1.8),
                    );
                } else {
                    currentIntervalMs = Math.max(
                        SettingsPage.MGC_RESOLVE_MIN_INTERVAL_MS,
                        Math.round(currentIntervalMs * 0.92),
                    );
                }
            }

            this.recomputeMgcDuplicateErrors();
            await this.presentToast(`Resolved ${rowsToResolve.length} row${rowsToResolve.length === 1 ? '' : 's'} on this page.`);
        } catch {
            await this.presentToast('Unable to resolve all rows on this page.', 'danger');
        } finally {
            this.isResolvingMgcPage = false;
        }
    }

    async openMgcRowResolver(row: MgcImportRow): Promise<void> {
        if (row.error || this.isApplyingMgcImport) {
            return;
        }

        this.mgcResolverRowId = row.id;
        this.mgcResolverQuery = row.name;
        this.mgcResolverResults = [];
        this.mgcResolverError = '';
        this.isMgcResolverOpen = true;
        await this.searchMgcResolver();
    }

    closeMgcResolver(): void {
        this.isMgcResolverOpen = false;
        this.mgcResolverRowId = null;
        this.mgcResolverQuery = '';
        this.mgcResolverResults = [];
        this.mgcResolverError = '';
        this.isMgcResolverSearching = false;
    }

    onMgcResolverQueryChange(value: string | null | undefined): void {
        this.mgcResolverQuery = value ?? '';
    }

    async searchMgcResolver(): Promise<void> {
        const row = this.activeMgcResolverRow;

        if (!row) {
            return;
        }

        const query = this.mgcResolverQuery.trim();

        if (query.length < 2) {
            this.mgcResolverResults = [];
            this.mgcResolverError = '';
            return;
        }

        this.isMgcResolverSearching = true;
        this.mgcResolverError = '';

        try {
            const results = await firstValueFrom(this.gameShelfService.searchGames(query, row.platformIgdbId));
            this.mgcResolverResults = results;
        } catch {
            this.mgcResolverResults = [];
            this.mgcResolverError = 'Search failed. Please try again.';
        } finally {
            this.isMgcResolverSearching = false;
        }
    }

    async chooseMgcResolverResult(result: GameCatalogResult): Promise<void> {
        const row = this.activeMgcResolverRow;

        if (!row) {
            return;
        }

        const resolved = await this.resolveCatalogForRow(row, result, true);

        if (!resolved) {
            await this.presentToast('Unable to resolve a platform for this result.', 'warning');
            return;
        }

        row.selected = resolved;
        row.candidates = [resolved];
        row.status = 'resolved';
        row.statusDetail = 'Selected manually';
        row.error = null;
        this.recomputeMgcDuplicateErrors();
        this.closeMgcResolver();
    }

    async confirmApplyMgcImport(): Promise<void> {
        if (!this.canApplyMgcImport || this.mgcTargetListType === null) {
            return;
        }

        const targetLabel = this.mgcTargetListType === 'collection' ? 'Collection' : 'Wishlist';
        const alert = await this.alertController.create({
            header: 'Confirm MGC Import',
            message: `Import ${this.mgcResolvedCount} game${this.mgcResolvedCount === 1 ? '' : 's'} into ${targetLabel}?`,
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Import',
                    role: 'confirm',
                },
            ],
        });

        await alert.present();
        const { role } = await alert.onDidDismiss();

        if (role !== 'confirm') {
            return;
        }

        await this.applyMgcImport();
    }

    trackByMgcRowId(_: number, row: MgcImportRow): number {
        return row.id;
    }

    trackByMgcResolverResult(_: number, result: GameCatalogResult): string {
        return `${result.igdbGameId}-${String(result.platformIgdbId ?? 'x')}-${result.title}`;
    }

    getMgcRowClass(row: MgcImportRow): Record<string, boolean> {
        return {
            'mgc-row-success': this.isMgcRowSuccess(row),
            'mgc-row-warning': this.isMgcRowWarning(row),
            'mgc-row-error': this.isMgcRowError(row),
        };
    }

    getMgcRowStatusText(row: MgcImportRow): string {
        if (row.duplicateError) {
            return row.duplicateError;
        }

        if (row.error) {
            return row.error;
        }

        if (row.status === 'resolved') {
            const title = row.selected?.title ?? row.name;
            const platform = row.selected?.platform ?? row.platform;
            return `Matched: ${title} (${platform})`;
        }

        if (row.status === 'multiple') {
            if (row.selected) {
                return `${row.candidates.length} possible matches found.\nAuto-selected exact title match: ${row.selected.title}.`;
            }

            return `${row.candidates.length} possible matches found.`;
        }

        if (row.status === 'noMatch') {
            return 'No matches found.';
        }

        if (row.status === 'searching') {
            return 'Searching...';
        }

        if (row.status === 'error') {
            return row.statusDetail || 'Search failed.';
        }

        return 'Pending match.';
    }

    get isMgcResolverEmptyStateVisible(): boolean {
        return !this.isMgcResolverSearching
            && this.mgcResolverError.length === 0
            && this.mgcResolverQuery.trim().length >= 2
            && this.mgcResolverResults.length === 0;
    }

    isMgcAutoSelectedMultiple(row: MgcImportRow): boolean {
        return row.status === 'multiple' && row.selected !== null;
    }

    onMgcResultImageError(event: Event): void {
        const target = event.target;

        if (target instanceof HTMLImageElement) {
            target.src = 'assets/icon/favicon.png';
        }
    }

    async applyImport(): Promise<void> {
        if (!this.canApplyImport) {
            return;
        }

        this.isApplyingImport = true;

        try {
            const parsedRows = this.importPreviewRows
                .map(row => row.parsed)
                .filter((row): row is ParsedImportRow => row !== null);

            const settingRows = parsedRows.filter((row): row is ParsedSettingImportRow => row.kind === 'setting');
            const tagRows = parsedRows.filter((row): row is ParsedTagImportRow => row.kind === 'tag');
            const gameRows = parsedRows.filter((row): row is ParsedGameImportRow => row.kind === 'game');
            const viewRows = parsedRows.filter((row): row is ParsedViewImportRow => row.kind === 'view');

            let settingsApplied = 0;
            let tagsApplied = 0;
            let gamesApplied = 0;
            let gameStatusesApplied = 0;
            let gameRatingsApplied = 0;
            let gameTagAssignmentsApplied = 0;
            let viewsApplied = 0;
            let tagsRenamed = 0;
            let viewsRenamed = 0;
            let failedRows = 0;

            for (const settingRow of settingRows) {
                try {
                    this.applyImportedSettings([settingRow]);
                    settingsApplied += 1;
                } catch {
                    failedRows += 1;
                }
            }

            const existingTags = await this.repository.listTags();
            const usedTagNames = new Set(
                existingTags
                    .map(tag => tag.name.trim().toLowerCase())
                    .filter(name => name.length > 0),
            );
            const importedTagIdToResolvedTagId = new Map<number, number>();

            for (const tagRow of tagRows) {
                try {
                    const resolvedName = this.resolveUniqueName(tagRow.name, usedTagNames);
                    if (resolvedName !== tagRow.name) {
                        tagsRenamed += 1;
                    }
                    const createdTag = await this.gameShelfService.createTag(resolvedName, tagRow.color);

                    if (
                        tagRow.tagId !== null
                        && typeof createdTag.id === 'number'
                        && Number.isInteger(createdTag.id)
                        && createdTag.id > 0
                    ) {
                        importedTagIdToResolvedTagId.set(tagRow.tagId, createdTag.id);
                    }
                    tagsApplied += 1;
                } catch {
                    failedRows += 1;
                }
            }

            const tagMap = await this.buildTagNameToIdMap();

            for (const gameRow of gameRows) {
                const platformIgdbIdRaw = gameRow.catalog.platformIgdbId;

                if (typeof platformIgdbIdRaw !== 'number' || !Number.isInteger(platformIgdbIdRaw) || platformIgdbIdRaw <= 0) {
                    failedRows += 1;
                    continue;
                }
                const platformIgdbId = platformIgdbIdRaw;

                try {
                    await this.gameShelfService.addGame(gameRow.catalog, gameRow.listType);
                    gamesApplied += 1;

                    if (gameRow.status !== null) {
                        await this.gameShelfService.setGameStatus(gameRow.catalog.igdbGameId, platformIgdbId, gameRow.status);
                        gameStatusesApplied += 1;
                    }

                    if (gameRow.rating !== null) {
                        await this.gameShelfService.setGameRating(gameRow.catalog.igdbGameId, platformIgdbId, gameRow.rating);
                        gameRatingsApplied += 1;
                    }

                    const tagIds = gameRow.tagNames
                        .map(tagName => tagMap.get(tagName.toLowerCase()))
                        .filter((tagId): tagId is number => typeof tagId === 'number' && Number.isInteger(tagId) && tagId > 0);
                    gameRow.tagIds.forEach(importedTagId => {
                        const resolvedTagId = importedTagIdToResolvedTagId.get(importedTagId);

                        if (typeof resolvedTagId === 'number' && Number.isInteger(resolvedTagId) && resolvedTagId > 0) {
                            tagIds.push(resolvedTagId);
                        }
                    });
                    const uniqueTagIds = [...new Set(tagIds)];

                    if (uniqueTagIds.length > 0) {
                        await this.gameShelfService.setGameTags(gameRow.catalog.igdbGameId, platformIgdbId, uniqueTagIds);
                        gameTagAssignmentsApplied += 1;
                    }
                } catch {
                    failedRows += 1;
                }
            }

            const [collectionViews, wishlistViews] = await Promise.all([
                this.repository.listViews('collection'),
                this.repository.listViews('wishlist'),
            ]);
            const usedViewNames = new Set(
                [...collectionViews, ...wishlistViews]
                    .map(view => view.name.trim().toLowerCase())
                    .filter(name => name.length > 0),
            );

            for (const viewRow of viewRows) {
                try {
                    const resolvedName = this.resolveUniqueName(viewRow.name, usedViewNames);
                    if (resolvedName !== viewRow.name) {
                        viewsRenamed += 1;
                    }
                    await this.gameShelfService.createView(resolvedName, viewRow.listType, viewRow.filters, viewRow.groupBy);
                    viewsApplied += 1;
                } catch {
                    failedRows += 1;
                }
            }

            const totalImported = settingsApplied + tagsApplied + gamesApplied + viewsApplied;
            const totalRows = parsedRows.length;
            const skippedRows = Math.max(totalRows - totalImported - failedRows, 0);

            this.importPreviewRows = [];
            this.isImportPreviewOpen = false;
            await this.presentToast('CSV import completed.');
            await this.presentImportSummary({
                totalRows,
                settingsApplied,
                tagsApplied,
                gamesApplied,
                gameStatusesApplied,
                gameRatingsApplied,
                gameTagAssignmentsApplied,
                viewsApplied,
                tagsRenamed,
                viewsRenamed,
                failedRows,
                skippedRows,
            });
        } catch {
            await this.presentToast('Unable to apply CSV import.', 'danger');
        } finally {
            this.isApplyingImport = false;
        }
    }

    private async presentImportSummary(summary: {
        totalRows: number;
        settingsApplied: number;
        tagsApplied: number;
        gamesApplied: number;
        gameStatusesApplied: number;
        gameRatingsApplied: number;
        gameTagAssignmentsApplied: number;
        viewsApplied: number;
        tagsRenamed: number;
        viewsRenamed: number;
        failedRows: number;
        skippedRows: number;
    }): Promise<void> {
        this.presentSummaryModal('Import Summary', [
            `Total rows: ${summary.totalRows}`,
            `Games imported: ${summary.gamesApplied}`,
            `Tags imported: ${summary.tagsApplied}`,
            `Views imported: ${summary.viewsApplied}`,
            `Settings imported: ${summary.settingsApplied}`,
            `Game statuses set: ${summary.gameStatusesApplied}`,
            `Game ratings set: ${summary.gameRatingsApplied}`,
            `Game tag assignments: ${summary.gameTagAssignmentsApplied}`,
            `Tags auto-renamed: ${summary.tagsRenamed}`,
            `Views auto-renamed: ${summary.viewsRenamed}`,
            `Failed rows: ${summary.failedRows}`,
            `Skipped rows: ${summary.skippedRows}`,
        ]);
    }

    private presentSummaryModal(title: string, lines: string[]): void {
        this.summaryModalTitle = title;
        this.summaryModalLines = lines;
        this.isSummaryModalOpen = true;
    }

    private get activeMgcResolverRow(): MgcImportRow | undefined {
        if (typeof this.mgcResolverRowId !== 'number') {
            return undefined;
        }

        return this.mgcRows.find(row => row.id === this.mgcResolverRowId);
    }

    private isMgcRowReady(row: MgcImportRow): boolean {
        return row.error === null
            && row.duplicateError === null
            && (row.status === 'resolved' || (row.status === 'multiple' && row.selected !== null))
            && row.selected !== null;
    }

    private isMgcRowError(row: MgcImportRow): boolean {
        return row.error !== null
            || row.duplicateError !== null
            || row.status === 'noMatch'
            || row.status === 'error';
    }

    private isMgcRowWarning(row: MgcImportRow): boolean {
        return !this.isMgcRowError(row) && row.status === 'multiple' && row.selected === null;
    }

    private isMgcRowSuccess(row: MgcImportRow): boolean {
        return !this.isMgcRowError(row) && !this.isMgcRowWarning(row) && (row.status === 'resolved' || this.isMgcAutoSelectedMultiple(row));
    }

    private async parseMgcCsv(csv: string): Promise<MgcImportRow[]> {
        const table = this.parseCsvTable(csv);

        if (table.length < 2) {
            throw new Error('CSV must include header and at least one data row.');
        }

        const headers = table[0].map(cell => cell.trim());
        const headerIndexByName = new Map<string, number>();
        headers.forEach((header, index) => {
            headerIndexByName.set(header.toLowerCase(), index);
        });

        const nameIndex = headerIndexByName.get('name');
        const platformIndex = headerIndexByName.get('platform');
        const labelsIndex = headerIndexByName.get('labels');

        if (nameIndex === undefined || platformIndex === undefined) {
            throw new Error('MGC CSV must include "name" and "platform" columns.');
        }

        await this.ensureMgcPlatformLookup();

        const rows: MgcImportRow[] = [];

        for (let index = 1; index < table.length; index += 1) {
            const values = table[index];

            if (values.every(value => value.trim().length === 0)) {
                continue;
            }

            const rowNumber = index + 1;
            const name = String(values[nameIndex] ?? '').trim();
            const platformInput = String(values[platformIndex] ?? '').trim();
            const labelsRaw = labelsIndex !== undefined ? String(values[labelsIndex] ?? '') : '';
            const labels = this.parseMgcLabels(labelsRaw);

            let error: string | null = null;
            let warning: string | null = null;

            if (name.length === 0) {
                error = 'Missing required "name" value.';
            } else if (platformInput.length === 0) {
                error = 'Missing required "platform" value.';
            }

            const platformMatch = platformInput.length > 0
                ? this.resolveMgcPlatform(platformInput)
                : null;
            const platformIgdbId = platformMatch?.id ?? null;
            const platform = platformMatch?.name ?? platformInput;

            if (!error && platformInput.length > 0 && platformMatch === null) {
                warning = this.mgcSearchPlatforms.length > 0
                    ? 'Platform is not a recognized IGDB platform name. Search will run without platform filtering.'
                    : 'Platform validation is unavailable. Search will run without platform filtering.';
            }

            rows.push({
                id: rowNumber,
                rowNumber,
                name,
                platformInput,
                platform,
                platformIgdbId,
                labelsRaw,
                labels,
                status: error ? 'error' : 'pending',
                statusDetail: error ? error : 'Pending match.',
                warning,
                error,
                duplicateError: null,
                candidates: [],
                selected: null,
            });
        }

        const existingGames = await this.repository.listAll();
        this.mgcExistingGameKeys = new Set(
            existingGames.map(game => this.getGameKey(game.igdbGameId, game.platformIgdbId))
        );

        return rows;
    }

    private async applyMgcImport(): Promise<void> {
        if (!this.canApplyMgcImport || this.mgcTargetListType === null) {
            return;
        }

        this.isApplyingMgcImport = true;
        this.isImportLoadingOpen = true;
        this.importLoadingMessage = 'Preparing import...';

        try {
            this.recomputeMgcDuplicateErrors();

            if (this.mgcBlockedCount > 0) {
                await this.presentToast('Resolve or remove blocked rows before importing.', 'warning');
                return;
            }

            const rowsToImport = this.mgcRows.filter(row => this.isMgcRowReady(row));
            this.importLoadingMessage = 'Preparing tags...';
            const { tagIdMap, tagsCreated } = await this.prepareMgcTags(rowsToImport);
            let gamesImported = 0;
            let tagsAssigned = 0;
            let boxArtResolved = 0;
            let duplicateSkipped = 0;
            let failed = 0;
            let lastBoxArtRequestStartedAt = 0;

            for (let index = 0; index < rowsToImport.length; index += 1) {
                const row = rowsToImport[index];
                const selected = row.selected;
                this.importLoadingMessage = `Importing games ${index + 1}/${rowsToImport.length}...`;

                if (!selected || typeof selected.platformIgdbId !== 'number' || selected.platformIgdbId <= 0) {
                    failed += 1;
                    continue;
                }

                const key = this.getGameKey(selected.igdbGameId, selected.platformIgdbId);
                const existing = await this.gameShelfService.findGameByIdentity(selected.igdbGameId, selected.platformIgdbId);

                if (existing) {
                    duplicateSkipped += 1;
                    continue;
                }

                let resolvedCatalog: GameCatalogResult = selected;

                const nowMs = Date.now();
                const waitMs = Math.max(
                    SettingsPage.MGC_BOX_ART_MIN_INTERVAL_MS - (nowMs - lastBoxArtRequestStartedAt),
                    this.resolveGlobalCooldownWaitMs(nowMs),
                    0,
                );

                if (waitMs > 0) {
                    await this.waitWithLoadingCountdown(waitMs, 'Waiting to continue additional metadata lookups');
                }

                lastBoxArtRequestStartedAt = Date.now();
                this.importLoadingMessage = `Resolving additional metadata ${index + 1}/${rowsToImport.length}...`;
                const boxArt = await this.resolveBoxArtWithRetry(selected, index + 1, rowsToImport.length);
                const useIgdbCover = this.gameShelfService.shouldUseIgdbCoverForPlatform(selected.platform, selected.platformIgdbId);

                if (boxArt) {
                    resolvedCatalog = {
                        ...selected,
                        coverUrl: boxArt,
                        coverSource: useIgdbCover ? 'igdb' : 'thegamesdb',
                    };
                    boxArtResolved += 1;
                }

                try {
                    await this.gameShelfService.addGame(resolvedCatalog, this.mgcTargetListType);
                    gamesImported += 1;
                    this.mgcExistingGameKeys.add(key);

                    const tagIds = row.labels
                        .map(label => tagIdMap.get(label.toLowerCase()))
                        .filter((tagId): tagId is number => typeof tagId === 'number' && Number.isInteger(tagId) && tagId > 0);

                    if (tagIds.length > 0) {
                        await this.gameShelfService.setGameTags(selected.igdbGameId, selected.platformIgdbId, tagIds);
                        tagsAssigned += 1;
                    }
                } catch {
                    failed += 1;
                }
            }

            await this.presentToast('MGC import completed.');
            await this.presentMgcImportSummary({
                rowsSelected: rowsToImport.length,
                gamesImported,
                tagsAssigned,
                tagsCreated,
                boxArtResolved,
                duplicateSkipped,
                failed,
            });
            this.closeMgcImport();
        } catch {
            await this.presentToast('Unable to complete MGC import.', 'danger');
        } finally {
            this.isApplyingMgcImport = false;
            this.isImportLoadingOpen = false;
            this.importLoadingMessage = '';
        }
    }

    private async presentMgcImportSummary(summary: {
        rowsSelected: number;
        gamesImported: number;
        tagsAssigned: number;
        tagsCreated: number;
        boxArtResolved: number;
        duplicateSkipped: number;
        failed: number;
    }): Promise<void> {
        this.presentSummaryModal('MGC Import Summary', [
            `Rows selected: ${summary.rowsSelected}`,
            `Games imported: ${summary.gamesImported}`,
            `Games with tags applied: ${summary.tagsAssigned}`,
            `New tags created: ${summary.tagsCreated}`,
            `2D box art resolved: ${summary.boxArtResolved}`,
            `Duplicates skipped: ${summary.duplicateSkipped}`,
            `Failed: ${summary.failed}`,
        ]);
    }

    private async prepareMgcTags(rows: MgcImportRow[]): Promise<{ tagIdMap: Map<string, number>; tagsCreated: number }> {
        const requiredTagNames = new Set<string>();

        rows.forEach(row => {
            row.labels.forEach(label => {
                const normalized = label.trim();

                if (normalized.length > 0) {
                    requiredTagNames.add(normalized);
                }
            });
        });

        if (requiredTagNames.size === 0) {
            return {
                tagIdMap: await this.buildTagNameToIdMap(),
                tagsCreated: 0,
            };
        }

        const existingTags = await this.repository.listTags();
        const existingTagNames = new Set(
            existingTags
                .map(tag => tag.name.toLowerCase())
                .filter(name => name.length > 0)
        );

        let tagsCreated = 0;

        for (const tagName of requiredTagNames) {
            const key = tagName.toLowerCase();

            if (existingTagNames.has(key)) {
                continue;
            }

            await this.gameShelfService.createTag(tagName, '#3880ff');
            existingTagNames.add(key);
            tagsCreated += 1;
        }

        return {
            tagIdMap: await this.buildTagNameToIdMap(),
            tagsCreated,
        };
    }

    private async ensureMgcPlatformLookup(): Promise<void> {
        if (this.mgcPlatformLookupLoaded && this.mgcPlatformLookup.size > 0) {
            return;
        }

        const previousPlatforms = this.mgcSearchPlatforms;

        try {
            this.mgcSearchPlatforms = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
        } catch {
            this.mgcSearchPlatforms = previousPlatforms;
        }

        if (this.mgcSearchPlatforms.length === 0) {
            this.mgcPlatformLookupLoaded = false;
            return;
        }

        this.mgcPlatformLookup.clear();

        this.mgcSearchPlatforms.forEach(platform => {
            const normalizedName = this.normalizeLookupKey(platform.name);

            if (!this.mgcPlatformLookup.has(normalizedName)) {
                this.mgcPlatformLookup.set(normalizedName, platform);
            }
        });

        this.mgcPlatformLookupLoaded = this.mgcPlatformLookup.size > 0;
    }

    private resolveMgcPlatform(platformName: string): GameCatalogPlatformOption | null {
        const normalized = this.normalizeLookupKey(platformName);
        return this.mgcPlatformLookup.get(normalized) ?? null;
    }

    private parseMgcLabels(raw: string): string[] {
        if (raw.trim().length === 0) {
            return [];
        }

        return [...new Set(
            raw
                .split(',')
                .map(value => value.trim())
                .filter(value => value.length > 0)
        )];
    }

    private normalizeLookupKey(value: string): string {
        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    private normalizeMgcTitleForMatch(value: string): string {
        return String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    private async resolveMgcRowFromSearchWithRetry(row: MgcImportRow): Promise<void> {
        let attempt = 1;

        while (attempt <= SettingsPage.MGC_RESOLVE_MAX_ATTEMPTS) {
            await this.resolveMgcRowFromSearch(row);

            if (row.status !== 'error') {
                return;
            }

            const isRateLimited = this.isRateLimitStatusDetail(row.statusDetail);

            if (!isRateLimited || attempt >= SettingsPage.MGC_RESOLVE_MAX_ATTEMPTS) {
                return;
            }

            const retryDelay = this.resolveRateLimitRetryDelayMs(row.statusDetail);
            this.mgcRateLimitCooldownUntilMs = Date.now() + retryDelay;
            await this.waitWithRetryCountdown(row, retryDelay);
            attempt += 1;
        }
    }

    private async resolveMgcRowFromSearch(row: MgcImportRow): Promise<void> {
        if (row.error) {
            return;
        }

        row.status = 'searching';
        row.statusDetail = 'Searching...';
        row.candidates = [];
        row.selected = null;
        row.duplicateError = null;

        try {
            const results = await firstValueFrom(this.gameShelfService.searchGames(row.name, row.platformIgdbId));
            const deduped = new Map<string, GameCatalogResult>();

            for (const result of results) {
                const resolved = await this.resolveCatalogForRow(row, result, false);

                if (!resolved || typeof resolved.platformIgdbId !== 'number' || resolved.platformIgdbId <= 0) {
                    continue;
                }

                const key = this.getGameKey(resolved.igdbGameId, resolved.platformIgdbId);

                if (!deduped.has(key)) {
                    deduped.set(key, resolved);
                }
            }

            const candidates = [...deduped.values()];
            row.candidates = candidates;

            if (candidates.length === 1) {
                row.selected = candidates[0];
                row.status = 'resolved';
                row.statusDetail = 'Matched automatically.';
                return;
            }

            if (candidates.length > 1) {
                const exactTitleMatch = candidates.find(candidate => {
                    return this.normalizeMgcTitleForMatch(candidate.title) === this.normalizeMgcTitleForMatch(row.name);
                }) ?? null;

                row.selected = exactTitleMatch;
                row.status = 'multiple';
                row.statusDetail = exactTitleMatch
                    ? `${candidates.length} possible matches found. Exact title match auto-selected.`
                    : `${candidates.length} possible matches found.`;
                return;
            }

            row.selected = null;
            row.status = 'noMatch';
            row.statusDetail = 'No matches found.';
        } catch (error: unknown) {
            row.selected = null;
            row.status = 'error';
            const message = error instanceof Error ? error.message : '';
            row.statusDetail = message.toLowerCase().includes('rate limit')
                ? message
                : 'Search failed.';
        }
    }

    private isRateLimitStatusDetail(detail: string): boolean {
        return detail.toLowerCase().includes('rate limit');
    }

    private resolveRateLimitRetryDelayMs(statusDetail: string): number {
        const retryAfterMatch = statusDetail.match(/retry after\s+(\d+)\s*s/i);

        if (retryAfterMatch) {
            const seconds = Number.parseInt(retryAfterMatch[1], 10);

            if (Number.isInteger(seconds) && seconds > 0) {
                return Math.min(seconds * 1000, SettingsPage.MGC_RATE_LIMIT_MAX_COOLDOWN_MS);
            }
        }

        return SettingsPage.MGC_RATE_LIMIT_FALLBACK_COOLDOWN_MS;
    }

    private resolveGlobalCooldownWaitMs(nowMs: number): number {
        return Math.max(this.mgcRateLimitCooldownUntilMs - nowMs, 0);
    }

    private async resolveBoxArtWithRetry(
        selected: GameCatalogResult,
        rowIndex: number,
        totalRows: number,
    ): Promise<string | null> {
        let attempt = 1;

        while (attempt <= SettingsPage.MGC_BOX_ART_MAX_ATTEMPTS) {
            try {
                const boxArtCandidates = await firstValueFrom(
                    this.gameShelfService.searchBoxArtByTitle(selected.title, selected.platform, selected.platformIgdbId, selected.igdbGameId)
                );
                return boxArtCandidates[0] ?? null;
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : '';
                const isRateLimited = this.isRateLimitStatusDetail(message);

                if (!isRateLimited || attempt >= SettingsPage.MGC_BOX_ART_MAX_ATTEMPTS) {
                    return null;
                }

                const retryDelay = this.resolveRateLimitRetryDelayMs(message);
                this.mgcRateLimitCooldownUntilMs = Date.now() + retryDelay;
                await this.waitWithLoadingCountdown(
                    retryDelay,
                    `Box art rate limited for row ${rowIndex}/${totalRows}. Retrying`,
                );
                attempt += 1;
            }
        }

        return null;
    }

    private async resolveCatalogForRow(
        row: MgcImportRow,
        result: GameCatalogResult,
        allowPlatformPrompt: boolean,
    ): Promise<GameCatalogResult | null> {
        const withoutPrompt = this.resolveCatalogForRowWithoutPrompt(row, result);

        if (withoutPrompt) {
            return withoutPrompt;
        }

        if (!allowPlatformPrompt) {
            return null;
        }

        if (row.platformIgdbId !== null) {
            return null;
        }

        const options = this.getCatalogPlatformOptions(result);

        if (options.length === 0) {
            return null;
        }

        if (options.length === 1) {
            return this.withSelectedPlatform(result, options[0]);
        }

        const alert = await this.alertController.create({
            header: 'Choose Platform',
            message: `Select a platform for "${result.title}".`,
            inputs: options.map((option, index) => ({
                type: 'radio',
                label: option.name,
                value: String(index),
                checked: index === 0,
            })),
            buttons: [
                {
                    text: 'Cancel',
                    role: 'cancel',
                },
                {
                    text: 'Select',
                    role: 'confirm',
                },
            ],
        });

        await alert.present();
        const { role, data } = await alert.onDidDismiss();

        if (role !== 'confirm') {
            return null;
        }

        const index = Number.parseInt(String(data ?? ''), 10);

        if (!Number.isInteger(index) || index < 0 || index >= options.length) {
            return null;
        }

        return this.withSelectedPlatform(result, options[index]);
    }

    private resolveCatalogForRowWithoutPrompt(row: MgcImportRow, result: GameCatalogResult): GameCatalogResult | null {
        const options = this.getCatalogPlatformOptions(result);

        if (row.platformIgdbId !== null) {
            const platformById = options.find(option => option.id === row.platformIgdbId);

            if (platformById) {
                return this.withSelectedPlatform(result, platformById);
            }

            if (
                typeof result.platformIgdbId === 'number'
                && result.platformIgdbId > 0
                && result.platformIgdbId === row.platformIgdbId
                && typeof result.platform === 'string'
                && result.platform.trim().length > 0
            ) {
                return this.withSelectedPlatform(result, {
                    id: result.platformIgdbId,
                    name: result.platform.trim(),
                });
            }

            return null;
        }

        if (
            typeof result.platformIgdbId === 'number'
            && result.platformIgdbId > 0
            && typeof result.platform === 'string'
            && result.platform.trim().length > 0
        ) {
            return this.withSelectedPlatform(result, {
                id: result.platformIgdbId,
                name: result.platform.trim(),
            });
        }

        if (options.length === 1) {
            return this.withSelectedPlatform(result, options[0]);
        }

        return null;
    }

    private withSelectedPlatform(result: GameCatalogResult, platform: { id: number; name: string }): GameCatalogResult {
        return {
            ...result,
            platform: platform.name,
            platformIgdbId: platform.id,
            platforms: [platform.name],
            platformOptions: [{ id: platform.id, name: platform.name }],
        };
    }

    private getCatalogPlatformOptions(result: GameCatalogResult): Array<{ id: number; name: string }> {
        if (Array.isArray(result.platformOptions) && result.platformOptions.length > 0) {
            return result.platformOptions
                .map(option => {
                    const id = typeof option?.id === 'number' && Number.isInteger(option.id) && option.id > 0 ? option.id : null;
                    const name = typeof option?.name === 'string' ? option.name.trim() : '';
                    return { id, name };
                })
                .filter((option): option is { id: number; name: string } => option.id !== null && option.name.length > 0)
                .filter((option, index, all) => {
                    return all.findIndex(candidate => candidate.id === option.id && candidate.name === option.name) === index;
                })
                .sort((left, right) => this.platformOrderService.comparePlatformNames(left.name, right.name));
        }

        if (
            typeof result.platformIgdbId === 'number'
            && result.platformIgdbId > 0
            && typeof result.platform === 'string'
            && result.platform.trim().length > 0
        ) {
            return [{ id: result.platformIgdbId, name: result.platform.trim() }];
        }

        return [];
    }

    private recomputeMgcDuplicateErrors(): void {
        this.mgcRows.forEach(row => {
            row.duplicateError = null;
        });

        const groups = new Map<string, MgcImportRow[]>();

        for (const row of this.mgcRows) {
            const key = this.getMgcRowGameKey(row);

            if (!key) {
                continue;
            }

            if (this.mgcExistingGameKeys.has(key)) {
                row.duplicateError = 'Duplicate game already exists in your library.';
            }

            if (!groups.has(key)) {
                groups.set(key, []);
            }

            groups.get(key)?.push(row);
        }

        groups.forEach(rows => {
            if (rows.length < 2) {
                return;
            }

            rows.forEach(row => {
                row.duplicateError = 'Duplicate game also appears in this MGC import.';
            });
        });
    }

    private getMgcRowGameKey(row: MgcImportRow): string | null {
        if (!row.selected || row.status !== 'resolved') {
            return null;
        }

        const platformIgdbId = row.selected.platformIgdbId;
        const igdbGameId = String(row.selected.igdbGameId ?? '').trim();

        if (!/^\d+$/.test(igdbGameId) || typeof platformIgdbId !== 'number' || !Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
            return null;
        }

        return this.getGameKey(igdbGameId, platformIgdbId);
    }

    private getGameKey(igdbGameId: string, platformIgdbId: number): string {
        return `${igdbGameId}::${platformIgdbId}`;
    }

    private async processWithConcurrency<T>(
        items: T[],
        concurrency: number,
        handler: (item: T) => Promise<void>,
    ): Promise<void> {
        const queue = [...items];
        const workers: Promise<void>[] = [];
        const workerCount = Math.max(1, Math.min(concurrency, queue.length));

        for (let index = 0; index < workerCount; index += 1) {
            workers.push((async () => {
                while (queue.length > 0) {
                    const item = queue.shift();

                    if (!item) {
                        return;
                    }

                    await handler(item);
                }
            })());
        }

        await Promise.all(workers);
    }

    private async delay(ms: number): Promise<void> {
        await new Promise<void>(resolve => {
            window.setTimeout(resolve, ms);
        });
    }

    private async waitWithRetryCountdown(row: MgcImportRow, totalMs: number): Promise<void> {
        let remainingMs = totalMs;

        while (remainingMs > 0) {
            const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
            row.statusDetail = `Rate limited. Retrying in ${secondsLeft}s...`;
            const stepMs = Math.min(1000, remainingMs);
            await this.delay(stepMs);
            remainingMs -= stepMs;
        }
    }

    private async waitWithLoadingCountdown(totalMs: number, prefix: string): Promise<void> {
        let remainingMs = totalMs;

        while (remainingMs > 0) {
            const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
            this.importLoadingMessage = `${prefix} in ${secondsLeft}s...`;
            const stepMs = Math.min(1000, remainingMs);
            await this.delay(stepMs);
            remainingMs -= stepMs;
        }
    }

    private async buildExportCsv(): Promise<string> {
        const [games, tags, collectionViews, wishlistViews] = await Promise.all([
            this.repository.listAll(),
            this.repository.listTags(),
            this.repository.listViews('collection'),
            this.repository.listViews('wishlist'),
        ]);

        const tagById = new Map<number, Tag>();

        tags.forEach(tag => {
            if (typeof tag.id === 'number' && tag.id > 0) {
                tagById.set(tag.id, tag);
            }
        });

        const rows: ExportCsvRow[] = [];

        games.forEach(game => {
            const normalizedTagIds = this.normalizeTagIds(game.tagIds);
            const tagNames = this.normalizeTagIds(game.tagIds)
                .map(tagId => tagById.get(tagId)?.name)
                .filter((name): name is string => typeof name === 'string' && name.length > 0);

            rows.push({
                type: 'game',
                listType: game.listType,
                igdbGameId: game.igdbGameId,
                platformIgdbId: String(game.platformIgdbId),
                title: game.title,
                coverUrl: game.coverUrl ?? '',
                coverSource: game.coverSource,
                platform: game.platform,
                releaseDate: game.releaseDate ?? '',
                releaseYear: game.releaseYear !== null && game.releaseYear !== undefined ? String(game.releaseYear) : '',
                hltbMainHours: game.hltbMainHours !== null && game.hltbMainHours !== undefined ? String(game.hltbMainHours) : '',
                hltbMainExtraHours: game.hltbMainExtraHours !== null && game.hltbMainExtraHours !== undefined ? String(game.hltbMainExtraHours) : '',
                hltbCompletionistHours: game.hltbCompletionistHours !== null && game.hltbCompletionistHours !== undefined ? String(game.hltbCompletionistHours) : '',
                status: game.status ?? '',
                rating: game.rating !== null && game.rating !== undefined ? String(game.rating) : '',
                developers: JSON.stringify(game.developers ?? []),
                franchises: JSON.stringify(game.franchises ?? []),
                genres: JSON.stringify(game.genres ?? []),
                publishers: JSON.stringify(game.publishers ?? []),
                tags: JSON.stringify(tagNames),
                gameTagIds: JSON.stringify(normalizedTagIds),
                tagId: '',
                name: '',
                color: '',
                groupBy: '',
                filters: '',
                key: '',
                value: '',
                createdAt: game.createdAt,
                updatedAt: game.updatedAt,
            });
        });

        tags.forEach(tag => {
            rows.push({
                type: 'tag',
                listType: '',
                igdbGameId: '',
                platformIgdbId: '',
                title: '',
                coverUrl: '',
                coverSource: '',
                platform: '',
                releaseDate: '',
                releaseYear: '',
                hltbMainHours: '',
                hltbMainExtraHours: '',
                hltbCompletionistHours: '',
                status: '',
                rating: '',
                developers: '',
                franchises: '',
                genres: '',
                publishers: '',
                tags: '',
                gameTagIds: '',
                tagId: typeof tag.id === 'number' && tag.id > 0 ? String(tag.id) : '',
                name: tag.name,
                color: tag.color,
                groupBy: '',
                filters: '',
                key: '',
                value: '',
                createdAt: tag.createdAt,
                updatedAt: tag.updatedAt,
            });
        });

        [...collectionViews, ...wishlistViews].forEach(view => {
            rows.push({
                type: 'view',
                listType: view.listType,
                igdbGameId: '',
                platformIgdbId: '',
                title: '',
                coverUrl: '',
                coverSource: '',
                platform: '',
                releaseDate: '',
                releaseYear: '',
                hltbMainHours: '',
                hltbMainExtraHours: '',
                hltbCompletionistHours: '',
                status: '',
                rating: '',
                developers: '',
                franchises: '',
                genres: '',
                publishers: '',
                tags: '',
                gameTagIds: '',
                tagId: '',
                name: view.name,
                color: '',
                groupBy: view.groupBy,
                filters: JSON.stringify(view.filters),
                key: '',
                value: '',
                createdAt: view.createdAt,
                updatedAt: view.updatedAt,
            });
        });

        this.readExportableSettings().forEach(([key, value]) => {
            rows.push({
                type: 'setting',
                listType: '',
                igdbGameId: '',
                platformIgdbId: '',
                title: '',
                coverUrl: '',
                coverSource: '',
                platform: '',
                releaseDate: '',
                releaseYear: '',
                hltbMainHours: '',
                hltbMainExtraHours: '',
                hltbCompletionistHours: '',
                status: '',
                rating: '',
                developers: '',
                franchises: '',
                genres: '',
                publishers: '',
                tags: '',
                gameTagIds: '',
                tagId: '',
                name: '',
                color: '',
                groupBy: '',
                filters: '',
                key,
                value,
                createdAt: '',
                updatedAt: '',
            });
        });

        const lines = [
            CSV_HEADERS.join(','),
            ...rows.map(row => CSV_HEADERS.map(header => this.escapeCsvValue(row[header])).join(',')),
        ];

        return lines.join('\n');
    }

    private async parseImportCsv(csv: string): Promise<ImportPreviewRow[]> {
        const table = this.parseCsvTable(csv);

        if (table.length < 2) {
            throw new Error('CSV must include header and at least one data row.');
        }

        const headers = table[0].map(cell => cell.trim());
        REQUIRED_CSV_HEADERS.forEach(header => {
            if (!headers.includes(header)) {
                throw new Error(`Missing CSV column: ${header}`);
            }
        });

        const gamesInDb = await this.repository.listAll();
        const existingKeys = new Set(gamesInDb.map(game => `${game.igdbGameId}::${game.platformIgdbId}`));
        const pendingKeys = new Set<string>();
        const existingTags = await this.repository.listTags();
        const existingTagNames = new Set(
            existingTags.map(tag => tag.name.trim().toLowerCase()).filter(name => name.length > 0),
        );
        const pendingTagNames = new Set<string>();
        const [collectionViews, wishlistViews] = await Promise.all([
            this.repository.listViews('collection'),
            this.repository.listViews('wishlist'),
        ]);
        const existingViewNames = new Set(
            [...collectionViews, ...wishlistViews]
                .map(view => view.name.trim().toLowerCase())
                .filter(name => name.length > 0),
        );
        const pendingViewNames = new Set<string>();
        const rows: ImportPreviewRow[] = [];

        for (let index = 1; index < table.length; index += 1) {
            const values = table[index];

            if (values.every(value => value.trim().length === 0)) {
                continue;
            }

            const record = this.mapCsvRecord(headers, values);
            const rowNumber = index + 1;
            const preview = this.validateImportRecord(
                record,
                rowNumber,
                existingKeys,
                pendingKeys,
                existingTagNames,
                pendingTagNames,
                existingViewNames,
                pendingViewNames,
            );
            rows.push(preview);
        }

        return rows;
    }

    private validateImportRecord(
        record: ExportCsvRow,
        rowNumber: number,
        existingKeys: Set<string>,
        pendingKeys: Set<string>,
        existingTagNames: Set<string>,
        pendingTagNames: Set<string>,
        existingViewNames: Set<string>,
        pendingViewNames: Set<string>,
    ): ImportPreviewRow {
        const type = record.type;

        if (type !== 'game' && type !== 'tag' && type !== 'view' && type !== 'setting') {
            return {
                id: rowNumber,
                rowNumber,
                type: 'unknown',
                summary: `Row ${rowNumber}`,
                error: 'Unknown row type.',
                warning: null,
                parsed: null,
            };
        }

        if (type === 'setting') {
            if (record.key.trim().length === 0) {
                return this.errorRow(type, rowNumber, 'Setting key is required.');
            }

            return {
                id: rowNumber,
                rowNumber,
                type,
                summary: `Setting: ${record.key}`,
                error: null,
                warning: null,
                parsed: {
                    kind: 'setting',
                    key: record.key,
                    value: record.value,
                },
            };
        }

        if (type === 'tag') {
            const name = record.name.trim();
            const color = this.normalizeColor(record.color);
            const tagId = this.parsePositiveInteger(record.tagId);

            if (name.length === 0) {
                return this.errorRow(type, rowNumber, 'Tag name is required.');
            }
            const warning = this.buildDuplicateNameWarning(name, existingTagNames, pendingTagNames, 'tag');

            return {
                id: rowNumber,
                rowNumber,
                type,
                summary: `Tag: ${name}`,
                error: null,
                warning,
                parsed: {
                    kind: 'tag',
                    tagId,
                    name,
                    color,
                },
            };
        }

        if (type === 'view') {
            const listType = this.normalizeListType(record.listType);
            const groupBy = this.normalizeGroupBy(record.groupBy);
            const name = record.name.trim();

            if (name.length === 0) {
                return this.errorRow(type, rowNumber, 'View name is required.');
            }

            if (!listType) {
                return this.errorRow(type, rowNumber, 'View list type must be collection or wishlist.');
            }

            if (!groupBy) {
                return this.errorRow(type, rowNumber, 'Invalid groupBy value.');
            }

            const filters = this.parseFilters(record.filters);

            if (!filters) {
                return this.errorRow(type, rowNumber, 'Invalid filters payload for view.');
            }
            const warning = this.buildDuplicateNameWarning(name, existingViewNames, pendingViewNames, 'view');

            return {
                id: rowNumber,
                rowNumber,
                type,
                summary: `View: ${name} (${listType})`,
                error: null,
                warning,
                parsed: {
                    kind: 'view',
                    name,
                    listType,
                    groupBy,
                    filters,
                },
            };
        }

        const listType = this.normalizeListType(record.listType);

        if (!listType) {
            return this.errorRow(type, rowNumber, 'Game list type must be collection or wishlist.');
        }

        const igdbGameId = record.igdbGameId.trim();

        if (!/^\d+$/.test(igdbGameId)) {
            return this.errorRow(type, rowNumber, 'Game IGDB id is required and must be numeric.');
        }

        const platformIgdbId = Number.parseInt(record.platformIgdbId, 10);

        if (!Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
            return this.errorRow(type, rowNumber, 'Game platform IGDB id is required and must be positive.');
        }

        const key = `${igdbGameId}::${platformIgdbId}`;

        if (existingKeys.has(key)) {
            return this.errorRow(type, rowNumber, 'Duplicate game already exists in your library. Remove this row.');
        }

        if (pendingKeys.has(key)) {
            return this.errorRow(type, rowNumber, 'Duplicate game also exists in this import file. Remove one row.');
        }

        pendingKeys.add(key);

        const platform = record.platform.trim();

        if (platform.length === 0) {
            return this.errorRow(type, rowNumber, 'Platform is required for imported games.');
        }

        const status = this.normalizeStatus(record.status);

        if (record.status.trim().length > 0 && status === null) {
            return this.errorRow(type, rowNumber, 'Invalid status value.');
        }

        const rating = this.normalizeRating(record.rating);

        if (record.rating.trim().length > 0 && rating === null) {
            return this.errorRow(type, rowNumber, 'Rating must be none or an integer between 1 and 5.');
        }

        const catalog: GameCatalogResult = {
            igdbGameId,
            title: record.title.trim() || 'Unknown title',
            coverUrl: record.coverUrl.trim() || null,
            coverSource: this.normalizeCoverSource(record.coverSource),
            hltbMainHours: this.parseOptionalDecimal(record.hltbMainHours),
            hltbMainExtraHours: this.parseOptionalDecimal(record.hltbMainExtraHours),
            hltbCompletionistHours: this.parseOptionalDecimal(record.hltbCompletionistHours),
            developers: this.parseStringArray(record.developers),
            franchises: this.parseStringArray(record.franchises),
            genres: this.parseStringArray(record.genres),
            publishers: this.parseStringArray(record.publishers),
            platforms: [platform],
            platformOptions: [{ id: platformIgdbId, name: platform }],
            platform,
            platformIgdbId,
            releaseDate: record.releaseDate.trim().length > 0 ? record.releaseDate.trim() : null,
            releaseYear: this.parseOptionalNumber(record.releaseYear),
        };

        const tagNames = this.parseStringArray(record.tags);
        const tagIds = this.parsePositiveIntegerArray(record.gameTagIds);

        return {
            id: rowNumber,
            rowNumber,
            type,
            summary: `Game: ${catalog.title} (${platform})`,
            error: null,
            warning: null,
            parsed: {
                kind: 'game',
                listType,
                catalog,
                status,
                rating,
                tagNames,
                tagIds,
            },
        };
    }

    private errorRow(type: ExportRowType, rowNumber: number, error: string): ImportPreviewRow {
        return {
            id: rowNumber,
            rowNumber,
            type,
            summary: `${type.toUpperCase()} row ${rowNumber}`,
            error,
            warning: null,
            parsed: null,
        };
    }

    private buildDuplicateNameWarning(
        name: string,
        existingNames: Set<string>,
        pendingNames: Set<string>,
        entityLabel: 'tag' | 'view',
    ): string | null {
        const trimmed = name.trim();
        const lower = trimmed.toLowerCase();

        if (trimmed.length === 0) {
            return null;
        }

        const usedNames = new Set<string>([...existingNames, ...pendingNames]);
        const resolved = this.resolveUniqueName(trimmed, usedNames);
        pendingNames.add(resolved.toLowerCase());

        if (resolved === trimmed) {
            return null;
        }

        return `Duplicate ${entityLabel} name found. This row will be imported as "${resolved}".`;
    }

    private parseCsvTable(csv: string): string[][] {
        const rows: string[][] = [];
        let row: string[] = [];
        let cell = '';
        let inQuotes = false;

        for (let i = 0; i < csv.length; i += 1) {
            const char = csv[i];
            const nextChar = csv[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (char === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && nextChar === '\n') {
                    i += 1;
                }

                row.push(cell);
                rows.push(row);
                row = [];
                cell = '';
                continue;
            }

            cell += char;
        }

        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }

        return rows;
    }

    private mapCsvRecord(headers: string[], values: string[]): ExportCsvRow {
        const getValue = (header: keyof ExportCsvRow) => {
            const index = headers.indexOf(header);
            return index >= 0 ? (values[index] ?? '') : '';
        };

        return {
            type: (getValue('type') as ExportRowType) ?? 'game',
            listType: getValue('listType'),
            igdbGameId: getValue('igdbGameId'),
            platformIgdbId: getValue('platformIgdbId'),
            title: getValue('title'),
            coverUrl: getValue('coverUrl'),
            coverSource: getValue('coverSource'),
            platform: getValue('platform'),
            releaseDate: getValue('releaseDate'),
            releaseYear: getValue('releaseYear'),
            hltbMainHours: getValue('hltbMainHours'),
            hltbMainExtraHours: getValue('hltbMainExtraHours'),
            hltbCompletionistHours: getValue('hltbCompletionistHours'),
            status: getValue('status'),
            rating: getValue('rating'),
            developers: getValue('developers'),
            franchises: getValue('franchises'),
            genres: getValue('genres'),
            publishers: getValue('publishers'),
            tags: getValue('tags'),
            gameTagIds: getValue('gameTagIds'),
            tagId: getValue('tagId'),
            name: getValue('name'),
            color: getValue('color'),
            groupBy: getValue('groupBy'),
            filters: getValue('filters'),
            key: getValue('key'),
            value: getValue('value'),
            createdAt: getValue('createdAt'),
            updatedAt: getValue('updatedAt'),
        };
    }

    private parseStringArray(raw: string): string[] {
        if (raw.trim().length === 0) {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return [...new Set(
                parsed
                    .map(value => (typeof value === 'string' ? value.trim() : ''))
                    .filter(value => value.length > 0)
            )];
        } catch {
            return [];
        }
    }

    private parseFilters(raw: string): GameListFilters | null {
        if (raw.trim().length === 0) {
            return { ...DEFAULT_GAME_LIST_FILTERS };
        }

        try {
            const parsed = JSON.parse(raw) as Partial<GameListFilters>;
            const parsedHltbMainHoursMin = typeof parsed.hltbMainHoursMin === 'number' && Number.isFinite(parsed.hltbMainHoursMin) && parsed.hltbMainHoursMin >= 0
                ? Math.round(parsed.hltbMainHoursMin * 10) / 10
                : null;
            const parsedHltbMainHoursMax = typeof parsed.hltbMainHoursMax === 'number' && Number.isFinite(parsed.hltbMainHoursMax) && parsed.hltbMainHoursMax >= 0
                ? Math.round(parsed.hltbMainHoursMax * 10) / 10
                : null;

            return {
                ...DEFAULT_GAME_LIST_FILTERS,
                ...parsed,
                platform: Array.isArray(parsed.platform) ? parsed.platform.filter(value => typeof value === 'string') : [],
                collections: Array.isArray(parsed.collections) ? parsed.collections.filter(value => typeof value === 'string') : [],
                developers: Array.isArray(parsed.developers) ? parsed.developers.filter(value => typeof value === 'string') : [],
                franchises: Array.isArray(parsed.franchises) ? parsed.franchises.filter(value => typeof value === 'string') : [],
                publishers: Array.isArray(parsed.publishers) ? parsed.publishers.filter(value => typeof value === 'string') : [],
                gameTypes: Array.isArray(parsed.gameTypes)
                    ? parsed.gameTypes.filter(value =>
                        value === 'main_game'
                        || value === 'dlc_addon'
                        || value === 'expansion'
                        || value === 'bundle'
                        || value === 'standalone_expansion'
                        || value === 'mod'
                        || value === 'episode'
                        || value === 'season'
                        || value === 'remake'
                        || value === 'remaster'
                        || value === 'expanded_game'
                        || value === 'port'
                        || value === 'fork'
                        || value === 'pack'
                        || value === 'update'
                    )
                    : [],
                genres: Array.isArray(parsed.genres) ? parsed.genres.filter(value => typeof value === 'string') : [],
                statuses: Array.isArray(parsed.statuses)
                    ? parsed.statuses.filter(value => value === 'none' || value === 'playing' || value === 'wantToPlay' || value === 'completed' || value === 'paused' || value === 'dropped' || value === 'replay')
                    : [],
                tags: Array.isArray(parsed.tags) ? parsed.tags.filter(value => typeof value === 'string') : [],
                ratings: Array.isArray(parsed.ratings)
                    ? parsed.ratings.filter(value => value === 'none' || value === 1 || value === 2 || value === 3 || value === 4 || value === 5)
                    : [],
                sortField: parsed.sortField === 'title' || parsed.sortField === 'releaseDate' || parsed.sortField === 'createdAt' || parsed.sortField === 'platform'
                    ? parsed.sortField
                    : DEFAULT_GAME_LIST_FILTERS.sortField,
                sortDirection: parsed.sortDirection === 'desc' ? 'desc' : 'asc',
                hltbMainHoursMin: parsedHltbMainHoursMin !== null && parsedHltbMainHoursMax !== null && parsedHltbMainHoursMin > parsedHltbMainHoursMax
                    ? parsedHltbMainHoursMax
                    : parsedHltbMainHoursMin,
                hltbMainHoursMax: parsedHltbMainHoursMin !== null && parsedHltbMainHoursMax !== null && parsedHltbMainHoursMin > parsedHltbMainHoursMax
                    ? parsedHltbMainHoursMin
                    : parsedHltbMainHoursMax,
                releaseDateFrom: typeof parsed.releaseDateFrom === 'string' ? parsed.releaseDateFrom : null,
                releaseDateTo: typeof parsed.releaseDateTo === 'string' ? parsed.releaseDateTo : null,
            };
        } catch {
            return null;
        }
    }

    private parseOptionalNumber(value: string): number | null {
        const normalized = value.trim();

        if (normalized.length === 0) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);
        return Number.isInteger(parsed) ? parsed : null;
    }

    private parseOptionalDecimal(value: string): number | null {
        const normalized = value.trim();

        if (normalized.length === 0) {
            return null;
        }

        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private parsePositiveInteger(value: string): number | null {
        const normalized = value.trim();

        if (normalized.length === 0) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    private parsePositiveIntegerArray(raw: string): number[] {
        if (raw.trim().length === 0) {
            return [];
        }

        try {
            const parsed = JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return [...new Set(
                parsed
                    .map(value => Number.parseInt(String(value), 10))
                    .filter(value => Number.isInteger(value) && value > 0)
            )];
        } catch {
            return [];
        }
    }

    private normalizeListType(value: string): ListType | null {
        return value === 'collection' || value === 'wishlist' ? value : null;
    }

    private normalizeGroupBy(value: string): GameGroupByField | null {
        if (
            value === 'none'
            || value === 'platform'
            || value === 'developer'
            || value === 'franchise'
            || value === 'collection'
            || value === 'tag'
            || value === 'genre'
            || value === 'publisher'
            || value === 'releaseYear'
        ) {
            return value;
        }

        return null;
    }

    private normalizeStatus(value: string): GameStatus | null {
        if (
            value === 'completed'
            || value === 'dropped'
            || value === 'playing'
            || value === 'paused'
            || value === 'replay'
            || value === 'wantToPlay'
        ) {
            return value;
        }

        return null;
    }

    private normalizeRating(value: string): GameRating | null {
        const normalized = value.trim();

        if (normalized.length === 0) {
            return null;
        }

        const parsed = Number.parseInt(normalized, 10);

        if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5) {
            return parsed;
        }

        return null;
    }

    private normalizeCoverSource(value: string): 'thegamesdb' | 'igdb' | 'none' {
        if (value === 'thegamesdb' || value === 'igdb' || value === 'none') {
            return value;
        }

        return 'none';
    }

    private normalizeColor(value: string): string {
        return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : '#3880ff';
    }

    private readExportableSettings(): Array<[string, string]> {
        const entries: Array<[string, string]> = [];

        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);

                if (!key || !key.startsWith('game-shelf')) {
                    continue;
                }

                const value = localStorage.getItem(key);

                if (typeof value === 'string') {
                    entries.push([key, value]);
                }
            }
        } catch {
            // Ignore storage read issues.
        }

        const colorKey = PRIMARY_COLOR_STORAGE_KEY;
        const colorSchemeKey = COLOR_SCHEME_STORAGE_KEY;

        if (!entries.some(([key]) => key === colorKey)) {
            entries.push([colorKey, this.themeService.getPrimaryColor()]);
        }

        if (!entries.some(([key]) => key === colorSchemeKey)) {
            entries.push([colorSchemeKey, this.themeService.getColorSchemePreference()]);
        }

        return entries;
    }

    private applyImportedSettings(rows: ParsedSettingImportRow[]): void {
        rows.forEach(row => {
            try {
                localStorage.setItem(row.key, row.value);
            } catch {
                // Ignore storage write failures.
            }

            if (row.key === PRIMARY_COLOR_STORAGE_KEY) {
                this.themeService.setPrimaryColor(row.value);
            }

            if (row.key === COLOR_SCHEME_STORAGE_KEY && (row.value === 'system' || row.value === 'light' || row.value === 'dark')) {
                this.selectedColorScheme = row.value;
                this.themeService.setColorSchemePreference(row.value);
            }
        });
    }

    private async buildTagNameToIdMap(): Promise<Map<string, number>> {
        const tags = await this.repository.listTags();
        const map = new Map<string, number>();

        tags.forEach(tag => {
            if (typeof tag.id === 'number' && tag.id > 0) {
                map.set(tag.name.toLowerCase(), tag.id);
            }
        });

        return map;
    }

    private normalizeTagIds(tagIds: number[] | undefined): number[] {
        if (!Array.isArray(tagIds)) {
            return [];
        }

        return [...new Set(tagIds.filter(value => Number.isInteger(value) && value > 0))];
    }

    private resolveUniqueName(name: string, usedNamesLowercase: Set<string>): string {
        const trimmed = name.trim();
        const baseName = trimmed.length > 0 ? trimmed : 'Untitled';
        const baseLower = baseName.toLowerCase();

        if (!usedNamesLowercase.has(baseLower)) {
            usedNamesLowercase.add(baseLower);
            return baseName;
        }

        let suffix = 2;
        while (suffix < 10000) {
            const candidate = `${baseName} (${suffix})`;
            const candidateLower = candidate.toLowerCase();
            if (!usedNamesLowercase.has(candidateLower)) {
                usedNamesLowercase.add(candidateLower);
                return candidate;
            }
            suffix += 1;
        }

        const fallback = `${baseName} (${Date.now()})`;
        usedNamesLowercase.add(fallback.toLowerCase());
        return fallback;
    }

    private escapeCsvValue(value: string): string {
        const normalized = String(value ?? '');

        if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n') || normalized.includes('\r')) {
            return `"${normalized.replace(/"/g, '""')}"`;
        }

        return normalized;
    }

    private async presentShareDialog(csv: string, filename: string): Promise<void> {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const file = new File([blob], filename, { type: 'text/csv' });

        const capacitorShare = (window as { Capacitor?: { Plugins?: { Share?: { share: (options: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Promise<void> } } } }).Capacitor?.Plugins?.Share;

        if (capacitorShare?.share) {
            const objectUrl = URL.createObjectURL(blob);

            try {
                await capacitorShare.share({
                    title: 'Game Shelf Export',
                    text: 'Game Shelf CSV export',
                    url: objectUrl,
                    dialogTitle: 'Export CSV',
                });
                return;
            } catch {
                // Fall through to next strategy.
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        }

        const webNavigator = navigator as Navigator & {
            share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
            canShare?: (data: { files?: File[] }) => boolean;
        };

        if (typeof webNavigator.share === 'function') {
            const canShareFiles = typeof webNavigator.canShare !== 'function' || webNavigator.canShare({ files: [file] });

            if (canShareFiles) {
                await webNavigator.share({
                    title: 'Game Shelf Export',
                    text: 'Game Shelf CSV export',
                    files: [file],
                });
                return;
            }
        }

        const objectUrl = URL.createObjectURL(blob);

        try {
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = filename;
            anchor.click();
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    private findPresetColor(color: string): string | null {
        return this.presets.find(preset => preset.value === color)?.value ?? null;
    }

    private async presentToast(message: string, color: 'primary' | 'danger' | 'warning' = 'primary'): Promise<void> {
        const toast = await this.toastController.create({
            message,
            duration: 1800,
            position: 'bottom',
            color,
        });

        await toast.present();
    }
}
