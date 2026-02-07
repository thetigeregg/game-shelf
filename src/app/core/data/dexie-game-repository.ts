import { Injectable, inject } from '@angular/core';
import { AppDb } from './app-db';
import { GameRepository } from './game-repository';
import { GameCatalogResult, GameEntry, ListType } from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class DexieGameRepository implements GameRepository {
  private readonly db = inject(AppDb);

  async listByType(listType: ListType): Promise<GameEntry[]> {
    return this.db.games.where('listType').equals(listType).sortBy('title');
  }

  async upsertFromCatalog(result: GameCatalogResult, targetList: ListType): Promise<GameEntry> {
    const now = new Date().toISOString();
    const existing = await this.exists(result.externalId);

    if (existing?.id !== undefined) {
      const updated: GameEntry = {
        ...existing,
        externalId: result.externalId,
        title: result.title,
        coverUrl: result.coverUrl,
        platform: result.platform,
        releaseYear: result.releaseYear,
        listType: targetList,
        updatedAt: now,
      };

      await this.db.games.put(updated);
      return updated;
    }

    const created: GameEntry = {
      externalId: result.externalId,
      title: result.title,
      coverUrl: result.coverUrl,
      platform: result.platform,
      releaseYear: result.releaseYear,
      listType: targetList,
      createdAt: now,
      updatedAt: now,
    };

    const id = await this.db.games.add(created);
    return { ...created, id };
  }

  async moveToList(externalId: string, targetList: ListType): Promise<void> {
    const existing = await this.exists(externalId);

    if (existing?.id === undefined) {
      return;
    }

    await this.db.games.update(existing.id, {
      listType: targetList,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(externalId: string): Promise<void> {
    await this.db.games.where('externalId').equals(externalId).delete();
  }

  async exists(externalId: string): Promise<GameEntry | undefined> {
    return this.db.games.where('externalId').equals(externalId).first();
  }
}
