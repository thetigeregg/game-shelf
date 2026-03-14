import { firstValueFrom, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { AppDb } from '../data/app-db';
import {
  DEFAULT_GAME_LIST_FILTERS,
  GameCatalogResult,
  GameEntry,
  GameListView
} from '../models/game.models';
import { GameShelfService } from './game-shelf.service';
import { PlatformOrderService } from './platform-order.service';
import { ClientWriteAuthService } from './client-write-auth.service';

describe('GameShelfService', () => {
  let repository: {
    [K in keyof GameRepository]: ReturnType<typeof vi.fn>;
  };
  let searchApi: {
    [K in keyof GameSearchApi]: ReturnType<typeof vi.fn>;
  };
  let appDb: {
    imageCache: {
      where: ReturnType<typeof vi.fn>;
    };
  };
  let service: GameShelfService;
  const migrationStorageKey = 'game-shelf:igdb-cover-migration:v2';

  beforeEach(() => {
    localStorage.removeItem(migrationStorageKey);
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
      setGameNotes: vi.fn(),
      setGameCustomCover: vi.fn(),
      setGameCustomMetadata: vi.fn(),
      listTags: vi.fn(),
      upsertTag: vi.fn(),
      deleteTag: vi.fn(),
      listViews: vi.fn(),
      getView: vi.fn(),
      createView: vi.fn(),
      updateView: vi.fn(),
      deleteView: vi.fn()
    };

    searchApi = {
      searchGames: vi.fn(),
      getGameById: vi.fn(),
      listPlatforms: vi.fn(),
      searchBoxArtByTitle: vi.fn(),
      lookupCompletionTimes: vi.fn(),
      lookupCompletionTimeCandidates: vi.fn(),
      lookupMetacriticScore: vi.fn(),
      lookupMetacriticCandidates: vi.fn(),
      lookupReviewScore: vi.fn(),
      lookupReviewCandidates: vi.fn(),
      lookupSteamPrice: vi.fn(),
      lookupPsPrices: vi.fn(),
      lookupPsPricesCandidates: vi.fn(),
      listPopularityTypes: vi.fn(),
      listPopularityGames: vi.fn()
    };

    searchApi.lookupCompletionTimes.mockReturnValue(of(null));
    searchApi.lookupReviewScore.mockReturnValue(of(null));
    searchApi.lookupReviewCandidates.mockReturnValue(of([]));

    appDb = {
      imageCache: {
        where: vi.fn().mockReturnValue({
          equals: vi.fn().mockReturnValue({
            delete: vi.fn().mockResolvedValue(undefined)
          })
        })
      }
    };

    TestBed.configureTestingModule({
      providers: [
        GameShelfService,
        { provide: GAME_REPOSITORY, useValue: repository },
        { provide: GAME_SEARCH_API, useValue: searchApi },
        { provide: AppDb, useValue: appDb }
      ]
    });

    service = TestBed.inject(GameShelfService);
  });

  afterEach(() => {
    localStorage.removeItem(migrationStorageKey);
    vi.restoreAllMocks();
  });

  it('returns empty search results for short queries and does not call API', async () => {
    const results = await firstValueFrom(service.searchGames('m'));

    expect(results).toEqual([]);
    expect(searchApi.searchGames).not.toHaveBeenCalled();
  });

  it('propagates API errors for valid search queries', async () => {
    searchApi.searchGames.mockReturnValue(throwError(() => new Error('API unavailable')));

    await expect(firstValueFrom(service.searchGames('mario'))).rejects.toThrow('API unavailable');
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
      releaseYear: 2017
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      platform: 'Switch',
      platformIgdbId: 130,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
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

  it('does not trigger pricing refresh in background for collection add', async () => {
    const mario: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Counter-Strike',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['PC'],
      platform: 'PC',
      platformIgdbId: 6,
      steamAppId: 12345,
      releaseDate: '2012-08-21T00:00:00.000Z',
      releaseYear: 2012
    };

    const lookupSteamPrice = vi.fn(() => of({ status: 'unsupported_platform' }));
    (
      searchApi as unknown as {
        lookupSteamPrice: ReturnType<typeof vi.fn>;
      }
    ).lookupSteamPrice = lookupSteamPrice;

    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      platform: 'PC',
      platformIgdbId: 6,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    repository.exists.mockResolvedValue({
      ...mario,
      platform: 'PC',
      platformIgdbId: 6,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    await service.addGame(mario, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lookupSteamPrice).not.toHaveBeenCalled();
  });

  it('triggers Steam pricing refresh in background after wishlist add', async () => {
    const mario: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Counter-Strike',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['PC'],
      platform: 'PC',
      platformIgdbId: 6,
      steamAppId: 12345,
      releaseDate: '2012-08-21T00:00:00.000Z',
      releaseYear: 2012
    };

    const lookupSteamPrice = vi.fn(() => of({ status: 'unsupported_platform' }));
    (
      searchApi as unknown as {
        lookupSteamPrice: ReturnType<typeof vi.fn>;
      }
    ).lookupSteamPrice = lookupSteamPrice;

    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      platform: 'PC',
      platformIgdbId: 6,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    repository.exists.mockResolvedValue({
      ...mario,
      platform: 'PC',
      platformIgdbId: 6,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    await service.addGame(mario, 'wishlist');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lookupSteamPrice).toHaveBeenCalledWith('123', 6);
  });

  it('triggers PSPrices refresh in background after add for supported platforms', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '456',
      title: 'Pokemon Violet',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Nintendo Switch'],
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: '2022-11-18T00:00:00.000Z',
      releaseYear: 2022
    };

    const lookupPsPrices = vi.fn(() => of({ status: 'ok' }));
    (
      searchApi as unknown as {
        lookupPsPrices: ReturnType<typeof vi.fn>;
      }
    ).lookupPsPrices = lookupPsPrices;

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    repository.exists.mockResolvedValue({
      ...game,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    await service.addGame(game, 'wishlist');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(lookupPsPrices).toHaveBeenCalledWith('456', 130);
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
      releaseYear: 2017
    };

    searchApi.lookupCompletionTimes.mockReturnValue(
      of({
        hltbMainHours: 12,
        hltbMainExtraHours: 18.5,
        hltbCompletionistHours: 30
      })
    );
    repository.upsertFromCatalog.mockResolvedValue({
      ...mario,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(mario, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalledWith('Mario Kart', 2017, 'Switch');
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(2);
    expect(repository.upsertFromCatalog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        igdbGameId: '123',
        platform: 'Switch',
        platformIgdbId: 130
      }),
      'collection'
    );
    expect(repository.upsertFromCatalog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        hltbMainHours: 12,
        hltbMainExtraHours: 18.5,
        hltbCompletionistHours: 30
      }),
      'collection'
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
      releaseYear: 2017
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');

    expect(searchApi.lookupCompletionTimes).not.toHaveBeenCalled();
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ hltbMainHours: 12.34 }),
      'collection'
    );
  });

  it('skips review score lookup when game already has a valid review score', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '500',
      title: 'Already Scored',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      reviewScore: 85,
      reviewUrl: 'https://www.metacritic.com/game/already-scored/',
      reviewSource: 'metacritic',
      releaseDate: null,
      releaseYear: 2022
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupReviewScore).not.toHaveBeenCalled();
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(1);
  });

  it('triggers review score lookup when review score is out of valid range', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '501',
      title: 'Out Of Range Score',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      reviewScore: 150,
      releaseDate: null,
      releaseYear: 2022
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith(
      'Out Of Range Score',
      2022,
      'Switch',
      130
    );
  });

  it('enriches games with review score during add when available', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017
    };

    searchApi.lookupReviewScore.mockReturnValue(
      of({
        reviewScore: 85,
        reviewUrl: 'https://www.metacritic.com/game/mario-kart-8-deluxe/',
        reviewSource: 'metacritic'
      })
    );
    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith('Mario Kart', 2017, 'Switch', 130);
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(2);
    expect(repository.upsertFromCatalog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        reviewScore: 85,
        reviewUrl: 'https://www.metacritic.com/game/mario-kart-8-deluxe/',
        reviewSource: 'metacritic',
        metacriticScore: 85,
        metacriticUrl: 'https://www.metacritic.com/game/mario-kart-8-deluxe/'
      }),
      'collection'
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
      releaseYear: 2017
    };

    searchApi.lookupCompletionTimes.mockReturnValue(throwError(() => new Error('HLTB down')));
    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalled();
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(1);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ igdbGameId: '123', platform: 'Switch', platformIgdbId: 130 }),
      'collection'
    );
  });

  it('continues add when review lookup fails', async () => {
    const game: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017
    };

    searchApi.lookupReviewScore.mockReturnValue(throwError(() => new Error('reviews down')));
    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    } as GameEntry);

    await service.addGame(game, 'collection');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith('Mario Kart', 2017, 'Switch', 130);
    expect(repository.upsertFromCatalog).toHaveBeenCalledTimes(1);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ igdbGameId: '123', platform: 'Switch', platformIgdbId: 130 }),
      'collection'
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
      releaseYear: null
    };

    repository.upsertFromCatalog.mockResolvedValue({
      ...game,
      listType: 'collection',
      platform: 'Switch',
      platformIgdbId: 130,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
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
      }
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

  it('uses IGDB direct lookup when query is in igdb:<id> format', async () => {
    const expected: GameCatalogResult = {
      igdbGameId: '4512',
      title: 'Einhänder',
      coverUrl: null,
      coverSource: 'none',
      developers: [],
      franchises: [],
      genres: [],
      publishers: [],
      platforms: ['PlayStation'],
      platform: 'PlayStation',
      platformIgdbId: 7,
      releaseDate: null,
      releaseYear: null
    };
    searchApi.getGameById.mockReturnValue(of(expected));

    const result = await firstValueFrom(service.searchGames('igdb:4512', 130));

    expect(searchApi.getGameById).toHaveBeenCalledWith('4512');
    expect(searchApi.searchGames).not.toHaveBeenCalled();
    expect(result).toEqual([expected]);
  });

  it('supports case-insensitive and spaced igdb:<id> direct lookup queries', async () => {
    const expected: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Test Game',
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
    };
    searchApi.getGameById.mockReturnValue(of(expected));

    const result = await firstValueFrom(service.searchGames('  IGDB:   123   '));

    expect(searchApi.getGameById).toHaveBeenCalledWith('123');
    expect(searchApi.searchGames).not.toHaveBeenCalled();
    expect(result).toEqual([expected]);
  });

  it('skips preferred-platform cover migration when already completed', async () => {
    localStorage.setItem(migrationStorageKey, '1');

    await service.migratePreferredPlatformCoversToIgdb();

    expect(repository.listAll).not.toHaveBeenCalled();
  });

  it('marks preferred-platform cover migration complete when no candidates exist', async () => {
    repository.listAll.mockResolvedValue([
      {
        igdbGameId: '1',
        title: 'Switch Game',
        platformIgdbId: 130,
        platform: 'Nintendo Switch',
        coverUrl: 'https://cdn.thegamesdb.net/images/original/box/front/switch.jpg',
        coverSource: 'thegamesdb',
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      } as GameEntry
    ]);

    await service.migratePreferredPlatformCoversToIgdb();

    expect(localStorage.getItem(migrationStorageKey)).toBe('1');
    expect(repository.updateCover).not.toHaveBeenCalled();
  });

  it('migrates PS5/Switch2 TheGamesDB covers to IGDB and purges caches', async () => {
    repository.listAll.mockResolvedValue([
      {
        igdbGameId: '4512',
        title: 'Example',
        platformIgdbId: 167,
        platform: 'PlayStation 5',
        coverUrl: 'https://cdn.thegamesdb.net/images/original/box/front/example.jpg',
        coverSource: 'thegamesdb',
        customCoverUrl: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      } as GameEntry
    ]);
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '4512',
        title: 'Example',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/example.jpg',
        coverSource: 'igdb',
        platform: 'PlayStation 5',
        platformIgdbId: 167,
        platforms: ['PlayStation 5'],
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );
    repository.updateCover.mockResolvedValue({
      igdbGameId: '4512',
      title: 'Example',
      platformIgdbId: 167,
      platform: 'PlayStation 5',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/example.jpg',
      coverSource: 'igdb',
      listType: 'collection',
      createdAt: 'x',
      updatedAt: 'x'
    } as GameEntry);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await service.migratePreferredPlatformCoversToIgdb();

    expect(appDb.imageCache.where).toHaveBeenCalledWith('gameKey');
    expect(repository.updateCover).toHaveBeenCalledWith(
      '4512',
      167,
      'https://images.igdb.com/igdb/image/upload/t_cover_big/example.jpg',
      'igdb'
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(localStorage.getItem(migrationStorageKey)).toBe('1');
  });

  it('continues preferred-platform cover migration when per-game refresh fails', async () => {
    repository.listAll.mockResolvedValue([
      {
        igdbGameId: '4512',
        title: 'Example',
        platformIgdbId: 508,
        platform: 'Nintendo Switch 2',
        coverUrl: 'https://cdn.thegamesdb.net/images/original/box/front/example2.jpg',
        coverSource: 'thegamesdb',
        customCoverUrl: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      } as GameEntry
    ]);
    searchApi.getGameById.mockReturnValue(throwError(() => new Error('IGDB unavailable')));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await service.migratePreferredPlatformCoversToIgdb();

    expect(repository.updateCover).not.toHaveBeenCalled();
    expect(localStorage.getItem(migrationStorageKey)).toBe('1');
  });

  it('skips server purge request when migration candidates do not have valid TheGamesDB URLs', async () => {
    repository.listAll.mockResolvedValue([
      {
        igdbGameId: '4512',
        title: 'Example',
        platformIgdbId: 167,
        platform: 'PlayStation 5',
        coverUrl: 'not-a-url',
        coverSource: 'thegamesdb',
        customCoverUrl: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      } as GameEntry
    ]);
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '4512',
        title: 'Example',
        coverUrl: null,
        coverSource: 'none',
        platforms: ['PlayStation 5'],
        platform: 'PlayStation 5',
        platformIgdbId: 167,
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));

    await service.migratePreferredPlatformCoversToIgdb();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('continues migration when localStorage read throws', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    repository.listAll.mockResolvedValue([]);

    await service.migratePreferredPlatformCoversToIgdb();

    expect(getItemSpy).toHaveBeenCalled();
  });

  it('includes client write token in server purge request when token is configured', async () => {
    const clientWriteAuthService = TestBed.inject(ClientWriteAuthService);
    vi.spyOn(clientWriteAuthService, 'getToken').mockReturnValue('test-write-token');

    repository.listAll.mockResolvedValue([
      {
        igdbGameId: '9999',
        title: 'Token Test',
        platformIgdbId: 167,
        platform: 'PlayStation 5',
        coverUrl: 'https://cdn.thegamesdb.net/images/original/box/front/token-test.jpg',
        coverSource: 'thegamesdb',
        customCoverUrl: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      } as GameEntry
    ]);
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '9999',
        title: 'Token Test',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/token-test.jpg',
        coverSource: 'igdb',
        platform: 'PlayStation 5',
        platformIgdbId: 167,
        platforms: ['PlayStation 5'],
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );
    repository.updateCover.mockResolvedValue({
      igdbGameId: '9999',
      title: 'Token Test',
      platformIgdbId: 167,
      platform: 'PlayStation 5',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/token-test.jpg',
      coverSource: 'igdb',
      listType: 'collection',
      createdAt: 'x',
      updatedAt: 'x'
    } as GameEntry);

    let capturedHeaders: HeadersInit | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      capturedHeaders = init?.headers;
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    await service.migratePreferredPlatformCoversToIgdb();

    expect(capturedHeaders).toBeDefined();
    const headersRecord = capturedHeaders as Record<string, string>;
    expect(headersRecord['X-Game-Shelf-Client-Token']).toBe('test-write-token');
  });

  it('delegates search platform list retrieval', async () => {
    const platformOrderService = TestBed.inject(PlatformOrderService);
    platformOrderService.setOrder(['Nintendo Switch', 'PC (Microsoft Windows)']);
    searchApi.listPlatforms.mockReturnValue(
      of([
        { id: 6, name: 'PC (Microsoft Windows)' },
        { id: 130, name: 'Nintendo Switch' }
      ])
    );

    const result = await firstValueFrom(service.listSearchPlatforms());

    expect(searchApi.listPlatforms).toHaveBeenCalled();
    expect(result).toEqual([
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' }
    ]);
  });

  it('delegates HLTB candidate search and short-circuits short titles', async () => {
    searchApi.lookupCompletionTimeCandidates.mockReturnValue(
      of([
        {
          title: 'Super Metroid',
          releaseYear: 1994,
          platform: 'SNES',
          hltbMainHours: 7.5,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13
        }
      ])
    );

    const results = await firstValueFrom(
      service.searchHltbCandidates('Super Metroid', 1994, 'SNES')
    );
    const empty = await firstValueFrom(service.searchHltbCandidates('x', 1994, 'SNES'));

    expect(searchApi.lookupCompletionTimeCandidates).toHaveBeenCalledWith(
      'Super Metroid',
      1994,
      'SNES'
    );
    expect(results).toHaveLength(1);
    expect(empty).toEqual([]);
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
      updatedAt: '2026-01-01T00:00:00.000Z'
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
      releaseYear: 2026
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      title: refreshedCatalog.title,
      coverUrl: existingEntry.coverUrl,
      coverSource: existingEntry.coverSource,
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: refreshedCatalog.releaseDate,
      releaseYear: refreshedCatalog.releaseYear
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
        platformIgdbId: 130
      }),
      'wishlist'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('refreshes game completion times using HLTB lookup values', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Zack & Wiki',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Wii',
      platformIgdbId: 5,
      releaseDate: '2007-10-16T00:00:00.000Z',
      releaseYear: 2007,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      hltbMainHours: 14,
      hltbMainExtraHours: 18,
      hltbCompletionistHours: 24
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(
      of({
        hltbMainHours: 14,
        hltbMainExtraHours: 18,
        hltbCompletionistHours: 24
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameCompletionTimes('123', 5);

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii');
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        igdbGameId: '123',
        title: 'Zack & Wiki',
        coverUrl: 'https://example.com/current-cover.jpg',
        coverSource: 'thegamesdb',
        hltbMainHours: 14,
        hltbMainExtraHours: 18,
        hltbCompletionistHours: 24,
        platform: 'Wii',
        platformIgdbId: 5
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('refreshGameCompletionTimes prefers persisted HLTB match query fields when present', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Wrong Name',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'PlayStation 5',
      platformIgdbId: 167,
      releaseDate: null,
      releaseYear: null,
      hltbMatchQueryTitle: 'Zack & Wiki',
      hltbMatchQueryReleaseYear: 2007,
      hltbMatchQueryPlatform: 'Wii',
      hltbMatchLocked: true,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      hltbMainHours: 14,
      hltbMainExtraHours: 18,
      hltbCompletionistHours: 24
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(
      of({
        hltbMainHours: 14,
        hltbMainExtraHours: 18,
        hltbCompletionistHours: 24
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameCompletionTimes('123', 167);

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii');
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        hltbMatchQueryTitle: 'Zack & Wiki',
        hltbMatchQueryReleaseYear: 2007,
        hltbMatchQueryPlatform: 'Wii',
        hltbMatchLocked: true
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('refreshes game completion times using override query values', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Wrong Name',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Wii',
      platformIgdbId: 5,
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      hltbMainHours: 21,
      hltbMainExtraHours: 35,
      hltbCompletionistHours: 48
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(
      of({
        hltbMainHours: 21,
        hltbMainExtraHours: 35,
        hltbCompletionistHours: 48
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameCompletionTimesWithQuery('123', 5, {
      title: 'Zack & Wiki',
      releaseYear: 2007,
      platform: 'Wii'
    });

    expect(searchApi.lookupCompletionTimes).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii');
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        hltbMatchQueryTitle: 'Zack & Wiki',
        hltbMatchQueryReleaseYear: 2007,
        hltbMatchQueryPlatform: 'Wii',
        hltbMatchLocked: true
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('clears HLTB fields when completion times lookup returns no result', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Zack & Wiki',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      hltbMainHours: 14,
      hltbMainExtraHours: 18,
      hltbCompletionistHours: 24,
      platform: 'Wii',
      platformIgdbId: 5,
      releaseDate: '2007-10-16T00:00:00.000Z',
      releaseYear: 2007,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    await service.refreshGameCompletionTimes('123', 5);

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      }),
      'collection'
    );
  });

  it('refreshes game Metacritic score using lookup values', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Zack & Wiki',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Wii',
      platformIgdbId: 5,
      reviewMatchMobygamesGameId: 777,
      releaseDate: '2007-10-16T00:00:00.000Z',
      releaseYear: 2007,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/zack-and-wiki/'
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupReviewScore.mockReturnValue(
      of({
        reviewScore: 87,
        reviewUrl: 'https://www.metacritic.com/game/zack-and-wiki/',
        reviewSource: 'metacritic'
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameMetacriticScore('123', 5);

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii', 5, 777);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/zack-and-wiki/'
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('refreshGameReviewScore prefers persisted review match query fields when present', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Wrong Name',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'PlayStation 5',
      platformIgdbId: 167,
      reviewMatchQueryTitle: 'Zack & Wiki',
      reviewMatchQueryReleaseYear: 2007,
      reviewMatchQueryPlatform: 'Wii',
      reviewMatchPlatformIgdbId: 5,
      reviewMatchMobygamesGameId: 777,
      reviewMatchLocked: true,
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/zack-and-wiki/'
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupReviewScore.mockReturnValue(
      of({
        reviewScore: 87,
        reviewUrl: 'https://www.metacritic.com/game/zack-and-wiki/',
        reviewSource: 'metacritic'
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameReviewScore('123', 167);

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii', 5, 777);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewMatchQueryTitle: 'Zack & Wiki',
        reviewMatchQueryReleaseYear: 2007,
        reviewMatchQueryPlatform: 'Wii',
        reviewMatchPlatformIgdbId: 5,
        reviewMatchMobygamesGameId: 777,
        reviewMatchLocked: true
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('refreshes game Metacritic score using override query values', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Wrong Name',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Wii',
      platformIgdbId: 5,
      reviewMatchMobygamesGameId: 777,
      mobygamesGameId: 222,
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const updatedEntry: GameEntry = {
      ...existingEntry,
      metacriticScore: 90,
      metacriticUrl: 'https://www.metacritic.com/game/zack-and-wiki/'
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.lookupReviewScore.mockReturnValue(
      of({
        reviewScore: 90,
        reviewUrl: 'https://www.metacritic.com/game/zack-and-wiki/',
        reviewSource: 'metacritic'
      })
    );
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);

    const result = await service.refreshGameMetacriticScoreWithQuery('123', 5, {
      title: 'Zack & Wiki',
      releaseYear: 2007,
      platform: 'Wii'
    });

    expect(searchApi.lookupReviewScore).toHaveBeenCalledWith('Zack & Wiki', 2007, 'Wii', 5, 777);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewMatchQueryTitle: 'Zack & Wiki',
        reviewMatchQueryReleaseYear: 2007,
        reviewMatchQueryPlatform: 'Wii',
        reviewMatchPlatformIgdbId: 5,
        reviewMatchMobygamesGameId: 777,
        reviewMatchLocked: true
      }),
      'collection'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('returns empty metacritic candidates for short queries and trims valid queries', async () => {
    await expect(firstValueFrom(service.searchMetacriticCandidates('x'))).resolves.toEqual([]);
    expect(searchApi.lookupReviewCandidates).not.toHaveBeenCalled();

    searchApi.lookupReviewCandidates.mockReturnValue(of([]));
    await firstValueFrom(service.searchMetacriticCandidates('  Okami  ', 2006, 'Wii', 19));
    expect(searchApi.lookupReviewCandidates).toHaveBeenCalledWith('Okami', 2006, 'Wii', 19);
  });

  it('throws for metacritic refresh when target game no longer exists', async () => {
    repository.exists.mockResolvedValue(undefined);

    await expect(service.refreshGameMetacriticScore('123', 5)).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(
      service.refreshGameMetacriticScoreWithQuery('123', 5, { title: 'Any' })
    ).rejects.toThrow('Game entry no longer exists.');
  });

  it('refreshes unified pricing using Steam lookup for Windows wishlist games', async () => {
    const existingEntry: GameEntry = {
      igdbGameId: '960',
      title: 'GTA IV',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      platformIgdbId: 6,
      steamAppId: 204100,
      releaseDate: null,
      releaseYear: 2008,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const updatedEntry: GameEntry = {
      ...existingEntry,
      priceSource: 'steam_store',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      priceRegularAmount: 39.99,
      priceDiscountPercent: 50,
      priceIsFree: false,
      priceUrl: 'https://store.steampowered.com/app/204100',
      priceFetchedAt: '2026-03-10T11:00:00.000Z'
    };
    repository.exists.mockResolvedValue(existingEntry);
    repository.upsertFromCatalog.mockResolvedValue(updatedEntry);
    const lookupSteamPrice = vi.fn(() =>
      of({
        status: 'ok',
        bestPrice: {
          amount: 19.99,
          currency: 'CHF',
          initialAmount: 39.99,
          discountPercent: 50,
          isFree: false,
          url: 'https://store.steampowered.com/app/204100'
        }
      })
    );
    (
      searchApi as unknown as {
        lookupSteamPrice: ReturnType<typeof vi.fn>;
      }
    ).lookupSteamPrice = lookupSteamPrice;

    const result = await service.refreshGamePricing('960', 6);

    expect(lookupSteamPrice).toHaveBeenCalledWith('960', 6);
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        priceSource: 'steam_store',
        priceAmount: 19.99,
        priceCurrency: 'CHF',
        priceRegularAmount: 39.99,
        priceDiscountPercent: 50,
        priceIsFree: false
      }),
      'wishlist'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('clears unified pricing for unsupported platforms when refreshed on wishlist', async () => {
    const existingEntry: GameEntry = {
      igdbGameId: '77',
      title: 'Unsupported Platform',
      coverUrl: null,
      coverSource: 'none',
      platform: 'Sega Saturn',
      platformIgdbId: 32,
      priceSource: 'steam_store',
      priceAmount: 5,
      priceCurrency: 'CHF',
      releaseDate: null,
      releaseYear: 1995,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    repository.exists.mockResolvedValue(existingEntry);
    repository.upsertFromCatalog.mockResolvedValue({
      ...existingEntry,
      priceSource: null,
      priceAmount: null,
      priceCurrency: null,
      priceRegularAmount: null,
      priceDiscountPercent: null,
      priceIsFree: null,
      priceUrl: null
    } as GameEntry);

    await service.refreshGamePricing('77', 32);

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        priceSource: null,
        priceAmount: null,
        priceCurrency: null
      }),
      'wishlist'
    );
  });

  it('preserves existing unified pricing when supported lookup returns unavailable on wishlist', async () => {
    const existingEntry: GameEntry = {
      igdbGameId: '960',
      title: 'GTA IV',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      platformIgdbId: 6,
      steamAppId: 204100,
      priceSource: 'steam_store',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      priceRegularAmount: 39.99,
      priceDiscountPercent: 50,
      priceIsFree: false,
      priceUrl: 'https://store.steampowered.com/app/204100',
      priceFetchedAt: '2026-03-10T11:00:00.000Z',
      releaseDate: null,
      releaseYear: 2008,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    repository.exists.mockResolvedValue(existingEntry);
    repository.upsertFromCatalog.mockResolvedValue(existingEntry);
    const lookupSteamPrice = vi.fn(() =>
      of({
        status: 'unavailable',
        bestPrice: null
      })
    );
    (
      searchApi as unknown as {
        lookupSteamPrice: ReturnType<typeof vi.fn>;
      }
    ).lookupSteamPrice = lookupSteamPrice;

    await service.refreshGamePricing('960', 6);

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        priceSource: 'steam_store',
        priceAmount: 19.99,
        priceCurrency: 'CHF',
        priceRegularAmount: 39.99,
        priceDiscountPercent: 50,
        priceIsFree: false
      }),
      'wishlist'
    );
  });

  it('skips pricing refresh for non-wishlist games', async () => {
    const existingEntry: GameEntry = {
      igdbGameId: '960',
      title: 'GTA IV',
      coverUrl: null,
      coverSource: 'none',
      platform: 'PC',
      platformIgdbId: 6,
      steamAppId: 204100,
      priceSource: 'steam_store',
      priceAmount: 19.99,
      priceCurrency: 'CHF',
      releaseDate: null,
      releaseYear: 2008,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    repository.exists.mockResolvedValue(existingEntry);
    const lookupSteamPrice = vi.fn();
    (
      searchApi as unknown as {
        lookupSteamPrice: ReturnType<typeof vi.fn>;
      }
    ).lookupSteamPrice = lookupSteamPrice;

    const result = await service.refreshGamePricing('960', 6);

    expect(result).toEqual(existingEntry);
    expect(lookupSteamPrice).not.toHaveBeenCalled();
    expect(repository.upsertFromCatalog).not.toHaveBeenCalled();
  });

  it('covers pricing candidate search guards and candidate normalization branches', async () => {
    await expect(firstValueFrom(service.searchPricingCandidates('100', 167, 'x'))).resolves.toEqual(
      []
    );
    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 29, 'Valid Title'))
    ).resolves.toEqual([]);

    const originalLookup = searchApi.lookupPsPricesCandidates;
    (
      searchApi as unknown as {
        lookupPsPricesCandidates?: unknown;
      }
    ).lookupPsPricesCandidates = undefined;
    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, 'Valid Title'))
    ).resolves.toEqual([]);
    searchApi.lookupPsPricesCandidates = originalLookup;

    searchApi.lookupPsPricesCandidates.mockReturnValueOnce(
      of({
        bestPrice: {
          title: 'Candidate A',
          url: '//psprices.com/region-ch/game/123'
        },
        candidates: [
          {
            title: '  Candidate A  ',
            amount: 39.9,
            currency: 'chf',
            regularAmount: 79.9,
            discountPercent: 50.127,
            isFree: false,
            url: '//psprices.com/region-ch/game/123',
            score: 88.888,
            imageUrl: '//cdn.psprices.com/candidate-a.jpg'
          },
          {
            title: '   ',
            amount: 10
          },
          {
            title: 'Candidate B',
            amount: 'invalid',
            currency: 'bad',
            regularAmount: -1,
            discountPercent: 999,
            isFree: 'true',
            url: 'notaurl',
            score: Number.NaN
          }
        ]
      })
    );

    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, '  Valid Title  '))
    ).resolves.toEqual([
      {
        title: 'Candidate A',
        amount: 39.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 50.13,
        isFree: false,
        url: 'https://psprices.com/region-ch/game/123',
        score: 88.89,
        isRecommended: true,
        imageUrl: 'https://cdn.psprices.com/candidate-a.jpg'
      },
      {
        title: 'Candidate B',
        amount: null,
        currency: 'BAD',
        regularAmount: null,
        discountPercent: null,
        isFree: null,
        url: null,
        score: null,
        isRecommended: false
      }
    ]);
    expect(searchApi.lookupPsPricesCandidates).toHaveBeenCalledWith('100', 167, 'Valid Title');
  });

  it('marks recommended pricing candidate by title fallback when bestPrice url is unavailable', async () => {
    searchApi.lookupPsPricesCandidates.mockReturnValueOnce(
      of({
        bestPrice: {
          title: 'Candidate B',
          url: null
        },
        candidates: [
          {
            title: 'Candidate A',
            amount: 39.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 50,
            isFree: false,
            url: 'https://psprices.com/region-ch/game/123',
            score: 88
          },
          {
            title: '  Candidate B  ',
            amount: 49.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 37.5,
            isFree: false,
            url: null,
            score: 95
          }
        ]
      })
    );

    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, 'Valid Title'))
    ).resolves.toEqual([
      {
        title: 'Candidate A',
        amount: 39.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 50,
        isFree: false,
        url: 'https://psprices.com/region-ch/game/123',
        score: 88,
        isRecommended: false
      },
      {
        title: 'Candidate B',
        amount: 49.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 37.5,
        isFree: false,
        url: null,
        score: 95,
        isRecommended: true
      }
    ]);
  });

  it('marks only one pricing candidate recommended when bestPrice url is missing and multiple candidate urls normalize to null', async () => {
    searchApi.lookupPsPricesCandidates.mockReturnValueOnce(
      of({
        bestPrice: {
          title: 'Candidate B',
          url: null
        },
        candidates: [
          {
            title: 'Candidate A',
            amount: 39.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 50,
            isFree: false,
            url: null,
            score: 88
          },
          {
            title: 'Candidate B',
            amount: 49.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 37.5,
            isFree: false,
            url: null,
            score: 95
          },
          {
            title: 'Candidate C',
            amount: 59.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 25,
            isFree: false,
            url: null,
            score: 90
          }
        ]
      })
    );

    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, 'Valid Title'))
    ).resolves.toEqual([
      {
        title: 'Candidate A',
        amount: 39.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 50,
        isFree: false,
        url: null,
        score: 88,
        isRecommended: false
      },
      {
        title: 'Candidate B',
        amount: 49.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 37.5,
        isFree: false,
        url: null,
        score: 95,
        isRecommended: true
      },
      {
        title: 'Candidate C',
        amount: 59.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 25,
        isFree: false,
        url: null,
        score: 90,
        isRecommended: false
      }
    ]);
  });

  it('returns no pricing candidates when psprices returns an empty candidate list', async () => {
    searchApi.lookupPsPricesCandidates.mockReturnValueOnce(
      of({
        bestPrice: {
          title: 'Candidate A',
          url: 'https://psprices.com/region-ch/game/123'
        },
        candidates: []
      })
    );

    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, 'Valid Title'))
    ).resolves.toEqual([]);
  });

  it('falls back to the first pricing candidate when bestPrice does not match any normalized candidate', async () => {
    searchApi.lookupPsPricesCandidates.mockReturnValueOnce(
      of({
        bestPrice: {
          title: 'Missing Candidate',
          url: 'https://psprices.com/region-ch/game/999'
        },
        candidates: [
          {
            title: 'Candidate A',
            amount: 39.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 50,
            isFree: false,
            url: 'https://psprices.com/region-ch/game/123',
            score: 88
          },
          {
            title: 'Candidate B',
            amount: 49.9,
            currency: 'CHF',
            regularAmount: 79.9,
            discountPercent: 37.5,
            isFree: false,
            url: 'https://psprices.com/region-ch/game/456',
            score: 95
          }
        ]
      })
    );

    await expect(
      firstValueFrom(service.searchPricingCandidates('100', 167, 'Valid Title'))
    ).resolves.toEqual([
      {
        title: 'Candidate A',
        amount: 39.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 50,
        isFree: false,
        url: 'https://psprices.com/region-ch/game/123',
        score: 88,
        isRecommended: true
      },
      {
        title: 'Candidate B',
        amount: 49.9,
        currency: 'CHF',
        regularAmount: 79.9,
        discountPercent: 37.5,
        isFree: false,
        url: 'https://psprices.com/region-ch/game/456',
        score: 95,
        isRecommended: false
      }
    ]);
  });

  it('covers unified pricing helper branches for availability and discount detection', () => {
    expect(service.hasUnifiedPriceData({ priceAmount: 0, priceIsFree: null })).toBe(true);
    expect(service.hasUnifiedPriceData({ priceAmount: null, priceIsFree: true })).toBe(true);
    expect(service.hasUnifiedPriceData({ priceAmount: null, priceIsFree: false })).toBe(false);

    expect(
      service.isGameOnDiscount({
        priceAmount: 10,
        priceRegularAmount: 20,
        priceDiscountPercent: null,
        priceIsFree: false
      })
    ).toBe(true);
    expect(
      service.isGameOnDiscount({
        priceAmount: 10,
        priceRegularAmount: 10,
        priceDiscountPercent: 5,
        priceIsFree: false
      })
    ).toBe(true);
    expect(
      service.isGameOnDiscount({
        priceAmount: 10,
        priceRegularAmount: 20,
        priceDiscountPercent: 50,
        priceIsFree: true
      })
    ).toBe(false);
    expect(
      service.isGameOnDiscount({
        priceAmount: null,
        priceRegularAmount: null,
        priceDiscountPercent: 0,
        priceIsFree: false
      })
    ).toBe(false);
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
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith(
      'mario',
      'Nintendo Switch',
      undefined
    );
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('delegates box art title search with IGDB platform id for valid query', async () => {
    searchApi.searchBoxArtByTitle.mockReturnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(
      service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130)
    );
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', 'Nintendo Switch', 130);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('uses IGDB cover lookup instead of TheGamesDB for Windows platform when game id is provided', async () => {
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '123',
        title: 'Halo',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
        coverSource: 'igdb',
        platforms: ['PC (Microsoft Windows)'],
        platform: 'PC (Microsoft Windows)',
        platformIgdbId: 6,
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );

    const results = await firstValueFrom(
      service.searchBoxArtByTitle('halo', 'PC (Microsoft Windows)', 6, '123')
    );

    expect(searchApi.getGameById).toHaveBeenCalledWith('123');
    expect(searchApi.searchBoxArtByTitle).not.toHaveBeenCalled();
    expect(results).toEqual(['https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg']);
  });

  it('returns empty cover results for Windows platform when IGDB lookup fails', async () => {
    searchApi.getGameById.mockReturnValue(throwError(() => new Error('IGDB unavailable')));

    const results = await firstValueFrom(
      service.searchBoxArtByTitle('halo', 'PC (Microsoft Windows)', 6, '123')
    );

    expect(searchApi.getGameById).toHaveBeenCalledWith('123');
    expect(searchApi.searchBoxArtByTitle).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('uses IGDB cover lookup for Android, iOS, Web browser, SteamVR, visionOS, PS5, and Switch 2 platform ids', async () => {
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '123',
        title: 'Halo',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
        coverSource: 'igdb',
        platforms: ['Android'],
        platform: 'Android',
        platformIgdbId: 34,
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );

    const platformIds = [34, 39, 82, 163, 167, 472, 508];

    for (const platformId of platformIds) {
      const results = await firstValueFrom(
        service.searchBoxArtByTitle('halo', 'Any', platformId, '123')
      );
      expect(results).toEqual(['https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg']);
    }

    expect(searchApi.getGameById).toHaveBeenCalledTimes(platformIds.length);
    expect(searchApi.searchBoxArtByTitle).not.toHaveBeenCalled();
  });

  it('uses IGDB cover lookup for mobile/web/vr and PS5/Switch 2 platform names when id is unavailable', async () => {
    searchApi.getGameById.mockReturnValue(
      of({
        igdbGameId: '123',
        title: 'Halo',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
        coverSource: 'igdb',
        platforms: ['Android'],
        platform: 'Android',
        platformIgdbId: 34,
        releaseDate: null,
        releaseYear: null
      } as GameCatalogResult)
    );

    const platformNames = [
      'Android',
      'iOS',
      'Web browser',
      'SteamVR',
      'visionOS',
      'PlayStation 5',
      'Nintendo Switch 2'
    ];

    for (const platformName of platformNames) {
      const results = await firstValueFrom(
        service.searchBoxArtByTitle('halo', platformName, undefined, '123')
      );
      expect(results).toEqual(['https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg']);
    }

    expect(searchApi.getGameById).toHaveBeenCalledTimes(platformNames.length);
    expect(searchApi.searchBoxArtByTitle).not.toHaveBeenCalled();
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
      updatedAt: '2026-01-02T00:00:00.000Z'
    };

    repository.updateCover.mockResolvedValue(updatedEntry);

    const result = await service.updateGameCover('123', 130, 'https://example.com/new-cover.jpg');

    expect(repository.updateCover).toHaveBeenCalledWith(
      '123',
      130,
      'https://example.com/new-cover.jpg',
      'thegamesdb'
    );
    expect(result).toEqual(updatedEntry);
  });

  it('updates game cover with explicit igdb source when provided', async () => {
    const updatedEntry: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Old Title',
      coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/new.jpg',
      coverSource: 'igdb',
      platform: 'PC (Microsoft Windows)',
      platformIgdbId: 6,
      releaseDate: null,
      releaseYear: null,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    };

    repository.updateCover.mockResolvedValue(updatedEntry);

    const result = await service.updateGameCover(
      '123',
      6,
      'https://images.igdb.com/igdb/image/upload/t_cover_big/new.jpg',
      'igdb'
    );

    expect(repository.updateCover).toHaveBeenCalledWith(
      '123',
      6,
      'https://images.igdb.com/igdb/image/upload/t_cover_big/new.jpg',
      'igdb'
    );
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
      releaseYear: null
    };

    await expect(service.addGame(base, 'collection')).rejects.toThrow('IGDB game id is required.');
    await expect(
      service.addGame({ ...base, igdbGameId: '123', platformIgdbId: null }, 'collection')
    ).rejects.toThrow('IGDB platform id is required.');
    await expect(
      service.addGame({ ...base, igdbGameId: '123', platform: ' ' }, 'collection')
    ).rejects.toThrow('Platform is required.');
  });

  it('throws when refreshing or updating a missing game', async () => {
    repository.exists.mockResolvedValue(undefined);
    repository.updateCover.mockResolvedValue(undefined);

    await expect(service.refreshGameMetadata('123', 130)).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(service.refreshGameCompletionTimes('123', 130)).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(
      service.updateGameCover('123', 130, 'https://example.com/new-cover.jpg')
    ).rejects.toThrow('Game entry no longer exists.');
  });

  it('rematches game identity and preserves user fields', async () => {
    const current: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Wrong Match',
      coverUrl: 'https://example.com/custom.jpg',
      coverSource: 'thegamesdb',
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      tagIds: [1, 2],
      releaseDate: '2020-01-01T00:00:00.000Z',
      releaseYear: 2020,
      status: 'playing',
      rating: 4,
      notes: 'remember to try hard mode',
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const replacement: GameCatalogResult = {
      igdbGameId: '456',
      title: 'Correct Match',
      coverUrl: 'https://images.igdb.com/cover.jpg',
      coverSource: 'igdb',
      platforms: ['Nintendo Switch'],
      platformOptions: [{ id: 130, name: 'Nintendo Switch' }],
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: '2021-01-01T00:00:00.000Z',
      releaseYear: 2021
    };

    const upserted: GameEntry = {
      ...current,
      id: 11,
      igdbGameId: '456',
      title: 'Correct Match',
      coverUrl: 'https://images.igdb.com/cover.jpg',
      coverSource: 'igdb',
      status: null,
      rating: null,
      tagIds: []
    };

    repository.exists.mockResolvedValue(current);
    repository.upsertFromCatalog.mockResolvedValue(upserted);
    repository.setGameStatus.mockResolvedValue({ ...upserted, status: 'playing' });
    repository.setGameRating.mockResolvedValue({ ...upserted, status: 'playing', rating: 4 });
    repository.setGameTags.mockResolvedValue({
      ...upserted,
      status: 'playing',
      rating: 4,
      tagIds: [1, 2]
    });
    repository.setGameNotes.mockResolvedValue({
      ...upserted,
      status: 'playing',
      rating: 4,
      tagIds: [1, 2],
      notes: 'remember to try hard mode'
    });
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' },
      { id: 2, name: 'Favorite', color: '#222222', createdAt: 'x', updatedAt: 'x' }
    ]);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    const result = await service.rematchGame('123', 130, replacement);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        igdbGameId: '456',
        platformIgdbId: 130,
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      }),
      'collection'
    );
    expect(repository.remove).toHaveBeenCalledWith('123', 130);
    expect(repository.setGameStatus).toHaveBeenCalledWith('456', 130, 'playing');
    expect(repository.setGameRating).toHaveBeenCalledWith('456', 130, 4);
    expect(repository.setGameTags).toHaveBeenCalledWith('456', 130, [1, 2]);
    expect(repository.setGameNotes).toHaveBeenCalledWith('456', 130, 'remember to try hard mode');
    expect(result.tags?.map((tag) => tag.name)).toEqual(['Backlog', 'Favorite']);
    expect(result.notes).toBe('remember to try hard mode');
  });

  it('does not remove entry during rematch when identity is unchanged', async () => {
    const current: GameEntry = {
      id: 10,
      igdbGameId: '123',
      title: 'Game',
      coverUrl: null,
      coverSource: 'igdb',
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      tagIds: [],
      releaseDate: null,
      releaseYear: null,
      status: null,
      rating: null,
      listType: 'collection',
      createdAt: 'x',
      updatedAt: 'x'
    };

    const replacement: GameCatalogResult = {
      igdbGameId: '123',
      title: 'Game',
      coverUrl: null,
      coverSource: 'igdb',
      platforms: ['Nintendo Switch'],
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null
    };

    repository.exists.mockResolvedValue(current);
    repository.upsertFromCatalog.mockResolvedValue(current);
    repository.listTags.mockResolvedValue([]);
    searchApi.lookupCompletionTimes.mockReturnValue(of(null));

    await service.rematchGame('123', 130, replacement);

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('throws when rematching a missing game entry', async () => {
    repository.exists.mockResolvedValue(undefined);

    await expect(
      service.rematchGame('123', 130, {
        igdbGameId: '456',
        title: 'Replacement',
        coverUrl: null,
        coverSource: 'igdb',
        platforms: ['Nintendo Switch'],
        platform: 'Nintendo Switch',
        platformIgdbId: 130,
        releaseDate: null,
        releaseYear: null
      })
    ).rejects.toThrow('Game entry no longer exists.');
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
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    repository.setGameTags.mockResolvedValue(base);
    repository.setGameStatus.mockResolvedValue({ ...base, status: 'playing' });
    repository.setGameRating.mockResolvedValue({ ...base, rating: 3.5 });
    repository.setGameNotes.mockResolvedValue({ ...base, notes: 'checkpoint before boss' });
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' },
      { id: 2, name: 'Co-op', color: '#222222', createdAt: 'x', updatedAt: 'x' }
    ]);

    const tagged = await service.setGameTags('123', 130, [1, 2]);
    const statused = await service.setGameStatus('123', 130, 'playing');
    const rated = await service.setGameRating('123', 130, 3.5);
    const noted = await service.setGameNotes('123', 130, 'checkpoint before boss');

    expect(tagged.tags?.map((tag) => tag.name)).toEqual(['Backlog', 'Co-op']);
    expect(statused.status).toBe('playing');
    expect(rated.rating).toBe(3.5);
    expect(noted.notes).toBe('checkpoint before boss');
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
      rating: null
    } as GameEntry);
    repository.listTags.mockResolvedValue([]);
    await service.setGameRating('123', 130, 99 as never);
    expect(repository.setGameRating).toHaveBeenCalledWith('123', 130, null);

    repository.setGameTags.mockResolvedValue(undefined);
    repository.setGameNotes.mockResolvedValue(undefined);
    repository.setGameStatus.mockResolvedValue(undefined);
    repository.setGameRating.mockResolvedValue(undefined);
    await expect(service.setGameTags('123', 130, [1])).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(service.setGameStatus('123', 130, 'playing')).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(service.setGameRating('123', 130, 4)).rejects.toThrow(
      'Game entry no longer exists.'
    );
    await expect(service.setGameNotes('123', 130, 'a note')).rejects.toThrow(
      'Game entry no longer exists.'
    );
  });

  it('refreshes watchList on partial failure for bulk move/remove/status/tags updates', async () => {
    const base: GameEntry = {
      id: 10,
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
      updatedAt: 'x'
    };

    repository.listByType.mockResolvedValue([]);
    repository.listTags.mockResolvedValue([]);

    const subscription = service.watchList('collection').subscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    repository.listByType.mockClear();

    repository.setGameStatus.mockResolvedValueOnce(base).mockResolvedValueOnce(undefined);
    await expect(
      service.setGameStatusForGames(
        [
          { igdbGameId: '123', platformIgdbId: 130 },
          { igdbGameId: '456', platformIgdbId: 6 }
        ],
        'playing'
      )
    ).rejects.toThrow('Game entry no longer exists (456:6).');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.listByType).toHaveBeenCalledTimes(1);

    repository.listByType.mockClear();
    repository.moveToList.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.moveGamesToList(
        [
          { igdbGameId: '123', platformIgdbId: 130 },
          { igdbGameId: '456', platformIgdbId: 6 }
        ],
        'wishlist'
      )
    ).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.listByType).toHaveBeenCalledTimes(1);

    repository.listByType.mockClear();
    repository.remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.removeGames([
        { igdbGameId: '123', platformIgdbId: 130 },
        { igdbGameId: '456', platformIgdbId: 6 }
      ])
    ).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.listByType).toHaveBeenCalledTimes(1);

    repository.listByType.mockClear();
    repository.setGameTags.mockResolvedValueOnce(base).mockResolvedValueOnce(undefined);
    await expect(
      service.setGameTagsForGames(
        [
          { igdbGameId: '123', platformIgdbId: 130 },
          { igdbGameId: '456', platformIgdbId: 6 }
        ],
        [1]
      )
    ).rejects.toThrow('Game entry no longer exists (456:6).');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.listByType).toHaveBeenCalledTimes(1);

    subscription.unsubscribe();
  });

  it('validates tag names and normalizes tag colors', async () => {
    repository.upsertTag.mockResolvedValue({
      id: 1,
      name: 'Backlog',
      color: '#3880ff',
      createdAt: 'x',
      updatedAt: 'x'
    });

    await expect(service.createTag(' ', '#ffffff')).rejects.toThrow('Tag name is required.');
    await expect(service.updateTag(1, ' ', '#ffffff')).rejects.toThrow('Tag name is required.');

    const created = await service.createTag(' Backlog ', 'oops');
    const updated = await service.updateTag(1, ' Backlog ', '#00ff00');

    expect(repository.upsertTag).toHaveBeenCalledWith({ name: 'Backlog', color: '#3880ff' });
    expect(repository.upsertTag).toHaveBeenCalledWith({ id: 1, name: 'Backlog', color: '#00ff00' });
    expect(created.id).toBe(1);
    expect(updated.id).toBe(1);
  });

  it('supports list/get/delete tags and watch streams', async () => {
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' }
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
        updatedAt: 'x'
      }
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
        updatedAt: 'x'
      }
    ]);

    expect(await service.listTags()).toHaveLength(1);
    const list = await firstValueFrom(service.watchList('collection'));
    const summaries = await firstValueFrom(service.watchTags());
    expect(list[0].tags?.[0].name).toBe('Backlog');
    expect(summaries[0].gameCount).toBe(1);

    await service.deleteTag(1);
    expect(repository.deleteTag).toHaveBeenCalledWith(1);
  });

  it('normalizes tag ids and skips invalid tag records in watch streams', async () => {
    repository.listTags.mockResolvedValue([
      { id: 1, name: 'Backlog', color: '#111111', createdAt: 'x', updatedAt: 'x' },
      { id: 0, name: 'Invalid', color: '#222222', createdAt: 'x', updatedAt: 'x' }
    ]);
    repository.listByType.mockResolvedValue([
      {
        id: 20,
        igdbGameId: '200',
        title: 'Dup Tags',
        coverUrl: null,
        coverSource: 'none',
        platform: 'Switch',
        platformIgdbId: 130,
        tagIds: [1, 1, 0, -2],
        releaseDate: null,
        releaseYear: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ]);
    repository.listAll.mockResolvedValue([
      {
        id: 20,
        igdbGameId: '200',
        title: 'Dup Tags',
        coverUrl: null,
        coverSource: 'none',
        platform: 'Switch',
        platformIgdbId: 130,
        tagIds: [1, 1, 0, -2],
        releaseDate: null,
        releaseYear: null,
        listType: 'collection',
        createdAt: 'x',
        updatedAt: 'x'
      }
    ]);

    const list = await firstValueFrom(service.watchList('collection'));
    const summaries = await firstValueFrom(service.watchTags());

    expect(list[0].tagIds).toEqual([1]);
    expect(list[0].tags).toEqual([{ id: 1, name: 'Backlog', color: '#111111' }]);
    expect(summaries.find((tag) => tag.id === 1)?.gameCount).toBe(1);
  });

  it('refreshes metadata using normalized platformOptions when current platform is missing from refreshed platform list', async () => {
    const existingEntry: GameEntry = {
      id: 12,
      igdbGameId: '333',
      title: 'Existing Game',
      coverUrl: 'https://example.com/current-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Nintendo Switch',
      platformIgdbId: 130,
      releaseDate: null,
      releaseYear: null,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    const refreshedCatalog: GameCatalogResult = {
      igdbGameId: '333',
      title: 'Refreshed',
      coverUrl: null,
      coverSource: 'igdb',
      developers: [],
      franchises: [],
      genres: [],
      publishers: [],
      platforms: ['Switch 2'],
      platformOptions: [
        { id: -1, name: 'Bad Id' },
        { id: 130, name: 'Nintendo Switch Alias' },
        { id: null, name: '' }
      ],
      platform: null,
      platformIgdbId: null,
      releaseDate: null,
      releaseYear: 2026
    };

    repository.exists.mockResolvedValue(existingEntry);
    searchApi.getGameById.mockReturnValue(of(refreshedCatalog));
    repository.upsertFromCatalog.mockImplementation((catalog: GameCatalogResult) => {
      const merged: GameEntry = {
        ...existingEntry,
        ...catalog,
        listType: 'collection',
        createdAt: existingEntry.createdAt,
        updatedAt: existingEntry.updatedAt,
        platform: catalog.platform,
        platformIgdbId: catalog.platformIgdbId
      };
      return merged;
    });

    const result = await service.refreshGameMetadata('333', 130);

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'Nintendo Switch Alias',
        platformIgdbId: 130
      }),
      'collection'
    );
    expect(result.platform).toBe('Nintendo Switch Alias');
    expect(result.platformIgdbId).toBe(130);
  });

  it('creates/updates/deletes views and validates missing updates', async () => {
    repository.createView.mockResolvedValue({
      id: 11,
      name: 'My View',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'x'
    });
    repository.updateView.mockResolvedValueOnce({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'y'
    });
    repository.updateView.mockResolvedValueOnce({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'platform',
      createdAt: 'x',
      updatedAt: 'z'
    });
    repository.getView.mockResolvedValue({
      id: 11,
      name: 'Renamed',
      listType: 'collection',
      filters: DEFAULT_GAME_LIST_FILTERS,
      groupBy: 'none',
      createdAt: 'x',
      updatedAt: 'z'
    } as GameListView);
    repository.listViews.mockResolvedValue([
      {
        id: 11,
        name: 'Renamed',
        listType: 'collection',
        filters: DEFAULT_GAME_LIST_FILTERS,
        groupBy: 'none',
        createdAt: 'x',
        updatedAt: 'z'
      }
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
      groupBy: 'none'
    });
    expect(repository.deleteView).toHaveBeenCalledWith(11);

    repository.updateView.mockResolvedValue(undefined);
    await expect(service.renameView(11, 'x')).rejects.toThrow('View no longer exists.');
    await expect(
      service.updateViewConfiguration(11, DEFAULT_GAME_LIST_FILTERS, 'none')
    ).rejects.toThrow('View no longer exists.');
  });
});
