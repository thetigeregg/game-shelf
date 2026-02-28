import { HttpHeaders, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { IgdbProxyService } from './igdb-proxy.service';

describe('IgdbProxyService', () => {
  let service: IgdbProxyService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), IgdbProxyService]
    });

    localStorage.clear();
    service = TestBed.inject(IgdbProxyService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('returns empty list for short queries without HTTP call', async () => {
    await expect(firstValueFrom(service.searchGames('x'))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/games/search`);
  });

  it('accepts legacy externalId values in search payloads', async () => {
    const promise = firstValueFrom(service.searchGames('sonic'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=sonic`);

    req.flush({
      items: [
        {
          externalId: '6231',
          title: 'Sonic the Hedgehog',
          coverUrl: '',
          coverSource: 'igdb',
          platforms: ['PlayStation 3', 'Xbox 360'],
          platform: null,
          releaseDate: '2006-11-14T00:00:00.000Z',
          releaseYear: 2006
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        igdbGameId: '6231',
        title: 'Sonic the Hedgehog'
      })
    ]);
  });

  it('maps API response and sends q query param', async () => {
    const promise = firstValueFrom(service.searchGames('mario'));

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/games/search` &&
        request.params.get('q') === 'mario'
      );
    });

    req.flush({
      items: [
        {
          igdbGameId: '100',
          title: 'Super Mario Odyssey',
          coverUrl: '',
          coverSource: 'none',
          platforms: ['Nintendo Switch'],
          platform: 'Nintendo Switch',
          releaseDate: '2017-10-27T00:00:00.000Z',
          releaseYear: 2017
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      {
        igdbGameId: '100',
        title: 'Super Mario Odyssey',
        coverUrl: null,
        coverSource: 'none',
        storyline: null,
        summary: null,
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        metacriticScore: null,
        metacriticUrl: null,
        similarGameIgdbIds: [],
        developers: [],
        franchises: [],
        collections: [],
        genres: [],
        gameType: null,
        publishers: [],
        platforms: ['Nintendo Switch'],
        platformOptions: [{ id: null, name: 'Nintendo Switch' }],
        platform: 'Nintendo Switch',
        platformIgdbId: null,
        releaseDate: '2017-10-27T00:00:00.000Z',
        releaseYear: 2017
      }
    ]);
  });

  it('includes IGDB platform id in search query params when provided', async () => {
    const promise = firstValueFrom(service.searchGames('mario', 130));

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/games/search` &&
        request.params.get('q') === 'mario' &&
        request.params.get('platformIgdbId') === '130'
      );
    });

    req.flush({
      items: [
        {
          igdbGameId: '100',
          title: 'Super Mario Odyssey',
          coverUrl: '',
          coverSource: 'none',
          platforms: ['Nintendo Switch'],
          platform: 'Nintendo Switch',
          releaseDate: '2017-10-27T00:00:00.000Z',
          releaseYear: 2017
        }
      ]
    });

    await expect(promise).resolves.toHaveLength(1);
  });

  it('maps HTTP failure to user-safe error', async () => {
    const promise = firstValueFrom(service.searchGames('mario'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to load game search results.');
  });

  it('maps rate-limited search responses and enforces cooldown from retry-after', async () => {
    const withRetryAfter = firstValueFrom(service.searchGames('mario'));
    const reqOne = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    reqOne.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '9' })
      }
    );
    await expect(withRetryAfter).rejects.toThrowError('Rate limit exceeded. Retry after 9s.');

    const duringCooldown = firstValueFrom(service.searchGames('mario'));
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    await expect(duringCooldown).rejects.toThrowError(/Rate limit exceeded\. Retry after \d+s\./);
  });

  it('loads a game by IGDB id and normalizes the payload', async () => {
    const promise = firstValueFrom(service.getGameById('100'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({
      item: {
        igdbGameId: '100',
        title: 'Super Mario Odyssey',
        coverUrl: 'https://example.com/cover.jpg',
        coverSource: 'thegamesdb',
        platforms: ['Nintendo Switch', 'Wii U'],
        platform: null,
        releaseDate: '2017-10-27T00:00:00.000Z',
        releaseYear: 2017
      }
    });

    await expect(promise).resolves.toEqual({
      igdbGameId: '100',
      title: 'Super Mario Odyssey',
      coverUrl: 'https://example.com/cover.jpg',
      coverSource: 'thegamesdb',
      storyline: null,
      summary: null,
      hltbMainHours: null,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null,
      metacriticScore: null,
      metacriticUrl: null,
      similarGameIgdbIds: [],
      developers: [],
      franchises: [],
      collections: [],
      genres: [],
      gameType: null,
      publishers: [],
      platforms: ['Nintendo Switch', 'Wii U'],
      platformOptions: [
        { id: null, name: 'Nintendo Switch' },
        { id: null, name: 'Wii U' }
      ],
      platform: null,
      platformIgdbId: null,
      releaseDate: '2017-10-27T00:00:00.000Z',
      releaseYear: 2017
    });
  });

  it('maps refresh endpoint failure to user-safe error', async () => {
    const promise = firstValueFrom(service.getGameById('100'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to refresh game metadata.');
  });

  it('rejects invalid IGDB game ids before HTTP call', async () => {
    await expect(firstValueFrom(service.getGameById('abc'))).rejects.toThrowError(
      'Unable to refresh game metadata.'
    );
    httpMock.expectNone((request) =>
      request.url.startsWith(`${environment.gameApiBaseUrl}/v1/games/`)
    );
  });

  it('loads platform filters from bundled snapshot without HTTP', async () => {
    const promise = firstValueFrom(service.listPlatforms());
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/platforms`);

    await expect(promise).resolves.toEqual(
      expect.arrayContaining([
        { id: 130, name: 'Nintendo Switch' },
        { id: 6, name: 'PC (Microsoft Windows)' },
        { id: 167, name: 'PlayStation 5' },
        { id: 169, name: 'Xbox Series X|S' }
      ])
    );
  });

  it('loads popularity categories', async () => {
    const promise = firstValueFrom(service.listPopularityTypes());
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/popularity/types`);
    req.flush({
      items: [
        { id: 7, name: 'Most visited games on IGDB', externalPopularitySource: 20 },
        { id: 9, name: 'Most played in the last 24h', externalPopularitySource: 33 }
      ]
    });

    await expect(promise).resolves.toEqual([
      { id: 9, name: 'Most played in the last 24h', externalPopularitySource: 33 },
      { id: 7, name: 'Most visited games on IGDB', externalPopularitySource: 20 }
    ]);
  });

  it('loads popularity games with paging params and normalizes payload', async () => {
    const promise = firstValueFrom(service.listPopularityGames(7, 20, 40));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/popularity/primitives` &&
        request.params.get('popularityTypeId') === '7' &&
        request.params.get('limit') === '20' &&
        request.params.get('offset') === '40'
      );
    });

    req.flush({
      items: [
        {
          popularityType: 7,
          externalPopularitySource: 20,
          value: 1234.5,
          calculatedAt: '2026-01-01T00:00:00.000Z',
          game: {
            igdbGameId: '100',
            title: 'Super Mario Odyssey',
            coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg',
            coverSource: 'igdb',
            platforms: ['Nintendo Switch'],
            platform: 'Nintendo Switch',
            releaseDate: '2017-10-27T00:00:00.000Z',
            releaseYear: 2017
          }
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      {
        popularityType: 7,
        externalPopularitySource: 20,
        value: 1234.5,
        calculatedAt: '2026-01-01T00:00:00.000Z',
        game: {
          igdbGameId: '100',
          title: 'Super Mario Odyssey',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc.jpg',
          coverSource: 'igdb',
          storyline: null,
          summary: null,
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
          metacriticScore: null,
          metacriticUrl: null,
          similarGameIgdbIds: [],
          developers: [],
          franchises: [],
          collections: [],
          genres: [],
          gameType: null,
          publishers: [],
          platforms: ['Nintendo Switch'],
          platformOptions: [{ id: null, name: 'Nintendo Switch' }],
          platform: 'Nintendo Switch',
          platformIgdbId: null,
          releaseDate: '2017-10-27T00:00:00.000Z',
          releaseYear: 2017
        }
      }
    ]);
  });

  it('returns empty popularity games for invalid popularity type ids without HTTP call', async () => {
    await expect(firstValueFrom(service.listPopularityGames(0))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/popularity/primitives`);
  });

  it('maps popularity game endpoint failures to user-safe error', async () => {
    const promise = firstValueFrom(service.listPopularityGames(7, 20, 0));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/popularity/primitives` &&
        request.params.get('popularityTypeId') === '7'
      );
    });

    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to load popular games.');
  });

  it('normalizes popularity payload with invalid and string values', async () => {
    const promise = firstValueFrom(service.listPopularityGames(9, 20, 0));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/popularity/primitives` &&
        request.params.get('popularityTypeId') === '9'
      );
    });

    req.flush({
      items: [
        {
          popularityType: 9,
          externalPopularitySource: 11,
          value: '333.5',
          calculatedAt: 'invalid-date',
          game: {
            igdbGameId: '200',
            title: 'Metroid Prime',
            coverUrl: null,
            coverSource: 'igdb',
            platforms: ['Nintendo GameCube'],
            platform: 'Nintendo GameCube',
            releaseDate: null,
            releaseYear: 2002
          }
        },
        {
          popularityType: 9,
          externalPopularitySource: 11,
          value: 'not-a-number',
          calculatedAt: null,
          game: {
            igdbGameId: '201',
            title: 'Metroid Prime 2',
            coverUrl: null,
            coverSource: 'igdb',
            platforms: ['Nintendo GameCube'],
            platform: 'Nintendo GameCube',
            releaseDate: null,
            releaseYear: 2004
          }
        },
        {
          popularityType: null,
          value: 99,
          game: {
            igdbGameId: '202',
            title: 'Filtered Out',
            coverUrl: null,
            coverSource: 'igdb',
            platforms: ['Nintendo GameCube'],
            platform: 'Nintendo GameCube',
            releaseDate: null,
            releaseYear: 2005
          }
        }
      ]
    });

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      popularityType: 9,
      value: 333.5,
      calculatedAt: null
    });
    expect(results[1]).toMatchObject({
      popularityType: 9,
      value: null,
      calculatedAt: null
    });
    expect(results[0]?.game?.igdbGameId).toBe('200');
    expect(results[1]?.game?.igdbGameId).toBe('201');
  });

  it('searches box art results and normalizes URLs', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search` &&
        request.params.get('q') === 'mario'
      );
    });

    req.flush({
      items: [
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
        '   https://cdn.thegamesdb.net/images/original/box/front/mario-2.jpg   ',
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
        '/relative/path.jpg'
      ]
    });

    await expect(promise).resolves.toEqual([
      'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
      'https://cdn.thegamesdb.net/images/original/box/front/mario-2.jpg'
    ]);
  });

  it('includes platform in box art search query params when provided', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search` &&
        request.params.get('q') === 'mario' &&
        request.params.get('platform') === 'Nintendo Switch' &&
        request.params.get('platformIgdbId') === '130'
      );
    });

    req.flush({
      items: ['https://cdn.thegamesdb.net/images/original/box/front/mario.jpg']
    });

    await expect(promise).resolves.toEqual([
      'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg'
    ]);
  });

  it('returns empty box art results for short queries without HTTP call', async () => {
    await expect(firstValueFrom(service.searchBoxArtByTitle('m'))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/images/boxart/search`);
  });

  it('maps box art search failure to user-safe error', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to load box art results.');
  });

  it('maps box art rate limit responses with retry timing', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '15' })
      }
    );
    await expect(promise).rejects.toThrowError('Rate limit exceeded. Retry after 15s.');
  });

  it('maps box art rate limits without retry-after header', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush({ message: 'rate limited' }, { status: 429, statusText: 'Too Many Requests' });
    await expect(promise).rejects.toThrowError('Rate limit exceeded. Retry after 20s.');
  });

  it('normalizes platform options and cover source from rich payloads', async () => {
    const promise = firstValueFrom(service.searchGames('zelda'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=zelda`);
    req.flush({
      items: [
        {
          igdbGameId: '200',
          title: 'Zelda',
          coverUrl: 'https://example.com/zelda.jpg',
          coverSource: 'unknown-source',
          developers: ['Nintendo', 'Nintendo'],
          franchises: ['The Legend of Zelda'],
          genres: ['Adventure', 'Adventure'],
          publishers: ['Nintendo'],
          platforms: ['Switch'],
          platformOptions: [
            { id: 130, name: 'Switch' },
            { id: 130, name: 'Switch' },
            { id: null, name: '' }
          ],
          platform: 'Switch',
          platformIgdbId: 130,
          releaseDate: 'not-a-date',
          releaseYear: 2024
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      {
        igdbGameId: '200',
        title: 'Zelda',
        coverUrl: 'https://example.com/zelda.jpg',
        coverSource: 'none',
        storyline: null,
        summary: null,
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        metacriticScore: null,
        metacriticUrl: null,
        similarGameIgdbIds: [],
        developers: ['Nintendo'],
        franchises: ['The Legend of Zelda'],
        collections: [],
        genres: ['Adventure'],
        gameType: null,
        publishers: ['Nintendo'],
        platforms: ['Switch'],
        platformOptions: [{ id: 130, name: 'Switch' }],
        platform: 'Switch',
        platformIgdbId: 130,
        releaseDate: null,
        releaseYear: 2024
      }
    ]);
  });

  it('looks up HLTB completion times and normalizes the payload', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimes('Super Metroid', 1994, 'SNES'));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Super Metroid' &&
        request.params.get('releaseYear') === '1994' &&
        request.params.get('platform') === 'SNES'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 7.53,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 13.04
      }
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 7.5,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 13
    });
  });

  it('returns null for HLTB lookup failures', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimes('Super Metroid'));
    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/hltb/search?q=Super%20Metroid`
    );
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toBeNull();
  });

  it('encodes semicolons in HLTB lookup query params', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Chaos;Child', 2014, 'PlayStation Vita')
    );
    const req = httpMock.expectOne(
      (request) =>
        request.urlWithParams ===
        `${environment.gameApiBaseUrl}/v1/hltb/search?q=Chaos%3BChild&releaseYear=2014&platform=PlayStation%20Vita`
    );

    req.flush({
      item: {
        hltbMainHours: 40.4,
        hltbMainExtraHours: 52.2,
        hltbCompletionistHours: 70.6
      }
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 40.4,
      hltbMainExtraHours: 52.2,
      hltbCompletionistHours: 70.6
    });
  });

  it('looks up HLTB candidates and normalizes candidate payload', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimeCandidates('Super Metroid', 1994, 'SNES')
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Super Metroid' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('releaseYear') === '1994' &&
        request.params.get('platform') === 'SNES'
      );
    });

    req.flush({
      candidates: [
        {
          title: ' Super Metroid ',
          releaseYear: 1994,
          platform: ' SNES ',
          hltbMainHours: 7.53,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13.04
        },
        {
          title: 'Super Metroid',
          releaseYear: 1994,
          platform: 'SNES',
          hltbMainHours: 7.53,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13.04
        },
        {
          title: '',
          releaseYear: null,
          platform: null,
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Super Metroid',
        releaseYear: 1994,
        platform: 'SNES',
        hltbMainHours: 7.5,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 13
      }
    ]);
  });

  it('returns empty HLTB candidate list for short query or lookup failure', async () => {
    await expect(firstValueFrom(service.lookupCompletionTimeCandidates('x'))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/hltb/search`);

    const promise = firstValueFrom(service.lookupCompletionTimeCandidates('Super Metroid'));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Super Metroid' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });

    await expect(promise).resolves.toEqual([]);
  });

  it('propagates 429 errors for HLTB lookup and candidate search', async () => {
    const lookupPromise = firstValueFrom(service.lookupCompletionTimes('Super Metroid'));
    const lookupReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Super Metroid'
      );
    });
    lookupReq.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '3' })
      }
    );
    await expect(lookupPromise).rejects.toThrowError('Rate limit exceeded. Retry after 3s.');

    const candidatePromise = firstValueFrom(
      service.lookupCompletionTimeCandidates('Super Metroid')
    );
    const candidateReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Super Metroid' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    candidateReq.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '3' })
      }
    );
    await expect(candidatePromise).rejects.toThrowError('Rate limit exceeded. Retry after 3s.');
  });

  it('looks up Metacritic score and normalizes payload', async () => {
    const promise = firstValueFrom(service.lookupMetacriticScore('Okami', 2006, 'Wii', 21));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('releaseYear') === '2006' &&
        request.params.get('platform') === 'Wii'
      );
    });

    req.flush({
      item: {
        metacriticScore: 92.4,
        metacriticUrl: 'https://www.metacritic.com/game/okami/'
      }
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 92,
      metacriticUrl: 'https://www.metacritic.com/game/okami/'
    });
  });

  it('routes review score lookup by platform support matrix', async () => {
    const metacriticPromise = firstValueFrom(
      service.lookupMetacriticScore('Okami', 2006, 'Wii', 21)
    );
    const metacriticReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    metacriticReq.flush({
      item: {
        metacriticScore: 92,
        metacriticUrl: 'https://www.metacritic.com/game/okami/'
      }
    });
    await expect(metacriticPromise).resolves.toEqual({
      metacriticScore: 92,
      metacriticUrl: 'https://www.metacritic.com/game/okami/'
    });
    httpMock.expectNone(
      (request) => request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
    );

    const mobyPromise = firstValueFrom(
      service.lookupMetacriticScore('Shining Force', 1992, 'Genesis', 29)
    );
    const mobyReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Shining Force' &&
        request.params.get('platform') === 'Genesis'
      );
    });
    mobyReq.flush({
      games: [
        {
          title: 'Shining Force',
          release_date: '1992-03-20',
          platforms: [{ name: 'Genesis' }],
          moby_score: 88,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/'
        }
      ]
    });
    await expect(mobyPromise).resolves.toEqual({
      metacriticScore: 88,
      metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/'
    });
    httpMock.expectNone((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('platformIgdbId') === '29'
      );
    });
  });

  it('returns null for Metacritic lookup failures', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore('Okami', undefined, undefined, 21)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toBeNull();
  });

  it('handles short metacritic queries and propagates 429 responses', async () => {
    await expect(firstValueFrom(service.lookupMetacriticScore('x'))).resolves.toBeNull();
    await expect(firstValueFrom(service.lookupMetacriticCandidates('x'))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/metacritic/search`);

    const scorePromise = firstValueFrom(service.lookupMetacriticScore('Okami', 2006, 'Wii', 21));
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    scoreReq.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '4' })
      }
    );
    await expect(scorePromise).rejects.toThrowError('Rate limit exceeded. Retry after 4s.');

    const candidatePromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', 2006, 'Wii', 21)
    );
    const candidateReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    candidateReq.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '4' })
      }
    );
    await expect(candidatePromise).rejects.toThrowError('Rate limit exceeded. Retry after 4s.');
  });

  it('uses MobyGames for unsupported Metacritic platform ids and normalizes payload', async () => {
    const scorePromise = firstValueFrom(
      service.lookupMetacriticScore('Shining Force', 1992, 'Genesis', 29)
    );
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Shining Force' &&
        request.params.get('platform') === 'Genesis' &&
        request.params.get('releaseYear') === '1992' &&
        request.params.get('fuzzy') === 'true'
      );
    });
    scoreReq.flush({
      games: [
        {
          title: 'Shining Force',
          release_date: '1992-03-20',
          platforms: [{ name: 'Genesis' }],
          critic_score: null,
          moby_score: 88.2,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/'
        }
      ]
    });
    await expect(scorePromise).resolves.toEqual({
      metacriticScore: 88,
      metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/'
    });

    const candidatesPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Shining Force', 1992, 'Genesis', 29)
    );
    const candidatesReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Shining Force' &&
        request.params.get('platform') === 'Genesis' &&
        request.params.get('releaseYear') === '1992' &&
        request.params.get('fuzzy') === 'true'
      );
    });
    candidatesReq.flush({
      games: [
        {
          title: ' Shining Force ',
          release_date: '1992-03-20',
          platforms: [{ name: ' Genesis ' }],
          critic_score: 87.6,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/'
        },
        {
          title: 'Shining Force',
          release_date: '1992',
          platforms: [{ name: 'Genesis' }],
          critic_score: 87.1,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/'
        },
        {
          title: 'Shining Force CD',
          release_date: null,
          platforms: [{ name: 'Sega CD' }],
          moby_score: 80.2,
          moby_url: 'https://www.mobygames.com/game/456/shining-force-cd/'
        }
      ]
    });

    await expect(candidatesPromise).resolves.toEqual([
      {
        title: 'Shining Force',
        releaseYear: 1992,
        platform: 'Genesis',
        metacriticScore: 88,
        metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/'
      },
      {
        title: 'Shining Force CD',
        releaseYear: null,
        platform: 'Sega CD',
        metacriticScore: 80,
        metacriticUrl: 'https://www.mobygames.com/game/456/shining-force-cd/'
      }
    ]);
  });

  it('uses MobyGames when platform id is missing', async () => {
    const scorePromise = firstValueFrom(service.lookupMetacriticScore('Okami', 2006, 'Wii'));
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platform') === 'Wii' &&
        request.params.get('releaseYear') === '2006'
      );
    });
    scoreReq.flush({
      games: [
        {
          title: 'Okami',
          release_date: '2006-04-20',
          platforms: [{ name: 'Wii' }],
          moby_score: 91,
          moby_url: 'https://www.mobygames.com/game/okami/'
        }
      ]
    });

    await expect(scorePromise).resolves.toEqual({
      metacriticScore: 91,
      metacriticUrl: 'https://www.mobygames.com/game/okami/'
    });
  });

  it('looks up Metacritic candidates and normalizes candidate payload', async () => {
    const promise = firstValueFrom(service.lookupMetacriticCandidates('Okami', 2006, 'Wii', 21));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('releaseYear') === '2006' &&
        request.params.get('platform') === 'Wii'
      );
    });

    req.flush({
      candidates: [
        {
          title: ' Okami ',
          releaseYear: 2006,
          platform: ' Wii ',
          metacriticScore: 93.2,
          metacriticUrl: '//www.metacritic.com/game/okami/',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash.jpg'
        },
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 93,
          metacriticUrl: 'https://www.metacritic.com/game/okami/'
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 93,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg'
      }
    ]);
  });

  it('drops empty metacritic payloads and invalid metacritic candidates', async () => {
    const nullItemPromise = firstValueFrom(
      service.lookupMetacriticScore('Okami', undefined, undefined, 21)
    );
    const nullItemReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    nullItemReq.flush({ item: null });
    await expect(nullItemPromise).resolves.toBeNull();

    const scorePromise = firstValueFrom(
      service.lookupMetacriticScore('Okami', undefined, undefined, 21)
    );
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platformIgdbId') === '21'
      );
    });
    scoreReq.flush({
      item: {
        metacriticScore: null,
        metacriticUrl: 'ftp://invalid'
      }
    });
    await expect(scorePromise).resolves.toBeNull();

    const nonArrayCandidatePromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const nonArrayCandidateReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    nonArrayCandidateReq.flush({ candidates: {} });
    await expect(nonArrayCandidatePromise).resolves.toEqual([]);

    const candidatePromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const candidateReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    candidateReq.flush({
      candidates: [
        {
          title: '   ',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 93,
          metacriticUrl: 'https://www.metacritic.com/game/okami/'
        },
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 200,
          metacriticUrl: null
        }
      ]
    });
    await expect(candidatePromise).resolves.toEqual([]);
  });

  it('returns empty metacritic candidate list for non-rate-limit failures', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toEqual([]);
  });

  it('normalizes igdb cover urls to retina variants and keeps existing _2x variant', async () => {
    const promise = firstValueFrom(service.searchGames('metroid'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=metroid`);
    req.flush({
      items: [
        {
          igdbGameId: '1',
          title: 'Metroid',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/hash.jpg',
          coverSource: 'igdb',
          platform: 'Switch',
          releaseDate: null,
          releaseYear: null
        },
        {
          igdbGameId: '2',
          title: 'Metroid Prime',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash2.jpg',
          coverSource: 'igdb',
          platform: 'Switch',
          releaseDate: null,
          releaseYear: null
        }
      ]
    });

    await expect(promise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          igdbGameId: '1',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash.jpg'
        }),
        expect.objectContaining({
          igdbGameId: '2',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash2.jpg'
        })
      ])
    );
  });

  it('normalizes hltb candidates with coverUrl fallback and protocol-relative image URL', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimeCandidates('Okami'));
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });

    req.flush({
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
          hltbMainHours: 15,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        title: 'Okami',
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg'
      })
    ]);
  });

  it('loads cached platform list for valid payloads and returns empty for invalid payloads', () => {
    const privateService = service as unknown as {
      loadCachedPlatformList: () => Array<{ id: number; name: string }>;
    };

    localStorage.setItem(
      'game-shelf-platform-list-cache-v1',
      JSON.stringify([
        { id: 130, name: ' Nintendo Switch ' },
        { id: 130, name: 'Nintendo Switch Duplicate' },
        { id: null, name: 'Invalid' }
      ])
    );

    expect(privateService.loadCachedPlatformList()).toEqual([{ id: 130, name: 'Nintendo Switch' }]);

    localStorage.setItem('game-shelf-platform-list-cache-v1', '{bad-json');
    expect(privateService.loadCachedPlatformList()).toEqual([]);
  });

  it('parses retry-after date headers for rate limiting', async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-02-12T00:00:00.000Z'));

      const promise = firstValueFrom(service.searchGames('zelda'));
      const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=zelda`);
      req.flush(
        { message: 'rate limited' },
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: new HttpHeaders({ 'Retry-After': 'Thu, 12 Feb 2026 00:00:10 GMT' })
        }
      );

      await expect(promise).rejects.toThrowError('Rate limit exceeded. Retry after 10s.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null from toRateLimitError for non-429 errors', () => {
    const privateService = service as unknown as {
      toRateLimitError: (error: unknown) => Error | null;
    };

    const error = new HttpErrorResponse({ status: 500, statusText: 'Server Error' });
    expect(privateService.toRateLimitError(error)).toBeNull();
  });

  it('falls back to default cooldown when retry-after header is invalid', async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-02-12T00:00:00.000Z'));
      const promise = firstValueFrom(service.searchGames('chrono'));
      const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=chrono`);
      req.flush(
        { message: 'rate limited' },
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: new HttpHeaders({ 'Retry-After': 'not-a-date' })
        }
      );

      await expect(promise).rejects.toThrowError('Rate limit exceeded. Retry after 20s.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes similar game ids from mixed payload values', async () => {
    const promise = firstValueFrom(service.searchGames('persona'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=persona`);
    req.flush({
      items: [
        {
          igdbGameId: '300',
          title: 'Persona',
          coverUrl: null,
          coverSource: 'none',
          similarGameIgdbIds: ['10', ' 11 ', 'bad', 12, null, '10'],
          platform: 'PS2',
          releaseDate: null,
          releaseYear: null
        }
      ]
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        igdbGameId: '300',
        similarGameIgdbIds: ['10', '11', '12']
      })
    ]);
  });

  it('returns empty cached platform list when cache is missing', () => {
    const privateService = service as unknown as {
      loadCachedPlatformList: () => Array<{ id: number; name: string }>;
    };

    localStorage.removeItem('game-shelf-platform-list-cache-v1');
    expect(privateService.loadCachedPlatformList()).toEqual([]);
  });
});
