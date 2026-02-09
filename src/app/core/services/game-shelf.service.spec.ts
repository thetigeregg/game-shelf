import { firstValueFrom, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
import { GameCatalogResult, GameEntry } from '../models/game.models';
import { GameShelfService } from './game-shelf.service';

describe('GameShelfService', () => {
  let repository: jasmine.SpyObj<GameRepository>;
  let searchApi: jasmine.SpyObj<GameSearchApi>;
  let service: GameShelfService;

  beforeEach(() => {
    repository = jasmine.createSpyObj<GameRepository>('GameRepository', [
      'listByType',
      'upsertFromCatalog',
      'moveToList',
      'remove',
      'exists',
      'updateCover',
    ]);

    searchApi = jasmine.createSpyObj<GameSearchApi>('GameSearchApi', ['searchGames', 'getGameById', 'searchBoxArtByTitle']);

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
    searchApi.searchGames.and.returnValue(throwError(() => new Error('API unavailable')));

    await expectAsync(firstValueFrom(service.searchGames('mario'))).toBeRejectedWithError('API unavailable');
  });

  it('delegates add/move/remove actions to repository', async () => {
    const mario: GameCatalogResult = {
      externalId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      coverSource: 'none',
      platforms: ['Switch'],
      platform: 'Switch',
      platformIgdbId: 130,
      releaseDate: '2017-04-28T00:00:00.000Z',
      releaseYear: 2017,
    };

    repository.upsertFromCatalog.and.resolveTo({
      ...mario,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as GameEntry);

    await service.addGame(mario, 'collection');
    await service.moveGame('123', 'wishlist');
    await service.removeGame('123');

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(mario, 'collection');
    expect(repository.moveToList).toHaveBeenCalledWith('123', 'wishlist');
    expect(repository.remove).toHaveBeenCalledWith('123');
  });

  it('returns API search results for valid queries', async () => {
    const expected: GameCatalogResult[] = [
      { externalId: '1', title: 'Mario', coverUrl: null, coverSource: 'none', platforms: [], platform: null, releaseDate: null, releaseYear: null },
    ];
    searchApi.searchGames.and.returnValue(of(expected));

    const result = await firstValueFrom(service.searchGames('mario'));

    expect(result).toEqual(expected);
  });

  it('refreshes game metadata by IGDB id and keeps list placement', async () => {
    const existingEntry: GameEntry = {
      id: 10,
      externalId: '123',
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
      externalId: '123',
      title: 'Updated Title',
      coverUrl: 'https://example.com/updated.jpg',
      coverSource: 'igdb' as const,
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

    repository.exists.and.resolveTo(existingEntry);
    searchApi.getGameById.and.returnValue(of(refreshedCatalog));
    repository.upsertFromCatalog.and.resolveTo(updatedEntry);

    const result = await service.refreshGameMetadata('123');

    expect(searchApi.getGameById).toHaveBeenCalledWith('123');
    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(
      jasmine.objectContaining({
        externalId: '123',
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
    searchApi.searchBoxArtByTitle.and.returnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario'));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', undefined, undefined);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('delegates box art title search with platform for valid query', async () => {
    searchApi.searchBoxArtByTitle.and.returnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch'));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', 'Nintendo Switch', undefined);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('delegates box art title search with IGDB platform id for valid query', async () => {
    searchApi.searchBoxArtByTitle.and.returnValue(of(['https://example.com/cover.jpg']));
    const results = await firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130));
    expect(searchApi.searchBoxArtByTitle).toHaveBeenCalledWith('mario', 'Nintendo Switch', 130);
    expect(results).toEqual(['https://example.com/cover.jpg']);
  });

  it('updates game cover using dedicated repository method', async () => {
    const updatedEntry: GameEntry = {
      id: 10,
      externalId: '123',
      title: 'Old Title',
      coverUrl: 'https://example.com/new-cover.jpg',
      coverSource: 'thegamesdb',
      platform: 'Nintendo Switch',
      releaseDate: null,
      releaseYear: null,
      listType: 'wishlist',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    repository.updateCover.and.resolveTo(updatedEntry);

    const result = await service.updateGameCover('123', 'https://example.com/new-cover.jpg');

    expect(repository.updateCover).toHaveBeenCalledWith('123', 'https://example.com/new-cover.jpg', 'thegamesdb');
    expect(result).toEqual(updatedEntry);
  });
});
