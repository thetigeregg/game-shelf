import { firstValueFrom, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { DEFAULT_GAME_LIST_FILTERS, GameCatalogResult, GameEntry } from '../models/game.models';
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
});
