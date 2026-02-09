import { Injectable, inject } from '@angular/core';
import { Observable, Subject, firstValueFrom, from, of } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GameCatalogResult, GameEntry, ListType } from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class GameShelfService {
  private readonly listRefresh$ = new Subject<void>();
  private readonly repository: GameRepository = inject(GAME_REPOSITORY);
  private readonly searchApi: GameSearchApi = inject(GAME_SEARCH_API);

  watchList(listType: ListType): Observable<GameEntry[]> {
    return this.listRefresh$.pipe(
      startWith(undefined),
      switchMap(() => from(this.repository.listByType(listType)))
    );
  }

  searchGames(query: string): Observable<GameCatalogResult[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    return this.searchApi.searchGames(normalized);
  }

  async addGame(result: GameCatalogResult, listType: ListType): Promise<GameEntry> {
    const entry = await this.repository.upsertFromCatalog(result, listType);
    this.listRefresh$.next();
    return entry;
  }

  async moveGame(externalId: string, targetList: ListType): Promise<void> {
    await this.repository.moveToList(externalId, targetList);
    this.listRefresh$.next();
  }

  async removeGame(externalId: string): Promise<void> {
    await this.repository.remove(externalId);
    this.listRefresh$.next();
  }

  async refreshGameMetadata(externalId: string): Promise<GameEntry> {
    const existing = await this.repository.exists(externalId);

    if (!existing) {
      throw new Error('Game entry no longer exists.');
    }

    const refreshed = await firstValueFrom(this.searchApi.getGameById(externalId));
    const resolvedPlatform = this.resolvePlatformSelection(
      existing.platform,
      existing.platformIgdbId ?? null,
      refreshed.platforms,
      refreshed.platformOptions,
      refreshed.platform,
      refreshed.platformIgdbId ?? null,
    );

    const updated = await this.repository.upsertFromCatalog(
      {
        ...refreshed,
        platform: resolvedPlatform.platform,
        platformIgdbId: resolvedPlatform.platformIgdbId,
        coverUrl: existing.coverUrl,
        coverSource: existing.coverSource,
      },
      existing.listType,
    );

    this.listRefresh$.next();
    return updated;
  }

  searchBoxArtByTitle(query: string, platform?: string | null, platformIgdbId?: number | null): Observable<string[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    return this.searchApi.searchBoxArtByTitle(normalized, platform, platformIgdbId);
  }

  async updateGameCover(externalId: string, coverUrl: string): Promise<GameEntry> {
    const updated = await this.repository.updateCover(externalId, coverUrl, 'thegamesdb');

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  private resolvePlatformSelection(
    currentPlatform: string | null,
    currentPlatformIgdbId: number | null,
    availablePlatforms: string[],
    platformOptions: { id: number | null; name: string }[] | undefined,
    refreshedPlatform: string | null,
    refreshedPlatformIgdbId: number | null,
  ): { platform: string | null; platformIgdbId: number | null } {
    const normalizedOptions = this.normalizePlatformOptions(availablePlatforms, platformOptions);

    if (refreshedPlatform) {
      const match = normalizedOptions.find(option => option.name === refreshedPlatform);
      return {
        platform: refreshedPlatform,
        platformIgdbId: match?.id ?? refreshedPlatformIgdbId ?? null,
      };
    }

    if (currentPlatform && availablePlatforms.includes(currentPlatform)) {
      const match = normalizedOptions.find(option => option.name === currentPlatform);
      return {
        platform: currentPlatform,
        platformIgdbId: match?.id ?? currentPlatformIgdbId ?? null,
      };
    }

    if (currentPlatformIgdbId !== null) {
      const match = normalizedOptions.find(option => option.id === currentPlatformIgdbId);

      if (match) {
        return {
          platform: match.name,
          platformIgdbId: currentPlatformIgdbId,
        };
      }
    }

    return {
      platform: currentPlatform ?? null,
      platformIgdbId: currentPlatformIgdbId ?? null,
    };
  }

  private normalizePlatformOptions(
    availablePlatforms: string[],
    platformOptions: { id: number | null; name: string }[] | undefined,
  ): { id: number | null; name: string }[] {
    if (Array.isArray(platformOptions) && platformOptions.length > 0) {
      return platformOptions
        .map(option => ({
          id: typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0 ? option.id : null,
          name: option.name,
        }))
        .filter(option => typeof option.name === 'string' && option.name.length > 0);
    }

    return availablePlatforms.map(platform => ({
      id: null,
      name: platform,
    }));
  }
}
