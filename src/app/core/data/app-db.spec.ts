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

    expect(db.tables.map(table => table.name).sort()).toEqual(['games', 'imageCache', 'outbox', 'syncMeta', 'tags', 'views']);

    await db.close();
  });

  it('migrates externalId to igdbGameId/platformIgdbId on upgrade to v4+', async () => {
    const legacy = new Dexie(dbName);
    legacy.version(3).stores({
      games: '++id,&externalId,listType,title,platformIgdbId,createdAt,updatedAt',
      tags: '++id,&name,createdAt,updatedAt',
    });
    await legacy.open();
    await legacy.table('games').add({
      externalId: '123::130',
      listType: 'collection',
      title: 'Legacy Game',
      platformIgdbId: '',
      platform: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
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
});
