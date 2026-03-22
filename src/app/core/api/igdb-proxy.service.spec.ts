import { HttpHeaders, HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { IgdbProxyService } from './igdb-proxy.service';

describe('IgdbProxyService', () => {
  let service: IgdbProxyService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), IgdbProxyService],
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
          releaseYear: 2006,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        igdbGameId: '6231',
        title: 'Sonic the Hedgehog',
      }),
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
        releaseYear: 2017,
      },
    ]);
  });

  it('normalizes themes and keywords metadata when present', async () => {
    const promise = firstValueFrom(service.searchGames('zelda'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=zelda`);

    req.flush({
      items: [
        {
          igdbGameId: '200',
          title: 'The Legend of Zelda',
          coverUrl: '',
          coverSource: 'none',
          themes: [' Fantasy ', 'Fantasy', '', null],
          themeIds: [10, 10, '11', 'x'],
          keywords: [' Hyrule ', 'Hyrule', '', null],
          keywordIds: [99, 99, '100', 'x'],
          platforms: ['NES'],
          platform: 'NES',
          releaseDate: '1986-02-21T00:00:00.000Z',
          releaseYear: 1986,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        themes: ['Fantasy'],
        themeIds: [10, 11],
        keywords: ['Hyrule'],
        keywordIds: [99, 100],
      }),
    ]);
  });

  it('normalizes websites metadata when present', async () => {
    const promise = firstValueFrom(service.searchGames('halo'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=halo`);

    req.flush({
      items: [
        {
          igdbGameId: '201',
          title: 'Halo',
          coverUrl: '',
          coverSource: 'none',
          websites: [
            {
              provider: 'xbox',
              providerLabel: 'Xbox',
              url: 'https://www.xbox.com/en-US/games/store/halo/9NBLGGH12345',
              typeId: 22,
              typeName: 'Xbox',
              trusted: null,
            },
            {
              provider: 'xbox',
              providerLabel: '',
              url: 'ftp://invalid.example',
            },
            {
              provider: 'steam',
              providerLabel: 'Steam',
              url: 'https://user:pass@store.steampowered.com/app/620',
            },
            {
              provider: 'steam',
              providerLabel: 'Steam',
              url: '//store.steampowered.com/app/620',
              typeId: 13,
              typeName: 'Steam',
              trusted: true,
            },
          ],
          platforms: ['Xbox Series X|S'],
          platform: 'Xbox Series X|S',
          releaseDate: '2021-11-15T00:00:00.000Z',
          releaseYear: 2021,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        websites: [
          {
            provider: 'xbox',
            providerLabel: 'Xbox',
            url: 'https://www.xbox.com/en-US/games/store/halo/9NBLGGH12345',
            typeId: 22,
            typeName: 'Xbox',
            trusted: null,
          },
          {
            provider: 'steam',
            providerLabel: 'Steam',
            url: 'https://store.steampowered.com/app/620',
            typeId: 13,
            typeName: 'Steam',
            trusted: true,
          },
        ],
      }),
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
    await expect(promise).rejects.toThrow('Unable to load game search results.');
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
      }
    );
    await expect(withRetryAfter).rejects.toThrow('Rate limit exceeded. Retry after 9s.');

    const duringCooldown = firstValueFrom(service.searchGames('mario'));
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    await expect(duringCooldown).rejects.toThrow(/Rate limit exceeded\. Retry after \d+s\./);
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
        { id: null, name: 'Wii U' },
      ],
      platform: null,
      platformIgdbId: null,
      releaseDate: '2017-10-27T00:00:00.000Z',
      releaseYear: 2017,
    });
  });

  it('normalizes game media fields from IGDB id payload', async () => {
    const promise = firstValueFrom(service.getGameById('101'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/101`);
    req.flush({
      item: {
        igdbGameId: '101',
        title: 'Media Test',
        coverUrl: null,
        coverSource: 'igdb',
        platforms: ['Nintendo Switch'],
        platform: 'Nintendo Switch',
        platformIgdbId: 130,
        screenshots: [
          { id: 10, image_id: 'abc', width: '1280', height: '720' },
          { id: 10, image_id: 'abc' },
        ],
        videos: [
          { id: 20, name: ' Trailer ', video_id: 'PIF_fqFZEuk' },
          { id: 20, name: 'Duplicate', video_id: 'PIF_fqFZEuk' },
        ],
      },
    });

    await expect(promise).resolves.toMatchObject({
      igdbGameId: '101',
      screenshots: [
        {
          id: 10,
          imageId: 'abc',
          url: 'https://images.igdb.com/igdb/image/upload/t_720p/abc.jpg',
          width: 1280,
          height: 720,
        },
      ],
      videos: [
        {
          id: 20,
          name: 'Trailer',
          videoId: 'PIF_fqFZEuk',
          url: 'https://www.youtube.com/watch?v=PIF_fqFZEuk',
        },
      ],
    });
  });

  it('preserves normalized pricing fields from IGDB id payload', async () => {
    const promise = firstValueFrom(service.getGameById('102'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/102`);
    req.flush({
      item: {
        igdbGameId: '102',
        title: 'Pricing Test',
        coverUrl: null,
        coverSource: 'igdb',
        platforms: ['PlayStation 5'],
        platform: 'PlayStation 5',
        platformIgdbId: 167,
        priceSource: 'psprices',
        priceFetchedAt: '2026-03-11T09:30:00.000Z',
        priceAmount: '39.9',
        priceCurrency: 'chf',
        priceRegularAmount: '79.9',
        priceDiscountPercent: '50',
        priceIsFree: 'false',
        priceUrl: 'https://psprices.com/region-ch/game/123/example',
      },
    });

    await expect(promise).resolves.toMatchObject({
      igdbGameId: '102',
      title: 'Pricing Test',
      priceSource: 'psprices',
      priceFetchedAt: '2026-03-11T09:30:00.000Z',
      priceAmount: 39.9,
      priceCurrency: 'CHF',
      priceRegularAmount: 79.9,
      priceDiscountPercent: 50,
      priceIsFree: false,
      priceUrl: 'https://psprices.com/region-ch/game/123/example',
    });
  });

  it('maps refresh endpoint failure to user-safe error', async () => {
    const promise = firstValueFrom(service.getGameById('100'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrow('Unable to refresh game metadata.');
  });

  it('rejects invalid IGDB game ids before HTTP call', async () => {
    await expect(firstValueFrom(service.getGameById('abc'))).rejects.toThrow(
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
        { id: 169, name: 'Xbox Series X|S' },
      ])
    );
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
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search` &&
        request.params.get('q') === 'mario' &&
        request.params.get('platform') === 'Nintendo Switch' &&
        request.params.get('platformIgdbId') === '130'
      );
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
    await expect(promise).rejects.toThrow('Unable to load box art results.');
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
      }
    );
    await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 15s.');
  });

  it('maps box art rate limits without retry-after header', async () => {
    const promise = firstValueFrom(service.searchBoxArtByTitle('mario'));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush({ message: 'rate limited' }, { status: 429, statusText: 'Too Many Requests' });
    await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 20s.');
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
        releaseYear: 2024,
      },
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
        hltbCompletionistHours: 13.04,
        hltbGameId: 9001,
        hltbUrl: 'https://howlongtobeat.com/game/9001',
      },
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 7.5,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 13,
      hltbGameId: 9001,
      hltbUrl: 'https://howlongtobeat.com/game/9001',
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
        hltbCompletionistHours: 70.6,
      },
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 40.4,
      hltbMainExtraHours: 52.2,
      hltbCompletionistHours: 70.6,
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
          hltbGameId: 9001,
          hltbUrl: 'https://howlongtobeat.com/game/9001',
          hltbMainHours: 7.53,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 13.04,
        },
        {
          title: 'Super Metroid',
          releaseYear: 1994,
          platform: 'SNES',
          hltbGameId: 9001,
          hltbUrl: 'https://howlongtobeat.com/game/9001',
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
        hltbGameId: 9001,
        hltbUrl: 'https://howlongtobeat.com/game/9001',
        hltbMainHours: 7.5,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 13,
        isRecommended: true,
      },
    ]);
  });

  it('prefers the selected HLTB candidate identity when a preferred HLTB id is provided', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', { preferredGameId: 7002 })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('preferredHltbGameId') === '7002'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7001,
          hltbUrl: 'https://howlongtobeat.com/game/7001',
          hltbMainHours: 8,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 12,
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 9,
      hltbMainExtraHours: 11,
      hltbCompletionistHours: 13,
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
    });
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
        headers: new HttpHeaders({ 'Retry-After': '3' }),
      }
    );
    await expect(lookupPromise).rejects.toThrow('Rate limit exceeded. Retry after 3s.');

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
        headers: new HttpHeaders({ 'Retry-After': '3' }),
      }
    );
    await expect(candidatePromise).rejects.toThrow('Rate limit exceeded. Retry after 3s.');
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
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
      },
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 92,
      metacriticUrl: 'https://www.metacritic.com/game/okami/',
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
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
      },
    });
    await expect(metacriticPromise).resolves.toEqual({
      metacriticScore: 92,
      metacriticUrl: 'https://www.metacritic.com/game/okami/',
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
        request.params.get('platform') === '16' &&
        request.params.get('format') === 'normal' &&
        request.params.get('include') ===
          'title,moby_url,moby_score,critic_score,platforms,release_date,covers'
      );
    });
    mobyReq.flush({
      games: [
        {
          title: 'Shining Force',
          release_date: '1992-03-20',
          platforms: [{ platform_name: 'Genesis' }],
          moby_score: 88,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/',
        },
      ],
    });
    await expect(mobyPromise).resolves.toEqual({
      metacriticScore: 88,
      metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/',
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
        headers: new HttpHeaders({ 'Retry-After': '4' }),
      }
    );
    await expect(scorePromise).rejects.toThrow('Rate limit exceeded. Retry after 4s.');

    const candidatePromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', 2006, 'Wii', 21)
    );
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/metacritic/search`);
    await expect(candidatePromise).rejects.toThrow(/Rate limit exceeded\. Retry after \d+s\./);
  });

  it('uses MobyGames for unsupported Metacritic platform ids and normalizes payload', async () => {
    vi.useFakeTimers();

    try {
      const scorePromise = firstValueFrom(
        service.lookupMetacriticScore('Shining Force', 1992, 'Genesis', 29)
      );
      const scoreReq = httpMock.expectOne((request) => {
        return (
          request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
          request.params.get('q') === 'Shining Force' &&
          request.params.get('platform') === '16' &&
          request.params.get('format') === 'normal' &&
          request.params.get('include') ===
            'title,moby_url,moby_score,critic_score,platforms,release_date,covers'
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
            moby_url: 'https://www.mobygames.com/game/123/shining-force/',
          },
        ],
      });
      await expect(scorePromise).resolves.toEqual({
        metacriticScore: 88,
        metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/',
      });

      // Advance the proactive throttle so the second MobyGames call fires
      const candidatesPromise = firstValueFrom(
        service.lookupMetacriticCandidates('Shining Force', 1992, 'Genesis', 29)
      );
      await vi.advanceTimersByTimeAsync(5000);
      const candidatesReq = httpMock.expectOne((request) => {
        return (
          request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
          request.params.get('q') === 'Shining Force' &&
          request.params.get('platform') === '16' &&
          request.params.get('format') === 'normal' &&
          request.params.get('include') ===
            'title,moby_url,moby_score,critic_score,platforms,release_date,covers'
        );
      });
      candidatesReq.flush({
        games: [
          {
            title: ' Shining Force ',
            release_date: '1992-03-20',
            platforms: [{ platform_name: ' Genesis ' }],
            critic_score: 87.6,
            covers: [
              {
                images: [
                  {
                    thumbnail_url: 'https://cdn.mobygames.com/covers/shining-force-thumb.webp',
                  },
                ],
              },
            ],
            moby_url: 'https://www.mobygames.com/game/123/shining-force/',
          },
          {
            title: 'Shining Force',
            release_date: '1992',
            platforms: [{ platform_name: 'Genesis' }],
            critic_score: 87.1,
            moby_url: 'https://www.mobygames.com/game/123/shining-force/',
          },
          {
            title: 'Shining Force CD',
            release_date: null,
            platforms: [{ name: 'Sega CD' }],
            moby_score: 80.2,
            moby_url: 'https://www.mobygames.com/game/456/shining-force-cd/',
          },
        ],
      });

      await expect(candidatesPromise).resolves.toEqual([
        {
          title: 'Shining Force',
          releaseYear: 1992,
          platform: 'Genesis',
          metacriticScore: 88,
          metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/',
          isRecommended: true,
        },
        {
          title: 'Shining Force CD',
          releaseYear: null,
          platform: 'Sega CD',
          metacriticScore: 80,
          metacriticUrl: 'https://www.mobygames.com/game/456/shining-force-cd/',
          isRecommended: false,
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('converts Moby score out of 10 to internal 100-point scale', async () => {
    const scorePromise = firstValueFrom(
      service.lookupMetacriticScore('Chrono Trigger', 1995, 'SNES', 19)
    );
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Chrono Trigger' &&
        request.params.get('platform') === '15'
      );
    });

    scoreReq.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: '1995-03-11',
          platforms: [{ platform_name: 'SNES' }],
          critic_score: null,
          moby_score: 8.6,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        },
      ],
    });

    await expect(scorePromise).resolves.toEqual({
      metacriticScore: 86,
      metacriticUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
    });
  });

  it('uses canonical IGDB platform mapping for aliased platform ids in MobyGames lookups', async () => {
    const scorePromise = firstValueFrom(
      service.lookupReviewScore('Chrono Trigger', 1995, 'Super Famicom', 58)
    );
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Chrono Trigger' &&
        request.params.get('platform') === '15'
      );
    });

    scoreReq.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: '1995-03-11',
          platforms: [{ platform_name: 'SNES' }],
          critic_score: null,
          moby_score: 8.6,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        },
      ],
    });

    await expect(scorePromise).resolves.toEqual({
      reviewScore: 86,
      reviewUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
      reviewSource: 'mobygames',
      mobyScore: 8.6,
      mobygamesGameId: null,
      metacriticScore: null,
      metacriticUrl: null,
    });
  });

  it('uses canonical IGDB platform mapping from aliased platform name when id is missing', async () => {
    const scorePromise = firstValueFrom(
      service.lookupReviewScore('Chrono Trigger', 1995, 'Super Famicom', null)
    );
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Chrono Trigger' &&
        request.params.get('platform') === '15'
      );
    });

    scoreReq.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: '1995-03-11',
          platforms: [{ platform_name: 'SNES' }],
          critic_score: null,
          moby_score: 8.6,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        },
      ],
    });

    await expect(scorePromise).resolves.toEqual({
      reviewScore: 86,
      reviewUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
      reviewSource: 'mobygames',
      mobyScore: 8.6,
      mobygamesGameId: null,
      metacriticScore: null,
      metacriticUrl: null,
    });
  });

  it('resolves all current aliased platforms to canonical MobyGames platform ids', () => {
    const privateService = service as unknown as {
      resolveMobyGamesPlatformIdForIgdbPlatform: (
        platformIgdbId: number | null,
        platformName: string | null | undefined
      ) => number | null;
    };
    const aliasCases: Array<{
      platformIgdbId: number | null;
      platformName: string;
      expectedMobyPlatformId: number;
    }> = [
      { platformIgdbId: 99, platformName: 'Family Computer', expectedMobyPlatformId: 22 },
      {
        platformIgdbId: 51,
        platformName: 'Family Computer Disk System',
        expectedMobyPlatformId: 22,
      },
      { platformIgdbId: 58, platformName: 'Super Famicom', expectedMobyPlatformId: 15 },
      { platformIgdbId: 137, platformName: 'New Nintendo 3DS', expectedMobyPlatformId: 101 },
      { platformIgdbId: 159, platformName: 'Nintendo DSi', expectedMobyPlatformId: 44 },
      { platformIgdbId: 510, platformName: 'e-Reader / Card-e Reader', expectedMobyPlatformId: 12 },
      { platformIgdbId: null, platformName: 'Family Computer', expectedMobyPlatformId: 22 },
      {
        platformIgdbId: null,
        platformName: 'Family Computer Disk System',
        expectedMobyPlatformId: 22,
      },
      { platformIgdbId: null, platformName: 'Super Famicom', expectedMobyPlatformId: 15 },
      { platformIgdbId: null, platformName: 'New Nintendo 3DS', expectedMobyPlatformId: 101 },
      { platformIgdbId: null, platformName: 'Nintendo DSi', expectedMobyPlatformId: 44 },
      {
        platformIgdbId: null,
        platformName: 'e-Reader / Card-e Reader',
        expectedMobyPlatformId: 12,
      },
    ];

    for (const testCase of aliasCases) {
      expect(
        privateService.resolveMobyGamesPlatformIdForIgdbPlatform(
          testCase.platformIgdbId,
          testCase.platformName
        )
      ).toBe(testCase.expectedMobyPlatformId);
    }
  });

  it('prefers Moby cover image matching selected platform id', async () => {
    const candidatesPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Shining Force', 1992, 'Genesis', 29)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Shining Force' &&
        request.params.get('platform') === '16'
      );
    });

    req.flush({
      games: [
        {
          title: 'Shining Force',
          release_date: '1992-03-20',
          platforms: [{ platform_name: 'Genesis' }],
          moby_score: 88,
          moby_url: 'https://www.mobygames.com/game/123/shining-force/',
          covers: [
            {
              platforms: [81],
              images: [{ thumbnail_url: 'https://cdn.mobygames.com/covers/wrong-platform.webp' }],
            },
            {
              platforms: [16],
              images: [{ thumbnail_url: 'https://cdn.mobygames.com/covers/genesis.webp' }],
            },
          ],
        },
      ],
    });

    await expect(candidatesPromise).resolves.toEqual([
      {
        title: 'Shining Force',
        releaseYear: 1992,
        platform: 'Genesis',
        metacriticScore: 88,
        metacriticUrl: 'https://www.mobygames.com/game/123/shining-force/',
        isRecommended: true,
        imageUrl: 'https://cdn.mobygames.com/covers/genesis.webp',
      },
    ]);
  });

  it('prefers the selected HLTB candidate identity when a preferred HLTB url is provided', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredUrl: '  https://howlongtobeat.com/game/7002  ',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('preferredHltbUrl') === 'https://howlongtobeat.com/game/7002'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7001,
          hltbUrl: 'https://howlongtobeat.com/game/7001',
          hltbMainHours: 8,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 12,
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 9,
      hltbMainExtraHours: 11,
      hltbCompletionistHours: 13,
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
    });
  });

  it('falls back to the normal HLTB item when preferred candidates are omitted from the response', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredUrl: 'https://howlongtobeat.com/game/7002',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('preferredHltbUrl') === 'https://howlongtobeat.com/game/7002' &&
        request.params.get('includeCandidates') === 'true'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
      },
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 8,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 12,
      hltbGameId: 7001,
      hltbUrl: 'https://howlongtobeat.com/game/7001',
    });
  });

  it('matches preferred HLTB candidates when only one identity field is present', async () => {
    const byIdPromise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredGameId: 7002,
      })
    );
    const byIdRequest = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('preferredHltbGameId') === '7002'
      );
    });
    byIdRequest.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbUrl: 'https://howlongtobeat.com/game/7001',
          hltbMainHours: 8,
          hltbMainExtraHours: 10,
          hltbCompletionistHours: 12,
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
        },
      ],
    });

    await expect(byIdPromise).resolves.toEqual({
      hltbMainHours: 9,
      hltbMainExtraHours: 11,
      hltbCompletionistHours: 13,
      hltbGameId: 7002,
    });

    const byUrlPromise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredUrl: 'https://howlongtobeat.com/game/7003',
      })
    );
    const byUrlRequest = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('preferredHltbUrl') === 'https://howlongtobeat.com/game/7003'
      );
    });
    byUrlRequest.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7003,
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbUrl: 'https://howlongtobeat.com/game/7003',
          hltbMainHours: 10,
          hltbMainExtraHours: 12,
          hltbCompletionistHours: 14,
        },
      ],
    });

    await expect(byUrlPromise).resolves.toEqual({
      hltbMainHours: 10,
      hltbMainExtraHours: 12,
      hltbCompletionistHours: 14,
      hltbUrl: 'https://howlongtobeat.com/game/7003',
    });
  });

  it('normalizes HLTB identity helpers and preserves distinct duplicate-looking candidates', () => {
    const privateService = service as unknown as {
      normalizeCompletionTimes: (value: unknown) => unknown;
      normalizeHltbCandidates: (value: unknown) => unknown;
      toHltbCompletionTimes: (value: unknown) => unknown;
      normalizeHltbGameId: (value: unknown) => unknown;
      normalizeHltbUrl: (value: unknown) => unknown;
    };

    expect(
      privateService.normalizeCompletionTimes({
        hltbMainHours: 9,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        gameId: '7002',
        gameUrl: '//howlongtobeat.com/game/7002',
      })
    ).toEqual({
      hltbMainHours: 9,
      hltbMainExtraHours: null,
      hltbCompletionistHours: null,
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
    });

    expect(
      privateService.normalizeCompletionTimes({
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null,
        gameId: '7002',
        gameUrl: '//howlongtobeat.com/game/7002',
      })
    ).toBeNull();

    expect(
      privateService.normalizeHltbCandidates([
        {
          title: ' Night In The Woods ',
          releaseYear: 2017,
          platform: ' PC ',
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
          gameId: '7002',
          gameUrl: '//howlongtobeat.com/game/7002',
          coverUrl: '//howlongtobeat.com/games/7002.jpg',
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbMainHours: 10,
          hltbMainExtraHours: 12,
          hltbCompletionistHours: 14,
          id: '7003',
          url: 'https://howlongtobeat.com/game/7003',
        },
      ])
    ).toEqual([
      {
        title: 'Night In The Woods',
        releaseYear: 2017,
        platform: 'PC',
        hltbMainHours: 9,
        hltbMainExtraHours: 11,
        hltbCompletionistHours: 13,
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
        isRecommended: true,
      },
      {
        title: 'Night In The Woods',
        releaseYear: 2017,
        platform: 'PC',
        hltbMainHours: 10,
        hltbMainExtraHours: 12,
        hltbCompletionistHours: 14,
        hltbGameId: 7003,
        hltbUrl: 'https://howlongtobeat.com/game/7003',
        isRecommended: false,
      },
    ]);

    expect(
      privateService.toHltbCompletionTimes({
        hltbMainHours: 10,
        hltbMainExtraHours: 12,
        hltbCompletionistHours: 14,
        hltbGameId: 7003,
        hltbUrl: 'https://howlongtobeat.com/game/7003',
      })
    ).toEqual({
      hltbMainHours: 10,
      hltbMainExtraHours: 12,
      hltbCompletionistHours: 14,
      hltbGameId: 7003,
      hltbUrl: 'https://howlongtobeat.com/game/7003',
    });

    expect(privateService.normalizeHltbGameId('abc')).toBeNull();
    expect(privateService.normalizeHltbUrl('//howlongtobeat.com/game/7004')).toBe(
      'https://howlongtobeat.com/game/7004'
    );
  });

  it('falls back to the normal HLTB item when the preferred candidate has no completion time data', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredGameId: 7002,
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('preferredHltbGameId') === '7002'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 8,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 12,
      hltbGameId: 7001,
      hltbUrl: 'https://howlongtobeat.com/game/7001',
    });
  });

  it('returns null when a preferred HLTB candidate exists but neither it nor the item has usable times', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredGameId: 7002,
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('releaseYear') === '2017' &&
        request.params.get('platform') === 'PC' &&
        request.params.get('preferredHltbGameId') === '7002' &&
        request.params.get('includeCandidates') === 'true'
      );
    });

    req.flush({
      item: null,
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        },
      ],
    });

    await expect(promise).resolves.toBeNull();
  });

  it('falls back to the normal HLTB item when preferred identity does not match any candidate', async () => {
    const promise = firstValueFrom(
      service.lookupCompletionTimes('Night In The Woods', 2017, 'PC', {
        preferredGameId: 9999,
        preferredUrl: 'https://howlongtobeat.com/game/9999',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/hltb/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('preferredHltbGameId') === '9999' &&
        request.params.get('preferredHltbUrl') === 'https://howlongtobeat.com/game/9999'
      );
    });

    req.flush({
      item: {
        hltbMainHours: 8,
        hltbMainExtraHours: 10,
        hltbCompletionistHours: 12,
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PC',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          hltbMainHours: 9,
          hltbMainExtraHours: 11,
          hltbCompletionistHours: 13,
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      hltbMainHours: 8,
      hltbMainExtraHours: 10,
      hltbCompletionistHours: 12,
      hltbGameId: 7001,
      hltbUrl: 'https://howlongtobeat.com/game/7001',
    });
  });

  it('uses matched platform entry instead of first platform entry for Moby candidates', async () => {
    const candidatesPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Chrono Trigger', 1995, 'SNES', 19)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Chrono Trigger' &&
        request.params.get('platform') === '15'
      );
    });

    req.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: '1995-03-11',
          platforms: [
            { platform_id: 14, platform_name: 'PlayStation' },
            { platform_id: 15, platform_name: 'SNES' },
          ],
          moby_score: 95,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
          covers: [
            {
              platforms: [{ platform_name: 'Nintendo DS' }],
              images: [{ thumbnail_url: 'https://cdn.mobygames.com/covers/chrono-ds.webp' }],
            },
            {
              platforms: [{ platform_id: 15, platform_name: 'SNES' }],
              images: [{ thumbnail_url: 'https://cdn.mobygames.com/covers/chrono-snes.webp' }],
            },
          ],
        },
      ],
    });

    await expect(candidatesPromise).resolves.toEqual([
      {
        title: 'Chrono Trigger',
        releaseYear: 1995,
        platform: 'SNES',
        metacriticScore: 95,
        metacriticUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        isRecommended: true,
        imageUrl: 'https://cdn.mobygames.com/covers/chrono-snes.webp',
      },
    ]);
  });

  it('prefers Moby cover image URL containing preferred platform token when cover platform tags are missing', async () => {
    const candidatesPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Chrono Trigger', 1995, 'SNES', 19)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Chrono Trigger' &&
        request.params.get('platform') === '15'
      );
    });

    req.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: '1995-03-11',
          platforms: [{ platform_id: 15, platform_name: 'SNES' }],
          moby_score: 95,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
          covers: [
            {
              images: [
                {
                  thumbnail_url: 'https://cdn.mobygames.com/covers/chrono-trigger-nintendo-ds.webp',
                },
              ],
            },
            {
              images: [
                {
                  thumbnail_url: 'https://cdn.mobygames.com/covers/chrono-trigger-snes.webp',
                },
              ],
            },
          ],
        },
      ],
    });

    await expect(candidatesPromise).resolves.toEqual([
      {
        title: 'Chrono Trigger',
        releaseYear: 1995,
        platform: 'SNES',
        metacriticScore: 95,
        metacriticUrl: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        isRecommended: true,
      },
    ]);
  });

  it('uses MobyGames when platform id is missing', async () => {
    const scorePromise = firstValueFrom(service.lookupMetacriticScore('Okami', 2006, 'Wii'));
    const scoreReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('platform') === '82' &&
        request.params.get('releaseYear') === null &&
        request.params.get('format') === 'normal' &&
        request.params.get('include') ===
          'title,moby_url,moby_score,critic_score,platforms,release_date,covers'
      );
    });
    scoreReq.flush({
      games: [
        {
          title: 'Okami',
          release_date: '2006-04-20',
          platforms: [{ name: 'Wii' }],
          moby_score: 91,
          moby_url: 'https://www.mobygames.com/game/okami/',
        },
      ],
    });

    await expect(scorePromise).resolves.toEqual({
      metacriticScore: 91,
      metacriticUrl: 'https://www.mobygames.com/game/okami/',
    });
  });

  it('forwards preferred review urls through the Metacritic score wrapper', async () => {
    const reviewResult = {
      reviewScore: 87,
      reviewUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
      reviewSource: 'metacritic' as const,
      mobyScore: null,
      mobygamesGameId: null,
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
    };
    const reviewSpy = vi.spyOn(service, 'lookupReviewScore').mockReturnValue(of(reviewResult));

    const result = await firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );

    expect(reviewSpy).toHaveBeenCalledWith(
      'Night In The Woods',
      2017,
      'PlayStation 5',
      167,
      undefined,
      'https://www.metacritic.com/game/night-in-the-woods-alt/'
    );
    expect(result).toEqual({
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
    });
  });

  it('converts normalized review candidates into review score results', () => {
    const privateService = service as unknown as {
      toReviewScoreResult: (candidate: unknown) => unknown;
    };

    expect(
      privateService.toReviewScoreResult({
        reviewScore: null,
        reviewUrl: null,
        reviewSource: null,
        mobyScore: 88,
        mobygamesGameId: 1234,
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
      })
    ).toEqual({
      reviewScore: 91,
      reviewUrl: 'https://www.metacritic.com/game/okami/',
      reviewSource: null,
      mobyScore: 88,
      mobygamesGameId: 1234,
      metacriticScore: 91,
      metacriticUrl: 'https://www.metacritic.com/game/okami/',
    });
  });

  it('prefers direct review fields when converting review candidates into review score results', () => {
    const privateService = service as unknown as {
      toReviewScoreResult: (candidate: unknown) => unknown;
    };

    expect(
      privateService.toReviewScoreResult({
        reviewScore: 83,
        reviewUrl: 'https://www.mobygames.com/game/123',
        reviewSource: 'mobygames',
        mobyScore: 83,
        mobygamesGameId: 123,
        metacriticScore: null,
        metacriticUrl: null,
      })
    ).toEqual({
      reviewScore: 83,
      reviewUrl: 'https://www.mobygames.com/game/123',
      reviewSource: 'mobygames',
      mobyScore: 83,
      mobygamesGameId: 123,
      metacriticScore: null,
      metacriticUrl: null,
    });
  });

  it('returns explicit null review fields when converting candidates with no review urls or scores', () => {
    const privateService = service as unknown as {
      toReviewScoreResult: (candidate: unknown) => unknown;
    };

    expect(
      privateService.toReviewScoreResult({
        reviewScore: null,
        reviewUrl: null,
        reviewSource: 'metacritic',
        mobyScore: null,
        mobygamesGameId: null,
        metacriticScore: null,
        metacriticUrl: null,
      })
    ).toEqual({
      reviewScore: null,
      reviewUrl: null,
      reviewSource: 'metacritic',
      mobyScore: null,
      mobygamesGameId: null,
      metacriticScore: null,
      metacriticUrl: null,
    });
  });

  it('omits HLTB identity fields when converting candidates without stable identity', () => {
    const privateService = service as unknown as {
      toHltbCompletionTimes: (value: unknown) => unknown;
    };

    expect(
      privateService.toHltbCompletionTimes({
        hltbMainHours: 10,
        hltbMainExtraHours: 12,
        hltbCompletionistHours: 14,
        hltbGameId: null,
        hltbUrl: null,
      })
    ).toEqual({
      hltbMainHours: 10,
      hltbMainExtraHours: 12,
      hltbCompletionistHours: 14,
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
      item: {
        metacriticScore: 93,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
      },
      candidates: [
        {
          title: ' Okami ',
          releaseYear: 2006,
          platform: ' Wii ',
          metacriticScore: 93.2,
          metacriticUrl: '//www.metacritic.com/game/okami/',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
        },
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 93,
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 93,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        isRecommended: true,
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
      },
    ]);
  });

  it('falls back to the main Metacritic item when a preferred review url does not match any candidate', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('preferredReviewUrl') ===
          'https://www.metacritic.com/game/night-in-the-woods-alt/'
      );
    });

    req.flush({
      item: {
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          reviewScore: 86,
          reviewUrl: 'https://www.metacritic.com/game/night-in-the-woods-candidate/',
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
    });
  });

  it('falls back to the main Metacritic item when preferred review candidates are omitted', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('preferredReviewUrl') ===
          'https://www.metacritic.com/game/night-in-the-woods-alt/'
      );
    });

    req.flush({
      item: {
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
      },
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
    });
  });

  it('matches a preferred review candidate when only metacriticUrl is present and item is omitted', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('preferredReviewUrl') ===
          'https://www.metacritic.com/game/night-in-the-woods-alt/'
      );
    });

    req.flush({
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          reviewScore: 86,
          reviewUrl: null,
          metacriticScore: 86,
          metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 86,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
    });
  });

  it('matches a preferred review url against metacriticUrl when reviewUrl is missing', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('preferredReviewUrl') ===
          'https://www.metacritic.com/game/night-in-the-woods-alt/'
      );
    });

    req.flush({
      item: {
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          reviewScore: 86,
          reviewUrl: null,
          metacriticScore: 86,
          metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 86,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
    });
  });

  it('prefers the selected Metacritic candidate url when a preferred review url is provided', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-alt/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('platformIgdbId') === '167'
      );
    });

    req.flush({
      item: {
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          metacriticScore: 87,
          metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
        },
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          metacriticScore: 88,
          metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 88,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
    });
  });

  it('falls back to the normal Metacritic item when preferred review url does not match a candidate', async () => {
    const promise = firstValueFrom(
      service.lookupMetacriticScore(
        'Night In The Woods',
        2017,
        'PlayStation 5',
        167,
        'https://www.metacritic.com/game/night-in-the-woods-missing/'
      )
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Night In The Woods' &&
        request.params.get('includeCandidates') === 'true' &&
        request.params.get('platformIgdbId') === '167'
      );
    });

    req.flush({
      item: {
        metacriticScore: 87,
        metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
      },
      candidates: [
        {
          title: 'Night In The Woods',
          releaseYear: 2017,
          platform: 'PlayStation 5',
          metacriticScore: 88,
          metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods-alt/',
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      metacriticScore: 87,
      metacriticUrl: 'https://www.metacritic.com/game/night-in-the-woods/',
    });
  });

  it('marks recommended Metacritic candidates for score and index fallbacks', async () => {
    const scoreFallbackPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const scoreFallbackReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    scoreFallbackReq.flush({
      item: {
        metacriticScore: 88,
        metacriticUrl: null,
      },
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 88,
          metacriticUrl: null,
        },
        {
          title: 'Okamiden',
          releaseYear: 2011,
          platform: 'Nintendo DS',
          metacriticScore: 80,
          metacriticUrl: null,
        },
      ],
    });
    await expect(scoreFallbackPromise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 88,
        metacriticUrl: null,
        isRecommended: true,
      },
      {
        title: 'Okamiden',
        releaseYear: 2011,
        platform: 'Nintendo DS',
        metacriticScore: 80,
        metacriticUrl: null,
        isRecommended: false,
      },
    ]);

    const tiedScoreFallbackPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const tiedScoreFallbackReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    tiedScoreFallbackReq.flush({
      item: {
        metacriticScore: 88,
        metacriticUrl: null,
      },
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 88,
          metacriticUrl: null,
        },
        {
          title: 'Okami HD',
          releaseYear: 2012,
          platform: 'PlayStation 3',
          metacriticScore: 88,
          metacriticUrl: null,
        },
      ],
    });
    await expect(tiedScoreFallbackPromise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 88,
        metacriticUrl: null,
        isRecommended: true,
      },
      {
        title: 'Okami HD',
        releaseYear: 2012,
        platform: 'PlayStation 3',
        metacriticScore: 88,
        metacriticUrl: null,
        isRecommended: false,
      },
    ]);

    const indexFallbackPromise = firstValueFrom(
      service.lookupMetacriticCandidates('Okami', undefined, undefined, 21)
    );
    const indexFallbackReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });
    indexFallbackReq.flush({
      item: {
        metacriticScore: null,
        metacriticUrl: null,
      },
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 91,
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
        },
        {
          title: 'Okamiden',
          releaseYear: 2011,
          platform: 'Nintendo DS',
          metacriticScore: 80,
          metacriticUrl: 'https://www.metacritic.com/game/okamiden/',
        },
      ],
    });
    await expect(indexFallbackPromise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        isRecommended: true,
      },
      {
        title: 'Okamiden',
        releaseYear: 2011,
        platform: 'Nintendo DS',
        metacriticScore: 80,
        metacriticUrl: 'https://www.metacritic.com/game/okamiden/',
        isRecommended: false,
      },
    ]);
  });

  it('falls back to the first Metacritic candidate when the preferred result does not match by url or score', async () => {
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

    req.flush({
      item: {
        metacriticScore: 99,
        metacriticUrl: 'https://www.metacritic.com/game/missing/',
      },
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 91,
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
        },
        {
          title: 'Okamiden',
          releaseYear: 2011,
          platform: 'Nintendo DS',
          metacriticScore: 80,
          metacriticUrl: 'https://www.metacritic.com/game/okamiden/',
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        isRecommended: true,
      },
      {
        title: 'Okamiden',
        releaseYear: 2011,
        platform: 'Nintendo DS',
        metacriticScore: 80,
        metacriticUrl: 'https://www.metacritic.com/game/okamiden/',
        isRecommended: false,
      },
    ]);
  });

  it('sanitizes metacritic platform aliases on normalized review candidates', async () => {
    const promise = firstValueFrom(
      service.lookupReviewCandidates('Okami', undefined, undefined, 21)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/metacritic/search` &&
        request.params.get('q') === 'Okami' &&
        request.params.get('includeCandidates') === 'true'
      );
    });

    req.flush({
      item: {
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
      },
      candidates: [
        {
          title: ' Okami ',
          releaseYear: 2006,
          platform: ' Wii ',
          metacriticPlatforms: [' Wii ', '', null, 'PlayStation 2', 7],
          metacriticScore: 91,
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        reviewScore: 91,
        reviewUrl: 'https://www.metacritic.com/game/okami/',
        reviewSource: 'metacritic',
        mobyScore: null,
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        metacriticPlatforms: ['Wii', 'PlayStation 2'],
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
        isRecommended: true,
      },
    ]);
  });

  it('preserves metacritic platform aliases when mapping review candidates to legacy candidates', async () => {
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

    req.flush({
      candidates: [
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticPlatforms: ['Wii', 'PlayStation 2'],
          metacriticScore: 91,
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      {
        title: 'Okami',
        releaseYear: 2006,
        platform: 'Wii',
        metacriticPlatforms: ['Wii', 'PlayStation 2'],
        metacriticScore: 91,
        metacriticUrl: 'https://www.metacritic.com/game/okami/',
        isRecommended: true,
      },
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
        metacriticUrl: 'ftp://invalid',
      },
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
          metacriticUrl: 'https://www.metacritic.com/game/okami/',
        },
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          metacriticScore: 200,
          metacriticUrl: null,
        },
      ],
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

    await expect(promise).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          igdbGameId: '1',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash.jpg',
        }),
        expect.objectContaining({
          igdbGameId: '2',
          coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/hash2.jpg',
        }),
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
          hltbGameId: 9001,
          hltbUrl: 'https://howlongtobeat.com/game/9001',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
          hltbMainHours: 15,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        },
        {
          title: 'Okami',
          releaseYear: 2006,
          platform: 'Wii',
          hltbGameId: 9002,
          hltbUrl: 'https://howlongtobeat.com/game/9002',
          coverUrl: '//images.igdb.com/igdb/image/upload/t_thumb/hash-2.jpg',
          hltbMainHours: 16,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
        },
      ],
    });

    await expect(promise).resolves.toEqual([
      expect.objectContaining({
        title: 'Okami',
        hltbGameId: 9001,
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash.jpg',
      }),
      expect.objectContaining({
        title: 'Okami',
        hltbGameId: 9002,
        imageUrl: 'https://images.igdb.com/igdb/image/upload/t_thumb/hash-2.jpg',
      }),
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
        { id: null, name: 'Invalid' },
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
          headers: new HttpHeaders({ 'Retry-After': 'Thu, 12 Feb 2026 00:00:10 GMT' }),
        }
      );

      await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 10s.');
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
        }
      );

      await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 20s.');
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

  it('returns empty cached platform list when cache is non-array JSON', () => {
    const privateService = service as unknown as {
      loadCachedPlatformList: () => Array<{ id: number; name: string }>;
    };

    localStorage.setItem('game-shelf-platform-list-cache-v1', JSON.stringify({ foo: 'bar' }));
    expect(privateService.loadCachedPlatformList()).toEqual([]);
  });

  it('uses MobyGames with known game id and sets id param in request', async () => {
    const scorePromise = firstValueFrom(
      service.lookupReviewScore('Final Fantasy VI', 1994, 'SNES', 19, 1597)
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search` &&
        request.params.get('q') === 'Final Fantasy VI' &&
        request.params.get('id') === '1597' &&
        request.params.get('platform') === '15'
      );
    });
    req.flush({
      games: [
        {
          game_id: 1597,
          title: 'Final Fantasy III',
          release_date: '1994-10-20',
          platforms: [{ platform_id: 15, platform_name: 'SNES' }],
          moby_score: 9.1,
          moby_url: 'https://www.mobygames.com/game/1597/final-fantasy-iii/',
        },
      ],
    });

    const result = await scorePromise;
    expect(result).not.toBeNull();
    expect(result?.reviewUrl).toContain('mobygames.com');
  });

  it('normalizes Moby release date via Date.parse fallback for non-ISO formats', async () => {
    const candidatesPromise = firstValueFrom(
      service.lookupReviewCandidates('Chrono Trigger', null, 'SNES', 19)
    );
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`;
    });
    req.flush({
      games: [
        {
          title: 'Chrono Trigger',
          release_date: 'March 11, 1995',
          platforms: [{ platform_name: 'SNES' }],
          moby_score: 9.5,
          moby_url: 'https://www.mobygames.com/game/4501/chrono-trigger/',
        },
      ],
    });

    const results = await candidatesPromise;
    expect(results).toHaveLength(1);
    expect(results[0]?.releaseYear).toBe(1995);
  });

  it('returns null platform for MobyGames results with no matching platform', async () => {
    const candidatesPromise = firstValueFrom(
      service.lookupReviewCandidates('Unknown Game', null, 'Atari 2600', 59)
    );
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`;
    });
    req.flush({
      games: [
        {
          title: 'Unknown Game',
          release_date: '1984',
          platforms: null,
          moby_score: 7.0,
          moby_url: 'https://www.mobygames.com/game/9999/unknown-game/',
        },
      ],
    });

    const results = await candidatesPromise;
    expect(results).toHaveLength(1);
    expect(results[0]?.platform).toBeNull();
  });

  it('enforces active cooldown in lookupReviewScore for MobyGames path', async () => {
    const firstRequest = firstValueFrom(
      service.lookupReviewScore('Final Fantasy VI', 1994, 'SNES', 19)
    );
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`;
    });
    req.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '10' }),
      }
    );
    await expect(firstRequest).rejects.toThrow('Rate limit exceeded. Retry after 10s.');

    const duringCooldown = firstValueFrom(
      service.lookupReviewScore('Chrono Trigger', 1995, 'SNES', 19)
    );
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);
    await expect(duringCooldown).rejects.toThrow(/Rate limit exceeded\. Retry after \d+s\./);
  });

  it('enforces active cooldown in lookupReviewCandidates for MobyGames path', async () => {
    const firstRequest = firstValueFrom(
      service.lookupReviewCandidates('Shining Force', 1992, 'Genesis', 29)
    );
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`;
    });
    req.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '8' }),
      }
    );
    await expect(firstRequest).rejects.toThrow('Rate limit exceeded. Retry after 8s.');

    const duringCooldown = firstValueFrom(
      service.lookupReviewCandidates('Golden Axe', 1989, 'Genesis', 29)
    );
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);
    await expect(duringCooldown).rejects.toThrow(/Rate limit exceeded\. Retry after \d+s\./);
  });

  it('proactively throttles rapid sequential lookupReviewScore MobyGames calls', async () => {
    vi.useFakeTimers();

    try {
      // First call: slot is free, no delay
      const firstPromise = firstValueFrom(
        service.lookupReviewScore('Final Fantasy VI', 1994, 'SNES', 19)
      );
      const firstReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      firstReq.flush({ games: [] });
      await firstPromise;

      // Second call immediately: slot not yet available, must wait ~5000 ms
      const secondPromise = firstValueFrom(
        service.lookupReviewScore('Chrono Trigger', 1995, 'SNES', 19)
      );
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);

      // After advancing time the deferred request fires
      await vi.advanceTimersByTimeAsync(5000);
      const secondReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      secondReq.flush({ games: [] });
      await secondPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('proactively throttles rapid sequential lookupReviewCandidates MobyGames calls', async () => {
    vi.useFakeTimers();

    try {
      // First call: no delay
      const firstPromise = firstValueFrom(
        service.lookupReviewCandidates('Shining Force', 1992, 'Genesis', 29)
      );
      const firstReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      firstReq.flush({ games: [] });
      await firstPromise;

      // Second call immediately: must wait ~5000 ms before HTTP fires
      const secondPromise = firstValueFrom(
        service.lookupReviewCandidates('Golden Axe', 1989, 'Genesis', 29)
      );
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);

      await vi.advanceTimersByTimeAsync(5000);
      const secondReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      secondReq.flush({ games: [] });
      await secondPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('spaces five simultaneous MobyGames lookupReviewScore calls 5 s apart', async () => {
    vi.useFakeTimers();

    try {
      const titles = ['Game A', 'Game B', 'Game C', 'Game D', 'Game E'];
      const promises = titles.map((title) =>
        firstValueFrom(service.lookupReviewScore(title, 2000, 'SNES', 19))
      );

      // Only the first request should be pending immediately
      const firstReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      firstReq.flush({ games: [] });
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);

      // Each subsequent request fires after another 5 s
      for (let i = 1; i < titles.length; i++) {
        await vi.advanceTimersByTimeAsync(5000);
        const req = httpMock.expectOne(
          (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
        );
        req.flush({ games: [] });
      }

      await Promise.all(promises);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null for non-rate-limit MobyGames errors in lookupReviewScore', async () => {
    const promise = firstValueFrom(service.lookupReviewScore('Final Fantasy VI', 1994, 'SNES', 19));
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
    );
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toBeNull();
  });

  it('returns empty list for non-rate-limit MobyGames errors in lookupReviewCandidates', async () => {
    const promise = firstValueFrom(
      service.lookupReviewCandidates('Shining Force', 1992, 'Genesis', 29)
    );
    const req = httpMock.expectOne(
      (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
    );
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).resolves.toEqual([]);
  });

  it('cancels queued lookupReviewCandidates when cooldown activates during throttle delay', async () => {
    vi.useFakeTimers();

    try {
      // First subscribe fires immediately (mobyDelayMs=0, no cooldown active yet)
      const firstPromise = firstValueFrom(
        service.lookupReviewCandidates('Shining Force', 1992, 'Genesis', 29)
      );

      // Second subscribe queued with 5 s delay; the cooldown pre-check passes (cooldown not active yet)
      const secondPromise = firstValueFrom(
        service.lookupReviewCandidates('Golden Axe', 1989, 'Genesis', 29)
      );

      // Flush first request with 429 → activates rateLimitCooldownUntilMs (T + 10 s)
      const firstReq = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      firstReq.flush(
        { message: 'rate limited' },
        {
          status: 429,
          statusText: 'Too Many Requests',
          headers: new HttpHeaders({ 'Retry-After': '10' }),
        }
      );
      await expect(firstPromise).rejects.toThrow('Rate limit exceeded. Retry after 10s.');

      // Advance timers 5 s → second request's switchMap fires and re-checks the now-active cooldown
      await vi.advanceTimersByTimeAsync(5000);

      // No HTTP request should have been dispatched for the second call
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);
      await expect(secondPromise).rejects.toThrow('Rate limit exceeded. Retry after 5s.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases slot when lookupReviewScore subscription is cancelled during timer delay', async () => {
    vi.useFakeTimers();

    try {
      // Call 1 fires immediately
      const call1Promise = firstValueFrom(service.lookupReviewScore('Game A', 2000, 'SNES', 19));
      const req1 = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      req1.flush({ games: [] });
      await call1Promise;

      // Call 2 gets a 5 s slot — subscribe then immediately cancel (unsubscribe before timer fires)
      const sub2 = service.lookupReviewScore('Game B', 2000, 'SNES', 19).subscribe();
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);
      sub2.unsubscribe(); // slot should be released

      // Call 3 should reclaim the same 5 s slot (not 10 s) because call 2 released it
      const call3Promise = firstValueFrom(service.lookupReviewScore('Game C', 2000, 'SNES', 19));
      httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/mobygames/search`);

      // Only 5 s needed (not 10 s) because the cancelled slot was returned
      await vi.advanceTimersByTimeAsync(5000);
      const req3 = httpMock.expectOne(
        (r) => r.url === `${environment.gameApiBaseUrl}/v1/mobygames/search`
      );
      req3.flush({ games: [] });
      await call3Promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads recommendation lanes with explicit runtime mode and limit', async () => {
    const promise = firstValueFrom(
      service.getRecommendationLanes({
        target: 'BACKLOG',
        lane: 'overall',
        runtimeMode: 'SHORT',
        offset: 20,
        limit: 15,
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/lanes` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('lane') === 'overall' &&
        request.params.get('runtimeMode') === 'SHORT' &&
        request.params.get('offset') === '20' &&
        request.params.get('limit') === '15'
      );
    });

    req.flush({
      target: 'BACKLOG',
      runtimeMode: 'SHORT',
      runId: 12,
      generatedAt: '2026-03-03T09:00:00.000Z',
      lane: 'overall',
      items: [],
      page: { offset: 20, limit: 15, hasMore: true, nextOffset: 35 },
    });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runtimeMode: 'SHORT',
      runId: 12,
      generatedAt: '2026-03-03T09:00:00.000Z',
      lane: 'overall',
      items: [],
      page: { offset: 20, limit: 15, hasMore: true, nextOffset: 35 },
    });
  });

  it('normalizes legacy recommendation lanes payloads during staggered rollout', async () => {
    const promise = firstValueFrom(
      service.getRecommendationLanes({
        target: 'BACKLOG',
        lane: 'popular',
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/lanes` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('lane') === 'popular' &&
        request.params.get('offset') === '0' &&
        request.params.get('limit') === '10'
      );
    });

    req.flush({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      runId: 16,
      generatedAt: '2026-03-03T09:00:00.000Z',
      lanes: {
        overall: [],
        hiddenGems: [
          {
            rank: 1,
            igdbGameId: '501',
            platformIgdbId: 6,
            scoreTotal: 0.82,
            scoreComponents: {
              taste: 0.4,
              novelty: 0.2,
              runtimeFit: 0.1,
              criticBoost: 0.05,
              recencyBoost: 0.03,
              semantic: 0.02,
              exploration: 0,
              diversityPenalty: -0.01,
              repeatPenalty: -0.02,
            },
            explanations: {
              headline: 'Legacy hidden gem',
              bullets: [],
              matchedTokens: {
                genres: [],
                developers: [],
                publishers: [],
                franchises: [],
                collections: [],
                themes: [],
                keywords: [],
              },
            },
          },
        ],
        exploration: [],
        blended: [],
        popular: [],
        recent: [],
      },
    });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      runId: 16,
      generatedAt: '2026-03-03T09:00:00.000Z',
      lane: 'popular',
      items: [
        {
          rank: 1,
          igdbGameId: '501',
          platformIgdbId: 6,
          scoreTotal: 0.82,
          scoreComponents: {
            taste: 0.4,
            novelty: 0.2,
            runtimeFit: 0.1,
            criticBoost: 0.05,
            recencyBoost: 0.03,
            semantic: 0.02,
            exploration: 0,
            diversityPenalty: -0.01,
            repeatPenalty: -0.02,
          },
          explanations: {
            headline: 'Legacy hidden gem',
            bullets: [],
            matchedTokens: {
              genres: [],
              developers: [],
              publishers: [],
              franchises: [],
              collections: [],
              themes: [],
              keywords: [],
            },
          },
        },
      ],
      page: { offset: 0, limit: 1, hasMore: false, nextOffset: null },
    });
  });

  it('loads recommendation top with clamped limit and normalized response defaults', async () => {
    const promise = firstValueFrom(
      service.getRecommendationsTop({
        target: 'BACKLOG',
        runtimeMode: 'LONG',
        limit: 999,
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('runtimeMode') === 'LONG' &&
        request.params.get('limit') === '200'
      );
    });

    req.flush({
      target: 'BACKLOG',
      runtimeMode: 'LONG',
      runId: '13',
      generatedAt: 'invalid-date',
      items: [{}],
    });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runtimeMode: 'LONG',
      runId: 13,
      generatedAt: '1970-01-01T00:00:00.000Z',
      items: [],
    });
  });

  it('loads recommendation top with the legacy default limit when omitted', async () => {
    const promise = firstValueFrom(
      service.getRecommendationsTop({
        target: 'BACKLOG',
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('limit') === '20' &&
        request.params.get('runtimeMode') === null
      );
    });

    req.flush({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      runId: 14,
      generatedAt: '2026-03-03T09:00:00.000Z',
      items: [],
    });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runtimeMode: 'NEUTRAL',
      runId: 14,
      generatedAt: '2026-03-03T09:00:00.000Z',
      items: [],
    });
  });

  it('posts manual recommendation rebuild request payload', async () => {
    const promise = firstValueFrom(
      service.rebuildRecommendations({ target: 'WISHLIST', force: true })
    );
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/recommendations/rebuild`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ target: 'WISHLIST', force: true });
    req.flush({ target: 'WISHLIST', runId: '9', status: 'SUCCESS' });

    await expect(promise).resolves.toEqual({
      target: 'WISHLIST',
      runId: 9,
      status: 'SUCCESS',
      reusedRunId: null,
    });
  });

  it('preserves queued recommendation rebuild status from API', async () => {
    const promise = firstValueFrom(service.rebuildRecommendations({ target: 'BACKLOG' }));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/recommendations/rebuild`);
    req.flush({ target: 'BACKLOG', runId: '21', status: 'QUEUED' });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runId: 21,
      status: 'QUEUED',
      reusedRunId: null,
    });
  });

  it('normalizes malformed recommendation rebuild response payload', async () => {
    const promise = firstValueFrom(service.rebuildRecommendations({ target: 'BACKLOG' }));
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/recommendations/rebuild`);
    req.flush({ target: 'BACKLOG', runId: 'oops', status: 'BAD', reusedRunId: 'x9' });

    await expect(promise).resolves.toEqual({
      target: 'BACKLOG',
      runId: 0,
      status: 'FAILED',
      reusedRunId: null,
    });
  });

  it('returns cooldown error before recommendation requests are dispatched', async () => {
    (service as unknown as { rateLimitCooldownUntilMs: number }).rateLimitCooldownUntilMs =
      Date.now() + 1_000;

    const topPromise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const lanesPromise = firstValueFrom(
      service.getRecommendationLanes({ target: 'BACKLOG', lane: 'overall' })
    );
    const rebuildPromise = firstValueFrom(service.rebuildRecommendations({ target: 'BACKLOG' }));
    const similarPromise = firstValueFrom(
      service.getRecommendationSimilar({
        target: 'BACKLOG',
        igdbGameId: '1',
        platformIgdbId: 6,
      })
    );

    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/recommendations/top`);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/recommendations/lanes`);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/recommendations/rebuild`);
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/recommendations/similar/1`);

    await expect(topPromise).rejects.toThrow(/Rate limit exceeded/);
    await expect(lanesPromise).rejects.toThrow(/Rate limit exceeded/);
    await expect(rebuildPromise).rejects.toThrow(/Rate limit exceeded/);
    await expect(similarPromise).rejects.toThrow(/Rate limit exceeded/);
  });

  it('maps recommendation endpoint failures to recommendation API errors', async () => {
    const lanesPromise = firstValueFrom(
      service.getRecommendationLanes({ target: 'BACKLOG', lane: 'overall' })
    );
    const lanesReq = httpMock.expectOne(
      (request) =>
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/lanes` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('lane') === 'overall'
    );
    lanesReq.flush(
      { error: 'No recommendations available.' },
      { status: 404, statusText: 'Not Found' }
    );
    await expect(lanesPromise).rejects.toMatchObject({ code: 'NOT_FOUND' });
    (service as unknown as { rateLimitCooldownUntilMs: number }).rateLimitCooldownUntilMs = 0;

    const rebuildPromise = firstValueFrom(service.rebuildRecommendations({ target: 'BACKLOG' }));
    const rebuildReq = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/recommendations/rebuild`
    );
    rebuildReq.flush({ error: 'cooldown' }, { status: 429, statusText: 'Too Many Requests' });
    await expect(rebuildPromise).rejects.toThrow(/Rate limit exceeded/);
    (service as unknown as { rateLimitCooldownUntilMs: number }).rateLimitCooldownUntilMs = 0;

    const similarPromise = firstValueFrom(
      service.getRecommendationSimilar({
        target: 'BACKLOG',
        igdbGameId: '42',
        platformIgdbId: 6,
      })
    );
    const similarReq = httpMock.expectOne(
      (request) =>
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/similar/42` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('platformIgdbId') === '6' &&
        request.params.get('offset') === '0'
    );
    similarReq.flush({ error: 'nope' }, { status: 500, statusText: 'Server Error' });
    await expect(similarPromise).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
  });

  it('rejects recommendation similar requests with invalid identity input', async () => {
    const invalidPromise = firstValueFrom(
      service.getRecommendationSimilar({
        target: 'BACKLOG',
        igdbGameId: 'abc',
        platformIgdbId: 0,
      })
    );

    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/recommendations/similar/abc`);
    await expect(invalidPromise).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('normalizes recommendation similar paging metadata and fallback source values', async () => {
    const promise = firstValueFrom(
      service.getRecommendationSimilar({
        target: 'BACKLOG',
        runtimeMode: 'LONG',
        igdbGameId: '11549',
        platformIgdbId: 37,
        offset: -5,
        limit: 999,
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/similar/11549` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('runtimeMode') === 'LONG' &&
        request.params.get('platformIgdbId') === '37' &&
        request.params.get('offset') === '0' &&
        request.params.get('limit') === '50'
      );
    });

    req.flush({
      runtimeMode: 'INVALID',
      source: {
        igdbGameId: 'not-a-number',
        platformIgdbId: 0,
      },
      page: {
        offset: 'bad',
        limit: 0,
        hasMore: 'yes',
        nextOffset: -1,
      },
      items: [
        {
          igdbGameId: '11043',
          platformIgdbId: 37,
          similarity: 0.8734,
          reasons: {
            summary: ' Shared tokens and embedding proximity ',
            structuredSimilarity: 0.7123,
            semanticSimilarity: 0.9051,
            blendedSimilarity: 0.7894,
            sharedTokens: {
              genres: ['Action'],
              developers: ['Nintendo'],
              publishers: ['Nintendo'],
              franchises: ['Mario'],
              collections: ['Super Mario'],
              themes: ['Fantasy'],
              keywords: ['multiple endings'],
            },
          },
        },
        {
          igdbGameId: null,
          platformIgdbId: 37,
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      runtimeMode: 'NEUTRAL',
      source: {
        igdbGameId: '11549',
        platformIgdbId: 37,
      },
      page: {
        offset: 0,
        limit: 10,
        hasMore: false,
        nextOffset: null,
      },
      items: [
        {
          igdbGameId: '11043',
          platformIgdbId: 37,
          similarity: 0.8734,
          reasons: {
            summary: 'Shared tokens and embedding proximity',
            structuredSimilarity: 0.7123,
            semanticSimilarity: 0.9051,
            blendedSimilarity: 0.7894,
            sharedTokens: {
              genres: ['Action'],
              developers: ['Nintendo'],
              publishers: ['Nintendo'],
              franchises: ['Mario'],
              collections: ['Super Mario'],
              themes: ['Fantasy'],
              keywords: ['multiple endings'],
            },
          },
        },
      ],
    });
  });

  it('loads recommendation similar items with shared theme and keyword tokens', async () => {
    const promise = firstValueFrom(
      service.getRecommendationSimilar({
        target: 'BACKLOG',
        igdbGameId: '11549',
        platformIgdbId: 37,
        limit: 3,
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/recommendations/similar/11549` &&
        request.params.get('target') === 'BACKLOG' &&
        request.params.get('platformIgdbId') === '37' &&
        request.params.get('offset') === '0' &&
        request.params.get('limit') === '3'
      );
    });

    req.flush({
      source: {
        igdbGameId: '11549',
        platformIgdbId: 37,
      },
      page: {
        offset: 0,
        limit: 3,
        hasMore: true,
        nextOffset: 3,
      },
      items: [
        {
          igdbGameId: '11043',
          platformIgdbId: 37,
          similarity: 0.8734,
          reasons: {
            summary: 'Shared tokens and embedding proximity',
            structuredSimilarity: 0.7123,
            semanticSimilarity: 0.9051,
            blendedSimilarity: 0.7894,
            sharedTokens: {
              genres: ['Action'],
              developers: ['Nintendo'],
              publishers: ['Nintendo'],
              franchises: ['Mario'],
              collections: ['Super Mario'],
              themes: ['Fantasy'],
              keywords: ['multiple endings'],
            },
          },
        },
      ],
    });

    await expect(promise).resolves.toEqual({
      runtimeMode: 'NEUTRAL',
      source: {
        igdbGameId: '11549',
        platformIgdbId: 37,
      },
      page: {
        offset: 0,
        limit: 3,
        hasMore: true,
        nextOffset: 3,
      },
      items: [
        {
          igdbGameId: '11043',
          platformIgdbId: 37,
          similarity: 0.8734,
          reasons: {
            summary: 'Shared tokens and embedding proximity',
            structuredSimilarity: 0.7123,
            semanticSimilarity: 0.9051,
            blendedSimilarity: 0.7894,
            sharedTokens: {
              genres: ['Action'],
              developers: ['Nintendo'],
              publishers: ['Nintendo'],
              franchises: ['Mario'],
              collections: ['Super Mario'],
              themes: ['Fantasy'],
              keywords: ['multiple endings'],
            },
          },
        },
      ],
    });
  });

  it('maps recommendation not-found responses to friendly error', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush(
      { error: 'No recommendations available. Trigger a rebuild first.' },
      { status: 404, statusText: 'Not Found' }
    );

    await expect(promise).rejects.toThrow(
      'No recommendations available yet. Build recommendations to get started.'
    );
  });

  it('maps recommendation queued top responses to not-found error', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush(
      {
        target: 'BACKLOG',
        status: 'QUEUED',
        reason: 'missing',
        error: 'No recommendations available yet. Rebuild has been queued.',
      },
      { status: 202, statusText: 'Accepted' }
    );

    await expect(promise).rejects.toMatchObject({
      message: 'No recommendations available yet. Build recommendations to get started.',
      code: 'NOT_FOUND',
    });
  });

  it('maps recommendation queued lanes responses to not-found error', async () => {
    const promise = firstValueFrom(
      service.getRecommendationLanes({ target: 'BACKLOG', lane: 'overall' })
    );
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/lanes`;
    });
    req.flush(
      {
        target: 'BACKLOG',
        status: 'QUEUED',
        reason: 'missing',
        error: 'No recommendations available yet. Rebuild has been queued.',
      },
      { status: 202, statusText: 'Accepted' }
    );

    await expect(promise).rejects.toMatchObject({
      message: 'No recommendations available yet. Build recommendations to get started.',
      code: 'NOT_FOUND',
    });
  });

  it('maps recommendation 429 responses to cooldown error code', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush({ error: 'cooldown' }, { status: 429, statusText: 'Too Many Requests' });

    await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 20s.');
  });

  it('maps recommendation 400 responses to invalid request error code', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush({ error: 'bad request' }, { status: 400, statusText: 'Bad Request' });

    await expect(promise).rejects.toMatchObject({
      message: 'Invalid recommendation query.',
      code: 'INVALID_REQUEST',
    });
  });

  it('maps recommendation 500 responses to generic request failure code', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush({ error: 'server error' }, { status: 500, statusText: 'Server Error' });

    await expect(promise).rejects.toMatchObject({
      message: 'Unable to load recommendations right now.',
      code: 'REQUEST_FAILED',
    });
  });

  it('lookupSteamPrice validates input, forwards normalized params, and maps generic errors', async () => {
    await expect(firstValueFrom(service.lookupSteamPrice('bad-id', 6))).rejects.toThrow(
      'Invalid Steam price lookup request.'
    );
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/steam/prices`);

    const successPromise = firstValueFrom(service.lookupSteamPrice('960', 6, 'ch', 204100));
    const successReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/steam/prices` &&
        request.params.get('igdbGameId') === '960' &&
        request.params.get('platformIgdbId') === '6' &&
        request.params.get('cc') === 'CH' &&
        request.params.get('steamAppId') === '204100'
      );
    });
    successReq.flush({ status: 'ok' });
    await expect(successPromise).resolves.toEqual({ status: 'ok' });

    const failurePromise = firstValueFrom(service.lookupSteamPrice('960', 6));
    const failureReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/steam/prices` &&
        request.params.get('igdbGameId') === '960' &&
        request.params.get('platformIgdbId') === '6'
      );
    });
    failureReq.flush({ error: 'nope' }, { status: 500, statusText: 'Server Error' });
    await expect(failurePromise).rejects.toThrow('Unable to load Steam prices.');
  });

  it('lookupPsPrices and lookupPsPricesCandidates cover title/candidate guards and error mapping', async () => {
    await expect(
      firstValueFrom(service.lookupPsPrices('x', 130, { title: 'test' }))
    ).rejects.toThrow('Invalid PSPrices lookup request.');
    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/psprices/prices`);

    const lookupPromise = firstValueFrom(
      service.lookupPsPrices('960', 130, {
        title: '  Nioh 2  ',
        preferredUrl: '  https://psprices.com/region-ch/game/123  ',
      })
    );
    const lookupReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('igdbGameId') === '960' &&
        request.params.get('platformIgdbId') === '130' &&
        request.params.get('title') === 'Nioh 2' &&
        request.params.get('preferredPsPricesUrl') === 'https://psprices.com/region-ch/game/123'
      );
    });
    lookupReq.flush({ status: 'ok' });
    await expect(lookupPromise).resolves.toEqual({ status: 'ok' });

    await expect(
      firstValueFrom(service.lookupPsPricesCandidates('960', 130, 'x'))
    ).resolves.toEqual({
      status: 'unavailable',
      candidates: [],
    });
    httpMock.expectNone(
      (request) => request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices`
    );

    const failurePromise = firstValueFrom(service.lookupPsPricesCandidates('960', 130, 'Nioh'));
    const failureReq = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('includeCandidates') === '1'
      );
    });
    failureReq.flush({ error: 'nope' }, { status: 500, statusText: 'Server Error' });
    await expect(failurePromise).rejects.toThrow('Unable to load PSPrices data.');
  });

  it('lookupPsPrices omits preferredPsPricesUrl when the preferred url is blank or invalid', async () => {
    const promise = firstValueFrom(
      service.lookupPsPrices('960', 130, {
        title: '  Nioh 2  ',
        preferredUrl: '   ',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('title') === 'Nioh 2' &&
        !request.params.has('preferredPsPricesUrl')
      );
    });
    req.flush({ status: 'ok' });

    await expect(promise).resolves.toEqual({ status: 'ok' });
  });

  it('lookupPsPrices omits preferredPsPricesUrl when the preferred url is non-empty but cannot be normalized', async () => {
    const promise = firstValueFrom(
      service.lookupPsPrices('960', 130, {
        title: 'Nioh 2',
        preferredUrl: 'not a valid url',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('title') === 'Nioh 2' &&
        !request.params.has('preferredPsPricesUrl')
      );
    });
    req.flush({ status: 'ok' });

    await expect(promise).resolves.toEqual({ status: 'ok' });
  });

  it('lookupPsPrices omits preferredPsPricesUrl when preferredUrl is not a string', async () => {
    const promise = firstValueFrom(
      service.lookupPsPrices('960', 130, {
        title: 'Nioh 2',
        preferredUrl: 42 as unknown as string,
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('title') === 'Nioh 2' &&
        !request.params.has('preferredPsPricesUrl')
      );
    });
    req.flush({ status: 'ok' });

    await expect(promise).resolves.toEqual({ status: 'ok' });
  });

  it('normalizes scheme-less preferred PSPrices urls before dispatching lookup requests', async () => {
    const promise = firstValueFrom(
      service.lookupPsPrices('10148', 167, {
        preferredUrl: '  //psprices.com/region-ch/game/123  ',
      })
    );
    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/psprices/prices` &&
        request.params.get('igdbGameId') === '10148' &&
        request.params.get('platformIgdbId') === '167' &&
        request.params.get('preferredPsPricesUrl') === 'https://psprices.com/region-ch/game/123'
      );
    });
    req.flush({ status: 'unavailable', bestPrice: null });

    await expect(promise).resolves.toEqual({ status: 'unavailable', bestPrice: null });
  });

  it('prefers retry-after based recommendation cooldown error mapping', async () => {
    const promise = firstValueFrom(service.getRecommendationsTop({ target: 'BACKLOG' }));
    const req = httpMock.expectOne((request) => {
      return request.url === `${environment.gameApiBaseUrl}/v1/recommendations/top`;
    });
    req.flush(
      { error: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '9' }),
      }
    );

    await expect(promise).rejects.toThrow('Rate limit exceeded. Retry after 9s.');
  });

  it('covers recommendation normalization helper branches', () => {
    const privateService = service as unknown as {
      normalizeRecommendationRuntimeMode: (value: unknown) => 'NEUTRAL' | 'SHORT' | 'LONG' | null;
      normalizeIsoDate: (value: unknown) => string;
      normalizePositiveInteger: (value: unknown) => number | null;
      normalizeNumericId: (value: unknown) => string;
      normalizePriceSource: (value: unknown) => 'steam_store' | 'psprices' | null;
      normalizeOptionalBoolean: (value: unknown) => boolean | null;
      toRecommendationError: (error: unknown) => Error & { code?: string };
      createRecommendationApiError: (code: string, message: string) => Error & { code?: string };
    };

    expect(privateService.normalizeRecommendationRuntimeMode('NEUTRAL')).toBe('NEUTRAL');
    expect(privateService.normalizeRecommendationRuntimeMode('invalid')).toBeNull();

    expect(privateService.normalizeIsoDate(123)).toBe(new Date(0).toISOString());
    expect(privateService.normalizeIsoDate('  ')).toBe(new Date(0).toISOString());
    expect(privateService.normalizeIsoDate('not-a-date')).toBe(new Date(0).toISOString());
    expect(privateService.normalizeIsoDate('2026-03-03T10:00:00.000Z')).toBe(
      '2026-03-03T10:00:00.000Z'
    );

    expect(privateService.normalizePositiveInteger(12)).toBe(12);
    expect(privateService.normalizePositiveInteger('14')).toBe(14);
    expect(privateService.normalizePositiveInteger('0')).toBeNull();
    expect(privateService.normalizePositiveInteger('foo')).toBeNull();
    expect(privateService.normalizePositiveInteger(4.5)).toBeNull();

    expect(privateService.normalizeNumericId(' 123 ')).toBe('123');
    expect(privateService.normalizeNumericId('abc')).toBe('');
    expect(privateService.normalizeNumericId(42)).toBe('42');
    expect(privateService.normalizeNumericId(0)).toBe('');
    expect(privateService.normalizePriceSource('steam_store')).toBe('steam_store');
    expect(privateService.normalizePriceSource('psprices')).toBe('psprices');
    expect(privateService.normalizePriceSource('other')).toBeNull();
    expect(privateService.normalizeOptionalBoolean(true)).toBe(true);
    expect(privateService.normalizeOptionalBoolean('true')).toBe(true);
    expect(privateService.normalizeOptionalBoolean('false')).toBe(false);
    expect(privateService.normalizeOptionalBoolean('invalid')).toBeNull();

    expect(privateService.toRecommendationError(new Error('boom'))).toMatchObject({
      message: 'Unable to load recommendations right now.',
      code: 'REQUEST_FAILED',
    });

    const existingError = privateService.createRecommendationApiError('NOT_FOUND', 'existing');
    expect(privateService.toRecommendationError(existingError)).toBe(existingError);
  });
});
