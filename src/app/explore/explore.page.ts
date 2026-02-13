import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import {
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
  IonInfiniteScroll,
  IonInfiniteScrollContent,
  IonText,
  IonThumbnail,
} from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { IgdbProxyService } from '../core/api/igdb-proxy.service';
import { PopularityGameResult, PopularityTypeOption } from '../core/models/game.models';

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
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonList,
    IonInfiniteScroll,
    IonInfiniteScrollContent,
    IonText,
    IonThumbnail,
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

  private readonly igdbProxyService = inject(IgdbProxyService);
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

  onImageError(event: Event): void {
    const target = event.target;

    if (target instanceof HTMLImageElement) {
      target.src = 'assets/icon/favicon.png';
    }
  }

  getPlatformLabel(item: PopularityGameResult): string {
    if (item.game.platform && item.game.platform.trim().length > 0) {
      return item.game.platform.trim();
    }

    if (Array.isArray(item.game.platforms) && item.game.platforms.length > 0) {
      return item.game.platforms[0];
    }

    return 'Unknown platform';
  }

  getPopularityValueLabel(item: PopularityGameResult): string {
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) {
      return 'n/a';
    }

    return Number.isInteger(item.value) ? String(item.value) : item.value.toFixed(2);
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
