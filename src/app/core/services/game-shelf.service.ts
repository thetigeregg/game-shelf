import { Injectable, inject } from '@angular/core';
import { merge, Observable, Subject, firstValueFrom, from, of } from 'rxjs';
import { catchError, map, switchMap, startWith } from 'rxjs/operators';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameListView,
  HltbMatchCandidate,
  GameRating,
  GameStatus,
  GameTag,
  ListType,
  Tag,
  TagSummary
} from '../models/game.models';
import { SyncEventsService } from './sync-events.service';
import { PlatformOrderService } from './platform-order.service';
import { environment } from '../../../environments/environment';
import { AppDb } from '../data/app-db';
import { DebugLogService } from './debug-log.service';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  ClientWriteAuthService
} from './client-write-auth.service';
import {
  hasCompletionTimes,
  normalizeGameId,
  normalizePlatform,
  normalizePlatformIgdbId,
  normalizeRating,
  normalizeTagColor,
  normalizeTagIds,
  normalizeTheGamesDbUrl
} from './game-shelf-normalization';

@Injectable({ providedIn: 'root' })
export class GameShelfService {
  private static readonly IGDB_COVER_MIGRATION_DONE_STORAGE_KEY =
    'game-shelf:igdb-cover-migration:v2';
  private static readonly IGDB_ID_QUERY_PATTERN = /^igdb:\s*(\d+)$/i;
  private static readonly IGDB_COVER_PLATFORM_IGDB_IDS = new Set<number>([
    6, 34, 39, 82, 163, 167, 472, 508
  ]);
  private static readonly IGDB_COVER_MIGRATION_PLATFORM_IGDB_IDS = new Set<number>([167, 508]);
  private static readonly IGDB_COVER_PLATFORM_NAMES = new Set<string>([
    'pc',
    'windows',
    'microsoft windows',
    'pc (microsoft windows)',
    'android',
    'ios',
    'web browser',
    'steamvr',
    'visionos',
    'playstation 5',
    'nintendo switch 2'
  ]);
  private readonly listRefresh$ = new Subject<void>();
  private readonly syncEvents = inject(SyncEventsService);
  private readonly repository: GameRepository = inject(GAME_REPOSITORY);
  private readonly searchApi: GameSearchApi = inject(GAME_SEARCH_API);
  private readonly platformOrderService = inject(PlatformOrderService);
  private readonly db = inject(AppDb);
  private readonly debugLogService = inject(DebugLogService);
  private readonly clientWriteAuthService = inject(ClientWriteAuthService);

  watchList(listType: ListType): Observable<GameEntry[]> {
    return merge(this.listRefresh$, this.syncEvents.changed$).pipe(
      startWith(undefined),
      switchMap(() => from(this.loadGamesWithTags(listType)))
    );
  }

  watchTags(): Observable<TagSummary[]> {
    return merge(this.listRefresh$, this.syncEvents.changed$).pipe(
      startWith(undefined),
      switchMap(() => from(this.loadTagSummaries()))
    );
  }

  watchViews(listType: ListType): Observable<GameListView[]> {
    return merge(this.listRefresh$, this.syncEvents.changed$).pipe(
      startWith(undefined),
      switchMap(() => from(this.repository.listViews(listType)))
    );
  }

  async listTags(): Promise<Tag[]> {
    return this.repository.listTags();
  }

  async listLibraryGames(): Promise<GameEntry[]> {
    const [games, tags] = await Promise.all([
      this.repository.listAll(),
      this.repository.listTags()
    ]);

    return this.attachTags(games, tags);
  }

  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]> {
    const normalized = query.trim();
    const directLookupId = this.parseIgdbIdSearchQuery(normalized);

    if (directLookupId !== null) {
      return this.searchApi.getGameById(directLookupId).pipe(map((result) => [result]));
    }

    if (normalized.length < 2) {
      return of([]);
    }

    return this.searchApi.searchGames(normalized, platformIgdbId);
  }

  private parseIgdbIdSearchQuery(query: string): string | null {
    const match = GameShelfService.IGDB_ID_QUERY_PATTERN.exec(query);
    return match ? match[1] : null;
  }

  listSearchPlatforms(): Observable<GameCatalogPlatformOption[]> {
    return this.searchApi
      .listPlatforms()
      .pipe(map((platforms) => this.platformOrderService.sortPlatformOptions(platforms)));
  }

  searchHltbCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null
  ): Observable<HltbMatchCandidate[]> {
    const normalized = title.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    return this.searchApi.lookupCompletionTimeCandidates(normalized, releaseYear, platform);
  }

  async addGame(result: GameCatalogResult, listType: ListType): Promise<GameEntry> {
    const normalizedGameId = normalizeGameId(result.igdbGameId);
    const normalizedPlatformIgdbId = normalizePlatformIgdbId(result.platformIgdbId);
    const normalizedPlatform = normalizePlatform(result.platform);
    const normalizedCatalog: GameCatalogResult = {
      ...result,
      igdbGameId: normalizedGameId,
      platform: normalizedPlatform,
      platformIgdbId: normalizedPlatformIgdbId
    };
    const entry = await this.repository.upsertFromCatalog(
      {
        ...normalizedCatalog
      },
      listType
    );
    this.listRefresh$.next();
    void this.enrichCatalogWithCompletionTimesInBackground(normalizedCatalog, listType);
    return entry;
  }

  async findGameByIdentity(
    igdbGameId: string,
    platformIgdbId: number | null | undefined
  ): Promise<GameEntry | undefined> {
    const normalizedGameId = normalizeGameId(igdbGameId);
    const normalizedPlatform = normalizePlatformIgdbId(platformIgdbId);
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

  async rematchGame(
    currentIgdbGameId: string,
    currentPlatformIgdbId: number,
    replacement: GameCatalogResult
  ): Promise<GameEntry> {
    const current = await this.repository.exists(currentIgdbGameId, currentPlatformIgdbId);

    if (!current) {
      throw new Error('Game entry no longer exists.');
    }

    const normalizedGameId = normalizeGameId(replacement.igdbGameId);
    const normalizedPlatformIgdbId = normalizePlatformIgdbId(replacement.platformIgdbId);
    const normalizedPlatform = normalizePlatform(replacement.platform);
    const normalizedReplacement: GameCatalogResult = {
      ...replacement,
      igdbGameId: normalizedGameId,
      platform: normalizedPlatform,
      platformIgdbId: normalizedPlatformIgdbId,
      // Reset manual metadata so it can be regenerated from the selected match.
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null
    };

    const updated = await this.repository.upsertFromCatalog(
      normalizedReplacement,
      current.listType
    );

    const replacementIsDifferentIdentity =
      current.igdbGameId !== normalizedGameId ||
      current.platformIgdbId !== normalizedPlatformIgdbId;

    if (replacementIsDifferentIdentity) {
      await this.repository.remove(current.igdbGameId, current.platformIgdbId);
    }

    let withStatus = updated;
    let withRating = withStatus;
    let withTags = withRating;

    if (current.status !== null && current.status !== undefined) {
      const next = await this.repository.setGameStatus(
        withStatus.igdbGameId,
        withStatus.platformIgdbId,
        current.status
      );
      if (next) {
        withStatus = next;
      }
    }

    if (current.rating !== null && current.rating !== undefined) {
      const next = await this.repository.setGameRating(
        withStatus.igdbGameId,
        withStatus.platformIgdbId,
        current.rating
      );
      if (next) {
        withRating = next;
      }
    }

    const tagIds = normalizeTagIds(current.tagIds);
    if (tagIds.length > 0) {
      const next = await this.repository.setGameTags(
        withRating.igdbGameId,
        withRating.platformIgdbId,
        tagIds
      );
      if (next) {
        withTags = next;
      }
    }

    let withNotes = withTags;
    if (typeof current.notes === 'string') {
      const next = await this.repository.setGameNotes(
        withTags.igdbGameId,
        withTags.platformIgdbId,
        current.notes
      );
      if (next) {
        withNotes = next;
      }
    }

    this.listRefresh$.next();
    void this.enrichCatalogWithCompletionTimesInBackground(normalizedReplacement, current.listType);

    const tags = await this.repository.listTags();
    return this.attachTags([withNotes], tags)[0];
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
      refreshed.platformIgdbId ?? null
    );

    const updated = await this.repository.upsertFromCatalog(
      {
        ...refreshed,
        igdbGameId: existing.igdbGameId,
        platform: resolvedPlatform.platform,
        platformIgdbId: resolvedPlatform.platformIgdbId,
        coverUrl: existing.coverUrl,
        coverSource: existing.coverSource
      },
      existing.listType
    );

    this.listRefresh$.next();
    return updated;
  }

  async refreshGameCompletionTimes(igdbGameId: string, platformIgdbId: number): Promise<GameEntry> {
    this.debugLogService.trace('game_shelf.hltb.refresh_start', {
      igdbGameId,
      platformIgdbId,
      mode: 'default'
    });
    const existing = await this.repository.exists(igdbGameId, platformIgdbId);

    if (!existing) {
      this.debugLogService.trace('game_shelf.hltb.refresh_missing_game', {
        igdbGameId,
        platformIgdbId
      });
      throw new Error('Game entry no longer exists.');
    }

    return this.refreshGameCompletionTimesWithLookup(
      existing,
      existing.title,
      existing.releaseYear,
      existing.platform
    );
  }

  async refreshGameCompletionTimesWithQuery(
    igdbGameId: string,
    platformIgdbId: number,
    query: { title: string; releaseYear?: number | null; platform?: string | null }
  ): Promise<GameEntry> {
    this.debugLogService.trace('game_shelf.hltb.refresh_start', {
      igdbGameId,
      platformIgdbId,
      mode: 'query',
      query
    });
    const existing = await this.repository.exists(igdbGameId, platformIgdbId);

    if (!existing) {
      this.debugLogService.trace('game_shelf.hltb.refresh_missing_game', {
        igdbGameId,
        platformIgdbId,
        mode: 'query'
      });
      throw new Error('Game entry no longer exists.');
    }

    const title = String(query.title ?? '').trim() || existing.title;
    const releaseYear = Number.isInteger(query.releaseYear)
      ? (query.releaseYear as number)
      : existing.releaseYear;
    const platform =
      typeof query.platform === 'string' && query.platform.trim().length > 0
        ? query.platform.trim()
        : existing.platform;

    return this.refreshGameCompletionTimesWithLookup(existing, title, releaseYear, platform);
  }

  private async refreshGameCompletionTimesWithLookup(
    existing: GameEntry,
    title: string,
    releaseYear: number | null,
    platform: string
  ): Promise<GameEntry> {
    this.debugLogService.trace('game_shelf.hltb.lookup_start', {
      gameKey: `${existing.igdbGameId}::${existing.platformIgdbId}`,
      lookupTitle: title,
      lookupReleaseYear: releaseYear,
      lookupPlatform: platform
    });
    const completionTimes = await firstValueFrom(
      this.searchApi.lookupCompletionTimes(title, releaseYear, platform)
    );
    this.debugLogService.trace('game_shelf.hltb.lookup_complete', {
      gameKey: `${existing.igdbGameId}::${existing.platformIgdbId}`,
      completionTimes,
      hasCompletionTimes: completionTimes !== null
    });

    const updated = await this.repository.upsertFromCatalog(
      {
        igdbGameId: existing.igdbGameId,
        title: existing.title,
        coverUrl: existing.coverUrl,
        coverSource: existing.coverSource,
        storyline: existing.storyline ?? null,
        summary: existing.summary ?? null,
        gameType: existing.gameType ?? null,
        hltbMainHours: completionTimes?.hltbMainHours ?? null,
        hltbMainExtraHours: completionTimes?.hltbMainExtraHours ?? null,
        hltbCompletionistHours: completionTimes?.hltbCompletionistHours ?? null,
        similarGameIgdbIds: existing.similarGameIgdbIds ?? [],
        collections: existing.collections ?? [],
        developers: existing.developers ?? [],
        franchises: existing.franchises ?? [],
        genres: existing.genres ?? [],
        publishers: existing.publishers ?? [],
        platforms: [existing.platform],
        platformOptions: [{ id: existing.platformIgdbId, name: existing.platform }],
        platform: existing.platform,
        platformIgdbId: existing.platformIgdbId,
        releaseDate: existing.releaseDate,
        releaseYear: existing.releaseYear
      },
      existing.listType
    );

    this.listRefresh$.next();
    this.debugLogService.trace('game_shelf.hltb.refresh_complete', {
      gameKey: `${existing.igdbGameId}::${existing.platformIgdbId}`,
      updatedHltbMainHours: updated.hltbMainHours,
      updatedHltbMainExtraHours: updated.hltbMainExtraHours,
      updatedHltbCompletionistHours: updated.hltbCompletionistHours
    });
    return updated;
  }

  searchBoxArtByTitle(
    query: string,
    platform?: string | null,
    platformIgdbId?: number | null,
    igdbGameId?: string
  ): Observable<string[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    if (
      this.shouldUseIgdbCoverForPlatform(platform, platformIgdbId) &&
      typeof igdbGameId === 'string' &&
      igdbGameId.trim().length > 0
    ) {
      return this.searchApi.getGameById(igdbGameId.trim()).pipe(
        map((result) => {
          const coverUrl = typeof result.coverUrl === 'string' ? result.coverUrl.trim() : '';
          return coverUrl.length > 0 ? [coverUrl] : [];
        }),
        catchError(() => of([]))
      );
    }

    return this.searchApi.searchBoxArtByTitle(normalized, platform, platformIgdbId);
  }

  getIgdbCoverByGameId(igdbGameId: string): Observable<string | null> {
    const normalized = igdbGameId.trim();

    if (normalized.length === 0) {
      return of(null);
    }

    return this.searchApi.getGameById(normalized).pipe(
      map((result) => {
        const coverUrl = typeof result.coverUrl === 'string' ? result.coverUrl.trim() : '';
        return coverUrl.length > 0 ? coverUrl : null;
      }),
      catchError(() => of(null))
    );
  }

  shouldUseIgdbCoverForPlatform(platform?: string | null, platformIgdbId?: number | null): boolean {
    if (
      typeof platformIgdbId === 'number' &&
      Number.isInteger(platformIgdbId) &&
      platformIgdbId > 0
    ) {
      return GameShelfService.IGDB_COVER_PLATFORM_IGDB_IDS.has(platformIgdbId);
    }

    const normalizedPlatform = typeof platform === 'string' ? platform.trim().toLowerCase() : '';
    return GameShelfService.IGDB_COVER_PLATFORM_NAMES.has(normalizedPlatform);
  }

  async updateGameCover(
    igdbGameId: string,
    platformIgdbId: number,
    coverUrl: string,
    coverSource: 'thegamesdb' | 'igdb' = 'thegamesdb'
  ): Promise<GameEntry> {
    const updated = await this.repository.updateCover(
      igdbGameId,
      platformIgdbId,
      coverUrl,
      coverSource
    );

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  async setGameCustomCover(
    igdbGameId: string,
    platformIgdbId: number,
    customCoverUrl: string | null
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameCustomCover(
      igdbGameId,
      platformIgdbId,
      customCoverUrl
    );

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  async setGameTags(
    igdbGameId: string,
    platformIgdbId: number,
    tagIds: number[]
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameTags(igdbGameId, platformIgdbId, tagIds);

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();

    return this.attachTags([updated], tags)[0];
  }

  async setGameNotes(
    igdbGameId: string,
    platformIgdbId: number,
    notes: string | null
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameNotes(igdbGameId, platformIgdbId, notes);

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();
    return this.attachTags([updated], tags)[0];
  }

  async setGameCustomMetadata(
    igdbGameId: string,
    platformIgdbId: number,
    customizations: {
      title?: string | null;
      platform?: { name: string; igdbId: number } | null;
    }
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameCustomMetadata(
      igdbGameId,
      platformIgdbId,
      customizations
    );

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();
    return this.attachTags([updated], tags)[0];
  }

  async setGameStatus(
    igdbGameId: string,
    platformIgdbId: number,
    status: GameStatus | null
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameStatus(igdbGameId, platformIgdbId, status);

    if (!updated) {
      throw new Error('Game entry no longer exists.');
    }

    const tags = await this.repository.listTags();
    this.listRefresh$.next();
    return this.attachTags([updated], tags)[0];
  }

  async setGameRating(
    igdbGameId: string,
    platformIgdbId: number,
    rating: GameRating | null
  ): Promise<GameEntry> {
    const updated = await this.repository.setGameRating(
      igdbGameId,
      platformIgdbId,
      normalizeRating(rating)
    );

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
      color: normalizeTagColor(color)
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
      color: normalizeTagColor(color)
    });
    this.listRefresh$.next();
    return updated;
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.repository.deleteTag(tagId);
    this.listRefresh$.next();
  }

  async getView(viewId: number): Promise<GameListView | undefined> {
    return this.repository.getView(viewId);
  }

  async createView(
    name: string,
    listType: ListType,
    filters: GameListFilters,
    groupBy: GameGroupByField
  ): Promise<GameListView> {
    const created = await this.repository.createView({
      name: name.trim(),
      listType,
      filters,
      groupBy
    });
    this.listRefresh$.next();
    return created;
  }

  async renameView(viewId: number, name: string): Promise<GameListView> {
    const updated = await this.repository.updateView(viewId, { name: name.trim() });

    if (!updated) {
      throw new Error('View no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  async updateViewConfiguration(
    viewId: number,
    filters: GameListFilters,
    groupBy: GameGroupByField
  ): Promise<GameListView> {
    const updated = await this.repository.updateView(viewId, { filters, groupBy });

    if (!updated) {
      throw new Error('View no longer exists.');
    }

    this.listRefresh$.next();
    return updated;
  }

  async deleteView(viewId: number): Promise<void> {
    await this.repository.deleteView(viewId);
    this.listRefresh$.next();
  }

  async migratePreferredPlatformCoversToIgdb(): Promise<void> {
    if (this.isIgdbCoverMigrationComplete()) {
      return;
    }

    const allGames = await this.repository.listAll();
    const candidates = allGames.filter((game) => {
      if (!GameShelfService.IGDB_COVER_MIGRATION_PLATFORM_IGDB_IDS.has(game.platformIgdbId)) {
        return false;
      }

      if (game.coverSource !== 'thegamesdb') {
        return false;
      }

      if (typeof game.customCoverUrl === 'string' && game.customCoverUrl.trim().length > 0) {
        return false;
      }

      return typeof game.coverUrl === 'string' && game.coverUrl.trim().length > 0;
    });

    if (candidates.length === 0) {
      this.markIgdbCoverMigrationComplete();
      return;
    }

    const staleServerUrls = new Set<string>();
    let updatedCount = 0;

    for (const game of candidates) {
      const gameKey = `${game.igdbGameId}::${game.platformIgdbId}`;
      await this.db.imageCache.where('gameKey').equals(gameKey).delete();

      const staleUrl = normalizeTheGamesDbUrl(game.coverUrl);

      if (staleUrl) {
        staleServerUrls.add(staleUrl);
      }

      try {
        const refreshed = await firstValueFrom(this.searchApi.getGameById(game.igdbGameId));
        const igdbCoverUrl =
          typeof refreshed.coverUrl === 'string' ? refreshed.coverUrl.trim() : '';

        if (!igdbCoverUrl) {
          continue;
        }

        const updated = await this.repository.updateCover(
          game.igdbGameId,
          game.platformIgdbId,
          igdbCoverUrl,
          'igdb'
        );

        if (updated) {
          updatedCount += 1;
        }
      } catch {
        // Keep migration best-effort. A failed title should not block startup.
      }
    }

    await this.purgeServerImageCacheUrls([...staleServerUrls]);

    if (updatedCount > 0) {
      this.listRefresh$.next();
    }

    this.markIgdbCoverMigrationComplete();
  }

  private resolvePlatformSelection(
    currentPlatform: string,
    currentPlatformIgdbId: number,
    availablePlatforms: string[],
    platformOptions: { id: number | null; name: string }[] | undefined,
    refreshedPlatform: string | null,
    refreshedPlatformIgdbId: number | null
  ): { platform: string; platformIgdbId: number } {
    const normalizedOptions = this.normalizePlatformOptions(availablePlatforms, platformOptions);

    if (refreshedPlatform) {
      const match = normalizedOptions.find((option) => option.name === refreshedPlatform);
      return {
        platform: refreshedPlatform,
        platformIgdbId: match?.id ?? refreshedPlatformIgdbId ?? currentPlatformIgdbId
      };
    }

    if (currentPlatform && availablePlatforms.includes(currentPlatform)) {
      const match = normalizedOptions.find((option) => option.name === currentPlatform);
      return {
        platform: currentPlatform,
        platformIgdbId: match?.id ?? currentPlatformIgdbId
      };
    }

    if (currentPlatformIgdbId > 0) {
      const match = normalizedOptions.find((option) => option.id === currentPlatformIgdbId);

      if (match) {
        return {
          platform: match.name,
          platformIgdbId: currentPlatformIgdbId
        };
      }
    }

    return {
      platform: currentPlatform,
      platformIgdbId: currentPlatformIgdbId
    };
  }

  private normalizePlatformOptions(
    availablePlatforms: string[],
    platformOptions: { id: number | null; name: string }[] | undefined
  ): { id: number | null; name: string }[] {
    if (Array.isArray(platformOptions) && platformOptions.length > 0) {
      return platformOptions
        .map((option) => ({
          id:
            typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0
              ? option.id
              : null,
          name: option.name
        }))
        .filter((option) => typeof option.name === 'string' && option.name.length > 0);
    }

    return availablePlatforms.map((platform) => ({
      id: null,
      name: platform
    }));
  }

  private attachTags(games: GameEntry[], tags: Tag[]): GameEntry[] {
    const tagsById = new Map<number, GameTag>();

    tags.forEach((tag) => {
      if (typeof tag.id !== 'number' || !Number.isInteger(tag.id) || tag.id <= 0) {
        return;
      }

      tagsById.set(tag.id, {
        id: tag.id,
        name: tag.name,
        color: tag.color
      });
    });

    return games.map((game) => {
      const gameTagIds = normalizeTagIds(game.tagIds);
      const gameTags = gameTagIds
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is GameTag => Boolean(tag));

      return {
        ...game,
        tagIds: gameTagIds,
        tags: gameTags
      };
    });
  }

  private async loadGamesWithTags(listType: ListType): Promise<GameEntry[]> {
    const [games, tags] = await Promise.all([
      this.repository.listByType(listType),
      this.repository.listTags()
    ]);

    return this.attachTags(games, tags);
  }

  private async loadTagSummaries(): Promise<TagSummary[]> {
    const [tags, games] = await Promise.all([
      this.repository.listTags(),
      this.repository.listAll()
    ]);
    const usageCountByTag = new Map<number, number>();

    games.forEach((game) => {
      normalizeTagIds(game.tagIds).forEach((tagId) => {
        usageCountByTag.set(tagId, (usageCountByTag.get(tagId) ?? 0) + 1);
      });
    });

    return tags.map((tag) => ({
      ...tag,
      gameCount: tag.id ? (usageCountByTag.get(tag.id) ?? 0) : 0
    }));
  }

  private async enrichCatalogWithCompletionTimesInBackground(
    result: GameCatalogResult,
    listType: ListType
  ): Promise<void> {
    if (hasCompletionTimes(result)) {
      return;
    }

    const title = typeof result.title === 'string' ? result.title.trim() : '';

    if (title.length < 2) {
      return;
    }

    try {
      const completionTimes = await firstValueFrom(
        this.searchApi.lookupCompletionTimes(
          title,
          Number.isInteger(result.releaseYear) ? result.releaseYear : null,
          typeof result.platform === 'string' ? result.platform : null
        )
      );

      if (!completionTimes) {
        return;
      }

      await this.repository.upsertFromCatalog(
        {
          ...result,
          ...completionTimes
        },
        listType
      );
      this.listRefresh$.next();
    } catch {
      // Ignore HLTB enrichment failures. Add flow should stay responsive.
    }
  }

  private async purgeServerImageCacheUrls(urls: string[]): Promise<void> {
    const normalizedUrls = [
      ...new Set(
        urls
          .map((url) => normalizeTheGamesDbUrl(url))
          .filter((url): url is string => typeof url === 'string' && url.length > 0)
      )
    ];

    if (normalizedUrls.length === 0) {
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      const clientWriteToken = this.clientWriteAuthService.getToken();

      if (clientWriteToken) {
        headers[CLIENT_WRITE_TOKEN_HEADER_NAME] = clientWriteToken;
      }

      await fetch(`${environment.gameApiBaseUrl}/v1/images/cache/purge`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls: normalizedUrls })
      });
    } catch {
      // Ignore server cache purge failures. Client cover migration still succeeds.
    }
  }

  private isIgdbCoverMigrationComplete(): boolean {
    try {
      return localStorage.getItem(GameShelfService.IGDB_COVER_MIGRATION_DONE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private markIgdbCoverMigrationComplete(): void {
    try {
      localStorage.setItem(GameShelfService.IGDB_COVER_MIGRATION_DONE_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures.
    }
  }
}
