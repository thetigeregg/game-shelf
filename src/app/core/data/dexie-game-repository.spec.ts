import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { AppDb } from './app-db';
import { DexieGameRepository } from './dexie-game-repository';
import { DEFAULT_GAME_LIST_FILTERS, GameCatalogResult } from '../models/game.models';
import { SYNC_OUTBOX_WRITER, SyncOutboxWriter } from './sync-outbox-writer';

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
    releaseYear: 1985
  };

  function requireValue<T>(value: T | null | undefined): T {
    expect(value).toBeDefined();
    return value as T;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AppDb, DexieGameRepository]
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

    const stored = await repository.exists(mario.igdbGameId, mario.platformIgdbId);
    expect(stored?.title).toBe(mario.title);
  });

  it('persists optional HLTB completion times and keeps existing values when absent in updates', async () => {
    await repository.upsertFromCatalog(
      {
        ...mario,
        hltbMainHours: 12.1,
        hltbMainExtraHours: 18.4,
        hltbCompletionistHours: 30.2
      },
      'collection'
    );

    await repository.upsertFromCatalog(
      {
        ...mario,
        title: 'Super Mario Bros. Updated'
      },
      'wishlist'
    );

    const stored = await repository.exists(mario.igdbGameId, mario.platformIgdbId);
    expect(stored?.hltbMainHours).toBe(12.1);
    expect(stored?.hltbMainExtraHours).toBe(18.4);
    expect(stored?.hltbCompletionistHours).toBe(30.2);
  });

  it('moves a game to the other list when added again with same identity', async () => {
    await repository.upsertFromCatalog(mario, 'wishlist');
    const updated = await repository.upsertFromCatalog(
      { ...mario, title: 'Super Mario Bros. Deluxe' },
      'collection'
    );

    expect(updated.listType).toBe('collection');
    expect(updated.title).toContain('Deluxe');

    const all = await db.games.toArray();
    expect(all.length).toBe(1);
  });

  it('removes a game by identity', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.remove(mario.igdbGameId, mario.platformIgdbId);

    const existing = await repository.exists(mario.igdbGameId, mario.platformIgdbId);
    expect(existing).toBeUndefined();
  });

  it('returns games sorted alphabetically by title for each list', async () => {
    await repository.upsertFromCatalog(
      { ...mario, igdbGameId: '1', platformIgdbId: 18, title: 'Zelda' },
      'collection'
    );
    await repository.upsertFromCatalog(
      { ...mario, igdbGameId: '2', platformIgdbId: 19, title: 'Animal Crossing' },
      'collection'
    );

    const collection = await repository.listByType('collection');

    expect(collection.map((game) => game.title)).toEqual(['Animal Crossing', 'Zelda']);
  });

  it('updates cover art for an existing entry', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    const updated = await repository.updateCover(
      '101',
      18,
      'https://example.com/custom-cover.jpg',
      'thegamesdb'
    );

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

    await repository.setGameTags('101', 18, [
      requireValue(multiplayer.id),
      requireValue(backlog.id)
    ]);

    const stored = await repository.exists('101', 18);
    expect(stored?.tagIds).toEqual([requireValue(multiplayer.id), requireValue(backlog.id)]);
  });

  it('removes deleted tags from all games', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    const coop = await repository.upsertTag({ name: 'Co-op', color: '#123456' });
    const rpg = await repository.upsertTag({ name: 'RPG', color: '#654321' });

    await repository.setGameTags('101', 18, [requireValue(coop.id), requireValue(rpg.id)]);
    await repository.deleteTag(requireValue(coop.id));

    const stored = await repository.exists('101', 18);
    expect(stored?.tagIds).toEqual([requireValue(rpg.id)]);
  });

  it('no-ops when move/remove/update operations target missing entries', async () => {
    await repository.moveToList('999', 999, 'wishlist');
    await repository.remove('999', 999);
    const updatedCover = await repository.updateCover('999', 999, null, 'igdb');
    const updatedStatus = await repository.setGameStatus('999', 999, 'completed');
    const updatedRating = await repository.setGameRating('999', 999, 5);
    const updatedTags = await repository.setGameTags('999', 999, [1, 2]);

    expect(updatedCover).toBeUndefined();
    expect(updatedStatus).toBeUndefined();
    expect(updatedRating).toBeUndefined();
    expect(updatedTags).toBeUndefined();
  });

  it('returns undefined for malformed identity keys instead of throwing from IndexedDB', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await expect(repository.exists('101', Number.NaN)).resolves.toBeUndefined();
    await expect(repository.exists('', 18)).resolves.toBeUndefined();
    await expect(repository.exists('101', 0)).resolves.toBeUndefined();
  });

  it('updates status and rating for existing entries', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    await repository.setGameStatus('101', 18, 'playing');
    await repository.setGameRating('101', 18, 4);
    const stored = await repository.exists('101', 18);

    expect(stored?.status).toBe('playing');
    expect(stored?.rating).toBe(4);
  });

  it('deduplicates and normalizes tag assignments', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    await repository.setGameTags('101', 18, [2, 2, -1, 3]);
    const stored = await repository.exists('101', 18);
    expect(stored?.tagIds).toEqual([2, 3]);
  });

  it('stores and resets custom metadata without overwriting IGDB metadata', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.setGameCustomMetadata('101', 18, {
      title: 'My Mario',
      platform: { name: 'Nintendo Switch', igdbId: 130 }
    });

    const customized = await repository.exists('101', 18);
    expect(customized?.title).toBe('Super Mario Bros.');
    expect(customized?.platform).toBe('NES');
    expect(customized?.customTitle).toBe('My Mario');
    expect(customized?.customPlatform).toBe('Nintendo Switch');
    expect(customized?.customPlatformIgdbId).toBe(130);

    await repository.setGameCustomMetadata('101', 18, { title: null, platform: null });
    const reset = await repository.exists('101', 18);
    expect(reset?.customTitle).toBeNull();
    expect(reset?.customPlatform).toBeNull();
    expect(reset?.customPlatformIgdbId).toBeNull();
  });

  it('stores and resets custom cover image', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    const customCoverUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

    await repository.setGameCustomCover('101', 18, customCoverUrl);
    const customized = await repository.exists('101', 18);
    expect(customized?.customCoverUrl).toBe(customCoverUrl);

    await repository.setGameCustomCover('101', 18, null);
    const reset = await repository.exists('101', 18);
    expect(reset?.customCoverUrl).toBeNull();
  });

  it('stores notes, normalizes line endings, and clears empty notes', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.setGameNotes('101', 18, 'Line 1\r\nLine 2');
    const withNotes = await repository.exists('101', 18);
    expect(withNotes?.notes).toBe('Line 1\nLine 2');

    await repository.setGameNotes('101', 18, '');
    const cleared = await repository.exists('101', 18);
    expect(cleared?.notes).toBeNull();
  });

  it('stores structure-only rich-text notes', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.setGameNotes('101', 18, '<ul><li><p></p></li></ul>');
    const withList = await repository.exists('101', 18);
    expect(withList?.notes).toContain('<ul');

    await repository.setGameNotes(
      '101',
      18,
      '<details><summary><p></p></summary><div data-type="detailsContent"><p></p></div></details>'
    );
    const withDetails = await repository.exists('101', 18);
    expect(withDetails?.notes).toContain('<details');
  });

  it('preserves meaningful note whitespace while sanitizing unsafe html', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.setGameNotes('101', 18, '  hello<script>alert(1)</script>  ');
    const stored = await repository.exists('101', 18);
    expect(stored?.notes).toBe('  hello  ');
  });

  it('preserves existing notes when catalog metadata is refreshed', async () => {
    await repository.upsertFromCatalog(mario, 'collection');
    await repository.setGameNotes('101', 18, 'Track hidden item locations');

    await repository.upsertFromCatalog(
      { ...mario, title: 'Super Mario Bros. Updated' },
      'collection'
    );

    const stored = await repository.exists('101', 18);
    expect(stored?.notes).toBe('Track hidden item locations');
  });

  it('normalizes metacritic score/url on create and update', async () => {
    await repository.upsertFromCatalog(
      {
        ...mario,
        metacriticScore: 87.6,
        metacriticUrl: '//www.metacritic.com/game/super-mario-bros/'
      },
      'collection'
    );

    const created = await repository.exists('101', 18);
    expect(created?.metacriticScore).toBe(88);
    expect(created?.metacriticUrl).toBe('https://www.metacritic.com/game/super-mario-bros/');

    await repository.upsertFromCatalog(
      {
        ...mario,
        metacriticScore: 101,
        metacriticUrl: 'ftp://invalid'
      },
      'collection'
    );
    const invalidUpdated = await repository.exists('101', 18);
    expect(invalidUpdated?.metacriticScore).toBeNull();
    expect(invalidUpdated?.metacriticUrl).toBeNull();

    await repository.upsertFromCatalog(
      {
        ...mario,
        metacriticScore: 95,
        metacriticUrl: 'https://www.metacritic.com/game/super-mario-bros/'
      },
      'collection'
    );
    const httpsUpdated = await repository.exists('101', 18);
    expect(httpsUpdated?.metacriticScore).toBe(95);
    expect(httpsUpdated?.metacriticUrl).toBe('https://www.metacritic.com/game/super-mario-bros/');
  });

  it('normalizes reviewScore preserving decimals on create and update', async () => {
    await repository.upsertFromCatalog(
      {
        ...mario,
        reviewScore: 88.2,
        reviewUrl: 'https://www.metacritic.com/game/super-mario-bros/',
        reviewSource: 'metacritic'
      },
      'collection'
    );

    const created = await repository.exists('101', 18);
    expect(created?.reviewScore).toBe(88.2);

    await repository.upsertFromCatalog(
      {
        ...mario,
        reviewScore: 95,
        reviewUrl: 'https://www.metacritic.com/game/super-mario-bros/',
        reviewSource: 'metacritic'
      },
      'collection'
    );
    const intUpdated = await repository.exists('101', 18);
    expect(intUpdated?.reviewScore).toBe(95);

    await repository.upsertFromCatalog(
      {
        ...mario,
        reviewScore: 101,
        reviewUrl: 'https://www.metacritic.com/game/super-mario-bros/',
        reviewSource: 'metacritic'
      },
      'collection'
    );
    const outOfRange = await repository.exists('101', 18);
    expect(outOfRange?.reviewScore).toBeNull();

    await repository.upsertFromCatalog(
      {
        ...mario,
        reviewScore: 0,
        reviewUrl: null,
        reviewSource: null
      },
      'collection'
    );
    const zeroScore = await repository.exists('101', 18);
    expect(zeroScore?.reviewScore).toBeNull();

    await repository.upsertFromCatalog(
      {
        ...mario,
        reviewScore: 100,
        reviewUrl: null,
        reviewSource: null
      },
      'collection'
    );
    const maxScore = await repository.exists('101', 18);
    expect(maxScore?.reviewScore).toBe(100);
  });

  it('preserves existing metacritic score/url when absent in partial upsert', async () => {
    await repository.upsertFromCatalog(
      {
        ...mario,
        metacriticScore: 92,
        metacriticUrl: 'https://www.metacritic.com/game/super-mario-bros/'
      },
      'collection'
    );

    await repository.upsertFromCatalog(
      { ...mario, title: 'Super Mario Bros. Updated' },
      'collection'
    );

    const stored = await repository.exists('101', 18);
    expect(stored?.metacriticScore).toBe(92);
    expect(stored?.metacriticUrl).toBe('https://www.metacritic.com/game/super-mario-bros/');
  });

  it('upserts tags by name and by id', async () => {
    const created = await repository.upsertTag({ name: 'Backlog', color: '#111111' });
    const byName = await repository.upsertTag({ name: 'backlog', color: '#222222' });
    const byId = await repository.upsertTag({
      id: created.id,
      name: 'Backlog Updated',
      color: '#333333'
    });
    const tags = await repository.listTags();

    expect(byName.id).toBe(created.id);
    expect(byName.color).toBe('#222222');
    expect(byId.name).toBe('Backlog Updated');
    expect(tags).toHaveLength(1);
  });

  it('creates, updates, lists, gets and deletes views', async () => {
    const created = await repository.createView({
      name: '  My View  ',
      listType: 'collection',
      filters: {
        sortField: 'releaseDate',
        sortDirection: 'desc',
        platform: ['Switch', 'Switch', ''],
        genres: ['Action', 'Action'],
        statuses: ['playing', 'playing', 'none'],
        tags: ['A', 'A', ''],
        ratings: [5, 5, 'none'],
        hltbMainHoursMin: 5,
        hltbMainHoursMax: 30,
        releaseDateFrom: '2024-01-01T00:00:00.000Z',
        releaseDateTo: '2024-12-31T00:00:00.000Z'
      },
      groupBy: 'platform'
    });

    const createdId = requireValue(created.id);
    const fetched = await repository.getView(createdId);
    expect(fetched?.name).toBe('My View');
    expect(fetched?.filters.platform).toEqual(['Switch']);
    expect(fetched?.filters.releaseDateFrom).toBe('2024-01-01');
    expect(fetched?.filters.excludedStatuses).toEqual([]);
    expect(fetched?.filters.excludedTags).toEqual([]);
    expect(fetched?.groupBy).toBe('platform');

    const updated = await repository.updateView(createdId, {
      name: ' Renamed ',
      filters: {
        sortField: 'title',
        sortDirection: 'asc',
        platform: [],
        collections: [],
        developers: [],
        franchises: [],
        publishers: [],
        gameTypes: [],
        genres: [],
        statuses: [],
        tags: [],
        excludedPlatform: [],
        excludedGenres: [],
        excludedStatuses: ['none', 'playing'],
        excludedTags: ['__none__', 'Spoilers'],
        excludedGameTypes: [],
        ratings: [],
        hltbMainHoursMin: null,
        hltbMainHoursMax: null,
        releaseDateFrom: null,
        releaseDateTo: null
      },
      groupBy: 'publisher'
    });

    expect(updated?.name).toBe('Renamed');
    expect(updated?.groupBy).toBe('publisher');
    expect(updated?.filters.excludedStatuses).toEqual(['playing']);
    expect(updated?.filters.excludedTags).toEqual(['Spoilers']);

    const list = await repository.listViews('collection');
    expect(list).toHaveLength(1);

    await repository.deleteView(createdId);
    expect(await repository.getView(createdId)).toBeUndefined();
  });

  it('returns undefined when updating a missing view', async () => {
    const updated = await repository.updateView(404, { name: 'Missing' });
    expect(updated).toBeUndefined();
  });

  it('falls back to default sort field when view sort field is invalid', async () => {
    const created = await repository.createView({
      name: 'Sort fallback',
      listType: 'collection',
      filters: {
        ...DEFAULT_GAME_LIST_FILTERS,
        sortField: 'unsupported' as never
      },
      groupBy: 'none'
    });
    expect(created.filters.sortField).toBe(DEFAULT_GAME_LIST_FILTERS.sortField);
  });

  it('throws for invalid game and view inputs', async () => {
    await expect(
      repository.upsertFromCatalog({ ...mario, igdbGameId: ' ' }, 'collection')
    ).rejects.toThrowError('IGDB game id is required.');
    await expect(
      repository.upsertFromCatalog({ ...mario, platformIgdbId: null }, 'collection')
    ).rejects.toThrowError('IGDB platform id is required.');
    await expect(
      repository.upsertFromCatalog({ ...mario, platform: ' ' }, 'collection')
    ).rejects.toThrowError('Platform is required.');
    await expect(
      repository.createView({
        name: ' ',
        listType: 'collection',
        filters: {
          sortField: 'title',
          sortDirection: 'asc',
          platform: [],
          genres: [],
          statuses: [],
          tags: [],
          ratings: [],
          hltbMainHoursMin: null,
          hltbMainHoursMax: null,
          releaseDateFrom: null,
          releaseDateTo: null
        },
        groupBy: 'none'
      })
    ).rejects.toThrowError('View name is required.');
  });

  it('queues outbox operations when sync writer is configured', async () => {
    const calls: Array<Parameters<SyncOutboxWriter['enqueueOperation']>[0]> = [];
    const writer: SyncOutboxWriter = {
      enqueueOperation: async (request) => {
        calls.push(request);
        return Promise.resolve();
      }
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppDb, DexieGameRepository, { provide: SYNC_OUTBOX_WRITER, useValue: writer }]
    });

    const queuedDb = TestBed.inject(AppDb);
    const queuedRepository = TestBed.inject(DexieGameRepository);

    await queuedRepository.upsertFromCatalog(mario, 'collection');
    await queuedRepository.setGameStatus('101', 18, 'playing');
    await queuedRepository.remove('101', 18);
    const tag = await queuedRepository.upsertTag({ name: 'Queue Tag', color: '#ff0000' });
    await queuedRepository.deleteTag(requireValue(tag.id));

    expect(calls.some((call) => call.entityType === 'game' && call.operation === 'upsert')).toBe(
      true
    );
    expect(calls.some((call) => call.entityType === 'game' && call.operation === 'delete')).toBe(
      true
    );
    expect(calls.some((call) => call.entityType === 'tag' && call.operation === 'upsert')).toBe(
      true
    );
    expect(calls.some((call) => call.entityType === 'tag' && call.operation === 'delete')).toBe(
      true
    );

    await queuedDb.delete();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppDb, DexieGameRepository]
    });
    db = TestBed.inject(AppDb);
    repository = TestBed.inject(DexieGameRepository);
  });

  it('preserves incoming similarGameIgdbIds when updating an existing game', async () => {
    await repository.upsertFromCatalog(
      { ...mario, similarGameIgdbIds: ['200', '300'] },
      'collection'
    );
    const created = await repository.exists('101', 18);
    expect(created?.similarGameIgdbIds).toEqual(['200', '300']);

    await repository.upsertFromCatalog(
      { ...mario, similarGameIgdbIds: ['400', '500'] },
      'collection'
    );
    const updated = await repository.exists('101', 18);
    expect(updated?.similarGameIgdbIds).toEqual(['400', '500']);
  });

  it('returns null for custom platform igdb id when it matches the default platform', async () => {
    await repository.upsertFromCatalog(mario, 'collection');

    await repository.setGameCustomMetadata('101', 18, {
      title: null,
      platform: { name: 'NES', igdbId: 18 }
    });

    const stored = await repository.exists('101', 18);
    expect(stored?.customPlatformIgdbId).toBeNull();
  });
});
