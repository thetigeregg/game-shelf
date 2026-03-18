import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  ClientWriteAuthService,
} from './client-write-auth.service';
import { AdminDiscoveryMatchService } from './admin-discovery-match.service';

class ClientWriteAuthServiceMock {
  token: string | null = 'device-token-1';

  getToken(): string | null {
    return this.token;
  }
}

describe('AdminDiscoveryMatchService', () => {
  let service: AdminDiscoveryMatchService;
  let httpMock: HttpTestingController;
  let authService: ClientWriteAuthServiceMock;

  beforeEach(() => {
    authService = new ClientWriteAuthServiceMock();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AdminDiscoveryMatchService,
        { provide: ClientWriteAuthService, useValue: authService },
      ],
    });

    service = TestBed.inject(AdminDiscoveryMatchService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists unmatched discovery rows with client token header and filters', async () => {
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

    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-1');
    req.flush({ count: 0, scanned: 0, items: [] });

    await expect(promise).resolves.toEqual({ count: 0, scanned: 0, items: [] });
  });

  it('posts clear permanent miss request with selected keys', async () => {
    const promise = firstValueFrom(service.clearPermanentMiss('review', ['1::6', '2::48']));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/matches/clear-permanent-miss`
    );

    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-1');
    expect(req.request.body).toEqual({ provider: 'review', gameKeys: ['1::6', '2::48'] });
    req.flush({ ok: true, provider: 'review', cleared: 2 });

    await expect(promise).resolves.toEqual({ ok: true, provider: 'review', cleared: 2 });
  });

  it('omits client token header when no device write token is configured', async () => {
    authService.token = null;
    const promise = firstValueFrom(service.getMatchState('123', 6));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/games/123/6/match-state`
    );

    expect(req.request.headers.has(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe(false);
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

  it('posts requeue enrichment request for a discovery game', async () => {
    const promise = firstValueFrom(service.requeueEnrichment('987', 167, 'review'));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/games/987/167/requeue-enrichment`
    );

    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-1');
    expect(req.request.body).toEqual({ provider: 'review' });
    req.flush({
      ok: true,
      queued: true,
      deduped: false,
      jobId: 41,
      queuedCount: 1,
      dedupedCount: 0,
    });

    await expect(promise).resolves.toEqual({
      ok: true,
      queued: true,
      deduped: false,
      jobId: 41,
      queuedCount: 1,
      dedupedCount: 0,
    });
  });

  it('posts a list-level targeted discovery enrichment requeue request', async () => {
    const promise = firstValueFrom(service.requeueEnrichmentRun('pricing', ['123::48', '456::6']));

    const req = httpMock.expectOne(
      `${environment.gameApiBaseUrl}/v1/admin/discovery/requeue-enrichment`
    );

    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get(CLIENT_WRITE_TOKEN_HEADER_NAME)).toBe('device-token-1');
    expect(req.request.body).toEqual({ provider: 'pricing', gameKeys: ['123::48', '456::6'] });
    req.flush({
      ok: true,
      queued: false,
      deduped: true,
      jobId: 41,
      queuedCount: 0,
      dedupedCount: 1,
    });

    await expect(promise).resolves.toEqual({
      ok: true,
      queued: false,
      deduped: true,
      jobId: 41,
      queuedCount: 0,
      dedupedCount: 1,
    });
  });
});
