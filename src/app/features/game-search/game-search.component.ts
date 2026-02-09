import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject, firstValueFrom, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, switchMap, takeUntil, tap } from 'rxjs/operators';
import { GameCatalogPlatformOption, GameCatalogResult, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

interface SelectedPlatform {
  id: number | null;
  name: string | null;
}

@Component({
  selector: 'app-game-search',
  templateUrl: './game-search.component.html',
  styleUrls: ['./game-search.component.scss'],
  standalone: false,
})
export class GameSearchComponent implements OnInit, OnDestroy {
  @Input({ required: true }) listType!: ListType;

  query = '';
  results: GameCatalogResult[] = [];
  isLoading = false;
  hasSearched = false;
  errorMessage = '';

  private readonly searchTerms$ = new Subject<string>();
  private readonly destroy$ = new Subject<void>();
  private readonly addingExternalIds = new Set<string>();
  private readonly gameShelfService = inject(GameShelfService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);

  ngOnInit(): void {
    this.searchTerms$
      .pipe(
        tap(term => {
          const normalized = term.trim();
          this.errorMessage = '';
          this.hasSearched = normalized.length >= 2;

          if (normalized.length < 2) {
            this.results = [];
            this.isLoading = false;
          }
        }),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap(term => {
          const normalized = term.trim();

          if (normalized.length < 2) {
            return of([] as GameCatalogResult[]);
          }

          this.isLoading = true;

          return this.gameShelfService.searchGames(normalized).pipe(
            catchError(() => {
              this.errorMessage = 'Search failed. Please try again.';
              return of([] as GameCatalogResult[]);
            }),
            finalize(() => {
              this.isLoading = false;
            })
          );
        }),
        takeUntil(this.destroy$)
      )
      .subscribe(results => {
        this.results = results;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange(value: string | null | undefined): void {
    this.query = value ?? '';
    this.searchTerms$.next(this.query);
  }

  async addGame(result: GameCatalogResult): Promise<void> {
    if (this.isAdding(result.externalId)) {
      return;
    }

    this.addingExternalIds.add(result.externalId);

    try {
      const platformSelection = await this.resolvePlatformSelection(result);

      if (platformSelection === undefined) {
        return;
      }

      const resolvedForAdd = await this.resolveCoverForAdd(result, platformSelection);

      await this.gameShelfService.addGame(
        {
          ...resolvedForAdd,
          platform: platformSelection.name,
        },
        this.listType
      );
      await this.presentToast(`Added to ${this.getListLabel()}.`);
    } finally {
      this.addingExternalIds.delete(result.externalId);
    }
  }

  isAdding(externalId: string): boolean {
    return this.addingExternalIds.has(externalId);
  }

  trackByExternalId(_: number, result: GameCatalogResult): string {
    return result.externalId;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }

  getPlatformLabel(result: GameCatalogResult): string {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      return 'Unknown platform';
    }

    if (platforms.length === 1) {
      return platforms[0].name;
    }

    return `${platforms.length} platforms`;
  }

  getCoverSourceLabel(result: GameCatalogResult): string | null {
    if (result.coverSource === 'thegamesdb') {
      return '2D Box Art';
    }

    if (result.coverSource === 'igdb') {
      return 'IGDB Cover';
    }

    return null;
  }

  private async resolvePlatformSelection(result: GameCatalogResult): Promise<SelectedPlatform | undefined> {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      return { id: null, name: null };
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
        label: platform.name,
        value: String(index),
        checked: index === selectedIndex,
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Add',
          role: 'confirm',
          handler: (value: string) => {
            const parsed = Number.parseInt(value, 10);

            if (Number.isInteger(parsed) && parsed >= 0 && parsed < platforms.length) {
              selectedIndex = parsed;
            }
          },
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') {
      return undefined;
    }

    return platforms[selectedIndex];
  }

  private getPlatformOptions(result: GameCatalogResult): GameCatalogPlatformOption[] {
    if (Array.isArray(result.platformOptions) && result.platformOptions.length > 0) {
      return result.platformOptions
        .map(option => {
          const name = typeof option?.name === 'string' ? option.name.trim() : '';
          const id = typeof option?.id === 'number' && Number.isInteger(option.id) && option.id > 0
            ? option.id
            : null;
          return { id, name };
        })
        .filter(option => option.name.length > 0)
        .filter((option, index, items) => {
          return items.findIndex(candidate => candidate.id === option.id && candidate.name === option.name) === index;
        });
    }

    if (Array.isArray(result.platforms) && result.platforms.length > 0) {
      return result.platforms
        .map(platform => typeof platform === 'string' ? platform.trim() : '')
        .filter(platform => platform.length > 0)
        .map(platform => ({ id: null, name: platform }));
    }

    if (typeof result.platform === 'string' && result.platform.trim().length > 0) {
      return [{ id: null, name: result.platform.trim() }];
    }

    return [];
  }

  private getListLabel(): string {
    return this.listType === 'collection' ? 'Collection' : 'Wishlist';
  }

  private async resolveCoverForAdd(result: GameCatalogResult, platform: SelectedPlatform): Promise<GameCatalogResult> {
    try {
      const candidates = await firstValueFrom(
        this.gameShelfService.searchBoxArtByTitle(result.title, platform.name, platform.id)
      );
      const boxArtUrl = candidates[0];

      if (!boxArtUrl) {
        return result;
      }

      return {
        ...result,
        coverUrl: boxArtUrl,
        coverSource: 'thegamesdb',
      };
    } catch {
      return result;
    }
  }

  private async presentToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 1600,
      position: 'bottom',
      color: 'success',
    });

    await toast.present();
  }
}
