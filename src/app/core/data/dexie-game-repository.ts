import { Injectable, inject } from '@angular/core';
import { AppDb } from './app-db';
import { GameRepository } from './game-repository';
import { CoverSource, GameCatalogResult, GameEntry, GameRating, GameStatus, ListType, Tag } from '../models/game.models';

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
}
