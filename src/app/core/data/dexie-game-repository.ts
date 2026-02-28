import { Injectable, inject } from '@angular/core';
import { AppDb } from './app-db';
import { GameRepository } from './game-repository';
import {
  CoverSource,
  DEFAULT_GAME_LIST_FILTERS,
  GameCatalogResult,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameListView,
  GameRating,
  GameStatus,
  ListType,
  Tag
} from '../models/game.models';
import {
  normalizeGameRatingFilterList,
  normalizeGameStatusFilterList,
  normalizeGameTypeList,
  normalizeNonNegativeNumber,
  normalizeStringList
} from '../utils/game-filter-utils';
import { detectReviewSourceFromUrl } from '../utils/url-host.util';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from './sync-outbox-writer';
import { HtmlSanitizerService } from '../security/html-sanitizer.service';

@Injectable({ providedIn: 'root' })
export class DexieGameRepository implements GameRepository {
  private readonly db = inject(AppDb);
  private readonly htmlSanitizer = inject(HtmlSanitizerService);
  private readonly outboxWriter = inject<SyncOutboxWriter | null>(SYNC_OUTBOX_WRITER, {
    optional: true
  });

  async listByType(listType: ListType): Promise<GameEntry[]> {
    return this.db.games.where('listType').equals(listType).sortBy('title');
  }

  async listAll(): Promise<GameEntry[]> {
    return this.db.games.toArray();
  }

  async upsertFromCatalog(result: GameCatalogResult, targetList: ListType): Promise<GameEntry> {
    const now = new Date().toISOString();
    const normalizedGameId = this.normalizeGameId(result.igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePlatformIgdbId(result.platformIgdbId);
    const normalizedPlatformName = this.normalizePlatformName(result.platform);
    const existing = await this.exists(normalizedGameId, normalizedPlatformIgdbId);
    const incomingReviewScore = result.reviewScore ?? result.metacriticScore;
    const incomingReviewUrl = result.reviewUrl ?? result.metacriticUrl;
    const incomingMetacriticScore =
      result.reviewSource === 'metacritic' ? incomingReviewScore : result.metacriticScore;
    const incomingMetacriticUrl =
      result.reviewSource === 'metacritic' ? incomingReviewUrl : result.metacriticUrl;

    if (existing?.id !== undefined) {
      const updated: GameEntry = {
        ...existing,
        igdbGameId: normalizedGameId,
        title: result.title,
        customTitle: this.resolveCustomTitle(existing.customTitle, result.title),
        coverUrl: result.coverUrl,
        customCoverUrl: this.normalizeCustomCoverUrl(existing.customCoverUrl),
        coverSource: result.coverSource,
        storyline: this.normalizeTextValue(result.storyline),
        summary: this.normalizeTextValue(result.summary),
        gameType: this.resolveGameType(result.gameType, existing.gameType),
        hltbMainHours: this.resolveCompletionHours(result.hltbMainHours, existing.hltbMainHours),
        hltbMainExtraHours: this.resolveCompletionHours(
          result.hltbMainExtraHours,
          existing.hltbMainExtraHours
        ),
        hltbCompletionistHours: this.resolveCompletionHours(
          result.hltbCompletionistHours,
          existing.hltbCompletionistHours
        ),
        reviewScore: this.resolveMetacriticScore(
          incomingReviewScore,
          existing.reviewScore ?? existing.metacriticScore
        ),
        reviewUrl: this.resolveMetacriticUrl(
          incomingReviewUrl,
          existing.reviewUrl ?? existing.metacriticUrl
        ),
        reviewSource: this.resolveReviewSource(
          result.reviewSource,
          existing.reviewSource,
          incomingReviewScore,
          incomingReviewUrl,
          existing.reviewScore ?? existing.metacriticScore,
          existing.reviewUrl ?? existing.metacriticUrl
        ),
        mobyScore: this.resolveMobyScore(result.mobyScore, existing.mobyScore),
        mobygamesGameId: this.resolveMobygamesGameId(
          result.mobygamesGameId,
          existing.mobygamesGameId
        ),
        metacriticScore: this.resolveMetacriticScore(
          incomingMetacriticScore,
          existing.reviewScore ?? existing.metacriticScore
        ),
        metacriticUrl: this.resolveMetacriticUrl(
          incomingMetacriticUrl,
          existing.reviewUrl ?? existing.metacriticUrl
        ),
        similarGameIgdbIds: this.resolveGameIdList(
          result.similarGameIgdbIds,
          existing.similarGameIgdbIds
        ),
        collections: this.normalizeTextList(result.collections),
        developers: this.normalizeTextList(result.developers),
        franchises: this.normalizeTextList(result.franchises),
        genres: this.normalizeTextList(result.genres),
        publishers: this.normalizeTextList(result.publishers),
        platform: normalizedPlatformName,
        platformIgdbId: normalizedPlatformIgdbId,
        customPlatform: this.resolveCustomPlatformName(
          existing.customPlatform,
          existing.customPlatformIgdbId,
          normalizedPlatformName,
          normalizedPlatformIgdbId
        ),
        customPlatformIgdbId: this.resolveCustomPlatformIgdbId(
          existing.customPlatformIgdbId,
          existing.customPlatform,
          normalizedPlatformName,
          normalizedPlatformIgdbId
        ),
        tagIds: this.normalizeTagIds(existing.tagIds),
        notes: this.normalizeNotes(existing.notes),
        releaseDate: result.releaseDate,
        releaseYear: result.releaseYear,
        status: this.normalizeStatus(existing.status),
        rating: this.normalizeRating(existing.rating),
        listType: targetList,
        updatedAt: now
      };

      await this.db.games.put(updated);
      this.queueGameUpsert(updated);
      return updated;
    }

    const created: GameEntry = {
      igdbGameId: normalizedGameId,
      title: result.title,
      customTitle: null,
      coverUrl: result.coverUrl,
      customCoverUrl: null,
      coverSource: result.coverSource,
      storyline: this.normalizeTextValue(result.storyline),
      summary: this.normalizeTextValue(result.summary),
      gameType: this.normalizeGameType(result.gameType),
      hltbMainHours: this.normalizeCompletionHours(result.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(result.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(result.hltbCompletionistHours),
      reviewScore: this.normalizeMetacriticScore(result.reviewScore ?? result.metacriticScore),
      reviewUrl: this.normalizeMetacriticUrl(incomingReviewUrl),
      reviewSource: this.normalizeReviewSource(
        result.reviewSource,
        incomingReviewScore,
        incomingReviewUrl
      ),
      mobyScore: this.normalizeMobyScore(result.mobyScore),
      mobygamesGameId: this.normalizeMobygamesGameId(result.mobygamesGameId),
      metacriticScore: this.normalizeMetacriticScore(incomingMetacriticScore),
      metacriticUrl: this.normalizeMetacriticUrl(incomingMetacriticUrl),
      similarGameIgdbIds: this.normalizeGameIdList(result.similarGameIgdbIds),
      collections: this.normalizeTextList(result.collections),
      developers: this.normalizeTextList(result.developers),
      franchises: this.normalizeTextList(result.franchises),
      genres: this.normalizeTextList(result.genres),
      publishers: this.normalizeTextList(result.publishers),
      platform: normalizedPlatformName,
      platformIgdbId: normalizedPlatformIgdbId,
      customPlatform: null,
      customPlatformIgdbId: null,
      tagIds: [],
      notes: null,
      releaseDate: result.releaseDate,
      releaseYear: result.releaseYear,
      status: null,
      rating: null,
      listType: targetList,
      createdAt: now,
      updatedAt: now
    };

    const id = await this.db.games.add(created);
    const stored = { ...created, id };
    this.queueGameUpsert(stored);
    return stored;
  }

  async moveToList(
    igdbGameId: string,
    platformIgdbId: number,
    targetList: ListType
  ): Promise<void> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return;
    }

    await this.db.games.update(existing.id, {
      listType: targetList,
      updatedAt: new Date().toISOString()
    });

    const updated = await this.exists(igdbGameId, platformIgdbId);

    if (updated) {
      this.queueGameUpsert(updated);
    }
  }

  async remove(igdbGameId: string, platformIgdbId: number): Promise<void> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return;
    }

    await this.db.games.delete(existing.id);
    this.queueGameDelete(igdbGameId, platformIgdbId);
  }

  async exists(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined> {
    const normalizedGameId = typeof igdbGameId === 'string' ? igdbGameId.trim() : '';

    if (normalizedGameId.length === 0) {
      return undefined;
    }

    if (
      typeof platformIgdbId !== 'number' ||
      !Number.isInteger(platformIgdbId) ||
      platformIgdbId <= 0
    ) {
      return undefined;
    }

    return this.db.games
      .where('[igdbGameId+platformIgdbId]')
      .equals([normalizedGameId, platformIgdbId])
      .first();
  }

  async updateCover(
    igdbGameId: string,
    platformIgdbId: number,
    coverUrl: string | null,
    coverSource: CoverSource
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      coverUrl,
      coverSource,
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameStatus(
    igdbGameId: string,
    platformIgdbId: number,
    status: GameStatus | null
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      status: this.normalizeStatus(status),
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameRating(
    igdbGameId: string,
    platformIgdbId: number,
    rating: GameRating | null
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      rating: this.normalizeRating(rating),
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameTags(
    igdbGameId: string,
    platformIgdbId: number,
    tagIds: number[]
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      tagIds: this.normalizeTagIds(tagIds),
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameNotes(
    igdbGameId: string,
    platformIgdbId: number,
    notes: string | null
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      notes: this.normalizeNotes(notes),
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameCustomCover(
    igdbGameId: string,
    platformIgdbId: number,
    customCoverUrl: string | null
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      customCoverUrl: this.normalizeCustomCoverUrl(customCoverUrl),
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async setGameCustomMetadata(
    igdbGameId: string,
    platformIgdbId: number,
    customizations: {
      title?: string | null;
      platform?: { name: string; igdbId: number } | null;
    }
  ): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const nextCustomTitle =
      customizations.title === undefined
        ? this.normalizeCustomTitle(existing.customTitle, existing.title)
        : this.normalizeCustomTitle(customizations.title, existing.title);
    const nextCustomPlatformName =
      customizations.platform === undefined
        ? this.normalizeCustomPlatformName(
            existing.customPlatform,
            existing.platform,
            existing.platformIgdbId,
            existing.platformIgdbId
          )
        : this.normalizeCustomPlatformName(
            customizations.platform?.name ?? null,
            existing.platform,
            customizations.platform?.igdbId ?? null,
            existing.platformIgdbId
          );
    const nextCustomPlatformIgdbId =
      customizations.platform === undefined
        ? this.normalizeCustomPlatformIgdbId(
            existing.customPlatformIgdbId,
            existing.customPlatform,
            existing.platform,
            existing.platformIgdbId
          )
        : this.normalizeCustomPlatformIgdbId(
            customizations.platform?.igdbId ?? null,
            customizations.platform?.name ?? null,
            existing.platform,
            existing.platformIgdbId
          );

    const updated: GameEntry = {
      ...existing,
      customTitle: nextCustomTitle,
      customPlatform: nextCustomPlatformName,
      customPlatformIgdbId: nextCustomPlatformIgdbId,
      updatedAt: new Date().toISOString()
    };

    await this.db.games.put(updated);
    this.queueGameUpsert(updated);
    return updated;
  }

  async listTags(): Promise<Tag[]> {
    return this.db.tags.orderBy('name').toArray();
  }

  async upsertTag(tag: { id?: number; name: string; color: string }): Promise<Tag> {
    const normalizedName = tag.name.trim();
    const now = new Date().toISOString();
    const existingByName = await this.db.tags
      .where('name')
      .equalsIgnoreCase(normalizedName)
      .first();

    if (existingByName?.id !== undefined && existingByName.id !== tag.id) {
      const updatedByName: Tag = {
        ...existingByName,
        color: tag.color,
        updatedAt: now
      };

      await this.db.tags.put(updatedByName);
      this.queueTagUpsert(updatedByName);
      return updatedByName;
    }

    if (tag.id !== undefined) {
      const existingById = await this.db.tags.get(tag.id);

      if (existingById) {
        const updatedById: Tag = {
          ...existingById,
          name: normalizedName,
          color: tag.color,
          updatedAt: now
        };

        await this.db.tags.put(updatedById);
        this.queueTagUpsert(updatedById);
        return updatedById;
      }
    }

    const created: Tag = {
      name: normalizedName,
      color: tag.color,
      createdAt: now,
      updatedAt: now
    };
    const createdId = await this.db.tags.add(created);
    const stored = { ...created, id: createdId };
    this.queueTagUpsert(stored);
    return stored;
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.db.tags.delete(tagId);
    this.queueTagDelete(tagId);

    const games = await this.db.games.toArray();
    const now = new Date().toISOString();

    for (const game of games) {
      const currentTagIds = this.normalizeTagIds(game.tagIds);
      const nextTagIds = currentTagIds.filter((id) => id !== tagId);

      if (nextTagIds.length === currentTagIds.length || game.id === undefined) {
        continue;
      }

      await this.db.games.update(game.id, {
        tagIds: nextTagIds,
        updatedAt: now
      });

      this.queueGameUpsert({
        ...game,
        tagIds: nextTagIds,
        updatedAt: now
      });
    }
  }

  async listViews(listType: ListType): Promise<GameListView[]> {
    return this.db.views.where('listType').equals(listType).sortBy('name');
  }

  async getView(viewId: number): Promise<GameListView | undefined> {
    return this.db.views.get(viewId);
  }

  async createView(view: {
    name: string;
    listType: ListType;
    filters: GameListFilters;
    groupBy: GameGroupByField;
  }): Promise<GameListView> {
    const now = new Date().toISOString();
    const created: GameListView = {
      name: this.normalizeViewName(view.name),
      listType: view.listType,
      filters: this.normalizeViewFilters(view.filters),
      groupBy: this.normalizeGroupBy(view.groupBy),
      createdAt: now,
      updatedAt: now
    };
    const id = await this.db.views.add(created);
    const stored = { ...created, id };
    this.queueViewUpsert(stored);
    return stored;
  }

  async updateView(
    viewId: number,
    updates: { name?: string; filters?: GameListFilters; groupBy?: GameGroupByField }
  ): Promise<GameListView | undefined> {
    const existing = await this.db.views.get(viewId);

    if (!existing) {
      return undefined;
    }

    const updated: GameListView = {
      ...existing,
      name: updates.name !== undefined ? this.normalizeViewName(updates.name) : existing.name,
      filters:
        updates.filters !== undefined
          ? this.normalizeViewFilters(updates.filters)
          : this.normalizeViewFilters(existing.filters),
      groupBy:
        updates.groupBy !== undefined
          ? this.normalizeGroupBy(updates.groupBy)
          : this.normalizeGroupBy(existing.groupBy),
      updatedAt: new Date().toISOString()
    };

    await this.db.views.put(updated);
    this.queueViewUpsert(updated);
    return updated;
  }

  async deleteView(viewId: number): Promise<void> {
    await this.db.views.delete(viewId);
    this.queueViewDelete(viewId);
  }

  private queueGameUpsert(game: GameEntry): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'game',
      operation: 'upsert',
      payload: game
    });
  }

  private queueGameDelete(igdbGameId: string, platformIgdbId: number): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'game',
      operation: 'delete',
      payload: { igdbGameId, platformIgdbId }
    });
  }

  private queueTagUpsert(tag: Tag): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'tag',
      operation: 'upsert',
      payload: tag
    });
  }

  private queueTagDelete(id: number): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'tag',
      operation: 'delete',
      payload: { id }
    });
  }

  private queueViewUpsert(view: GameListView): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'view',
      operation: 'upsert',
      payload: view
    });
  }

  private queueViewDelete(id: number): void {
    if (!this.outboxWriter) {
      return;
    }

    void this.outboxWriter.enqueueOperation({
      entityType: 'view',
      operation: 'delete',
      payload: { id }
    });
  }

  private normalizeTagIds(tagIds: number[] | undefined): number[] {
    if (!Array.isArray(tagIds)) {
      return [];
    }

    return [
      ...new Set(tagIds.filter((id) => Number.isInteger(id) && id > 0).map((id) => Math.trunc(id)))
    ];
  }

  private normalizeTextList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      )
    ];
  }

  private normalizeGameIdList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => /^\d+$/.test(value))
      )
    ];
  }

  private normalizeCompletionHours(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeMetacriticScore(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.round(value);

    if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 100) {
      return null;
    }

    return normalized;
  }

  private normalizeMetacriticUrl(value: string | null | undefined): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }

    if (normalized.startsWith('//')) {
      return `https:${normalized}`;
    }

    return null;
  }

  private normalizeReviewSource(
    value: GameCatalogResult['reviewSource'] | undefined,
    _score: number | null | undefined,
    url: string | null | undefined
  ): GameEntry['reviewSource'] {
    if (value === 'metacritic' || value === 'mobygames') {
      return value;
    }

    const normalizedUrl = this.normalizeMetacriticUrl(url);
    if (normalizedUrl !== null) {
      const detected = detectReviewSourceFromUrl(normalizedUrl);
      if (detected !== null) {
        return detected;
      }
    }

    return null;
  }

  private normalizeMobyScore(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeMobygamesGameId(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private normalizeGameType(value: unknown): GameEntry['gameType'] {
    if (
      value === 'main_game' ||
      value === 'dlc_addon' ||
      value === 'expansion' ||
      value === 'bundle' ||
      value === 'standalone_expansion' ||
      value === 'mod' ||
      value === 'episode' ||
      value === 'season' ||
      value === 'remake' ||
      value === 'remaster' ||
      value === 'expanded_game' ||
      value === 'port' ||
      value === 'fork' ||
      value === 'pack' ||
      value === 'update'
    ) {
      return value;
    }

    return null;
  }

  private resolveGameType(
    incoming: GameCatalogResult['gameType'] | undefined,
    existing: GameEntry['gameType'] | undefined
  ): GameEntry['gameType'] {
    if (incoming === undefined) {
      return this.normalizeGameType(existing);
    }

    return this.normalizeGameType(incoming);
  }

  private resolveCompletionHours(
    incoming: number | null | undefined,
    existing: number | null | undefined
  ): number | null {
    if (incoming === undefined) {
      return this.normalizeCompletionHours(existing);
    }

    return this.normalizeCompletionHours(incoming);
  }

  private resolveMetacriticScore(
    incoming: number | null | undefined,
    existing: number | null | undefined
  ): number | null {
    if (incoming === undefined) {
      return this.normalizeMetacriticScore(existing);
    }

    return this.normalizeMetacriticScore(incoming);
  }

  private resolveMetacriticUrl(
    incoming: string | null | undefined,
    existing: string | null | undefined
  ): string | null {
    if (incoming === undefined) {
      return this.normalizeMetacriticUrl(existing);
    }

    return this.normalizeMetacriticUrl(incoming);
  }

  private resolveReviewSource(
    incoming: GameCatalogResult['reviewSource'] | undefined,
    existing: GameEntry['reviewSource'] | undefined,
    incomingScore: number | null | undefined,
    incomingUrl: string | null | undefined,
    existingScore: number | null | undefined,
    existingUrl: string | null | undefined
  ): GameEntry['reviewSource'] {
    if (incoming === undefined) {
      return this.normalizeReviewSource(existing, existingScore, existingUrl);
    }

    return this.normalizeReviewSource(incoming, incomingScore, incomingUrl);
  }

  private resolveMobyScore(
    incoming: number | null | undefined,
    existing: number | null | undefined
  ): number | null {
    if (incoming === undefined) {
      return this.normalizeMobyScore(existing);
    }

    return this.normalizeMobyScore(incoming);
  }

  private resolveMobygamesGameId(
    incoming: number | null | undefined,
    existing: number | null | undefined
  ): number | null {
    if (incoming === undefined) {
      return this.normalizeMobygamesGameId(existing);
    }

    return this.normalizeMobygamesGameId(incoming);
  }

  private resolveGameIdList(
    incoming: string[] | undefined,
    existing: string[] | undefined
  ): string[] {
    if (incoming === undefined) {
      return this.normalizeGameIdList(existing);
    }

    return this.normalizeGameIdList(incoming);
  }

  private normalizeStatus(value: GameStatus | null | undefined): GameStatus | null {
    if (
      value === 'completed' ||
      value === 'dropped' ||
      value === 'playing' ||
      value === 'paused' ||
      value === 'replay' ||
      value === 'wantToPlay'
    ) {
      return value;
    }

    return null;
  }

  private normalizeRating(value: GameRating | null | undefined): GameRating | null {
    if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
      return value;
    }

    return null;
  }

  private normalizeGameId(value: string): string {
    const normalized = value.trim();

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

  private normalizePlatformName(value: string | null | undefined): string {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      throw new Error('Platform is required.');
    }

    return normalized;
  }

  private normalizeTextValue(value: string | null | undefined): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeCustomCoverUrl(value: string | null | undefined): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ? normalized : null;
  }

  private normalizeNotes(value: string | null | undefined): string | null {
    return this.htmlSanitizer.sanitizeNotesOrNull(value);
  }

  private normalizeCustomTitle(
    value: string | null | undefined,
    defaultTitle: string
  ): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    return normalized === defaultTitle ? null : normalized;
  }

  private normalizeCustomPlatformName(
    value: string | null | undefined,
    defaultPlatformName: string,
    candidatePlatformId: number | null | undefined,
    defaultPlatformIgdbId: number
  ): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    const normalizedCandidateId = this.normalizeOptionalPlatformIgdbId(candidatePlatformId);

    if (normalized.length === 0 || normalizedCandidateId === null) {
      return null;
    }

    return normalized === defaultPlatformName && normalizedCandidateId === defaultPlatformIgdbId
      ? null
      : normalized;
  }

  private normalizeCustomPlatformIgdbId(
    value: number | null | undefined,
    candidatePlatformName: string | null | undefined,
    defaultPlatformName: string,
    defaultPlatformIgdbId: number
  ): number | null {
    const normalizedId = this.normalizeOptionalPlatformIgdbId(value);
    const normalizedName =
      typeof candidatePlatformName === 'string' ? candidatePlatformName.trim() : '';

    if (normalizedId === null || normalizedName.length === 0) {
      return null;
    }

    if (normalizedId === defaultPlatformIgdbId && normalizedName === defaultPlatformName) {
      return null;
    }

    return normalizedId;
  }

  private normalizeOptionalPlatformIgdbId(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return null;
    }

    return value;
  }

  private resolveCustomTitle(
    existingCustomTitle: string | null | undefined,
    incomingTitle: string
  ): string | null {
    return this.normalizeCustomTitle(existingCustomTitle, incomingTitle);
  }

  private resolveCustomPlatformName(
    existingCustomPlatformName: string | null | undefined,
    existingCustomPlatformIgdbId: number | null | undefined,
    incomingPlatformName: string,
    incomingPlatformIgdbId: number
  ): string | null {
    return this.normalizeCustomPlatformName(
      existingCustomPlatformName,
      incomingPlatformName,
      existingCustomPlatformIgdbId,
      incomingPlatformIgdbId
    );
  }

  private resolveCustomPlatformIgdbId(
    existingCustomPlatformIgdbId: number | null | undefined,
    existingCustomPlatformName: string | null | undefined,
    incomingPlatformName: string,
    incomingPlatformIgdbId: number
  ): number | null {
    return this.normalizeCustomPlatformIgdbId(
      existingCustomPlatformIgdbId,
      existingCustomPlatformName,
      incomingPlatformName,
      incomingPlatformIgdbId
    );
  }

  private normalizeViewName(value: string): string {
    const normalized = value.trim();

    if (normalized.length === 0) {
      throw new Error('View name is required.');
    }

    return normalized;
  }

  private normalizeGroupBy(value: GameGroupByField | null | undefined): GameGroupByField {
    if (
      value === 'none' ||
      value === 'platform' ||
      value === 'developer' ||
      value === 'franchise' ||
      value === 'tag' ||
      value === 'genre' ||
      value === 'publisher' ||
      value === 'releaseYear'
    ) {
      return value;
    }

    return 'none';
  }

  private normalizeViewFilters(value: GameListFilters | null | undefined): GameListFilters {
    const source = value ?? DEFAULT_GAME_LIST_FILTERS;
    const sortField = this.normalizeViewSortField(source.sortField);
    const sortDirection = source.sortDirection === 'desc' ? 'desc' : 'asc';
    const platform = normalizeStringList(source.platform);
    const collections = normalizeStringList(source.collections);
    const developers = normalizeStringList(source.developers);
    const franchises = normalizeStringList(source.franchises);
    const publishers = normalizeStringList(source.publishers);
    const gameTypes = normalizeGameTypeList(source.gameTypes);
    const genres = normalizeStringList(source.genres);
    const statuses = normalizeGameStatusFilterList(source.statuses);
    const tags = normalizeStringList(source.tags);
    const excludedPlatform = normalizeStringList(source.excludedPlatform);
    const excludedGenres = normalizeStringList(source.excludedGenres);
    const excludedStatuses = normalizeGameStatusFilterList(source.excludedStatuses).filter(
      (status) => status !== 'none'
    );
    const excludedTags = normalizeStringList(source.excludedTags).filter(
      (tag) => tag !== '__none__'
    );
    const excludedGameTypes = normalizeGameTypeList(source.excludedGameTypes);
    const ratings = normalizeGameRatingFilterList(source.ratings);
    const hltbMainHoursMin = normalizeNonNegativeNumber(source.hltbMainHoursMin);
    const hltbMainHoursMax = normalizeNonNegativeNumber(source.hltbMainHoursMax);
    const releaseDateFrom =
      typeof source.releaseDateFrom === 'string' && source.releaseDateFrom.length >= 10
        ? source.releaseDateFrom.slice(0, 10)
        : null;
    const releaseDateTo =
      typeof source.releaseDateTo === 'string' && source.releaseDateTo.length >= 10
        ? source.releaseDateTo.slice(0, 10)
        : null;

    return {
      sortField,
      sortDirection,
      platform,
      collections,
      developers,
      franchises,
      publishers,
      gameTypes,
      genres,
      statuses,
      tags,
      excludedPlatform,
      excludedGenres,
      excludedStatuses,
      excludedTags,
      excludedGameTypes,
      ratings,
      hltbMainHoursMin:
        hltbMainHoursMin !== null &&
        hltbMainHoursMax !== null &&
        hltbMainHoursMin > hltbMainHoursMax
          ? hltbMainHoursMax
          : hltbMainHoursMin,
      hltbMainHoursMax:
        hltbMainHoursMin !== null &&
        hltbMainHoursMax !== null &&
        hltbMainHoursMin > hltbMainHoursMax
          ? hltbMainHoursMin
          : hltbMainHoursMax,
      releaseDateFrom,
      releaseDateTo
    };
  }

  private normalizeViewSortField(
    value: GameListFilters['sortField'] | null | undefined
  ): GameListFilters['sortField'] {
    if (
      value === 'title' ||
      value === 'releaseDate' ||
      value === 'createdAt' ||
      value === 'hltb' ||
      value === 'metacritic' ||
      value === 'platform'
    ) {
      return value;
    }

    return DEFAULT_GAME_LIST_FILTERS.sortField;
  }
}
