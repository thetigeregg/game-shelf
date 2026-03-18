import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonFooter,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import {
  HltbMatchCandidate,
  PriceMatchCandidate,
  ReviewMatchCandidate,
} from '../core/models/game.models';
import {
  buildAdminQueueFeedback,
  buildGroupedAdminDiscoveryItem,
  dedupeHltbAdminCandidates,
  dedupePricingAdminCandidates,
  dedupeReviewAdminCandidates,
  describeAdminActiveTarget,
  describeAdminTargetedRows,
  formatAdminNumber,
  getAdminDiscoveryGameKey,
  groupAdminDiscoveryItems,
  normalizeAdminString,
  parseAdminInteger,
  parseAdminNumber,
  resolveAdminPricingSource,
  type GroupedAdminDiscoveryListItem,
  type QueueStatusTone,
} from './admin-discovery-match.utils';
import { GameShelfService } from '../core/services/game-shelf.service';
import {
  AdminDiscoveryDetailResponse,
  AdminDiscoveryListItem,
  AdminDiscoveryMatchProvider,
  AdminDiscoveryMatchService,
  AdminDiscoveryMatchStateStatus,
} from '../core/services/admin-discovery-match.service';
import { ClientWriteAuthService } from '../core/services/client-write-auth.service';
import { formatRateLimitedUiError } from '../core/utils/rate-limit-ui-error';

type ReviewSource = 'metacritic' | 'mobygames';

@Component({
  selector: 'app-admin-discovery-match',
  templateUrl: './admin-discovery-match.page.html',
  styleUrls: ['./admin-discovery-match.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonBackButton,
    IonBadge,
    IonButton,
    IonButtons,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonLabel,
    IonList,
    IonListHeader,
    IonModal,
    IonFooter,
    IonNote,
    IonSearchbar,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonTitle,
    IonToolbar,
  ],
})
export class AdminDiscoveryMatchPage {
  readonly providerOptions: Array<{ value: AdminDiscoveryMatchProvider; label: string }> = [
    { value: 'hltb', label: 'HLTB' },
    { value: 'review', label: 'Review' },
    { value: 'pricing', label: 'Pricing' },
  ];

  readonly stateOptions: Array<{ value: AdminDiscoveryMatchStateStatus | 'all'; label: string }> = [
    { value: 'all', label: 'Any unmatched' },
    { value: 'missing', label: 'Missing' },
    { value: 'retrying', label: 'Retrying' },
    { value: 'permanentMiss', label: 'Permanent miss' },
  ];

  readonly reviewSourceOptions: Array<{ value: ReviewSource; label: string }> = [
    { value: 'metacritic', label: 'Metacritic' },
    { value: 'mobygames', label: 'MobyGames' },
  ];

  selectedProvider: AdminDiscoveryMatchProvider = 'hltb';
  selectedState: AdminDiscoveryMatchStateStatus | 'all' = 'all';
  searchQuery = '';
  items: GroupedAdminDiscoveryListItem[] = [];
  scannedCount = 0;
  isLoading = false;
  errorMessage: string | null = null;
  listQueueStatusMessage: string | null = null;
  listQueueStatusDetail: string | null = null;
  listQueueStatusTone: QueueStatusTone = 'success';
  isManageModalOpen = false;
  isDetailLoading = false;
  isSaving = false;
  isListRequeueing = false;
  isRequeueing = false;
  activeDetail: AdminDiscoveryDetailResponse | null = null;
  activeGroup: GroupedAdminDiscoveryListItem | null = null;
  activeQueueStatusMessage: string | null = null;
  activeQueueStatusDetail: string | null = null;
  activeQueueStatusTone: QueueStatusTone = 'success';
  activeModalProvider: AdminDiscoveryMatchProvider = 'hltb';
  hltbSearchQuery = '';
  hltbSearchResults: HltbMatchCandidate[] = [];
  hltbSearchError: string | null = null;
  isHltbSearchLoading = false;
  hltbSearchHasRun = false;
  reviewSearchQuery = '';
  reviewSearchResults: ReviewMatchCandidate[] = [];
  reviewSearchError: string | null = null;
  isReviewSearchLoading = false;
  reviewSearchHasRun = false;
  pricingSearchQuery = '';
  pricingSearchResults: PriceMatchCandidate[] = [];
  pricingSearchError: string | null = null;
  isPricingSearchLoading = false;
  pricingSearchHasRun = false;

  hltbForm = {
    hltbGameId: '',
    hltbUrl: '',
    hltbMainHours: '',
    hltbMainExtraHours: '',
    hltbCompletionistHours: '',
    queryTitle: '',
    queryReleaseYear: '',
    queryPlatform: '',
  };

  reviewForm = {
    reviewSource: 'metacritic' as ReviewSource,
    reviewScore: '',
    reviewUrl: '',
    metacriticScore: '',
    metacriticUrl: '',
    mobygamesGameId: '',
    mobyScore: '',
    queryTitle: '',
    queryReleaseYear: '',
    queryPlatform: '',
  };

  pricingForm = {
    priceSource: 'psprices',
    priceFetchedAt: '',
    priceAmount: '',
    priceCurrency: '',
    priceRegularAmount: '',
    priceDiscountPercent: '',
    priceIsFree: false,
    priceUrl: '',
    psPricesUrl: '',
    psPricesTitle: '',
    psPricesPlatform: '',
  };

  private readonly adminMatchService = inject(AdminDiscoveryMatchService);
  private readonly clientWriteAuth = inject(ClientWriteAuthService);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly toastController = inject(ToastController);

  constructor() {
    if (this.clientWriteAuth.hasToken()) {
      queueMicrotask(() => {
        void this.loadItems();
      });
    }
  }

  get hasAccessToken(): boolean {
    return this.clientWriteAuth.hasToken();
  }

  get visiblePermanentMissKeys(): string[] {
    return [
      ...new Set(
        this.items.flatMap((item) =>
          item.sourceItems
            .filter(
              (sourceItem) =>
                sourceItem.matchState[this.selectedProvider].status === 'permanentMiss'
            )
            .map((sourceItem) => getAdminDiscoveryGameKey(sourceItem))
        )
      ),
    ];
  }

  get currentProviderLabel(): string {
    return (
      this.providerOptions.find((option) => option.value === this.selectedProvider)?.label ??
      'Provider'
    );
  }

  get listRequeueNote(): string {
    return this.selectedProvider === 'pricing'
      ? 'queues targeted pricing refresh for the visible games'
      : 'queues targeted discovery enrichment for the visible games';
  }

  get activeRequeueLabel(): string {
    return this.activeModalProvider === 'pricing'
      ? 'Requeue pricing refresh'
      : 'Requeue enrichment';
  }

  get showPsPricesFields(): boolean {
    return this.isPsPricesSource(this.pricingForm.priceSource);
  }

  async loadItems(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = null;
    try {
      const response = await firstValueFrom(
        this.adminMatchService.listUnmatched({
          provider: this.selectedProvider,
          state: this.selectedState,
          search: this.searchQuery,
          limit: 100,
        })
      );
      this.items = groupAdminDiscoveryItems(response.items);
      this.scannedCount = response.scanned;
    } catch (error) {
      this.errorMessage = this.toErrorMessage(error, 'Unable to load unmatched discovery games.');
      this.items = [];
      this.scannedCount = 0;
    } finally {
      this.isLoading = false;
    }
  }

  async clearVisiblePermanentMisses(): Promise<void> {
    if (this.selectedProvider === 'pricing') {
      await this.presentToast('Pricing permanent-miss reset is not available.', 'warning');
      return;
    }

    const gameKeys = this.visiblePermanentMissKeys;
    if (gameKeys.length === 0) {
      await this.presentToast('No permanent misses in the current result.');
      return;
    }

    try {
      const response = await firstValueFrom(
        this.adminMatchService.clearPermanentMiss(this.selectedProvider, gameKeys)
      );
      await this.presentToast(`Reset ${String(response.cleared)} permanent misses.`);
      await this.loadItems();
    } catch (error) {
      await this.presentToast(
        this.toErrorMessage(error, 'Unable to reset permanent misses.'),
        'danger'
      );
    }
  }

  async requeueDiscoveryRun(): Promise<void> {
    if (this.isListRequeueing) {
      return;
    }

    this.isListRequeueing = true;
    try {
      const targetedKeys = this.items.flatMap((item) => item.gameKeys);
      const response = await firstValueFrom(
        this.adminMatchService.requeueEnrichmentRun(this.selectedProvider, targetedKeys)
      );
      const queueState = buildAdminQueueFeedback(response, this.selectedProvider, 'list');
      this.setListQueueStatus(
        queueState.message,
        describeAdminTargetedRows(this.items),
        queueState.tone
      );
      await this.presentToast(queueState.message, queueState.tone);
    } catch (error) {
      this.setListQueueStatus(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.selectedProvider)),
        describeAdminTargetedRows(this.items),
        'danger'
      );
      await this.presentToast(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.selectedProvider)),
        'danger'
      );
    } finally {
      this.isListRequeueing = false;
    }
  }

  async openManageModal(item: GroupedAdminDiscoveryListItem): Promise<void> {
    this.isManageModalOpen = true;
    this.activeModalProvider = this.selectedProvider;
    this.isDetailLoading = true;
    this.activeDetail = null;
    this.activeGroup = item;
    try {
      const detail = await firstValueFrom(
        this.adminMatchService.getMatchState(item.igdbGameId, item.platformIgdbId)
      );
      this.activeDetail = detail;
      this.syncFormsFromDetail(detail);
    } catch (error) {
      await this.presentToast(
        this.toErrorMessage(error, 'Unable to load match details.'),
        'danger'
      );
      this.closeManageModal();
    } finally {
      this.isDetailLoading = false;
    }
  }

  closeManageModal(): void {
    this.isManageModalOpen = false;
    this.isDetailLoading = false;
    this.isSaving = false;
    this.isRequeueing = false;
    this.activeDetail = null;
    this.activeGroup = null;
    this.clearActiveQueueStatus();
    this.resetCandidateSearchState();
  }

  async saveActiveProvider(): Promise<void> {
    if (!this.activeDetail) {
      return;
    }

    this.isSaving = true;
    try {
      const response = await firstValueFrom(
        this.adminMatchService.updateMatch(
          this.activeDetail.igdbGameId,
          this.activeDetail.platformIgdbId,
          this.buildUpdateRequest(this.activeModalProvider)
        )
      );
      this.activeDetail = response.item;
      this.syncFormsFromDetail(response.item);
      this.replaceVisibleItem(response.item);
      await this.presentToast(`${this.getProviderLabel(this.activeModalProvider)} match saved.`);
    } catch (error) {
      await this.presentToast(
        this.toErrorMessage(error, 'Unable to save provider match.'),
        'danger'
      );
    } finally {
      this.isSaving = false;
    }
  }

  async clearActiveProvider(): Promise<void> {
    if (!this.activeDetail) {
      return;
    }

    this.isSaving = true;
    try {
      const response = await firstValueFrom(
        this.adminMatchService.clearMatch(
          this.activeDetail.igdbGameId,
          this.activeDetail.platformIgdbId,
          this.activeModalProvider
        )
      );
      this.activeDetail = response.item;
      this.syncFormsFromDetail(response.item);
      this.replaceVisibleItem(response.item);
      await this.presentToast(`${this.getProviderLabel(this.activeModalProvider)} match cleared.`);
    } catch (error) {
      await this.presentToast(
        this.toErrorMessage(error, 'Unable to clear provider match.'),
        'danger'
      );
    } finally {
      this.isSaving = false;
    }
  }

  async requeueActiveGameEnrichment(): Promise<void> {
    if (!this.activeDetail || this.isRequeueing) {
      return;
    }

    this.isRequeueing = true;
    try {
      const response = await firstValueFrom(
        this.adminMatchService.requeueEnrichment(
          this.activeDetail.igdbGameId,
          this.activeDetail.platformIgdbId,
          this.activeModalProvider
        )
      );
      const queueState = buildAdminQueueFeedback(response, this.activeModalProvider, 'active');
      this.setActiveQueueStatus(
        queueState.message,
        describeAdminActiveTarget(this.activeDetail, this.activeGroup),
        queueState.tone
      );
      await this.presentToast(queueState.message, queueState.tone);
    } catch (error) {
      this.setActiveQueueStatus(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.activeModalProvider)),
        describeAdminActiveTarget(this.activeDetail, this.activeGroup),
        'danger'
      );
      await this.presentToast(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.activeModalProvider)),
        'danger'
      );
    } finally {
      this.isRequeueing = false;
    }
  }

  trackByGameKey(_: number, item: GroupedAdminDiscoveryListItem): string {
    return item.igdbGameId;
  }

  getStatusLabel(item: AdminDiscoveryListItem, provider: AdminDiscoveryMatchProvider): string {
    const state = item.matchState[provider];
    if (state.status === 'permanentMiss') {
      return 'Permanent miss';
    }
    if (state.status === 'retrying') {
      return `Retrying (${String(state.attempts)})`;
    }
    return state.status === 'matched' ? 'Matched' : 'Missing';
  }

  getStatusColor(item: AdminDiscoveryListItem, provider: AdminDiscoveryMatchProvider): string {
    const status = item.matchState[provider].status;
    if (status === 'matched') {
      return 'success';
    }
    if (status === 'permanentMiss') {
      return 'danger';
    }
    if (status === 'retrying') {
      return 'warning';
    }
    return 'medium';
  }

  async searchActiveProviderCandidates(): Promise<void> {
    if (this.activeModalProvider === 'hltb') {
      await this.runHltbCandidateSearch();
      return;
    }

    if (this.activeModalProvider === 'review') {
      await this.runReviewCandidateSearch();
      return;
    }

    await this.runPricingCandidateSearch();
  }

  applyHltbCandidate(candidate: HltbMatchCandidate): void {
    this.hltbForm = {
      ...this.hltbForm,
      hltbGameId: formatAdminNumber(candidate.hltbGameId ?? null),
      hltbUrl: candidate.hltbUrl ?? '',
      hltbMainHours: formatAdminNumber(candidate.hltbMainHours),
      hltbMainExtraHours: formatAdminNumber(candidate.hltbMainExtraHours),
      hltbCompletionistHours: formatAdminNumber(candidate.hltbCompletionistHours),
      queryTitle: candidate.title,
      queryReleaseYear: formatAdminNumber(candidate.releaseYear),
      queryPlatform: candidate.platform ?? '',
    };
  }

  applyReviewCandidate(candidate: ReviewMatchCandidate): void {
    const candidateSource = candidate.reviewSource ?? 'metacritic';
    const reviewScore = formatAdminNumber(
      candidate.reviewScore ?? candidate.metacriticScore ?? null
    );
    const reviewUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? '';
    this.reviewForm = {
      ...this.reviewForm,
      reviewSource: candidateSource,
      reviewScore,
      reviewUrl,
      metacriticScore: candidateSource === 'metacritic' ? reviewScore : '',
      metacriticUrl: candidateSource === 'metacritic' ? reviewUrl : '',
      mobygamesGameId: formatAdminNumber(candidate.mobygamesGameId ?? null),
      mobyScore: formatAdminNumber(candidate.mobyScore ?? null),
      queryTitle: candidate.title,
      queryReleaseYear: formatAdminNumber(candidate.releaseYear),
      queryPlatform: candidate.platform ?? '',
    };
  }

  applyPricingCandidate(candidate: PriceMatchCandidate): void {
    const source = resolveAdminPricingSource(
      this.activeDetail?.platformIgdbId ?? null,
      candidate.source
    );
    const isPsPricesSource = this.isPsPricesSource(source);

    this.pricingForm = {
      ...this.pricingForm,
      priceSource: source,
      priceAmount: formatAdminNumber(candidate.amount),
      priceCurrency: candidate.currency ?? '',
      priceRegularAmount: formatAdminNumber(candidate.regularAmount),
      priceDiscountPercent: formatAdminNumber(candidate.discountPercent),
      priceIsFree: candidate.isFree === true,
      priceUrl: candidate.url ?? '',
      psPricesUrl: isPsPricesSource ? (candidate.url ?? '') : '',
      psPricesTitle: isPsPricesSource ? candidate.title : '',
      psPricesPlatform: isPsPricesSource ? this.pricingForm.psPricesPlatform : '',
    };
  }

  private buildUpdateRequest(provider: AdminDiscoveryMatchProvider) {
    if (provider === 'hltb') {
      return {
        provider,
        hltbGameId: parseAdminInteger(this.hltbForm.hltbGameId),
        hltbUrl: normalizeAdminString(this.hltbForm.hltbUrl),
        hltbMainHours: parseAdminNumber(this.hltbForm.hltbMainHours),
        hltbMainExtraHours: parseAdminNumber(this.hltbForm.hltbMainExtraHours),
        hltbCompletionistHours: parseAdminNumber(this.hltbForm.hltbCompletionistHours),
        queryTitle: normalizeAdminString(this.hltbForm.queryTitle),
        queryReleaseYear: parseAdminInteger(this.hltbForm.queryReleaseYear),
        queryPlatform: normalizeAdminString(this.hltbForm.queryPlatform),
      };
    }

    if (provider === 'review') {
      return {
        provider,
        reviewSource: this.reviewForm.reviewSource,
        reviewScore: parseAdminNumber(this.reviewForm.reviewScore),
        reviewUrl: normalizeAdminString(this.reviewForm.reviewUrl),
        metacriticScore: parseAdminNumber(this.reviewForm.metacriticScore),
        metacriticUrl: normalizeAdminString(this.reviewForm.metacriticUrl),
        mobygamesGameId: parseAdminInteger(this.reviewForm.mobygamesGameId),
        mobyScore: parseAdminNumber(this.reviewForm.mobyScore),
        queryTitle: normalizeAdminString(this.reviewForm.queryTitle),
        queryReleaseYear: parseAdminInteger(this.reviewForm.queryReleaseYear),
        queryPlatform: normalizeAdminString(this.reviewForm.queryPlatform),
      };
    }

    const isPsPricesSource = this.isPsPricesSource(this.pricingForm.priceSource);

    return {
      provider,
      priceSource: normalizeAdminString(this.pricingForm.priceSource),
      priceFetchedAt: normalizeAdminString(this.pricingForm.priceFetchedAt),
      priceAmount: parseAdminNumber(this.pricingForm.priceAmount),
      priceCurrency: normalizeAdminString(this.pricingForm.priceCurrency),
      priceRegularAmount: parseAdminNumber(this.pricingForm.priceRegularAmount),
      priceDiscountPercent: parseAdminNumber(this.pricingForm.priceDiscountPercent),
      priceIsFree: this.pricingForm.priceIsFree,
      priceUrl: normalizeAdminString(this.pricingForm.priceUrl),
      psPricesUrl: isPsPricesSource ? normalizeAdminString(this.pricingForm.psPricesUrl) : null,
      psPricesTitle: isPsPricesSource ? normalizeAdminString(this.pricingForm.psPricesTitle) : null,
      psPricesPlatform: isPsPricesSource
        ? normalizeAdminString(this.pricingForm.psPricesPlatform)
        : null,
    };
  }

  private syncFormsFromDetail(detail: AdminDiscoveryDetailResponse): void {
    const priceSource = resolveAdminPricingSource(
      detail.platformIgdbId,
      detail.providers.pricing.priceSource
    );
    const isPsPricesSource = this.isPsPricesSource(priceSource);

    this.hltbForm = {
      hltbGameId: formatAdminNumber(detail.providers.hltb.hltbGameId),
      hltbUrl: detail.providers.hltb.hltbUrl ?? '',
      hltbMainHours: formatAdminNumber(detail.providers.hltb.hltbMainHours),
      hltbMainExtraHours: formatAdminNumber(detail.providers.hltb.hltbMainExtraHours),
      hltbCompletionistHours: formatAdminNumber(detail.providers.hltb.hltbCompletionistHours),
      queryTitle: detail.providers.hltb.queryTitle ?? '',
      queryReleaseYear: formatAdminNumber(detail.providers.hltb.queryReleaseYear),
      queryPlatform: detail.providers.hltb.queryPlatform ?? '',
    };

    this.reviewForm = {
      reviewSource: detail.providers.review.reviewSource ?? 'metacritic',
      reviewScore: formatAdminNumber(detail.providers.review.reviewScore),
      reviewUrl: detail.providers.review.reviewUrl ?? '',
      metacriticScore: formatAdminNumber(detail.providers.review.metacriticScore),
      metacriticUrl: detail.providers.review.metacriticUrl ?? '',
      mobygamesGameId: formatAdminNumber(detail.providers.review.mobygamesGameId),
      mobyScore: formatAdminNumber(detail.providers.review.mobyScore),
      queryTitle: detail.providers.review.queryTitle ?? '',
      queryReleaseYear: formatAdminNumber(detail.providers.review.queryReleaseYear),
      queryPlatform: detail.providers.review.queryPlatform ?? '',
    };

    this.pricingForm = {
      priceSource,
      priceFetchedAt: detail.providers.pricing.priceFetchedAt ?? '',
      priceAmount: formatAdminNumber(detail.providers.pricing.priceAmount),
      priceCurrency: detail.providers.pricing.priceCurrency ?? '',
      priceRegularAmount: formatAdminNumber(detail.providers.pricing.priceRegularAmount),
      priceDiscountPercent: formatAdminNumber(detail.providers.pricing.priceDiscountPercent),
      priceIsFree: detail.providers.pricing.priceIsFree,
      priceUrl: detail.providers.pricing.priceUrl ?? '',
      psPricesUrl: isPsPricesSource ? (detail.providers.pricing.psPricesUrl ?? '') : '',
      psPricesTitle: isPsPricesSource ? (detail.providers.pricing.psPricesTitle ?? '') : '',
      psPricesPlatform: isPsPricesSource ? (detail.providers.pricing.psPricesPlatform ?? '') : '',
    };

    this.hltbSearchQuery = detail.providers.hltb.queryTitle ?? detail.title ?? '';
    this.reviewSearchQuery = detail.providers.review.queryTitle ?? detail.title ?? '';
    this.pricingSearchQuery =
      (isPsPricesSource ? detail.providers.pricing.psPricesTitle : null) ?? detail.title ?? '';
    this.resetCandidateSearchResults();
  }

  getPlatformLabel(item: GroupedAdminDiscoveryListItem): string {
    return item.groupedPlatformCount > 1
      ? 'Multiple platforms'
      : item.platform || 'Unknown platform';
  }

  get activePlatformLabel(): string {
    if (this.activeGroup && this.activeGroup.groupedPlatformCount > 1) {
      return 'Multiple platforms';
    }
    return this.activeDetail?.platform || 'Unknown platform';
  }

  get activePlatformNote(): string | null {
    if (!this.activeGroup || this.activeGroup.groupedPlatformCount <= 1) {
      return null;
    }

    return `Edits apply to ${String(this.activeGroup.groupedPlatformCount)} discovery platform rows: ${this.activeGroup.platformLabels.join(', ')}`;
  }

  private replaceVisibleItem(detail: AdminDiscoveryDetailResponse): void {
    this.items = this.items.map((item) =>
      item.igdbGameId === detail.igdbGameId
        ? buildGroupedAdminDiscoveryItem(
            item.sourceItems.map((sourceItem) => {
              const nextMatchState =
                item.groupedPlatformCount === 1 ||
                sourceItem.platformIgdbId === detail.platformIgdbId
                  ? detail.matchState
                  : {
                      ...sourceItem.matchState,
                      [this.activeModalProvider]: detail.matchState[this.activeModalProvider],
                    };

              return {
                ...sourceItem,
                title: detail.title,
                releaseYear: detail.releaseYear,
                platform:
                  sourceItem.platformIgdbId === detail.platformIgdbId
                    ? detail.platform
                    : sourceItem.platform,
                matchState: nextMatchState,
              };
            })
          )
        : item
    );
  }

  private isPsPricesSource(priceSource?: string | null): boolean {
    return priceSource === 'psprices';
  }

  private getProviderLabel(provider: AdminDiscoveryMatchProvider): string {
    return this.providerOptions.find((option) => option.value === provider)?.label ?? provider;
  }

  private getRequeueErrorMessage(provider: AdminDiscoveryMatchProvider): string {
    return provider === 'pricing'
      ? 'Unable to queue targeted pricing refresh.'
      : 'Unable to queue targeted discovery enrichment.';
  }

  private setListQueueStatus(message: string, detail: string | null, tone: QueueStatusTone): void {
    this.listQueueStatusMessage = message;
    this.listQueueStatusDetail = detail;
    this.listQueueStatusTone = tone;
  }

  private setActiveQueueStatus(
    message: string,
    detail: string | null,
    tone: QueueStatusTone
  ): void {
    this.activeQueueStatusMessage = message;
    this.activeQueueStatusDetail = detail;
    this.activeQueueStatusTone = tone;
  }

  private clearActiveQueueStatus(): void {
    this.activeQueueStatusMessage = null;
    this.activeQueueStatusDetail = null;
    this.activeQueueStatusTone = 'success';
  }

  private async runHltbCandidateSearch(): Promise<void> {
    const detail = this.activeDetail;
    const normalized = this.hltbSearchQuery.trim();

    if (!detail) {
      return;
    }

    if (normalized.length < 2) {
      this.hltbSearchResults = [];
      this.hltbSearchError = 'Enter at least 2 characters.';
      this.hltbSearchHasRun = false;
      return;
    }

    this.isHltbSearchLoading = true;
    this.hltbSearchError = null;
    this.hltbSearchHasRun = true;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchHltbCandidates(
          normalized,
          parseAdminInteger(this.hltbForm.queryReleaseYear) ?? detail.releaseYear,
          normalizeAdminString(this.hltbForm.queryPlatform) ?? detail.platform
        )
      );
      this.hltbSearchResults = dedupeHltbAdminCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.hltbSearchResults = [];
      this.hltbSearchError = formatRateLimitedUiError(error, 'Unable to search HLTB right now.');
    } finally {
      this.isHltbSearchLoading = false;
    }
  }

  private async runReviewCandidateSearch(): Promise<void> {
    const detail = this.activeDetail;
    const normalized = this.reviewSearchQuery.trim();

    if (!detail) {
      return;
    }

    if (normalized.length < 2) {
      this.reviewSearchResults = [];
      this.reviewSearchError = 'Enter at least 2 characters.';
      this.reviewSearchHasRun = false;
      return;
    }

    this.isReviewSearchLoading = true;
    this.reviewSearchError = null;
    this.reviewSearchHasRun = true;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchReviewCandidates(
          normalized,
          parseAdminInteger(this.reviewForm.queryReleaseYear) ?? detail.releaseYear,
          normalizeAdminString(this.reviewForm.queryPlatform) ?? detail.platform,
          detail.platformIgdbId
        )
      );
      this.reviewSearchResults = dedupeReviewAdminCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.reviewSearchResults = [];
      this.reviewSearchError = formatRateLimitedUiError(
        error,
        'Unable to search reviews right now.'
      );
    } finally {
      this.isReviewSearchLoading = false;
    }
  }

  private async runPricingCandidateSearch(): Promise<void> {
    const detail = this.activeDetail;
    const normalized = this.pricingSearchQuery.trim();

    if (!detail) {
      return;
    }

    if (normalized.length < 2) {
      this.pricingSearchResults = [];
      this.pricingSearchError = 'Enter at least 2 characters.';
      this.pricingSearchHasRun = false;
      return;
    }

    this.isPricingSearchLoading = true;
    this.pricingSearchError = null;
    this.pricingSearchHasRun = true;

    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchPricingCandidates(
          detail.igdbGameId,
          detail.platformIgdbId,
          normalized
        )
      );
      this.pricingSearchResults = dedupePricingAdminCandidates(candidates).slice(0, 30);
    } catch (error: unknown) {
      this.pricingSearchResults = [];
      this.pricingSearchError = formatRateLimitedUiError(
        error,
        'Unable to search pricing right now.'
      );
    } finally {
      this.isPricingSearchLoading = false;
    }
  }

  private resetCandidateSearchState(): void {
    this.hltbSearchQuery = '';
    this.reviewSearchQuery = '';
    this.pricingSearchQuery = '';
    this.resetCandidateSearchResults();
  }

  private resetCandidateSearchResults(): void {
    this.hltbSearchResults = [];
    this.hltbSearchError = null;
    this.isHltbSearchLoading = false;
    this.hltbSearchHasRun = false;
    this.reviewSearchResults = [];
    this.reviewSearchError = null;
    this.isReviewSearchLoading = false;
    this.reviewSearchHasRun = false;
    this.pricingSearchResults = [];
    this.pricingSearchError = null;
    this.isPricingSearchLoading = false;
    this.pricingSearchHasRun = false;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    if (!this.hasAccessToken) {
      return 'Set a device write token in Settings to use discovery match controls.';
    }

    return fallback;
  }

  private async presentToast(
    message: string,
    color: 'success' | 'warning' | 'danger' = 'success'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
