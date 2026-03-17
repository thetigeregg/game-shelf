import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { StrictHttpParameterCodec } from '../api/strict-http-parameter-codec';
import { AdminApiAuthService } from './admin-api-auth.service';

export type AdminDiscoveryMatchProvider = 'hltb' | 'review' | 'pricing';
export type AdminDiscoveryMatchStateStatus = 'matched' | 'missing' | 'retrying' | 'permanentMiss';

export interface AdminDiscoveryProviderState {
  status: AdminDiscoveryMatchStateStatus;
  locked: boolean;
  attempts: number;
  lastTriedAt: string | null;
  nextTryAt: string | null;
  permanentMiss: boolean;
}

export interface AdminDiscoveryMatchState {
  hltb: AdminDiscoveryProviderState;
  review: AdminDiscoveryProviderState;
  pricing: AdminDiscoveryProviderState;
}

export interface AdminDiscoveryListItem {
  igdbGameId: string;
  platformIgdbId: number;
  title: string | null;
  platform: string | null;
  releaseYear: number | null;
  matchState: AdminDiscoveryMatchState;
}

export interface AdminDiscoveryListResponse {
  count: number;
  scanned: number;
  items: AdminDiscoveryListItem[];
}

export interface AdminDiscoveryDetailResponse extends AdminDiscoveryListItem {
  providers: {
    hltb: {
      hltbGameId: number | null;
      hltbUrl: string | null;
      hltbMainHours: number | null;
      hltbMainExtraHours: number | null;
      hltbCompletionistHours: number | null;
      queryTitle: string | null;
      queryReleaseYear: number | null;
      queryPlatform: string | null;
    };
    review: {
      reviewSource: 'metacritic' | 'mobygames' | null;
      reviewScore: number | null;
      reviewUrl: string | null;
      metacriticScore: number | null;
      metacriticUrl: string | null;
      mobygamesGameId: number | null;
      mobyScore: number | null;
      queryTitle: string | null;
      queryReleaseYear: number | null;
      queryPlatform: string | null;
      queryPlatformIgdbId: number | null;
      queryMobygamesGameId: number | null;
    };
    pricing: {
      priceSource: string | null;
      priceFetchedAt: string | null;
      priceAmount: number | null;
      priceCurrency: string | null;
      priceRegularAmount: number | null;
      priceDiscountPercent: number | null;
      priceIsFree: boolean;
      priceUrl: string | null;
      psPricesUrl: string | null;
      psPricesTitle: string | null;
      psPricesPlatform: string | null;
    };
  };
}

export interface AdminDiscoveryListOptions {
  provider?: AdminDiscoveryMatchProvider | null;
  state?: AdminDiscoveryMatchStateStatus | 'all';
  search?: string | null;
  limit?: number;
}

export interface AdminDiscoveryUpdateMatchRequest {
  provider: AdminDiscoveryMatchProvider;
  hltbGameId?: number | null;
  hltbUrl?: string | null;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  reviewSource?: 'metacritic' | 'mobygames' | null;
  reviewScore?: number | null;
  reviewUrl?: string | null;
  metacriticScore?: number | null;
  metacriticUrl?: string | null;
  mobygamesGameId?: number | null;
  mobyScore?: number | null;
  priceSource?: string | null;
  priceFetchedAt?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceRegularAmount?: number | null;
  priceDiscountPercent?: number | null;
  priceIsFree?: boolean | null;
  priceUrl?: string | null;
  psPricesUrl?: string | null;
  psPricesTitle?: string | null;
  psPricesPlatform?: string | null;
  queryTitle?: string | null;
  queryReleaseYear?: number | null;
  queryPlatform?: string | null;
}

interface UpdateMatchResponse {
  ok: boolean;
  changed: boolean;
  provider: AdminDiscoveryMatchProvider;
  item: AdminDiscoveryDetailResponse;
}

interface ClearPermanentMissResponse {
  ok: boolean;
  provider: 'hltb' | 'review';
  cleared: number;
}

export interface AdminDiscoveryRequeueResponse {
  ok: boolean;
  queued: boolean;
  deduped: boolean;
  jobId: number;
}

@Injectable({ providedIn: 'root' })
export class AdminDiscoveryMatchService {
  private static readonly STRICT_HTTP_PARAM_ENCODER = new StrictHttpParameterCodec();
  private readonly httpClient = inject(HttpClient);
  private readonly adminAuth = inject(AdminApiAuthService);
  private readonly apiBaseUrl = this.normalizeBaseUrl(environment.gameApiBaseUrl);
  private readonly baseUrl = `${this.apiBaseUrl}/v1/admin/discovery`;

  listUnmatched(options: AdminDiscoveryListOptions = {}): Observable<AdminDiscoveryListResponse> {
    let params = new HttpParams({ encoder: AdminDiscoveryMatchService.STRICT_HTTP_PARAM_ENCODER });

    if (options.provider) {
      params = params.set('provider', options.provider);
    }
    if (options.state && options.state !== 'all') {
      params = params.set('state', options.state);
    }
    if (typeof options.search === 'string' && options.search.trim().length > 0) {
      params = params.set('search', options.search.trim());
    }
    if (typeof options.limit === 'number' && Number.isInteger(options.limit) && options.limit > 0) {
      params = params.set('limit', String(options.limit));
    }

    return this.httpClient.get<AdminDiscoveryListResponse>(`${this.baseUrl}/matches/unmatched`, {
      headers: this.buildHeaders(),
      params,
    });
  }

  getMatchState(
    igdbGameId: string,
    platformIgdbId: number
  ): Observable<AdminDiscoveryDetailResponse> {
    return this.httpClient.get<AdminDiscoveryDetailResponse>(
      `${this.baseUrl}/games/${encodeURIComponent(igdbGameId)}/${String(platformIgdbId)}/match-state`,
      {
        headers: this.buildHeaders(),
      }
    );
  }

  updateMatch(
    igdbGameId: string,
    platformIgdbId: number,
    request: AdminDiscoveryUpdateMatchRequest
  ): Observable<UpdateMatchResponse> {
    return this.httpClient.patch<UpdateMatchResponse>(
      `${this.baseUrl}/games/${encodeURIComponent(igdbGameId)}/${String(platformIgdbId)}/match`,
      request,
      {
        headers: this.buildHeaders(),
      }
    );
  }

  clearMatch(
    igdbGameId: string,
    platformIgdbId: number,
    provider: AdminDiscoveryMatchProvider
  ): Observable<UpdateMatchResponse> {
    return this.httpClient.delete<UpdateMatchResponse>(
      `${this.baseUrl}/games/${encodeURIComponent(igdbGameId)}/${String(platformIgdbId)}/match/${provider}`,
      {
        headers: this.buildHeaders(),
      }
    );
  }

  clearPermanentMiss(
    provider: 'hltb' | 'review',
    gameKeys?: string[]
  ): Observable<ClearPermanentMissResponse> {
    return this.httpClient.post<ClearPermanentMissResponse>(
      `${this.baseUrl}/matches/clear-permanent-miss`,
      {
        provider,
        ...(Array.isArray(gameKeys) && gameKeys.length > 0 ? { gameKeys } : {}),
      },
      {
        headers: this.buildHeaders(),
      }
    );
  }

  requeueEnrichment(
    igdbGameId: string,
    platformIgdbId: number
  ): Observable<AdminDiscoveryRequeueResponse> {
    return this.httpClient.post<AdminDiscoveryRequeueResponse>(
      `${this.baseUrl}/games/${encodeURIComponent(igdbGameId)}/${String(platformIgdbId)}/requeue-enrichment`,
      {},
      {
        headers: this.buildHeaders(),
      }
    );
  }

  requeueEnrichmentRun(): Observable<AdminDiscoveryRequeueResponse> {
    return this.httpClient.post<AdminDiscoveryRequeueResponse>(
      `${this.baseUrl}/requeue-enrichment`,
      {},
      {
        headers: this.buildHeaders(),
      }
    );
  }

  private buildHeaders(): HttpHeaders {
    const token = this.adminAuth.getToken();
    if (!token) {
      return new HttpHeaders();
    }

    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });
  }

  private normalizeBaseUrl(value: string): string {
    const normalized = value.trim();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  }
}
