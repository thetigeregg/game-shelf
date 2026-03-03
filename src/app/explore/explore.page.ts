import { Component, OnInit, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AlertController,
  ToastController,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonButton,
  IonButtons,
  IonLoading,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonText,
  IonIcon,
  IonRange,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonRefresher,
  IonRefresherContent,
  IonBadge,
  IonAccordion,
  IonAccordionGroup
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import {
  GameCatalogResult,
  GameEntry,
  GameRating,
  GameStatus,
  ListType,
  RecommendationItem,
  RecommendationLaneKey,
  RecommendationLanesResponse,
  RecommendationRuntimeMode,
  RecommendationSimilarItem,
  RecommendationTarget
} from '../core/models/game.models';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { GameDetailContentComponent } from '../features/game-detail/game-detail-content.component';
import { DetailShortcutsFabComponent } from '../features/game-detail/detail-shortcuts-fab.component';
import { AddToLibraryWorkflowService } from '../features/game-search/add-to-library-workflow.service';
import { GameShelfService } from '../core/services/game-shelf.service';
import {
  buildTagInput,
  normalizeGameRating,
  normalizeGameStatus,
  parseTagSelection
} from '../features/game-list/game-list-detail-actions';
import { isRecommendationsExploreEnabled } from '../core/config/runtime-config';
import { addIcons } from 'ionicons';
import {
  compass,
  library,
  logoGoogle,
  logoYoutube,
  search,
  chevronBack,
  sparkles,
  star,
  starOutline,
  time
} from 'ionicons/icons';

interface RecommendationApiError extends Error {
  code?: string;
}

interface RecommendationBadge {
  text: string;
  color: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'medium' | 'light';
}

interface RecommendationDisplayMetadata {
  title: string;
  coverUrl: string | null;
  platformLabel: string;
  releaseYear: number | null;
}

@Component({
  selector: 'app-explore-page',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonItem,
    IonLabel,
    IonModal,
    IonButton,
    IonButtons,
    IonLoading,
    IonSpinner,
    IonList,
    IonListHeader,
    IonText,
    IonIcon,
    IonRange,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonRefresher,
    IonRefresherContent,
    IonBadge,
    IonAccordion,
    IonAccordionGroup,
    NgTemplateOutlet,
    GameDetailContentComponent,
    DetailShortcutsFabComponent
  ]
})
export class ExplorePage implements OnInit {
  private static readonly LANE_LIMIT = 20;

  readonly recommendationFeatureEnabled = isRecommendationsExploreEnabled();
  readonly targetOptions: Array<{ value: RecommendationTarget; label: string }> = [
    { value: 'BACKLOG', label: 'Backlog' },
    { value: 'WISHLIST', label: 'Wishlist' },
    { value: 'DISCOVERY', label: 'Discovery' }
  ];
  readonly runtimeModeOptions: Array<{ value: RecommendationRuntimeMode; label: string }> = [
    { value: 'SHORT', label: 'Short' },
    { value: 'NEUTRAL', label: 'Neutral' },
    { value: 'LONG', label: 'Long' }
  ];
  readonly laneOptionsDefault: Array<{ value: RecommendationLaneKey; label: string }> = [
    { value: 'overall', label: 'Overall' },
    { value: 'hiddenGems', label: 'Hidden Gems' },
    { value: 'exploration', label: 'Exploration' }
  ];
  readonly laneOptionsDiscovery: Array<{ value: RecommendationLaneKey; label: string }> = [
    { value: 'blended', label: 'Blended' },
    { value: 'popular', label: 'Popular' },
    { value: 'recent', label: 'Recent' }
  ];

  selectedTarget: RecommendationTarget = 'BACKLOG';
  selectedRuntimeMode: RecommendationRuntimeMode = 'NEUTRAL';
  selectedLaneKey: RecommendationLaneKey = 'overall';
  activeLanesResponse: RecommendationLanesResponse | null = null;
  isLoadingRecommendations = false;
  recommendationError = '';
  recommendationErrorCode: 'NONE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'REQUEST_FAILED' = 'NONE';
  isGameDetailModalOpen = false;
  isLoadingDetail = false;
  detailErrorMessage = '';
  selectedGameDetail: GameCatalogResult | GameEntry | null = null;
  detailContext: 'explore' | 'library' = 'explore';
  isSelectedGameInLibrary = false;
  isAddToLibraryLoading = false;
  isLoadingSimilar = false;
  similarRecommendationsError = '';
  similarRecommendationItems: RecommendationSimilarItem[] = [];
  activeDetailRecommendation: RecommendationItem | null = null;
  detailNavigationStack: RecommendationItem[] = [];
  isRatingModalOpen = false;
  ratingDraft: GameRating = 3;
  clearRatingOnSave = false;
  readonly statusOptions: { value: GameStatus; label: string }[] = [
    { value: 'playing', label: 'Playing' },
    { value: 'wantToPlay', label: 'Want to Play' },
    { value: 'completed', label: 'Completed' },
    { value: 'paused', label: 'Paused' },
    { value: 'dropped', label: 'Dropped' },
    { value: 'replay', label: 'Replay' }
  ];

  private readonly igdbProxyService = inject(IgdbProxyService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly addToLibraryWorkflow = inject(AddToLibraryWorkflowService);
  private readonly gameShelfService = inject(GameShelfService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly lanesCache = new Map<string, RecommendationLanesResponse>();
  private readonly localGameCacheByIdentity = new Map<string, GameEntry>();
  private readonly recommendationDisplayMetadata = new Map<string, RecommendationDisplayMetadata>();
  private readonly recommendationCatalogCache = new Map<string, GameCatalogResult>();

  constructor() {
    addIcons({
      search,
      logoGoogle,
      logoYoutube,
      chevronBack,
      star,
      starOutline,
      library,
      time,
      compass,
      sparkles
    });
  }

  ngOnInit(): void {
    if (!this.recommendationFeatureEnabled) {
      this.recommendationError = 'Recommendations are disabled in this build.';
      this.recommendationErrorCode = 'REQUEST_FAILED';
      return;
    }

    void this.loadRecommendationLanes(false);
  }

  async onTargetChange(value: string | null | undefined): Promise<void> {
    const parsed = this.parseRecommendationTarget(value);

    if (parsed === null || parsed === this.selectedTarget) {
      return;
    }

    this.selectedTarget = parsed;
    this.selectedLaneKey = this.selectedTarget === 'DISCOVERY' ? 'blended' : 'overall';
    await this.loadRecommendationLanes(false);
  }

  async onRuntimeModeChange(value: string | null | undefined): Promise<void> {
    const parsed = this.parseRuntimeMode(value);

    if (parsed === null || parsed === this.selectedRuntimeMode) {
      return;
    }

    this.selectedRuntimeMode = parsed;
    await this.loadRecommendationLanes(false);
  }

  onLaneChange(value: string | null | undefined): void {
    const parsed = this.parseLaneKey(value);

    if (parsed === null) {
      return;
    }

    this.selectedLaneKey = parsed;
  }

  async refreshRecommendations(event: Event): Promise<void> {
    try {
      await this.loadRecommendationLanes(true);
    } finally {
      await this.completeRefresher(event);
    }
  }

  getActiveLaneItems(): RecommendationItem[] {
    return this.getDeduplicatedLaneItems(this.getRawActiveLaneItems());
  }

  hasAnyLaneItems(): boolean {
    const lanes = this.activeLanesResponse?.lanes;

    if (!lanes) {
      return false;
    }

    const options =
      this.selectedTarget === 'DISCOVERY' ? this.laneOptionsDiscovery : this.laneOptionsDefault;
    return options.some((option) => lanes[option.value].length > 0);
  }

  getLaneOptions(): Array<{ value: RecommendationLaneKey; label: string }> {
    return this.selectedTarget === 'DISCOVERY'
      ? this.laneOptionsDiscovery
      : this.laneOptionsDefault;
  }

  getDisplayTitle(item: RecommendationItem): string {
    const local = this.getLocalGame(item);
    if (local) {
      return local.customTitle?.trim() || local.title;
    }
    const metadata = this.getRecommendationDisplayMetadata(item);
    if (metadata) {
      return metadata.title;
    }
    return `Game #${item.igdbGameId}`;
  }

  getPlatformLabel(item: RecommendationItem): string {
    const mergedPlatformLabels = this.getMergedPlatformLabels(item);
    if (mergedPlatformLabels) {
      return mergedPlatformLabels;
    }

    const detail = this.getLocalGame(item);

    if (!detail) {
      const metadata = this.getRecommendationDisplayMetadata(item);
      return metadata?.platformLabel ?? `Platform ${String(item.platformIgdbId)}`;
    }

    if (detail.platform && detail.platform.trim().length > 0) {
      return this.getPlatformDisplayName(detail.platform, detail.platformIgdbId);
    }

    return 'Unknown platform';
  }

  getReleaseYear(item: RecommendationItem): number | null {
    const local = this.getLocalGame(item);
    if (local) {
      return local.releaseYear;
    }

    return this.getRecommendationDisplayMetadata(item)?.releaseYear ?? null;
  }

  getCoverUrl(item: RecommendationItem): string {
    const local = this.getLocalGame(item);
    if (local) {
      return local.customCoverUrl ?? local.coverUrl ?? 'assets/icon/placeholder.png';
    }

    const metadata = this.getRecommendationDisplayMetadata(item);
    return metadata?.coverUrl ?? 'assets/icon/placeholder.png';
  }

  getScoreBadge(item: RecommendationItem): RecommendationBadge {
    return { text: `Score ${item.scoreTotal.toFixed(2)}`, color: 'primary' };
  }

  getConfidenceBadge(item: RecommendationItem): RecommendationBadge {
    const positiveSignal =
      Math.max(0, item.scoreComponents.taste) +
      Math.max(0, item.scoreComponents.semantic) +
      Math.max(0, item.scoreComponents.criticBoost);
    const penalties =
      Math.abs(Math.min(0, item.scoreComponents.diversityPenalty)) +
      Math.abs(Math.min(0, item.scoreComponents.repeatPenalty));
    const netSignal = positiveSignal - penalties;

    if (netSignal >= 2.5) {
      return { text: 'Confidence High', color: 'success' };
    }

    if (netSignal >= 1.2) {
      return { text: 'Confidence Medium', color: 'warning' };
    }

    return { text: 'Confidence Exploratory', color: 'medium' };
  }

  getLaneDescription(): string {
    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'popular') {
      return 'Popular prioritizes proven, high-signal games from your discovery feed.';
    }

    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'recent') {
      return 'Recent emphasizes newly released and near-term titles with quality signals.';
    }

    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'blended') {
      return 'Blended combines popular and recent discovery candidates into one ranked lane.';
    }

    if (this.selectedLaneKey === 'hiddenGems') {
      return 'Hidden Gems favors strong semantic alignment with lower critic bias.';
    }

    if (this.selectedLaneKey === 'exploration') {
      return 'Exploration emphasizes novel picks that still fit your profile.';
    }

    return 'Overall balances taste, semantic fit, runtime mode, and diversity penalties.';
  }

  getEmptyStateLaneIcon(): string {
    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'popular') {
      return 'library';
    }

    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'recent') {
      return 'time';
    }

    if (this.selectedTarget === 'DISCOVERY' && this.selectedLaneKey === 'blended') {
      return 'sparkles';
    }

    if (this.selectedLaneKey === 'hiddenGems') {
      return 'sparkles';
    }

    if (this.selectedLaneKey === 'exploration') {
      return 'compass';
    }

    return 'library';
  }

  hasExplanationDetails(item: RecommendationItem): boolean {
    return this.getExplanationBullets(item).length > 0;
  }

  getExplanationBullets(item: RecommendationItem): Array<{ label: string; delta: string }> {
    return item.explanations.bullets
      .filter((bullet) => Math.abs(bullet.delta) >= 0.01 && bullet.label.trim().length > 0)
      .slice(0, 4)
      .map((bullet) => ({
        label: bullet.label,
        delta: `${bullet.delta >= 0 ? '+' : ''}${bullet.delta.toFixed(2)}`
      }));
  }

  getHeadlineLines(headline: string | null | undefined): string[] {
    if (typeof headline !== 'string') {
      return [];
    }

    const normalized = headline.trim();
    if (normalized.length === 0) {
      return [];
    }

    const lines = normalized
      .split(/\s*[•;|]\s*/g)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    return lines.length > 0 ? lines : [normalized];
  }

  trackByRecommendationKey(_: number, item: RecommendationItem): string {
    return `${item.igdbGameId}:${String(item.platformIgdbId)}`;
  }

  onRecommendationRowClick(
    kind: 'recommendation' | 'similar',
    row: RecommendationItem | RecommendationSimilarItem,
    event: Event
  ): void {
    if (kind === 'similar') {
      void this.openSimilarRecommendation(row as RecommendationSimilarItem, event);
      return;
    }

    void this.openGameDetail(row as RecommendationItem);
  }

  async openGameDetail(
    item: RecommendationItem,
    options?: { pushCurrentToStack?: boolean }
  ): Promise<void> {
    const local = this.getLocalGame(item);
    const cachedCatalog = this.getRecommendationCatalogResult(item.igdbGameId);
    const initialCatalog = cachedCatalog
      ? this.withCatalogPlatformContext(cachedCatalog, item.platformIgdbId)
      : null;

    if (options?.pushCurrentToStack && this.activeDetailRecommendation) {
      this.detailNavigationStack.push(this.activeDetailRecommendation);
    }

    this.isGameDetailModalOpen = true;
    this.isLoadingDetail = !local && !initialCatalog;
    this.detailErrorMessage = '';
    this.detailContext = local ? 'library' : 'explore';
    this.isSelectedGameInLibrary = Boolean(local);
    this.isAddToLibraryLoading = false;
    this.activeDetailRecommendation = item;
    this.similarRecommendationItems = [];
    this.similarRecommendationsError = '';
    this.isLoadingSimilar = false;
    this.selectedGameDetail = local
      ? local
      : (initialCatalog ??
        this.createFallbackCatalogResult({
          igdbGameId: item.igdbGameId,
          platformIgdbId: item.platformIgdbId,
          title: this.getDisplayTitle(item)
        }));

    if (!local) {
      try {
        if (!initialCatalog) {
          const fetchedCatalog = await this.fetchRecommendationCatalogResult(item.igdbGameId);
          if (
            fetchedCatalog &&
            this.activeDetailRecommendation.igdbGameId === item.igdbGameId &&
            this.activeDetailRecommendation.platformIgdbId === item.platformIgdbId
          ) {
            this.selectedGameDetail = this.withCatalogPlatformContext(
              fetchedCatalog,
              item.platformIgdbId
            );
          }
        }

        this.isSelectedGameInLibrary = await this.checkGameAlreadyInLibrary(
          this.selectedGameDetail
        );
      } catch (error) {
        this.detailErrorMessage =
          error instanceof Error ? error.message : 'Unable to load game details.';
      } finally {
        this.isLoadingDetail = false;
      }
    }

    void this.loadSimilarRecommendations(item);
    if (local) {
      this.isLoadingDetail = false;
    }
  }

  closeGameDetailModal(): void {
    this.isGameDetailModalOpen = false;
    this.isRatingModalOpen = false;
    this.ratingDraft = 3;
    this.clearRatingOnSave = false;
    this.isLoadingDetail = false;
    this.detailErrorMessage = '';
    this.selectedGameDetail = null;
    this.detailContext = 'explore';
    this.isSelectedGameInLibrary = false;
    this.isAddToLibraryLoading = false;
    this.activeDetailRecommendation = null;
    this.detailNavigationStack = [];
    this.isLoadingSimilar = false;
    this.similarRecommendationsError = '';
    this.similarRecommendationItems = [];
  }

  async addSelectedGameToLibrary(): Promise<void> {
    if (
      this.detailContext !== 'explore' ||
      this.isSelectedGameInLibrary ||
      this.isAddToLibraryLoading ||
      !this.selectedGameDetail
    ) {
      return;
    }

    const listType = await this.pickListTypeForAdd();

    if (!listType) {
      return;
    }

    this.isAddToLibraryLoading = true;

    try {
      const addResult = await this.addToLibraryWorkflow.addToLibrary(
        this.selectedGameDetail as GameCatalogResult,
        listType
      );

      if (addResult.status === 'added' && addResult.entry) {
        this.selectedGameDetail = addResult.entry;
        this.detailContext = 'library';
        this.isSelectedGameInLibrary = true;
      } else if (addResult.status === 'duplicate') {
        this.isSelectedGameInLibrary = true;
      }
    } finally {
      this.isAddToLibraryLoading = false;
    }
  }

  async onDetailStatusChange(value: GameStatus | null | undefined): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const normalized = normalizeGameStatus(value);

    try {
      const updated = await this.gameShelfService.setGameStatus(
        selected.igdbGameId,
        selected.platformIgdbId,
        normalized
      );
      this.selectedGameDetail = updated;
    } catch {
      await this.presentToast('Unable to update game status.', 'danger');
    }
  }

  async clearDetailStatus(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameStatus(
        selected.igdbGameId,
        selected.platformIgdbId,
        null
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Game status cleared.');
    } catch {
      await this.presentToast('Unable to clear game status.', 'danger');
    }
  }

  openDetailRatingModal(): void {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const currentRating = normalizeGameRating(selected.rating);
    this.ratingDraft = currentRating ?? 3;
    this.clearRatingOnSave = false;
    this.isRatingModalOpen = true;
  }

  closeRatingModal(): void {
    this.isRatingModalOpen = false;
    this.ratingDraft = 3;
    this.clearRatingOnSave = false;
  }

  onRatingRangeChange(event: Event): void {
    const customEvent = event as CustomEvent<{ value?: number | null }>;
    const rawValue = customEvent.detail.value;
    const snappedValue =
      typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? Math.round(rawValue * 2) / 2
        : rawValue;
    const normalized = normalizeGameRating(snappedValue);

    if (normalized === null) {
      return;
    }

    this.ratingDraft = normalized;
    this.clearRatingOnSave = false;
  }

  markRatingForClear(): void {
    this.clearRatingOnSave = true;
  }

  readonly formatRatingPin = (value: number): string => {
    return this.formatRatingValue(Math.round(value * 2) / 2);
  };

  formatRatingValue(value: number): string {
    return value.toFixed(1).replace(/\.0$/, '');
  }

  async saveDetailRatingFromModal(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const nextRating = this.clearRatingOnSave ? null : this.ratingDraft;

    try {
      const updated = await this.gameShelfService.setGameRating(
        selected.igdbGameId,
        selected.platformIgdbId,
        nextRating
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Game rating updated.');
      this.closeRatingModal();
    } catch {
      await this.presentToast('Unable to update game rating.', 'danger');
    }
  }

  async openDetailTags(): Promise<void> {
    const selected = this.selectedGameDetail;

    if (!this.isLibraryEntry(selected)) {
      return;
    }

    const tags = await this.gameShelfService.listTags();

    if (tags.length === 0) {
      await this.presentToast('Create a tag first from the Tags page.');
      return;
    }

    const existingTagIds = Array.isArray(selected.tagIds)
      ? selected.tagIds.filter((id) => Number.isInteger(id) && id > 0)
      : [];
    let nextTagIds = existingTagIds;
    const alert = await this.alertController.create({
      header: 'Set Tags',
      message: `Update tags for ${selected.title}.`,
      inputs: tags.map((tag) => buildTagInput(tag, existingTagIds)),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Apply',
          role: 'confirm',
          handler: (value: string[] | string | null | undefined) => {
            nextTagIds = parseTagSelection(value);
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return;
    }

    try {
      const updated = await this.gameShelfService.setGameTags(
        selected.igdbGameId,
        selected.platformIgdbId,
        nextTagIds
      );
      this.selectedGameDetail = updated;
      await this.presentToast('Tags updated.');
    } catch {
      await this.presentToast('Unable to update tags.', 'danger');
    }
  }

  openShortcutSearch(provider: 'google' | 'youtube' | 'wikipedia' | 'gamefaqs'): void {
    const query = this.selectedGameDetail?.title.trim();

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

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }

  private async loadRecommendationLanes(forceRefresh: boolean): Promise<void> {
    if (!this.recommendationFeatureEnabled) {
      return;
    }

    const cacheKey = this.buildCacheKey(this.selectedTarget, this.selectedRuntimeMode);
    const cached = this.lanesCache.get(cacheKey);

    if (!forceRefresh && cached) {
      this.activeLanesResponse = cached;
      this.recommendationError = '';
      this.recommendationErrorCode = 'NONE';
      return;
    }

    this.isLoadingRecommendations = true;
    this.recommendationError = '';
    this.recommendationErrorCode = 'NONE';

    try {
      const [response, localGames] = await Promise.all([
        firstValueFrom(
          this.igdbProxyService.getRecommendationLanes({
            target: this.selectedTarget,
            runtimeMode: this.selectedRuntimeMode,
            limit: ExplorePage.LANE_LIMIT
          })
        ),
        this.gameShelfService.listLibraryGames()
      ]);

      this.activeLanesResponse = response;
      this.lanesCache.set(cacheKey, response);
      this.replaceLocalGameCache(localGames);
      await this.ensureRecommendationDisplayMetadata(response);
    } catch (error) {
      const normalized = this.normalizeRecommendationError(error);
      this.recommendationError = normalized.message;
      this.recommendationErrorCode = normalized.code;

      if (!cached) {
        this.activeLanesResponse = null;
      }
    } finally {
      this.isLoadingRecommendations = false;
    }
  }

  getEmptyStateMessage(): string {
    if (this.hasAnyLaneItems()) {
      return 'This lane has no items for the current target and runtime mode.';
    }

    if (this.recommendationErrorCode === 'NOT_FOUND') {
      return 'No materialized recommendations exist yet for this target.';
    }

    return 'No recommendation items available right now.';
  }

  getEmptyStateHint(): string {
    const laneLabel =
      this.getLaneOptions().find((option) => option.value === this.selectedLaneKey)?.label ??
      'Overall';

    return `Try ${laneLabel} with ${this.selectedRuntimeMode.toLowerCase()} runtime, or switch target.`;
  }

  getEmptyStateTokenHint(): string {
    const lanes = this.activeLanesResponse?.lanes;
    if (!lanes) {
      return '';
    }

    const tokens = new Set<string>();
    const allItems = this.getLaneOptions().flatMap((option) => lanes[option.value]);
    for (const item of allItems) {
      for (const theme of item.explanations.matchedTokens.themes.slice(0, 1)) {
        tokens.add(theme);
      }
      for (const keyword of item.explanations.matchedTokens.keywords.slice(0, 1)) {
        tokens.add(keyword);
      }
      if (tokens.size >= 3) {
        break;
      }
    }

    if (tokens.size === 0) {
      return '';
    }

    return `Try lanes with signals like ${Array.from(tokens).join(', ')}.`;
  }

  getSimilarTitle(item: RecommendationSimilarItem): string {
    const local = this.getLocalGameByIdentity(item.igdbGameId, item.platformIgdbId);
    if (local?.customTitle?.trim()) {
      return local.customTitle.trim();
    }
    if (local?.title) {
      return local.title;
    }

    const metadata = this.getRecommendationDisplayMetadata({
      igdbGameId: item.igdbGameId,
      platformIgdbId: item.platformIgdbId
    });
    return metadata?.title ?? `Game #${item.igdbGameId}`;
  }

  getSimilarCoverUrl(item: RecommendationSimilarItem): string {
    const local = this.getLocalGameByIdentity(item.igdbGameId, item.platformIgdbId);
    if (local?.customCoverUrl || local?.coverUrl) {
      return local.customCoverUrl ?? local.coverUrl ?? 'assets/icon/placeholder.png';
    }

    const metadata = this.getRecommendationDisplayMetadata({
      igdbGameId: item.igdbGameId,
      platformIgdbId: item.platformIgdbId
    });
    return metadata?.coverUrl ?? 'assets/icon/placeholder.png';
  }

  getSimilarContext(item: RecommendationSimilarItem): string {
    const local = this.getLocalGameByIdentity(item.igdbGameId, item.platformIgdbId);

    if (!local) {
      const metadata = this.getRecommendationDisplayMetadata({
        igdbGameId: item.igdbGameId,
        platformIgdbId: item.platformIgdbId
      });
      return metadata?.platformLabel ?? `Platform ${String(item.platformIgdbId)}`;
    }

    const platform = this.getPlatformDisplayName(local.platform, local.platformIgdbId);
    if (local.releaseYear === null) {
      return platform;
    }

    return `${platform} • ${String(local.releaseYear)}`;
  }

  getSimilarReasonBadges(item: RecommendationSimilarItem): RecommendationBadge[] {
    return [{ text: `Blend ${item.similarity.toFixed(2)}`, color: 'primary' }];
  }

  async openSimilarRecommendation(item: RecommendationSimilarItem, event?: Event): Promise<void> {
    event?.stopPropagation();
    const existing = this.findRecommendationItem(item.igdbGameId, item.platformIgdbId);
    const fallback: RecommendationItem = {
      rank: 0,
      igdbGameId: item.igdbGameId,
      platformIgdbId: item.platformIgdbId,
      scoreTotal: item.similarity,
      scoreComponents: {
        taste: 0,
        novelty: 0,
        runtimeFit: 0,
        criticBoost: 0,
        recencyBoost: 0,
        semantic: item.reasons.semanticSimilarity,
        exploration: 0,
        diversityPenalty: 0,
        repeatPenalty: 0
      },
      explanations: {
        headline: item.reasons.summary,
        bullets: [],
        matchedTokens: {
          genres: item.reasons.sharedTokens.genres,
          developers: item.reasons.sharedTokens.developers,
          publishers: item.reasons.sharedTokens.publishers,
          franchises: item.reasons.sharedTokens.franchises,
          collections: item.reasons.sharedTokens.collections,
          themes: item.reasons.sharedTokens.themes,
          keywords: item.reasons.sharedTokens.keywords
        }
      }
    };

    await this.openGameDetail(existing ?? fallback, { pushCurrentToStack: true });
  }

  goBackInDetailNavigation(): void {
    const previous = this.detailNavigationStack.pop();
    if (!previous) {
      return;
    }

    void this.openGameDetail(previous);
  }

  private parseRecommendationTarget(value: unknown): RecommendationTarget | null {
    if (value === 'BACKLOG' || value === 'WISHLIST' || value === 'DISCOVERY') {
      return value;
    }

    return null;
  }

  private parseRuntimeMode(value: unknown): RecommendationRuntimeMode | null {
    if (value === 'NEUTRAL' || value === 'SHORT' || value === 'LONG') {
      return value;
    }

    return null;
  }

  private parseLaneKey(value: unknown): RecommendationLaneKey | null {
    if (
      value === 'overall' ||
      value === 'hiddenGems' ||
      value === 'exploration' ||
      value === 'blended' ||
      value === 'popular' ||
      value === 'recent'
    ) {
      return value;
    }

    return null;
  }

  private buildCacheKey(
    target: RecommendationTarget,
    runtimeMode: RecommendationRuntimeMode
  ): string {
    return `${target}:${runtimeMode}`;
  }

  private replaceLocalGameCache(entries: GameEntry[]): void {
    this.localGameCacheByIdentity.clear();
    for (const entry of entries) {
      this.localGameCacheByIdentity.set(
        this.buildIdentityKey(entry.igdbGameId, entry.platformIgdbId),
        entry
      );
    }
  }

  private getLocalGame(item: RecommendationItem): GameEntry | null {
    return this.getLocalGameByIdentity(item.igdbGameId, item.platformIgdbId);
  }

  private getRawActiveLaneItems(): RecommendationItem[] {
    const lanes = this.activeLanesResponse?.lanes;
    if (!lanes) {
      return [];
    }
    return lanes[this.selectedLaneKey];
  }

  private getDeduplicatedLaneItems(items: RecommendationItem[]): RecommendationItem[] {
    if (items.length <= 1) {
      return items;
    }

    const deduplicated: RecommendationItem[] = [];
    const seenGameIds = new Set<string>();

    for (const item of items) {
      if (seenGameIds.has(item.igdbGameId)) {
        continue;
      }

      seenGameIds.add(item.igdbGameId);
      deduplicated.push(item);
    }

    return deduplicated;
  }

  private getMergedPlatformLabels(item: RecommendationItem): string | null {
    const rawItems = this.getRawActiveLaneItems().filter(
      (candidate) => candidate.igdbGameId === item.igdbGameId
    );

    if (rawItems.length <= 1) {
      return null;
    }

    const labelSet = new Set<string>();
    for (const candidate of rawItems) {
      const local = this.getLocalGame(candidate);
      if (local && local.platform.trim().length > 0) {
        labelSet.add(this.getPlatformDisplayName(local.platform, local.platformIgdbId));
        continue;
      }

      const metadata = this.getRecommendationDisplayMetadata(candidate);
      if (metadata?.platformLabel) {
        labelSet.add(metadata.platformLabel);
        continue;
      }

      labelSet.add(`Platform ${String(candidate.platformIgdbId)}`);
    }

    if (labelSet.size === 0) {
      return null;
    }

    return Array.from(labelSet).join(' / ');
  }

  private getRecommendationDisplayMetadata(item: {
    igdbGameId: string;
    platformIgdbId: number;
  }): RecommendationDisplayMetadata | null {
    return (
      this.recommendationDisplayMetadata.get(
        this.buildIdentityKey(item.igdbGameId, item.platformIgdbId)
      ) ?? null
    );
  }

  private getRecommendationCatalogResult(igdbGameId: string): GameCatalogResult | null {
    return this.recommendationCatalogCache.get(igdbGameId) ?? null;
  }

  private getLocalGameByIdentity(igdbGameId: string, platformIgdbId: number): GameEntry | null {
    return (
      this.localGameCacheByIdentity.get(this.buildIdentityKey(igdbGameId, platformIgdbId)) ?? null
    );
  }

  private buildIdentityKey(igdbGameId: string, platformIgdbId: number): string {
    return `${igdbGameId}::${String(platformIgdbId)}`;
  }

  private createFallbackCatalogResult(params: {
    igdbGameId: string;
    platformIgdbId: number;
    title: string;
  }): GameCatalogResult {
    return {
      igdbGameId: params.igdbGameId,
      title: params.title,
      coverUrl: null,
      coverSource: 'none',
      storyline: null,
      summary: null,
      gameType: null,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null,
      reviewScore: null,
      reviewUrl: null,
      reviewSource: null,
      mobyScore: null,
      mobygamesGameId: null,
      metacriticScore: null,
      metacriticUrl: null,
      similarGameIgdbIds: [],
      collections: [],
      developers: [],
      franchises: [],
      genres: [],
      themes: [],
      themeIds: [],
      keywords: [],
      keywordIds: [],
      publishers: [],
      platforms: [],
      platformOptions: [
        { id: params.platformIgdbId, name: `Platform ${String(params.platformIgdbId)}` }
      ],
      platform: null,
      platformIgdbId: params.platformIgdbId,
      releaseDate: null,
      releaseYear: null
    };
  }

  private async loadSimilarRecommendations(item: RecommendationItem): Promise<void> {
    this.isLoadingSimilar = true;
    this.similarRecommendationsError = '';

    try {
      const response = await firstValueFrom(
        this.igdbProxyService.getRecommendationSimilar({
          target: this.selectedTarget,
          igdbGameId: item.igdbGameId,
          platformIgdbId: item.platformIgdbId,
          limit: 6
        })
      );

      this.similarRecommendationItems = response.items.filter(
        (candidate) =>
          !(
            candidate.igdbGameId === item.igdbGameId &&
            candidate.platformIgdbId === item.platformIgdbId
          )
      );
      await this.ensureSimilarDisplayMetadata(this.similarRecommendationItems);
    } catch (error) {
      const normalized = this.normalizeRecommendationError(error);
      this.similarRecommendationsError = normalized.message;
      this.similarRecommendationItems = [];
    } finally {
      this.isLoadingSimilar = false;
    }
  }

  private findRecommendationItem(
    igdbGameId: string,
    platformIgdbId: number
  ): RecommendationItem | null {
    const lanes = this.activeLanesResponse?.lanes;
    if (!lanes) {
      return null;
    }

    for (const lane of [
      lanes.overall,
      lanes.hiddenGems,
      lanes.exploration,
      lanes.blended,
      lanes.popular,
      lanes.recent
    ]) {
      const match =
        lane.find(
          (item) => item.igdbGameId === igdbGameId && item.platformIgdbId === platformIgdbId
        ) ?? null;
      if (match) {
        return match;
      }
    }

    return null;
  }

  private normalizeRecommendationError(error: unknown): {
    message: string;
    code: 'NOT_FOUND' | 'RATE_LIMITED' | 'REQUEST_FAILED';
  } {
    const fallback = {
      code: 'REQUEST_FAILED' as const,
      message: 'Unable to load recommendations right now.'
    };

    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return {
          code: 'NOT_FOUND',
          message: 'No recommendations available yet. Build recommendations to get started.'
        };
      }

      if (error.status === 429) {
        return {
          code: 'RATE_LIMITED',
          message: 'Recommendations are in cooldown. Try again later.'
        };
      }

      return fallback;
    }

    if (error instanceof Error) {
      const typed = error as RecommendationApiError;

      if (typed.code === 'NOT_FOUND') {
        return {
          code: 'NOT_FOUND',
          message: error.message
        };
      }

      if (typed.code === 'RATE_LIMITED') {
        return {
          code: 'RATE_LIMITED',
          message: error.message
        };
      }

      if (error.message.trim().length > 0) {
        return {
          code: fallback.code,
          message: error.message
        };
      }
    }

    return fallback;
  }

  private getPlatformDisplayName(name: string, platformIgdbId: number | null): string {
    if (name.trim().length > 0) {
      const aliased = this.platformCustomizationService
        .getDisplayNameWithoutAlias(name, platformIgdbId)
        .trim();

      if (aliased.length > 0) {
        return aliased;
      }
    }

    return 'Unknown platform';
  }

  private async ensureRecommendationDisplayMetadata(
    response: RecommendationLanesResponse
  ): Promise<void> {
    const groupedPlatformIds = new Map<string, Set<number>>();
    const allItems = Object.values(response.lanes).flat();

    for (const item of allItems) {
      if (this.getLocalGame(item)) {
        continue;
      }

      const key = this.buildIdentityKey(item.igdbGameId, item.platformIgdbId);
      if (this.recommendationDisplayMetadata.has(key)) {
        continue;
      }

      const existingGroup = groupedPlatformIds.get(item.igdbGameId);
      if (existingGroup) {
        existingGroup.add(item.platformIgdbId);
      } else {
        groupedPlatformIds.set(item.igdbGameId, new Set([item.platformIgdbId]));
      }
    }

    if (groupedPlatformIds.size === 0) {
      return;
    }

    await this.populateRecommendationDisplayMetadata(groupedPlatformIds);
  }

  private async ensureSimilarDisplayMetadata(items: RecommendationSimilarItem[]): Promise<void> {
    const groupedPlatformIds = new Map<string, Set<number>>();
    for (const item of items) {
      if (this.getLocalGameByIdentity(item.igdbGameId, item.platformIgdbId)) {
        continue;
      }

      const identityKey = this.buildIdentityKey(item.igdbGameId, item.platformIgdbId);
      if (this.recommendationDisplayMetadata.has(identityKey)) {
        continue;
      }

      const existing = groupedPlatformIds.get(item.igdbGameId);
      if (existing) {
        existing.add(item.platformIgdbId);
      } else {
        groupedPlatformIds.set(item.igdbGameId, new Set([item.platformIgdbId]));
      }
    }

    if (groupedPlatformIds.size === 0) {
      return;
    }

    await this.populateRecommendationDisplayMetadata(groupedPlatformIds);
  }

  private async populateRecommendationDisplayMetadata(
    groupedPlatformIds: Map<string, Set<number>>
  ): Promise<void> {
    const groupedEntries = Array.from(groupedPlatformIds.entries());
    const batchSize = 4;

    for (let index = 0; index < groupedEntries.length; index += batchSize) {
      const batch = groupedEntries.slice(index, index + batchSize);
      await Promise.all(
        batch.map(async ([igdbGameId, platformIds]) => {
          const catalog =
            this.recommendationCatalogCache.get(igdbGameId) ??
            (await this.fetchRecommendationCatalogResult(igdbGameId));

          if (!catalog) {
            return;
          }

          for (const platformIgdbId of platformIds) {
            const key = this.buildIdentityKey(igdbGameId, platformIgdbId);
            this.recommendationDisplayMetadata.set(key, {
              title: catalog.title.trim().length > 0 ? catalog.title : `Game #${igdbGameId}`,
              coverUrl: catalog.coverUrl,
              platformLabel: this.resolveCatalogPlatformLabel(catalog, platformIgdbId),
              releaseYear: catalog.releaseYear ?? null
            });
          }
        })
      );
    }
  }

  private async fetchRecommendationCatalogResult(
    igdbGameId: string
  ): Promise<GameCatalogResult | null> {
    try {
      const catalog = await firstValueFrom(this.igdbProxyService.getGameById(igdbGameId));
      this.recommendationCatalogCache.set(igdbGameId, catalog);
      return catalog;
    } catch {
      return null;
    }
  }

  private withCatalogPlatformContext(
    catalog: GameCatalogResult,
    platformIgdbId: number
  ): GameCatalogResult {
    const platformOption = Array.isArray(catalog.platformOptions)
      ? (catalog.platformOptions.find((option) => option.id === platformIgdbId) ?? null)
      : null;
    const selectedPlatformName =
      platformOption?.name.trim() ??
      (catalog.platformIgdbId === platformIgdbId &&
      typeof catalog.platform === 'string' &&
      catalog.platform.trim().length > 0
        ? catalog.platform.trim()
        : null);

    return {
      ...catalog,
      platformIgdbId,
      platform: selectedPlatformName
    };
  }

  private resolveCatalogPlatformLabel(catalog: GameCatalogResult, platformIgdbId: number): string {
    if (
      catalog.platformIgdbId === platformIgdbId &&
      typeof catalog.platform === 'string' &&
      catalog.platform.trim().length > 0
    ) {
      return this.getPlatformDisplayName(catalog.platform, platformIgdbId);
    }

    const option = Array.isArray(catalog.platformOptions)
      ? catalog.platformOptions.find(
          (candidate) =>
            candidate.id === platformIgdbId &&
            typeof candidate.name === 'string' &&
            candidate.name.trim().length > 0
        )
      : null;

    if (option) {
      return this.getPlatformDisplayName(option.name, platformIgdbId);
    }

    if (typeof catalog.platform === 'string' && catalog.platform.trim().length > 0) {
      return this.getPlatformDisplayName(catalog.platform, platformIgdbId);
    }

    return `Platform ${String(platformIgdbId)}`;
  }

  private async completeRefresher(event: Event): Promise<void> {
    const target = event.target as HTMLIonRefresherElement | null;

    if (!target || typeof target.complete !== 'function') {
      return;
    }

    await target.complete();
  }

  private async pickListTypeForAdd(): Promise<ListType | null> {
    let selected: ListType = 'collection';
    const alert = await this.alertController.create({
      header: 'Add to Library',
      message: 'Choose where to add this game.',
      inputs: [
        {
          type: 'radio',
          label: 'Collection',
          value: 'collection',
          checked: true
        },
        {
          type: 'radio',
          label: 'Wishlist',
          value: 'wishlist',
          checked: false
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Add',
          role: 'confirm',
          handler: (value: string) => {
            selected = value === 'wishlist' ? 'wishlist' : 'collection';
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return null;
    }

    return selected;
  }

  private async checkGameAlreadyInLibrary(game: GameCatalogResult | GameEntry): Promise<boolean> {
    if (this.isLibraryEntry(game)) {
      return true;
    }

    const platformIgdbIds = this.collectPlatformIgdbIds(game);

    if (platformIgdbIds.length === 0) {
      return false;
    }

    for (const platformIgdbId of platformIgdbIds) {
      const existing = await this.gameShelfService.findGameByIdentity(
        game.igdbGameId,
        platformIgdbId
      );

      if (existing) {
        return true;
      }
    }

    return false;
  }

  private collectPlatformIgdbIds(game: GameCatalogResult | GameEntry): number[] {
    const ids = new Set<number>();
    const catalogLike = game as Partial<GameCatalogResult>;

    if (Number.isInteger(game.platformIgdbId) && (game.platformIgdbId as number) > 0) {
      ids.add(game.platformIgdbId as number);
    }

    if (Array.isArray(catalogLike.platformOptions)) {
      for (const option of catalogLike.platformOptions) {
        if (Number.isInteger(option.id) && (option.id as number) > 0) {
          ids.add(option.id as number);
        }
      }
    }

    return Array.from(ids);
  }

  private isLibraryEntry(value: GameCatalogResult | GameEntry | null): value is GameEntry {
    if (!value) {
      return false;
    }

    return (
      (value as GameEntry).listType === 'collection' || (value as GameEntry).listType === 'wishlist'
    );
  }

  private async presentToast(
    message: string,
    color: 'primary' | 'danger' = 'primary'
  ): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color
    });

    await toast.present();
  }

  private openExternalUrl(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer external';
    anchor.click();
  }
}
