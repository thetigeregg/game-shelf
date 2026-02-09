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

@Injectable({ providedIn: 'root' })
export class DexieGameRepository implements GameRepository {
  private readonly db = inject(AppDb);

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

    if (existing?.id !== undefined) {
      const updated: GameEntry = {
        ...existing,
        igdbGameId: normalizedGameId,
        title: result.title,
        coverUrl: result.coverUrl,
        coverSource: result.coverSource,
        developers: this.normalizeTextList(result.developers),
        franchises: this.normalizeTextList(result.franchises),
        genres: this.normalizeTextList(result.genres),
        publishers: this.normalizeTextList(result.publishers),
        platform: normalizedPlatformName,
        platformIgdbId: normalizedPlatformIgdbId,
        tagIds: this.normalizeTagIds(existing.tagIds),
        releaseDate: result.releaseDate,
        releaseYear: result.releaseYear,
        status: this.normalizeStatus(existing.status),
        rating: this.normalizeRating(existing.rating),
        listType: targetList,
        updatedAt: now,
      };

      await this.db.games.put(updated);
      return updated;
    }

    const created: GameEntry = {
      igdbGameId: normalizedGameId,
      title: result.title,
      coverUrl: result.coverUrl,
      coverSource: result.coverSource,
      developers: this.normalizeTextList(result.developers),
      franchises: this.normalizeTextList(result.franchises),
      genres: this.normalizeTextList(result.genres),
      publishers: this.normalizeTextList(result.publishers),
      platform: normalizedPlatformName,
      platformIgdbId: normalizedPlatformIgdbId,
      tagIds: [],
      releaseDate: result.releaseDate,
      releaseYear: result.releaseYear,
      status: null,
      rating: null,
      listType: targetList,
      createdAt: now,
      updatedAt: now,
    };

    const id = await this.db.games.add(created);
    return { ...created, id };
  }

  async moveToList(igdbGameId: string, platformIgdbId: number, targetList: ListType): Promise<void> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return;
    }

    await this.db.games.update(existing.id, {
      listType: targetList,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(igdbGameId: string, platformIgdbId: number): Promise<void> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return;
    }

    await this.db.games.delete(existing.id);
  }

  async exists(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined> {
    return this.db.games.where('[igdbGameId+platformIgdbId]').equals([igdbGameId, platformIgdbId]).first();
  }

  async updateCover(igdbGameId: string, platformIgdbId: number, coverUrl: string | null, coverSource: CoverSource): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      coverUrl,
      coverSource,
      updatedAt: new Date().toISOString(),
    };

    await this.db.games.put(updated);
    return updated;
  }

  async setGameStatus(igdbGameId: string, platformIgdbId: number, status: GameStatus | null): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      status: this.normalizeStatus(status),
      updatedAt: new Date().toISOString(),
    };

    await this.db.games.put(updated);
    return updated;
  }

  async setGameRating(igdbGameId: string, platformIgdbId: number, rating: GameRating | null): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      rating: this.normalizeRating(rating),
      updatedAt: new Date().toISOString(),
    };

    await this.db.games.put(updated);
    return updated;
  }

  async setGameTags(igdbGameId: string, platformIgdbId: number, tagIds: number[]): Promise<GameEntry | undefined> {
    const existing = await this.exists(igdbGameId, platformIgdbId);

    if (existing?.id === undefined) {
      return undefined;
    }

    const updated: GameEntry = {
      ...existing,
      tagIds: this.normalizeTagIds(tagIds),
      updatedAt: new Date().toISOString(),
    };

    await this.db.games.put(updated);
    return updated;
  }

  async listTags(): Promise<Tag[]> {
    return this.db.tags.orderBy('name').toArray();
  }

  async upsertTag(tag: { id?: number; name: string; color: string }): Promise<Tag> {
    const normalizedName = tag.name.trim();
    const now = new Date().toISOString();
    const existingByName = await this.db.tags.where('name').equalsIgnoreCase(normalizedName).first();

    if (existingByName?.id !== undefined && existingByName.id !== tag.id) {
      const updatedByName: Tag = {
        ...existingByName,
        color: tag.color,
        updatedAt: now,
      };

      await this.db.tags.put(updatedByName);
      return updatedByName;
    }

    if (tag.id !== undefined) {
      const existingById = await this.db.tags.get(tag.id);

      if (existingById) {
        const updatedById: Tag = {
          ...existingById,
          name: normalizedName,
          color: tag.color,
          updatedAt: now,
        };

        await this.db.tags.put(updatedById);
        return updatedById;
      }
    }

    const created: Tag = {
      name: normalizedName,
      color: tag.color,
      createdAt: now,
      updatedAt: now,
    };
    const createdId = await this.db.tags.add(created);
    return { ...created, id: createdId };
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.db.transaction('rw', this.db.tags, this.db.games, async () => {
      await this.db.tags.delete(tagId);

      const games = await this.db.games.toArray();

      await Promise.all(games.map(async game => {
        const currentTagIds = this.normalizeTagIds(game.tagIds);
        const nextTagIds = currentTagIds.filter(id => id !== tagId);

        if (nextTagIds.length === currentTagIds.length || game.id === undefined) {
          return;
        }

        await this.db.games.update(game.id, {
          tagIds: nextTagIds,
          updatedAt: new Date().toISOString(),
        });
      }));
    });
  }

  async listViews(listType: ListType): Promise<GameListView[]> {
    return this.db.views
      .where('listType')
      .equals(listType)
      .sortBy('name');
  }

  async getView(viewId: number): Promise<GameListView | undefined> {
    return this.db.views.get(viewId);
  }

  async createView(view: { name: string; listType: ListType; filters: GameListFilters; groupBy: GameGroupByField }): Promise<GameListView> {
    const now = new Date().toISOString();
    const created: GameListView = {
      name: this.normalizeViewName(view.name),
      listType: view.listType,
      filters: this.normalizeViewFilters(view.filters),
      groupBy: this.normalizeGroupBy(view.groupBy),
      createdAt: now,
      updatedAt: now,
    };
    const id = await this.db.views.add(created);
    return { ...created, id };
  }

  async updateView(viewId: number, updates: { name?: string; filters?: GameListFilters; groupBy?: GameGroupByField }): Promise<GameListView | undefined> {
    const existing = await this.db.views.get(viewId);

    if (!existing) {
      return undefined;
    }

    const updated: GameListView = {
      ...existing,
      name: updates.name !== undefined ? this.normalizeViewName(updates.name) : existing.name,
      filters: updates.filters !== undefined ? this.normalizeViewFilters(updates.filters) : this.normalizeViewFilters(existing.filters),
      groupBy: updates.groupBy !== undefined ? this.normalizeGroupBy(updates.groupBy) : this.normalizeGroupBy(existing.groupBy),
      updatedAt: new Date().toISOString(),
    };

    await this.db.views.put(updated);
    return updated;
  }

  async deleteView(viewId: number): Promise<void> {
    await this.db.views.delete(viewId);
  }

  private normalizeTagIds(tagIds: number[] | undefined): number[] {
    if (!Array.isArray(tagIds)) {
      return [];
    }

    return [...new Set(
      tagIds
        .filter(id => Number.isInteger(id) && id > 0)
        .map(id => Math.trunc(id))
    )];
  }

  private normalizeTextList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [...new Set(
      values
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(value => value.length > 0)
    )];
  }

  private normalizeStatus(value: GameStatus | null | undefined): GameStatus | null {
    if (value === 'completed' || value === 'dropped' || value === 'playing' || value === 'paused' || value === 'replay' || value === 'wantToPlay') {
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

  private normalizePlatformName(value: string | null | undefined): string {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      throw new Error('Platform is required.');
    }

    return normalized;
  }

  private normalizeViewName(value: string): string {
    const normalized = String(value ?? '').trim();

    if (normalized.length === 0) {
      throw new Error('View name is required.');
    }

    return normalized;
  }

  private normalizeGroupBy(value: GameGroupByField | null | undefined): GameGroupByField {
    if (
      value === 'none'
      || value === 'platform'
      || value === 'developer'
      || value === 'franchise'
      || value === 'tag'
      || value === 'genre'
      || value === 'publisher'
      || value === 'releaseYear'
    ) {
      return value;
    }

    return 'none';
  }

  private normalizeViewFilters(value: GameListFilters | null | undefined): GameListFilters {
    const source = value ?? DEFAULT_GAME_LIST_FILTERS;
    const sortField = source.sortField === 'title' || source.sortField === 'releaseDate' || source.sortField === 'createdAt' || source.sortField === 'platform'
      ? source.sortField
      : 'title';
    const sortDirection = source.sortDirection === 'desc' ? 'desc' : 'asc';
    const platform = Array.isArray(source.platform)
      ? [...new Set(source.platform.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
      : [];
    const genres = Array.isArray(source.genres)
      ? [...new Set(source.genres.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
      : [];
    const statuses = Array.isArray(source.statuses)
      ? [...new Set(source.statuses.filter(status =>
        status === 'none'
        || status === 'playing'
        || status === 'wantToPlay'
        || status === 'completed'
        || status === 'paused'
        || status === 'dropped'
        || status === 'replay'
      ))]
      : [];
    const tags = Array.isArray(source.tags)
      ? [...new Set(source.tags.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
      : [];
    const releaseDateFrom = typeof source.releaseDateFrom === 'string' && source.releaseDateFrom.length >= 10
      ? source.releaseDateFrom.slice(0, 10)
      : null;
    const releaseDateTo = typeof source.releaseDateTo === 'string' && source.releaseDateTo.length >= 10
      ? source.releaseDateTo.slice(0, 10)
      : null;

    return {
      sortField,
      sortDirection,
      platform,
      genres,
      statuses,
      tags,
      releaseDateFrom,
      releaseDateTo,
    };
  }
}
