import { Injectable, inject } from '@angular/core';
import { Observable, Subject, firstValueFrom, from, of } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameEntry,
  GameRating,
  GameStatus,
  GameTag,
  ListType,
  Tag,
  TagSummary
} from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class GameShelfService {
  private readonly listRefresh$ = new Subject<void>();
  private readonly repository: GameRepository = inject(GAME_REPOSITORY);
  private readonly searchApi: GameSearchApi = inject(GAME_SEARCH_API);

  watchList(listType: ListType): Observable<GameEntry[]> {
    return this.listRefresh$.pipe(
      startWith(undefined),
      switchMap(() => from(this.loadGamesWithTags(listType)))
    );
  }

  watchTags(): Observable<TagSummary[]> {
    return this.listRefresh$.pipe(
      startWith(undefined),
      switchMap(() => from(this.loadTagSummaries()))
    );
  }

  async listTags(): Promise<Tag[]> {
    return this.repository.listTags();
  }

  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    return this.searchApi.searchGames(normalized, platformIgdbId);
  }

  listSearchPlatforms(): Observable<GameCatalogPlatformOption[]> {
    return this.searchApi.listPlatforms();
  }

  async addGame(result: GameCatalogResult, listType: ListType): Promise<GameEntry> {
    const normalizedGameId = this.normalizeGameId(result.igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePlatformIgdbId(result.platformIgdbId);
    const normalizedPlatform = this.normalizePlatform(result.platform);
    const entry = await this.repository.upsertFromCatalog(
      {
        ...result,
        igdbGameId: normalizedGameId,
        platform: normalizedPlatform,
        platformIgdbId: normalizedPlatformIgdbId,
      },
      listType,
    );
    this.listRefresh$.next();
    return entry;
  }

  async findGameByIdentity(igdbGameId: string, platformIgdbId: number | null | undefined): Promise<GameEntry | undefined> {
    const normalizedGameId = this.normalizeGameId(igdbGameId);
    const normalizedPlatform = this.normalizePlatformIgdbId(platformIgdbId);
    return this.repository.exists(normalizedGameId, normalizedPlatform);
  }

  async moveGame(igdbGameId: string, platformIgdbId: number, targetList: ListType): Promise<void> {
    await this.repository.moveToList(igdbGameId, platformIgdbId, targetList);
    this.listRefresh$.next();
  }

  async removeGame(igdbGameId: string, platformIgdbId: number): Promise<void> {
    await this.repository.remove(igdbGameId, platformIgdbId);
    this.listRefresh$.next();
  }

  async refreshGameMetadata(igdbGameId: string, platformIgdbId: number): Promise<GameEntry> {
    const existing = await this.repository.exists(igdbGameId, platformIgdbId);

    if (!existing) {
      throw new Error('Game entry no longer exists.');
    }

    const refreshed = await firstValueFrom(this.searchApi.getGameById(igdbGameId));
    const resolvedPlatform = this.resolvePlatformSelection(
      existing.platform,
      existing.platformIgdbId,
      refreshed.platforms,
      refreshed.platformOptions,
      refreshed.platform,
      refreshed.platformIgdbId ?? null,
    );

    const updated = await this.repository.upsertFromCatalog(
      {
        ...refreshed,
        igdbGameId: existing.igdbGameId,
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

  async updateGameCover(igdbGameId: string, platformIgdbId: number, coverUrl: string): Promise<GameEntry> {
    const updated = await this.repository.updateCover(igdbGameId, platformIgdbId, coverUrl, 'thegamesdb');

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  async setGameTags(igdbGameId: string, platformIgdbId: number, tagIds: number[]): Promise<GameEntry> {
    const updated = await this.repository.setGameTags(igdbGameId, platformIgdbId, tagIds);

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();

    return this.attachTags([updated], tags)[0];
  }

  async setGameStatus(igdbGameId: string, platformIgdbId: number, status: GameStatus | null): Promise<GameEntry> {
    const updated = await this.repository.setGameStatus(igdbGameId, platformIgdbId, status);

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();
    return this.attachTags([updated], tags)[0];
  }

  async setGameRating(igdbGameId: string, platformIgdbId: number, rating: GameRating | null): Promise<GameEntry> {
    const updated = await this.repository.setGameRating(igdbGameId, platformIgdbId, this.normalizeRating(rating));

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();
    return this.attachTags([updated], tags)[0];
  }

  async createTag(name: string, color: string): Promise<Tag> {
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      throw new Error('Tag name is required.');
    }

    const created = await this.repository.upsertTag({
      name: normalizedName,
      color: this.normalizeTagColor(color),
    });
    this.listRefresh$.next();
    return created;
  }

  async updateTag(tagId: number, name: string, color: string): Promise<Tag> {
    const normalizedName = name.trim();

    if (normalizedName.length === 0) {
      throw new Error('Tag name is required.');
    }

    const updated = await this.repository.upsertTag({
      id: tagId,
      name: normalizedName,
      color: this.normalizeTagColor(color),
    });
    this.listRefresh$.next();
    return updated;
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.repository.deleteTag(tagId);
    this.listRefresh$.next();
  }

  private resolvePlatformSelection(
    currentPlatform: string,
    currentPlatformIgdbId: number,
    availablePlatforms: string[],
    platformOptions: { id: number | null; name: string }[] | undefined,
    refreshedPlatform: string | null,
    refreshedPlatformIgdbId: number | null,
  ): { platform: string; platformIgdbId: number } {
    const normalizedOptions = this.normalizePlatformOptions(availablePlatforms, platformOptions);

    if (refreshedPlatform) {
      const match = normalizedOptions.find(option => option.name === refreshedPlatform);
      return {
        platform: refreshedPlatform,
        platformIgdbId: match?.id ?? refreshedPlatformIgdbId ?? currentPlatformIgdbId,
      };
    }

    if (currentPlatform && availablePlatforms.includes(currentPlatform)) {
      const match = normalizedOptions.find(option => option.name === currentPlatform);
      return {
        platform: currentPlatform,
        platformIgdbId: match?.id ?? currentPlatformIgdbId,
      };
    }

    if (currentPlatformIgdbId > 0) {
      const match = normalizedOptions.find(option => option.id === currentPlatformIgdbId);

      if (match) {
        return {
          platform: match.name,
          platformIgdbId: currentPlatformIgdbId,
        };
      }
    }

    return {
      platform: currentPlatform,
      platformIgdbId: currentPlatformIgdbId,
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

  private attachTags(games: GameEntry[], tags: Tag[]): GameEntry[] {
    const tagsById = new Map<number, GameTag>();

    tags.forEach(tag => {
      if (typeof tag.id !== 'number' || !Number.isInteger(tag.id) || tag.id <= 0) {
        return;
      }

      tagsById.set(tag.id, {
        id: tag.id,
        name: tag.name,
        color: tag.color,
      });
    });

    return games.map(game => {
      const gameTagIds = this.normalizeTagIds(game.tagIds);
      const gameTags = gameTagIds
        .map(tagId => tagsById.get(tagId))
        .filter((tag): tag is GameTag => Boolean(tag));

      return {
        ...game,
        tagIds: gameTagIds,
        tags: gameTags,
      };
    });
  }

  private async loadGamesWithTags(listType: ListType): Promise<GameEntry[]> {
    const [games, tags] = await Promise.all([
      this.repository.listByType(listType),
      this.repository.listTags(),
    ]);

    return this.attachTags(games, tags);
  }

  private async loadTagSummaries(): Promise<TagSummary[]> {
    const [tags, games] = await Promise.all([
      this.repository.listTags(),
      this.repository.listAll(),
    ]);
    const usageCountByTag = new Map<number, number>();

    games.forEach(game => {
      this.normalizeTagIds(game.tagIds).forEach(tagId => {
        usageCountByTag.set(tagId, (usageCountByTag.get(tagId) ?? 0) + 1);
      });
    });

    return tags.map(tag => ({
      ...tag,
      gameCount: tag.id ? usageCountByTag.get(tag.id) ?? 0 : 0,
    }));
  }

  private normalizeTagIds(tagIds: number[] | undefined): number[] {
    if (!Array.isArray(tagIds)) {
      return [];
    }

    return [...new Set(
      tagIds
        .filter(tagId => Number.isInteger(tagId) && tagId > 0)
        .map(tagId => Math.trunc(tagId))
    )];
  }

  private normalizeTagColor(value: string): string {
    const normalized = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : '#3880ff';
  }

  private normalizeGameId(value: string): string {
    const normalized = String(value ?? '').trim();

    if (normalized.length === 0) {
      throw new Error('IGDB game id is required.');
    }

    return normalized;
  }

  private normalizePlatformIgdbId(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new Error('IGDB platform id is required.');
    }

    return value;
  }

  private normalizePlatform(value: string | null | undefined): string {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      throw new Error('Platform is required.');
    }

    return normalized;
  }

  private normalizeRating(value: GameRating | null | undefined): GameRating | null {
    if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
      return value;
    }

    return null;
  }
}
