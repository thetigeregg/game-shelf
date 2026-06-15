import { GameEntry, GameListView, ListType, SyncEntityType, Tag } from '../models/game.models';
import { OutboxEntry, SyncMetaEntry } from './app-db';
import { SqliteConnection, SqliteStatement } from './sqlite-connection';
import { ImageCacheRecord, StorageEngine, StorageScope } from './storage-engine';
import {
  isInsideStorageTransaction,
  runInsideStorageTransactionZone,
} from './storage-transaction-context';

const BULK_BATCH_SIZE = 500;

interface PayloadRow {
  id?: number;
  payload: string;
}

function toConstraintError(error: unknown): Error {
  if (error instanceof Error && /constraint/i.test(error.message)) {
    const mapped = new Error(error.message);
    mapped.name = 'ConstraintError';
    return mapped;
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Native SQLite storage engine backed by @capacitor-community/sqlite (iOS).
 *
 * Each store keeps the columns needed for lookups/sorting/uniqueness and the
 * full entity as a JSON payload column, mirroring the Dexie document shape so
 * business logic sees identical entities on both platforms. Bulk operations
 * are batched (executeSet) to stay efficient for 3,000+ game libraries.
 *
 * Constraint failures (unique indexes, primary keys) are normalized to errors
 * with name 'ConstraintError' so isStorageConstraintError works consistently
 * across engines. Schema changes bump SQLITE_SCHEMA_VERSION with an upgrade
 * statement in sqlite-connection.ts (the native counterpart to Dexie's
 * version(n) chain).
 */
export class SqliteStorageEngine implements StorageEngine {
  private transactionQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly connection: SqliteConnection) {}

  initialize(): Promise<void> {
    // The connection factory opens and migrates the database before the
    // engine is constructed.
    return Promise.resolve();
  }

  /**
   * Independent transactions are serialized on the single connection so each
   * runInTransaction gets its own begin/commit/rollback boundary. Nested calls
   * join the active transaction instead of starting a new one.
   */
  runInTransaction<T>(_scope: readonly StorageScope[], action: () => Promise<T>): Promise<T> {
    if (isInsideStorageTransaction()) {
      return action();
    }

    const run = async (): Promise<T> =>
      runInsideStorageTransactionZone(async () => {
        await this.connection.beginTransaction();

        try {
          const result = await action();
          await this.connection.commitTransaction();
          return result;
        } catch (error: unknown) {
          try {
            await this.connection.rollbackTransaction();
          } catch {
            // Surface the original failure even if rollback also fails.
          }
          throw error;
        }
      });

    const queued = this.transactionQueue.then(run, run);
    this.transactionQueue = queued.catch(() => undefined);
    return queued;
  }

  async getGameById(id: number): Promise<GameEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM games WHERE id = ?',
      [id]
    );
    return this.firstEntity(rows) as GameEntry | undefined;
  }

  async getGameByIdentity(
    igdbGameId: string,
    platformIgdbId: number
  ): Promise<GameEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM games WHERE igdb_game_id = ? AND platform_igdb_id = ?',
      [igdbGameId, platformIgdbId]
    );
    return this.firstEntity(rows) as GameEntry | undefined;
  }

  async listGamesByTypeSortedByTitle(listType: ListType): Promise<GameEntry[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM games WHERE list_type = ? ORDER BY title',
      [listType]
    );
    return rows.map((row) => this.parseEntity(row) as GameEntry);
  }

  async listAllGames(): Promise<GameEntry[]> {
    const rows = await this.connection.query<PayloadRow>('SELECT id, payload FROM games', []);
    return rows.map((row) => this.parseEntity(row) as GameEntry);
  }

  async countGames(): Promise<number> {
    const rows = await this.connection.query<{ count: number | string }>(
      'SELECT COUNT(*) AS count FROM games',
      []
    );
    const count = rows[0]?.count;
    const numCount = Number(count);
    return Number.isFinite(numCount) ? numCount : 0;
  }

  async addGame(game: GameEntry): Promise<number> {
    try {
      const result = await this.connection.run(
        `INSERT INTO games (id, igdb_game_id, platform_igdb_id, list_type, title, created_at, updated_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        this.gameValues(game)
      );
      return game.id ?? this.requireLastId(result.lastId);
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async putGame(game: GameEntry): Promise<number> {
    if (game.id === undefined) {
      return this.addGame(game);
    }

    try {
      await this.connection.run(this.gameUpsertStatement(), this.gameValues(game));
      return game.id;
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  updateGame(id: number, changes: Partial<GameEntry>): Promise<void> {
    return this.runInTransaction(['games'], async () => {
      const existing = await this.getGameById(id);

      if (!existing) {
        return;
      }

      await this.putGame({ ...existing, ...changes, id });
    });
  }

  async deleteGame(id: number): Promise<void> {
    await this.connection.run('DELETE FROM games WHERE id = ?', [id]);
  }

  async bulkPutGames(games: GameEntry[]): Promise<void> {
    const statement = this.gameUpsertStatement();
    const identityUpsertStatement = this.gameIdentityUpsertStatement();
    const dedupedGames = this.dedupeGamesByIdentity(games);

    try {
      await this.executeBatched(
        dedupedGames.map((game) => ({
          statement: game.id === undefined ? identityUpsertStatement : statement,
          values: this.gameValues(game),
        }))
      );
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async clearGames(): Promise<void> {
    await this.connection.run('DELETE FROM games', []);
  }

  async getTag(id: number): Promise<Tag | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM tags WHERE id = ?',
      [id]
    );
    return this.firstEntity(rows) as Tag | undefined;
  }

  async getTagByNameIgnoreCase(name: string): Promise<Tag | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM tags WHERE name = ? COLLATE NOCASE',
      [name]
    );
    return this.firstEntity(rows) as Tag | undefined;
  }

  async listTagsSortedByName(): Promise<Tag[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM tags ORDER BY name',
      []
    );
    return rows.map((row) => this.parseEntity(row) as Tag);
  }

  async addTag(tag: Tag): Promise<number> {
    try {
      const result = await this.connection.run(
        'INSERT INTO tags (id, name, payload) VALUES (?, ?, ?)',
        this.tagValues(tag)
      );
      return tag.id ?? this.requireLastId(result.lastId);
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async putTag(tag: Tag): Promise<number> {
    if (tag.id === undefined) {
      return this.addTag(tag);
    }

    try {
      await this.connection.run(
        `INSERT INTO tags (id, name, payload) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, payload = excluded.payload`,
        this.tagValues(tag)
      );
      return tag.id;
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async deleteTag(id: number): Promise<void> {
    await this.connection.run('DELETE FROM tags WHERE id = ?', [id]);
  }

  async bulkPutTags(tags: Tag[]): Promise<void> {
    try {
      await this.executeBatched(
        tags.map((tag) => ({
          statement:
            tag.id === undefined
              ? 'INSERT INTO tags (id, name, payload) VALUES (?, ?, ?)'
              : `INSERT INTO tags (id, name, payload) VALUES (?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, payload = excluded.payload`,
          values: this.tagValues(tag),
        }))
      );
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async clearTags(): Promise<void> {
    await this.connection.run('DELETE FROM tags', []);
  }

  async getView(id: number): Promise<GameListView | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM views WHERE id = ?',
      [id]
    );
    return this.firstEntity(rows) as GameListView | undefined;
  }

  async listViewsByTypeSortedByName(listType: ListType): Promise<GameListView[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM views WHERE list_type = ? ORDER BY name',
      [listType]
    );
    return rows.map((row) => this.parseEntity(row) as GameListView);
  }

  async listAllViews(): Promise<GameListView[]> {
    const rows = await this.connection.query<PayloadRow>('SELECT id, payload FROM views', []);
    return rows.map((row) => this.parseEntity(row) as GameListView);
  }

  async addView(view: GameListView): Promise<number> {
    try {
      const result = await this.connection.run(
        'INSERT INTO views (id, list_type, name, payload) VALUES (?, ?, ?, ?)',
        this.viewValues(view)
      );
      return view.id ?? this.requireLastId(result.lastId);
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async putView(view: GameListView): Promise<number> {
    if (view.id === undefined) {
      return this.addView(view);
    }

    try {
      await this.connection.run(
        `INSERT INTO views (id, list_type, name, payload) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET list_type = excluded.list_type, name = excluded.name, payload = excluded.payload`,
        this.viewValues(view)
      );
      return view.id;
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async deleteView(id: number): Promise<void> {
    await this.connection.run('DELETE FROM views WHERE id = ?', [id]);
  }

  async bulkPutViews(views: GameListView[]): Promise<void> {
    try {
      await this.executeBatched(
        views.map((view) => ({
          statement:
            view.id === undefined
              ? 'INSERT INTO views (id, list_type, name, payload) VALUES (?, ?, ?, ?)'
              : `INSERT INTO views (id, list_type, name, payload) VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET list_type = excluded.list_type, name = excluded.name, payload = excluded.payload`,
          values: this.viewValues(view),
        }))
      );
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async clearViews(): Promise<void> {
    await this.connection.run('DELETE FROM views', []);
  }

  async getOutboxEntry(opId: string): Promise<OutboxEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM outbox WHERE op_id = ?',
      [opId]
    );
    return rows.length > 0 ? (JSON.parse(rows[0].payload) as OutboxEntry) : undefined;
  }

  async countOutbox(): Promise<number> {
    const rows = await this.connection.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM outbox',
      []
    );
    return rows[0]?.total ?? 0;
  }

  async listOutboxOrderedByCreatedAt(): Promise<OutboxEntry[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM outbox ORDER BY created_at',
      []
    );
    return rows.map((row) => JSON.parse(row.payload) as OutboxEntry);
  }

  async listOutboxByEntityType(entityType: SyncEntityType): Promise<OutboxEntry[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM outbox WHERE entity_type = ?',
      [entityType]
    );
    return rows.map((row) => JSON.parse(row.payload) as OutboxEntry);
  }

  async putOutboxEntry(entry: OutboxEntry): Promise<void> {
    try {
      await this.connection.run(
        `INSERT INTO outbox (op_id, entity_type, created_at, payload) VALUES (?, ?, ?, ?)
         ON CONFLICT(op_id) DO UPDATE SET entity_type = excluded.entity_type, created_at = excluded.created_at, payload = excluded.payload`,
        this.outboxValues(entry)
      );
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async bulkPutOutbox(entries: OutboxEntry[]): Promise<void> {
    try {
      await this.executeBatched(
        entries.map((entry) => ({
          statement: `INSERT INTO outbox (op_id, entity_type, created_at, payload) VALUES (?, ?, ?, ?)
            ON CONFLICT(op_id) DO UPDATE SET entity_type = excluded.entity_type, created_at = excluded.created_at, payload = excluded.payload`,
          values: this.outboxValues(entry),
        }))
      );
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async bulkDeleteOutbox(opIds: string[]): Promise<void> {
    await this.executeBatched(
      opIds.map((opId) => ({
        statement: 'DELETE FROM outbox WHERE op_id = ?',
        values: [opId],
      }))
    );
  }

  async clearOutbox(): Promise<void> {
    await this.connection.run('DELETE FROM outbox', []);
  }

  async getSyncMeta(key: string): Promise<SyncMetaEntry | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT payload FROM sync_meta WHERE key = ?',
      [key]
    );
    return rows.length > 0 ? (JSON.parse(rows[0].payload) as SyncMetaEntry) : undefined;
  }

  async listAllSyncMeta(): Promise<SyncMetaEntry[]> {
    const rows = await this.connection.query<PayloadRow>('SELECT payload FROM sync_meta', []);
    return rows.map((row) => JSON.parse(row.payload) as SyncMetaEntry);
  }

  async putSyncMeta(entry: SyncMetaEntry): Promise<void> {
    await this.connection.run(
      `INSERT INTO sync_meta (key, payload) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
      [entry.key, JSON.stringify(entry)]
    );
  }

  async deleteSyncMeta(key: string): Promise<void> {
    await this.connection.run('DELETE FROM sync_meta WHERE key = ?', [key]);
  }

  async clearSyncMeta(): Promise<void> {
    await this.connection.run('DELETE FROM sync_meta', []);
  }

  async getImageCacheByCacheKey(cacheKey: string): Promise<ImageCacheRecord | undefined> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM image_cache_meta WHERE cache_key = ?',
      [cacheKey]
    );
    return this.firstEntity(rows) as ImageCacheRecord | undefined;
  }

  async listImageCacheByGameKey(gameKey: string): Promise<ImageCacheRecord[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM image_cache_meta WHERE game_key = ?',
      [gameKey]
    );
    return rows.map((row) => this.parseEntity(row) as ImageCacheRecord);
  }

  async listImageCacheOrderedByLastAccessedAt(): Promise<ImageCacheRecord[]> {
    const rows = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM image_cache_meta ORDER BY last_accessed_at',
      []
    );
    return rows.map((row) => this.parseEntity(row) as ImageCacheRecord);
  }

  async putImageCache(record: ImageCacheRecord): Promise<number> {
    const values = this.imageCacheValues(record);

    try {
      if (record.id === undefined) {
        const result = await this.connection.run(
          'INSERT INTO image_cache_meta (id, cache_key, game_key, last_accessed_at, payload) VALUES (?, ?, ?, ?, ?)',
          values
        );
        return this.requireLastId(result.lastId);
      }

      await this.connection.run(
        `INSERT INTO image_cache_meta (id, cache_key, game_key, last_accessed_at, payload) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cache_key = excluded.cache_key, game_key = excluded.game_key, last_accessed_at = excluded.last_accessed_at, payload = excluded.payload`,
        values
      );
      return record.id;
    } catch (error: unknown) {
      throw toConstraintError(error);
    }
  }

  async updateImageCacheLastAccessedAt(id: number, lastAccessedAt: string): Promise<void> {
    const existing = await this.connection.query<PayloadRow>(
      'SELECT id, payload FROM image_cache_meta WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return;
    }

    const record = this.parseEntity(existing[0]) as ImageCacheRecord;
    record.lastAccessedAt = lastAccessedAt;

    await this.connection.run(
      'UPDATE image_cache_meta SET last_accessed_at = ?, payload = ? WHERE id = ?',
      [lastAccessedAt, this.serializeEntity(record), id]
    );
  }

  async deleteImageCache(id: number): Promise<void> {
    await this.connection.run('DELETE FROM image_cache_meta WHERE id = ?', [id]);
  }

  async deleteImageCacheByGameKey(gameKey: string): Promise<void> {
    await this.connection.run('DELETE FROM image_cache_meta WHERE game_key = ?', [gameKey]);
  }

  async clearImageCache(): Promise<void> {
    await this.connection.run('DELETE FROM image_cache_meta', []);
  }

  private gameUpsertStatement(): string {
    return `INSERT INTO games (id, igdb_game_id, platform_igdb_id, list_type, title, created_at, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         igdb_game_id = excluded.igdb_game_id,
         platform_igdb_id = excluded.platform_igdb_id,
         list_type = excluded.list_type,
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         payload = excluded.payload`;
  }

  private gameIdentityUpsertStatement(): string {
    return `INSERT INTO games (id, igdb_game_id, platform_igdb_id, list_type, title, created_at, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(igdb_game_id, platform_igdb_id) DO UPDATE SET
         list_type = excluded.list_type,
         title = excluded.title,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         payload = excluded.payload`;
  }

  private dedupeGamesByIdentity(games: GameEntry[]): GameEntry[] {
    const byIdentity = new Map<string, GameEntry>();

    for (const game of games) {
      byIdentity.set(`${game.igdbGameId}\0${String(game.platformIgdbId)}`, game);
    }

    return [...byIdentity.values()];
  }

  private gameValues(game: GameEntry): unknown[] {
    return [
      game.id ?? null,
      game.igdbGameId,
      game.platformIgdbId,
      game.listType,
      game.title,
      game.createdAt,
      game.updatedAt,
      this.serializeEntity(game),
    ];
  }

  private tagValues(tag: Tag): unknown[] {
    return [tag.id ?? null, tag.name, this.serializeEntity(tag)];
  }

  private viewValues(view: GameListView): unknown[] {
    return [view.id ?? null, view.listType, view.name, this.serializeEntity(view)];
  }

  private outboxValues(entry: OutboxEntry): unknown[] {
    return [entry.opId, entry.entityType, entry.createdAt, JSON.stringify(entry)];
  }

  private imageCacheValues(record: ImageCacheRecord): unknown[] {
    return [
      record.id ?? null,
      record.cacheKey,
      record.gameKey,
      record.lastAccessedAt,
      this.serializeEntity(record),
    ];
  }

  /** Serializes an entity without its id (the column is authoritative) and
   * without blobs, which are never stored in SQLite. */
  private serializeEntity(entity: object): string {
    const { id: _id, blob: _blob, ...payload } = entity as Record<string, unknown>;
    return JSON.stringify(payload);
  }

  private parseEntity(row: PayloadRow): unknown {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;

    if (row.id !== undefined) {
      payload['id'] = row.id;
    }

    return payload;
  }

  private firstEntity(rows: PayloadRow[]): unknown {
    return rows.length > 0 ? this.parseEntity(rows[0]) : undefined;
  }

  private requireLastId(lastId: number | undefined): number {
    if (typeof lastId !== 'number' || !Number.isFinite(lastId) || lastId <= 0) {
      throw new Error('SQLite insert did not return a generated id.');
    }

    return lastId;
  }

  private async executeBatched(statements: SqliteStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += BULK_BATCH_SIZE) {
      const batch = statements.slice(index, index + BULK_BATCH_SIZE);
      await this.connection.executeSet(batch);
    }
  }
}
