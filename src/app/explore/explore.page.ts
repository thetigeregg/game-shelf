import { Component, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  AlertController,
  ToastController,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonSelect,
  IonSelectOption,
  IonButton,
  IonButtons,
  IonLoading,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonText,
  IonFab,
  IonFabButton,
  IonFabList,
  IonIcon,
  IonRange,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonRefresher,
  IonRefresherContent,
  IonChip
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
  RecommendationTarget
} from '../core/models/game.models';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { GameDetailContentComponent } from '../features/game-detail/game-detail-content.component';
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
import { search, logoGoogle, logoYoutube, star, starOutline } from 'ionicons/icons';

interface RecommendationApiError extends Error {
  code?: string;
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
    IonSelect,
    IonSelectOption,
    IonButton,
    IonButtons,
    IonLoading,
    IonSpinner,
    IonList,
    IonText,
    IonFab,
    IonFabButton,
    IonFabList,
    IonIcon,
    IonRange,
    IonNote,
    IonSegment,
    IonSegmentButton,
    IonRefresher,
    IonRefresherContent,
    IonChip,
    GameDetailContentComponent
  ]
})
export class ExplorePage implements OnInit {
  private static readonly LANE_LIMIT = 20;

  readonly recommendationFeatureEnabled = isRecommendationsExploreEnabled();
  readonly targetOptions: Array<{ value: RecommendationTarget; label: string }> = [
    { value: 'BACKLOG', label: 'Backlog' },
    { value: 'WISHLIST', label: 'Wishlist' }
  ];
  readonly runtimeModeOptions: Array<{ value: RecommendationRuntimeMode; label: string }> = [
    { value: 'SHORT', label: 'Short' },
    { value: 'NEUTRAL', label: 'Neutral' },
    { value: 'LONG', label: 'Long' }
  ];
  readonly laneOptions: Array<{ value: RecommendationLaneKey; label: string }> = [
    { value: 'overall', label: 'Overall' },
    { value: 'hiddenGems', label: 'Hidden Gems' },
    { value: 'exploration', label: 'Exploration' }
  ];

  selectedTarget: RecommendationTarget = 'BACKLOG';
  selectedRuntimeMode: RecommendationRuntimeMode = 'NEUTRAL';
  selectedLaneKey: RecommendationLaneKey = 'overall';
  activeLanesResponse: RecommendationLanesResponse | null = null;
  isLoadingRecommendations = false;
  isRebuildLoading = false;
  recommendationError = '';
  recommendationErrorCode: 'NONE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'REQUEST_FAILED' = 'NONE';

  isGameDetailModalOpen = false;
  isLoadingDetail = false;
  detailErrorMessage = '';
  selectedGameDetail: GameCatalogResult | GameEntry | null = null;
  detailContext: 'explore' | 'library' = 'explore';
  isSelectedGameInLibrary = false;
  isAddToLibraryLoading = false;
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
  private readonly detailCache = new Map<string, GameCatalogResult>();

  constructor() {
    addIcons({ search, logoGoogle, logoYoutube, star, starOutline });
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

  async rebuildRecommendations(force = true): Promise<void> {
    if (this.isRebuildLoading || !this.recommendationFeatureEnabled) {
      return;
    }

    this.isRebuildLoading = true;

    try {
      const response = await firstValueFrom(
        this.igdbProxyService.rebuildRecommendations({
          target: this.selectedTarget,
          force
        })
      );

      if (response.status === 'FAILED') {
        await this.presentToast('Recommendation rebuild failed.', 'danger');
        return;
      }

      if (response.status === 'BACKOFF_SKIPPED') {
        await this.presentToast('Rebuild is in cooldown. Try again later.', 'danger');
        return;
      }

      await this.presentToast('Recommendation rebuild started.');
      await this.loadRecommendationLanes(true);
    } catch (error) {
      const mapped = this.normalizeRecommendationError(error);
      await this.presentToast(mapped.message, 'danger');
    } finally {
      this.isRebuildLoading = false;
    }
  }

  getActiveLaneItems(): RecommendationItem[] {
    const lanes = this.activeLanesResponse?.lanes;

    if (!lanes) {
      return [];
    }

    return lanes[this.selectedLaneKey];
  }

  hasAnyLaneItems(): boolean {
    const lanes = this.activeLanesResponse?.lanes;

    if (!lanes) {
      return false;
    }

    return lanes.overall.length > 0 || lanes.hiddenGems.length > 0 || lanes.exploration.length > 0;
  }

  getDisplayTitle(item: RecommendationItem): string {
    return this.getCachedDetail(item)?.title ?? `Game #${item.igdbGameId}`;
  }

  getPlatformLabel(item: RecommendationItem): string {
    const detail = this.getCachedDetail(item);

    if (!detail) {
      return `Platform ${String(item.platformIgdbId)}`;
    }

    if (detail.platform && detail.platform.trim().length > 0) {
      return this.getPlatformDisplayName(
        detail.platform,
        detail.platformIgdbId ?? item.platformIgdbId
      );
    }

    if (Array.isArray(detail.platformOptions) && detail.platformOptions.length > 0) {
      const option = detail.platformOptions.find((platform) => platform.id === item.platformIgdbId);

      if (option && option.name.trim().length > 0) {
        return this.getPlatformDisplayName(option.name, option.id);
      }

      if (detail.platformOptions.length === 1) {
        return this.getPlatformDisplayName(
          detail.platformOptions[0].name,
          detail.platformOptions[0].id
        );
      }

      return `${String(detail.platformOptions.length)} platforms`;
    }

    return 'Unknown platform';
  }

  getReleaseYear(item: RecommendationItem): number | null {
    return this.getCachedDetail(item)?.releaseYear ?? null;
  }

  getCoverUrl(item: RecommendationItem): string {
    return this.getCachedDetail(item)?.coverUrl ?? 'assets/icon/placeholder.png';
  }

  getScoreChips(item: RecommendationItem): string[] {
    const chips: string[] = [`Score ${item.scoreTotal.toFixed(2)}`];
    const components = item.scoreComponents;
    const candidates: Array<{ key: string; value: number }> = [
      { key: 'Taste', value: components.taste },
      { key: 'Semantic', value: components.semantic },
      { key: 'Runtime', value: components.runtimeFit },
      { key: 'Critic', value: components.criticBoost },
      { key: 'Exploration', value: components.exploration }
    ];

    for (const candidate of candidates) {
      if (Math.abs(candidate.value) < 0.01) {
        continue;
      }

      chips.push(`${candidate.key} ${candidate.value.toFixed(2)}`);

      if (chips.length >= 4) {
        break;
      }
    }

    return chips;
  }

  getExplanationHeadline(item: RecommendationItem): string {
    const headline = item.explanations.headline.trim();
    return headline && headline.length > 0 ? headline : 'Recommended by your profile signals';
  }

  trackByRecommendationKey(_: number, item: RecommendationItem): string {
    return `${item.igdbGameId}:${String(item.platformIgdbId)}`;
  }

  async openGameDetail(item: RecommendationItem): Promise<void> {
    const cached = this.getCachedDetail(item);

    this.isGameDetailModalOpen = true;
    this.isLoadingDetail = true;
    this.detailErrorMessage = '';
    this.detailContext = 'explore';
    this.isSelectedGameInLibrary = false;
    this.isAddToLibraryLoading = false;
    this.selectedGameDetail =
      cached ??
      this.createFallbackCatalogResult({
        igdbGameId: item.igdbGameId,
        platformIgdbId: item.platformIgdbId,
        title: `Game #${item.igdbGameId}`
      });

    try {
      this.isSelectedGameInLibrary = await this.checkGameAlreadyInLibrary(this.selectedGameDetail);
      const detail = await firstValueFrom(this.igdbProxyService.getGameById(item.igdbGameId));
      this.selectedGameDetail = detail;
      this.cacheDetail(detail);
      this.isSelectedGameInLibrary = await this.checkGameAlreadyInLibrary(detail);
    } catch (error) {
      this.detailErrorMessage =
        error instanceof Error ? error.message : 'Unable to load game details.';
    } finally {
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
      const response = await firstValueFrom(
        this.igdbProxyService.getRecommendationLanes({
          target: this.selectedTarget,
          runtimeMode: this.selectedRuntimeMode,
          limit: ExplorePage.LANE_LIMIT
        })
      );

      this.activeLanesResponse = response;
      this.lanesCache.set(cacheKey, response);
      await this.hydrateDetailCache(response);
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

  private async hydrateDetailCache(response: RecommendationLanesResponse): Promise<void> {
    const ids = new Set<string>();

    for (const laneKey of ['overall', 'hiddenGems', 'exploration'] as RecommendationLaneKey[]) {
      for (const item of response.lanes[laneKey]) {
        ids.add(item.igdbGameId);
      }
    }

    const pending: Promise<void>[] = [];

    for (const igdbGameId of ids) {
      if (this.detailCache.has(igdbGameId)) {
        continue;
      }

      pending.push(
        firstValueFrom(this.igdbProxyService.getGameById(igdbGameId))
          .then((detail) => {
            this.cacheDetail(detail);
          })
          .catch(() => {
            // Ignore detail hydration failures; card falls back to ids.
          })
      );
    }

    await Promise.all(pending);
  }

  private parseRecommendationTarget(value: unknown): RecommendationTarget | null {
    if (value === 'BACKLOG' || value === 'WISHLIST') {
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
    if (value === 'overall' || value === 'hiddenGems' || value === 'exploration') {
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

  private cacheDetail(detail: GameCatalogResult): void {
    this.detailCache.set(detail.igdbGameId, detail);
  }

  private getCachedDetail(item: RecommendationItem): GameCatalogResult | null {
    const cached = this.detailCache.get(item.igdbGameId);
    return cached ?? null;
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
