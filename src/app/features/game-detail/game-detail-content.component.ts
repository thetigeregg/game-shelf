import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  ChangeDetectionStrategy,
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
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, ban, chevronDown, star, starHalf, starOutline } from 'ionicons/icons';
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
import { getReviewScoreBand, ReviewScoreBand } from '../../core/utils/review-score-band';
import { canOpenMetadataFilter } from './game-detail-metadata.utils';
import { DetailMediaSlideComponent } from './detail-media-slide.component';
import { toDetailMediaRenderUrl } from './detail-media-url.utils';
import { isDataOrBlobUrl } from '../../core/utils/image-url.utils';

type DetailContext = 'library' | 'explore';
type DetailGame = GameCatalogResult | GameEntry;
type DetailMediaSlide = {
  key: string;
  src: string;
  kind: 'cover' | 'screenshot' | 'placeholder';
};
type DetailTextField = 'summary' | 'storyline';
type RatingStarIcon = 'star' | 'star-half' | 'star-outline';
type HltbBreakdownSegment = {
  key: 'main' | 'extra' | 'completionist';
  label: string;
  valueLabel: string;
  widthPercent: number;
};

/** Sentinel select value for "no status": picking it clears the status. */
const NO_STATUS_VALUE = 'none';

@Component({
  selector: 'app-game-detail-content',
  templateUrl: './game-detail-content.component.html',
  styleUrls: ['./game-detail-content.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
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
  private static readonly PRELOAD_MEDIA_SLIDE_COUNT = 2;
  private static readonly DETAIL_TEXT_COLLAPSED_CLASS = 'detail-long-text-collapsed';
  private static readonly TITLE_MAX_HEIGHT_PX = 40;
  private static readonly TITLE_MIN_FONT_SIZE_PX = 12;
  private static readonly TITLE_FONT_SIZE_STEP_PX = 0.5;
  private static readonly TITLE_CLAMPED_CLASS = 'detail-game-name-clamped';
  private static readonly PLACEHOLDER_MEDIA_SLIDES: DetailMediaSlide[] = [
    { key: 'placeholder', src: '', kind: 'placeholder' },
  ];

  @Input({ required: true }) game!: DetailGame;
  @Input() context: DetailContext = 'library';
  @Input() statusOptions: { value: GameStatus; label: string }[] = [];
  @Input() showAddToLibraryAction = false;
  @Input() isInLibrary = false;
  @Input() isAddToLibraryLoading = false;
  @Input() showIgnoreAction = false;
  @Input() isIgnored = false;
  @Input() showPriceForNonWishlist = false;
  @Input() allowMetadataFilterLinks = true;

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
  @ViewChild('summaryText') private summaryTextRef?: ElementRef<HTMLElement>;
  @ViewChild('storylineText') private storylineTextRef?: ElementRef<HTMLElement>;
  @ViewChild('statusSelect', { read: ElementRef })
  private statusSelectRef?: ElementRef<HTMLIonSelectElement>;
  @ViewChild('titleText') private titleTextRef?: ElementRef<HTMLElement>;

  readonly noStatusValue = NO_STATUS_VALUE;

  detailTextExpanded = {
    summary: false,
    storyline: false,
  };

  detailTextExpandable = {
    summary: false,
    storyline: false,
  };

  private swiperInstance: SwiperClass | null = null;
  private swiperUpdateQueued = false;
  private detailTextRefreshQueued = false;
  private swiperRefreshRafId: number | null = null;
  private swiperRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private detailTextResizeObserver: ResizeObserver | null = null;
  private swiperDestroyed = false;
  private cachedDisplayTitleGame: DetailGame | null = null;
  private cachedDisplayTitle = 'Unknown title';
  private cachedTagItemsGame: DetailGame | null = null;
  private cachedTagItemsContext: DetailContext = 'library';
  private cachedTagItems: { name: string; color: string }[] = [];
  private cachedMediaSlidesGame: DetailGame | null = null;
  private cachedMediaSlides: DetailMediaSlide[] =
    GameDetailContentComponent.PLACEHOLDER_MEDIA_SLIDES;
  private cachedFormattedReleaseDateValue: string | null = null;
  private cachedFormattedReleaseDate = 'Unknown';
  private loadedMediaSlideKeys = new Set<string>();
  private titleFitKey: string | null = null;
  private prefetchedMediaSlideUrls = new Set<string>();
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly changeDetectorRef = inject(ChangeDetectorRef, { optional: true });
  private readonly ngZone = inject(NgZone, { optional: true });

  constructor() {
    addIcons({ add, ban, chevronDown, star, starHalf, starOutline });
  }

  ngAfterViewInit(): void {
    if (this.swiperDestroyed) {
      return;
    }

    this.ensureSwiperInitialized();
    this.setupDetailTextResizeObserver();
    this.queueSwiperRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ('game' in changes) {
      const gameChange = changes['game'];
      const currentIdentity = this.buildDetailGameIdentity(gameChange.currentValue as DetailGame);
      const previousIdentity = this.buildDetailGameIdentity(gameChange.previousValue as DetailGame);

      this.cachedDisplayTitleGame = null;
      this.cachedTagItemsGame = null;
      this.cachedMediaSlidesGame = null;
      this.cachedFormattedReleaseDateValue = null;
      this.resetMediaSlideLoadingState();

      if (gameChange.firstChange || currentIdentity !== previousIdentity) {
        this.detailTextExpanded = {
          summary: false,
          storyline: false,
        };
      }

      this.detailTextExpandable = {
        summary: this.hasPotentiallyLongDetailText(this.game.summary),
        storyline: this.hasPotentiallyLongDetailText(this.game.storyline),
      };
    }

    if (!this.swiperDestroyed && 'game' in changes) {
      this.queueSwiperRefresh();
    }
  }

  ngOnDestroy(): void {
    this.swiperDestroyed = true;
    this.disconnectDetailTextResizeObserver();
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
      on: {
        afterInit: (swiper) => {
          this.handleSwiperSlideChange(swiper);
        },
        slideChange: (swiper) => {
          this.handleSwiperSlideChange(swiper);
        },
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
      this.refreshDetailTextExpandableState();
      this.fitTitleToMaxHeight();
    });
  }

  private queueDetailTextRefresh(): void {
    if (this.swiperDestroyed || this.detailTextRefreshQueued) {
      return;
    }

    this.detailTextRefreshQueued = true;
    this.runAfterRender(() => {
      this.detailTextRefreshQueued = false;
      if (this.swiperDestroyed) {
        return;
      }

      this.refreshDetailTextExpandableState();
      this.fitTitleToMaxHeight();
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

  private setupDetailTextResizeObserver(): void {
    if (this.detailTextResizeObserver || typeof ResizeObserver !== 'function') {
      return;
    }

    const elements = [
      this.summaryTextRef?.nativeElement,
      this.storylineTextRef?.nativeElement,
      this.titleTextRef?.nativeElement,
    ].filter((element): element is HTMLElement => Boolean(element));

    if (elements.length === 0) {
      return;
    }

    this.detailTextResizeObserver = new ResizeObserver(() => {
      this.queueDetailTextRefresh();
    });

    for (const element of elements) {
      this.detailTextResizeObserver.observe(element);
    }
  }

  private disconnectDetailTextResizeObserver(): void {
    if (!this.detailTextResizeObserver) {
      return;
    }

    this.detailTextResizeObserver.disconnect();
    this.detailTextResizeObserver = null;
  }

  get showLibrarySections(): boolean {
    return this.context === 'library';
  }

  get shouldEnableMetadataFilterLinks(): boolean {
    return this.showLibrarySections && this.allowMetadataFilterLinks;
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

  get platformValueLabel(): string {
    if (this.context !== 'explore') {
      return this.platformLabel;
    }

    const labels = this.getExplorePlatformLabels();
    return labels.length > 0 ? labels.join(', ') : 'Unknown platform';
  }

  /** Game type for the facts card ("Remake", "DLC Add-on"); null for main games and unknown. */
  get gameTypeLabel(): string | null {
    const gameType = this.normalizeGameType(this.game.gameType);

    if (!gameType || gameType === 'main_game') {
      return null;
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

  shouldLoadMediaSlide(slide: DetailMediaSlide): boolean {
    if (slide.kind === 'placeholder') {
      return true;
    }

    return this.loadedMediaSlideKeys.has(slide.key);
  }

  getMediaSlideSrc(slide: DetailMediaSlide): string | null {
    if (slide.kind === 'placeholder') {
      return slide.src;
    }

    return this.shouldLoadMediaSlide(slide) ? slide.src : null;
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

  /** Five star icons for the rating chip: full, half, then outline stars. */
  get ratingStars(): RatingStarIcon[] {
    const rating = this.ratingValue ?? 0;
    return [1, 2, 3, 4, 5].map((position) =>
      rating >= position ? 'star' : rating >= position - 0.5 ? 'star-half' : 'star-outline'
    );
  }

  get statusLabel(): string | null {
    const status = this.statusValue;
    if (status === undefined) {
      return null;
    }

    return this.statusOptions.find((option) => option.value === status)?.label ?? status;
  }

  get statusSelectValue(): GameStatus | typeof NO_STATUS_VALUE {
    return this.statusValue ?? NO_STATUS_VALUE;
  }

  /**
   * Opens the hidden status select, first resetting it to the game's status: after a failed
   * update it would still hold the rejected pick, and picking that again would not emit.
   */
  openStatusPicker(): void {
    const select = this.statusSelectRef?.nativeElement;
    if (!select) {
      return;
    }

    select.value = this.statusSelectValue;
    void select.open();
  }

  onStatusSelectChange(value: GameStatus | typeof NO_STATUS_VALUE | null | undefined): void {
    if (value === NO_STATUS_VALUE) {
      if (this.statusValue !== undefined) {
        this.clearStatus.emit();
      }
      return;
    }

    this.emitStatusChange(value);
  }

  get releaseDateLabel(): string | null {
    const label = this.formatDate(this.game.releaseDate);
    return label === 'Unknown' ? null : label;
  }

  /** "Platform · release date" line under the title; an unknown date is left out. */
  get headerMetaLabel(): string {
    return [this.platformValueLabel, this.releaseDateLabel]
      .filter((part): part is string => part !== null)
      .join(' · ');
  }

  get tagItems(): { name: string; color: string }[] {
    if (this.cachedTagItemsGame === this.game && this.cachedTagItemsContext === this.context) {
      return this.cachedTagItems;
    }

    this.cachedTagItemsGame = this.game;
    this.cachedTagItemsContext = this.context;

    if (!this.showLibrarySections) {
      this.cachedTagItems = [];
      return this.cachedTagItems;
    }

    const tags = (this.game as Partial<GameEntry>).tags;

    if (!Array.isArray(tags)) {
      this.cachedTagItems = [];
      return this.cachedTagItems;
    }

    this.cachedTagItems = tags
      .map((tag) => ({
        name: typeof tag.name === 'string' ? tag.name.trim() : '',
        color:
          typeof tag.color === 'string' && tag.color.trim().length > 0
            ? tag.color.trim()
            : '#808080',
      }))
      .filter((tag) => tag.name.length > 0);

    return this.cachedTagItems;
  }

  /** Main-story time for the summary card, null when HLTB has none. */
  get hltbMainLabel(): string | null {
    return this.formatCompletionHours(this.game.hltbMainHours);
  }

  /**
   * The known HLTB times as one bar, shortest first: each segment covers the time it adds
   * over the one before, scaled to the longest time. Sorting keeps every segment on the bar
   * when the times are out of order. Empty when no time is known.
   */
  get hltbBreakdown(): HltbBreakdownSegment[] {
    const known = [
      { key: 'main' as const, label: 'Main', hours: this.game.hltbMainHours },
      { key: 'extra' as const, label: '+ Extras', hours: this.game.hltbMainExtraHours },
      { key: 'completionist' as const, label: '100%', hours: this.game.hltbCompletionistHours },
    ]
      .flatMap((entry) => {
        const valueLabel = this.formatCompletionHours(entry.hours);
        return valueLabel !== null && typeof entry.hours === 'number'
          ? [{ key: entry.key, label: entry.label, hours: entry.hours, valueLabel }]
          : [];
      })
      .sort((left, right) => left.hours - right.hours);
    const longest = Math.max(0, ...known.map((entry) => entry.hours));
    let covered = 0;

    return known.map((entry) => {
      const widthPercent = longest > 0 ? (Math.max(0, entry.hours - covered) / longest) * 100 : 0;
      covered = Math.max(covered, entry.hours);
      return {
        key: entry.key,
        label: entry.label,
        valueLabel: entry.valueLabel,
        widthPercent: Math.round(widthPercent * 10) / 10,
      };
    });
  }

  /** Score for the summary card's badge ("87", or "8.2" for MobyGames), null when unknown. */
  get reviewScoreValueLabel(): string | null {
    const score = this.normalizeReviewScore(this.game.reviewScore ?? this.game.metacriticScore);
    if (score === null) {
      return null;
    }

    if (this.resolveReviewSourceLabel() === 'mobygames') {
      return this.resolveMobyScoreOutOfTen(score).toFixed(1).replace(/\.0$/, '');
    }

    return String(score);
  }

  get reviewScoreLabel(): string {
    const value = this.reviewScoreValueLabel;
    if (value === null) {
      return 'Unknown';
    }

    return this.resolveReviewSourceLabel() === 'mobygames' ? `${value}/10` : `${value}/100`;
  }

  /** Colour band for the score badge, as in the list view, on a 0–100 scale. */
  get reviewScoreBand(): ReviewScoreBand | null {
    const score = this.normalizeReviewScore(this.game.reviewScore ?? this.game.metacriticScore);
    if (score === null) {
      return null;
    }

    const outOfHundred =
      this.resolveReviewSourceLabel() === 'mobygames'
        ? this.resolveMobyScoreOutOfTen(score) * 10
        : score;
    return getReviewScoreBand(outOfHundred);
  }

  get reviewScoreHeadingLabel(): string {
    const source = this.resolveReviewSourceLabel();

    if (source === 'metacritic') {
      return 'Metacritic';
    }

    if (source === 'mobygames') {
      return 'MobyGames';
    }

    return 'Review score';
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

  /** The summary card shows score and HLTB for library games, and the price where it applies. */
  get showAtAGlanceCard(): boolean {
    return this.showLibrarySections || this.showCurrentPriceLine;
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

  /** "-50%" when the price is discounted, else null. */
  get priceDiscountLabel(): string | null {
    const discountPercent =
      typeof this.game.priceDiscountPercent === 'number' &&
      Number.isFinite(this.game.priceDiscountPercent)
        ? this.game.priceDiscountPercent
        : null;
    return discountPercent !== null && discountPercent > 0
      ? `-${String(Math.round(discountPercent))}%`
      : null;
  }

  /** The normal price, shown struck through, when it differs from the current price. */
  get priceRegularLabel(): string | null {
    const currentAmount =
      (this.game as Partial<GameEntry>).priceIsFree === true
        ? 0
        : typeof this.game.priceAmount === 'number' && Number.isFinite(this.game.priceAmount)
          ? this.game.priceAmount
          : null;
    const regularAmount =
      typeof this.game.priceRegularAmount === 'number' &&
      Number.isFinite(this.game.priceRegularAmount)
        ? this.game.priceRegularAmount
        : null;
    const regularDiffersFromCurrent =
      regularAmount !== null &&
      regularAmount >= 0 &&
      (currentAmount === null || Math.abs(regularAmount - currentAmount) >= 0.01);

    return regularDiffersFromCurrent
      ? this.formatPriceAmount(regularAmount, this.resolvePriceCurrency(this.game.priceCurrency))
      : null;
  }

  /**
   * When the summary card's external data was read, e.g. "Updated: price Nov 21, 2026 ·
   * HLTB Nov 3, 2026". Covers only values the card shows, with a known read date.
   */
  get dataFreshnessLabel(): string | null {
    const parts: string[] = [];
    const priceDate =
      this.showCurrentPriceLine && this.hasCurrentPriceValue()
        ? this.formatFetchedDate(this.game.priceFetchedAt)
        : null;
    if (priceDate !== null) {
      parts.push(`price ${priceDate}`);
    }

    if (this.showLibrarySections) {
      const hltbDate =
        this.hltbBreakdown.length > 0 ? this.formatFetchedDate(this.game.hltbFetchedAt) : null;
      if (hltbDate !== null) {
        parts.push(`HLTB ${hltbDate}`);
      }

      const reviewDate =
        this.reviewScoreValueLabel !== null
          ? this.formatFetchedDate(this.game.reviewFetchedAt)
          : null;
      if (reviewDate !== null) {
        parts.push(`score ${reviewDate}`);
      }
    }

    return parts.length > 0 ? `Updated: ${parts.join(' · ')}` : null;
  }

  private formatFetchedDate(fetchedAt: string | null | undefined): string | null {
    const timestamp = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : Number.NaN;
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  private resolveMobyScoreOutOfTen(normalizedScore: number): number {
    return typeof this.game.mobyScore === 'number' && Number.isFinite(this.game.mobyScore)
      ? this.game.mobyScore
      : normalizedScore <= 10
        ? normalizedScore
        : normalizedScore / 10;
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

  isDetailTextExpanded(field: DetailTextField): boolean {
    return this.detailTextExpanded[field];
  }

  canToggleDetailText(field: DetailTextField): boolean {
    return this.detailTextExpandable[field];
  }

  /** Tapping the text toggles it too, unless the user was selecting some of it. */
  onDetailTextClick(field: DetailTextField): void {
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (selection && selection.toString().length > 0) {
      return;
    }

    this.toggleDetailText(field);
  }

  toggleDetailText(field: DetailTextField): void {
    if (!this.canToggleDetailText(field)) {
      return;
    }

    this.detailTextExpanded = {
      ...this.detailTextExpanded,
      [field]: !this.detailTextExpanded[field],
    };
  }

  private buildDetailGameIdentity(game: DetailGame | null | undefined): string {
    if (!game) {
      return '';
    }

    const platformIgdbId =
      typeof game.platformIgdbId === 'number' && Number.isFinite(game.platformIgdbId)
        ? String(game.platformIgdbId)
        : '';

    return `${game.igdbGameId}::${platformIgdbId}`;
  }

  private hasPotentiallyLongDetailText(value: string | null | undefined): boolean {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 260;
  }

  private refreshDetailTextExpandableState(): void {
    const summaryElement = this.summaryTextRef?.nativeElement;
    const storylineElement = this.storylineTextRef?.nativeElement;

    const summaryExpandable = summaryElement
      ? this.isDetailTextOverflowing(summaryElement)
      : this.detailTextExpandable.summary;
    const storylineExpandable = storylineElement
      ? this.isDetailTextOverflowing(storylineElement)
      : this.detailTextExpandable.storyline;

    this.detailTextExpandable = {
      summary: summaryExpandable,
      storyline: storylineExpandable,
    };

    this.detailTextExpanded = {
      ...this.detailTextExpanded,
      summary: summaryExpandable ? this.detailTextExpanded.summary : false,
      storyline: storylineExpandable ? this.detailTextExpanded.storyline : false,
    };
  }

  /**
   * Keeps the title within 40px of height: the stylesheet's size when it fits, else the
   * largest size (half-pixel steps, 12px floor) that does. A title too long even at the
   * floor is clamped to two lines. Refits only when the width, the text or the root font
   * size (Dynamic Type, zoom) changes, or the title has outgrown 40px, so the resize its own
   * font change causes does not loop.
   */
  private fitTitleToMaxHeight(): void {
    const element = this.titleTextRef?.nativeElement;
    if (!element) {
      return;
    }

    const maxHeight = GameDetailContentComponent.TITLE_MAX_HEIGHT_PX;
    const minFontSize = GameDetailContentComponent.TITLE_MIN_FONT_SIZE_PX;
    const step = GameDetailContentComponent.TITLE_FONT_SIZE_STEP_PX;
    const clampedClass = GameDetailContentComponent.TITLE_CLAMPED_CLASS;

    const width = element.clientWidth;
    if (width <= 0) {
      return;
    }

    const rootFontSize = getComputedStyle(document.documentElement).fontSize;
    const fitKey = `${String(width)}|${rootFontSize}|${element.textContent}`;
    const overflowing =
      !element.classList.contains(clampedClass) && element.scrollHeight > maxHeight;
    if (fitKey === this.titleFitKey && !overflowing) {
      return;
    }

    this.titleFitKey = fitKey;

    element.style.fontSize = '';
    element.classList.remove(clampedClass);
    if (element.scrollHeight <= maxHeight) {
      return;
    }

    const maxFontSize = Number.parseFloat(getComputedStyle(element).fontSize);
    if (!Number.isFinite(maxFontSize) || maxFontSize <= minFontSize) {
      element.classList.add(clampedClass);
      return;
    }

    const fitsAt = (fontSize: number): boolean => {
      element.style.fontSize = `${String(fontSize)}px`;
      return element.scrollHeight <= maxHeight;
    };

    // Binary search over the step grid for the largest size that fits.
    let low = 0;
    let high = Math.floor((maxFontSize - minFontSize) / step);
    let best: number | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const fontSize = minFontSize + middle * step;
      if (fitsAt(fontSize)) {
        best = fontSize;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    element.style.fontSize = `${String(best ?? minFontSize)}px`;
    if (best === null) {
      element.classList.add(clampedClass);
    }
  }

  private isDetailTextOverflowing(element: HTMLElement | undefined): boolean {
    if (!element) {
      return false;
    }

    const collapsedClass = GameDetailContentComponent.DETAIL_TEXT_COLLAPSED_CLASS;
    const wasCollapsed = element.classList.contains(collapsedClass);

    if (!wasCollapsed) {
      element.classList.add(collapsedClass);
    }

    try {
      return element.scrollHeight - element.clientHeight > 1;
    } finally {
      if (!wasCollapsed) {
        element.classList.remove(collapsedClass);
      }
    }
  }

  formatDate(releaseDate: string | null | undefined): string {
    if (releaseDate === this.cachedFormattedReleaseDateValue) {
      return this.cachedFormattedReleaseDate;
    }

    this.cachedFormattedReleaseDateValue = releaseDate ?? null;

    if (typeof releaseDate !== 'string' || releaseDate.trim().length === 0) {
      this.cachedFormattedReleaseDate = 'Unknown';
      return this.cachedFormattedReleaseDate;
    }

    const timestamp = Date.parse(releaseDate);

    if (Number.isNaN(timestamp)) {
      this.cachedFormattedReleaseDate = 'Unknown';
      return this.cachedFormattedReleaseDate;
    }

    this.cachedFormattedReleaseDate = new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    return this.cachedFormattedReleaseDate;
  }

  formatMetadataList(values: string[] | null | undefined): string {
    const normalized = this.normalizeMetadataList(values);
    return normalized.length > 0 ? normalized.join(', ') : 'None';
  }

  /** Genres as chips: trimmed, de-duplicated, blanks dropped. */
  get genreItems(): string[] {
    return this.normalizeMetadataList(this.game.genres);
  }

  private normalizeMetadataList(values: string[] | null | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
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
    if (
      canOpenMetadataFilter(
        this.showLibrarySections,
        this.allowMetadataFilterLinks,
        this.game.developers
      )
    ) {
      this.developerClick.emit();
    }
  }

  onSeriesClick(): void {
    if (
      canOpenMetadataFilter(
        this.showLibrarySections,
        this.allowMetadataFilterLinks,
        this.game.collections
      )
    ) {
      this.seriesClick.emit();
    }
  }

  onFranchiseClick(): void {
    if (
      canOpenMetadataFilter(
        this.showLibrarySections,
        this.allowMetadataFilterLinks,
        this.game.franchises
      )
    ) {
      this.franchiseClick.emit();
    }
  }

  onPublisherClick(): void {
    if (
      canOpenMetadataFilter(
        this.showLibrarySections,
        this.allowMetadataFilterLinks,
        this.game.publishers
      )
    ) {
      this.publisherClick.emit();
    }
  }

  onGenreClick(): void {
    if (
      canOpenMetadataFilter(
        this.showLibrarySections,
        this.allowMetadataFilterLinks,
        this.game.genres
      )
    ) {
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

  private formatCompletionHours(value: number | null | undefined): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    const rounded = Math.round(value * 10) / 10;
    return `${String(rounded)}h`;
  }

  get displayTitle(): string {
    if (this.cachedDisplayTitleGame === this.game) {
      return this.cachedDisplayTitle;
    }

    this.cachedDisplayTitleGame = this.game;

    const gameEntryLike = this.game as Partial<GameEntry>;
    const customTitle =
      typeof gameEntryLike.customTitle === 'string' ? gameEntryLike.customTitle.trim() : '';

    if (customTitle.length > 0) {
      this.cachedDisplayTitle = customTitle;
      return this.cachedDisplayTitle;
    }

    const title = typeof this.game.title === 'string' ? this.game.title.trim() : '';
    this.cachedDisplayTitle = title.length > 0 ? title : 'Unknown title';
    return this.cachedDisplayTitle;
  }

  get mediaSlides(): DetailMediaSlide[] {
    if (this.cachedMediaSlidesGame === this.game) {
      return this.cachedMediaSlides;
    }

    this.cachedMediaSlidesGame = this.game;
    const slides: DetailMediaSlide[] = [];
    const seen = new Set<string>();

    const coverUrl = typeof this.game.coverUrl === 'string' ? this.game.coverUrl.trim() : '';
    if (coverUrl.length > 0) {
      slides.push({
        key: `cover:${coverUrl}`,
        src: coverUrl,
        kind: 'cover',
      });
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
      slides.push({
        key,
        src: screenshot.url,
        kind: 'screenshot',
      });
      seen.add(screenshot.url);
    }

    this.cachedMediaSlides =
      slides.length > 0 ? slides : GameDetailContentComponent.PLACEHOLDER_MEDIA_SLIDES;
    return this.cachedMediaSlides;
  }

  private resetMediaSlideLoadingState(): void {
    this.loadedMediaSlideKeys = new Set<string>();
    this.prefetchedMediaSlideUrls = new Set<string>();
    this.markMediaSlidesAroundIndex(0);
  }

  private handleSwiperSlideChange(swiper: SwiperClass): void {
    const activeIndex = Number.isInteger(swiper.activeIndex) ? swiper.activeIndex : 0;

    const runChange = () => {
      const hasChanges = this.markMediaSlidesAroundIndex(activeIndex);

      if (hasChanges) {
        this.changeDetectorRef?.markForCheck();
      }
    };

    if (this.ngZone) {
      this.ngZone.run(runChange);
      return;
    }

    runChange();
  }

  private markMediaSlidesAroundIndex(index: number): boolean {
    const slides = this.mediaSlides;
    let hasChanges = false;
    const normalizedIndex = Math.max(0, index);
    const upperBound = Math.min(
      slides.length - 1,
      normalizedIndex + GameDetailContentComponent.PRELOAD_MEDIA_SLIDE_COUNT - 1
    );

    for (let currentIndex = normalizedIndex; currentIndex <= upperBound; currentIndex += 1) {
      const slide = slides[currentIndex];

      if (slide.kind === 'placeholder') {
        continue;
      }

      if (!this.loadedMediaSlideKeys.has(slide.key)) {
        this.loadedMediaSlideKeys.add(slide.key);
        hasChanges = true;
      }
    }

    const prefetchIndex = upperBound + 1;

    if (prefetchIndex < slides.length) {
      this.prefetchMediaSlide(slides[prefetchIndex]);
    }

    return hasChanges;
  }

  private prefetchMediaSlide(slide: DetailMediaSlide): void {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      return;
    }

    const renderUrl = toDetailMediaRenderUrl(slide.src);

    if (!renderUrl || slide.kind === 'placeholder' || isDataOrBlobUrl(renderUrl)) {
      return;
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(renderUrl, window.location.href);
    } catch {
      return;
    }

    if (parsedUrl.origin !== window.location.origin) {
      return;
    }

    const normalizedUrl = parsedUrl.href;

    if (this.prefetchedMediaSlideUrls.has(normalizedUrl)) {
      return;
    }

    this.prefetchedMediaSlideUrls.add(normalizedUrl);
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = normalizedUrl;
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
