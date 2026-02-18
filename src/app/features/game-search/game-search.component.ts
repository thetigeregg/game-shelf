import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject
} from '@angular/core';

import { AlertController } from '@ionic/angular/standalone';
import {
  IonItem,
  IonSelect,
  IonSelectOption,
  IonLabel,
  IonSearchbar,
  IonList,
  IonSpinner,
  IonBadge,
  IonButton
} from '@ionic/angular/standalone';
import { Subject, firstValueFrom, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  switchMap,
  takeUntil,
  tap
} from 'rxjs/operators';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameType,
  ListType
} from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';
import { PlatformOrderService } from '../../core/services/platform-order.service';
import { PlatformCustomizationService } from '../../core/services/platform-customization.service';
import { formatRateLimitedUiError } from '../../core/utils/rate-limit-ui-error';
import { AddToLibraryWorkflowService } from './add-to-library-workflow.service';

interface SelectedPlatform {
  id: number;
  name: string;
}

@Component({
  selector: 'app-game-search',
  templateUrl: './game-search.component.html',
  styleUrls: ['./game-search.component.scss'],
  standalone: true,
  imports: [
    IonItem,
    IonSelect,
    IonSelectOption,
    IonLabel,
    IonSearchbar,
    IonList,
    IonSpinner,
    IonBadge,
    IonButton
  ]
})
export class GameSearchComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) listType!: ListType;
  @Input() actionMode: 'add' | 'select' = 'add';
  @Input() initialQuery = '';
  @Input() initialPlatformIgdbId: number | null = null;
  @Output() gameAdded = new EventEmitter<void>();
  @Output() matchSelected = new EventEmitter<GameCatalogResult>();

  query = '';
  results: GameCatalogResult[] = [];
  searchPlatforms: GameCatalogPlatformOption[] = [];
  selectedSearchPlatformIgdbId: number | null = null;
  isLoading = false;
  hasSearched = false;
  errorMessage = '';
  platformErrorMessage = '';

  private readonly searchState$ = new Subject<{ query: string; platformIgdbId: number | null }>();
  private readonly destroy$ = new Subject<void>();
  private readonly addingExternalIds = new Set<string>();
  private searchReady = false;
  private readonly gameShelfService = inject(GameShelfService);
  private readonly platformOrderService = inject(PlatformOrderService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private readonly alertController = inject(AlertController);
  private readonly addToLibraryWorkflow = inject(AddToLibraryWorkflowService);

  ngOnInit(): void {
    this.loadSearchPlatforms();

    this.searchState$
      .pipe(
        tap((state) => {
          const normalized = state.query.trim();
          this.errorMessage = '';
          this.hasSearched = normalized.length >= 2;

          if (normalized.length < 2) {
            this.results = [];
            this.isLoading = false;
          }
        }),
        debounceTime(300),
        distinctUntilChanged((left, right) => {
          return (
            left.query.trim() === right.query.trim() && left.platformIgdbId === right.platformIgdbId
          );
        }),
        switchMap((state) => {
          const normalized = state.query.trim();

          if (normalized.length < 2) {
            return of([] as GameCatalogResult[]);
          }

          this.isLoading = true;

          return this.gameShelfService.searchGames(normalized, state.platformIgdbId).pipe(
            catchError((error: unknown) => {
              this.errorMessage = formatRateLimitedUiError(
                error,
                'Search failed. Please try again.'
              );
              return of([] as GameCatalogResult[]);
            }),
            finalize(() => {
              this.isLoading = false;
            })
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe((results) => {
        this.results = results;
      });

    this.searchReady = true;
    this.applyInitialSearchInputs();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialQuery'] || changes['initialPlatformIgdbId']) {
      this.applyInitialSearchInputs();
    }

    if (changes['actionMode'] && this.searchPlatforms.length > 0) {
      this.searchPlatforms =
        this.actionMode === 'add'
          ? this.platformOrderService.sortPlatformOptionsByCustomOrder(this.searchPlatforms)
          : this.platformOrderService.sortPlatformOptions(this.searchPlatforms);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(value: string | null | undefined): void {
    this.query = value ?? '';
    this.emitSearchState();
  }

  onSearchPlatformChange(value: string | number | null | undefined): void {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      this.selectedSearchPlatformIgdbId = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      this.selectedSearchPlatformIgdbId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else {
      this.selectedSearchPlatformIgdbId = null;
    }

    this.emitSearchState();
  }

  async addGame(result: GameCatalogResult): Promise<void> {
    if (this.isAdding(result.igdbGameId)) {
      return;
    }

    this.addingExternalIds.add(result.igdbGameId);

    try {
      if (this.actionMode === 'add') {
        const addResult = await this.addToLibraryWorkflow.addToLibrary(result, this.listType);

        if (addResult.status === 'added') {
          this.gameAdded.emit();
        }

        return;
      }

      const platformSelection = await this.resolvePlatformSelection(result);

      if (platformSelection === undefined) {
        return;
      }

      const resolvedForAdd = await this.resolveCoverForAdd(result, platformSelection);
      const resolvedCatalog: GameCatalogResult = {
        ...resolvedForAdd,
        igdbGameId: result.igdbGameId,
        platform: platformSelection.name,
        platformIgdbId: platformSelection.id
      };

      const existingEntry = await this.gameShelfService.findGameByIdentity(
        result.igdbGameId,
        platformSelection.id
      );

      if (existingEntry) {
        await this.presentDuplicateAlert(
          result.title,
          this.getPlatformDisplayName(platformSelection.name, platformSelection.id)
        );
        return;
      }

      this.matchSelected.emit(resolvedCatalog);
    } finally {
      this.addingExternalIds.delete(result.igdbGameId);
    }
  }

  isAdding(externalId: string): boolean {
    return this.addingExternalIds.has(externalId);
  }

  trackByExternalId(_: number, result: GameCatalogResult): string {
    return result.igdbGameId;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/placeholder.png';
    }
  }

  getPlatformLabel(result: GameCatalogResult): string {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      return 'Unknown platform';
    }

    if (platforms.length === 1) {
      return this.getPlatformDisplayName(platforms[0].name, platforms[0].id);
    }

    return `${platforms.length} platforms`;
  }

  getPlatformDisplayName(
    name: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const label = this.platformCustomizationService.getDisplayName(name, platformIgdbId).trim();
    return label.length > 0 ? label : 'Unknown platform';
  }

  getSearchSelectPlatformName(
    name: string | null | undefined,
    platformIgdbId: number | null | undefined
  ): string {
    const customName = this.platformCustomizationService.getCustomName(platformIgdbId);

    if (customName !== null) {
      return customName;
    }

    const normalized = typeof name === 'string' ? name.trim() : '';
    return normalized.length > 0 ? normalized : 'Unknown platform';
  }

  getGameTypeBadgeLabel(result: GameCatalogResult): string | null {
    const gameType = this.normalizeGameType(result.gameType);

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

  getActionLabel(externalId: string): string {
    if (this.actionMode === 'select') {
      return this.isAdding(externalId) ? 'Selecting...' : 'Select';
    }

    return 'Add';
  }

  private async resolvePlatformSelection(
    result: GameCatalogResult
  ): Promise<SelectedPlatform | undefined> {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      await this.presentPlatformRequiredAlert(result.title);
      return undefined;
    }

    if (platforms.length === 1) {
      return platforms[0];
    }

    let selectedIndex = 0;
    const alert = await this.alertController.create({
      header: 'Choose platform',
      message: `Select a platform for ${result.title}.`,
      inputs: platforms.map((platform, index) => ({
        type: 'radio',
        label: this.getPlatformDisplayName(platform.name, platform.id),
        value: String(index),
        checked: index === selectedIndex
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          role: 'confirm',
          handler: (value: string) => {
            const parsed = Number.parseInt(value, 10);

            if (Number.isInteger(parsed) && parsed >= 0 && parsed < platforms.length) {
              selectedIndex = parsed;
            }
          }
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return undefined;
    }

    return platforms[selectedIndex];
  }

  private getPlatformOptions(result: GameCatalogResult): SelectedPlatform[] {
    if (Array.isArray(result.platformOptions) && result.platformOptions.length > 0) {
      return result.platformOptions
        .map((option) => {
          const name = typeof option?.name === 'string' ? option.name.trim() : '';
          const id =
            typeof option?.id === 'number' && Number.isInteger(option.id) && option.id > 0
              ? option.id
              : null;
          return { id, name };
        })
        .filter((option) => option.name.length > 0 && option.id !== null)
        .filter((option, index, items) => {
          return (
            items.findIndex(
              (candidate) => candidate.id === option.id && candidate.name === option.name
            ) === index
          );
        })
        .map((option) => ({
          id: option.id as number,
          name: option.name
        }))
        .sort((left, right) =>
          this.platformOrderService.comparePlatformNames(left.name, right.name)
        );
    }

    return [];
  }

  private normalizeGameType(value: unknown): GameType | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

    if (
      normalized === 'main_game' ||
      normalized === 'dlc_addon' ||
      normalized === 'expansion' ||
      normalized === 'bundle' ||
      normalized === 'standalone_expansion' ||
      normalized === 'mod' ||
      normalized === 'episode' ||
      normalized === 'season' ||
      normalized === 'remake' ||
      normalized === 'remaster' ||
      normalized === 'expanded_game' ||
      normalized === 'port' ||
      normalized === 'fork' ||
      normalized === 'pack' ||
      normalized === 'update'
    ) {
      return normalized;
    }

    return null;
  }

  private async resolveCoverForAdd(
    result: GameCatalogResult,
    platform: SelectedPlatform
  ): Promise<GameCatalogResult> {
    try {
      const useIgdbCover = this.gameShelfService.shouldUseIgdbCoverForPlatform(
        platform.name,
        platform.id
      );
      const candidates = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(
          result.title,
          platform.name,
          platform.id,
          result.igdbGameId
        )
      );
      const boxArtUrl = candidates[0];

      if (!boxArtUrl) {
        return result;
      }

      return {
        ...result,
        coverUrl: boxArtUrl,
        coverSource: useIgdbCover ? 'igdb' : 'thegamesdb'
      };
    } catch {
      return result;
    }
  }

  private loadSearchPlatforms(): void {
    this.gameShelfService
      .listSearchPlatforms()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (platforms) => {
          this.searchPlatforms =
            this.actionMode === 'add'
              ? this.platformOrderService.sortPlatformOptionsByCustomOrder(platforms)
              : this.platformOrderService.sortPlatformOptions(platforms);
          this.platformErrorMessage = '';
        },
        error: () => {
          this.searchPlatforms = [];
          this.platformErrorMessage = 'Unable to load platform filters.';
        }
      });
  }

  private emitSearchState(): void {
    this.searchState$.next({
      query: this.query,
      platformIgdbId: this.selectedSearchPlatformIgdbId
    });
  }

  private applyInitialSearchInputs(): void {
    this.query = this.initialQuery ?? '';
    this.selectedSearchPlatformIgdbId =
      typeof this.initialPlatformIgdbId === 'number' &&
      Number.isInteger(this.initialPlatformIgdbId) &&
      this.initialPlatformIgdbId > 0
        ? this.initialPlatformIgdbId
        : null;

    if (this.searchReady) {
      this.emitSearchState();
    }
  }

  private async presentDuplicateAlert(title: string, platformName: string): Promise<void> {
    const platformSuffix = platformName ? ` on ${platformName}` : '';
    const alert = await this.alertController.create({
      header: 'Duplicate Game',
      message: `${title}${platformSuffix} is already in your game shelf.`,
      buttons: ['OK']
    });

    await alert.present();
  }

  private async presentPlatformRequiredAlert(title: string): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Platform Required',
      message: `A valid IGDB platform is required to add ${title}.`,
      buttons: ['OK']
    });

    await alert.present();
  }
}
