import { OutboxEntry, SyncMetaEntry } from './app-db';
import { DEFAULT_GAME_LIST_FILTERS, GameEntry, GameListView, Tag } from '../models/game.models';
import { ImageCacheRecord, StorageEngine, isStorageConstraintError } from './storage-engine';

export interface StorageEngineContractHarness {
  engine: StorageEngine;
  cleanup: () => Promise<void>;
}

export function makeContractGame(overrides: Partial<GameEntry> = {}): GameEntry {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    igdbGameId: '101',
    platformIgdbId: 18,
    title: 'Alpha Game',
    platform: 'NES',
    listType: 'collection',
    coverUrl: null,
    coverSource: 'none',
    tagIds: [],
    releaseDate: null,
    releaseYear: null,
    enteredCollectionAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeContractTag(overrides: Partial<Tag> = {}): Tag {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    name: 'Backlog',
    color: '#3880ff',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeContractView(overrides: Partial<GameListView> = {}): GameListView {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    name: 'Default View',
    listType: 'collection',
    filters: { ...DEFAULT_GAME_LIST_FILTERS },
    groupBy: 'none',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function makeContractOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    opId: 'op-1',
    entityType: 'game',
    operation: 'upsert',
    payload: { igdbGameId: '101', platformIgdbId: 18 },
    clientTimestamp: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    attemptCount: 0,
    lastError: null,
    ...overrides,
  };
}

export function makeContractSyncMeta(overrides: Partial<SyncMetaEntry> = {}): SyncMetaEntry {
  return {
    key: 'cursor',
    value: '0',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeContractImageCacheRecord(
  overrides: Partial<ImageCacheRecord> = {}
): ImageCacheRecord {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    cacheKey: 'game-1::detail::https://example.com/a.jpg',
    gameKey: 'game-1',
    variant: 'detail',
    sourceUrl: 'https://example.com/a.jpg',
    sizeBytes: 1024,
    updatedAt: now,
    lastAccessedAt: now,
    filePath: null,
    ...overrides,
  };
}

/**
 * Behavioral contract every StorageEngine implementation must satisfy.
 * Run from an engine-specific spec file by providing a factory that creates a
 * fresh engine (with empty storage) per test.
 */
export function describeStorageEngineContract(
  engineName: string,
  createHarness: () => Promise<StorageEngineContractHarness>
): void {
  describe(`StorageEngine contract: ${engineName}`, () => {
    let engine: StorageEngine;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const harness = await createHarness();
      engine = harness.engine;
      cleanup = harness.cleanup;
      await engine.initialize();
    });

    afterEach(async () => {
      await cleanup();
    });

    describe('games', () => {
      it('addGame assigns an id and getGameById returns the row', async () => {
        const id = await engine.addGame(makeContractGame());

        expect(id).toBeGreaterThan(0);
        const stored = await engine.getGameById(id);
        expect(stored?.title).toBe('Alpha Game');
        expect(stored?.id).toBe(id);
      });

      it('getGameByIdentity finds a game by compound identity', async () => {
        await engine.addGame(makeContractGame({ igdbGameId: '101', platformIgdbId: 18 }));
        await engine.addGame(
          makeContractGame({ igdbGameId: '101', platformIgdbId: 48, title: 'Other Platform' })
        );

        const found = await engine.getGameByIdentity('101', 48);
        expect(found?.title).toBe('Other Platform');
        expect(await engine.getGameByIdentity('101', 999)).toBeUndefined();
      });

      it('addGame rejects a duplicate identity with a constraint error', async () => {
        await engine.addGame(makeContractGame());

        await expect(engine.addGame(makeContractGame({ title: 'Dupe' }))).rejects.toSatisfy(
          (error: unknown) => isStorageConstraintError(error)
        );
      });

      it('putGame replaces an existing row by id', async () => {
        const id = await engine.addGame(makeContractGame());

        await engine.putGame(makeContractGame({ id, title: 'Replaced Title' }));

        const stored = await engine.getGameById(id);
        expect(stored?.title).toBe('Replaced Title');
        expect((await engine.listAllGames()).length).toBe(1);
      });

      it('putGame raises a constraint error when violating the unique identity index', async () => {
        await engine.addGame(makeContractGame({ igdbGameId: '101', platformIgdbId: 18 }));
        const otherId = await engine.addGame(
          makeContractGame({ igdbGameId: '202', platformIgdbId: 18 })
        );

        await expect(
          engine.putGame(makeContractGame({ id: otherId, igdbGameId: '101', platformIgdbId: 18 }))
        ).rejects.toSatisfy((error: unknown) => isStorageConstraintError(error));
      });

      it('listGamesByTypeSortedByTitle filters by list type and sorts by title', async () => {
        await engine.addGame(
          makeContractGame({ igdbGameId: '1', title: 'Zelda', listType: 'collection' })
        );
        await engine.addGame(
          makeContractGame({ igdbGameId: '2', title: 'Mario', listType: 'collection' })
        );
        await engine.addGame(
          makeContractGame({ igdbGameId: '3', title: 'Banjo', listType: 'wishlist' })
        );

        const collection = await engine.listGamesByTypeSortedByTitle('collection');
        expect(collection.map((game) => game.title)).toEqual(['Mario', 'Zelda']);

        const wishlist = await engine.listGamesByTypeSortedByTitle('wishlist');
        expect(wishlist.map((game) => game.title)).toEqual(['Banjo']);
      });

      it('updateGame applies partial changes', async () => {
        const id = await engine.addGame(makeContractGame());

        await engine.updateGame(id, { title: 'Patched', tagIds: [7] });

        const stored = await engine.getGameById(id);
        expect(stored?.title).toBe('Patched');
        expect(stored?.tagIds).toEqual([7]);
        expect(stored?.platform).toBe('NES');
      });

      it('deleteGame removes the row', async () => {
        const id = await engine.addGame(makeContractGame());

        await engine.deleteGame(id);

        expect(await engine.getGameById(id)).toBeUndefined();
      });

      it('bulkPutGames stores many rows and clearGames empties the store', async () => {
        const games = Array.from({ length: 25 }, (_, index) =>
          makeContractGame({
            igdbGameId: String(1000 + index),
            title: `Game ${String(index).padStart(2, '0')}`,
          })
        );

        await engine.bulkPutGames(games);
        expect((await engine.listAllGames()).length).toBe(25);

        await engine.clearGames();
        expect(await engine.listAllGames()).toEqual([]);
      });
    });

    describe('tags', () => {
      it('addTag assigns an id and getTag returns the row', async () => {
        const id = await engine.addTag(makeContractTag());

        const stored = await engine.getTag(id);
        expect(stored?.name).toBe('Backlog');
      });

      it('getTagByNameIgnoreCase matches case-insensitively', async () => {
        await engine.addTag(makeContractTag({ name: 'Backlog' }));

        expect((await engine.getTagByNameIgnoreCase('backlog'))?.name).toBe('Backlog');
        expect((await engine.getTagByNameIgnoreCase('BACKLOG'))?.name).toBe('Backlog');
        expect(await engine.getTagByNameIgnoreCase('missing')).toBeUndefined();
      });

      it('addTag rejects a duplicate name with a constraint error', async () => {
        await engine.addTag(makeContractTag({ name: 'Backlog' }));

        await expect(
          engine.addTag(makeContractTag({ name: 'Backlog', color: '#ff0000' }))
        ).rejects.toSatisfy((error: unknown) => isStorageConstraintError(error));
      });

      it('listTagsSortedByName sorts by name', async () => {
        await engine.addTag(makeContractTag({ name: 'Zulu' }));
        await engine.addTag(makeContractTag({ name: 'Alpha' }));

        const tags = await engine.listTagsSortedByName();
        expect(tags.map((tag) => tag.name)).toEqual(['Alpha', 'Zulu']);
      });

      it('putTag updates, deleteTag removes, bulkPutTags and clearTags work', async () => {
        const id = await engine.addTag(makeContractTag({ name: 'Backlog' }));

        await engine.putTag(makeContractTag({ id, name: 'Backlog', color: '#00ff00' }));
        expect((await engine.getTag(id))?.color).toBe('#00ff00');

        await engine.deleteTag(id);
        expect(await engine.getTag(id)).toBeUndefined();

        await engine.bulkPutTags([
          makeContractTag({ id: 10, name: 'One' }),
          makeContractTag({ id: 11, name: 'Two' }),
        ]);
        expect((await engine.listTagsSortedByName()).length).toBe(2);

        await engine.clearTags();
        expect(await engine.listTagsSortedByName()).toEqual([]);
      });
    });

    describe('views', () => {
      it('supports add, list by type sorted by name, put, delete and clear', async () => {
        const id = await engine.addView(makeContractView({ name: 'Zed', listType: 'collection' }));
        await engine.addView(makeContractView({ name: 'Apple', listType: 'collection' }));
        await engine.addView(makeContractView({ name: 'Wish', listType: 'wishlist' }));

        const collectionViews = await engine.listViewsByTypeSortedByName('collection');
        expect(collectionViews.map((view) => view.name)).toEqual(['Apple', 'Zed']);
        expect((await engine.listAllViews()).length).toBe(3);

        await engine.putView(makeContractView({ id, name: 'Zed Updated' }));
        expect((await engine.getView(id))?.name).toBe('Zed Updated');

        await engine.deleteView(id);
        expect(await engine.getView(id)).toBeUndefined();

        await engine.bulkPutViews([makeContractView({ id: 50, name: 'Bulk' })]);
        expect((await engine.getView(50))?.name).toBe('Bulk');

        await engine.clearViews();
        expect(await engine.listAllViews()).toEqual([]);
      });
    });

    describe('outbox', () => {
      it('supports put, get, count, ordered and filtered listing, bulk delete and clear', async () => {
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'op-2', createdAt: '2026-01-02T00:00:00.000Z' })
        );
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'op-1', createdAt: '2026-01-01T00:00:00.000Z' })
        );
        await engine.putOutboxEntry(
          makeContractOutboxEntry({
            opId: 'op-3',
            entityType: 'tag',
            createdAt: '2026-01-03T00:00:00.000Z',
          })
        );

        expect(await engine.countOutbox()).toBe(3);
        expect((await engine.getOutboxEntry('op-2'))?.opId).toBe('op-2');

        const ordered = await engine.listOutboxOrderedByCreatedAt();
        expect(ordered.map((entry) => entry.opId)).toEqual(['op-1', 'op-2', 'op-3']);

        const gameOps = await engine.listOutboxByEntityType('game');
        expect(gameOps.map((entry) => entry.opId).sort()).toEqual(['op-1', 'op-2']);

        await engine.bulkDeleteOutbox(['op-1', 'op-3']);
        expect(await engine.countOutbox()).toBe(1);

        await engine.clearOutbox();
        expect(await engine.countOutbox()).toBe(0);
      });

      it('putOutboxEntry replaces an entry with the same opId', async () => {
        await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'op-1', attemptCount: 0 }));
        await engine.putOutboxEntry(
          makeContractOutboxEntry({ opId: 'op-1', attemptCount: 2, lastError: 'failed' })
        );

        expect(await engine.countOutbox()).toBe(1);
        const stored = await engine.getOutboxEntry('op-1');
        expect(stored?.attemptCount).toBe(2);
        expect(stored?.lastError).toBe('failed');
      });

      it('bulkPutOutbox stores multiple entries', async () => {
        await engine.bulkPutOutbox([
          makeContractOutboxEntry({ opId: 'op-a' }),
          makeContractOutboxEntry({ opId: 'op-b' }),
        ]);

        expect(await engine.countOutbox()).toBe(2);
      });
    });

    describe('syncMeta', () => {
      it('supports put, get, list, delete and clear by key', async () => {
        await engine.putSyncMeta(makeContractSyncMeta({ key: 'cursor', value: '42' }));
        await engine.putSyncMeta(makeContractSyncMeta({ key: 'lastSyncAt', value: 'x' }));

        expect((await engine.getSyncMeta('cursor'))?.value).toBe('42');
        expect((await engine.listAllSyncMeta()).length).toBe(2);

        await engine.putSyncMeta(makeContractSyncMeta({ key: 'cursor', value: '43' }));
        expect((await engine.getSyncMeta('cursor'))?.value).toBe('43');

        await engine.deleteSyncMeta('cursor');
        expect(await engine.getSyncMeta('cursor')).toBeUndefined();

        await engine.clearSyncMeta();
        expect(await engine.listAllSyncMeta()).toEqual([]);
      });
    });

    describe('image cache', () => {
      it('supports put, lookup, lists, access touch, delete and clear', async () => {
        const firstId = await engine.putImageCache(
          makeContractImageCacheRecord({
            cacheKey: 'g1::detail::a',
            gameKey: 'g1',
            lastAccessedAt: '2026-01-02T00:00:00.000Z',
          })
        );
        await engine.putImageCache(
          makeContractImageCacheRecord({
            cacheKey: 'g1::detail::b',
            gameKey: 'g1',
            sourceUrl: 'https://example.com/b.jpg',
            lastAccessedAt: '2026-01-01T00:00:00.000Z',
          })
        );
        await engine.putImageCache(
          makeContractImageCacheRecord({
            cacheKey: 'g2::detail::c',
            gameKey: 'g2',
            sourceUrl: 'https://example.com/c.jpg',
            lastAccessedAt: '2026-01-03T00:00:00.000Z',
          })
        );

        expect((await engine.getImageCacheByCacheKey('g1::detail::a'))?.gameKey).toBe('g1');
        expect((await engine.listImageCacheByGameKey('g1')).length).toBe(2);

        const ordered = await engine.listImageCacheOrderedByLastAccessedAt();
        expect(ordered.map((record) => record.cacheKey)).toEqual([
          'g1::detail::b',
          'g1::detail::a',
          'g2::detail::c',
        ]);

        await engine.updateImageCacheLastAccessedAt(firstId, '2026-01-09T00:00:00.000Z');
        const touched = await engine.getImageCacheByCacheKey('g1::detail::a');
        expect(touched?.lastAccessedAt).toBe('2026-01-09T00:00:00.000Z');

        await engine.deleteImageCache(firstId);
        expect(await engine.getImageCacheByCacheKey('g1::detail::a')).toBeUndefined();

        await engine.deleteImageCacheByGameKey('g1');
        expect(await engine.listImageCacheByGameKey('g1')).toEqual([]);

        await engine.clearImageCache();
        expect(await engine.listImageCacheOrderedByLastAccessedAt()).toEqual([]);
      });
    });

    describe('transactions', () => {
      it('commits writes across stores', async () => {
        await engine.runInTransaction(['games', 'outbox'], async () => {
          await engine.addGame(makeContractGame());
          await engine.putOutboxEntry(makeContractOutboxEntry());
        });

        expect((await engine.listAllGames()).length).toBe(1);
        expect(await engine.countOutbox()).toBe(1);
      });

      it('rolls back all writes when the action throws', async () => {
        await engine.addGame(makeContractGame({ igdbGameId: 'keep' }));

        await expect(
          engine.runInTransaction(['games', 'outbox'], async () => {
            await engine.addGame(makeContractGame({ igdbGameId: 'rolled-back' }));
            await engine.putOutboxEntry(makeContractOutboxEntry());
            throw new Error('boom');
          })
        ).rejects.toThrow('boom');

        const games = await engine.listAllGames();
        expect(games.map((game) => game.igdbGameId)).toEqual(['keep']);
        expect(await engine.countOutbox()).toBe(0);
      });

      it('supports reads of own writes within a transaction', async () => {
        await engine.runInTransaction(['syncMeta'], async () => {
          await engine.putSyncMeta(makeContractSyncMeta({ key: 'cursor', value: '7' }));
          const stored = await engine.getSyncMeta('cursor');
          expect(stored?.value).toBe('7');
          await engine.deleteSyncMeta('cursor');
          await engine.putSyncMeta(makeContractSyncMeta({ key: 'cursor', value: '8' }));
        });

        expect((await engine.getSyncMeta('cursor'))?.value).toBe('8');
      });

      it('nested runInTransaction calls join the outer transaction', async () => {
        await engine.runInTransaction(['games', 'outbox'], async () => {
          await engine.addGame(makeContractGame({ igdbGameId: 'outer' }));

          await engine.runInTransaction(['outbox'], async () => {
            await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'nested' }));
          });
        });

        expect((await engine.listAllGames()).map((game) => game.igdbGameId)).toEqual(['outer']);
        expect(await engine.countOutbox()).toBe(1);
        expect((await engine.getOutboxEntry('nested'))?.opId).toBe('nested');
      });

      it('rolls back nested writes when the inner action throws', async () => {
        await engine.addGame(makeContractGame({ igdbGameId: 'keep' }));

        await expect(
          engine.runInTransaction(['games', 'outbox'], async () => {
            await engine.addGame(makeContractGame({ igdbGameId: 'outer' }));

            await engine.runInTransaction(['outbox'], async () => {
              await engine.putOutboxEntry(makeContractOutboxEntry({ opId: 'nested' }));
              throw new Error('inner boom');
            });
          })
        ).rejects.toThrow('inner boom');

        expect((await engine.listAllGames()).map((game) => game.igdbGameId)).toEqual(['keep']);
        expect(await engine.countOutbox()).toBe(0);
      });
    });
  });
}
