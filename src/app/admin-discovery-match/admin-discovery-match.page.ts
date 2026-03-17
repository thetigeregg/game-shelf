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
  AdminDiscoveryDetailResponse,
  AdminDiscoveryListItem,
  AdminDiscoveryMatchProvider,
  AdminDiscoveryMatchService,
  AdminDiscoveryMatchStateStatus,
} from '../core/services/admin-discovery-match.service';
import { AdminApiAuthService } from '../core/services/admin-api-auth.service';

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

  tokenDraft = '';
  selectedProvider: AdminDiscoveryMatchProvider = 'hltb';
  selectedState: AdminDiscoveryMatchStateStatus | 'all' = 'all';
  searchQuery = '';
  items: AdminDiscoveryListItem[] = [];
  scannedCount = 0;
  isLoading = false;
  errorMessage: string | null = null;
  isManageModalOpen = false;
  isDetailLoading = false;
  isSaving = false;
  activeDetail: AdminDiscoveryDetailResponse | null = null;
  activeModalProvider: AdminDiscoveryMatchProvider = 'hltb';

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
  private readonly adminAuth = inject(AdminApiAuthService);
  private readonly toastController = inject(ToastController);

  constructor() {
    this.tokenDraft = this.adminAuth.getToken() ?? '';
    if (this.adminAuth.hasToken()) {
      queueMicrotask(() => {
        void this.loadItems();
      });
    }
  }

  get hasAdminToken(): boolean {
    return this.adminAuth.hasToken();
  }

  get visiblePermanentMissKeys(): string[] {
    return this.items
      .filter((item) => item.matchState[this.selectedProvider].status === 'permanentMiss')
      .map((item) => this.getGameKey(item));
  }

  get currentProviderLabel(): string {
    return (
      this.providerOptions.find((option) => option.value === this.selectedProvider)?.label ??
      'Provider'
    );
  }

  async saveAdminToken(): Promise<void> {
    this.adminAuth.setToken(this.tokenDraft);
    this.tokenDraft = this.adminAuth.getToken() ?? '';
    await this.presentToast(this.hasAdminToken ? 'Admin token saved.' : 'Admin token cleared.');
    if (this.hasAdminToken) {
      await this.loadItems();
    } else {
      this.items = [];
      this.scannedCount = 0;
      this.errorMessage = null;
    }
  }

  async clearAdminToken(): Promise<void> {
    this.adminAuth.clearToken();
    this.tokenDraft = '';
    this.items = [];
    this.scannedCount = 0;
    this.errorMessage = null;
    await this.presentToast('Admin token cleared.');
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
      this.items = response.items;
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

  async openManageModal(item: AdminDiscoveryListItem): Promise<void> {
    this.isManageModalOpen = true;
    this.activeModalProvider = this.selectedProvider;
    this.isDetailLoading = true;
    this.activeDetail = null;
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
    this.activeDetail = null;
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

  trackByGameKey(_: number, item: AdminDiscoveryListItem): string {
    return this.getGameKey(item);
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
      psPricesUrl: this.normalizeString(this.pricingForm.psPricesUrl),
      psPricesTitle: this.normalizeString(this.pricingForm.psPricesTitle),
      psPricesPlatform: this.normalizeString(this.pricingForm.psPricesPlatform),
    };
  }

  private syncFormsFromDetail(detail: AdminDiscoveryDetailResponse): void {
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
      priceSource: detail.providers.pricing.priceSource ?? 'psprices',
      priceFetchedAt: detail.providers.pricing.priceFetchedAt ?? '',
      priceAmount: this.formatNumber(detail.providers.pricing.priceAmount),
      priceCurrency: detail.providers.pricing.priceCurrency ?? '',
      priceRegularAmount: this.formatNumber(detail.providers.pricing.priceRegularAmount),
      priceDiscountPercent: this.formatNumber(detail.providers.pricing.priceDiscountPercent),
      priceIsFree: detail.providers.pricing.priceIsFree,
      priceUrl: detail.providers.pricing.priceUrl ?? '',
      psPricesUrl: detail.providers.pricing.psPricesUrl ?? '',
      psPricesTitle: detail.providers.pricing.psPricesTitle ?? '',
      psPricesPlatform: detail.providers.pricing.psPricesPlatform ?? '',
    };
  }

  private replaceVisibleItem(detail: AdminDiscoveryDetailResponse): void {
    this.items = this.items.map((item) =>
      this.getGameKey(item) === this.getGameKey(detail)
        ? {
            igdbGameId: detail.igdbGameId,
            platformIgdbId: detail.platformIgdbId,
            title: detail.title,
            platform: detail.platform,
            releaseYear: detail.releaseYear,
            matchState: detail.matchState,
          }
        : item
    );
  }

  private getGameKey(item: Pick<AdminDiscoveryListItem, 'igdbGameId' | 'platformIgdbId'>): string {
    return `${item.igdbGameId}::${String(item.platformIgdbId)}`;
  }

  private getProviderLabel(provider: AdminDiscoveryMatchProvider): string {
    return this.providerOptions.find((option) => option.value === provider)?.label ?? provider;
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
