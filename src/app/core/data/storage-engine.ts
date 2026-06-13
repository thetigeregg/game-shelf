import { InjectionToken } from '@angular/core';
import type { GameEntry, GameListView, ListType, SyncEntityType, Tag } from '../models/game.models';
import type { OutboxEntry, SyncMetaEntry } from './app-db';

/**
 * Logical stores that can participate in a storage transaction.
 */
export type StorageScope = 'games' | 'tags' | 'views' | 'outbox' | 'syncMeta' | 'imageCache';

/**
 * Image cache row shared by both engines. The web engine persists the image
 * bytes inline (`blob`), while the native engine stores the bytes on the
 * filesystem and keeps only the relative `filePath` here.
 */
export interface ImageCacheRecord {
  id?: number;
  cacheKey: string;
  gameKey: string;
  variant: 'thumb' | 'detail';
  sourceUrl: string;
  sizeBytes: number;
  updatedAt: string;
  lastAccessedAt: string;
  blob?: Blob;
  filePath?: string | null;
}

/**
 * Returns true when an error represents a storage-level constraint violation
 * (e.g. unique index conflict). Both engines normalize to these error names:
 * IndexedDB raises DOMException ConstraintError/DataError natively and the
 * SQLite engine maps SQLITE_CONSTRAINT failures to the same name.
 */
export function isStorageConstraintError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'ConstraintError' || error.name === 'DataError');
}

/**
 * Platform-agnostic local persistence interface for all structured app data.
 *
 * Implementations: DexieStorageEngine (web, IndexedDB) and SqliteStorageEngine
 * (native iOS, @capacitor-community/sqlite). Business logic (repository, sync,
 * image cache) must only talk to this interface.
 *
 * Semantics shared by both engines:
 * - `add*` inserts a new row and fails on key conflicts; auto-increment ids
 *   are assigned when the entity has no id.
 * - `put*` inserts or replaces by primary key; violating a secondary unique
 *   index raises a constraint error (see isStorageConstraintError).
 * - `runInTransaction` runs the action atomically over the given scopes.
 *   Nested calls join the outer transaction. Only storage operations may be
 *   awaited inside the action.
 */
export interface StorageEngine {
  /** Opens the underlying database. Must be called before any other method. */
  initialize(): Promise<void>;

  runInTransaction<T>(scope: readonly StorageScope[], action: () => Promise<T>): Promise<T>;

  // Games
  getGameById(id: number): Promise<GameEntry | undefined>;
  getGameByIdentity(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined>;
  listGamesByTypeSortedByTitle(listType: ListType): Promise<GameEntry[]>;
  listAllGames(): Promise<GameEntry[]>;
  addGame(game: GameEntry): Promise<number>;
  putGame(game: GameEntry): Promise<number>;
  updateGame(id: number, changes: Partial<GameEntry>): Promise<void>;
  deleteGame(id: number): Promise<void>;
  bulkPutGames(games: GameEntry[]): Promise<void>;
  clearGames(): Promise<void>;

  // Tags
  getTag(id: number): Promise<Tag | undefined>;
  getTagByNameIgnoreCase(name: string): Promise<Tag | undefined>;
  listTagsSortedByName(): Promise<Tag[]>;
  addTag(tag: Tag): Promise<number>;
  putTag(tag: Tag): Promise<number>;
  deleteTag(id: number): Promise<void>;
  bulkPutTags(tags: Tag[]): Promise<void>;
  clearTags(): Promise<void>;

  // Views
  getView(id: number): Promise<GameListView | undefined>;
  listViewsByTypeSortedByName(listType: ListType): Promise<GameListView[]>;
  listAllViews(): Promise<GameListView[]>;
  addView(view: GameListView): Promise<number>;
  putView(view: GameListView): Promise<number>;
  deleteView(id: number): Promise<void>;
  bulkPutViews(views: GameListView[]): Promise<void>;
  clearViews(): Promise<void>;

  // Sync outbox
  getOutboxEntry(opId: string): Promise<OutboxEntry | undefined>;
  countOutbox(): Promise<number>;
  listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]>;
  listOutboxByEntityType(entityType: SyncEntityType): Promise<OutboxEntry[]>;
  putOutboxEntry(entry: OutboxEntry): Promise<void>;
  bulkPutOutbox(entries: OutboxEntry[]): Promise<void>;
  bulkDeleteOutbox(opIds: string[]): Promise<void>;
  clearOutbox(): Promise<void>;

  // Sync metadata
  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined>;
  listAllSyncMeta(): Promise<SyncMetaEntry[]>;
  putSyncMeta(entry: SyncMetaEntry): Promise<void>;
  deleteSyncMeta(key: string): Promise<void>;
  clearSyncMeta(): Promise<void>;

  // Image cache
  getImageCacheByCacheKey(cacheKey: string): Promise<ImageCacheRecord | undefined>;
  listImageCacheByGameKey(gameKey: string): Promise<ImageCacheRecord[]>;
  listImageCacheOrderedByLastAccessedAt(): Promise<ImageCacheRecord[]>;
  putImageCache(record: ImageCacheRecord): Promise<number>;
  updateImageCacheLastAccessedAt(id: number, lastAccessedAt: string): Promise<void>;
  deleteImageCache(id: number): Promise<void>;
  deleteImageCacheByGameKey(gameKey: string): Promise<void>;
  clearImageCache(): Promise<void>;
}

export const STORAGE_ENGINE = new InjectionToken<StorageEngine>('STORAGE_ENGINE');
