import Dexie, { Table } from 'dexie';
import { Injectable } from '@angular/core';
import {
  ClientSyncOperation,
  GameEntry,
  GameListView,
  SyncEntityType,
  SyncOperationType,
  Tag
} from '../models/game.models';

@Injectable({ providedIn: 'root' })
export class AppDb extends Dexie {
  games!: Table<GameEntry, number>;
  tags!: Table<Tag, number>;
  views!: Table<GameListView, number>;
  imageCache!: Table<ImageCacheEntry, number>;
  outbox!: Table<OutboxEntry, string>;
  syncMeta!: Table<SyncMetaEntry, string>;

  constructor() {
    super('game-shelf-db');

    this.version(1).stores({
      games: '++id,&externalId,listType,title,createdAt,updatedAt'
    });

    this.version(2).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt'
    });

    this.version(3).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt'
    });

    this.version(4)
      .stores({
        games:
          '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
        tags: '++id,&name,createdAt,updatedAt'
      })
      .upgrade((tx) => {
        return tx
          .table('games')
          .toCollection()
          .modify((game: Record<string, unknown>) => {
            const externalIdRaw = game['externalId'];
            const rawExternalId =
              typeof externalIdRaw === 'string' || typeof externalIdRaw === 'number'
                ? String(externalIdRaw).trim()
                : '';
            const separatorIndex = rawExternalId.indexOf('::');
            const parsedGameId =
              separatorIndex > 0 ? rawExternalId.slice(0, separatorIndex) : rawExternalId;
            const parsedPlatformFromExternal =
              separatorIndex > 0
                ? Number.parseInt(rawExternalId.slice(separatorIndex + 2), 10)
                : Number.NaN;
            const platformIgdbIdRaw = game['platformIgdbId'];
            const existingPlatformIgdbId = Number.parseInt(
              typeof platformIgdbIdRaw === 'string' || typeof platformIgdbIdRaw === 'number'
                ? String(platformIgdbIdRaw)
                : '',
              10
            );
            const normalizedPlatformIgdbId =
              Number.isInteger(existingPlatformIgdbId) && existingPlatformIgdbId > 0
                ? existingPlatformIgdbId
                : Number.isInteger(parsedPlatformFromExternal) && parsedPlatformFromExternal > 0
                  ? parsedPlatformFromExternal
                  : 0;

            game['igdbGameId'] = parsedGameId;
            game['platformIgdbId'] = normalizedPlatformIgdbId;
            const platformRaw = game['platform'];
            const normalizedPlatform =
              typeof platformRaw === 'string' || typeof platformRaw === 'number'
                ? String(platformRaw).trim()
                : '';
            game['platform'] = normalizedPlatform || 'Unknown platform';
            delete game['externalId'];
          });
      });

    this.version(5).stores({
      games:
        '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt'
    });

    this.version(6).stores({
      games:
        '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt',
      imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes'
    });

    this.version(7).stores({
      games:
        '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt',
      imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes',
      outbox: '&opId,entityType,operation,createdAt,clientTimestamp,attemptCount',
      syncMeta: '&key,updatedAt'
    });

    this.version(8)
      .stores({
        games:
          '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
        tags: '++id,&name,createdAt,updatedAt',
        views: '++id,listType,name,updatedAt,createdAt',
        imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes',
        outbox: '&opId,entityType,operation,createdAt,clientTimestamp,attemptCount',
        syncMeta: '&key,updatedAt'
      })
      .upgrade((tx) => {
        return tx
          .table('games')
          .toCollection()
          .modify((game: Record<string, unknown>) => {
            const reviewScoreRaw = game['reviewScore'];
            const reviewUrlRaw = game['reviewUrl'];
            const reviewSourceRaw = game['reviewSource'];
            const metacriticScoreRaw = game['metacriticScore'];
            const metacriticUrlRaw = game['metacriticUrl'];

            if (reviewScoreRaw === undefined) {
              game['reviewScore'] = metacriticScoreRaw ?? null;
            }
            if (reviewUrlRaw === undefined) {
              game['reviewUrl'] = metacriticUrlRaw ?? null;
            }
            if (
              reviewSourceRaw === undefined ||
              reviewSourceRaw === null ||
              reviewSourceRaw === ''
            ) {
              game['reviewSource'] = game['reviewUrl'] ? 'metacritic' : null;
            }

            if (metacriticScoreRaw === undefined) {
              game['metacriticScore'] = game['reviewScore'] ?? null;
            }
            if (metacriticUrlRaw === undefined) {
              game['metacriticUrl'] = game['reviewUrl'] ?? null;
            }
          });
      });

    this.version(9)
      .stores({
        games:
          '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
        tags: '++id,&name,createdAt,updatedAt',
        views: '++id,listType,name,updatedAt,createdAt',
        imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes',
        outbox: '&opId,entityType,operation,createdAt,clientTimestamp,attemptCount',
        syncMeta: '&key,updatedAt'
      })
      .upgrade((tx) => {
        const mobyUrlPattern = /mobygames\.com\/game\/(\d+)\b/i;
        return tx
          .table('games')
          .toCollection()
          .modify((game: Record<string, unknown>) => {
            const mobyIdRaw = game['mobygamesGameId'];
            if (typeof mobyIdRaw === 'number' && Number.isInteger(mobyIdRaw) && mobyIdRaw > 0) {
              return;
            }

            const reviewSource =
              typeof game['reviewSource'] === 'string' ? game['reviewSource'] : '';
            const reviewUrl =
              typeof game['reviewUrl'] === 'string'
                ? game['reviewUrl']
                : typeof game['metacriticUrl'] === 'string'
                  ? game['metacriticUrl']
                  : '';

            if (reviewSource !== 'mobygames' || reviewUrl.length === 0) {
              game['mobygamesGameId'] = null;
              return;
            }

            const match = mobyUrlPattern.exec(reviewUrl);
            const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN;
            game['mobygamesGameId'] = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
          });
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

export interface OutboxEntry extends ClientSyncOperation {
  opId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  clientTimestamp: string;
  createdAt: string;
  attemptCount: number;
  lastError: string | null;
}

export interface SyncMetaEntry {
  key: string;
  value: string;
  updatedAt: string;
}
