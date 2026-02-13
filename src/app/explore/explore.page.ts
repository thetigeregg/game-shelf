import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import {
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
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonText,
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { GameCatalogResult, PopularityGameResult, PopularityTypeOption } from '../core/models/game.models';
import { PlatformCustomizationService } from '../core/services/platform-customization.service';
import { GameDetailContentComponent } from '../features/game-detail/game-detail-content.component';

@Component({
  selector: 'app-explore-page',
  templateUrl: './explore.page.html',
  styleUrls: ['./explore.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
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
    IonSpinner,
    IonList,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonText,
    GameDetailContentComponent,
  ],
})
export class ExplorePage implements OnInit {
  private static readonly PAGE_SIZE = 20;

  popularityTypes: PopularityTypeOption[] = [];
  selectedPopularityTypeId: number | null = null;
  games: PopularityGameResult[] = [];
  isLoadingTypes = false;
  isLoadingGames = false;
  isLoadingMore = false;
  hasMore = false;
  errorMessage = '';
  isGameDetailModalOpen = false;
  isLoadingDetail = false;
  detailErrorMessage = '';
  selectedGameDetail: GameCatalogResult | null = null;

  private readonly igdbProxyService = inject(IgdbProxyService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private offset = 0;

  async ngOnInit(): Promise<void> {
    await this.loadPopularityTypes();
  }

  async onPopularityTypeChange(value: string | number | null | undefined): Promise<void> {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      this.selectedPopularityTypeId = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number.parseInt(value, 10);
      this.selectedPopularityTypeId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    } else {
      this.selectedPopularityTypeId = null;
    }

    this.offset = 0;
    this.games = [];
    this.hasMore = false;

    if (this.selectedPopularityTypeId !== null) {
      await this.loadGamesPage(false);
    }
  }

  async loadMore(event: Event): Promise<void> {
    if (this.selectedPopularityTypeId === null || this.isLoadingMore || !this.hasMore) {
      await this.completeInfiniteScroll(event);
      return;
    }

    this.isLoadingMore = true;

    try {
      await this.loadGamesPage(true);
    } finally {
      this.isLoadingMore = false;
      await this.completeInfiniteScroll(event);
    }
  }

  trackByPopularityTypeId(_: number, item: PopularityTypeOption): number {
    return item.id;
  }

  trackByGameId(index: number, item: PopularityGameResult): string {
    return `${item.game.igdbGameId}:${index}`;
  }

  async openGameDetail(item: PopularityGameResult): Promise<void> {
    this.isGameDetailModalOpen = true;
    this.isLoadingDetail = true;
    this.detailErrorMessage = '';
    this.selectedGameDetail = item.game;

    try {
      const detail = await firstValueFrom(this.igdbProxyService.getGameById(item.game.igdbGameId));
      this.selectedGameDetail = detail;
    } catch (error) {
      this.detailErrorMessage = error instanceof Error ? error.message : 'Unable to load game details.';
    } finally {
      this.isLoadingDetail = false;
    }
  }

  closeGameDetailModal(): void {
    this.isGameDetailModalOpen = false;
    this.isLoadingDetail = false;
    this.detailErrorMessage = '';
    this.selectedGameDetail = null;
  }

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }

  getPlatformLabel(item: PopularityGameResult): string {
    const preferredPlatform = this.resolvePreferredPlatform(item);
    return this.getAliasedPlatformLabel(preferredPlatform.name, preferredPlatform.id);
  }

  private resolvePreferredPlatform(item: PopularityGameResult): { id: number | null; name: string } {
    const fromPrimaryName = typeof item.game.platform === 'string' ? item.game.platform.trim() : '';
    const fromPrimaryId = Number.isInteger(item.game.platformIgdbId) && (item.game.platformIgdbId as number) > 0
      ? item.game.platformIgdbId as number
      : null;

    if (fromPrimaryName.length > 0) {
      return { id: fromPrimaryId, name: fromPrimaryName };
    }

    if (Array.isArray(item.game.platformOptions) && item.game.platformOptions.length > 0) {
      const first = item.game.platformOptions[0];
      const name = typeof first?.name === 'string' ? first.name.trim() : '';
      const id = Number.isInteger(first?.id) && (first.id as number) > 0 ? first.id as number : null;

      if (name.length > 0) {
        return { id, name };
      }
    }

    if (Array.isArray(item.game.platforms) && item.game.platforms.length > 0) {
      const name = typeof item.game.platforms[0] === 'string' ? item.game.platforms[0].trim() : '';

      if (name.length > 0) {
        return { id: null, name };
      }
    }

    return { id: null, name: '' };
  }

  private getAliasedPlatformLabel(name: string, platformIgdbId: number | null): string {
    if (name.trim().length > 0) {
      const aliased = this.platformCustomizationService.getDisplayName(name, platformIgdbId).trim();

      if (aliased.length > 0) {
        return aliased;
      }
    }

    return 'Unknown platform';
  }

  private async loadPopularityTypes(): Promise<void> {
    this.isLoadingTypes = true;
    this.errorMessage = '';

    try {
      const types = await firstValueFrom(this.igdbProxyService.listPopularityTypes());
      this.popularityTypes = types;

      if (types.length > 0) {
        this.selectedPopularityTypeId = types[0].id;
        this.offset = 0;
        await this.loadGamesPage(false);
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Unable to load popularity categories.';
      this.popularityTypes = [];
      this.selectedPopularityTypeId = null;
      this.games = [];
      this.hasMore = false;
    } finally {
      this.isLoadingTypes = false;
    }
  }

  private async loadGamesPage(append: boolean): Promise<void> {
    if (this.selectedPopularityTypeId === null) {
      return;
    }

    if (!append) {
      this.isLoadingGames = true;
      this.errorMessage = '';
    }

    try {
      const items = await firstValueFrom(
        this.igdbProxyService.listPopularityGames(
          this.selectedPopularityTypeId,
          ExplorePage.PAGE_SIZE,
          this.offset,
        ),
      );

      this.games = append ? [...this.games, ...items] : items;
      this.offset += items.length;
      this.hasMore = items.length === ExplorePage.PAGE_SIZE;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Unable to load popular games.';
      this.hasMore = false;
    } finally {
      if (!append) {
        this.isLoadingGames = false;
      }
    }
  }

  private async completeInfiniteScroll(event: Event): Promise<void> {
    const target = event.target as HTMLIonInfiniteScrollElement | null;

    if (!target || typeof target.complete !== 'function') {
      return;
    }

    await target.complete();
  }
}
