import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  LoadingController,
  ToastController
} from '@ionic/angular/standalone';
import { BehaviorSubject, combineLatest, firstValueFrom, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { addIcons } from 'ionicons';
import { search } from 'ionicons/icons';
import {
  GameEntry,
  HltbMatchCandidate,
  ListType,
  PriceMatchCandidate,
  ReviewMatchCandidate
} from '../core/models/game.models';
import { GameShelfService } from '../core/services/game-shelf.service';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { formatRateLimitedUiError, isRateLimitedMessage } from '../core/utils/rate-limit-ui-error';
import { DebugLogService } from '../core/services/debug-log.service';
import { runBulkActionWithRetry } from '../features/game-list/game-list-bulk-actions';

type MissingMetadataFilter = 'hltb' | 'metacritic' | 'pricing' | 'nonPcTheGamesDbImage';

@Component({
  selector: 'app-metadata-validator',
  templateUrl: './metadata-validator.page.html',
  styleUrls: ['./metadata-validator.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonBadge,
    IonButton,
    IonButtons,
    IonCheckbox,
    IonContent,
    IonFooter,
    IonHeader,
    IonIcon,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonModal,
    IonNote,
    IonSearchbar,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar
  ]
})
export class MetadataValidatorPage {
  private static readonly BULK_HLTB_CONCURRENCY = 2;
  private static readonly BULK_HLTB_INTER_ITEM_DELAY_MS = 125;
  private static readonly BULK_HLTB_ITEM_TIMEOUT_MS = 30000;
  private static readonly BULK_HLTB_MAX_ATTEMPTS = 3;
  private static readonly BULK_HLTB_RETRY_BASE_DELAY_MS = 1000;
  private static readonly BULK_HLTB_RATE_LIMIT_COOLDOWN_MS = 15000;
  private static readonly BULK_METACRITIC_CONCURRENCY = 2;
  private static readonly BULK_METACRITIC_INTER_ITEM_DELAY_MS = 125;
  private static readonly BULK_METACRITIC_ITEM_TIMEOUT_MS = 30000;
  private static readonly BULK_METACRITIC_MAX_ATTEMPTS = 3;
  private static readonly BULK_METACRITIC_RETRY_BASE_DELAY_MS = 1000;
  private static readonly BULK_METACRITIC_RATE_LIMIT_COOLDOWN_MS = 15000;
  private static readonly BASE_MISSING_FILTER_OPTIONS: Array<{
    value: MissingMetadataFilter;
    label: string;
  }> = [
    { value: 'hltb', label: 'Missing HLTB' },
    { value: 'metacritic', label: 'Missing Review' },
    { value: 'pricing', label: 'Missing Pricing (supported platforms)' },
    { value: 'nonPcTheGamesDbImage', label: 'Missing TheGamesDB image' }
  ];

  selectedListType: ListType | null = null;
  selectedMissingFilters: MissingMetadataFilter[] = [];
  selectedGameKeys = new Set<string>();
  isBulkRefreshingHltb = false;
  isBulkRefreshingReview = false;
  isBulkRefreshingPricing = false;
  isBulkRefreshingImage = false;
  isHltbPickerModalOpen = false;
  isHltbPickerLoading = false;
  hltbPickerQuery = '';
  hltbPickerResults: HltbMatchCandidate[] = [];
  hltbPickerError: string | null = null;
  hltbPickerTargetGame: GameEntry | null = null;
  isReviewPickerModalOpen = false;
  isReviewPickerLoading = false;
  reviewPickerQuery = '';
  reviewPickerResults: ReviewMatchCandidate[] = [];
  reviewPickerError: string | null = null;
  reviewPickerTargetGame: GameEntry | null = null;
  isPricingPickerModalOpen = false;
  isPricingPickerLoading = false;
  pricingPickerQuery = '';
  pricingPickerResults: PriceMatchCandidate[] = [];
  pricingPickerError: string | null = null;
  pricingPickerTargetGame: GameEntry | null = null;
  private displayedGames: GameEntry[] = [];
  private readonly selectedListType$ = new BehaviorSubject<ListType | null>(null);
  private readonly selectedMissingFilters$ = new BehaviorSubject<MissingMetadataFilter[]>([]);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly toastController = inject(ToastController);
  private readonly loadingController = inject(LoadingController);
  private readonly router = inject(Router);
  private readonly debugLogService = inject(DebugLogService);

  constructor() {
    addIcons({ search });
  }

  readonly filteredGames$ = combineLatest([
    this.selectedListType$.pipe(
      switchMap((listType) => (listType ? this.gameShelfService.watchList(listType) : of([])))
    ),
    this.selectedMissingFilters$
  ]).pipe(
    map(([games, filters]) => this.applyMissingMetadataFilters(games, filters)),
    tap((games) => {
      this.displayedGames = games;
      this.syncSelectionToDisplayedGames();
    })
  );

  get isBulkRefreshingMetacritic(): boolean {
    return this.isBulkRefreshingReview;
  }

  set isBulkRefreshingMetacritic(value: boolean) {
    this.isBulkRefreshingReview = value;
  }

  get isMetacriticPickerModalOpen(): boolean {
    return this.isReviewPickerModalOpen;
  }

  set isMetacriticPickerModalOpen(value: boolean) {
    this.isReviewPickerModalOpen = value;
  }

  get isMetacriticPickerLoading(): boolean {
    return this.isReviewPickerLoading;
  }

  set isMetacriticPickerLoading(value: boolean) {
    this.isReviewPickerLoading = value;
  }

  get metacriticPickerQuery(): string {
    return this.reviewPickerQuery;
  }

  set metacriticPickerQuery(value: string) {
    this.reviewPickerQuery = value;
  }

  get metacriticPickerResults(): ReviewMatchCandidate[] {
    return this.reviewPickerResults;
  }

  set metacriticPickerResults(value: ReviewMatchCandidate[]) {
    this.reviewPickerResults = value;
  }

  get metacriticPickerError(): string | null {
    return this.reviewPickerError;
  }

  set metacriticPickerError(value: string | null) {
    this.reviewPickerError = value;
  }

  get metacriticPickerTargetGame(): GameEntry | null {
    return this.reviewPickerTargetGame;
  }

  set metacriticPickerTargetGame(value: GameEntry | null) {
    this.reviewPickerTargetGame = value;
  }

  get missingFilterOptions(): Array<{ value: MissingMetadataFilter; label: string }> {
    if (this.selectedListType !== 'wishlist') {
      return MetadataValidatorPage.BASE_MISSING_FILTER_OPTIONS.filter(
        (option) => option.value !== 'pricing'
      );
    }

    return MetadataValidatorPage.BASE_MISSING_FILTER_OPTIONS;
  }

  onListTypeChange(value: string | null | undefined): void {
    const next = value === 'collection' || value === 'wishlist' ? value : null;
    this.selectedListType = next;
    this.selectedListType$.next(next);
    this.selectedMissingFilters = this.normalizeMissingFilters(this.selectedMissingFilters);
    this.selectedMissingFilters$.next(this.selectedMissingFilters);
    this.selectedGameKeys.clear();
  }

  onMissingFiltersChange(value: string[] | string | null | undefined): void {
    const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    this.selectedMissingFilters = this.normalizeMissingFilters(raw);
    this.selectedMissingFilters$.next(this.selectedMissingFilters);
  }

  trackByGameKey(_: number, game: GameEntry): string {
    return `${game.igdbGameId}::${String(game.platformIgdbId)}`;
  }

  getDisplayedGamesLabel(): string {
    return this.displayedGames.length === 1
      ? '1 game'
      : `${String(this.displayedGames.length)} games`;
  }

  getPlatformLabel(game: GameEntry): string {
    const label = this.platformCustomizationService
      .getDisplayNameWithoutAlias(game.platform, game.platformIgdbId)
      .trim();
    return label.length > 0 ? label : 'Unknown platform';
  }

  isGameSelected(game: GameEntry): boolean {
    return this.selectedGameKeys.has(this.getGameKey(game));
  }

  get selectedGamesCount(): number {
    return this.selectedGameKeys.size;
  }

  isAllDisplayedSelected(): boolean {
    return (
      this.displayedGames.length > 0 && this.selectedGameKeys.size === this.displayedGames.length
    );
  }

  toggleSelectAllDisplayed(): void {
    if (this.displayedGames.length === 0) {
      return;
    }

    if (this.isAllDisplayedSelected()) {
      this.selectedGameKeys.clear();
      return;
    }

    this.selectedGameKeys = new Set(this.displayedGames.map((game) => this.getGameKey(game)));
  }

  toggleGameSelection(game: GameEntry): void {
    const key = this.getGameKey(game);

    if (this.selectedGameKeys.has(key)) {
      this.selectedGameKeys.delete(key);
      return;
    }

    this.selectedGameKeys.add(key);
  }

  clearSelection(): void {
    this.selectedGameKeys.clear();
  }

  hasHltbMetadata(game: GameEntry): boolean {
    return (
      this.toPositiveNumber(game.hltbMainHours) !== null ||
      this.toPositiveNumber(game.hltbMainExtraHours) !== null ||
      this.toPositiveNumber(game.hltbCompletionistHours) !== null
    );
  }

  hasReviewMetadata(game: GameEntry): boolean {
    return this.toReviewScore(game.reviewScore ?? game.metacriticScore) !== null;
  }

  hasMetacriticMetadata(game: GameEntry): boolean {
    return this.hasReviewMetadata(game);
  }

  hasPricingMetadata(game: GameEntry): boolean {
    return this.gameShelfService.hasUnifiedPriceData(game);
  }

  isPricingSupported(game: GameEntry): boolean {
    return (
      game.listType === 'wishlist' &&
      this.gameShelfService.isPricingSupportedPlatform(game.platformIgdbId)
    );
  }

  isNonPcTheGamesDbImagePresent(game: GameEntry): boolean {
    if (this.isPcPlatform(game)) {
      return false;
    }

    return (
      game.coverSource === 'thegamesdb' &&
      typeof game.coverUrl === 'string' &&
      game.coverUrl.trim().length > 0
    );
  }

  isNonPcImageNotApplicable(game: GameEntry): boolean {
    return this.isPcPlatform(game);
  }

  isReviewSupported(_game: GameEntry): boolean {
    return true;
  }

  isMetacriticSupported(game: GameEntry): boolean {
    return this.isReviewSupported(game);
  }

  async refreshHltbForGame(game: GameEntry): Promise<void> {
    await this.openHltbPickerModal(game);
  }

  async refreshReviewForGame(game: GameEntry): Promise<void> {
    await this.openMetacriticPickerModal(game);
  }

  async refreshMetacriticForGame(game: GameEntry): Promise<void> {
    await this.refreshReviewForGame(game);
  }

  async refreshImageForGame(game: GameEntry): Promise<void> {
    if (this.isPcPlatform(game)) {
      await this.presentToast('Image validation is not required for PC games.', 'warning');
      return;
    }

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(
          game.title,
          game.platform,
          game.platformIgdbId,
          game.igdbGameId
        )
      );
      const coverUrl = candidates[0];

      if (!coverUrl) {
        await this.presentToast(`No TheGamesDB image found for ${game.title}.`, 'warning');
        return;
      }

      await this.gameShelfService.updateGameCover(
        game.igdbGameId,
        game.platformIgdbId,
        coverUrl,
        'thegamesdb'
      );
      await this.presentToast(`Updated image for ${game.title}.`);
    } catch {
      await this.presentToast(`Unable to update image for ${game.title}.`, 'danger');
    }
  }

  async refreshPricingForGame(game: GameEntry): Promise<void> {
    if (!this.isPricingSupported(game)) {
      await this.presentToast('Pricing is not supported for this platform.', 'warning');
      return;
    }

    if (this.isPsPricesPlatform(game)) {
      await this.openPricingPickerModal(game);
      return;
    }

    try {
      await this.gameShelfService.refreshGamePricing(game.igdbGameId, game.platformIgdbId);
      await this.presentToast(`Updated pricing for ${game.title}.`);
    } catch {
      await this.presentToast(`Unable to update pricing for ${game.title}.`, 'danger');
    }
  }

  async refreshHltbForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames();
    this.debugLogService.trace('metadata_validator.bulk_hltb.start', {
      selectedCount: games.length,
      selectedGameKeys: games.map((game) => this.getGameKey(game))
    });

    if (games.length === 0 || this.isBulkRefreshingHltb) {
      this.debugLogService.trace('metadata_validator.bulk_hltb.skipped', {
        selectedCount: games.length,
        isBulkRefreshingHltb: this.isBulkRefreshingHltb
      });
      return;
    }

    this.isBulkRefreshingHltb = true;

    try {
      const results = await runBulkActionWithRetry({
        loadingController: this.loadingController,
        games,
        options: {
          loadingPrefix: 'Updating HLTB data',
          concurrency: MetadataValidatorPage.BULK_HLTB_CONCURRENCY,
          interItemDelayMs: MetadataValidatorPage.BULK_HLTB_INTER_ITEM_DELAY_MS,
          itemTimeoutMs: MetadataValidatorPage.BULK_HLTB_ITEM_TIMEOUT_MS
        },
        retryConfig: {
          maxAttempts: MetadataValidatorPage.BULK_HLTB_MAX_ATTEMPTS,
          retryBaseDelayMs: MetadataValidatorPage.BULK_HLTB_RETRY_BASE_DELAY_MS,
          rateLimitFallbackCooldownMs: MetadataValidatorPage.BULK_HLTB_RATE_LIMIT_COOLDOWN_MS
        },
        action: (game) => this.refreshHltbForBulkGame(game),
        delay: (ms: number) => this.delay(ms)
      });
      const failedCount = results.filter((result) => !result.ok).length;
      const succeededCount = results.length - failedCount;
      const matchedCount = results.filter(
        (result) => result.ok && result.value && this.hasHltbMetadata(result.value)
      ).length;
      this.debugLogService.trace('metadata_validator.bulk_hltb.complete', {
        selectedCount: results.length,
        succeededCount,
        matchedCount,
        failedCount
      });

      if (matchedCount === 0 && failedCount === 0) {
        await this.presentToast('No HLTB matches found for selected games.', 'warning');
      } else if (succeededCount > 0) {
        await this.presentToast(
          `Updated HLTB for ${String(succeededCount)} game${succeededCount === 1 ? '' : 's'}.`
        );
      }

      if (failedCount > 0) {
        await this.presentToast(
          `Unable to update HLTB for ${String(failedCount)} selected game${failedCount === 1 ? '' : 's'}.`,
          'danger'
        );
      }
    } finally {
      this.isBulkRefreshingHltb = false;
    }
  }

  async refreshReviewForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames();

    if (games.length === 0 || this.isBulkRefreshingReview) {
      return;
    }

    this.isBulkRefreshingReview = true;

    try {
      const results = await runBulkActionWithRetry({
        loadingController: this.loadingController,
        games,
        options: {
          loadingPrefix: 'Updating review data',
          concurrency: MetadataValidatorPage.BULK_METACRITIC_CONCURRENCY,
          interItemDelayMs: MetadataValidatorPage.BULK_METACRITIC_INTER_ITEM_DELAY_MS,
          itemTimeoutMs: MetadataValidatorPage.BULK_METACRITIC_ITEM_TIMEOUT_MS
        },
        retryConfig: {
          maxAttempts: MetadataValidatorPage.BULK_METACRITIC_MAX_ATTEMPTS,
          retryBaseDelayMs: MetadataValidatorPage.BULK_METACRITIC_RETRY_BASE_DELAY_MS,
          rateLimitFallbackCooldownMs: MetadataValidatorPage.BULK_METACRITIC_RATE_LIMIT_COOLDOWN_MS
        },
        action: (game) => this.refreshReviewForBulkGame(game),
        delay: (ms: number) => this.delay(ms)
      });
      const failedCount = results.filter((result) => !result.ok).length;
      const succeededCount = results.length - failedCount;
      const matchedCount = results.filter(
        (result) => result.ok && result.value && this.hasReviewMetadata(result.value)
      ).length;

      if (matchedCount === 0 && failedCount === 0) {
        await this.presentToast('No review matches found for selected games.', 'warning');
      } else if (succeededCount > 0) {
        await this.presentToast(
          `Updated review for ${String(succeededCount)} game${succeededCount === 1 ? '' : 's'}.`
        );
      }

      if (failedCount > 0) {
        await this.presentToast(
          `Unable to update review for ${String(failedCount)} selected game${failedCount === 1 ? '' : 's'}.`,
          'danger'
        );
      }
    } finally {
      this.isBulkRefreshingReview = false;
    }
  }

  async refreshMetacriticForSelectedGames(): Promise<void> {
    await this.refreshReviewForSelectedGames();
  }

  async refreshPricingForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames().filter((game) => this.isPricingSupported(game));

    if (games.length === 0 || this.isBulkRefreshingPricing) {
      return;
    }

    this.isBulkRefreshingPricing = true;

    try {
      const results = await runBulkActionWithRetry({
        loadingController: this.loadingController,
        games,
        options: {
          loadingPrefix: 'Updating pricing',
          concurrency: MetadataValidatorPage.BULK_METACRITIC_CONCURRENCY,
          interItemDelayMs: 0,
          itemTimeoutMs: MetadataValidatorPage.BULK_METACRITIC_ITEM_TIMEOUT_MS
        },
        retryConfig: {
          maxAttempts: MetadataValidatorPage.BULK_METACRITIC_MAX_ATTEMPTS,
          retryBaseDelayMs: MetadataValidatorPage.BULK_METACRITIC_RETRY_BASE_DELAY_MS,
          rateLimitFallbackCooldownMs: MetadataValidatorPage.BULK_METACRITIC_RATE_LIMIT_COOLDOWN_MS
        },
        action: (game) => this.refreshPricingForBulkGame(game),
        delay: (ms: number) => this.delay(ms)
      });
      const failedCount = results.filter((result) => !result.ok).length;
      const updatedCount = results.filter((result) => result.ok).length;

      if (updatedCount > 0) {
        await this.presentToast(
          `Updated pricing for ${String(updatedCount)} game${updatedCount === 1 ? '' : 's'}.`
        );
      }

      if (failedCount > 0) {
        await this.presentToast(
          `Unable to update pricing for ${String(failedCount)} selected game${failedCount === 1 ? '' : 's'}.`,
          'danger'
        );
      }
    } finally {
      this.isBulkRefreshingPricing = false;
    }
  }

  async refreshImageForSelectedGames(): Promise<void> {
    const games = this.getSelectedGames().filter((game) => !this.isPcPlatform(game));

    if (games.length === 0 || this.isBulkRefreshingImage) {
      return;
    }

    this.isBulkRefreshingImage = true;

    try {
      let updatedCount = 0;

      for (const game of games) {
        const candidates = await firstValueFrom(
          this.gameShelfService.searchBoxArtByTitle(
            game.title,
            game.platform,
            game.platformIgdbId,
            game.igdbGameId
          )
        );
        const coverUrl = candidates[0];

        if (!coverUrl) {
          continue;
        }

        await this.gameShelfService.updateGameCover(
          game.igdbGameId,
          game.platformIgdbId,
          coverUrl,
          'thegamesdb'
        );
        updatedCount += 1;
      }

      if (updatedCount === 0) {
        await this.presentToast('No TheGamesDB image updates were available.', 'warning');
        return;
      }

      await this.presentToast(
        `Updated images for ${String(updatedCount)} game${updatedCount === 1 ? '' : 's'}.`
      );
    } catch {
      await this.presentToast('Unable to update images for selected games.', 'danger');
    } finally {
      this.isBulkRefreshingImage = false;
    }
  }

  goToSettings(): void {
    void this.router.navigateByUrl('/settings');
  }

  closeHltbPickerModal(): void {
    this.isHltbPickerModalOpen = false;
    this.isHltbPickerLoading = false;
    this.hltbPickerQuery = '';
    this.hltbPickerResults = [];
    this.hltbPickerError = null;
    this.hltbPickerTargetGame = null;
  }

  closeReviewPickerModal(): void {
    this.isReviewPickerModalOpen = false;
    this.isReviewPickerLoading = false;
    this.reviewPickerQuery = '';
    this.reviewPickerResults = [];
    this.reviewPickerError = null;
    this.reviewPickerTargetGame = null;
  }

  closeMetacriticPickerModal(): void {
    this.closeReviewPickerModal();
  }

  closePricingPickerModal(): void {
    this.isPricingPickerModalOpen = false;
    this.isPricingPickerLoading = false;
    this.pricingPickerQuery = '';
    this.pricingPickerResults = [];
    this.pricingPickerError = null;
    this.pricingPickerTargetGame = null;
  }

  onHltbPickerQueryChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: string | null }>;
    this.hltbPickerQuery = customEvent.detail.value ?? '';
  }

  onReviewPickerQueryChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: string | null }>;
    this.reviewPickerQuery = customEvent.detail.value ?? '';
  }

  onMetacriticPickerQueryChange(event: Event): void {
    this.onReviewPickerQueryChange(event);
  }

  onPricingPickerQueryChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: string | null }>;
    this.pricingPickerQuery = customEvent.detail.value ?? '';
  }

  async runHltbPickerSearch(): Promise<void> {
    const normalized = this.hltbPickerQuery.trim();

    if (normalized.length < 2) {
      this.hltbPickerResults = [];
      this.hltbPickerError = 'Enter at least 2 characters.';
      return;
    }

    this.isHltbPickerLoading = true;
    this.hltbPickerError = null;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchHltbCandidates(normalized, null, null)
      );
      this.hltbPickerResults = this.dedupeHltbCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.hltbPickerResults = [];
      this.hltbPickerError = formatRateLimitedUiError(error, 'Unable to search HLTB right now.');
    } finally {
      this.isHltbPickerLoading = false;
    }
  }

  async applySelectedHltbCandidate(candidate: HltbMatchCandidate): Promise<void> {
    const target = this.hltbPickerTargetGame;

    if (!target) {
      return;
    }

    this.isHltbPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGameCompletionTimesWithQuery(
        target.igdbGameId,
        target.platformIgdbId,
        {
          title: candidate.title,
          releaseYear: candidate.releaseYear,
          platform: candidate.platform
        }
      );
      this.closeHltbPickerModal();
      if (this.hasHltbMetadata(updated)) {
        await this.presentToast(`Updated HLTB for ${target.title}.`);
      } else {
        await this.presentToast(`No HLTB match found for ${target.title}.`, 'warning');
      }
    } catch {
      this.isHltbPickerLoading = false;
      await this.presentToast(`Unable to update HLTB for ${target.title}.`, 'danger');
    }
  }

  async useOriginalHltbLookup(): Promise<void> {
    const target = this.hltbPickerTargetGame;

    if (!target) {
      return;
    }

    this.isHltbPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGameCompletionTimes(
        target.igdbGameId,
        target.platformIgdbId
      );
      this.closeHltbPickerModal();
      if (this.hasHltbMetadata(updated)) {
        await this.presentToast(`Updated HLTB for ${target.title}.`);
      } else {
        await this.presentToast(`No HLTB match found for ${target.title}.`, 'warning');
      }
    } catch {
      this.isHltbPickerLoading = false;
      await this.presentToast(`Unable to update HLTB for ${target.title}.`, 'danger');
    }
  }

  async runReviewPickerSearch(): Promise<void> {
    const normalized = this.reviewPickerQuery.trim();
    const target = this.reviewPickerTargetGame;

    if (normalized.length < 2) {
      this.reviewPickerResults = [];
      this.reviewPickerError = 'Enter at least 2 characters.';
      return;
    }

    this.isReviewPickerLoading = true;
    this.reviewPickerError = null;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchReviewCandidates(
          normalized,
          target?.releaseYear ?? null,
          target?.platform ?? null,
          target?.platformIgdbId ?? null
        )
      );
      this.reviewPickerResults = this.dedupeReviewCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.reviewPickerResults = [];
      this.reviewPickerError = formatRateLimitedUiError(
        error,
        'Unable to search reviews right now.'
      );
    } finally {
      this.isReviewPickerLoading = false;
    }
  }

  async runMetacriticPickerSearch(): Promise<void> {
    await this.runReviewPickerSearch();
  }

  async runPricingPickerSearch(): Promise<void> {
    const normalized = this.pricingPickerQuery.trim();
    const target = this.pricingPickerTargetGame;

    if (!target) {
      this.pricingPickerResults = [];
      this.pricingPickerError = 'Select a game first.';
      return;
    }

    if (normalized.length < 2) {
      this.pricingPickerResults = [];
      this.pricingPickerError = 'Enter at least 2 characters.';
      return;
    }

    this.isPricingPickerLoading = true;
    this.pricingPickerError = null;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchPricingCandidates(
          target.igdbGameId,
          target.platformIgdbId,
          normalized
        )
      );
      this.pricingPickerResults = this.dedupePricingCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.pricingPickerResults = [];
      this.pricingPickerError = formatRateLimitedUiError(
        error,
        'Unable to search pricing right now.'
      );
    } finally {
      this.isPricingPickerLoading = false;
    }
  }

  async applySelectedReviewCandidate(candidate: ReviewMatchCandidate): Promise<void> {
    const target = this.reviewPickerTargetGame;

    if (!target) {
      return;
    }

    this.isReviewPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGameMetacriticScoreWithQuery(
        target.igdbGameId,
        target.platformIgdbId,
        {
          title: candidate.title,
          releaseYear: candidate.releaseYear,
          platform: candidate.platform,
          platformIgdbId: target.platformIgdbId,
          mobygamesGameId: candidate.mobygamesGameId ?? null
        }
      );
      this.closeReviewPickerModal();
      if (this.hasReviewMetadata(updated)) {
        await this.presentToast(`Updated review for ${target.title}.`);
      } else {
        await this.presentToast(`No review match found for ${target.title}.`, 'warning');
      }
    } catch (error: unknown) {
      this.isReviewPickerLoading = false;
      const fallbackMessage = `Unable to update review for ${target.title}.`;
      const message = formatRateLimitedUiError(error, fallbackMessage);
      const isRateLimited = message !== fallbackMessage;
      await this.presentToast(message, isRateLimited ? 'warning' : 'danger');
    }
  }

  async applySelectedMetacriticCandidate(candidate: ReviewMatchCandidate): Promise<void> {
    await this.applySelectedReviewCandidate(candidate);
  }

  async useOriginalReviewLookup(): Promise<void> {
    const target = this.reviewPickerTargetGame;

    if (!target) {
      return;
    }

    this.isReviewPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGameMetacriticScore(
        target.igdbGameId,
        target.platformIgdbId
      );
      this.closeReviewPickerModal();
      if (this.hasReviewMetadata(updated)) {
        await this.presentToast(`Updated review for ${target.title}.`);
      } else {
        await this.presentToast(`No review match found for ${target.title}.`, 'warning');
      }
    } catch (error: unknown) {
      this.isReviewPickerLoading = false;
      const fallbackMessage = `Unable to update review for ${target.title}.`;
      const message = formatRateLimitedUiError(error, fallbackMessage);
      const isRateLimited = message !== fallbackMessage;
      await this.presentToast(message, isRateLimited ? 'warning' : 'danger');
    }
  }

  async useOriginalMetacriticLookup(): Promise<void> {
    await this.useOriginalReviewLookup();
  }

  async applySelectedPricingCandidate(candidate: PriceMatchCandidate): Promise<void> {
    const target = this.pricingPickerTargetGame;

    if (!target) {
      return;
    }

    this.isPricingPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGamePricingWithQuery(
        target.igdbGameId,
        target.platformIgdbId,
        { title: candidate.title }
      );
      this.closePricingPickerModal();
      if (this.hasPricingMetadata(updated)) {
        await this.presentToast(`Updated pricing for ${target.title}.`);
      } else {
        await this.presentToast(`No pricing match found for ${target.title}.`, 'warning');
      }
    } catch (error: unknown) {
      this.isPricingPickerLoading = false;
      const fallbackMessage = `Unable to update pricing for ${target.title}.`;
      const message = formatRateLimitedUiError(error, fallbackMessage);
      const isRateLimited = message !== fallbackMessage;
      await this.presentToast(message, isRateLimited ? 'warning' : 'danger');
    }
  }

  async useOriginalPricingLookup(): Promise<void> {
    const target = this.pricingPickerTargetGame;

    if (!target) {
      return;
    }

    this.isPricingPickerLoading = true;

    try {
      const updated = await this.gameShelfService.refreshGamePricing(
        target.igdbGameId,
        target.platformIgdbId
      );
      this.closePricingPickerModal();
      if (this.hasPricingMetadata(updated)) {
        await this.presentToast(`Updated pricing for ${target.title}.`);
      } else {
        await this.presentToast(`No pricing match found for ${target.title}.`, 'warning');
      }
    } catch (error: unknown) {
      this.isPricingPickerLoading = false;
      const fallbackMessage = `Unable to update pricing for ${target.title}.`;
      const message = formatRateLimitedUiError(error, fallbackMessage);
      const isRateLimited = message !== fallbackMessage;
      await this.presentToast(message, isRateLimited ? 'warning' : 'danger');
    }
  }

  private applyMissingMetadataFilters(
    games: GameEntry[],
    filters: MissingMetadataFilter[]
  ): GameEntry[] {
    if (filters.length === 0) {
      return [];
    }

    return games.filter((game) => {
      const missingHltb = !this.hasHltbMetadata(game);
      const missingMetacritic = !this.hasReviewMetadata(game);
      const missingPricing = this.isPricingSupported(game) && !this.hasPricingMetadata(game);
      const missingImage = this.isMissingNonPcTheGamesDbImage(game);

      return (
        (filters.includes('hltb') && missingHltb) ||
        (filters.includes('metacritic') && missingMetacritic) ||
        (filters.includes('pricing') && missingPricing) ||
        (filters.includes('nonPcTheGamesDbImage') && missingImage)
      );
    });
  }

  private normalizeMissingFilters(raw: string[]): MissingMetadataFilter[] {
    const normalized = raw.filter(
      (entry): entry is MissingMetadataFilter =>
        entry === 'hltb' ||
        entry === 'metacritic' ||
        entry === 'pricing' ||
        entry === 'nonPcTheGamesDbImage'
    );
    const deduped = [...new Set(normalized)];

    if (this.selectedListType !== 'wishlist') {
      return deduped.filter((entry) => entry !== 'pricing');
    }

    return deduped;
  }

  private isPcPlatform(game: GameEntry): boolean {
    return this.gameShelfService.shouldUseIgdbCoverForPlatform(game.platform, game.platformIgdbId);
  }

  private isMissingNonPcTheGamesDbImage(game: GameEntry): boolean {
    if (this.isPcPlatform(game)) {
      return false;
    }

    return !this.isNonPcTheGamesDbImagePresent(game);
  }

  private getSelectedGames(): GameEntry[] {
    return this.displayedGames.filter((game) => this.selectedGameKeys.has(this.getGameKey(game)));
  }

  private syncSelectionToDisplayedGames(): void {
    const displayedKeys = new Set(this.displayedGames.map((game) => this.getGameKey(game)));
    this.selectedGameKeys.forEach((key) => {
      if (!displayedKeys.has(key)) {
        this.selectedGameKeys.delete(key);
      }
    });
  }

  private getGameKey(game: GameEntry): string {
    return `${game.igdbGameId}::${String(game.platformIgdbId)}`;
  }

  private toPositiveNumber(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private toReviewScore(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    if (value <= 0 || value > 100) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private toMetacriticScore(value: number | null | undefined): number | null {
    return this.toReviewScore(value);
  }

  private async openHltbPickerModal(game: GameEntry): Promise<void> {
    this.hltbPickerTargetGame = game;
    this.hltbPickerQuery = game.title;
    this.hltbPickerResults = [];
    this.hltbPickerError = null;
    this.isHltbPickerLoading = false;
    this.isHltbPickerModalOpen = true;
    await this.runHltbPickerSearch();
  }

  private async openReviewPickerModal(game: GameEntry): Promise<void> {
    await this.openMetacriticPickerModal(game);
  }

  private async openMetacriticPickerModal(game: GameEntry): Promise<void> {
    this.reviewPickerTargetGame = game;
    this.reviewPickerQuery = game.title;
    this.reviewPickerResults = [];
    this.reviewPickerError = null;
    this.isReviewPickerLoading = false;
    this.isReviewPickerModalOpen = true;
    await this.runMetacriticPickerSearch();
  }

  private async openPricingPickerModal(game: GameEntry): Promise<void> {
    this.pricingPickerTargetGame = game;
    this.pricingPickerQuery = game.title;
    this.pricingPickerResults = [];
    this.pricingPickerError = null;
    this.isPricingPickerLoading = false;
    this.isPricingPickerModalOpen = true;
    await this.runPricingPickerSearch();
  }

  private dedupeHltbCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
    const byKey = new Map<string, HltbMatchCandidate>();

    candidates.forEach((candidate) => {
      const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}`;

      if (!byKey.has(key)) {
        byKey.set(key, candidate);
      }
    });

    return [...byKey.values()];
  }

  private dedupeReviewCandidates(candidates: ReviewMatchCandidate[]): ReviewMatchCandidate[] {
    const byKey = new Map<string, ReviewMatchCandidate>();

    candidates.forEach((candidate) => {
      const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}`;

      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, candidate);
        return;
      }

      const existingScore = existing.reviewScore ?? existing.metacriticScore ?? null;
      const candidateScore = candidate.reviewScore ?? candidate.metacriticScore ?? null;
      const shouldReplace =
        (existing.imageUrl == null && candidate.imageUrl != null) ||
        (existingScore == null && candidateScore != null);

      if (shouldReplace) {
        byKey.set(key, candidate);
      }
    });

    return [...byKey.values()];
  }

  private dedupeMetacriticCandidates(candidates: ReviewMatchCandidate[]): ReviewMatchCandidate[] {
    return this.dedupeReviewCandidates(candidates);
  }

  private dedupePricingCandidates(candidates: PriceMatchCandidate[]): PriceMatchCandidate[] {
    const byKey = new Map<string, PriceMatchCandidate>();

    candidates.forEach((candidate) => {
      const key = `${candidate.title}::${candidate.url ?? ''}::${String(candidate.amount ?? '')}`;
      if (!byKey.has(key)) {
        byKey.set(key, candidate);
      }
    });

    return [...byKey.values()];
  }

  private async refreshHltbForBulkGame(game: GameEntry): Promise<GameEntry> {
    const title = typeof game.title === 'string' ? game.title.trim() : '';
    this.debugLogService.trace('metadata_validator.bulk_hltb.game_start', {
      gameKey: this.getGameKey(game),
      title,
      releaseYear: game.releaseYear,
      platform: game.platform,
      platformIgdbId: game.platformIgdbId
    });

    if (title.length >= 2) {
      try {
        this.debugLogService.trace('metadata_validator.bulk_hltb.candidate_search_start', {
          gameKey: this.getGameKey(game),
          title,
          releaseYear: game.releaseYear,
          platform: game.platform
        });
        const candidates = await firstValueFrom(
          this.gameShelfService.searchHltbCandidates(title, game.releaseYear, game.platform)
        );
        const candidate = candidates.length > 0 ? candidates[0] : null;
        this.debugLogService.trace('metadata_validator.bulk_hltb.candidate_search_complete', {
          gameKey: this.getGameKey(game),
          candidates: candidates.length,
          selectedCandidate:
            candidate !== null
              ? {
                  title: candidate.title,
                  releaseYear: candidate.releaseYear,
                  platform: candidate.platform
                }
              : null
        });

        if (candidate !== null) {
          this.debugLogService.trace('metadata_validator.bulk_hltb.apply_candidate', {
            gameKey: this.getGameKey(game),
            candidateTitle: candidate.title,
            candidateReleaseYear: candidate.releaseYear,
            candidatePlatform: candidate.platform
          });
          return await this.gameShelfService.refreshGameCompletionTimesWithQuery(
            game.igdbGameId,
            game.platformIgdbId,
            {
              title: candidate.title,
              releaseYear: candidate.releaseYear,
              platform: candidate.platform
            }
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (isRateLimitedMessage(message)) {
          throw error;
        }
        this.debugLogService.trace('metadata_validator.bulk_hltb.candidate_search_failed', {
          gameKey: this.getGameKey(game)
        });
        // Fall back to the default lookup when candidate search fails.
      }
    }

    this.debugLogService.trace('metadata_validator.bulk_hltb.fallback_lookup', {
      gameKey: this.getGameKey(game)
    });
    return this.gameShelfService.refreshGameCompletionTimes(game.igdbGameId, game.platformIgdbId);
  }

  private async refreshReviewForBulkGame(game: GameEntry): Promise<GameEntry> {
    const title = typeof game.title === 'string' ? game.title.trim() : '';

    if (title.length >= 2) {
      try {
        const candidates = await firstValueFrom(
          this.gameShelfService.searchReviewCandidates(
            title,
            game.releaseYear,
            game.platform,
            game.platformIgdbId
          )
        );
        const candidate = candidates.length > 0 ? candidates[0] : null;

        if (candidate !== null) {
          return await this.gameShelfService.refreshGameMetacriticScoreWithQuery(
            game.igdbGameId,
            game.platformIgdbId,
            {
              title: candidate.title,
              releaseYear: candidate.releaseYear,
              platform: candidate.platform,
              platformIgdbId: game.platformIgdbId,
              mobygamesGameId: candidate.mobygamesGameId ?? null
            }
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (isRateLimitedMessage(message)) {
          throw error;
        }
        // Fall back to the default lookup when candidate search fails.
      }
    }

    return this.gameShelfService.refreshGameMetacriticScore(game.igdbGameId, game.platformIgdbId);
  }

  private async refreshMetacriticForBulkGame(game: GameEntry): Promise<GameEntry> {
    return this.refreshReviewForBulkGame(game);
  }

  private async refreshPricingForBulkGame(game: GameEntry): Promise<GameEntry> {
    if (!this.isPsPricesPlatform(game)) {
      return this.gameShelfService.refreshGamePricing(game.igdbGameId, game.platformIgdbId);
    }

    const title = typeof game.title === 'string' ? game.title.trim() : '';

    if (title.length >= 2) {
      try {
        const candidates = await firstValueFrom(
          this.gameShelfService.searchPricingCandidates(game.igdbGameId, game.platformIgdbId, title)
        );
        const candidate = candidates.length > 0 ? candidates[0] : null;

        if (candidate !== null) {
          return await this.gameShelfService.refreshGamePricingWithQuery(
            game.igdbGameId,
            game.platformIgdbId,
            { title: candidate.title }
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : '';
        if (isRateLimitedMessage(message)) {
          throw error;
        }
        // Fall back to default lookup when candidate search fails.
      }
    }

    return this.gameShelfService.refreshGamePricing(game.igdbGameId, game.platformIgdbId);
  }

  private isPsPricesPlatform(game: GameEntry): boolean {
    return (
      game.platformIgdbId === 48 ||
      game.platformIgdbId === 167 ||
      game.platformIgdbId === 130 ||
      game.platformIgdbId === 508
    );
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'danger' | 'warning' = 'primary'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color
    });

    await toast.present();
  }
}
