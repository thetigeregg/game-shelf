import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject, firstValueFrom, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, switchMap, takeUntil, tap } from 'rxjs/operators';
import { GameCatalogResult, ListType } from '../../core/models/game.models';
import { GameShelfService } from '../../core/services/game-shelf.service';

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
      const platform = await this.resolvePlatformSelection(result);

      if (platform === undefined) {
        return;
      }

      const resolvedForAdd = await this.resolveCoverForAdd(result, platform);

      await this.gameShelfService.addGame(
        {
          ...resolvedForAdd,
          platform,
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
      return platforms[0];
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

  private async resolvePlatformSelection(result: GameCatalogResult): Promise<string | null | undefined> {
    const platforms = this.getPlatformOptions(result);

    if (platforms.length === 0) {
      return null;
    }

    if (platforms.length === 1) {
      return platforms[0];
    }

    let selectedPlatform = platforms[0];
    const alert = await this.alertController.create({
      header: 'Choose platform',
      message: `Select a platform for ${result.title}.`,
      inputs: platforms.map(platform => ({
        type: 'radio',
        label: platform,
        value: platform,
        checked: platform === selectedPlatform,
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
            if (typeof value === 'string' && value.length > 0) {
              selectedPlatform = value;
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

    return selectedPlatform;
  }

  private getPlatformOptions(result: GameCatalogResult): string[] {
    if (Array.isArray(result.platforms) && result.platforms.length > 0) {
      return result.platforms;
    }

    if (typeof result.platform === 'string' && result.platform.trim().length > 0) {
      return [result.platform.trim()];
    }

    return [];
  }

  private getListLabel(): string {
    return this.listType === 'collection' ? 'Collection' : 'Wishlist';
  }

  private async resolveCoverForAdd(result: GameCatalogResult, platform: string | null): Promise<GameCatalogResult> {
    try {
      const candidates = await firstValueFrom(this.gameShelfService.searchBoxArtByTitle(result.title, platform));
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
