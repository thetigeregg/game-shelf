import { HttpHeaders } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
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
        developers: [],
        franchises: [],
        genres: [],
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

  it('maps rate-limited search responses with and without retry-after', async () => {
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

    const withoutRetryAfter = firstValueFrom(service.searchGames('mario'));
    const reqTwo = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    reqTwo.flush({ message: 'rate limited' }, { status: 429, statusText: 'Too Many Requests' });
    await expect(withoutRetryAfter).rejects.toThrowError('Rate limit exceeded. Please wait and try again.');
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
      developers: [],
      franchises: [],
      genres: [],
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

  it('loads platform filters and normalizes response', async () => {
    const promise = firstValueFrom(service.listPlatforms());
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/platforms`);
    req.flush({
      items: [
        { id: 130, name: ' Nintendo Switch ' },
        { id: null, name: 'Broken' },
        { id: 130, name: 'Nintendo Switch' },
        { id: 6, name: 'PC (Microsoft Windows)' },
      ],
    });

    await expect(promise).resolves.toEqual([
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
  });

  it('falls back to cached platform filters when upstream request fails', async () => {
    localStorage.setItem(
      'game-shelf-platform-list-cache-v1',
      JSON.stringify([
        { id: 130, name: 'Nintendo Switch' },
        { id: 6, name: 'PC (Microsoft Windows)' },
      ]),
    );

    const promise = firstValueFrom(service.listPlatforms());
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/platforms`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });

    await expect(promise).resolves.toEqual([
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ]);
  });

  it('throws platform-filter error when upstream fails and no cache exists', async () => {
    const promise = firstValueFrom(service.listPlatforms());
    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/platforms`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
    await expect(promise).rejects.toThrowError('Unable to load platform filters.');
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
    await expect(promise).rejects.toThrowError('Rate limit exceeded. Please wait and try again.');
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
        developers: ['Nintendo'],
        franchises: ['The Legend of Zelda'],
        genres: ['Adventure'],
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
});
