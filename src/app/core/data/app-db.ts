import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import { GameEntry, GameListView, Tag } from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class AppDb extends Dexie {
  games!: Table<GameEntry, number>;
  tags!: Table<Tag, number>;
  views!: Table<GameListView, number>;
  imageCache!: Table<ImageCacheEntry, number>;

  constructor() {
    super('game-shelf-db');

    this.version(1).stores({
      games: '++id,&externalId,listType,title,createdAt,updatedAt',
    });

    this.version(2).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
    });

    this.version(3).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
    });

    this.version(4).stores({
      games: '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
    }).upgrade(tx => {
      return tx.table('games').toCollection().modify((game: Record<string, unknown>) => {
        const rawExternalId = String(game['externalId'] ?? '').trim();
        const separatorIndex = rawExternalId.indexOf('::');
        const parsedGameId = separatorIndex > 0 ? rawExternalId.slice(0, separatorIndex) : rawExternalId;
        const parsedPlatformFromExternal = separatorIndex > 0
          ? Number.parseInt(rawExternalId.slice(separatorIndex + 2), 10)
          : Number.NaN;
        const existingPlatformIgdbId = Number.parseInt(String(game['platformIgdbId'] ?? ''), 10);
        const normalizedPlatformIgdbId = Number.isInteger(existingPlatformIgdbId) && existingPlatformIgdbId > 0
          ? existingPlatformIgdbId
          : (Number.isInteger(parsedPlatformFromExternal) && parsedPlatformFromExternal > 0 ? parsedPlatformFromExternal : 0);

        game['igdbGameId'] = parsedGameId;
        game['platformIgdbId'] = normalizedPlatformIgdbId;
        game['platform'] = String(game['platform'] ?? '').trim() || 'Unknown platform';
        delete game['externalId'];
      });
    });

    this.version(5).stores({
      games: '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt',
    });

    this.version(6).stores({
      games: '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt',
      imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes',
    });
  }
}

export interface ImageCacheEntry {
  id?: number;
  cacheKey: string;
  gameKey: string;
  variant: 'thumb' | 'detail';
  sourceUrl: string;
  blob: Blob;
  sizeBytes: number;
  updatedAt: string;
  lastAccessedAt: string;
}
