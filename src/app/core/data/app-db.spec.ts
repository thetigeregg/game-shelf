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

    db.close();
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
    legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.toArray();

    expect(games).toHaveLength(1);
    expect(games[0].igdbGameId).toBe('123');
    expect(games[0].platformIgdbId).toBe(130);
    expect(games[0].platform).toBe('Unknown platform');
    expect((games[0] as unknown as { externalId?: string }).externalId).toBeUndefined();

    db.close();
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
    legacy.close();

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

    db.close();
  });

  it('mirrors review and metacritic fields on upgrade to v8', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(7).stores({
      games:
        '++id,&[igdbGameId+platformIgdbId],igdbGameId,platformIgdbId,listType,title,platform,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
      views: '++id,listType,name,updatedAt,createdAt',
      imageCache: '++id,&cacheKey,gameKey,variant,lastAccessedAt,updatedAt,sizeBytes',
      outbox: '&opId,entityType,operation,createdAt,clientTimestamp,attemptCount',
      syncMeta: '&key,updatedAt'
    });
    await legacy.open();

    await legacy.table('games').bulkAdd([
      {
        igdbGameId: '100',
        platformIgdbId: 130,
        listType: 'collection',
        title: 'Legacy metacritic-only',
        platform: 'Nintendo Switch',
        metacriticScore: 89,
        metacriticUrl: 'https://www.metacritic.com/game/legacy/',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '101',
        platformIgdbId: 6,
        listType: 'collection',
        title: 'Legacy review-only',
        platform: 'PC (Microsoft Windows)',
        reviewScore: 76,
        reviewUrl: 'https://www.mobygames.com/game/101/review-only/',
        reviewSource: 'mobygames',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.orderBy('igdbGameId').toArray();

    expect(games).toHaveLength(2);
    expect(games[0]).toEqual(
      expect.objectContaining({
        igdbGameId: '100',
        reviewScore: 89,
        reviewUrl: 'https://www.metacritic.com/game/legacy/',
        reviewSource: 'metacritic',
        metacriticScore: 89,
        metacriticUrl: 'https://www.metacritic.com/game/legacy/'
      })
    );
    expect(games[1]).toEqual(
      expect.objectContaining({
        igdbGameId: '101',
        reviewScore: 76,
        reviewUrl: 'https://www.mobygames.com/game/101/review-only/',
        reviewSource: 'mobygames',
        metacriticScore: 76,
        metacriticUrl: 'https://www.mobygames.com/game/101/review-only/'
      })
    );

    db.close();
  });
});
