import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AdminApiAuthService } from './admin-api-auth.service';
import { AdminDiscoveryMatchService } from './admin-discovery-match.service';

class AdminApiAuthServiceMock {
  token: string | null = 'admin-token-1';

  getToken(): string | null {
    return this.token;
  }
}

describe('AdminDiscoveryMatchService', () => {
  let service: AdminDiscoveryMatchService;
  let httpMock: HttpTestingController;
  let authService: AdminApiAuthServiceMock;

  beforeEach(() => {
    authService = new AdminApiAuthServiceMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AdminDiscoveryMatchService,
        { provide: AdminApiAuthService, useValue: authService },
      ],
    });

    service = TestBed.inject(AdminDiscoveryMatchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists unmatched discovery rows with auth header and filters', async () => {
    const promise = firstValueFrom(
      service.listUnmatched({
        provider: 'hltb',
        state: 'permanentMiss',
        search: 'mario',
        limit: 25,
      })
    );

    const req = httpMock.expectOne((request) => {
      return (
        request.url === `${environment.gameApiBaseUrl}/v1/admin/discovery/matches/unmatched` &&
        request.params.get('provider') === 'hltb' &&
        request.params.get('state') === 'permanentMiss' &&
        request.params.get('search') === 'mario' &&
        request.params.get('limit') === '25'
      );
    });

    expect(req.request.headers.get('Authorization')).toBe('Bearer admin-token-1');
    req.flush({ count: 0, scanned: 0, items: [] });

    await expect(promise).resolves.toEqual({ count: 0, scanned: 0, items: [] });
  });

  it('posts clear permanent miss request with selected keys', async () => {
    const promise = firstValueFrom(service.clearPermanentMiss('review', ['1::6', '2::48']));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/matches/clear-permanent-miss`
    );

    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer admin-token-1');
    expect(req.request.body).toEqual({ provider: 'review', gameKeys: ['1::6', '2::48'] });
    req.flush({ ok: true, provider: 'review', cleared: 2 });

    await expect(promise).resolves.toEqual({ ok: true, provider: 'review', cleared: 2 });
  });

  it('omits auth header when no admin token is configured', async () => {
    authService.token = null;
    const promise = firstValueFrom(service.getMatchState('123', 6));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/games/123/6/match-state`
    );

    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({
      igdbGameId: '123',
      platformIgdbId: 6,
      title: 'Game',
      platform: 'PC',
      releaseYear: 2024,
      matchState: {
        hltb: {
          status: 'missing',
          locked: false,
          attempts: 0,
          lastTriedAt: null,
          nextTryAt: null,
          permanentMiss: false,
        },
        review: {
          status: 'missing',
          locked: false,
          attempts: 0,
          lastTriedAt: null,
          nextTryAt: null,
          permanentMiss: false,
        },
        pricing: {
          status: 'missing',
          locked: false,
          attempts: 0,
          lastTriedAt: null,
          nextTryAt: null,
          permanentMiss: false,
        },
      },
      providers: {
        hltb: {
          hltbGameId: null,
          hltbUrl: null,
          hltbMainHours: null,
          hltbMainExtraHours: null,
          hltbCompletionistHours: null,
          queryTitle: null,
          queryReleaseYear: null,
          queryPlatform: null,
        },
        review: {
          reviewSource: null,
          reviewScore: null,
          reviewUrl: null,
          metacriticScore: null,
          metacriticUrl: null,
          mobygamesGameId: null,
          mobyScore: null,
          queryTitle: null,
          queryReleaseYear: null,
          queryPlatform: null,
          queryPlatformIgdbId: null,
          queryMobygamesGameId: null,
        },
        pricing: {
          priceSource: null,
          priceFetchedAt: null,
          priceAmount: null,
          priceCurrency: null,
          priceRegularAmount: null,
          priceDiscountPercent: null,
          priceIsFree: false,
          priceUrl: null,
          psPricesUrl: null,
          psPricesTitle: null,
          psPricesPlatform: null,
        },
      },
    });

    await expect(promise).resolves.toMatchObject({ igdbGameId: '123', platformIgdbId: 6 });
  });
});
