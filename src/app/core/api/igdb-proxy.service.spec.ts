import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
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

  it('returns empty list for short queries without HTTP call', done => {
    service.searchGames('x').subscribe(results => {
      expect(results).toEqual([]);
      done();
    });

    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/games/search`);
  });

  it('maps API response and sends q query param', done => {
    service.searchGames('mario').subscribe(results => {
      expect(results.length).toBe(1);
      expect(results[0]).toEqual({
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
      });
      done();
    });

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
  });

  it('includes IGDB platform id in search query params when provided', done => {
    service.searchGames('mario', 130).subscribe(results => {
      expect(results.length).toBe(1);
      done();
    });

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
  });

  it('maps HTTP failure to user-safe error', done => {
    service.searchGames('mario').subscribe({
      next: () => { throw new Error('Expected an error response'); },
      error: err => {
        expect(err.message).toBe('Unable to load game search results.');
        done();
      },
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/search?q=mario`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
  });

  it('loads a game by IGDB id and normalizes the payload', done => {
    service.getGameById('100').subscribe(result => {
      expect(result).toEqual({
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
      done();
    });

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
  });

  it('maps refresh endpoint failure to user-safe error', done => {
    service.getGameById('100').subscribe({
      next: () => { throw new Error('Expected an error response'); },
      error: err => {
        expect(err.message).toBe('Unable to refresh game metadata.');
        done();
      },
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
  });

  it('loads platform filters and normalizes response', done => {
    service.listPlatforms().subscribe(result => {
      expect(result).toEqual([
        { id: 6, name: 'PC (Microsoft Windows)' },
        { id: 130, name: 'Nintendo Switch' },
      ]);
      done();
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/platforms`);
    req.flush({
      items: [
        { id: 130, name: ' Nintendo Switch ' },
        { id: null, name: 'Broken' },
        { id: 130, name: 'Nintendo Switch' },
        { id: 6, name: 'PC (Microsoft Windows)' },
      ],
    });
  });

  it('falls back to cached platform filters when upstream request fails', done => {
    localStorage.setItem(
      'game-shelf-platform-list-cache-v1',
      JSON.stringify([
        { id: 130, name: 'Nintendo Switch' },
        { id: 6, name: 'PC (Microsoft Windows)' },
      ]),
    );

    service.listPlatforms().subscribe(result => {
      expect(result).toEqual([
        { id: 6, name: 'PC (Microsoft Windows)' },
        { id: 130, name: 'Nintendo Switch' },
      ]);
      done();
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/platforms`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
  });

  it('searches box art results and normalizes URLs', done => {
    service.searchBoxArtByTitle('mario').subscribe(results => {
      expect(results).toEqual([
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
        'https://cdn.thegamesdb.net/images/original/box/front/mario-2.jpg',
      ]);
      done();
    });

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
  });

  it('includes platform in box art search query params when provided', done => {
    service.searchBoxArtByTitle('mario', 'Nintendo Switch', 130).subscribe(results => {
      expect(results).toEqual([
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
      ]);
      done();
    });

    const req = httpMock.expectOne(request => {
      return request.url === `${environment.gameApiBaseUrl}/v1/images/boxart/search`
        && request.params.get('q') === 'mario'
        && request.params.get('platform') === 'Nintendo Switch'
        && request.params.get('platformIgdbId') === '130';
    });

    req.flush({
      items: [
        'https://cdn.thegamesdb.net/images/original/box/front/mario.jpg',
      ],
    });
  });

  it('returns empty box art results for short queries without HTTP call', done => {
    service.searchBoxArtByTitle('m').subscribe(results => {
      expect(results).toEqual([]);
      done();
    });

    httpMock.expectNone(`${environment.gameApiBaseUrl}/v1/images/boxart/search`);
  });

  it('maps box art search failure to user-safe error', done => {
    service.searchBoxArtByTitle('mario').subscribe({
      next: () => { throw new Error('Expected an error response'); },
      error: err => {
        expect(err.message).toBe('Unable to load box art results.');
        done();
      },
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
  });

  it('maps box art rate limit responses with retry timing', done => {
    service.searchBoxArtByTitle('mario').subscribe({
      next: () => { throw new Error('Expected an error response'); },
      error: err => {
        expect(err.message).toBe('Rate limit exceeded. Retry after 15s.');
        done();
      },
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/images/boxart/search?q=mario`);
    req.flush(
      { message: 'rate limited' },
      {
        status: 429,
        statusText: 'Too Many Requests',
        headers: new HttpHeaders({ 'Retry-After': '15' }),
      },
    );
  });
});
