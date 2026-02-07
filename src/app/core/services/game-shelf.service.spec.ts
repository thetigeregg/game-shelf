import { firstValueFrom, of, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { GAME_SEARCH_API, GameSearchApi } from '../api/game-search-api';
import { GAME_REPOSITORY, GameRepository } from '../data/game-repository';
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
    ]);

    searchApi = jasmine.createSpyObj<GameSearchApi>('GameSearchApi', ['searchGames']);

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
    const mario = {
      externalId: '123',
      title: 'Mario Kart',
      coverUrl: null,
      platforms: ['Switch'],
      platform: 'Switch',
      releaseYear: 2017,
    };

    repository.upsertFromCatalog.and.resolveTo({
      ...mario,
      listType: 'collection',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await service.addGame(mario, 'collection');
    await service.moveGame('123', 'wishlist');
    await service.removeGame('123');

    expect(repository.upsertFromCatalog).toHaveBeenCalledWith(mario, 'collection');
    expect(repository.moveToList).toHaveBeenCalledWith('123', 'wishlist');
    expect(repository.remove).toHaveBeenCalledWith('123');
  });

  it('returns API search results for valid queries', async () => {
    const expected = [{ externalId: '1', title: 'Mario', coverUrl: null, platforms: [], platform: null, releaseYear: null }];
    searchApi.searchGames.and.returnValue(of(expected));

    const result = await firstValueFrom(service.searchGames('mario'));

    expect(result).toEqual(expected);
  });
});
