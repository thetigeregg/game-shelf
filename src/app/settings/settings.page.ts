import { Component, inject } from '@angular/core';
import {
  AlertController,
  ToastController,
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
  IonReorderGroup,
  IonReorder,
  IonInput,
  IonToggle
} from '@ionic/angular/standalone';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameGroupByField,
  GameListFilters,
  GameRating,
  GameStatus,
  ListType,
  Tag
} from '../core/models/game.models';
import {
  COLOR_SCHEME_STORAGE_KEY,
  ColorSchemePreference,
  ThemeService
} from '../core/services/theme.service';
import { GAME_REPOSITORY, GameRepository } from '../core/data/game-repository';
import { GameShelfService } from '../core/services/game-shelf.service';
import { ImageCacheService } from '../core/services/image-cache.service';
import {
  PlatformOrderService,
  PLATFORM_ORDER_STORAGE_KEY
} from '../core/services/platform-order.service';
import {
  PlatformCustomizationService,
  PLATFORM_DISPLAY_NAMES_STORAGE_KEY
} from '../core/services/platform-customization.service';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from '../core/data/sync-outbox-writer';
import {
  formatRateLimitedUiError,
  isRateLimitedMessage,
  isTransientNetworkMessage
} from '../core/utils/rate-limit-ui-error';
import { normalizeNotesValueOrNull } from '../core/utils/notes-normalization.utils';
import {
  escapeCsvValue,
  normalizeColor,
  normalizeCoverSource,
  normalizeGroupBy,
  normalizeListType,
  normalizeRating,
  normalizeStatus,
  parseFilters,
  parseGameIdArray,
  parseOptionalDataImage,
  parseOptionalDecimal,
  parseOptionalGameType,
  parseOptionalNumber,
  parseOptionalText,
  parsePositiveInteger,
  parsePositiveIntegerArray,
  parseStringArray
} from './settings-import-export.utils';
import {
  getGameKey,
  hasHltbData,
  isMgcAutoSelectedMultiple as isMgcAutoSelectedMultipleRow,
  isMgcRowError,
  isMgcRowReady,
  isMgcRowSuccess,
  isMgcRowWarning,
  MGC_BOX_ART_MAX_ATTEMPTS,
  MGC_BOX_ART_MIN_INTERVAL_MS,
  MGC_HLTB_MAX_ATTEMPTS,
  MGC_HLTB_MIN_INTERVAL_MS,
  MGC_RESOLVE_BASE_INTERVAL_MS,
  MGC_RESOLVE_MAX_ATTEMPTS,
  MGC_RESOLVE_MAX_INTERVAL_MS,
  MGC_RESOLVE_MIN_INTERVAL_MS,
  MgcImportRow,
  normalizeLookupKey,
  normalizeMgcTitleForMatch,
  parseMgcLabels,
  recomputeMgcDuplicateErrors,
  resolveGlobalCooldownWaitMs,
  resolveRateLimitRetryDelayMs,
  resolveTransientRetryDelayMs
} from './settings-mgc.utils';
import { DebugLogService } from '../core/services/debug-log.service';
import { getAppVersion, isMgcImportFeatureEnabled } from '../core/config/runtime-config';
import { ClientWriteAuthService } from '../core/services/client-write-auth.service';
import { addIcons } from 'ionicons';
import {
  close,
  trash,
  alertCircle,
  download,
  share,
  fileTrayFull,
  swapVertical,
  refresh,
  layers,
  bug,
  key
} from 'ionicons/icons';

const LEGACY_PRIMARY_COLOR_STORAGE_KEY = 'game-shelf-primary-color';

type ExportRowType = 'game' | 'tag' | 'view' | 'setting';

interface ExportCsvRow {
  type: ExportRowType;
  listType: string;
  igdbGameId: string;
  platformIgdbId: string;
  title: string;
  customTitle: string;
  summary: string;
  storyline: string;
  notes: string;
  coverUrl: string;
  customCoverUrl: string;
  coverSource: string;
  gameType: string;
  platform: string;
  customPlatform: string;
  customPlatformIgdbId: string;
  collections: string;
  releaseDate: string;
  releaseYear: string;
  hltbMainHours: string;
  hltbMainExtraHours: string;
  hltbCompletionistHours: string;
  similarGameIgdbIds: string;
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
  notes: string | null;
  status: GameStatus | null;
  rating: GameRating | null;
  customTitle: string | null;
  customPlatform: { name: string; igdbId: number } | null;
  customCoverUrl: string | null;
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

type ParsedImportRow =
  | ParsedGameImportRow
  | ParsedTagImportRow
  | ParsedViewImportRow
  | ParsedSettingImportRow;

interface ImportPreviewRow {
  id: number;
  rowNumber: number;
  type: ExportRowType | 'unknown';
  summary: string;
  error: string | null;
  warning: string | null;
  parsed: ParsedImportRow | null;
}

interface PlatformCustomizationItem extends GameCatalogPlatformOption {
  customName: string;
}

const CSV_HEADERS: Array<keyof ExportCsvRow> = [
  'type',
  'listType',
  'igdbGameId',
  'platformIgdbId',
  'title',
  'customTitle',
  'summary',
  'storyline',
  'notes',
  'coverUrl',
  'customCoverUrl',
  'coverSource',
  'gameType',
  'platform',
  'customPlatform',
  'customPlatformIgdbId',
  'collections',
  'releaseDate',
  'releaseYear',
  'hltbMainHours',
  'hltbMainExtraHours',
  'hltbCompletionistHours',
  'similarGameIgdbIds',
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
  'updatedAt'
];

const REQUIRED_CSV_HEADERS: Array<keyof ExportCsvRow> = [
  'type',
  'listType',
  'igdbGameId',
  'platformIgdbId',
  'title',
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
  'updatedAt'
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
    IonReorderGroup,
    IonReorder,
    IonInput,
    IonToggle
  ]
})
export class SettingsPage {
  private static readonly IMAGE_CACHE_MIN_MB = 20;
  private static readonly IMAGE_CACHE_MAX_MB = 2048;

  readonly colorSchemeOptions: Array<{ label: string; value: ColorSchemePreference }> = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' }
  ];
  readonly appVersion = getAppVersion();
  readonly isMgcImportFeatureEnabled = isMgcImportFeatureEnabled();

  selectedColorScheme: ColorSchemePreference = 'system';
  clientWriteTokenConfigured = false;
  verboseTracingEnabled = false;
  imageCacheLimitMb = 200;
  imageCacheUsageMb = 0;
  isPlatformOrderModalOpen = false;
  isPlatformOrderLoading = false;
  platformOrderItems: PlatformCustomizationItem[] = [];
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
  mgcResolverPlatformIgdbId: number | null = null;
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
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true
  });
  private readonly toastController = inject(ToastController);
  private readonly alertController = inject(AlertController);
  private readonly router = inject(Router);
  private readonly debugLogService = inject(DebugLogService);
  private readonly clientWriteAuthService = inject(ClientWriteAuthService);

  constructor() {
    this.selectedColorScheme = this.themeService.getColorSchemePreference();
    this.clientWriteTokenConfigured = this.clientWriteAuthService.hasToken();
    this.verboseTracingEnabled = this.debugLogService.isVerboseTracingEnabled();
    this.imageCacheLimitMb = this.imageCacheService.getLimitMb();
    void this.refreshImageCacheUsage();
    addIcons({
      close,
      trash,
      alertCircle,
      download,
      share,
      fileTrayFull,
      swapVertical,
      refresh,
      layers,
      bug,
      key
    });
  }

  onColorSchemePreferenceChange(value: string): void {
    if (value !== 'system' && value !== 'light' && value !== 'dark') {
      return;
    }

    this.selectedColorScheme = value;
    this.themeService.setColorSchemePreference(value);
  }

  onImageCacheLimitChange(value: number | string | null | undefined): void {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

    if (!Number.isInteger(parsed)) {
      this.imageCacheLimitMb = this.imageCacheService.getLimitMb();
      return;
    }

    const normalized = Math.max(
      SettingsPage.IMAGE_CACHE_MIN_MB,
      Math.min(parsed, SettingsPage.IMAGE_CACHE_MAX_MB)
    );
    this.imageCacheLimitMb = this.imageCacheService.setLimitMb(normalized);
    void this.refreshImageCacheUsage();
  }

  onVerboseTracingToggleChange(enabled: boolean): void {
    this.verboseTracingEnabled = enabled;
    this.debugLogService.setVerboseTracingEnabled(this.verboseTracingEnabled);
  }

  async promptClientWriteToken(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Set Device Write Token',
      message:
        'Paste the write token for this device. It is stored locally and used for sync write requests.',
      inputs: [
        {
          name: 'token',
          type: 'password',
          placeholder: 'Device write token'
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', role: 'confirm' }
      ]
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ values?: { token?: unknown } }>();

    if (role !== 'confirm') {
      return;
    }

    const token = typeof data?.values?.token === 'string' ? data.values.token.trim() : '';

    if (token.length === 0) {
      await this.presentToast('Device write token was empty.', 'warning');
      return;
    }

    this.clientWriteAuthService.setToken(token);
    this.clientWriteTokenConfigured = this.clientWriteAuthService.hasToken();
    await this.presentToast('Device write token saved.');
  }

  async clearClientWriteToken(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Clear Device Write Token',
      message: 'Remove the stored write token from this device?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', role: 'confirm', cssClass: 'alert-button-danger' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    this.clientWriteAuthService.clearToken();
    this.clientWriteTokenConfigured = false;
    await this.presentToast('Device write token removed.');
  }

  async purgeLocalImageCache(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Purge Local Image Cache',
      message:
        'Delete all locally cached game images from this device? Images will be re-fetched when needed.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Purge', role: 'confirm', cssClass: 'alert-button-danger' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    try {
      await this.imageCacheService.purgeLocalCache();
      await this.refreshImageCacheUsage();
      await this.presentToast('Local image cache purged.');
    } catch {
      await this.presentToast('Unable to purge local image cache.', 'danger');
    }
  }

  async openPlatformOrderModal(): Promise<void> {
    this.isPlatformOrderLoading = true;

    try {
      const platforms = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
      const displayNames = this.platformCustomizationService.getDisplayNames();
      this.platformOrderItems = platforms.map((platform) => {
        const key = typeof platform.id === 'number' && platform.id > 0 ? String(platform.id) : null;
        const customName = key ? (displayNames[key] ?? '') : '';
        return {
          ...platform,
          customName
        };
      });
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
    this.queueSettingDelete(PLATFORM_ORDER_STORAGE_KEY);
    this.platformOrderItems = await this.buildPlatformCustomizationItems();
  }

  clearPlatformDisplayNames(): void {
    this.platformCustomizationService.clearCustomNames();
    this.queueSettingDelete(PLATFORM_DISPLAY_NAMES_STORAGE_KEY);
    this.platformOrderItems = this.platformOrderItems.map((platform) => ({
      ...platform,
      customName: ''
    }));
  }

  trackByPlatformOrderItem(_index: number, item: GameCatalogPlatformOption): string {
    return `${String(item.id ?? 'none')}::${item.name}`;
  }

  onPlatformOrderReorder(event: CustomEvent): void {
    const detail = event.detail as {
      from: number;
      to: number;
      complete: (data?: boolean | GameCatalogPlatformOption[]) => void;
    };

    if (detail.from === detail.to) {
      detail.complete();
      return;
    }

    const next = [...this.platformOrderItems];
    const [item] = next.splice(detail.from, 1);
    next.splice(detail.to, 0, item);
    this.platformOrderItems = next;
    this.platformOrderService.setOrder(next.map((option) => option.name));
    this.queueSettingUpsert(
      PLATFORM_ORDER_STORAGE_KEY,
      JSON.stringify(next.map((option) => option.name))
    );
    detail.complete();
  }

  getPlatformCustomizationDisplayName(platform: PlatformCustomizationItem): string {
    const customName = platform.customName.trim();
    return customName.length > 0 ? customName : platform.name;
  }

  getPlatformDisplayName(
    platformName: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const label = this.platformCustomizationService
      .getDisplayNameWithoutAlias(platformName, platformIgdbId)
      .trim();
    return label.length > 0 ? label : 'Unknown platform';
  }

  getMgcResolverPlatformSummary(result: GameCatalogResult): string {
    const options = this.getCatalogPlatformOptions(result);

    if (options.length === 0) {
      return this.getPlatformDisplayName(result.platform ?? null, result.platformIgdbId ?? null);
    }

    const selectedPlatformId = this.mgcResolverPlatformIgdbId;
    const selectedOption =
      typeof selectedPlatformId === 'number'
        ? options.find((option) => option.id === selectedPlatformId)
        : null;

    if (selectedOption) {
      const selectedLabel = this.getPlatformDisplayName(selectedOption.name, selectedOption.id);

      if (options.length <= 1) {
        return selectedLabel;
      }

      return `${selectedLabel} + ${String(options.length - 1)} more`;
    }

    return options.map((option) => this.getPlatformDisplayName(option.name, option.id)).join(', ');
  }

  async editPlatformDisplayName(platform: PlatformCustomizationItem): Promise<void> {
    let draftName = platform.customName;

    const alert = await this.alertController.create({
      header: `Display Name (${platform.name})`,
      inputs: [
        {
          name: 'displayName',
          type: 'text',
          value: draftName,
          placeholder: platform.name
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Clear',
          role: 'destructive',
          handler: () => {
            draftName = '';
          }
        },
        {
          text: 'Save',
          role: 'confirm',
          handler: (value: { displayName?: string } | undefined) => {
            draftName = (value?.displayName ?? '').trim();
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm' && role !== 'destructive') {
      return;
    }

    platform.customName = draftName;
    this.persistPlatformDisplayNames();
  }

  private async refreshImageCacheUsage(): Promise<void> {
    const usageBytes = await this.imageCacheService.getUsageBytes();
    this.imageCacheUsageMb = Math.round((usageBytes / (1024 * 1024)) * 10) / 10;
  }

  get importErrorCount(): number {
    return this.importPreviewRows.filter((row) => row.error !== null).length;
  }

  get importWarningCount(): number {
    return this.importPreviewRows.filter((row) => row.warning !== null).length;
  }

  get canApplyImport(): boolean {
    return (
      this.importPreviewRows.length > 0 && this.importErrorCount === 0 && !this.isApplyingImport
    );
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

  get mgcResolverPlatformOptions(): GameCatalogPlatformOption[] {
    return this.mgcSearchPlatforms;
  }

  get mgcResolvedCount(): number {
    return this.mgcRows.filter((row) => isMgcRowReady(row)).length;
  }

  get mgcBlockedCount(): number {
    return this.mgcRows.filter((row) => !isMgcRowReady(row)).length;
  }

  get canApplyMgcImport(): boolean {
    return (
      this.mgcTargetListType !== null &&
      this.mgcRows.length > 0 &&
      this.mgcBlockedCount === 0 &&
      !this.isApplyingMgcImport &&
      !this.isResolvingMgcPage
    );
  }

  async exportCsv(): Promise<void> {
    try {
      const csv = await this.buildExportCsv();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `game-shelf-export-${timestamp}.csv`;
      await this.presentShareFile({
        content: csv,
        filename,
        mimeType: 'text/csv;charset=utf-8'
      });
      await this.presentToast('CSV export prepared.');
    } catch {
      await this.presentToast('Unable to export CSV.', 'danger');
    }
  }

  async exportDebugLogs(): Promise<void> {
    try {
      this.debugLogService.info('settings.export_debug_logs_requested');
      const content = this.debugLogService.exportText();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `game-shelf-debug-${timestamp}.log`;
      await this.presentShareFile({
        content,
        filename,
        mimeType: 'text/plain;charset=utf-8'
      });
      await this.presentToast('Debug logs prepared.');
    } catch (error: unknown) {
      this.debugLogService.error('settings.export_debug_logs_failed', error);
      await this.presentToast('Unable to export debug logs.', 'danger');
    }
  }

  async clearDebugLogs(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Clear Debug Logs',
      message: 'Delete all locally captured debug logs?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', role: 'confirm', cssClass: 'alert-button-danger' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    this.debugLogService.clear();
    await this.presentToast('Debug logs cleared.');
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
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'confirm',
          cssClass: 'alert-button-danger'
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    this.importPreviewRows = this.importPreviewRows.filter((row) => row.id !== rowId);
  }

  closeImportPreview(): void {
    this.isImportPreviewOpen = false;
  }

  triggerMgcImport(fileInput: HTMLInputElement): void {
    if (!this.isMgcImportFeatureEnabled) {
      return;
    }

    fileInput.value = '';
    fileInput.click();
  }

  openMetadataValidator(): void {
    void this.router.navigateByUrl('/metadata-validator');
  }

  async onMgcImportFileSelected(event: Event): Promise<void> {
    if (!this.isMgcImportFeatureEnabled) {
      return;
    }

    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const rows = await this.parseMgcCsv(text);
      this.debugLogService.info('mgc.import_file_parsed', { rows: rows.length, name: file.name });
      this.mgcRows = rows;
      this.mgcPageIndex = 0;
      this.mgcPageSize = 50;
      this.mgcTargetListType = null;
      this.isMgcImportOpen = true;
      this.isMgcResolverOpen = false;
      this.mgcResolverRowId = null;
    } catch {
      this.debugLogService.error('mgc.import_file_parse_failed');
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
    this.mgcResolverPlatformIgdbId = null;
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
          role: 'cancel'
        },
        {
          text: 'Remove',
          role: 'confirm',
          cssClass: 'alert-button-danger'
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    this.mgcRows = this.mgcRows.filter((row) => row.id !== rowId);
    recomputeMgcDuplicateErrors(this.mgcRows, this.mgcExistingGameKeys);

    if (this.mgcPageIndex >= this.mgcPageCount) {
      this.mgcPageIndex = Math.max(this.mgcPageCount - 1, 0);
    }
  }

  onMgcTargetListTypeChange(value: string | null | undefined): void {
    if (value === 'collection' || value === 'wishlist') {
      this.mgcTargetListType = value;
      return;
    }

    this.mgcTargetListType = null;
  }

  onMgcPageSizeChange(value: number | string | null | undefined): void {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

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

    const rowsToResolve = this.mgcCurrentPageRows.filter((row) => {
      return row.error === null && !isMgcRowReady(row);
    });

    if (rowsToResolve.length === 0) {
      await this.presentToast('No unresolved rows on this page.', 'warning');
      return;
    }

    this.isResolvingMgcPage = true;
    this.debugLogService.info('mgc.resolve_page_start', {
      pageIndex: this.mgcPageIndex,
      pageSize: this.mgcPageSize,
      unresolvedRows: rowsToResolve.length
    });

    try {
      let lastRequestStartedAt = 0;
      let currentIntervalMs = MGC_RESOLVE_BASE_INTERVAL_MS;

      for (const row of rowsToResolve) {
        const nowMs = Date.now();
        const cooldownWaitMs = Math.max(this.mgcRateLimitCooldownUntilMs - nowMs, 0);
        const waitMs = Math.max(
          currentIntervalMs - (nowMs - lastRequestStartedAt),
          cooldownWaitMs,
          0
        );

        if (waitMs > 0) {
          await this.delay(waitMs);
        }

        lastRequestStartedAt = Date.now();
        await this.resolveMgcRowFromSearchWithRetry(row);

        if (row.status === 'error' && this.isRateLimitStatusDetail(row.statusDetail)) {
          currentIntervalMs = Math.min(
            MGC_RESOLVE_MAX_INTERVAL_MS,
            Math.round(currentIntervalMs * 1.8)
          );
        } else {
          currentIntervalMs = Math.max(
            MGC_RESOLVE_MIN_INTERVAL_MS,
            Math.round(currentIntervalMs * 0.92)
          );
        }
      }

      recomputeMgcDuplicateErrors(this.mgcRows, this.mgcExistingGameKeys);
      this.debugLogService.info('mgc.resolve_page_complete', {
        pageIndex: this.mgcPageIndex,
        resolvedRows: rowsToResolve.length
      });
      await this.presentToast(
        `Resolved ${String(rowsToResolve.length)} row${rowsToResolve.length === 1 ? '' : 's'} on this page.`
      );
    } catch {
      this.debugLogService.error('mgc.resolve_page_failed', {
        pageIndex: this.mgcPageIndex
      });
      await this.presentToast('Unable to resolve all rows on this page.', 'danger');
    } finally {
      this.isResolvingMgcPage = false;
    }
  }

  async openMgcRowResolver(row: MgcImportRow): Promise<void> {
    if (row.error || this.isApplyingMgcImport) {
      return;
    }

    await this.ensureMgcPlatformLookup();
    this.mgcResolverRowId = row.id;
    this.mgcResolverQuery = row.name;
    this.mgcResolverPlatformIgdbId = row.platformIgdbId;
    this.mgcResolverResults = [];
    this.mgcResolverError = '';
    this.isMgcResolverOpen = true;
    await this.searchMgcResolver();
  }

  closeMgcResolver(): void {
    this.isMgcResolverOpen = false;
    this.mgcResolverRowId = null;
    this.mgcResolverQuery = '';
    this.mgcResolverPlatformIgdbId = null;
    this.mgcResolverResults = [];
    this.mgcResolverError = '';
    this.isMgcResolverSearching = false;
  }

  onMgcResolverQueryChange(value: string | null | undefined): void {
    this.mgcResolverQuery = value ?? '';
  }

  onMgcResolverPlatformChange(value: string | number | null | undefined): void {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      this.mgcResolverPlatformIgdbId = value;
      return;
    }

    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      this.mgcResolverPlatformIgdbId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      return;
    }

    this.mgcResolverPlatformIgdbId = null;
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
    this.debugLogService.debug('mgc.resolver_search_start', {
      query,
      platformIgdbId: this.mgcResolverPlatformIgdbId
    });

    try {
      const results = await firstValueFrom(
        this.gameShelfService.searchGames(query, this.mgcResolverPlatformIgdbId)
      );
      this.mgcResolverResults = results;
      this.debugLogService.debug('mgc.resolver_search_complete', { results: results.length });
    } catch (error: unknown) {
      this.mgcResolverResults = [];
      this.mgcResolverError = formatRateLimitedUiError(error, 'Search failed. Please try again.');
      this.debugLogService.error('mgc.resolver_search_failed', error);
    } finally {
      this.isMgcResolverSearching = false;
    }
  }

  async chooseMgcResolverResult(result: GameCatalogResult): Promise<void> {
    const row = this.activeMgcResolverRow;

    if (!row) {
      return;
    }

    const resolverRow = this.resolveMgcResolverRowContext(row);
    const resolved = await this.resolveCatalogForRow(resolverRow, result, true);

    if (!resolved) {
      await this.presentToast('Unable to resolve a platform for this result.', 'warning');
      return;
    }

    row.platformIgdbId = resolverRow.platformIgdbId;
    row.platform = resolverRow.platform;
    row.selected = resolved;
    row.candidates = [resolved];
    row.status = 'resolved';
    row.statusDetail = 'Selected manually';
    row.error = null;
    recomputeMgcDuplicateErrors(this.mgcRows, this.mgcExistingGameKeys);
    this.closeMgcResolver();
  }

  async confirmApplyMgcImport(): Promise<void> {
    if (!this.canApplyMgcImport || this.mgcTargetListType === null) {
      return;
    }

    const targetLabel = this.mgcTargetListType === 'collection' ? 'Collection' : 'Wishlist';
    const alert = await this.alertController.create({
      header: 'Confirm MGC Import',
      message: `Import ${String(this.mgcResolvedCount)} game${this.mgcResolvedCount === 1 ? '' : 's'} into ${targetLabel}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Import',
          role: 'confirm'
        }
      ]
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
      'mgc-row-success': isMgcRowSuccess(row),
      'mgc-row-warning': isMgcRowWarning(row),
      'mgc-row-error': isMgcRowError(row)
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
        return `${String(row.candidates.length)} possible matches found.\nAuto-selected exact title match: ${row.selected.title}.`;
      }

      return `${String(row.candidates.length)} possible matches found.`;
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
    return (
      !this.isMgcResolverSearching &&
      this.mgcResolverError.length === 0 &&
      this.mgcResolverQuery.trim().length >= 2 &&
      this.mgcResolverResults.length === 0
    );
  }

  isMgcAutoSelectedMultiple(row: MgcImportRow): boolean {
    return isMgcAutoSelectedMultipleRow(row);
  }

  onMgcResultImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }

  async applyImport(): Promise<void> {
    if (!this.canApplyImport) {
      return;
    }

    this.isApplyingImport = true;

    try {
      const parsedRows = this.importPreviewRows
        .map((row) => row.parsed)
        .filter((row): row is ParsedImportRow => row !== null);

      const settingRows = parsedRows.filter(
        (row): row is ParsedSettingImportRow => row.kind === 'setting'
      );
      const tagRows = parsedRows.filter((row): row is ParsedTagImportRow => row.kind === 'tag');
      const gameRows = parsedRows.filter((row): row is ParsedGameImportRow => row.kind === 'game');
      const viewRows = parsedRows.filter((row): row is ParsedViewImportRow => row.kind === 'view');

      let settingsApplied = 0;
      let tagsApplied = 0;
      let gamesApplied = 0;
      let gameCustomMetadataApplied = 0;
      let gameStatusesApplied = 0;
      let gameRatingsApplied = 0;
      let gameTagAssignmentsApplied = 0;
      let gameNotesApplied = 0;
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
        existingTags.map((tag) => tag.name.trim().toLowerCase()).filter((name) => name.length > 0)
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
            tagRow.tagId !== null &&
            typeof createdTag.id === 'number' &&
            Number.isInteger(createdTag.id) &&
            createdTag.id > 0
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

        if (
          typeof platformIgdbIdRaw !== 'number' ||
          !Number.isInteger(platformIgdbIdRaw) ||
          platformIgdbIdRaw <= 0
        ) {
          failedRows += 1;
          continue;
        }
        const platformIgdbId = platformIgdbIdRaw;

        try {
          await this.gameShelfService.addGame(gameRow.catalog, gameRow.listType);
          gamesApplied += 1;

          if (gameRow.customTitle !== null || gameRow.customPlatform !== null) {
            await this.gameShelfService.setGameCustomMetadata(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              {
                title: gameRow.customTitle,
                platform: gameRow.customPlatform
              }
            );
            gameCustomMetadataApplied += 1;
          }

          if (gameRow.customCoverUrl !== null) {
            await this.gameShelfService.setGameCustomCover(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              gameRow.customCoverUrl
            );
          }

          if (gameRow.status !== null) {
            await this.gameShelfService.setGameStatus(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              gameRow.status
            );
            gameStatusesApplied += 1;
          }

          if (gameRow.rating !== null) {
            await this.gameShelfService.setGameRating(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              gameRow.rating
            );
            gameRatingsApplied += 1;
          }

          if (gameRow.notes !== null) {
            await this.gameShelfService.setGameNotes(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              gameRow.notes
            );
            gameNotesApplied += 1;
          }

          const tagIds = gameRow.tagNames
            .map((tagName) => tagMap.get(tagName.toLowerCase()))
            .filter(
              (tagId): tagId is number =>
                typeof tagId === 'number' && Number.isInteger(tagId) && tagId > 0
            );
          gameRow.tagIds.forEach((importedTagId) => {
            const resolvedTagId = importedTagIdToResolvedTagId.get(importedTagId);

            if (
              typeof resolvedTagId === 'number' &&
              Number.isInteger(resolvedTagId) &&
              resolvedTagId > 0
            ) {
              tagIds.push(resolvedTagId);
            }
          });
          const uniqueTagIds = [...new Set(tagIds)];

          if (uniqueTagIds.length > 0) {
            await this.gameShelfService.setGameTags(
              gameRow.catalog.igdbGameId,
              platformIgdbId,
              uniqueTagIds
            );
            gameTagAssignmentsApplied += 1;
          }
        } catch {
          failedRows += 1;
        }
      }

      const [collectionViews, wishlistViews] = await Promise.all([
        this.repository.listViews('collection'),
        this.repository.listViews('wishlist')
      ]);
      const usedViewNames = new Set(
        [...collectionViews, ...wishlistViews]
          .map((view) => view.name.trim().toLowerCase())
          .filter((name) => name.length > 0)
      );

      for (const viewRow of viewRows) {
        try {
          const resolvedName = this.resolveUniqueName(viewRow.name, usedViewNames);
          if (resolvedName !== viewRow.name) {
            viewsRenamed += 1;
          }
          await this.gameShelfService.createView(
            resolvedName,
            viewRow.listType,
            viewRow.filters,
            viewRow.groupBy
          );
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
      this.presentImportSummary({
        totalRows,
        settingsApplied,
        tagsApplied,
        gamesApplied,
        gameStatusesApplied,
        gameRatingsApplied,
        gameCustomMetadataApplied,
        gameTagAssignmentsApplied,
        gameNotesApplied,
        viewsApplied,
        tagsRenamed,
        viewsRenamed,
        failedRows,
        skippedRows
      });
    } catch {
      await this.presentToast('Unable to apply CSV import.', 'danger');
    } finally {
      this.isApplyingImport = false;
    }
  }

  private presentImportSummary(summary: {
    totalRows: number;
    settingsApplied: number;
    tagsApplied: number;
    gamesApplied: number;
    gameStatusesApplied: number;
    gameRatingsApplied: number;
    gameCustomMetadataApplied: number;
    gameTagAssignmentsApplied: number;
    gameNotesApplied: number;
    viewsApplied: number;
    tagsRenamed: number;
    viewsRenamed: number;
    failedRows: number;
    skippedRows: number;
  }): void {
    this.presentSummaryModal('Import Summary', [
      `Total rows: ${String(summary.totalRows)}`,
      `Games imported: ${String(summary.gamesApplied)}`,
      `Tags imported: ${String(summary.tagsApplied)}`,
      `Views imported: ${String(summary.viewsApplied)}`,
      `Settings imported: ${String(summary.settingsApplied)}`,
      `Game statuses set: ${String(summary.gameStatusesApplied)}`,
      `Game ratings set: ${String(summary.gameRatingsApplied)}`,
      `Game custom metadata updates: ${String(summary.gameCustomMetadataApplied)}`,
      `Game tag assignments: ${String(summary.gameTagAssignmentsApplied)}`,
      `Game notes set: ${String(summary.gameNotesApplied)}`,
      `Tags auto-renamed: ${String(summary.tagsRenamed)}`,
      `Views auto-renamed: ${String(summary.viewsRenamed)}`,
      `Failed rows: ${String(summary.failedRows)}`,
      `Skipped rows: ${String(summary.skippedRows)}`
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

    return this.mgcRows.find((row) => row.id === this.mgcResolverRowId);
  }

  private async parseMgcCsv(csv: string): Promise<MgcImportRow[]> {
    const table = this.parseCsvTable(csv);

    if (table.length < 2) {
      throw new Error('CSV must include header and at least one data row.');
    }

    const headers = table[0].map((cell) => cell.trim());
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

      if (values.every((value) => value.trim().length === 0)) {
        continue;
      }

      const rowNumber = index + 1;
      const name = (values[nameIndex] ?? '').trim();
      const platformInput = (values[platformIndex] ?? '').trim();
      const labelsRaw = labelsIndex !== undefined ? (values[labelsIndex] ?? '') : '';
      const labels = parseMgcLabels(labelsRaw);

      let error: string | null = null;
      let warning: string | null = null;

      if (name.length === 0) {
        error = 'Missing required "name" value.';
      } else if (platformInput.length === 0) {
        error = 'Missing required "platform" value.';
      }

      const platformMatch =
        platformInput.length > 0 ? this.resolveMgcPlatform(platformInput) : null;
      const platformIgdbId = platformMatch?.id ?? null;
      const platform = platformMatch?.name ?? platformInput;

      if (!error && platformInput.length > 0 && platformMatch === null) {
        warning =
          this.mgcSearchPlatforms.length > 0
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
        selected: null
      });
    }

    const existingGames = await this.repository.listAll();
    this.mgcExistingGameKeys = new Set(
      existingGames.map((game) => getGameKey(game.igdbGameId, game.platformIgdbId))
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
    this.debugLogService.info('mgc.apply_start', {
      rows: this.mgcRows.length,
      targetListType: this.mgcTargetListType
    });

    try {
      recomputeMgcDuplicateErrors(this.mgcRows, this.mgcExistingGameKeys);

      if (this.mgcBlockedCount > 0) {
        await this.presentToast('Resolve or remove blocked rows before importing.', 'warning');
        return;
      }

      const rowsToImport = this.mgcRows.filter((row) => isMgcRowReady(row));
      this.importLoadingMessage = 'Preparing tags...';
      const { tagIdMap, tagsCreated } = await this.prepareMgcTags(rowsToImport);
      let gamesImported = 0;
      let tagsAssigned = 0;
      let boxArtResolved = 0;
      let hltbResolved = 0;
      let hltbFailed = 0;
      let duplicateSkipped = 0;
      let failed = 0;
      let lastBoxArtRequestStartedAt = 0;
      let lastHltbRequestStartedAt = 0;

      for (let index = 0; index < rowsToImport.length; index += 1) {
        const row = rowsToImport[index];
        const selected = row.selected;
        this.importLoadingMessage = `Importing games ${String(index + 1)}/${String(rowsToImport.length)}...`;

        if (
          !selected ||
          typeof selected.platformIgdbId !== 'number' ||
          selected.platformIgdbId <= 0
        ) {
          failed += 1;
          continue;
        }

        const key = getGameKey(selected.igdbGameId, selected.platformIgdbId);
        const existing = await this.gameShelfService.findGameByIdentity(
          selected.igdbGameId,
          selected.platformIgdbId
        );

        if (existing) {
          duplicateSkipped += 1;
          continue;
        }

        let resolvedCatalog: GameCatalogResult = selected;

        const nowMs = Date.now();
        const waitMs = Math.max(
          MGC_BOX_ART_MIN_INTERVAL_MS - (nowMs - lastBoxArtRequestStartedAt),
          resolveGlobalCooldownWaitMs(this.mgcRateLimitCooldownUntilMs, nowMs),
          0
        );

        if (waitMs > 0) {
          await this.waitWithLoadingCountdown(
            waitMs,
            'Waiting to continue additional metadata lookups'
          );
        }

        lastBoxArtRequestStartedAt = Date.now();
        this.importLoadingMessage = `Resolving additional metadata ${String(index + 1)}/${String(rowsToImport.length)}...`;
        const boxArt = await this.resolveBoxArtWithRetry(selected, index + 1, rowsToImport.length);
        const useIgdbCover = this.gameShelfService.shouldUseIgdbCoverForPlatform(
          selected.platform,
          selected.platformIgdbId
        );

        if (boxArt) {
          resolvedCatalog = {
            ...selected,
            coverUrl: boxArt,
            coverSource: useIgdbCover ? 'igdb' : 'thegamesdb'
          };
          boxArtResolved += 1;
        }

        try {
          await this.gameShelfService.addGame(resolvedCatalog, this.mgcTargetListType);
          gamesImported += 1;
          this.mgcExistingGameKeys.add(key);

          const tagIds = row.labels
            .map((label) => tagIdMap.get(label.toLowerCase()))
            .filter(
              (tagId): tagId is number =>
                typeof tagId === 'number' && Number.isInteger(tagId) && tagId > 0
            );

          if (tagIds.length > 0) {
            await this.gameShelfService.setGameTags(
              selected.igdbGameId,
              selected.platformIgdbId,
              tagIds
            );
            tagsAssigned += 1;
          }

          const hltbWaitMs = Math.max(
            MGC_HLTB_MIN_INTERVAL_MS - (Date.now() - lastHltbRequestStartedAt),
            resolveGlobalCooldownWaitMs(this.mgcRateLimitCooldownUntilMs, Date.now()),
            0
          );

          if (hltbWaitMs > 0) {
            await this.waitWithLoadingCountdown(hltbWaitMs, 'Waiting to continue HLTB lookups');
          }

          lastHltbRequestStartedAt = Date.now();
          this.importLoadingMessage = `Resolving HLTB ${String(index + 1)}/${String(rowsToImport.length)}...`;
          const hltbOutcome = await this.resolveMgcHltbWithRetry(
            selected,
            index + 1,
            rowsToImport.length
          );

          if (hltbOutcome === 'updated') {
            hltbResolved += 1;
          } else if (hltbOutcome === 'failed') {
            hltbFailed += 1;
          }
        } catch {
          failed += 1;
        }
      }

      await this.presentToast('MGC import completed.');
      this.debugLogService.info('mgc.apply_complete', {
        rowsSelected: rowsToImport.length,
        gamesImported,
        tagsAssigned,
        tagsCreated,
        boxArtResolved,
        hltbResolved,
        hltbFailed,
        duplicateSkipped,
        failed
      });
      this.presentMgcImportSummary({
        rowsSelected: rowsToImport.length,
        gamesImported,
        tagsAssigned,
        tagsCreated,
        boxArtResolved,
        hltbResolved,
        hltbFailed,
        duplicateSkipped,
        failed
      });
      this.closeMgcImport();
    } catch {
      this.debugLogService.error('mgc.apply_failed');
      await this.presentToast('Unable to complete MGC import.', 'danger');
    } finally {
      this.isApplyingMgcImport = false;
      this.isImportLoadingOpen = false;
      this.importLoadingMessage = '';
    }
  }

  private presentMgcImportSummary(summary: {
    rowsSelected: number;
    gamesImported: number;
    tagsAssigned: number;
    tagsCreated: number;
    boxArtResolved: number;
    hltbResolved: number;
    hltbFailed: number;
    duplicateSkipped: number;
    failed: number;
  }): void {
    this.presentSummaryModal('MGC Import Summary', [
      `Rows selected: ${String(summary.rowsSelected)}`,
      `Games imported: ${String(summary.gamesImported)}`,
      `Games with tags applied: ${String(summary.tagsAssigned)}`,
      `New tags created: ${String(summary.tagsCreated)}`,
      `2D box art resolved: ${String(summary.boxArtResolved)}`,
      `HLTB data resolved: ${String(summary.hltbResolved)}`,
      `HLTB lookup failures: ${String(summary.hltbFailed)}`,
      `Duplicates skipped: ${String(summary.duplicateSkipped)}`,
      `Failed: ${String(summary.failed)}`
    ]);
  }

  private async prepareMgcTags(
    rows: MgcImportRow[]
  ): Promise<{ tagIdMap: Map<string, number>; tagsCreated: number }> {
    const requiredTagNames = new Set<string>();

    rows.forEach((row) => {
      row.labels.forEach((label) => {
        const normalized = label.trim();

        if (normalized.length > 0) {
          requiredTagNames.add(normalized);
        }
      });
    });

    if (requiredTagNames.size === 0) {
      return {
        tagIdMap: await this.buildTagNameToIdMap(),
        tagsCreated: 0
      };
    }

    const existingTags = await this.repository.listTags();
    const existingTagNames = new Set(
      existingTags.map((tag) => tag.name.toLowerCase()).filter((name) => name.length > 0)
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
      tagsCreated
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
    this.mgcSearchPlatforms.forEach((platform) => {
      const normalizedName = normalizeLookupKey(platform.name);

      if (!this.mgcPlatformLookup.has(normalizedName)) {
        this.mgcPlatformLookup.set(normalizedName, platform);
      }
    });

    this.mgcPlatformLookupLoaded = this.mgcPlatformLookup.size > 0;
  }

  private resolveMgcPlatform(platformName: string): GameCatalogPlatformOption | null {
    const normalized = normalizeLookupKey(platformName);
    return this.mgcPlatformLookup.get(normalized) ?? null;
  }

  private resolveMgcPlatformById(platformIgdbId: number | null): GameCatalogPlatformOption | null {
    if (
      typeof platformIgdbId !== 'number' ||
      !Number.isInteger(platformIgdbId) ||
      platformIgdbId <= 0
    ) {
      return null;
    }

    return this.mgcSearchPlatforms.find((option) => option.id === platformIgdbId) ?? null;
  }

  private resolveMgcResolverRowContext(row: MgcImportRow): MgcImportRow {
    const selectedPlatform = this.resolveMgcPlatformById(this.mgcResolverPlatformIgdbId);

    if (!selectedPlatform || typeof selectedPlatform.id !== 'number' || selectedPlatform.id <= 0) {
      return {
        ...row,
        platformIgdbId: null
      };
    }

    return {
      ...row,
      platform: selectedPlatform.name,
      platformIgdbId: selectedPlatform.id
    };
  }

  private async resolveMgcRowFromSearchWithRetry(row: MgcImportRow): Promise<void> {
    let attempt = 1;

    while (attempt <= MGC_RESOLVE_MAX_ATTEMPTS) {
      await this.resolveMgcRowFromSearch(row);

      if (row.status !== 'error') {
        return;
      }

      const isRateLimited = this.isRateLimitStatusDetail(row.statusDetail);
      const isTransientError = this.isTransientMgcStatusDetail(row.statusDetail);

      if ((!isRateLimited && !isTransientError) || attempt >= MGC_RESOLVE_MAX_ATTEMPTS) {
        return;
      }

      const retryDelay = isRateLimited
        ? resolveRateLimitRetryDelayMs(row.statusDetail)
        : resolveTransientRetryDelayMs(attempt);
      this.mgcRateLimitCooldownUntilMs = Date.now() + retryDelay;
      await this.waitWithRetryCountdown(
        row,
        retryDelay,
        isRateLimited ? 'Rate limited' : 'Network issue'
      );
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
      const results = await firstValueFrom(
        this.gameShelfService.searchGames(row.name, row.platformIgdbId)
      );
      const deduped = new Map<string, GameCatalogResult>();

      for (const result of results) {
        const resolved = await this.resolveCatalogForRow(row, result, false);

        if (
          !resolved ||
          typeof resolved.platformIgdbId !== 'number' ||
          resolved.platformIgdbId <= 0
        ) {
          continue;
        }

        const key = getGameKey(resolved.igdbGameId, resolved.platformIgdbId);

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
        const exactTitleMatch =
          candidates.find((candidate) => {
            return (
              normalizeMgcTitleForMatch(candidate.title) === normalizeMgcTitleForMatch(row.name)
            );
          }) ?? null;

        row.selected = exactTitleMatch;
        row.status = 'multiple';
        row.statusDetail = exactTitleMatch
          ? `${String(candidates.length)} possible matches found. Exact title match auto-selected.`
          : `${String(candidates.length)} possible matches found.`;
        return;
      }

      row.selected = null;
      row.status = 'noMatch';
      row.statusDetail = 'No matches found.';
    } catch (error: unknown) {
      row.selected = null;
      row.status = 'error';
      const message = error instanceof Error ? error.message : '';
      row.statusDetail = message.trim().length > 0 ? message : 'Search failed.';
    }
  }

  private isRateLimitStatusDetail(detail: string): boolean {
    return isRateLimitedMessage(detail);
  }

  private isTransientMgcStatusDetail(detail: string): boolean {
    const normalized = detail.toLowerCase();

    if (this.isRateLimitStatusDetail(normalized)) {
      return false;
    }

    return isTransientNetworkMessage(normalized);
  }

  private async resolveBoxArtWithRetry(
    selected: GameCatalogResult,
    rowIndex: number,
    totalRows: number
  ): Promise<string | null> {
    let attempt = 1;

    while (attempt <= MGC_BOX_ART_MAX_ATTEMPTS) {
      try {
        const boxArtCandidates = await firstValueFrom(
          this.gameShelfService.searchBoxArtByTitle(
            selected.title,
            selected.platform,
            selected.platformIgdbId,
            selected.igdbGameId
          )
        );
        return boxArtCandidates[0] ?? null;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        const isRateLimited = this.isRateLimitStatusDetail(message);
        const isTransientError = this.isTransientMgcStatusDetail(message);

        if ((!isRateLimited && !isTransientError) || attempt >= MGC_BOX_ART_MAX_ATTEMPTS) {
          return null;
        }

        const retryDelay = isRateLimited
          ? resolveRateLimitRetryDelayMs(message)
          : resolveTransientRetryDelayMs(attempt);
        this.mgcRateLimitCooldownUntilMs = Date.now() + retryDelay;
        await this.waitWithLoadingCountdown(
          retryDelay,
          isRateLimited
            ? `Box art rate limited for row ${String(rowIndex)}/${String(totalRows)}. Retrying`
            : `Box art lookup failed for row ${String(rowIndex)}/${String(totalRows)}. Retrying`
        );
        attempt += 1;
      }
    }

    return null;
  }

  private async resolveMgcHltbWithRetry(
    selected: GameCatalogResult,
    rowIndex: number,
    totalRows: number
  ): Promise<'updated' | 'not_found' | 'failed'> {
    let attempt = 1;

    while (attempt <= MGC_HLTB_MAX_ATTEMPTS) {
      try {
        const refreshed = await this.gameShelfService.refreshGameCompletionTimesWithQuery(
          selected.igdbGameId,
          selected.platformIgdbId as number,
          {
            title: selected.title,
            releaseYear: selected.releaseYear,
            platform: selected.platform
          }
        );

        if (hasHltbData(refreshed)) {
          return 'updated';
        }

        return 'not_found';
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        const isRateLimited = this.isRateLimitStatusDetail(message);
        const isTransientError = this.isTransientMgcStatusDetail(message);

        if ((!isRateLimited && !isTransientError) || attempt >= MGC_HLTB_MAX_ATTEMPTS) {
          return 'failed';
        }

        const retryDelay = isRateLimited
          ? resolveRateLimitRetryDelayMs(message)
          : resolveTransientRetryDelayMs(attempt);
        this.mgcRateLimitCooldownUntilMs = Date.now() + retryDelay;
        await this.waitWithLoadingCountdown(
          retryDelay,
          isRateLimited
            ? `HLTB rate limited for row ${String(rowIndex)}/${String(totalRows)}. Retrying`
            : `HLTB lookup failed for row ${String(rowIndex)}/${String(totalRows)}. Retrying`
        );
        attempt += 1;
      }
    }

    return 'failed';
  }

  private async resolveCatalogForRow(
    row: MgcImportRow,
    result: GameCatalogResult,
    allowPlatformPrompt: boolean
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
        checked: index === 0
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Select',
          role: 'confirm'
        }
      ]
    });

    await alert.present();
    const { role, data } = await alert.onDidDismiss<{ data?: string }>();

    if (role !== 'confirm') {
      return null;
    }

    const index = Number.parseInt(data?.data ?? '', 10);

    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      return null;
    }

    return this.withSelectedPlatform(result, options[index]);
  }

  private resolveCatalogForRowWithoutPrompt(
    row: MgcImportRow,
    result: GameCatalogResult
  ): GameCatalogResult | null {
    const options = this.getCatalogPlatformOptions(result);

    if (row.platformIgdbId !== null) {
      const platformById = options.find((option) => option.id === row.platformIgdbId);

      if (platformById) {
        return this.withSelectedPlatform(result, platformById);
      }

      if (
        typeof result.platformIgdbId === 'number' &&
        result.platformIgdbId > 0 &&
        result.platformIgdbId === row.platformIgdbId &&
        typeof result.platform === 'string' &&
        result.platform.trim().length > 0
      ) {
        return this.withSelectedPlatform(result, {
          id: result.platformIgdbId,
          name: result.platform.trim()
        });
      }

      return null;
    }

    if (
      typeof result.platformIgdbId === 'number' &&
      result.platformIgdbId > 0 &&
      typeof result.platform === 'string' &&
      result.platform.trim().length > 0
    ) {
      return this.withSelectedPlatform(result, {
        id: result.platformIgdbId,
        name: result.platform.trim()
      });
    }

    if (options.length === 1) {
      return this.withSelectedPlatform(result, options[0]);
    }

    return null;
  }

  private withSelectedPlatform(
    result: GameCatalogResult,
    platform: { id: number; name: string }
  ): GameCatalogResult {
    return {
      ...result,
      platform: platform.name,
      platformIgdbId: platform.id,
      platforms: [platform.name],
      platformOptions: [{ id: platform.id, name: platform.name }]
    };
  }

  private getCatalogPlatformOptions(
    result: GameCatalogResult
  ): Array<{ id: number; name: string }> {
    if (Array.isArray(result.platformOptions) && result.platformOptions.length > 0) {
      return result.platformOptions
        .map((option) => {
          const id =
            typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0
              ? option.id
              : null;
          const name = typeof option.name === 'string' ? option.name.trim() : '';
          return { id, name };
        })
        .filter(
          (option): option is { id: number; name: string } =>
            option.id !== null && option.name.length > 0
        )
        .filter((option, index, all) => {
          return (
            all.findIndex(
              (candidate) => candidate.id === option.id && candidate.name === option.name
            ) === index
          );
        })
        .sort((left, right) =>
          this.platformOrderService.comparePlatformNames(left.name, right.name)
        );
    }

    if (
      typeof result.platformIgdbId === 'number' &&
      result.platformIgdbId > 0 &&
      typeof result.platform === 'string' &&
      result.platform.trim().length > 0
    ) {
      return [{ id: result.platformIgdbId, name: result.platform.trim() }];
    }

    return [];
  }

  private async processWithConcurrency<T>(
    items: T[],
    concurrency: number,
    handler: (item: T) => Promise<void>
  ): Promise<void> {
    const queue = [...items];
    const workers: Promise<void>[] = [];
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));

    for (let index = 0; index < workerCount; index += 1) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const item = queue.shift();

            if (!item) {
              return;
            }

            await handler(item);
          }
        })()
      );
    }

    await Promise.all(workers);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private async waitWithRetryCountdown(
    row: MgcImportRow,
    totalMs: number,
    reason: string
  ): Promise<void> {
    let remainingMs = totalMs;

    while (remainingMs > 0) {
      const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
      row.statusDetail = `${reason}. Retrying in ${String(secondsLeft)}s...`;
      const stepMs = Math.min(1000, remainingMs);
      await this.delay(stepMs);
      remainingMs -= stepMs;
    }
  }

  private async waitWithLoadingCountdown(totalMs: number, prefix: string): Promise<void> {
    let remainingMs = totalMs;

    while (remainingMs > 0) {
      const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
      this.importLoadingMessage = `${prefix} in ${String(secondsLeft)}s...`;
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
      this.repository.listViews('wishlist')
    ]);

    const tagById = new Map<number, Tag>();

    tags.forEach((tag) => {
      if (typeof tag.id === 'number' && tag.id > 0) {
        tagById.set(tag.id, tag);
      }
    });

    const rows: ExportCsvRow[] = [];

    games.forEach((game) => {
      const normalizedTagIds = this.normalizeTagIds(game.tagIds);
      const tagNames = this.normalizeTagIds(game.tagIds)
        .map((tagId) => tagById.get(tagId)?.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);

      rows.push({
        type: 'game',
        listType: game.listType,
        igdbGameId: game.igdbGameId,
        platformIgdbId: String(game.platformIgdbId),
        title: game.title,
        customTitle: game.customTitle ?? '',
        summary: game.summary ?? '',
        storyline: game.storyline ?? '',
        notes: game.notes ?? '',
        coverUrl: game.coverUrl ?? '',
        customCoverUrl: game.customCoverUrl ?? '',
        coverSource: game.coverSource,
        gameType: game.gameType ?? '',
        platform: game.platform,
        customPlatform: game.customPlatform ?? '',
        customPlatformIgdbId:
          game.customPlatformIgdbId !== null && game.customPlatformIgdbId !== undefined
            ? String(game.customPlatformIgdbId)
            : '',
        collections: JSON.stringify(game.collections ?? []),
        releaseDate: game.releaseDate ?? '',
        releaseYear: game.releaseYear !== null ? String(game.releaseYear) : '',
        hltbMainHours:
          game.hltbMainHours !== null && game.hltbMainHours !== undefined
            ? String(game.hltbMainHours)
            : '',
        hltbMainExtraHours:
          game.hltbMainExtraHours !== null && game.hltbMainExtraHours !== undefined
            ? String(game.hltbMainExtraHours)
            : '',
        hltbCompletionistHours:
          game.hltbCompletionistHours !== null && game.hltbCompletionistHours !== undefined
            ? String(game.hltbCompletionistHours)
            : '',
        similarGameIgdbIds: JSON.stringify(game.similarGameIgdbIds ?? []),
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
        updatedAt: game.updatedAt
      });
    });

    tags.forEach((tag) => {
      rows.push({
        type: 'tag',
        listType: '',
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        customTitle: '',
        summary: '',
        storyline: '',
        notes: '',
        coverUrl: '',
        customCoverUrl: '',
        coverSource: '',
        gameType: '',
        platform: '',
        customPlatform: '',
        customPlatformIgdbId: '',
        collections: '',
        releaseDate: '',
        releaseYear: '',
        hltbMainHours: '',
        hltbMainExtraHours: '',
        hltbCompletionistHours: '',
        similarGameIgdbIds: '',
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
        updatedAt: tag.updatedAt
      });
    });

    [...collectionViews, ...wishlistViews].forEach((view) => {
      rows.push({
        type: 'view',
        listType: view.listType,
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        customTitle: '',
        summary: '',
        storyline: '',
        notes: '',
        coverUrl: '',
        customCoverUrl: '',
        coverSource: '',
        gameType: '',
        platform: '',
        customPlatform: '',
        customPlatformIgdbId: '',
        collections: '',
        releaseDate: '',
        releaseYear: '',
        hltbMainHours: '',
        hltbMainExtraHours: '',
        hltbCompletionistHours: '',
        similarGameIgdbIds: '',
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
        updatedAt: view.updatedAt
      });
    });

    this.readExportableSettings().forEach(([key, value]) => {
      rows.push({
        type: 'setting',
        listType: '',
        igdbGameId: '',
        platformIgdbId: '',
        title: '',
        customTitle: '',
        summary: '',
        storyline: '',
        notes: '',
        coverUrl: '',
        customCoverUrl: '',
        coverSource: '',
        gameType: '',
        platform: '',
        customPlatform: '',
        customPlatformIgdbId: '',
        collections: '',
        releaseDate: '',
        releaseYear: '',
        hltbMainHours: '',
        hltbMainExtraHours: '',
        hltbCompletionistHours: '',
        similarGameIgdbIds: '',
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
        updatedAt: ''
      });
    });

    const lines = [
      CSV_HEADERS.join(','),
      ...rows.map((row) => CSV_HEADERS.map((header) => escapeCsvValue(row[header])).join(','))
    ];

    return lines.join('\n');
  }

  private async parseImportCsv(csv: string): Promise<ImportPreviewRow[]> {
    const table = this.parseCsvTable(csv);

    if (table.length < 2) {
      throw new Error('CSV must include header and at least one data row.');
    }

    const headers = table[0].map((cell) => cell.trim());
    REQUIRED_CSV_HEADERS.forEach((header) => {
      if (!headers.includes(header)) {
        throw new Error(`Missing CSV column: ${header}`);
      }
    });

    const gamesInDb = await this.repository.listAll();
    const existingKeys = new Set(
      gamesInDb.map((game) => `${game.igdbGameId}::${String(game.platformIgdbId)}`)
    );
    const pendingKeys = new Set<string>();
    const existingTags = await this.repository.listTags();
    const existingTagNames = new Set(
      existingTags.map((tag) => tag.name.trim().toLowerCase()).filter((name) => name.length > 0)
    );
    const pendingTagNames = new Set<string>();
    const [collectionViews, wishlistViews] = await Promise.all([
      this.repository.listViews('collection'),
      this.repository.listViews('wishlist')
    ]);
    const existingViewNames = new Set(
      [...collectionViews, ...wishlistViews]
        .map((view) => view.name.trim().toLowerCase())
        .filter((name) => name.length > 0)
    );
    const pendingViewNames = new Set<string>();
    const rows: ImportPreviewRow[] = [];

    for (let index = 1; index < table.length; index += 1) {
      const values = table[index];

      if (values.every((value) => value.trim().length === 0)) {
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
        pendingViewNames
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
    pendingViewNames: Set<string>
  ): ImportPreviewRow {
    const type = record.type;

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
          value: record.value
        }
      };
    }

    if (type === 'tag') {
      const name = record.name.trim();
      const color = normalizeColor(record.color);
      const tagId = parsePositiveInteger(record.tagId);

      if (name.length === 0) {
        return this.errorRow(type, rowNumber, 'Tag name is required.');
      }
      const warning = this.buildDuplicateNameWarning(
        name,
        existingTagNames,
        pendingTagNames,
        'tag'
      );

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
          color
        }
      };
    }

    if (type === 'view') {
      const listType = normalizeListType(record.listType);
      const groupBy = normalizeGroupBy(record.groupBy);
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

      const filters = parseFilters(record.filters, DEFAULT_GAME_LIST_FILTERS);

      if (!filters) {
        return this.errorRow(type, rowNumber, 'Invalid filters payload for view.');
      }
      const warning = this.buildDuplicateNameWarning(
        name,
        existingViewNames,
        pendingViewNames,
        'view'
      );

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
          filters
        }
      };
    }

    const listType = normalizeListType(record.listType);

    if (!listType) {
      return this.errorRow(type, rowNumber, 'Game list type must be collection or wishlist.');
    }

    const igdbGameId = record.igdbGameId.trim();

    if (!/^\d+$/.test(igdbGameId)) {
      return this.errorRow(type, rowNumber, 'Game IGDB id is required and must be numeric.');
    }

    const platformIgdbId = Number.parseInt(record.platformIgdbId, 10);

    if (!Number.isInteger(platformIgdbId) || platformIgdbId <= 0) {
      return this.errorRow(
        type,
        rowNumber,
        'Game platform IGDB id is required and must be positive.'
      );
    }

    const key = `${igdbGameId}::${String(platformIgdbId)}`;

    if (existingKeys.has(key)) {
      return this.errorRow(
        type,
        rowNumber,
        'Duplicate game already exists in your library. Remove this row.'
      );
    }

    if (pendingKeys.has(key)) {
      return this.errorRow(
        type,
        rowNumber,
        'Duplicate game also exists in this import file. Remove one row.'
      );
    }

    pendingKeys.add(key);

    const platform = record.platform.trim();

    if (platform.length === 0) {
      return this.errorRow(type, rowNumber, 'Platform is required for imported games.');
    }
    const customTitle = parseOptionalText(record.customTitle);
    const customPlatformName = parseOptionalText(record.customPlatform);
    const customPlatformIgdbId = parsePositiveInteger(record.customPlatformIgdbId);
    const customCoverUrl = parseOptionalDataImage(record.customCoverUrl);
    const hasCustomPlatformName = customPlatformName !== null;
    const hasCustomPlatformId = customPlatformIgdbId !== null;

    if (hasCustomPlatformName !== hasCustomPlatformId) {
      return this.errorRow(
        type,
        rowNumber,
        'Custom platform must include both name and IGDB platform id.'
      );
    }

    if (record.customCoverUrl.trim().length > 0 && customCoverUrl === null) {
      return this.errorRow(type, rowNumber, 'Custom cover image must be a data URL.');
    }

    const customPlatform =
      hasCustomPlatformName && hasCustomPlatformId
        ? { name: customPlatformName, igdbId: customPlatformIgdbId }
        : null;

    const status = normalizeStatus(record.status);

    if (record.status.trim().length > 0 && status === null) {
      return this.errorRow(type, rowNumber, 'Invalid status value.');
    }

    const rating = normalizeRating(record.rating);

    if (record.rating.trim().length > 0 && rating === null) {
      return this.errorRow(type, rowNumber, 'Rating must be none or an integer between 1 and 5.');
    }

    const gameType = parseOptionalGameType(record.gameType);

    if (record.gameType.trim().length > 0 && gameType === null) {
      return this.errorRow(type, rowNumber, 'Invalid gameType value.');
    }

    const catalog: GameCatalogResult = {
      igdbGameId,
      title: record.title.trim() || 'Unknown title',
      summary: parseOptionalText(record.summary),
      storyline: parseOptionalText(record.storyline),
      coverUrl: record.coverUrl.trim() || null,
      coverSource: normalizeCoverSource(record.coverSource),
      gameType,
      hltbMainHours: parseOptionalDecimal(record.hltbMainHours),
      hltbMainExtraHours: parseOptionalDecimal(record.hltbMainExtraHours),
      hltbCompletionistHours: parseOptionalDecimal(record.hltbCompletionistHours),
      similarGameIgdbIds: parseGameIdArray(record.similarGameIgdbIds),
      collections: parseStringArray(record.collections),
      developers: parseStringArray(record.developers),
      franchises: parseStringArray(record.franchises),
      genres: parseStringArray(record.genres),
      publishers: parseStringArray(record.publishers),
      platforms: [platform],
      platformOptions: [{ id: platformIgdbId, name: platform }],
      platform,
      platformIgdbId,
      releaseDate: record.releaseDate.trim().length > 0 ? record.releaseDate.trim() : null,
      releaseYear: parseOptionalNumber(record.releaseYear)
    };

    const tagNames = parseStringArray(record.tags);
    const tagIds = parsePositiveIntegerArray(record.gameTagIds);
    const notes = this.normalizeImportedNotes(record.notes);

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
        notes,
        status,
        rating,
        customTitle,
        customPlatform,
        customCoverUrl,
        tagNames,
        tagIds
      }
    };
  }

  private errorRow(type: ExportRowType, rowNumber: number, error: string): ImportPreviewRow {
    return {
      id: rowNumber,
      rowNumber,
      type,
      summary: `${type.toUpperCase()} row ${String(rowNumber)}`,
      error,
      warning: null,
      parsed: null
    };
  }

  private buildDuplicateNameWarning(
    name: string,
    existingNames: Set<string>,
    pendingNames: Set<string>,
    entityLabel: 'tag' | 'view'
  ): string | null {
    const trimmed = name.trim();

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
      type: getValue('type') as ExportRowType,
      listType: getValue('listType'),
      igdbGameId: getValue('igdbGameId'),
      platformIgdbId: getValue('platformIgdbId'),
      title: getValue('title'),
      customTitle: getValue('customTitle'),
      summary: getValue('summary'),
      storyline: getValue('storyline'),
      notes: getValue('notes'),
      coverUrl: getValue('coverUrl'),
      customCoverUrl: getValue('customCoverUrl'),
      coverSource: getValue('coverSource'),
      gameType: getValue('gameType'),
      platform: getValue('platform'),
      customPlatform: getValue('customPlatform'),
      customPlatformIgdbId: getValue('customPlatformIgdbId'),
      collections: getValue('collections'),
      releaseDate: getValue('releaseDate'),
      releaseYear: getValue('releaseYear'),
      hltbMainHours: getValue('hltbMainHours'),
      hltbMainExtraHours: getValue('hltbMainExtraHours'),
      hltbCompletionistHours: getValue('hltbCompletionistHours'),
      similarGameIgdbIds: getValue('similarGameIgdbIds'),
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
      updatedAt: getValue('updatedAt')
    };
  }

  private normalizeImportedNotes(value: string): string | null {
    return normalizeNotesValueOrNull(value);
  }

  private readExportableSettings(): Array<[string, string]> {
    const entries: Array<[string, string]> = [];

    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);

        if (!key || !key.startsWith('game-shelf') || key === LEGACY_PRIMARY_COLOR_STORAGE_KEY) {
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

    const colorSchemeKey = COLOR_SCHEME_STORAGE_KEY;

    if (!entries.some(([key]) => key === colorSchemeKey)) {
      entries.push([colorSchemeKey, this.themeService.getColorSchemePreference()]);
    }

    return entries;
  }

  private applyImportedSettings(rows: ParsedSettingImportRow[]): void {
    rows.forEach((row) => {
      if (row.key === LEGACY_PRIMARY_COLOR_STORAGE_KEY) {
        try {
          localStorage.removeItem(LEGACY_PRIMARY_COLOR_STORAGE_KEY);
        } catch {
          // Ignore storage write failures.
        }
        return;
      }

      try {
        localStorage.setItem(row.key, row.value);
      } catch {
        // Ignore storage write failures.
      }

      if (
        row.key === COLOR_SCHEME_STORAGE_KEY &&
        (row.value === 'system' || row.value === 'light' || row.value === 'dark')
      ) {
        this.selectedColorScheme = row.value;
        this.themeService.setColorSchemePreference(row.value);
      }

      if (row.key === PLATFORM_ORDER_STORAGE_KEY) {
        this.platformOrderService.refreshFromStorage();
        this.queueSettingUpsert(row.key, row.value);
      }

      if (row.key === PLATFORM_DISPLAY_NAMES_STORAGE_KEY) {
        this.platformCustomizationService.refreshFromStorage();
        this.queueSettingUpsert(row.key, row.value);
      }
    });
  }

  private persistPlatformDisplayNames(): void {
    const next: Record<string, string> = {};

    this.platformOrderItems.forEach((platform) => {
      const platformId =
        typeof platform.id === 'number' && Number.isInteger(platform.id) && platform.id > 0
          ? platform.id
          : null;
      const customName = platform.customName.trim();

      if (platformId !== null && customName.length > 0) {
        next[String(platformId)] = customName;
      }
    });

    this.platformCustomizationService.setDisplayNames(next);

    if (Object.keys(next).length === 0) {
      this.queueSettingDelete(PLATFORM_DISPLAY_NAMES_STORAGE_KEY);
      return;
    }

    this.queueSettingUpsert(PLATFORM_DISPLAY_NAMES_STORAGE_KEY, JSON.stringify(next));
  }

  private async buildPlatformCustomizationItems(): Promise<PlatformCustomizationItem[]> {
    const platforms = await firstValueFrom(this.gameShelfService.listSearchPlatforms());
    const displayNames = this.platformCustomizationService.getDisplayNames();

    return platforms.map((platform) => {
      const key = typeof platform.id === 'number' && platform.id > 0 ? String(platform.id) : null;
      const customName = key ? (displayNames[key] ?? '') : '';
      return {
        ...platform,
        customName
      };
    });
  }

  private queueSettingUpsert(key: string, value: string): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'upsert',
      payload: { key, value }
    });
  }

  private queueSettingDelete(key: string): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'setting',
      operation: 'delete',
      payload: { key }
    });
  }

  private async buildTagNameToIdMap(): Promise<Map<string, number>> {
    const tags = await this.repository.listTags();
    const map = new Map<string, number>();

    tags.forEach((tag) => {
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

    return [...new Set(tagIds.filter((value) => Number.isInteger(value) && value > 0))];
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
      const candidate = `${baseName} (${String(suffix)})`;
      const candidateLower = candidate.toLowerCase();
      if (!usedNamesLowercase.has(candidateLower)) {
        usedNamesLowercase.add(candidateLower);
        return candidate;
      }
      suffix += 1;
    }

    const fallback = `${baseName} (${String(Date.now())})`;
    usedNamesLowercase.add(fallback.toLowerCase());
    return fallback;
  }

  private async presentShareFile(params: {
    content: string;
    filename: string;
    mimeType: string;
  }): Promise<void> {
    const blob = new Blob([params.content], { type: params.mimeType });

    const webNavigator = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
      canShare?: (data: { files?: File[] }) => boolean;
    };

    if (typeof webNavigator.share === 'function') {
      const file = this.tryCreateFile(blob, params.filename, params.mimeType);

      if (file) {
        const canShareFiles =
          typeof webNavigator.canShare !== 'function' || webNavigator.canShare({ files: [file] });

        if (canShareFiles) {
          try {
            await webNavigator.share({
              files: [file]
            });
            return;
          } catch (error: unknown) {
            if (this.isShareCancelError(error)) {
              return;
            }
          }
        }
      }
    }

    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = params.filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private tryCreateFile(blob: Blob, filename: string, mimeType: string): File | null {
    try {
      if (typeof File !== 'function') {
        return null;
      }

      return new File([blob], filename, { type: mimeType });
    } catch {
      return null;
    }
  }

  private isShareCancelError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }

    const message = error instanceof Error ? error.message : '';
    return /abort|cancel/i.test(message);
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'danger' | 'warning' = 'primary'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1800,
      position: 'bottom',
      color
    });

    await toast.present();
  }
}
