import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
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
        externalId: '100',
        title: 'Super Mario Odyssey',
        coverUrl: null,
        coverSource: 'none',
        platforms: ['Nintendo Switch'],
        platform: 'Nintendo Switch',
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
          externalId: '100',
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
      next: () => fail('Expected an error response'),
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
        externalId: '100',
        title: 'Super Mario Odyssey',
        coverUrl: 'https://example.com/cover.jpg',
        coverSource: 'thegamesdb',
        platforms: ['Nintendo Switch', 'Wii U'],
        platform: null,
        releaseDate: '2017-10-27T00:00:00.000Z',
        releaseYear: 2017,
      });
      done();
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({
      item: {
        externalId: '100',
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
      next: () => fail('Expected an error response'),
      error: err => {
        expect(err.message).toBe('Unable to refresh game metadata.');
        done();
      },
    });

    const req = httpMock.expectOne(`${environment.gameApiBaseUrl}/v1/games/100`);
    req.flush({ message: 'upstream down' }, { status: 500, statusText: 'Server Error' });
  });
});
