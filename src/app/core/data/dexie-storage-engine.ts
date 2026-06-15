import { Injectable, inject } from '@angular/core';
import Dexie, { Table, Transaction } from 'dexie';
import { AppDb, ImageCacheEntry, OutboxEntry, SyncMetaEntry } from './app-db';
import { GameEntry, GameListView, ListType, SyncEntityType, Tag } from '../models/game.models';
import { ImageCacheRecord, StorageEngine, StorageScope } from './storage-engine';
import {
  isInsideStorageTransaction,
  runInsideStorageTransactionZone,
} from './storage-transaction-context';

interface ActiveTransaction {
  transaction: Transaction;
  scope: ReadonlySet<StorageScope>;
}

const SCOPE_TABLE_NAMES: Record<StorageScope, string> = {
  games: 'games',
  tags: 'tags',
  views: 'views',
  outbox: 'outbox',
  syncMeta: 'syncMeta',
  imageCache: 'imageCache',
};

/**
 * IndexedDB-backed storage engine used on the web, delegating to the existing
 * Dexie schema in AppDb.
 *
 * While a runInTransaction action is executing, operations on tables in the
 * transaction scope are routed through transaction-bound table handles rather
 * than relying solely on Dexie's PSD zone propagation. Zone echo across
 * multiple native awaits is unreliable in some environments (e.g. jsdom +
 * fake-indexeddb), causing PrematureCommitError; explicit routing keeps the
 * transaction alive and correctly scoped regardless.
 */
@Injectable({ providedIn: 'root' })
export class DexieStorageEngine implements StorageEngine {
  private readonly db = inject(AppDb);
  private activeTransaction: ActiveTransaction | null = null;
  private transactionQueue: Promise<unknown> = Promise.resolve();

  initialize(): Promise<void> {
    // Dexie opens lazily on first use; nothing to do here.
    return Promise.resolve();
  }

  runInTransaction<T>(scope: readonly StorageScope[], action: () => Promise<T>): Promise<T> {
    if (this.isNestedTransactionCall()) {
      return action();
    }

    const run = (): Promise<T> =>
      this.db.transaction('rw', this.tablesForScope(scope), (transaction) => {
        const previous = this.activeTransaction;
        this.activeTransaction = { transaction, scope: new Set(scope) };
        return runInsideStorageTransactionZone(() => action()).finally(() => {
          this.activeTransaction = previous;
        });
      });

    const queued = this.transactionQueue.then(run, run);
    this.transactionQueue = queued.catch(() => undefined);
    return queued;
  }

  getGameById(id: number): Promise<GameEntry | undefined> {
    return this.gamesTable.get(id);
  }

  getGameByIdentity(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined> {
    return this.gamesTable
      .where('[igdbGameId+platformIgdbId]')
      .equals([igdbGameId, platformIgdbId])
      .first();
  }

  listGamesByTypeSortedByTitle(listType: ListType): Promise<GameEntry[]> {
    return this.gamesTable.where('listType').equals(listType).sortBy('title');
  }

  listAllGames(): Promise<GameEntry[]> {
    return this.gamesTable.toArray();
  }

  countGames(): Promise<number> {
    return this.gamesTable.count();
  }

  addGame(game: GameEntry): Promise<number> {
    return this.gamesTable.add(game);
  }

  putGame(game: GameEntry): Promise<number> {
    return this.gamesTable.put(game);
  }

  updateGame(id: number, changes: Partial<GameEntry>): Promise<void> {
    return this.gamesTable.update(id, changes).then(() => undefined);
  }

  deleteGame(id: number): Promise<void> {
    return this.gamesTable.delete(id);
  }

  bulkPutGames(games: GameEntry[]): Promise<void> {
    return this.gamesTable.bulkPut(games).then(() => undefined);
  }

  clearGames(): Promise<void> {
    return this.gamesTable.clear();
  }

  getTag(id: number): Promise<Tag | undefined> {
    return this.tagsTable.get(id);
  }

  getTagByNameIgnoreCase(name: string): Promise<Tag | undefined> {
    return this.tagsTable.where('name').equalsIgnoreCase(name).first();
  }

  listTagsSortedByName(): Promise<Tag[]> {
    return this.tagsTable.orderBy('name').toArray();
  }

  addTag(tag: Tag): Promise<number> {
    return this.tagsTable.add(tag);
  }

  putTag(tag: Tag): Promise<number> {
    return this.tagsTable.put(tag);
  }

  deleteTag(id: number): Promise<void> {
    return this.tagsTable.delete(id);
  }

  bulkPutTags(tags: Tag[]): Promise<void> {
    return this.tagsTable.bulkPut(tags).then(() => undefined);
  }

  clearTags(): Promise<void> {
    return this.tagsTable.clear();
  }

  getView(id: number): Promise<GameListView | undefined> {
    return this.viewsTable.get(id);
  }

  listViewsByTypeSortedByName(listType: ListType): Promise<GameListView[]> {
    return this.viewsTable.where('listType').equals(listType).sortBy('name');
  }

  listAllViews(): Promise<GameListView[]> {
    return this.viewsTable.toArray();
  }

  addView(view: GameListView): Promise<number> {
    return this.viewsTable.add(view);
  }

  putView(view: GameListView): Promise<number> {
    return this.viewsTable.put(view);
  }

  deleteView(id: number): Promise<void> {
    return this.viewsTable.delete(id);
  }

  bulkPutViews(views: GameListView[]): Promise<void> {
    return this.viewsTable.bulkPut(views).then(() => undefined);
  }

  clearViews(): Promise<void> {
    return this.viewsTable.clear();
  }

  getOutboxEntry(opId: string): Promise<OutboxEntry | undefined> {
    return this.outboxTable.get(opId);
  }

  countOutbox(): Promise<number> {
    return this.outboxTable.count();
  }

  listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]> {
    return this.outboxTable.orderBy('createdAt').toArray();
  }

  listOutboxByEntityType(entityType: SyncEntityType): Promise<OutboxEntry[]> {
    return this.outboxTable.where('entityType').equals(entityType).toArray();
  }

  putOutboxEntry(entry: OutboxEntry): Promise<void> {
    return this.outboxTable.put(entry).then(() => undefined);
  }

  bulkPutOutbox(entries: OutboxEntry[]): Promise<void> {
    return this.outboxTable.bulkPut(entries).then(() => undefined);
  }

  bulkDeleteOutbox(opIds: string[]): Promise<void> {
    return this.outboxTable.bulkDelete(opIds);
  }

  clearOutbox(): Promise<void> {
    return this.outboxTable.clear();
  }

  getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    return this.syncMetaTable.get(key);
  }

  listAllSyncMeta(): Promise<SyncMetaEntry[]> {
    return this.syncMetaTable.toArray();
  }

  putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    return this.syncMetaTable.put(entry).then(() => undefined);
  }

  deleteSyncMeta(key: string): Promise<void> {
    return this.syncMetaTable.delete(key);
  }

  clearSyncMeta(): Promise<void> {
    return this.syncMetaTable.clear();
  }

  getImageCacheByCacheKey(cacheKey: string): Promise<ImageCacheRecord | undefined> {
    return this.imageCacheTable.where('cacheKey').equals(cacheKey).first();
  }

  listImageCacheByGameKey(gameKey: string): Promise<ImageCacheRecord[]> {
    return this.imageCacheTable.where('gameKey').equals(gameKey).toArray();
  }

  listImageCacheOrderedByLastAccessedAt(): Promise<ImageCacheRecord[]> {
    return this.imageCacheTable.orderBy('lastAccessedAt').toArray();
  }

  putImageCache(record: ImageCacheRecord): Promise<number> {
    return this.imageCacheTable.put(record as ImageCacheEntry);
  }

  updateImageCacheLastAccessedAt(id: number, lastAccessedAt: string): Promise<void> {
    return this.imageCacheTable.update(id, { lastAccessedAt }).then(() => undefined);
  }

  deleteImageCache(id: number): Promise<void> {
    return this.imageCacheTable.delete(id);
  }

  deleteImageCacheByGameKey(gameKey: string): Promise<void> {
    return this.imageCacheTable
      .where('gameKey')
      .equals(gameKey)
      .delete()
      .then(() => undefined);
  }

  clearImageCache(): Promise<void> {
    return this.imageCacheTable.clear();
  }

  private get gamesTable(): Table<GameEntry, number> {
    return this.resolveTable('games', this.db.games);
  }

  private get tagsTable(): Table<Tag, number> {
    return this.resolveTable('tags', this.db.tags);
  }

  private get viewsTable(): Table<GameListView, number> {
    return this.resolveTable('views', this.db.views);
  }

  private get outboxTable(): Table<OutboxEntry, string> {
    return this.resolveTable('outbox', this.db.outbox);
  }

  private get syncMetaTable(): Table<SyncMetaEntry, string> {
    return this.resolveTable('syncMeta', this.db.syncMeta);
  }

  private get imageCacheTable(): Table<ImageCacheEntry, number> {
    return this.resolveTable('imageCache', this.db.imageCache);
  }

  private resolveTable<T, K>(scopeName: StorageScope, fallback: Table<T, K>): Table<T, K> {
    const active = this.activeTransaction;

    if (active && active.scope.has(scopeName)) {
      return active.transaction.table<T, K>(SCOPE_TABLE_NAMES[scopeName]);
    }

    return fallback;
  }

  private tablesForScope(scope: readonly StorageScope[]): Table<unknown, unknown>[] {
    return scope.map((store) => this.db.table(SCOPE_TABLE_NAMES[store]));
  }

  private isNestedTransactionCall(): boolean {
    const active = this.activeTransaction;
    if (!active || !isInsideStorageTransaction()) {
      return false;
    }

    const currentTransaction = Dexie.currentTransaction as Transaction | undefined;
    return !currentTransaction || currentTransaction === active.transaction;
  }
}
