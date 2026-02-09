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
    const resolvedPlatform = this.resolvePlatform(existing.platform, refreshed.platforms, refreshed.platform);

    const updated = await this.repository.upsertFromCatalog(
      { ...refreshed, platform: resolvedPlatform },
      existing.listType,
    );

    this.listRefresh$.next();
    return updated;
  }

  private resolvePlatform(
    currentPlatform: string | null,
    availablePlatforms: string[],
    refreshedPlatform: string | null,
  ): string | null {
    if (refreshedPlatform) {
      return refreshedPlatform;
    }

    if (currentPlatform && availablePlatforms.includes(currentPlatform)) {
      return currentPlatform;
    }

    return currentPlatform ?? null;
  }
}
