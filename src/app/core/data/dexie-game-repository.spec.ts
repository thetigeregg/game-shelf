import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { AppDb } from './app-db';
import { DexieGameRepository } from './dexie-game-repository';
import { GameCatalogResult } from '../models/game.models';

describe('DexieGameRepository', () => {
  let db: AppDb;
  let repository: DexieGameRepository;

  const mario: GameCatalogResult = {
    externalId: '101',
    title: 'Super Mario Bros.',
    coverUrl: 'https://example.com/mario.jpg',
    platform: 'NES',
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

    const stored = await repository.exists(mario.externalId);
    expect(stored?.title).toBe(mario.title);
  });

  it('moves a game to the other list when added again with same externalId', async () => {
    await repository.upsertFromCatalog(mario, 'wishlist');
    const updated = await repository.upsertFromCatalog({ ...mario, title: 'Super Mario Bros. Deluxe' }, 'collection');

    expect(updated.listType).toBe('collection');
    expect(updated.title).toContain('Deluxe');

    const all = await db.games.toArray();
    expect(all.length).toBe(1);
  });

  it('removes a game by externalId', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.remove(mario.externalId);

    const existing = await repository.exists(mario.externalId);
    expect(existing).toBeUndefined();
  });

  it('returns games sorted alphabetically by title for each list', async () => {
    await repository.upsertFromCatalog({ ...mario, externalId: '1', title: 'Zelda' }, 'collection');
    await repository.upsertFromCatalog({ ...mario, externalId: '2', title: 'Animal Crossing' }, 'collection');

    const collection = await repository.listByType('collection');

    expect(collection.map(game => game.title)).toEqual(['Animal Crossing', 'Zelda']);
  });
});
