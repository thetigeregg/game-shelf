import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { AppDb } from './app-db';
import { DexieGameRepository } from './dexie-game-repository';
import { GameCatalogResult } from '../models/game.models';

describe('DexieGameRepository', () => {
  let db: AppDb;
  let repository: DexieGameRepository;

  const mario: GameCatalogResult = {
    igdbGameId: '101',
    title: 'Super Mario Bros.',
    coverUrl: 'https://example.com/mario.jpg',
    coverSource: 'igdb',
    platforms: ['NES'],
    platform: 'NES',
    platformIgdbId: 18,
    releaseDate: '1985-09-13T00:00:00.000Z',
    releaseYear: 1985,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AppDb, DexieGameRepository],
    });

    db = TestBed.inject(AppDb);
    repository = TestBed.inject(DexieGameRepository);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('inserts a new game into the target list', async () => {
    const created = await repository.upsertFromCatalog(mario, 'wishlist');

    expect(created.id).toBeDefined();
    expect(created.listType).toBe('wishlist');

    const stored = await repository.exists(mario.igdbGameId, mario.platformIgdbId!);
    expect(stored?.title).toBe(mario.title);
  });

  it('moves a game to the other list when added again with same identity', async () => {
    await repository.upsertFromCatalog(mario, 'wishlist');
    const updated = await repository.upsertFromCatalog({ ...mario, title: 'Super Mario Bros. Deluxe' }, 'collection');

    expect(updated.listType).toBe('collection');
    expect(updated.title).toContain('Deluxe');

    const all = await db.games.toArray();
    expect(all.length).toBe(1);
  });

  it('removes a game by identity', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.remove(mario.igdbGameId, mario.platformIgdbId!);

    const existing = await repository.exists(mario.igdbGameId, mario.platformIgdbId!);
    expect(existing).toBeUndefined();
  });

  it('returns games sorted alphabetically by title for each list', async () => {
    await repository.upsertFromCatalog({ ...mario, igdbGameId: '1', platformIgdbId: 18, title: 'Zelda' }, 'collection');
    await repository.upsertFromCatalog({ ...mario, igdbGameId: '2', platformIgdbId: 19, title: 'Animal Crossing' }, 'collection');

    const collection = await repository.listByType('collection');

    expect(collection.map(game => game.title)).toEqual(['Animal Crossing', 'Zelda']);
  });

  it('updates cover art for an existing entry', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    const updated = await repository.updateCover('101', 18, 'https://example.com/custom-cover.jpg', 'thegamesdb');

    expect(updated?.coverUrl).toBe('https://example.com/custom-cover.jpg');
    expect(updated?.coverSource).toBe('thegamesdb');

    const existing = await repository.exists('101', 18);
    expect(existing?.coverUrl).toBe('https://example.com/custom-cover.jpg');
    expect(existing?.coverSource).toBe('thegamesdb');
  });

  it('persists selected IGDB platform id with entries', async () => {
    await repository.upsertFromCatalog({ ...mario, platformIgdbId: 130 }, 'collection');

    const stored = await repository.exists(mario.igdbGameId, 130);
    expect(stored?.platformIgdbId).toBe(130);
  });

  it('creates tags and assigns them to a game', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    const multiplayer = await repository.upsertTag({ name: 'Multiplayer', color: '#ff0000' });
    const backlog = await repository.upsertTag({ name: 'Backlog', color: '#00ff00' });

    await repository.setGameTags('101', 18, [multiplayer.id!, backlog.id!]);

    const stored = await repository.exists('101', 18);
    expect(stored?.tagIds).toEqual([multiplayer.id!, backlog.id!]);
  });

  it('removes deleted tags from all games', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    const coop = await repository.upsertTag({ name: 'Co-op', color: '#123456' });
    const rpg = await repository.upsertTag({ name: 'RPG', color: '#654321' });

    await repository.setGameTags('101', 18, [coop.id!, rpg.id!]);
    await repository.deleteTag(coop.id!);

    const stored = await repository.exists('101', 18);
    expect(stored?.tagIds).toEqual([rpg.id!]);
  });
});
