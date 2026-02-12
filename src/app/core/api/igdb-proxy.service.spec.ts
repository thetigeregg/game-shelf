import { HttpHeaders } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { IgdbProxyService } from './igdb-proxy.service';

describe('IgdbProxyService', () => {
  let service: IgdbProxyService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [IgdbProxyService],
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

  it('maps API response and sends q query param', async () => {
    const promise = firstValueFrom(service.searchGames('mario'));

    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/games/search`
        && request.params.get('q') === 'mario';
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
          releaseYear: 2017,
        },
      ],
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
        releaseYear: 2017,
      },
    ]);
  });

  it('includes IGDB platform id in search query params when provided', async () => {
    const promise = firstValueFrom(service.searchGames('mario', 130));

    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/games/search`
        && request.params.get('q') === 'mario'
        && request.params.get('platformIgdbId') === '130';
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
          releaseYear: 2017,
        },
      ],
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
        headers: new HttpHeaders({ 'Retry-After': '9' }),
      },
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
        releaseYear: 2017,
      },
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
        { id: null, name: 'Wii U' },
      ],
      platform: null,
      platformIgdbId: null,
      releaseDate: '2017-10-27T00:00:00.000Z',
      releaseYear: 2017,
    });
  });

  it('maps refresh endpoint failure to user-safe error', async () => {
    const promise = firstValueFrom(service.getGameById('100'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to refresh game metadata.');
  });

  it('rejects invalid IGDB game ids before HTTP call', async () => {
    await expect(firstValueFrom(service.getGameById('abc'))).rejects.toThrowError('Unable to refresh game metadata.');
    httpMock.expectNone(request => request.url.startsWith(`${environment.gameApiBaseUrl}/v1/games/`));
  });

  it('loads platform filters from bundled snapshot without HTTP', async () => {
    const promise = firstValueFrom(service.listPlatforms());
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/platforms`);

    await expect(promise).resolves.toEqual(expect.arrayContaining([
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' },
      { id: 167, name: 'PlayStation 5' },
      { id: 169, name: 'Xbox Series X|S' },
    ]));
  });

  it('searches box art results and normalizes URLs', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search`
        && request.params.get('q') === 'mario';
    });

    req.flush({
      items: [
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
        '   https://cdn.thegamesdb.net/images/original/box/front/mario-2.jpg   ',
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
        '/relative/path.jpg',
      ],
    });

    await expect(promise).resolves.toEqual([
      'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
      'https://cdn.thegamesdb.net/images/original/box/front/mario-2.jpg',
    ]);
  });

  it('includes platform in box art search query params when provided', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search`
        && request.params.get('q') === 'mario'
        && request.params.get('platform') === 'Nintendo Switch'
        && request.params.get('platformIgdbId') === '130';
    });

    req.flush({
      items: ['https://cdn.thegamesdb.net/images/original/box/front/mario.jpg'],
    });

    await expect(promise).resolves.toEqual([
      'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
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
        headers: new HttpHeaders({ 'Retry-After': '15' }),
      },
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
            { id: null, name: '' },
          ],
          platform: 'Switch',
          platformIgdbId: 130,
          releaseDate: 'not-a-date',
          releaseYear: 2024,
        },
      ],
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
        releaseYear: 2024,
      },
    ]);
  });

  it('looks up HLTB completion times and normalizes the payload', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimes('Super Metroid', 1994, 'SNES'));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/hltb/search`
        && request.params.get('q') === 'Super Metroid'
        && request.params.get('releaseYear') === '1994'
        && request.params.get('platform') === 'SNES';
    });

    req.flush({
      item: {
        hltbMainHours: 7.53,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 13.04,
      },
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 7.5,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 13,
    });
  });

  it('returns null for HLTB lookup failures', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimes('Super Metroid'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/hltb/search?q=Super%20Metroid`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toBeNull();
  });

  it('looks up HLTB candidates and normalizes candidate payload', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimeCandidates('Super Metroid', 1994, 'SNES'));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/hltb/search`
        && request.params.get('q') === 'Super Metroid'
        && request.params.get('includeCandidates') === 'true'
        && request.params.get('releaseYear') === '1994'
        && request.params.get('platform') === 'SNES';
    });

    req.flush({
      candidates: [
        {
          title: ' Super Metroid ',
          releaseYear: 1994,
          platform: ' SNES ',
          hltbMainHours: 7.53,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13.04,
        },
        {
          title: 'Super Metroid',
          releaseYear: 1994,
          platform: 'SNES',
          hltbMainHours: 7.53,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13.04,
        },
        {
          title: '',
          releaseYear: null,
          platform: null,
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Super Metroid',
        releaseYear: 1994,
        platform: 'SNES',
        hltbMainHours: 7.5,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 13,
      },
    ]);
  });

  it('returns empty HLTB candidate list for short query or lookup failure', async () => {
    await expect(firstValueFrom(service.lookupCompletionTimeCandidates('x'))).resolves.toEqual([]);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/hltb/search`);

    const promise = firstValueFrom(service.lookupCompletionTimeCandidates('Super Metroid'));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/hltb/search`
        && request.params.get('q') === 'Super Metroid'
        && request.params.get('includeCandidates') === 'true';
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
          releaseYear: null,
        },
        {
          igdbGameId: '2',
          title: 'Metroid Prime',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash2.jpg',
          coverSource: 'igdb',
          platform: 'Switch',
          releaseDate: null,
          releaseYear: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        igdbGameId: '1',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash.jpg',
      }),
      expect.objectContaining({
        igdbGameId: '2',
        coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash2.jpg',
      }),
    ]));
  });

  it('normalizes hltb candidates with coverUrl fallback and protocol-relative image URL', async () => {
    const promise = firstValueFrom(service.lookupCompletionTimeCandidates('Okami'));
    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/hltb/search`
        && request.params.get('q') === 'Okami'
        && request.params.get('includeCandidates') === 'true';
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
          hltbCompletionistHours: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        title: 'Okami',
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
      }),
    ]);
  });

  it('loads cached platform list for valid payloads and returns empty for invalid payloads', () => {
    const privateService = service as unknown as {
      loadCachedPlatformList: () => Array<{ id: number; name: string }>;
    };

    localStorage.setItem('game-shelf-platform-list-cache-v1', JSON.stringify([
      { id: 130, name: ' Nintendo Switch ' },
      { id: 130, name: 'Nintendo Switch Duplicate' },
      { id: null, name: 'Invalid' },
    ]));

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
          headers: new HttpHeaders({ 'Retry-After': 'Thu, 12 Feb 2026 00:00:10 GMT' }),
        },
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
          headers: new HttpHeaders({ 'Retry-After': 'not-a-date' }),
        },
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
          releaseYear: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        igdbGameId: '300',
        similarGameIgdbIds: ['10', '11', '12'],
      }),
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
