import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { AppDb } from './app-db';

describe('AppDb', () => {
  const dbName = 'game-shelf-db';

  afterEach(async () => {
    await Dexie.delete(dbName);
  });

  it('opens with v7 schema including sync/outbox tables', async () => {
    const db = new AppDb();
    await db.open();

    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'games',
      'imageCache',
      'outbox',
      'syncMeta',
      'tags',
      'views'
    ]);

    await db.close();
  });

  it('migrates externalId to igdbGameId/platformIgdbId on upgrade to v4+', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(3).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt'
    });
    await legacy.open();
    await legacy.table('games').add({
      externalId: '123::130',
      listType: 'collection',
      title: 'Legacy Game',
      platformIgdbId: '',
      platform: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    await legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.toArray();

    expect(games).toHaveLength(1);
    expect(games[0].igdbGameId).toBe('123');
    expect(games[0].platformIgdbId).toBe(130);
    expect(games[0].platform).toBe('Unknown platform');
    expect((games[0] as unknown as { externalId?: string }).externalId).toBeUndefined();

    await db.close();
  });

  it('handles migration edge cases for externalId/platform fallback rules', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(3).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt'
    });
    await legacy.open();
    await legacy.table('games').bulkAdd([
      {
        externalId: '456',
        listType: 'collection',
        title: 'No separator',
        platformIgdbId: '',
        platform: 'PC',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        externalId: '789::6',
        listType: 'collection',
        title: 'Existing platform id wins',
        platformIgdbId: '42',
        platform: '  Nintendo Switch  ',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    await legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.orderBy('igdbGameId').toArray();

    expect(games).toHaveLength(2);
    expect(games[0].igdbGameId).toBe('456');
    expect(games[0].platformIgdbId).toBe(0);
    expect(games[0].platform).toBe('PC');

    expect(games[1].igdbGameId).toBe('789');
    expect(games[1].platformIgdbId).toBe(42);
    expect(games[1].platform).toBe('Nintendo Switch');

    await db.close();
  });
});
