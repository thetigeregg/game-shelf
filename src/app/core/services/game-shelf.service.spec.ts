import { firstValueFrom, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { DEFAULT_GAME_LIST_FILTERS, GameCatalogResult, GameEntry, GameListView } from '../models/game.models';
import { GameShelfService } from './game-shelf.service';

describe('GameShelfService', () => {
  let repository: {
    [K in keyof GameRepository]: ReturnType<typeof vi.fn>
  };
  let searchApi: {
    [K in keyof GameSearchApi]: ReturnType<typeof vi.fn>
  };
  let service: GameShelfService;

  beforeEach(() => {
    repository = {
      listByType: vi.fn(),
      listAll: vi.fn(),
      upsertFromCatalog: vi.fn(),
      moveToList: vi.fn(),
      remove: vi.fn(),
      exists: vi.fn(),
      updateCover: vi.fn(),
      setGameStatus: vi.fn(),
      setGameRating: vi.fn(),
      setGameTags: vi.fn(),
      listTags: vi.fn(),
      upsertTag: vi.fn(),
      deleteTag: vi.fn(),
      listViews: vi.fn(),
      getView: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn(),
    };

    searchApi = {
      searchGames: vi.fn(),
      getGameById: vi.fn(),
      listPlatforms: vi.fn(),
      searchBoxArtByTitle: vi.fn(),
      lookupCompletionTimes: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        GameShelfService,
        { provide: GAME_REPOSITORY, useValue: repository },
        { provide: GAME_SEARCH_API, useValue: searchApi },
      ],
    });

    service = TestBed.inject(GameShelfService);
  });

  it('returns empty search results for short queries and does not call API', async () => {
    const results = await firstValueFrom(service.searchGames('m'));

    expect(results).toEqual([]);
    expect(searchApi.searchGames).not.toHaveBeenCalled();
  });

  it('propagates API errors for valid search queries', async () => {
    searchApi.searchGames.mockReturnValue(throwError(() => new Error('API unavailable')));

    await expect(firstValueFrom(service.searchGames('mario'))).rejects.toThrowError('API unavailable');
  });

  it('delegates add/move/remove actions to repository', async () => {
    const mario: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017,
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      platform: 'Switch',
      platformIgdbId: 130,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    await service.addGame(mario, 'collection');
    await service.moveGame('123', 130, 'wishlist');
    await service.removeGame('123', 130);

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ igdbGameId: '123', platform: 'Switch', platformIgdbId: 130 }),
      'collection'
    );
    expect(repository.moveToList).toHaveBeenCalledWith('123', 130, 'wishlist');
    expect(repository.remove).toHaveBeenCalledWith('123', 130);
  });

  it('enriches games with HLTB completion times during add when available', async () => {
    const mario: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017,
    };

    searchApi.lookupCompletionTimes.mockReturnValue(of({
      hltbMainHours: 12,
      hltbMainExtraHours: 18.5,
      hltbCompletionistHours: 30,
    }));
    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);

    await service.addGame(mario, 'collection');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalledWith('Mario Kart', 2017, 'Switch');
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(2);
    expect(repository.upsertFromCatalog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        igdbGameId: '123',
        platform: 'Switch',
        platformIgdbId: 130,
      }),
      'collection',
    );
    expect(repository.upsertFromCatalog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hltbMainHours: 12,
        hltbMainExtraHours: 18.5,
        hltbCompletionistHours: 30,
      }),
      'collection',
    );
  });

  it('skips HLTB lookup during add when completion times are already present', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      hltbMainHours: 12.34,
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017,
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);

    await service.addGame(game, 'collection');

    expect(searchApi.lookupCompletionTimes).not.toHaveBeenCalled();
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ hltbMainHours: 12.34 }),
      'collection',
    );
  });

  it('continues add when HLTB lookup fails', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017,
    };

    searchApi.lookupCompletionTimes.mockReturnValue(throwError(() => new Error('HLTB down')));
    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalled();
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(1);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ igdbGameId: '123', platform: 'Switch', platformIgdbId: 130 }),
      'collection',
    );
  });

  it('skips HLTB lookup for short titles during add', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '123',
      title: 'x',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null,
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);

    await service.addGame(game, 'collection');

    expect(searchApi.lookupCompletionTimes).not.toHaveBeenCalled();
  });

  it('returns API search results for valid queries', async () => {
    const expected: GameCatalogResult[] = [
      {
        igdbGameId: '1',
        title: 'Mario',
        coverUrl: null,
        coverSource: 'none',
        developers: [],
        franchises: [],
        genres: [],
        publishers: [],
        platforms: [],
        platform: null,
        platformIgdbId: null,
        releaseDate: null,
        releaseYear: null
      },
    ];
    searchApi.searchGames.mockReturnValue(of(expected));

    const result = await firstValueFrom(service.searchGames('mario'));

    expect(result).toEqual(expected);
    expect(searchApi.searchGames).toHaveBeenCalledWith('mario', undefined);
  });

  it('delegates platform-filtered search queries', async () => {
    searchApi.searchGames.mockReturnValue(of([]));

    await firstValueFrom(service.searchGames('mario', 130));

    expect(searchApi.searchGames).toHaveBeenCalledWith('mario', 130);
  });

  it('delegates search platform list retrieval', async () => {
    searchApi.listPlatforms.mockReturnValue(of([{ id: 130, name: 'Nintendo Switch' }]));

    const result = await firstValueFrom(service.listSearchPlatforms());

    expect(searchApi.listPlatforms).toHaveBeenCalled();
    expect(result).toEqual([{ id: 130, name: 'Nintendo Switch' }]);
  });

  it('refreshes game metadata by IGDB id and keeps list placement', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Old Title',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb' as const,
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null,
      listType: 'wishlist' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const refreshedCatalog: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Updated Title',
      coverUrl: 'https://example.com/updated.jpg',
      coverSource: 'igdb' as const,
      developers: [],
      franchises: [],
      genres: [],
      publishers: [],
      platforms: ['Nintendo Switch', 'PC'],
      platform: null,
      platformIgdbId: null,
      releaseDate: '2026-01-02T00:00:00.000Z',
      releaseYear: 2026,
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      title: refreshedCatalog.title,
      coverUrl: existingEntry.coverUrl,
      coverSource: existingEntry.coverSource,
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: refreshedCatalog.releaseDate,
      releaseYear: refreshedCatalog.releaseYear,
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.getGameById.mockReturnValue(of(refreshedCatalog));
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameMetadata('123', 130);

    expect(searchApi.getGameById).toHaveBeenCalledWith('123');
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        igdbGameId: '123',
        title: 'Updated Title',
        coverUrl: 'https://example.com/current-cover.jpg',
        coverSource: 'thegamesdb',
        platform: 'Nintendo Switch',
        platformIgdbId: 130,
      }),
      'wishlist',
    );
    expect(result).toEqual(updatedEntry);
  });

  it('returns empty box art results for short queries', async () => {
    const results = await firstValueFrom(service.searchBoxArtByTitle('m'));
    expect(results).toEqual([]);
    expect(searchApi.searchBoxArtByTitle).not.toHaveBeenCalled();
  });

  it('delegates box art title search for valid query', async () => {
    searchApi.searchBoxArtByTitle.mockReturnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario'));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', undefined, undefined);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('delegates box art title search with platform for valid query', async () => {
    searchApi.searchBoxArtByTitle.mockReturnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch'));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', 'Nintendo Switch', undefined);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('delegates box art title search with IGDB platform id for valid query', async () => {
    searchApi.searchBoxArtByTitle.mockReturnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', 'Nintendo Switch', 130);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('updates game cover using dedicated repository method', async () => {
    const updatedEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Old Title',
      coverUrl: 'https://example.com/new-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    repository.updateCover.mockResolvedValue(updatedEntry);

    const result = await service.updateGameCover('123', 130, 'https://example.com/new-cover.jpg');

    expect(repository.updateCover).toHaveBeenCalledWith('123', 130, 'https://example.com/new-cover.jpg', 'thegamesdb');
    expect(result).toEqual(updatedEntry);
  });

  it('throws when adding a game with invalid identity or platform', async () => {
    const base: GameCatalogResult = {
      igdbGameId: '  ',
      title: 'Test',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null,
    };

    await expect(service.addGame(base, 'collection')).rejects.toThrowError('IGDB game id is required.');
    await expect(service.addGame({ ...base, igdbGameId: '123', platformIgdbId: null }, 'collection')).rejects.toThrowError('IGDB platform id is required.');
    await expect(service.addGame({ ...base, igdbGameId: '123', platform: ' ' }, 'collection')).rejects.toThrowError('Platform is required.');
  });

  it('throws when refreshing or updating a missing game', async () => {
    repository.exists.mockResolvedValue(undefined);
    repository.updateCover.mockResolvedValue(undefined);

    await expect(service.refreshGameMetadata('123', 130)).rejects.toThrowError('Game entry no longer exists.');
    await expect(service.updateGameCover('123', 130, 'https://example.com/new-cover.jpg')).rejects.toThrowError('Game entry no longer exists.');
  });

  it('normalizes identity in findGameByIdentity', async () => {
    const existing = { id: 1 } as GameEntry;
    repository.exists.mockResolvedValue(existing);
    const result = await service.findGameByIdentity(' 123 ', 130);
    expect(repository.exists).toHaveBeenCalledWith('123', 130);
    expect(result).toBe(existing);
  });

  it('sets tags/status/rating and attaches tag metadata', async () => {
    const base: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Game',
      coverUrl: null,
      coverSource: 'none',
      platform: 'Switch',
      platformIgdbId: 130,
      tagIds: [1, 2],
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    repository.setGameTags.mockResolvedValue(base);
    repository.setGameStatus.mockResolvedValue({ ...base, status: 'playing' });
    repository.setGameRating.mockResolvedValue({ ...base, rating: 3 });
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' },
      { id: 2, name: 'Co-op', color: '#222222', createdAt: 'x', updatedAt: 'x' },
    ]);

    const tagged = await service.setGameTags('123', 130, [1, 2]);
    const statused = await service.setGameStatus('123', 130, 'playing');
    const rated = await service.setGameRating('123', 130, 3);

    expect(tagged.tags?.map(tag => tag.name)).toEqual(['Backlog', 'Co-op']);
    expect(statused.status).toBe('playing');
    expect(rated.rating).toBe(3);
  });

  it('coerces invalid rating to null and throws for missing entries on set operations', async () => {
    repository.setGameRating.mockResolvedValue({
      id: 1,
      igdbGameId: '123',
      title: 'Game',
      coverUrl: null,
      coverSource: 'none',
      platform: 'Switch',
      platformIgdbId: 130,
      tagIds: [],
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: 'x',
      updatedAt: 'x',
      rating: null,
    } as GameEntry);
    repository.listTags.mockResolvedValue([]);
    await service.setGameRating('123', 130, 99 as never);
    expect(repository.setGameRating).toHaveBeenCalledWith('123', 130, null);

    repository.setGameTags.mockResolvedValue(undefined);
    repository.setGameStatus.mockResolvedValue(undefined);
    repository.setGameRating.mockResolvedValue(undefined);
    await expect(service.setGameTags('123', 130, [1])).rejects.toThrowError('Game entry no longer exists.');
    await expect(service.setGameStatus('123', 130, 'playing')).rejects.toThrowError('Game entry no longer exists.');
    await expect(service.setGameRating('123', 130, 4)).rejects.toThrowError('Game entry no longer exists.');
  });

  it('validates tag names and normalizes tag colors', async () => {
    repository.upsertTag.mockResolvedValue({
      id: 1,
      name: 'Backlog',
      color: '#3880ff',
      createdAt: 'x',
      updatedAt: 'x',
    });

    await expect(service.createTag(' ', '#ffffff')).rejects.toThrowError('Tag name is required.');
    await expect(service.updateTag(1, ' ', '#ffffff')).rejects.toThrowError('Tag name is required.');

    const created = await service.createTag(' Backlog ', 'oops');
    const updated = await service.updateTag(1, ' Backlog ', '#00ff00');

    expect(repository.upsertTag).toHaveBeenCalledWith({ name: 'Backlog', color: '#3880ff' });
    expect(repository.upsertTag).toHaveBeenCalledWith({ id: 1, name: 'Backlog', color: '#00ff00' });
    expect(created.id).toBe(1);
    expect(updated.id).toBe(1);
  });

  it('supports list/get/delete tags and watch streams', async () => {
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' },
    ]);
    repository.listByType.mockResolvedValue([
      {
        id: 10,
        igdbGameId: '123',
        title: 'Game',
        coverUrl: null,
        coverSource: 'none',
        platform: 'Switch',
        platformIgdbId: 130,
        tagIds: [1],
        releaseDate: null,
        releaseYear: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x',
      },
    ]);
    repository.listAll.mockResolvedValue([
      {
        id: 10,
        igdbGameId: '123',
        title: 'Game',
        coverUrl: null,
        coverSource: 'none',
        platform: 'Switch',
        platformIgdbId: 130,
        tagIds: [1],
        releaseDate: null,
        releaseYear: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x',
      },
    ]);

    expect(await service.listTags()).toHaveLength(1);
    const list = await firstValueFrom(service.watchList('collection'));
    const summaries = await firstValueFrom(service.watchTags());
    expect(list[0].tags?.[0].name).toBe('Backlog');
    expect(summaries[0].gameCount).toBe(1);

    await service.deleteTag(1);
    expect(repository.deleteTag).toHaveBeenCalledWith(1);
  });

  it('creates/updates/deletes views and validates missing updates', async () => {
    repository.createView.mockResolvedValue({
      id: 11,
      name: 'My View',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'x',
    });
    repository.updateView.mockResolvedValueOnce({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'y',
    });
    repository.updateView.mockResolvedValueOnce({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'platform',
      createdAt: 'x',
      updatedAt: 'z',
    });
    repository.getView.mockResolvedValue({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'z',
    } as GameListView);
    repository.listViews.mockResolvedValue([
      {
        id: 11,
        name: 'Renamed',
        listType: 'collection',
        filters: DEFAULT_GAME_LIST_FILTERS,
        groupBy: 'none',
        createdAt: 'x',
        updatedAt: 'z',
      },
    ] as GameListView[]);

    await service.createView(' My View ', 'collection', DEFAULT_GAME_LIST_FILTERS, 'none');
    await service.renameView(11, ' Renamed ');
    await service.updateViewConfiguration(11, DEFAULT_GAME_LIST_FILTERS, 'platform');
    await service.deleteView(11);
    await service.getView(11);
    await firstValueFrom(service.watchViews('collection'));

    expect(repository.createView).toHaveBeenCalledWith({
      name: 'My View',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
    });
    expect(repository.deleteView).toHaveBeenCalledWith(11);

    repository.updateView.mockResolvedValue(undefined);
    await expect(service.renameView(11, 'x')).rejects.toThrowError('View no longer exists.');
    await expect(service.updateViewConfiguration(11, DEFAULT_GAME_LIST_FILTERS, 'none')).rejects.toThrowError('View no longer exists.');
  });
});
