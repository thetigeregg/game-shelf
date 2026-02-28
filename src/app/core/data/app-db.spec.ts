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

  it('skips mobygamesGameId backfill on v9 upgrade when id is already valid', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(8).stores({
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
        igdbGameId: '200',
        platformIgdbId: 16,
        listType: 'collection',
        title: 'Already Has Moby ID',
        platform: 'Genesis',
        reviewSource: 'mobygames',
        reviewUrl: 'https://www.mobygames.com/game/999/shining-force/',
        mobygamesGameId: 999,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '201',
        platformIgdbId: 130,
        listType: 'collection',
        title: 'Non-Moby Game',
        platform: 'Nintendo Switch',
        reviewSource: 'metacritic',
        reviewUrl: 'https://www.metacritic.com/game/test/',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.orderBy('igdbGameId').toArray();

    expect(games).toHaveLength(2);
    expect(games[0].mobygamesGameId).toBe(999);
    expect(games[1].mobygamesGameId).toBeNull();

    db.close();
  });

  it('backfills mobyScore on v10 upgrade with valid and invalid reviewScore values', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(9).stores({
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
        igdbGameId: '300',
        platformIgdbId: 16,
        listType: 'collection',
        title: 'Already Has MobyScore',
        platform: 'Genesis',
        reviewSource: 'mobygames',
        reviewScore: 88,
        mobyScore: 8.8,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '301',
        platformIgdbId: 16,
        listType: 'collection',
        title: 'Moby With ReviewScore 100-scale',
        platform: 'Genesis',
        reviewSource: 'mobygames',
        reviewScore: 88,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '302',
        platformIgdbId: 16,
        listType: 'collection',
        title: 'Moby With 10-scale ReviewScore',
        platform: 'Genesis',
        reviewSource: 'mobygames',
        reviewScore: 8.8,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '303',
        platformIgdbId: 130,
        listType: 'collection',
        title: 'Metacritic Game No MobyScore',
        platform: 'Nintendo Switch',
        reviewSource: 'metacritic',
        reviewScore: 90,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        igdbGameId: '304',
        platformIgdbId: 16,
        listType: 'collection',
        title: 'Moby With Zero ReviewScore',
        platform: 'Genesis',
        reviewSource: 'mobygames',
        reviewScore: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    legacy.close();

    const db = new AppDb();
    await db.open();
    const games = await db.games.orderBy('igdbGameId').toArray();

    expect(games).toHaveLength(5);
    expect(games[0].mobyScore).toBe(8.8);
    expect(games[1].mobyScore).toBe(8.8);
    expect(games[2].mobyScore).toBe(8.8);
    expect(games[3].mobyScore).toBeNull();
    expect(games[4].mobyScore).toBeNull();

    db.close();
  });
});
