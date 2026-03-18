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
type QueueStatusTone = 'success' | 'warning' | 'danger';

interface GroupedAdminDiscoveryListItem extends AdminDiscoveryListItem {
  gameKeys: string[];
  platformLabels: string[];
  groupedPlatformCount: number;
  sourceItems: AdminDiscoveryListItem[];
}

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
            .map((sourceItem) => this.getGameKey(sourceItem))
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
      this.items = this.groupItems(response.items);
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
      const queueState = this.buildQueueFeedback(response, 'list');
      this.setListQueueStatus(
        queueState.message,
        this.describeTargetedRows(this.items),
        queueState.tone
      );
      await this.presentToast(queueState.message, queueState.tone);
    } catch (error) {
      this.setListQueueStatus(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.selectedProvider)),
        this.describeTargetedRows(this.items),
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
      const queueState = this.buildQueueFeedback(response, 'active');
      this.setActiveQueueStatus(queueState.message, this.describeActiveTarget(), queueState.tone);
      await this.presentToast(queueState.message, queueState.tone);
    } catch (error) {
      this.setActiveQueueStatus(
        this.toErrorMessage(error, this.getRequeueErrorMessage(this.activeModalProvider)),
        this.describeActiveTarget(),
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
      hltbGameId: this.formatNumber(candidate.hltbGameId ?? null),
      hltbUrl: candidate.hltbUrl ?? '',
      hltbMainHours: this.formatNumber(candidate.hltbMainHours),
      hltbMainExtraHours: this.formatNumber(candidate.hltbMainExtraHours),
      hltbCompletionistHours: this.formatNumber(candidate.hltbCompletionistHours),
      queryTitle: candidate.title,
      queryReleaseYear: this.formatNumber(candidate.releaseYear),
      queryPlatform: candidate.platform ?? '',
    };
  }

  applyReviewCandidate(candidate: ReviewMatchCandidate): void {
    const candidateSource = candidate.reviewSource ?? 'metacritic';
    this.reviewForm = {
      ...this.reviewForm,
      reviewSource: candidateSource,
      reviewScore: this.formatNumber(candidate.reviewScore ?? candidate.metacriticScore ?? null),
      reviewUrl: candidate.reviewUrl ?? candidate.metacriticUrl ?? '',
      metacriticScore:
        candidateSource === 'metacritic'
          ? this.formatNumber(candidate.reviewScore ?? candidate.metacriticScore ?? null)
          : this.reviewForm.metacriticScore,
      metacriticUrl:
        candidateSource === 'metacritic'
          ? (candidate.reviewUrl ?? candidate.metacriticUrl ?? '')
          : this.reviewForm.metacriticUrl,
      mobygamesGameId: this.formatNumber(candidate.mobygamesGameId ?? null),
      mobyScore: this.formatNumber(candidate.mobyScore ?? null),
      queryTitle: candidate.title,
      queryReleaseYear: this.formatNumber(candidate.releaseYear),
      queryPlatform: candidate.platform ?? '',
    };
  }

  applyPricingCandidate(candidate: PriceMatchCandidate): void {
    const source = this.resolvePricingSource(
      this.activeDetail?.platformIgdbId ?? null,
      candidate.source
    );
    const isPsPricesSource = this.isPsPricesSource(source);

    this.pricingForm = {
      ...this.pricingForm,
      priceSource: source,
      priceAmount: this.formatNumber(candidate.amount),
      priceCurrency: candidate.currency ?? '',
      priceRegularAmount: this.formatNumber(candidate.regularAmount),
      priceDiscountPercent: this.formatNumber(candidate.discountPercent),
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
        hltbGameId: this.parseInteger(this.hltbForm.hltbGameId),
        hltbUrl: this.normalizeString(this.hltbForm.hltbUrl),
        hltbMainHours: this.parseNumber(this.hltbForm.hltbMainHours),
        hltbMainExtraHours: this.parseNumber(this.hltbForm.hltbMainExtraHours),
        hltbCompletionistHours: this.parseNumber(this.hltbForm.hltbCompletionistHours),
        queryTitle: this.normalizeString(this.hltbForm.queryTitle),
        queryReleaseYear: this.parseInteger(this.hltbForm.queryReleaseYear),
        queryPlatform: this.normalizeString(this.hltbForm.queryPlatform),
      };
    }

    if (provider === 'review') {
      return {
        provider,
        reviewSource: this.reviewForm.reviewSource,
        reviewScore: this.parseNumber(this.reviewForm.reviewScore),
        reviewUrl: this.normalizeString(this.reviewForm.reviewUrl),
        metacriticScore: this.parseNumber(this.reviewForm.metacriticScore),
        metacriticUrl: this.normalizeString(this.reviewForm.metacriticUrl),
        mobygamesGameId: this.parseInteger(this.reviewForm.mobygamesGameId),
        mobyScore: this.parseNumber(this.reviewForm.mobyScore),
        queryTitle: this.normalizeString(this.reviewForm.queryTitle),
        queryReleaseYear: this.parseInteger(this.reviewForm.queryReleaseYear),
        queryPlatform: this.normalizeString(this.reviewForm.queryPlatform),
      };
    }

    const isPsPricesSource = this.isPsPricesSource(this.pricingForm.priceSource);

    return {
      provider,
      priceSource: this.normalizeString(this.pricingForm.priceSource),
      priceFetchedAt: this.normalizeString(this.pricingForm.priceFetchedAt),
      priceAmount: this.parseNumber(this.pricingForm.priceAmount),
      priceCurrency: this.normalizeString(this.pricingForm.priceCurrency),
      priceRegularAmount: this.parseNumber(this.pricingForm.priceRegularAmount),
      priceDiscountPercent: this.parseNumber(this.pricingForm.priceDiscountPercent),
      priceIsFree: this.pricingForm.priceIsFree,
      priceUrl: this.normalizeString(this.pricingForm.priceUrl),
      psPricesUrl: isPsPricesSource ? this.normalizeString(this.pricingForm.psPricesUrl) : null,
      psPricesTitle: isPsPricesSource ? this.normalizeString(this.pricingForm.psPricesTitle) : null,
      psPricesPlatform: isPsPricesSource
        ? this.normalizeString(this.pricingForm.psPricesPlatform)
        : null,
    };
  }

  private syncFormsFromDetail(detail: AdminDiscoveryDetailResponse): void {
    const priceSource = this.resolvePricingSource(
      detail.platformIgdbId,
      detail.providers.pricing.priceSource
    );
    const isPsPricesSource = this.isPsPricesSource(priceSource);

    this.hltbForm = {
      hltbGameId: this.formatNumber(detail.providers.hltb.hltbGameId),
      hltbUrl: detail.providers.hltb.hltbUrl ?? '',
      hltbMainHours: this.formatNumber(detail.providers.hltb.hltbMainHours),
      hltbMainExtraHours: this.formatNumber(detail.providers.hltb.hltbMainExtraHours),
      hltbCompletionistHours: this.formatNumber(detail.providers.hltb.hltbCompletionistHours),
      queryTitle: detail.providers.hltb.queryTitle ?? '',
      queryReleaseYear: this.formatNumber(detail.providers.hltb.queryReleaseYear),
      queryPlatform: detail.providers.hltb.queryPlatform ?? '',
    };

    this.reviewForm = {
      reviewSource: detail.providers.review.reviewSource ?? 'metacritic',
      reviewScore: this.formatNumber(detail.providers.review.reviewScore),
      reviewUrl: detail.providers.review.reviewUrl ?? '',
      metacriticScore: this.formatNumber(detail.providers.review.metacriticScore),
      metacriticUrl: detail.providers.review.metacriticUrl ?? '',
      mobygamesGameId: this.formatNumber(detail.providers.review.mobygamesGameId),
      mobyScore: this.formatNumber(detail.providers.review.mobyScore),
      queryTitle: detail.providers.review.queryTitle ?? '',
      queryReleaseYear: this.formatNumber(detail.providers.review.queryReleaseYear),
      queryPlatform: detail.providers.review.queryPlatform ?? '',
    };

    this.pricingForm = {
      priceSource,
      priceFetchedAt: detail.providers.pricing.priceFetchedAt ?? '',
      priceAmount: this.formatNumber(detail.providers.pricing.priceAmount),
      priceCurrency: detail.providers.pricing.priceCurrency ?? '',
      priceRegularAmount: this.formatNumber(detail.providers.pricing.priceRegularAmount),
      priceDiscountPercent: this.formatNumber(detail.providers.pricing.priceDiscountPercent),
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
        ? this.buildGroupedItem(
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

  private getGameKey(item: Pick<AdminDiscoveryListItem, 'igdbGameId' | 'platformIgdbId'>): string {
    return `${item.igdbGameId}::${String(item.platformIgdbId)}`;
  }

  private groupItems(items: AdminDiscoveryListItem[]): GroupedAdminDiscoveryListItem[] {
    const groups = new Map<string, AdminDiscoveryListItem[]>();

    for (const item of items) {
      const existing = groups.get(item.igdbGameId);
      if (existing) {
        existing.push(item);
        continue;
      }
      groups.set(item.igdbGameId, [item]);
    }

    return [...groups.values()].map((group) => this.buildGroupedItem(group));
  }

  private buildGroupedItem(group: AdminDiscoveryListItem[]): GroupedAdminDiscoveryListItem {
    const representative = group[0];
    const platformLabels = [
      ...new Set(
        group.map((item) => item.platform?.trim()).filter((value): value is string => !!value)
      ),
    ];

    return {
      ...representative,
      platform: group.length > 1 ? 'Multiple platforms' : representative.platform,
      matchState: this.aggregateMatchState(group),
      gameKeys: group.map((item) => this.getGameKey(item)),
      platformLabels,
      groupedPlatformCount: group.length,
      sourceItems: group.map((item) => ({ ...item })),
    };
  }

  private aggregateMatchState(group: AdminDiscoveryListItem[]) {
    return {
      hltb: this.aggregateProviderState(group, 'hltb'),
      review: this.aggregateProviderState(group, 'review'),
      pricing: this.aggregateProviderState(group, 'pricing'),
    };
  }

  private aggregateProviderState(
    group: AdminDiscoveryListItem[],
    provider: AdminDiscoveryMatchProvider
  ) {
    const states = group.map((item) => item.matchState[provider]);
    const status = this.aggregateStatus(states.map((state) => state.status));

    return {
      status,
      locked: states.every((state) => state.locked),
      attempts: Math.max(...states.map((state) => state.attempts)),
      lastTriedAt: this.pickLatestIso(states.map((state) => state.lastTriedAt)),
      nextTryAt: this.pickLatestIso(states.map((state) => state.nextTryAt)),
      permanentMiss: states.some((state) => state.permanentMiss),
    };
  }

  private aggregateStatus(
    statuses: AdminDiscoveryMatchStateStatus[]
  ): AdminDiscoveryMatchStateStatus {
    if (statuses.some((status) => status === 'permanentMiss')) {
      return 'permanentMiss';
    }
    if (statuses.some((status) => status === 'retrying')) {
      return 'retrying';
    }
    if (statuses.some((status) => status === 'missing')) {
      return 'missing';
    }
    return 'matched';
  }

  private pickLatestIso(values: Array<string | null>): string | null {
    const normalized = values.filter((value): value is string => typeof value === 'string');
    if (normalized.length === 0) {
      return null;
    }

    return normalized.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }

  private resolvePricingSource(
    platformIgdbId: number | null | undefined,
    priceSource?: string | null
  ): string {
    if (priceSource === 'steam_store' || priceSource === 'psprices') {
      return priceSource;
    }

    return platformIgdbId === 6 ? 'steam_store' : 'psprices';
  }

  private isPsPricesSource(priceSource?: string | null): boolean {
    return priceSource === 'psprices';
  }

  private getProviderLabel(provider: AdminDiscoveryMatchProvider): string {
    return this.providerOptions.find((option) => option.value === provider)?.label ?? provider;
  }

  private buildQueueFeedback(
    response: { queued: boolean; deduped: boolean; queuedCount: number; dedupedCount: number },
    scope: 'list' | 'active'
  ): { message: string; tone: QueueStatusTone } {
    const pricing =
      (scope === 'list' ? this.selectedProvider : this.activeModalProvider) === 'pricing';

    if (response.queuedCount === 0 && response.dedupedCount === 0) {
      return {
        message: pricing
          ? 'No eligible pricing refresh jobs were queued.'
          : 'No eligible discovery enrichment jobs were queued.',
        tone: 'warning',
      };
    }

    if (response.deduped) {
      return {
        message: pricing
          ? 'Targeted pricing refresh is already queued.'
          : 'Targeted discovery enrichment is already queued.',
        tone: 'warning',
      };
    }

    return {
      message: pricing
        ? `Targeted pricing refresh queued for ${scope === 'list' ? 'the current results' : 'this game'}.`
        : `Targeted discovery enrichment queued for ${scope === 'list' ? 'the current results' : 'this game'}.`,
      tone: 'success',
    };
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

  private clearListQueueStatus(): void {
    this.listQueueStatusMessage = null;
    this.listQueueStatusDetail = null;
    this.listQueueStatusTone = 'success';
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

  private describeTargetedRows(items: GroupedAdminDiscoveryListItem[]): string | null {
    if (items.length === 0) {
      return null;
    }

    const labels = items
      .slice(0, 3)
      .map((item) => this.describeRow(item))
      .filter((label) => label.length > 0);

    if (labels.length === 0) {
      return `${String(items.length)} game${items.length === 1 ? '' : 's'} targeted.`;
    }

    const suffix =
      items.length > labels.length ? `, +${String(items.length - labels.length)} more` : '';
    return `${String(items.length)} game${items.length === 1 ? '' : 's'} targeted: ${labels.join(', ')}${suffix}`;
  }

  private describeActiveTarget(): string | null {
    if (!this.activeDetail) {
      return null;
    }

    if (this.activeGroup && this.activeGroup.groupedPlatformCount > 1) {
      return `Targeted game: ${this.describeRow({
        title: this.activeDetail.title,
        platform: 'Multiple platforms',
        releaseYear: this.activeDetail.releaseYear,
      })}`;
    }

    return `Targeted row: ${this.describeRow(this.activeDetail)}`;
  }

  private describeRow(
    item: Pick<AdminDiscoveryListItem, 'title' | 'platform' | 'releaseYear'>
  ): string {
    const title = item.title?.trim() || 'Untitled discovery game';
    const platform = item.platform?.trim();
    const year = item.releaseYear;

    const meta = [
      platform && platform.length > 0 ? platform : null,
      year ? String(year) : null,
    ].filter((value): value is string => value !== null);

    return meta.length > 0 ? `${title} (${meta.join(', ')})` : title;
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
          this.parseInteger(this.hltbForm.queryReleaseYear) ?? detail.releaseYear,
          this.normalizeString(this.hltbForm.queryPlatform) ?? detail.platform
        )
      );
      this.hltbSearchResults = this.dedupeHltbCandidates(candidates).slice(0, 30);
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
          this.parseInteger(this.reviewForm.queryReleaseYear) ?? detail.releaseYear,
          this.normalizeString(this.reviewForm.queryPlatform) ?? detail.platform,
          detail.platformIgdbId
        )
      );
      this.reviewSearchResults = this.dedupeReviewCandidates(candidates).slice(0, 30);
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
      this.pricingSearchResults = this.dedupePricingCandidates(candidates).slice(0, 30);
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

  private dedupeHltbCandidates(candidates: HltbMatchCandidate[]): HltbMatchCandidate[] {
    const byKey = new Map<string, HltbMatchCandidate>();

    candidates.forEach((candidate) => {
      const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}::${String(candidate.hltbGameId ?? '')}::${candidate.hltbUrl ?? ''}`;

      if (!byKey.has(key)) {
        byKey.set(key, candidate);
      }
    });

    return [...byKey.values()];
  }

  private dedupeReviewCandidates(candidates: ReviewMatchCandidate[]): ReviewMatchCandidate[] {
    const deduped: ReviewMatchCandidate[] = [];

    candidates.forEach((candidate) => {
      const candidateIdentityUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? '';
      const existingIndex = deduped.findIndex((entry) => {
        if (
          entry.title !== candidate.title ||
          entry.releaseYear !== candidate.releaseYear ||
          entry.platform !== candidate.platform
        ) {
          return false;
        }

        const entryIdentityUrl = entry.reviewUrl ?? entry.metacriticUrl ?? '';
        return (
          entryIdentityUrl === candidateIdentityUrl ||
          entryIdentityUrl.length === 0 ||
          candidateIdentityUrl.length === 0
        );
      });

      if (existingIndex === -1) {
        deduped.push(candidate);
        return;
      }

      const existing = deduped[existingIndex];
      const existingIdentityUrl = existing.reviewUrl ?? existing.metacriticUrl ?? '';
      const existingScore = existing.reviewScore ?? existing.metacriticScore ?? null;
      const candidateScore = candidate.reviewScore ?? candidate.metacriticScore ?? null;
      const wouldDropIdentityUrl =
        existingIdentityUrl.length > 0 && candidateIdentityUrl.length === 0;
      const gainsIdentityUrl = existingIdentityUrl.length === 0 && candidateIdentityUrl.length > 0;
      const shouldReplace =
        !wouldDropIdentityUrl &&
        (gainsIdentityUrl ||
          (existing.imageUrl == null && candidate.imageUrl != null) ||
          (existingScore == null && candidateScore != null));

      if (shouldReplace) {
        deduped[existingIndex] = candidate;
      }
    });

    return deduped;
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

  private parseInteger(value: string): number | null {
    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) {
      return null;
    }
    return Number.parseInt(normalized, 10);
  }

  private parseNumber(value: string): number | null {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeString(value: string): string | null {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private formatNumber(value: number | null): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
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
