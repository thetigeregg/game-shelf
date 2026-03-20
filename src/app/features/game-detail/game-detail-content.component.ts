import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonButtons,
  IonCol,
  IonGrid,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonRow,
  IonSelect,
  IonSelectOption,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add,
  ban,
  cash,
  build,
  business,
  calendar,
  documentText,
  gameController,
  gitBranch,
  grid,
  hardwareChip,
  book,
  library,
  medal,
  pricetags,
  star,
  time,
  trophy,
} from 'ionicons/icons';
import {
  GameCatalogResult,
  GameEntry,
  GameRating,
  GameScreenshot,
  GameStatus,
} from '../../core/models/game.models';
import SwiperClass from 'swiper';
import { Pagination, Zoom } from 'swiper/modules';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { detectReviewSourceFromUrl } from '../../core/utils/url-host.util';
import { canOpenMetadataFilter } from './game-detail-metadata.utils';
import { DetailMediaSlideComponent } from './detail-media-slide.component';

type DetailContext = 'library' | 'explore';
type DetailGame = GameCatalogResult | GameEntry;
type DetailMediaSlide = { key: string; src: string };

@Component({
  selector: 'app-game-detail-content',
  templateUrl: './game-detail-content.component.html',
  styleUrls: ['./game-detail-content.component.scss'],
  standalone: true,
  imports: [
    DetailMediaSlideComponent,
    IonGrid,
    IonRow,
    IonCol,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonButton,
    IonButtons,
    IonSelect,
    IonSelectOption,
    IonIcon,
    IonToolbar,
  ],
})
export class GameDetailContentComponent implements AfterViewInit, OnChanges, OnDestroy {
  private static readonly DEFAULT_PRICE_CURRENCY = 'CHF';
  private static readonly EAGER_MEDIA_SLIDE_COUNT = 3;

  @Input({ required: true }) game!: DetailGame;
  @Input() context: DetailContext = 'library';
  @Input() statusOptions: { value: GameStatus; label: string }[] = [];
  @Input() showAddToLibraryAction = false;
  @Input() isInLibrary = false;
  @Input() isAddToLibraryLoading = false;
  @Input() showIgnoreAction = false;
  @Input() isIgnored = false;
  @Input() showPriceForNonWishlist = false;

  @Output() statusChange = new EventEmitter<GameStatus | null | undefined>();
  @Output() clearStatus = new EventEmitter<void>();
  @Output() editRating = new EventEmitter<void>();
  @Output() openTags = new EventEmitter<void>();
  @Output() developerClick = new EventEmitter<void>();
  @Output() seriesClick = new EventEmitter<void>();
  @Output() franchiseClick = new EventEmitter<void>();
  @Output() genreClick = new EventEmitter<void>();
  @Output() publisherClick = new EventEmitter<void>();
  @Output() addToLibrary = new EventEmitter<void>();
  @Output() ignore = new EventEmitter<void>();
  @ViewChild('swiperContainer') private swiperContainerRef?: ElementRef<HTMLElement>;

  detailTextExpanded = {
    summary: false,
    storyline: false,
  };

  private swiperInstance: SwiperClass | null = null;
  private swiperUpdateQueued = false;
  private swiperRefreshRafId: number | null = null;
  private swiperRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private swiperDestroyed = false;
  private readonly platformCustomizationService = inject(PlatformCustomizationService);

  constructor() {
    addIcons({
      add,
      ban,
      cash,
      build,
      business,
      calendar,
      documentText,
      gameController,
      gitBranch,
      grid,
      hardwareChip,
      book,
      library,
      medal,
      pricetags,
      star,
      time,
      trophy,
    });
  }

  ngAfterViewInit(): void {
    if (this.swiperDestroyed) {
      return;
    }

    this.ensureSwiperInitialized();
    this.queueSwiperRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.swiperDestroyed && 'game' in changes) {
      this.queueSwiperRefresh();
    }
  }

  ngOnDestroy(): void {
    this.swiperDestroyed = true;
    this.cancelQueuedSwiperRefresh();
    this.destroySwiper();
  }

  private ensureSwiperInitialized(): void {
    if (this.swiperDestroyed || this.swiperInstance) {
      return;
    }

    const container = this.swiperContainerRef?.nativeElement;
    if (!container) {
      return;
    }

    this.swiperInstance = new SwiperClass(container, {
      modules: [Pagination, Zoom],
      slidesPerView: 1,
      spaceBetween: 0,
      loop: false,
      watchOverflow: true,
      zoom: true,
      allowTouchMove: this.mediaSlides.length > 1,
      observer: true,
      observeParents: true,
      observeSlideChildren: true,
      pagination: {
        el: '.swiper-pagination',
        dynamicBullets: true,
        dynamicMainBullets: 3,
        clickable: false,
      },
    });
  }

  private queueSwiperRefresh(): void {
    if (this.swiperDestroyed || this.swiperUpdateQueued) {
      return;
    }

    this.swiperUpdateQueued = true;
    this.runAfterRender(() => {
      this.swiperUpdateQueued = false;
      if (this.swiperDestroyed) {
        return;
      }

      this.refreshSwiper();
    });
  }

  private refreshSwiper(): void {
    this.ensureSwiperInitialized();

    const swiper = this.swiperInstance;
    if (!swiper) {
      return;
    }

    const hasMultipleSlides = this.mediaSlides.length > 1;
    swiper.allowTouchMove = hasMultipleSlides;
    swiper.update();
    swiper.pagination.render();
    swiper.pagination.update();
  }

  private runAfterRender(callback: () => void): void {
    if (typeof requestAnimationFrame === 'function') {
      this.swiperRefreshRafId = requestAnimationFrame(() => {
        this.swiperRefreshRafId = null;
        callback();
      });
      return;
    }

    this.swiperRefreshTimeoutId = setTimeout(() => {
      this.swiperRefreshTimeoutId = null;
      callback();
    }, 0);
  }

  private cancelQueuedSwiperRefresh(): void {
    if (this.swiperRefreshRafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.swiperRefreshRafId);
      this.swiperRefreshRafId = null;
    }

    if (this.swiperRefreshTimeoutId !== null) {
      clearTimeout(this.swiperRefreshTimeoutId);
      this.swiperRefreshTimeoutId = null;
    }

    this.swiperUpdateQueued = false;
  }

  private destroySwiper(): void {
    if (!this.swiperInstance) {
      return;
    }

    this.swiperInstance.destroy(true, true);
    this.swiperInstance = null;
  }

  get showLibrarySections(): boolean {
    return this.context === 'library';
  }

  get platformLabel(): string {
    const gameEntryLike = this.game as Partial<GameEntry>;
    const customPlatform =
      typeof gameEntryLike.customPlatform === 'string' ? gameEntryLike.customPlatform.trim() : '';
    const customPlatformId =
      Number.isInteger(gameEntryLike.customPlatformIgdbId) &&
      (gameEntryLike.customPlatformIgdbId as number) > 0
        ? (gameEntryLike.customPlatformIgdbId as number)
        : null;
    const primaryPlatform =
      customPlatform.length > 0
        ? customPlatform
        : typeof this.game.platform === 'string'
          ? this.game.platform.trim()
          : '';
    const primaryPlatformId =
      customPlatform.length > 0 && customPlatformId !== null
        ? customPlatformId
        : Number.isInteger(this.game.platformIgdbId) && (this.game.platformIgdbId as number) > 0
          ? (this.game.platformIgdbId as number)
          : null;
    const gameCatalogLike = this.game as Partial<GameCatalogResult>;

    if (primaryPlatform.length > 0) {
      return this.getAliasedPlatformLabel(primaryPlatform, primaryPlatformId);
    }

    if (
      Array.isArray(gameCatalogLike.platformOptions) &&
      gameCatalogLike.platformOptions.length > 0
    ) {
      const first = gameCatalogLike.platformOptions[0];
      const name = typeof first.name === 'string' ? first.name.trim() : '';
      const id =
        Number.isInteger(first.id) && (first.id as number) > 0 ? (first.id as number) : null;

      if (name.length > 0) {
        return this.getAliasedPlatformLabel(name, id);
      }
    }

    if (Array.isArray(gameCatalogLike.platforms) && gameCatalogLike.platforms.length > 0) {
      const name =
        typeof gameCatalogLike.platforms[0] === 'string' ? gameCatalogLike.platforms[0].trim() : '';

      if (name.length > 0) {
        return this.getAliasedPlatformLabel(name, null);
      }
    }

    return 'Unknown platform';
  }

  get platformHeadingLabel(): string {
    return this.context === 'explore' ? 'Platforms' : 'Platform';
  }

  get platformValueLabel(): string {
    if (this.context !== 'explore') {
      return this.platformLabel;
    }

    const labels = this.getExplorePlatformLabels();
    return labels.length > 0 ? labels.join(', ') : 'Unknown platform';
  }

  get gameTypeBadgeLabel(): string | null {
    const gameType = this.normalizeGameType(this.game.gameType);

    if (!gameType) {
      return null;
    }

    if (gameType === 'main_game') {
      return 'Main Game';
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
      .filter((part) => part.length > 0)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  shouldEagerLoadMediaSlide(index: number): boolean {
    return index < GameDetailContentComponent.EAGER_MEDIA_SLIDE_COUNT;
  }

  get statusValue(): GameStatus | undefined {
    if (!this.showLibrarySections) {
      return undefined;
    }

    const value = (this.game as Partial<GameEntry>).status;
    return value ?? undefined;
  }

  get ratingValue(): GameRating | undefined {
    if (!this.showLibrarySections) {
      return undefined;
    }

    const value = (this.game as Partial<GameEntry>).rating;
    return value ?? undefined;
  }

  get ratingLabel(): string {
    return this.ratingValue !== undefined ? this.formatRatingValue(this.ratingValue) : 'None';
  }

  get ratingActionLabel(): string {
    return this.ratingValue !== undefined ? 'EDIT' : 'SET';
  }

  get tagItems(): { name: string; color: string }[] {
    if (!this.showLibrarySections) {
      return [];
    }

    const tags = (this.game as Partial<GameEntry>).tags;

    if (!Array.isArray(tags)) {
      return [];
    }

    return tags
      .map((tag) => ({
        name: typeof tag.name === 'string' ? tag.name.trim() : '',
        color:
          typeof tag.color === 'string' && tag.color.trim().length > 0
            ? tag.color.trim()
            : '#808080',
      }))
      .filter((tag) => tag.name.length > 0);
  }

  get hltbMainLabel(): string {
    return this.formatCompletionHours(this.game.hltbMainHours);
  }

  get hltbMainExtraLabel(): string {
    return this.formatCompletionHours(this.game.hltbMainExtraHours);
  }

  get hltbCompletionistLabel(): string {
    return this.formatCompletionHours(this.game.hltbCompletionistHours);
  }

  get reviewScoreLabel(): string {
    const score = this.normalizeReviewScore(this.game.reviewScore ?? this.game.metacriticScore);
    if (score === null) {
      return 'Unknown';
    }

    const source = this.resolveReviewSourceLabel();
    if (source === 'mobygames') {
      const rawMobyScore =
        typeof this.game.mobyScore === 'number' && Number.isFinite(this.game.mobyScore)
          ? this.game.mobyScore
          : score <= 10
            ? score
            : score / 10;
      const outOfTen = rawMobyScore.toFixed(1).replace(/\.0$/, '');
      return `${outOfTen}/10`;
    }

    return `${String(score)}/100`;
  }

  get reviewScoreHeadingLabel(): string {
    const source = this.resolveReviewSourceLabel();

    if (source === 'metacritic') {
      return 'Metacritic Score';
    }

    if (source === 'mobygames') {
      return 'Moby Score';
    }

    return 'Review Score';
  }

  get showCurrentPriceLine(): boolean {
    const listType = (this.game as Partial<GameEntry>).listType;
    if (listType === 'collection') {
      return false;
    }

    if (listType === 'wishlist') {
      return true;
    }

    if (!this.showPriceForNonWishlist) {
      return false;
    }

    return this.hasCurrentPriceValue();
  }

  get currentPriceLabel(): string {
    if ((this.game as Partial<GameEntry>).priceIsFree === true) {
      return 'Free';
    }

    const amount =
      typeof this.game.priceAmount === 'number' && Number.isFinite(this.game.priceAmount)
        ? this.game.priceAmount
        : null;
    if (amount === null || amount < 0) {
      return 'Unknown';
    }

    return this.formatPriceAmount(amount, this.resolvePriceCurrency(this.game.priceCurrency));
  }

  get currentPriceMetaLabel(): string | null {
    const parts: string[] = [];
    const currentAmount =
      (this.game as Partial<GameEntry>).priceIsFree === true
        ? 0
        : typeof this.game.priceAmount === 'number' && Number.isFinite(this.game.priceAmount)
          ? this.game.priceAmount
          : null;
    const discountPercent =
      typeof this.game.priceDiscountPercent === 'number' &&
      Number.isFinite(this.game.priceDiscountPercent)
        ? this.game.priceDiscountPercent
        : null;
    if (discountPercent !== null && discountPercent > 0) {
      parts.push(`-${String(Math.round(discountPercent))}%`);
    }

    const regularAmount =
      typeof this.game.priceRegularAmount === 'number' &&
      Number.isFinite(this.game.priceRegularAmount)
        ? this.game.priceRegularAmount
        : null;
    const regularDiffersFromCurrent =
      regularAmount !== null &&
      regularAmount >= 0 &&
      (currentAmount === null || Math.abs(regularAmount - currentAmount) >= 0.01);
    if (regularDiffersFromCurrent) {
      parts.push(
        `Normal price: ${this.formatPriceAmount(
          regularAmount,
          this.resolvePriceCurrency(this.game.priceCurrency)
        )}`
      );
    }

    return parts.length > 0 ? parts.join(' · ') : null;
  }

  private hasCurrentPriceValue(): boolean {
    if ((this.game as Partial<GameEntry>).priceIsFree === true) {
      return true;
    }

    const amount =
      typeof this.game.priceAmount === 'number' && Number.isFinite(this.game.priceAmount)
        ? this.game.priceAmount
        : null;
    return amount !== null && amount >= 0;
  }

  isDetailTextExpanded(field: 'summary' | 'storyline'): boolean {
    return this.detailTextExpanded[field];
  }

  toggleDetailText(field: 'summary' | 'storyline'): void {
    this.detailTextExpanded[field] = !this.detailTextExpanded[field];
  }

  shouldShowDetailTextToggle(value: string | null | undefined): boolean {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 260;
  }

  formatDate(releaseDate: string | null | undefined): string {
    if (typeof releaseDate !== 'string' || releaseDate.trim().length === 0) {
      return 'Unknown';
    }

    const timestamp = Date.parse(releaseDate);

    if (Number.isNaN(timestamp)) {
      return 'Unknown';
    }

    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatMetadataList(values: string[] | null | undefined): string {
    if (!Array.isArray(values) || values.length === 0) {
      return 'None';
    }

    const normalized = [
      ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    ];

    return normalized.length > 0 ? normalized.join(', ') : 'None';
  }

  private normalizeReviewScore(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.round(value * 10) / 10;
    if (normalized <= 0 || normalized > 100) {
      return null;
    }

    return normalized;
  }

  private resolvePriceCurrency(value: string | null | undefined): string {
    if (typeof value !== 'string') {
      return GameDetailContentComponent.DEFAULT_PRICE_CURRENCY;
    }

    const normalized = value.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized)
      ? normalized
      : GameDetailContentComponent.DEFAULT_PRICE_CURRENCY;
  }

  private formatPriceAmount(amount: number, currencyCode: string): string {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
      }).format(amount);
    } catch {
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: GameDetailContentComponent.DEFAULT_PRICE_CURRENCY,
        }).format(amount);
      } catch {
        return `${amount.toFixed(2)} ${currencyCode}`;
      }
    }
  }

  private resolveReviewSourceLabel(): 'metacritic' | 'mobygames' | null {
    const reviewSource =
      (this.game as Partial<GameEntry>).reviewSource === 'metacritic' ||
      (this.game as Partial<GameEntry>).reviewSource === 'mobygames'
        ? (this.game as Partial<GameEntry>).reviewSource
        : null;

    if (reviewSource) {
      return reviewSource;
    }

    const urlCandidate =
      (this.game as Partial<GameEntry>).reviewUrl ??
      (this.game as Partial<GameEntry>).metacriticUrl ??
      null;
    if (typeof urlCandidate === 'string') {
      return detectReviewSourceFromUrl(urlCandidate);
    }

    return null;
  }

  hasMetadataValue(values: string[] | null | undefined): boolean {
    return Array.isArray(values) && values.some((value) => value.trim().length > 0);
  }

  getTagTextColor(backgroundColor: string | null | undefined): string {
    const normalized = typeof backgroundColor === 'string' ? backgroundColor.trim() : '';

    if (!/^#([0-9a-fA-F]{6})$/.test(normalized)) {
      return '#111111';
    }

    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

    return luminance > 150 ? '#111111' : '#ffffff';
  }

  emitStatusChange(value: GameStatus | null | undefined): void {
    this.statusChange.emit(value);
  }

  formatRatingValue(value: number): string {
    return value.toFixed(1).replace(/\.0$/, '');
  }

  onDeveloperClick(): void {
    if (canOpenMetadataFilter(this.showLibrarySections, this.game.developers)) {
      this.developerClick.emit();
    }
  }

  onSeriesClick(): void {
    if (canOpenMetadataFilter(this.showLibrarySections, this.game.collections)) {
      this.seriesClick.emit();
    }
  }

  onFranchiseClick(): void {
    if (canOpenMetadataFilter(this.showLibrarySections, this.game.franchises)) {
      this.franchiseClick.emit();
    }
  }

  onPublisherClick(): void {
    if (canOpenMetadataFilter(this.showLibrarySections, this.game.publishers)) {
      this.publisherClick.emit();
    }
  }

  onGenreClick(): void {
    if (canOpenMetadataFilter(this.showLibrarySections, this.game.genres)) {
      this.genreClick.emit();
    }
  }

  private getAliasedPlatformLabel(name: string, platformIgdbId: number | null): string {
    if (name.trim().length > 0) {
      const aliased = this.platformCustomizationService
        .getDisplayNameWithAliasSource(name, platformIgdbId)
        .trim();

      if (aliased.length > 0) {
        return aliased;
      }
    }

    return 'Unknown platform';
  }

  private getExplorePlatformLabels(): string[] {
    const gameCatalogLike = this.game as Partial<GameCatalogResult>;

    if (
      Array.isArray(gameCatalogLike.platformOptions) &&
      gameCatalogLike.platformOptions.length > 0
    ) {
      return gameCatalogLike.platformOptions
        .map((option): { id: number | null; name: string } => {
          const name = typeof option.name === 'string' ? option.name.trim() : '';
          const id =
            Number.isInteger(option.id) && (option.id as number) > 0 ? (option.id as number) : null;
          return { id, name };
        })
        .filter((option) => option.name.length > 0)
        .filter((option, index, items) => {
          return (
            items.findIndex(
              (candidate) => candidate.id === option.id && candidate.name === option.name
            ) === index
          );
        })
        .map((option) => this.getAliasedPlatformLabel(option.name, option.id));
    }

    if (Array.isArray(gameCatalogLike.platforms) && gameCatalogLike.platforms.length > 0) {
      return [
        ...new Set(
          gameCatalogLike.platforms
            .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
            .filter((platform) => platform.length > 0)
        ),
      ].map((platform) => this.getAliasedPlatformLabel(platform, null));
    }

    if (
      typeof gameCatalogLike.platform === 'string' &&
      gameCatalogLike.platform.trim().length > 0
    ) {
      return [
        this.getAliasedPlatformLabel(
          gameCatalogLike.platform,
          gameCatalogLike.platformIgdbId ?? null
        ),
      ];
    }

    return [];
  }

  private normalizeGameType(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

    if (normalized.length === 0) {
      return null;
    }

    return normalized;
  }

  private formatCompletionHours(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return 'Unknown';
    }

    const rounded = Math.round(value * 10) / 10;
    return `${String(rounded)}h`;
  }

  get displayTitle(): string {
    const gameEntryLike = this.game as Partial<GameEntry>;
    const customTitle =
      typeof gameEntryLike.customTitle === 'string' ? gameEntryLike.customTitle.trim() : '';

    if (customTitle.length > 0) {
      return customTitle;
    }

    const title = typeof this.game.title === 'string' ? this.game.title.trim() : '';
    return title.length > 0 ? title : 'Unknown title';
  }

  get mediaSlides(): DetailMediaSlide[] {
    const slides: DetailMediaSlide[] = [];
    const seen = new Set<string>();

    const coverUrl = typeof this.game.coverUrl === 'string' ? this.game.coverUrl.trim() : '';
    if (coverUrl.length > 0) {
      slides.push({ key: `cover:${coverUrl}`, src: coverUrl });
      seen.add(coverUrl);
    }

    for (const screenshot of this.getValidScreenshots(this.game.screenshots)) {
      if (seen.has(screenshot.url)) {
        continue;
      }

      const key =
        screenshot.id !== null
          ? `screenshot:${String(screenshot.id)}`
          : `screenshot:${screenshot.imageId}`;
      slides.push({ key, src: screenshot.url });
      seen.add(screenshot.url);
    }

    return slides.length > 0 ? slides : [{ key: 'placeholder', src: '' }];
  }

  private getValidScreenshots(value: GameScreenshot[] | null | undefined): Array<{
    id: number | null;
    imageId: string;
    url: string;
  }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((screenshot) => {
        const id =
          Number.isInteger(screenshot.id) && (screenshot.id as number) > 0
            ? (screenshot.id as number)
            : null;
        const imageId = typeof screenshot.imageId === 'string' ? screenshot.imageId.trim() : '';
        const url = typeof screenshot.url === 'string' ? screenshot.url.trim() : '';
        return { id, imageId, url };
      })
      .filter((screenshot) => screenshot.imageId.length > 0 && screenshot.url.length > 0);
  }
}
