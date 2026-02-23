import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import {
  IonBadge,
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
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
  pricetags,
  star,
  trophy
} from 'ionicons/icons';
import {
  GameCatalogResult,
  GameEntry,
  GameRating,
  GameStatus
} from '../../core/models/game.models';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { canOpenMetadataFilter } from './game-detail-metadata.utils';

type DetailContext = 'library' | 'explore';
type DetailGame = GameCatalogResult | GameEntry;

@Component({
  selector: 'app-game-detail-content',
  templateUrl: './game-detail-content.component.html',
  styleUrls: ['./game-detail-content.component.scss'],
  standalone: true,
  imports: [IonList, IonItem, IonLabel, IonBadge, IonButton, IonSelect, IonSelectOption, IonIcon]
})
export class GameDetailContentComponent {
  private static readonly PLACEHOLDER_SRC = 'assets/icon/placeholder.png';
  private static readonly RETRY_DATASET_KEY = 'detailRetryAttempted';
  @Input({ required: true }) game!: DetailGame;
  @Input() context: DetailContext = 'library';
  @Input() statusOptions: { value: GameStatus; label: string }[] = [];
  @Input() ratingOptions: GameRating[] = [1, 2, 3, 4, 5];
  @Input() showAddToLibraryAction = false;
  @Input() isAddToLibraryLoading = false;

  @Output() statusChange = new EventEmitter<GameStatus | null | undefined>();
  @Output() clearStatus = new EventEmitter<void>();
  @Output() ratingChange = new EventEmitter<number | null | undefined>();
  @Output() clearRating = new EventEmitter<void>();
  @Output() openTags = new EventEmitter<void>();
  @Output() developerClick = new EventEmitter<void>();
  @Output() seriesClick = new EventEmitter<void>();
  @Output() franchiseClick = new EventEmitter<void>();
  @Output() genreClick = new EventEmitter<void>();
  @Output() publisherClick = new EventEmitter<void>();
  @Output() addToLibrary = new EventEmitter<void>();

  detailTextExpanded = {
    summary: false,
    storyline: false
  };

  private readonly platformCustomizationService = inject(PlatformCustomizationService);

  constructor() {
    addIcons({
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
      pricetags,
      star,
      trophy
    });
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
      const name = typeof first?.name === 'string' ? first.name.trim() : '';
      const id =
        Number.isInteger(first?.id) && (first.id as number) > 0 ? (first.id as number) : null;

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
        name: typeof tag?.name === 'string' ? tag.name.trim() : '',
        color:
          typeof tag?.color === 'string' && tag.color.trim().length > 0
            ? tag.color.trim()
            : '#808080'
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
      day: 'numeric'
    });
  }

  formatMetadataList(values: string[] | null | undefined): string {
    if (!Array.isArray(values) || values.length === 0) {
      return 'None';
    }

    const normalized = [
      ...new Set(
        values.map((value) => String(value ?? '').trim()).filter((value) => value.length > 0)
      )
    ];

    return normalized.length > 0 ? normalized.join(', ') : 'None';
  }

  hasMetadataValue(values: string[] | null | undefined): boolean {
    return Array.isArray(values) && values.some((value) => String(value ?? '').trim().length > 0);
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

  emitRatingChange(value: number | null | undefined): void {
    this.ratingChange.emit(value);
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

  onImageLoad(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      delete target.dataset[GameDetailContentComponent.RETRY_DATASET_KEY];
    }
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      const currentSrc = (target.currentSrc || target.src || '').trim();

      if (currentSrc.includes(GameDetailContentComponent.PLACEHOLDER_SRC)) {
        return;
      }

      const hasRetried = target.dataset[GameDetailContentComponent.RETRY_DATASET_KEY] === '1';

      if (!hasRetried) {
        target.dataset[GameDetailContentComponent.RETRY_DATASET_KEY] = '1';
        const retrySrc = this.buildRetryImageSrc(currentSrc);

        if (retrySrc) {
          target.src = retrySrc;
          return;
        }
      }

      target.src = GameDetailContentComponent.PLACEHOLDER_SRC;
    }
  }

  private buildRetryImageSrc(source: string): string | null {
    const normalized = source.trim();

    if (!normalized || normalized.startsWith('data:image/')) {
      return null;
    }

    if (normalized.startsWith('blob:')) {
      return normalized;
    }

    try {
      const parsed = new URL(normalized, window.location.origin);
      parsed.searchParams.set('_img_retry', Date.now().toString());
      return parsed.toString();
    } catch {
      return normalized;
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
    return `${rounded}h`;
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
}
