import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, defer, of, throwError, timer } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameWebsite,
  GameType,
  HltbCompletionTimes,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  MetacriticScoreResult,
  ReviewMatchCandidate,
  ReviewScoreResult,
  RecommendationItem,
  RecommendationLaneKey,
  RecommendationLanesResponse,
  RecommendationRebuildResponse,
  RecommendationRuntimeMode,
  RecommendationSimilarItem,
  RecommendationSimilarResponse,
  RecommendationTarget,
  RecommendationTopResponse,
  PopularityFeedItem,
  PopularityFeedResponse,
  PopularityFeedType,
} from '../models/game.models';
import { GameSearchApi } from './game-search-api';
import { PLATFORM_CATALOG } from '../data/platform-catalog';
import { DebugLogService } from '../services/debug-log.service';
import { PlatformCustomizationService } from '../services/platform-customization.service';
import { StrictHttpParameterCodec } from './strict-http-parameter-codec';
import { isMetacriticPlatformSupported } from '../utils/metacritic-platform-support';
import { resolveMobyGamesPlatformId } from '../utils/mobygames-platform-map';
import { detectReviewSourceFromUrl, sanitizeExternalHttpUrlString } from '../utils/url-host.util';
import { normalizeGameScreenshots, normalizeGameVideos } from '../utils/game-media-normalization';

interface SearchResponse {
  items: GameCatalogResult[];
}

interface GameByIdResponse {
  item: GameCatalogResult;
}

interface BoxArtSearchResponse {
  items: string[];
}

interface HltbSearchResponse {
  item: HltbCompletionTimes | null;
  candidates?: HltbMatchCandidate[] | null;
}

interface MetacriticSearchResponse {
  item: MetacriticScoreResult | null;
  candidates?: MetacriticMatchCandidate[] | null;
}

interface MobyGamesSearchResponse {
  games?: MobyGamesGameResult[] | null;
}

interface MobyGamesGameResult {
  game_id?: number | string | null;
  title?: string | null;
  moby_url?: string | null;
  critic_score?: number | string | null;
  moby_score?: number | string | null;
  release_date?: string | null;
  platforms?: Array<{
    id?: number | string | null;
    platform_id?: number | string | null;
    name?: string | null;
    platform_name?: string | null;
  }> | null;
  covers?: Array<{
    platforms?: Array<
      | number
      | string
      | {
          id?: number | string | null;
          platform_id?: number | string | null;
          platform_name?: string | null;
          name?: string | null;
        }
    > | null;
    images?: Array<{
      thumbnail_url?: string | null;
      image_url?: string | null;
      original_url?: string | null;
      moby_url?: string | null;
      caption?: string | null;
      type?: {
        id?: number | string | null;
        name?: string | null;
      } | null;
    }> | null;
  }> | null;
  screenshots?: Array<{
    platform_id?: number | string | null;
    platform_name?: string | null;
    images?: Array<{
      thumbnail_url?: string | null;
      image_url?: string | null;
      original_url?: string | null;
      moby_url?: string | null;
      caption?: string | null;
    }> | null;
  }> | null;
}

interface RecommendationTopApiResponse {
  target?: unknown;
  runtimeMode?: unknown;
  runId?: unknown;
  generatedAt?: unknown;
  items?: unknown;
  status?: unknown;
  reason?: unknown;
  error?: unknown;
}

interface RecommendationLanesApiResponse {
  target?: unknown;
  runtimeMode?: unknown;
  runId?: unknown;
  generatedAt?: unknown;
  lane?: unknown;
  items?: unknown;
  lanes?: unknown;
  page?: unknown;
  status?: unknown;
  reason?: unknown;
  error?: unknown;
}

interface RecommendationRebuildApiResponse {
  target?: unknown;
  runId?: unknown;
  status?: unknown;
  reusedRunId?: unknown;
}

interface RecommendationSimilarApiResponse {
  runtimeMode?: unknown;
  source?: unknown;
  items?: unknown;
  page?: unknown;
}

@Injectable({ providedIn: 'root' })
export class IgdbProxyService implements GameSearchApi {
  private static readonly RATE_LIMIT_FALLBACK_COOLDOWN_MS = 20_000;
  private static readonly MOBYGAMES_MIN_INTERVAL_MS = 5_000;
  private static readonly STRICT_HTTP_PARAM_ENCODER = new StrictHttpParameterCodec();
  private readonly platformCacheStorageKey = 'game-shelf-platform-list-cache-v1';
  private readonly searchUrl = `${environment.gameApiBaseUrl}/v1/games/search`;
  private readonly gameByIdBaseUrl = `${environment.gameApiBaseUrl}/v1/games`;
  private readonly boxArtSearchUrl = `${environment.gameApiBaseUrl}/v1/images/boxart/search`;
  private readonly hltbSearchUrl = `${environment.gameApiBaseUrl}/v1/hltb/search`;
  private readonly metacriticSearchUrl = `${environment.gameApiBaseUrl}/v1/metacritic/search`;
  private readonly mobygamesSearchUrl = `${environment.gameApiBaseUrl}/v1/mobygames/search`;
  private readonly recommendationsTopUrl = `${environment.gameApiBaseUrl}/v1/recommendations/top`;
  private readonly recommendationsLanesUrl = `${environment.gameApiBaseUrl}/v1/recommendations/lanes`;
  private readonly recommendationsRebuildUrl = `${environment.gameApiBaseUrl}/v1/recommendations/rebuild`;
  private readonly recommendationsSimilarBaseUrl = `${environment.gameApiBaseUrl}/v1/recommendations/similar`;
  private readonly gamesTrendingUrl = `${environment.gameApiBaseUrl}/v1/games/trending`;
  private readonly gamesUpcomingUrl = `${environment.gameApiBaseUrl}/v1/games/upcoming`;
  private readonly gamesRecentUrl = `${environment.gameApiBaseUrl}/v1/games/recent`;
  private readonly steamPricesUrl = `${environment.gameApiBaseUrl}/v1/steam/prices`;
  private readonly pspricesPricesUrl = `${environment.gameApiBaseUrl}/v1/psprices/prices`;
  private readonly httpClient = inject(HttpClient);
  private readonly debugLogService = inject(DebugLogService);
  private readonly platformCustomizationService = inject(PlatformCustomizationService);
  private rateLimitCooldownUntilMs = 0;
  private mobyGamesNextSlotMs = 0;

  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'q',
      normalized
    );
    const normalizedPlatformIgdbId =
      typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
        ? platformIgdbId
        : null;

    if (normalizedPlatformIgdbId !== null) {
      params = params.set('platformIgdbId', String(normalizedPlatformIgdbId));
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<SearchResponse>(this.searchUrl, { params }).pipe(
      map((response) => response.items.map((item) => this.normalizeResult(item))),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);

        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load game search results.'));
      })
    );
  }

  listPlatforms(): Observable<GameCatalogPlatformOption[]> {
    const normalized = this.normalizePlatformList(PLATFORM_CATALOG);
    this.saveCachedPlatformList(normalized);
    return of(normalized);
  }

  getGameById(igdbGameId: string): Observable<GameCatalogResult> {
    const normalizedId = igdbGameId.trim();

    if (!/^\d+$/.test(normalizedId)) {
      return throwError(() => new Error('Unable to refresh game metadata.'));
    }

    const url = `${this.gameByIdBaseUrl}/${encodeURIComponent(normalizedId)}`;

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<GameByIdResponse>(url).pipe(
      map((response) => {
        return this.normalizeResult(response.item);
      }),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to refresh game metadata.'));
      })
    );
  }

  searchBoxArtByTitle(
    query: string,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<string[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'q',
      normalized
    );
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }

    const normalizedPlatformIgdbId =
      typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
        ? platformIgdbId
        : null;

    if (normalizedPlatformIgdbId !== null) {
      params = params.set('platformIgdbId', String(normalizedPlatformIgdbId));
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<BoxArtSearchResponse>(this.boxArtSearchUrl, { params }).pipe(
      map((response) => this.normalizeBoxArtResults(response.items)),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);

        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load box art results.'));
      })
    );
  }

  lookupCompletionTimes(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    query?: {
      preferredGameId?: number | null;
      preferredUrl?: string | null;
    }
  ): Observable<HltbCompletionTimes | null> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.hltb.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length,
      });
      return of(null);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'q',
      normalizedTitle
    );
    const normalizedYear =
      Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? (releaseYear as number) : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
    const normalizedPreferredGameId = this.normalizeHltbGameId(query?.preferredGameId);
    const normalizedPreferredUrl = this.normalizeHltbUrl(query?.preferredUrl);

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }
    if (normalizedPreferredGameId !== null) {
      params = params.set('preferredHltbGameId', String(normalizedPreferredGameId));
      params = params.set('includeCandidates', 'true');
    }
    if (normalizedPreferredUrl !== null) {
      params = params.set('preferredHltbUrl', normalizedPreferredUrl);
      params = params.set('includeCandidates', 'true');
    }
    this.debugLogService.trace('igdb_proxy.hltb.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
      preferredHltbGameId: normalizedPreferredGameId,
      preferredHltbUrl: normalizedPreferredUrl,
    });

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map((response) => {
        if (normalizedPreferredGameId !== null || normalizedPreferredUrl !== null) {
          const normalizedCandidates = this.normalizeHltbCandidates(response.candidates ?? []);
          const preferredCandidate =
            normalizedCandidates.find((candidate) => {
              const candidateGameId = candidate.hltbGameId ?? null;
              const candidateUrl = candidate.hltbUrl ?? null;
              return (
                (normalizedPreferredGameId !== null &&
                  candidateGameId === normalizedPreferredGameId) ||
                (normalizedPreferredUrl !== null && candidateUrl === normalizedPreferredUrl)
              );
            }) ?? null;
          if (preferredCandidate) {
            const normalizedPreferred = this.normalizeCompletionTimes(preferredCandidate);
            if (normalizedPreferred !== null) {
              return normalizedPreferred;
            }
          }
        }
        const normalized = this.normalizeCompletionTimes(response.item ?? null);
        this.debugLogService.trace('igdb_proxy.hltb.lookup_response', {
          hasItem: response.item !== null,
          normalized,
          hasNormalizedResult: normalized !== null,
        });
        return normalized;
      }),
      catchError((error) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }
        this.debugLogService.trace('igdb_proxy.hltb.lookup_error', this.normalizeUnknown(error));
        return of(null);
      })
    );
  }

  lookupCompletionTimeCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null
  ): Observable<HltbMatchCandidate[]> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.hltb_candidates.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length,
      });
      return of([]);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('q', normalizedTitle)
      .set('includeCandidates', 'true');
    const normalizedYear =
      Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? (releaseYear as number) : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }
    this.debugLogService.trace('igdb_proxy.hltb_candidates.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
    });

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeHltbCandidates(response.candidates ?? []);
        this.debugLogService.trace('igdb_proxy.hltb_candidates.lookup_response', {
          candidateCountRaw: Array.isArray(response.candidates) ? response.candidates.length : 0,
          candidateCountNormalized: normalized.length,
        });
        return normalized;
      }),
      catchError((error) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }
        this.debugLogService.trace(
          'igdb_proxy.hltb_candidates.lookup_error',
          this.normalizeUnknown(error)
        );
        return of([]);
      })
    );
  }

  lookupMetacriticScore(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null,
    preferredReviewUrl?: string | null
  ): Observable<MetacriticScoreResult | null> {
    return this.lookupReviewScore(
      title,
      releaseYear,
      platform,
      platformIgdbId,
      undefined,
      preferredReviewUrl
    ).pipe(map((result) => this.toLegacyMetacriticScoreResult(result)));
  }

  lookupReviewScore(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null,
    mobygamesGameId?: number | null,
    preferredReviewUrl?: string | null
  ): Observable<ReviewScoreResult | null> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.metacritic.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length,
      });
      return of(null);
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'q',
      normalizedTitle
    );
    const normalizedYear =
      Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? (releaseYear as number) : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
    const normalizedPlatformIgdbId =
      typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
        ? platformIgdbId
        : null;
    const normalizedMobyGameId =
      typeof mobygamesGameId === 'number' &&
      Number.isInteger(mobygamesGameId) &&
      mobygamesGameId > 0
        ? mobygamesGameId
        : null;
    const normalizedPreferredReviewUrl =
      typeof preferredReviewUrl === 'string' && preferredReviewUrl.trim().length > 0
        ? this.normalizeExternalUrl(preferredReviewUrl)
        : null;

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }
    if (normalizedPlatformIgdbId !== null) {
      params = params.set('platformIgdbId', String(normalizedPlatformIgdbId));
    }
    if (normalizedPreferredReviewUrl !== null) {
      params = params.set('includeCandidates', 'true');
      params = params.set('preferredReviewUrl', normalizedPreferredReviewUrl);
    }

    if (!isMetacriticPlatformSupported(normalizedPlatformIgdbId)) {
      const mobygamesParams = this.buildMobyGamesParams({
        query: normalizedTitle,
        platformName: normalizedPlatform,
        platformIgdbId: normalizedPlatformIgdbId,
        mobygamesGameId: normalizedMobyGameId,
        limit: 20,
      });
      const mobygamesPlatformId = this.resolveMobyGamesPlatformIdForIgdbPlatform(
        normalizedPlatformIgdbId,
        normalizedPlatform
      );

      return defer(() => {
        const { delayMs: mobyDelayMs, releaseSlot } = this.claimMobyGamesSlot();
        this.debugLogService.trace('igdb_proxy.mobygames.lookup_request', {
          title: normalizedTitle,
          releaseYear: normalizedYear,
          platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
          platformIgdbId: normalizedPlatformIgdbId,
          mobygamesGameId: normalizedMobyGameId,
          mobygamesPlatformId,
          mobyDelayMs,
        });
        const mobyRequest$ = this.httpClient
          .get<MobyGamesSearchResponse>(this.mobygamesSearchUrl, { params: mobygamesParams })
          .pipe(
            map((response) => {
              const normalized = this.normalizeMobygamesReviewScoreResult(response.games ?? null, {
                preferredMobyPlatformId: mobygamesPlatformId,
                preferredPlatformName: normalizedPlatform,
              });
              this.debugLogService.trace('igdb_proxy.mobygames.lookup_response', {
                gameCountRaw: Array.isArray(response.games) ? response.games.length : 0,
                normalized,
                hasNormalizedResult: normalized !== null,
              });
              return normalized;
            }),
            catchError((error) => {
              const rateLimitError = this.toRateLimitError(error);
              if (rateLimitError) {
                return throwError(() => rateLimitError);
              }
              this.debugLogService.trace(
                'igdb_proxy.mobygames.lookup_error',
                this.normalizeUnknown(error)
              );
              return of(null);
            })
          );
        if (mobyDelayMs > 0) {
          let timerFired = false;
          return timer(mobyDelayMs).pipe(
            switchMap(() => {
              timerFired = true;
              const cooldownError = this.createCooldownErrorIfActive();
              if (cooldownError) {
                // Cooldown activated during delay window; do not dispatch upstream request.
                releaseSlot();
                return throwError(() => cooldownError);
              }
              return mobyRequest$;
            }),
            finalize(() => {
              if (!timerFired) {
                releaseSlot();
              }
            })
          );
        }
        return mobyRequest$;
      });
    }

    this.debugLogService.trace('igdb_proxy.metacritic.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
      platformIgdbId: normalizedPlatformIgdbId,
    });

    return this.httpClient.get<MetacriticSearchResponse>(this.metacriticSearchUrl, { params }).pipe(
      map((response) => {
        if (normalizedPreferredReviewUrl !== null) {
          const normalizedCandidates = this.normalizeReviewCandidates(
            response.candidates ?? [],
            'metacritic',
            response.item ?? null
          );
          const preferredCandidate =
            normalizedCandidates.find((candidate) => {
              const candidateUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? null;
              return candidateUrl === normalizedPreferredReviewUrl;
            }) ?? null;
          if (preferredCandidate) {
            return this.toReviewScoreResult(preferredCandidate);
          }
        }
        const normalized = this.normalizeReviewScoreResult(response.item ?? null, 'metacritic');
        this.debugLogService.trace('igdb_proxy.metacritic.lookup_response', {
          hasItem: response.item !== null,
          normalized,
          hasNormalizedResult: normalized !== null,
        });
        return normalized;
      }),
      catchError((error) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }
        this.debugLogService.trace(
          'igdb_proxy.metacritic.lookup_error',
          this.normalizeUnknown(error)
        );
        return of(null);
      })
    );
  }

  lookupMetacriticCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<MetacriticMatchCandidate[]> {
    return this.lookupReviewCandidates(title, releaseYear, platform, platformIgdbId).pipe(
      map((candidates) =>
        candidates.map((candidate) => this.toLegacyMetacriticCandidate(candidate))
      )
    );
  }

  lookupReviewCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<ReviewMatchCandidate[]> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length,
      });
      return of([]);
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('q', normalizedTitle)
      .set('includeCandidates', 'true');
    const normalizedYear =
      Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? (releaseYear as number) : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
    const normalizedPlatformIgdbId =
      typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
        ? platformIgdbId
        : null;

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }
    if (normalizedPlatformIgdbId !== null) {
      params = params.set('platformIgdbId', String(normalizedPlatformIgdbId));
    }

    if (!isMetacriticPlatformSupported(normalizedPlatformIgdbId)) {
      const mobygamesParams = this.buildMobyGamesParams({
        query: normalizedTitle,
        platformName: normalizedPlatform,
        platformIgdbId: normalizedPlatformIgdbId,
        limit: 100,
      });
      const mobygamesPlatformId = this.resolveMobyGamesPlatformIdForIgdbPlatform(
        normalizedPlatformIgdbId,
        normalizedPlatform
      );

      return defer(() => {
        const { delayMs: mobyDelayMs, releaseSlot } = this.claimMobyGamesSlot();
        this.debugLogService.trace('igdb_proxy.mobygames_candidates.lookup_request', {
          title: normalizedTitle,
          releaseYear: normalizedYear,
          platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
          platformIgdbId: normalizedPlatformIgdbId,
          mobygamesPlatformId,
          mobyDelayMs,
        });
        const mobyRequest$ = this.httpClient
          .get<MobyGamesSearchResponse>(this.mobygamesSearchUrl, { params: mobygamesParams })
          .pipe(
            map((response) => {
              const normalized = this.normalizeMobygamesReviewCandidates(response.games ?? null, {
                preferredMobyPlatformId: mobygamesPlatformId,
                preferredPlatformName: normalizedPlatform,
              });
              this.debugLogService.trace('igdb_proxy.mobygames_candidates.lookup_response', {
                gameCountRaw: Array.isArray(response.games) ? response.games.length : 0,
                candidateCountNormalized: normalized.length,
              });
              return normalized;
            }),
            catchError((error) => {
              const rateLimitError = this.toRateLimitError(error);
              if (rateLimitError) {
                return throwError(() => rateLimitError);
              }
              this.debugLogService.trace(
                'igdb_proxy.mobygames_candidates.lookup_error',
                this.normalizeUnknown(error)
              );
              return of([]);
            })
          );
        if (mobyDelayMs > 0) {
          let requestDispatched = false;
          return timer(mobyDelayMs).pipe(
            switchMap(() => {
              // Re-check cooldown right before dispatching the MobyGames request so that
              // any cooldown activated during the delay cancels this queued request.
              const cooldownError = this.createCooldownErrorIfActive();
              if (cooldownError) {
                return throwError(() => cooldownError);
              }
              requestDispatched = true;
              return mobyRequest$;
            }),
            finalize(() => {
              if (!requestDispatched) {
                releaseSlot();
              }
            })
          );
        }
        return mobyRequest$;
      });
    }

    this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
      platformIgdbId: normalizedPlatformIgdbId,
    });

    return this.httpClient.get<MetacriticSearchResponse>(this.metacriticSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeReviewCandidates(
          response.candidates ?? [],
          'metacritic',
          response.item ?? null
        );
        this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_response', {
          candidateCountRaw: Array.isArray(response.candidates) ? response.candidates.length : 0,
          candidateCountNormalized: normalized.length,
        });
        return normalized;
      }),
      catchError((error) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }
        this.debugLogService.trace(
          'igdb_proxy.metacritic_candidates.lookup_error',
          this.normalizeUnknown(error)
        );
        return of([]);
      })
    );
  }

  getRecommendationsTop(params: {
    target: RecommendationTarget;
    runtimeMode?: RecommendationRuntimeMode;
    limit?: number;
  }): Observable<RecommendationTopResponse> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    const query = this.buildRecommendationTopQueryParams(params);

    return this.httpClient
      .get<RecommendationTopApiResponse>(this.recommendationsTopUrl, { params: query })
      .pipe(
        map((response) => {
          this.throwIfRecommendationQueued(response);
          return this.normalizeRecommendationTopResponse(response, params.target);
        }),
        catchError((error: unknown) => throwError(() => this.toRecommendationError(error)))
      );
  }

  getRecommendationLanes(params: {
    target: RecommendationTarget;
    lane: RecommendationLaneKey;
    runtimeMode?: RecommendationRuntimeMode;
    offset?: number;
    limit?: number;
  }): Observable<RecommendationLanesResponse> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    const query = this.buildRecommendationQueryParams(params);

    return this.httpClient
      .get<RecommendationLanesApiResponse>(this.recommendationsLanesUrl, { params: query })
      .pipe(
        map((response) => {
          this.throwIfRecommendationQueued(response);
          return this.normalizeRecommendationLanesResponse(response, params.target, params.lane);
        }),
        catchError((error: unknown) => throwError(() => this.toRecommendationError(error)))
      );
  }

  getPopularityFeed(params: {
    feedType: PopularityFeedType;
    offset?: number;
    limit?: number;
  }): Observable<PopularityFeedResponse> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    const url =
      params.feedType === 'upcoming'
        ? this.gamesUpcomingUrl
        : params.feedType === 'recent'
          ? this.gamesRecentUrl
          : this.gamesTrendingUrl;
    const query = this.buildPageQueryParams({
      offset: params.offset,
      limit: params.limit,
    });

    return this.httpClient.get<PopularityFeedResponse>(url, { params: query }).pipe(
      map((response) => this.normalizePopularityFeedResponse(response)),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load popularity feed.'));
      })
    );
  }

  rebuildRecommendations(params: {
    target: RecommendationTarget;
    force?: boolean;
  }): Observable<RecommendationRebuildResponse> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient
      .post<RecommendationRebuildApiResponse>(this.recommendationsRebuildUrl, {
        target: params.target,
        ...(params.force === true ? { force: true } : {}),
      })
      .pipe(
        map((response) => this.normalizeRecommendationRebuildResponse(response, params.target)),
        catchError((error: unknown) => throwError(() => this.toRecommendationError(error)))
      );
  }

  getRecommendationSimilar(params: {
    target: RecommendationTarget;
    runtimeMode?: RecommendationRuntimeMode;
    igdbGameId: string;
    platformIgdbId: number;
    offset?: number;
    limit?: number;
  }): Observable<RecommendationSimilarResponse> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    const normalizedGameId = this.normalizeNumericId(params.igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePositiveInteger(params.platformIgdbId);

    if (!normalizedGameId || normalizedPlatformIgdbId === null) {
      return throwError(() =>
        this.createRecommendationApiError('INVALID_REQUEST', 'Invalid request.')
      );
    }

    const normalizedTarget = this.normalizeRecommendationTarget(params.target);
    const normalizedRuntimeMode = this.normalizeRecommendationRuntimeMode(params.runtimeMode);
    const normalizedOffset = this.normalizeNonNegativeInteger(params.offset) ?? 0;
    const normalizedLimit =
      Number.isInteger(params.limit) && (params.limit as number) > 0
        ? Math.min(params.limit as number, 50)
        : 6;
    let query = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'target',
      normalizedTarget
    );
    if (normalizedRuntimeMode) {
      query = query.set('runtimeMode', normalizedRuntimeMode);
    }
    query = query.set('platformIgdbId', String(normalizedPlatformIgdbId));
    query = query.set('offset', String(normalizedOffset));
    query = query.set('limit', String(normalizedLimit));
    const url = `${this.recommendationsSimilarBaseUrl}/${encodeURIComponent(normalizedGameId)}`;

    return this.httpClient.get<RecommendationSimilarApiResponse>(url, { params: query }).pipe(
      map((response) =>
        this.normalizeRecommendationSimilarResponse(response, {
          igdbGameId: normalizedGameId,
          platformIgdbId: normalizedPlatformIgdbId,
        })
      ),
      catchError((error: unknown) => throwError(() => this.toRecommendationError(error)))
    );
  }

  lookupSteamPrice(
    igdbGameId: string,
    platformIgdbId: number,
    countryCode?: string,
    steamAppId?: number | null
  ): Observable<unknown> {
    const normalizedGameId = this.normalizeNumericId(igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePositiveInteger(platformIgdbId);
    const normalizedSteamAppId = this.normalizePositiveInteger(steamAppId);

    if (!normalizedGameId || normalizedPlatformIgdbId === null) {
      return throwError(() => new Error('Invalid Steam price lookup request.'));
    }

    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('igdbGameId', normalizedGameId)
      .set('platformIgdbId', String(normalizedPlatformIgdbId));

    const normalizedCountryCode =
      typeof countryCode === 'string' && /^[A-Za-z]{2}$/.test(countryCode.trim())
        ? countryCode.trim().toUpperCase()
        : null;

    if (normalizedCountryCode !== null) {
      params = params.set('cc', normalizedCountryCode);
    }
    if (normalizedSteamAppId !== null) {
      params = params.set('steamAppId', String(normalizedSteamAppId));
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<unknown>(this.steamPricesUrl, { params }).pipe(
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load Steam prices.'));
      })
    );
  }

  lookupPsPrices(
    igdbGameId: string,
    platformIgdbId: number,
    query?: {
      title?: string | null;
      preferredUrl?: string | null;
    }
  ): Observable<unknown> {
    const normalizedGameId = this.normalizeNumericId(igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePositiveInteger(platformIgdbId);

    if (!normalizedGameId || normalizedPlatformIgdbId === null) {
      return throwError(() => new Error('Invalid PSPrices lookup request.'));
    }

    const params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('igdbGameId', normalizedGameId)
      .set('platformIgdbId', String(normalizedPlatformIgdbId));
    const normalizedTitle = typeof query?.title === 'string' ? query.title.trim() : '';
    const rawPreferredUrl =
      typeof query?.preferredUrl === 'string' ? query.preferredUrl.trim() : '';
    const normalizedPreferredUrl =
      rawPreferredUrl.length > 0 ? (this.normalizeExternalUrl(rawPreferredUrl) ?? '') : '';
    let enrichedParams = params;
    if (normalizedTitle.length > 0) {
      enrichedParams = enrichedParams.set('title', normalizedTitle);
    }
    if (normalizedPreferredUrl.length > 0) {
      enrichedParams = enrichedParams.set('preferredPsPricesUrl', normalizedPreferredUrl);
    }

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<unknown>(this.pspricesPricesUrl, { params: enrichedParams }).pipe(
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load PSPrices data.'));
      })
    );
  }

  lookupPsPricesCandidates(
    igdbGameId: string,
    platformIgdbId: number,
    title: string
  ): Observable<unknown> {
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 2) {
      return of({ status: 'unavailable', candidates: [] });
    }

    const normalizedGameId = this.normalizeNumericId(igdbGameId);
    const normalizedPlatformIgdbId = this.normalizePositiveInteger(platformIgdbId);

    if (!normalizedGameId || normalizedPlatformIgdbId === null) {
      return throwError(() => new Error('Invalid PSPrices lookup request.'));
    }

    const params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('igdbGameId', normalizedGameId)
      .set('platformIgdbId', String(normalizedPlatformIgdbId))
      .set('title', normalizedTitle)
      .set('includeCandidates', '1');

    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<unknown>(this.pspricesPricesUrl, { params }).pipe(
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);
        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load PSPrices data.'));
      })
    );
  }

  private normalizeResult(result: GameCatalogResult): GameCatalogResult {
    const payload = result as GameCatalogResult & { externalId?: string };
    const igdbGameId =
      typeof payload.igdbGameId === 'string'
        ? payload.igdbGameId.trim()
        : typeof payload.externalId === 'string'
          ? payload.externalId.trim()
          : '';
    const title = typeof result.title === 'string' ? result.title.trim() : '';
    const platformOptions = this.normalizePlatformOptions(result);
    const platforms = [...new Set(platformOptions.map((platform) => platform.name))];

    const normalizedReviewScore = this.normalizeMetacriticScore(
      result.reviewScore ?? result.metacriticScore
    );
    const normalizedReviewUrl = this.normalizeExternalUrl(result.reviewUrl ?? result.metacriticUrl);
    const normalizedMobyScore = this.normalizeRawMobyScore(result.mobyScore);
    const normalizedMobygamesGameId = this.normalizeMobygamesGameId(result.mobygamesGameId);
    const normalizedSteamAppId = this.normalizePositiveInteger(
      (result as GameCatalogResult & { steamAppId?: unknown }).steamAppId
    );
    const normalizedWebsites = this.normalizeWebsites(
      (result as GameCatalogResult & { websites?: unknown }).websites
    );
    const normalizedPriceSource = this.normalizePriceSource(
      (result as GameCatalogResult & { priceSource?: unknown }).priceSource
    );
    const normalizedPriceFetchedAt = this.normalizeReleaseDate(
      (result as GameCatalogResult & { priceFetchedAt?: unknown }).priceFetchedAt
    );
    const normalizedPriceAmount = this.normalizeOptionalNumber(
      (result as GameCatalogResult & { priceAmount?: unknown }).priceAmount
    );
    const normalizedPriceCurrency = this.normalizeCurrencyCode(
      (result as GameCatalogResult & { priceCurrency?: unknown }).priceCurrency
    );
    const normalizedPriceRegularAmount = this.normalizeOptionalNumber(
      (result as GameCatalogResult & { priceRegularAmount?: unknown }).priceRegularAmount
    );
    const normalizedPriceDiscountPercent = this.normalizeOptionalNumber(
      (result as GameCatalogResult & { priceDiscountPercent?: unknown }).priceDiscountPercent
    );
    const normalizedPriceIsFree = this.normalizeOptionalBoolean(
      (result as GameCatalogResult & { priceIsFree?: unknown }).priceIsFree
    );
    const normalizedPriceUrl = this.normalizeExternalUrl(
      (result as GameCatalogResult & { priceUrl?: unknown }).priceUrl
    );
    const explicitMetacriticScore = this.normalizeMetacriticScore(result.metacriticScore);
    const explicitMetacriticUrl = this.normalizeExternalUrl(result.metacriticUrl);
    const normalizedReviewSource =
      result.reviewSource === 'metacritic' || result.reviewSource === 'mobygames'
        ? result.reviewSource
        : this.inferReviewSourceFromUrl(normalizedReviewUrl ?? explicitMetacriticUrl);
    const normalizedMetacriticScore =
      normalizedReviewSource === 'metacritic'
        ? (explicitMetacriticScore ?? normalizedReviewScore)
        : explicitMetacriticScore;
    const normalizedMetacriticUrl =
      normalizedReviewSource === 'metacritic'
        ? (explicitMetacriticUrl ?? normalizedReviewUrl)
        : explicitMetacriticUrl;

    return {
      igdbGameId,
      title: title.length > 0 ? title : 'Unknown title',
      coverUrl: this.normalizeCoverUrl(result.coverUrl),
      coverSource: this.normalizeCoverSource(result.coverSource),
      storyline: this.normalizeOptionalText(
        (result as GameCatalogResult & { storyline?: unknown }).storyline
      ),
      summary: this.normalizeOptionalText(
        (result as GameCatalogResult & { summary?: unknown }).summary
      ),
      gameType: this.normalizeGameType(
        (result as GameCatalogResult & { gameType?: unknown }).gameType
      ),
      hltbMainHours: this.normalizeCompletionHours(result.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(result.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(result.hltbCompletionistHours),
      ...(normalizedReviewScore !== null ? { reviewScore: normalizedReviewScore } : {}),
      ...(normalizedReviewUrl !== null ? { reviewUrl: normalizedReviewUrl } : {}),
      ...(normalizedReviewSource !== null ? { reviewSource: normalizedReviewSource } : {}),
      ...(normalizedMobyScore !== null ? { mobyScore: normalizedMobyScore } : {}),
      ...(normalizedMobygamesGameId !== null ? { mobygamesGameId: normalizedMobygamesGameId } : {}),
      metacriticScore: normalizedMetacriticScore,
      metacriticUrl: normalizedMetacriticUrl,
      similarGameIgdbIds: this.normalizeGameIdList(
        (result as GameCatalogResult & { similarGameIgdbIds?: unknown }).similarGameIgdbIds
      ),
      collections: this.normalizeTextList(result.collections),
      developers: this.normalizeTextList(result.developers),
      franchises: this.normalizeTextList(result.franchises),
      genres: this.normalizeTextList(result.genres),
      ...(result.themes !== undefined ? { themes: this.normalizeTextList(result.themes) } : {}),
      ...(result.themeIds !== undefined
        ? { themeIds: this.normalizePositiveIntegerList(result.themeIds) }
        : {}),
      ...(result.keywords !== undefined
        ? { keywords: this.normalizeTextList(result.keywords) }
        : {}),
      ...(result.keywordIds !== undefined
        ? { keywordIds: this.normalizePositiveIntegerList(result.keywordIds) }
        : {}),
      ...(normalizedWebsites !== undefined ? { websites: normalizedWebsites } : {}),
      ...(normalizedSteamAppId !== null ? { steamAppId: normalizedSteamAppId } : {}),
      ...(normalizedPriceSource !== null ? { priceSource: normalizedPriceSource } : {}),
      ...(normalizedPriceFetchedAt !== null ? { priceFetchedAt: normalizedPriceFetchedAt } : {}),
      ...(normalizedPriceAmount !== null ? { priceAmount: normalizedPriceAmount } : {}),
      ...(normalizedPriceCurrency !== null ? { priceCurrency: normalizedPriceCurrency } : {}),
      ...(normalizedPriceRegularAmount !== null
        ? { priceRegularAmount: normalizedPriceRegularAmount }
        : {}),
      ...(normalizedPriceDiscountPercent !== null
        ? { priceDiscountPercent: normalizedPriceDiscountPercent }
        : {}),
      ...(normalizedPriceIsFree !== null ? { priceIsFree: normalizedPriceIsFree } : {}),
      ...(normalizedPriceUrl !== null ? { priceUrl: normalizedPriceUrl } : {}),
      ...(result.screenshots !== undefined
        ? { screenshots: normalizeGameScreenshots(result.screenshots, { maxItems: 20 }) }
        : {}),
      ...(result.videos !== undefined
        ? { videos: normalizeGameVideos(result.videos, { maxItems: 5 }) }
        : {}),
      publishers: this.normalizeTextList(result.publishers),
      platforms,
      platformOptions,
      platform: platforms.length === 1 ? platforms[0] : null,
      platformIgdbId: this.resolvePlatformIgdbId(result, platformOptions),
      releaseDate: this.normalizeReleaseDate(result.releaseDate),
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null,
    };
  }

  private normalizeGameType(value: unknown): GameType | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

    if (
      normalized === 'main_game' ||
      normalized === 'dlc_addon' ||
      normalized === 'expansion' ||
      normalized === 'bundle' ||
      normalized === 'standalone_expansion' ||
      normalized === 'mod' ||
      normalized === 'episode' ||
      normalized === 'season' ||
      normalized === 'remake' ||
      normalized === 'remaster' ||
      normalized === 'expanded_game' ||
      normalized === 'port' ||
      normalized === 'fork' ||
      normalized === 'pack' ||
      normalized === 'update'
    ) {
      return normalized;
    }

    return null;
  }

  private normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePriceSource(value: unknown): 'steam_store' | 'psprices' | null {
    if (value === 'steam_store' || value === 'psprices') {
      return value;
    }

    return null;
  }

  private normalizeCurrencyCode(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  private normalizeOptionalBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return null;
  }

  private normalizeOptionalNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = Number.parseFloat(value.trim());
      return Number.isFinite(normalized) ? normalized : null;
    }

    return null;
  }

  private normalizeCoverUrl(coverUrl: string | null | undefined): string | null {
    const normalized = typeof coverUrl === 'string' ? coverUrl.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    return this.withIgdbRetinaVariant(normalized);
  }

  private withIgdbRetinaVariant(url: string): string {
    return url.replace(
      /(\/igdb\/image\/upload\/)(t_[^/]+)(\/)/,
      (_match, prefix: string, sizeToken: string, suffix: string) => {
        if (sizeToken.endsWith('_2x')) {
          return `${prefix}${sizeToken}${suffix}`;
        }

        return `${prefix}${sizeToken}_2x${suffix}`;
      }
    );
  }

  private normalizePlatformOptions(result: GameCatalogResult): GameCatalogPlatformOption[] {
    const fromOptions = Array.isArray(result.platformOptions)
      ? result.platformOptions
          .map((option) => {
            const name = typeof option.name === 'string' ? option.name.trim() : '';
            const id =
              typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0
                ? option.id
                : null;
            return { id, name };
          })
          .filter((option) => option.name.length > 0)
      : [];

    if (fromOptions.length > 0) {
      return fromOptions.filter((option, index, items) => {
        return (
          items.findIndex(
            (candidate) => candidate.id === option.id && candidate.name === option.name
          ) === index
        );
      });
    }

    const fromArray = Array.isArray(result.platforms)
      ? result.platforms
          .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
          .filter((platform) => platform.length > 0)
      : [];

    if (fromArray.length > 0) {
      return [...new Set(fromArray)].map((name) => ({ id: null, name }));
    }

    if (typeof result.platform === 'string' && result.platform.trim().length > 0) {
      return [{ id: null, name: result.platform.trim() }];
    }

    return [];
  }

  private normalizeReleaseDate(releaseDate: string | null | undefined): string | null {
    if (typeof releaseDate !== 'string' || releaseDate.trim().length === 0) {
      return null;
    }

    const timestamp = Date.parse(releaseDate);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  private normalizeCompletionTimes(value: HltbCompletionTimes | null): HltbCompletionTimes | null {
    if (!value) {
      return null;
    }

    const valueRecord = value as unknown as Record<string, unknown>;
    const normalizedHltbGameId = this.normalizeHltbGameId(
      value.hltbGameId ?? valueRecord['gameId'] ?? valueRecord['id'] ?? null
    );
    const normalizedHltbUrl = this.normalizeHltbUrl(
      value.hltbUrl ?? valueRecord['gameUrl'] ?? valueRecord['url'] ?? null
    );
    const normalized: HltbCompletionTimes = {
      hltbMainHours: this.normalizeCompletionHours(value.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(value.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(value.hltbCompletionistHours),
      ...(normalizedHltbGameId !== null ? { hltbGameId: normalizedHltbGameId } : {}),
      ...(normalizedHltbUrl !== null ? { hltbUrl: normalizedHltbUrl } : {}),
    };

    if (
      normalized.hltbMainHours === null &&
      normalized.hltbMainExtraHours === null &&
      normalized.hltbCompletionistHours === null
    ) {
      return null;
    }

    return normalized;
  }

  private normalizeHltbCandidates(
    candidates: HltbMatchCandidate[] | null | undefined
  ): HltbMatchCandidate[] {
    if (!Array.isArray(candidates)) {
      return [];
    }

    return candidates
      .map((candidate) => {
        const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
        const releaseYear = Number.isInteger(candidate.releaseYear) ? candidate.releaseYear : null;
        const platform =
          typeof candidate.platform === 'string' && candidate.platform.trim().length > 0
            ? candidate.platform.trim()
            : null;
        const candidateRecord = candidate as unknown as Record<string, unknown>;
        const imageUrl = this.normalizeExternalImageUrl(
          typeof candidate.imageUrl === 'string'
            ? candidate.imageUrl
            : typeof candidateRecord['coverUrl'] === 'string'
              ? candidateRecord['coverUrl']
              : null
        );
        const hltbGameId = this.normalizeHltbGameId(
          candidate.hltbGameId ?? candidateRecord['gameId'] ?? candidateRecord['id'] ?? null
        );
        const hltbUrl = this.normalizeHltbUrl(
          candidate.hltbUrl ?? candidateRecord['gameUrl'] ?? candidateRecord['url'] ?? null
        );

        return {
          title,
          releaseYear,
          platform,
          hltbMainHours: this.normalizeCompletionHours(candidate.hltbMainHours),
          hltbMainExtraHours: this.normalizeCompletionHours(candidate.hltbMainExtraHours),
          hltbCompletionistHours: this.normalizeCompletionHours(candidate.hltbCompletionistHours),
          ...(hltbGameId !== null ? { hltbGameId } : {}),
          ...(hltbUrl !== null ? { hltbUrl } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter((candidate) => candidate.title.length > 0)
      .filter((candidate, index, all) => {
        return (
          all.findIndex(
            (entry) =>
              entry.title === candidate.title &&
              entry.releaseYear === candidate.releaseYear &&
              entry.platform === candidate.platform &&
              entry.hltbGameId === candidate.hltbGameId &&
              entry.hltbUrl === candidate.hltbUrl
          ) === index
        );
      })
      .map((candidate, index) => ({
        ...candidate,
        isRecommended: index === 0,
      }));
  }

  private toHltbCompletionTimes(candidate: HltbMatchCandidate): HltbCompletionTimes {
    return {
      hltbMainHours: candidate.hltbMainHours,
      hltbMainExtraHours: candidate.hltbMainExtraHours,
      hltbCompletionistHours: candidate.hltbCompletionistHours,
      ...(candidate.hltbGameId != null ? { hltbGameId: candidate.hltbGameId } : {}),
      ...(candidate.hltbUrl != null ? { hltbUrl: candidate.hltbUrl } : {}),
    };
  }

  private normalizeHltbGameId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = Number.parseInt(value.trim(), 10);
      return Number.isInteger(normalized) && normalized > 0 ? normalized : null;
    }

    return null;
  }

  private normalizeHltbUrl(value: unknown): string | null {
    return this.normalizeExternalUrl(typeof value === 'string' ? value : null);
  }

  private normalizeReviewScoreResult(
    value: MetacriticScoreResult | null,
    source: 'metacritic'
  ): ReviewScoreResult | null {
    if (!value) {
      return null;
    }

    const reviewScore = this.normalizeMetacriticScore(value.metacriticScore);
    const reviewUrl = this.normalizeExternalUrl(value.metacriticUrl);
    const normalized: ReviewScoreResult = {
      reviewScore,
      reviewUrl,
      reviewSource: source,
      mobyScore: null,
      metacriticScore: reviewScore,
      metacriticUrl: reviewUrl,
    };

    if (normalized.reviewScore === null && normalized.reviewUrl === null) {
      return null;
    }

    return normalized;
  }

  private normalizeReviewCandidates(
    candidates: MetacriticMatchCandidate[] | null | undefined,
    source: 'metacritic',
    preferredResult?: MetacriticScoreResult | null
  ): ReviewMatchCandidate[] {
    if (!Array.isArray(candidates)) {
      return [];
    }

    const normalizedPreferred = this.normalizeReviewScoreResult(preferredResult ?? null, source);

    const normalizedCandidates = candidates
      .map((candidate) => {
        const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
        const releaseYear = Number.isInteger(candidate.releaseYear) ? candidate.releaseYear : null;
        const platform =
          typeof candidate.platform === 'string' && candidate.platform.trim().length > 0
            ? candidate.platform.trim()
            : null;
        const candidateRecord = candidate as unknown as Record<string, unknown>;
        const rawMetacriticPlatforms = candidateRecord['metacriticPlatforms'];
        const metacriticPlatforms = Array.isArray(rawMetacriticPlatforms)
          ? rawMetacriticPlatforms
              .filter((platformName): platformName is string => typeof platformName === 'string')
              .map((platformName) => platformName.trim())
              .filter((platformName) => platformName.length > 0)
          : [];
        const imageUrl = this.normalizeExternalImageUrl(
          typeof candidate.imageUrl === 'string'
            ? candidate.imageUrl
            : typeof candidateRecord['coverUrl'] === 'string'
              ? candidateRecord['coverUrl']
              : null
        );
        const reviewScore = this.normalizeMetacriticScore(candidate.metacriticScore);
        const reviewUrl = this.normalizeExternalUrl(candidate.metacriticUrl);

        return {
          title,
          releaseYear,
          platform,
          reviewScore,
          reviewUrl,
          reviewSource: source,
          mobyScore: null,
          metacriticScore: reviewScore,
          metacriticUrl: reviewUrl,
          ...(metacriticPlatforms.length > 0 ? { metacriticPlatforms } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter((candidate) => candidate.title.length > 0)
      .filter((candidate) => candidate.reviewScore !== null || candidate.reviewUrl !== null)
      .filter((candidate, index, all) => {
        return (
          all.findIndex(
            (entry) =>
              entry.title === candidate.title &&
              entry.releaseYear === candidate.releaseYear &&
              entry.platform === candidate.platform &&
              entry.reviewUrl === candidate.reviewUrl
          ) === index
        );
      });

    const recommendedIndex = this.resolveRecommendedReviewCandidateIndex(
      normalizedCandidates,
      normalizedPreferred
    );

    return normalizedCandidates.map((candidate, index) => ({
      ...candidate,
      isRecommended: index === recommendedIndex,
    }));
  }

  private resolveRecommendedReviewCandidateIndex(
    candidates: ReviewMatchCandidate[],
    preferredResult: ReviewScoreResult | null
  ): number {
    if (candidates.length === 0) {
      return -1;
    }

    if (preferredResult) {
      const preferredUrl = preferredResult.reviewUrl ?? preferredResult.metacriticUrl ?? null;
      if (preferredUrl) {
        const byUrl = candidates.findIndex((candidate) => {
          const candidateUrl = candidate.reviewUrl ?? candidate.metacriticUrl ?? null;
          return candidateUrl === preferredUrl;
        });
        if (byUrl >= 0) {
          return byUrl;
        }
      }

      const preferredScore = preferredResult.reviewScore ?? preferredResult.metacriticScore ?? null;
      if (preferredScore !== null) {
        const byScore = candidates.findIndex((candidate) => {
          const candidateScore = candidate.reviewScore ?? candidate.metacriticScore ?? null;
          return candidateScore === preferredScore;
        });
        if (byScore >= 0) {
          return byScore;
        }
      }
    }

    return 0;
  }

  private buildMobyGamesParams(options: {
    query: string;
    platformName: string;
    platformIgdbId: number | null;
    mobygamesGameId?: number | null;
    limit: number;
  }): HttpParams {
    let params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'q',
      options.query
    );

    params = params
      .set('limit', String(options.limit))
      .set('format', 'normal')
      .set('include', 'title,moby_url,moby_score,critic_score,platforms,release_date,covers');

    const mobygamesPlatformId = this.resolveMobyGamesPlatformIdForIgdbPlatform(
      options.platformIgdbId,
      options.platformName
    );
    if (mobygamesPlatformId !== null) {
      params = params.set('platform', String(mobygamesPlatformId));
    }
    if (
      typeof options.mobygamesGameId === 'number' &&
      Number.isInteger(options.mobygamesGameId) &&
      options.mobygamesGameId > 0
    ) {
      params = params.set('id', String(options.mobygamesGameId));
    }

    return params;
  }

  private normalizeMobygamesReviewScoreResult(
    games: MobyGamesGameResult[] | null | undefined,
    options: {
      preferredMobyPlatformId: number | null;
      preferredPlatformName: string;
    }
  ): ReviewScoreResult | null {
    const normalizedCandidates = this.normalizeMobygamesReviewCandidates(games, options);
    const best = normalizedCandidates.at(0);

    if (!best) {
      return null;
    }

    return {
      reviewScore: best.reviewScore,
      reviewUrl: best.reviewUrl,
      reviewSource: best.reviewSource,
      mobyScore: best.mobyScore ?? null,
      mobygamesGameId: best.mobygamesGameId ?? null,
      metacriticScore: null,
      metacriticUrl: null,
    };
  }

  private normalizeMobygamesReviewCandidates(
    games: MobyGamesGameResult[] | null | undefined,
    options: {
      preferredMobyPlatformId: number | null;
      preferredPlatformName: string;
    }
  ): ReviewMatchCandidate[] {
    if (!Array.isArray(games)) {
      return [];
    }

    const mapped = games
      .map((game) => {
        const title = typeof game.title === 'string' ? game.title.trim() : '';
        const mobygamesGameId = this.normalizeMobygamesGameId(game.game_id);
        const mobyScore = this.normalizeRawMobyScore(game.moby_score);
        const releaseYear = this.normalizeMobygamesReleaseYear(game.release_date);
        const platform = this.normalizeMobygamesPlatform(
          game.platforms,
          options.preferredMobyPlatformId,
          options.preferredPlatformName
        );
        const reviewScore = this.normalizeMobygamesScore(game);
        const reviewUrl = this.normalizeExternalUrl(game.moby_url ?? null);
        const imageUrl = this.normalizeMobygamesImageUrl(
          game.covers,
          options.preferredMobyPlatformId,
          options.preferredPlatformName
        );

        return {
          title,
          releaseYear,
          platform,
          reviewScore,
          reviewUrl,
          reviewSource: 'mobygames' as const,
          mobyScore,
          mobygamesGameId,
          metacriticScore: null,
          metacriticUrl: null,
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter((candidate) => candidate.title.length > 0)
      .filter((candidate) => candidate.reviewScore !== null || candidate.reviewUrl !== null);

    const byKey = new Map<string, ReviewMatchCandidate>();
    for (const candidate of mapped) {
      const key = `${candidate.title}::${String(candidate.releaseYear ?? '')}::${candidate.platform ?? ''}`;
      const existing = byKey.get(key);

      if (!existing) {
        byKey.set(key, candidate);
        continue;
      }

      const shouldReplace =
        (existing.imageUrl == null && candidate.imageUrl != null) ||
        (existing.reviewScore == null && candidate.reviewScore != null);

      if (shouldReplace) {
        byKey.set(key, candidate);
      }
    }

    return [...byKey.values()].map((candidate, index) => ({
      ...candidate,
      isRecommended: index === 0,
    }));
  }

  private toLegacyMetacriticScoreResult(
    result: ReviewScoreResult | null
  ): MetacriticScoreResult | null {
    if (!result) {
      return null;
    }

    return {
      metacriticScore: this.normalizeMetacriticScore(result.reviewScore),
      metacriticUrl: this.normalizeExternalUrl(result.reviewUrl),
    };
  }

  private toReviewScoreResult(candidate: ReviewMatchCandidate): ReviewScoreResult {
    return {
      reviewScore: candidate.reviewScore ?? candidate.metacriticScore ?? null,
      reviewUrl: candidate.reviewUrl ?? candidate.metacriticUrl ?? null,
      reviewSource: candidate.reviewSource ?? null,
      mobyScore: candidate.mobyScore ?? null,
      mobygamesGameId: candidate.mobygamesGameId ?? null,
      metacriticScore: candidate.metacriticScore ?? null,
      metacriticUrl: candidate.metacriticUrl ?? null,
    };
  }

  private toLegacyMetacriticCandidate(candidate: ReviewMatchCandidate): MetacriticMatchCandidate {
    return {
      title: candidate.title,
      releaseYear: candidate.releaseYear,
      platform: candidate.platform,
      ...(candidate.metacriticPlatforms
        ? { metacriticPlatforms: candidate.metacriticPlatforms }
        : {}),
      metacriticScore: this.normalizeMetacriticScore(candidate.reviewScore),
      metacriticUrl: this.normalizeExternalUrl(candidate.reviewUrl),
      isRecommended: candidate.isRecommended,
      ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    };
  }

  private normalizeMobygamesReleaseYear(releaseDate: string | null | undefined): number | null {
    if (typeof releaseDate !== 'string' || releaseDate.trim().length === 0) {
      return null;
    }

    const raw = releaseDate.trim();
    const isoYearMatch = raw.match(/^(\d{4})/);
    if (isoYearMatch) {
      const year = Number.parseInt(isoYearMatch[1], 10);
      return Number.isInteger(year) ? year : null;
    }

    const parsedDate = Date.parse(raw);
    if (!Number.isFinite(parsedDate)) {
      return null;
    }
    const year = new Date(parsedDate).getUTCFullYear();
    return Number.isInteger(year) ? year : null;
  }

  private normalizeMobygamesPlatform(
    platforms:
      | Array<{
          id?: number | string | null;
          platform_id?: number | string | null;
          name?: string | null;
          platform_name?: string | null;
        }>
      | null
      | undefined,
    preferredMobyPlatformId: number | null,
    preferredPlatformName: string
  ): string | null {
    if (!Array.isArray(platforms)) {
      return null;
    }

    if (preferredMobyPlatformId !== null) {
      for (const entry of platforms) {
        const entryPlatformId = this.normalizeMobygamesGameId(entry.platform_id ?? entry.id);
        if (entryPlatformId !== preferredMobyPlatformId) {
          continue;
        }

        const matchedLabel = this.readMobygamesPlatformLabel(entry);
        if (matchedLabel) {
          return matchedLabel;
        }
      }
    }

    const preferredPlatformKey = this.normalizePlatformNameKey(preferredPlatformName);
    if (preferredPlatformKey.length > 0) {
      for (const entry of platforms) {
        const candidateLabel = this.readMobygamesPlatformLabel(entry);
        if (!candidateLabel) {
          continue;
        }
        if (this.normalizePlatformNameKey(candidateLabel) === preferredPlatformKey) {
          return candidateLabel;
        }
      }
    }

    for (const entry of platforms) {
      const normalized = this.readMobygamesPlatformLabel(entry);
      if (normalized) {
        return normalized;
      }
    }

    return null;
  }

  private normalizeMobygamesScore(game: MobyGamesGameResult): number | null {
    const criticScore = this.normalizeMetacriticScore(
      this.normalizeMobygamesNumericScore(game.critic_score)
    );
    if (criticScore !== null) {
      return criticScore;
    }

    const mobyScore = this.normalizeMobygamesNumericScore(game.moby_score);
    if (mobyScore === null) {
      return null;
    }

    // Internal review score stays on 0-100 scale, so convert Moby's 0-10 score.
    const normalizedMobyScore = mobyScore > 0 && mobyScore <= 10 ? mobyScore * 10 : mobyScore;
    return this.normalizeMetacriticScore(normalizedMobyScore);
  }

  private normalizeRawMobyScore(value: number | string | null | undefined): number | null {
    const normalized = this.normalizeMobygamesNumericScore(value);
    if (normalized === null || normalized <= 0 || normalized > 10) {
      return null;
    }

    return Math.round(normalized * 10) / 10;
  }

  private normalizeMobygamesNumericScore(value: number | string | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length === 0) {
        return null;
      }

      const parsed = Number.parseFloat(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeMobygamesGameId(value: number | string | null | undefined): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!/^\d+$/.test(normalized)) {
        return null;
      }

      const parsed = Number.parseInt(normalized, 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    return null;
  }

  private normalizeMobygamesImageUrl(
    covers:
      | Array<{
          platforms?: Array<
            | number
            | string
            | {
                id?: number | string | null;
                platform_id?: number | string | null;
                platform_name?: string | null;
                name?: string | null;
              }
          > | null;
          images?: Array<{
            thumbnail_url?: string | null;
            image_url?: string | null;
            original_url?: string | null;
            moby_url?: string | null;
            caption?: string | null;
            type?: {
              id?: number | string | null;
              name?: string | null;
            } | null;
          }> | null;
        }>
      | null
      | undefined,
    preferredMobyPlatformId: number | null,
    preferredPlatformName: string
  ): string | null {
    if (!Array.isArray(covers) || covers.length === 0) {
      return null;
    }

    const candidateCovers =
      preferredMobyPlatformId === null
        ? covers
        : covers.filter((cover) =>
            this.mobygamesCoverMatchesPlatform(
              cover.platforms,
              preferredMobyPlatformId,
              preferredPlatformName
            )
          );

    if (candidateCovers.length === 0) {
      return null;
    }

    const frontUrl = this.findMobygamesCoverImage(candidateCovers, true);
    if (frontUrl) {
      return frontUrl;
    }

    return this.findMobygamesCoverImage(candidateCovers, false);
  }

  private findMobygamesCoverImage(
    covers: Array<{
      platforms?: Array<
        | number
        | string
        | {
            id?: number | string | null;
            platform_id?: number | string | null;
            platform_name?: string | null;
            name?: string | null;
          }
      > | null;
      images?: Array<{
        thumbnail_url?: string | null;
        image_url?: string | null;
        original_url?: string | null;
        moby_url?: string | null;
        caption?: string | null;
        type?: {
          id?: number | string | null;
          name?: string | null;
        } | null;
      }> | null;
    }>,
    frontOnly: boolean
  ): string | null {
    for (const cover of covers) {
      if (!Array.isArray(cover.images)) {
        continue;
      }

      for (const image of cover.images) {
        if (frontOnly && !this.mobygamesImageTypeIsFront(image.type?.name)) {
          continue;
        }

        const url =
          this.normalizeExternalImageUrl(image.thumbnail_url ?? null) ??
          this.normalizeExternalImageUrl(image.image_url ?? null) ??
          this.normalizeExternalImageUrl(image.original_url ?? null) ??
          this.normalizeExternalImageUrl(image.moby_url ?? null);

        if (url) {
          return url;
        }
      }
    }

    return null;
  }

  private mobygamesImageTypeIsFront(value: string | null | undefined): boolean {
    const normalized =
      typeof value === 'string'
        ? value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')
        : '';
    return normalized.includes('front');
  }

  private mobygamesCoverMatchesPlatform(
    platforms:
      | Array<
          | number
          | string
          | {
              id?: number | string | null;
              platform_id?: number | string | null;
              platform_name?: string | null;
              name?: string | null;
            }
        >
      | null
      | undefined,
    preferredMobyPlatformId: number,
    preferredPlatformName: string
  ): boolean {
    if (!Array.isArray(platforms)) {
      return false;
    }

    const preferredPlatformKey = this.normalizePlatformNameKey(preferredPlatformName);

    for (const platform of platforms) {
      const platformId =
        typeof platform === 'number' || typeof platform === 'string'
          ? this.normalizeMobygamesGameId(platform)
          : this.normalizeMobygamesGameId(platform.platform_id ?? platform.id);
      if (platformId === preferredMobyPlatformId) {
        return true;
      }

      if (preferredPlatformKey.length > 0 && typeof platform === 'object') {
        const platformLabel =
          typeof platform.platform_name === 'string'
            ? platform.platform_name.trim()
            : typeof platform.name === 'string'
              ? platform.name.trim()
              : '';
        if (this.normalizePlatformNameKey(platformLabel) === preferredPlatformKey) {
          return true;
        }
      }
    }

    return false;
  }

  private readMobygamesPlatformLabel(entry: {
    id?: number | string | null;
    platform_id?: number | string | null;
    name?: string | null;
    platform_name?: string | null;
  }): string | null {
    const normalized =
      typeof entry.platform_name === 'string'
        ? entry.platform_name.trim()
        : typeof entry.name === 'string'
          ? entry.name.trim()
          : '';
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePlatformNameKey(value: string | null | undefined): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  private normalizeExternalImageUrl(value: string | null): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    if (normalized.startsWith('//')) {
      return `https:${normalized}`;
    }

    return normalized;
  }

  private normalizeExternalUrl(value: string | null | undefined): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';

    if (normalized.length === 0) {
      return null;
    }

    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return normalized;
    }

    if (normalized.startsWith('//')) {
      return `https:${normalized}`;
    }

    return null;
  }

  private normalizeWebsites(value: unknown): GameWebsite[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value)) {
      return [];
    }

    const normalized: GameWebsite[] = [];
    const seen = new Set<string>();

    for (const entry of value) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const provider = this.normalizeWebsiteProvider(record['provider']);
      const url =
        typeof record['url'] === 'string' ? sanitizeExternalHttpUrlString(record['url']) : null;

      if (url === null) {
        continue;
      }

      const dedupeKey = url;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      normalized.push({
        provider,
        providerLabel:
          provider !== null
            ? this.normalizeWebsiteProviderLabel(record['providerLabel'], provider)
            : this.normalizeOptionalText(record['providerLabel']),
        url,
        typeId: this.normalizePositiveInteger(record['typeId']),
        typeName: this.normalizeOptionalText(record['typeName']),
        trusted: this.normalizeOptionalBoolean(record['trusted']),
      });
    }

    return normalized;
  }

  private normalizeWebsiteProvider(value: unknown): GameWebsite['provider'] | null {
    return value === 'steam' ||
      value === 'playstation' ||
      value === 'xbox' ||
      value === 'nintendo' ||
      value === 'epic' ||
      value === 'gog' ||
      value === 'itch' ||
      value === 'apple' ||
      value === 'android' ||
      value === 'amazon' ||
      value === 'oculus' ||
      value === 'gamejolt' ||
      value === 'kartridge' ||
      value === 'utomik' ||
      value === 'unknown'
      ? value
      : null;
  }

  private normalizeWebsiteProviderLabel(
    value: unknown,
    provider: Exclude<GameWebsite['provider'], null>
  ): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length > 0) {
      return normalized;
    }

    switch (provider) {
      case 'steam':
        return 'Steam';
      case 'playstation':
        return 'PlayStation';
      case 'xbox':
        return 'Xbox';
      case 'nintendo':
        return 'Nintendo';
      case 'epic':
        return 'Epic Games Store';
      case 'gog':
        return 'GOG';
      case 'itch':
        return 'itch.io';
      case 'apple':
        return 'Apple App Store';
      case 'android':
        return 'Google Play';
      case 'amazon':
        return 'Amazon';
      case 'oculus':
        return 'Meta Quest';
      case 'gamejolt':
        return 'Game Jolt';
      case 'kartridge':
        return 'Kartridge';
      case 'utomik':
        return 'Utomik';
      default:
        return 'Unknown Store';
    }
  }

  private inferReviewSourceFromUrl(url: string | null): 'metacritic' | 'mobygames' | null {
    if (typeof url !== 'string' || url.length === 0) {
      return null;
    }

    return detectReviewSourceFromUrl(url);
  }

  private normalizeCompletionHours(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private normalizeMetacriticScore(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.round(value);

    if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 100) {
      return null;
    }

    return normalized;
  }

  private normalizeUnknown(value: unknown): unknown {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    return value;
  }

  private resolvePlatformIgdbId(
    result: GameCatalogResult,
    platformOptions: GameCatalogPlatformOption[]
  ): number | null {
    if (
      typeof result.platformIgdbId === 'number' &&
      Number.isInteger(result.platformIgdbId) &&
      result.platformIgdbId > 0
    ) {
      return result.platformIgdbId;
    }

    if (platformOptions.length === 1) {
      return platformOptions[0].id ?? null;
    }

    return null;
  }

  private resolveMobyGamesPlatformIdForIgdbPlatform(
    platformIgdbId: number | null,
    platformName: string | null | undefined
  ): number | null {
    const canonicalPlatformIgdbId =
      this.platformCustomizationService.resolveCanonicalPlatformIgdbId(
        platformName,
        platformIgdbId
      );
    return resolveMobyGamesPlatformId(canonicalPlatformIgdbId);
  }

  private normalizeCoverSource(
    coverSource: string | null | undefined
  ): 'thegamesdb' | 'igdb' | 'none' {
    if (coverSource === 'thegamesdb' || coverSource === 'igdb' || coverSource === 'none') {
      return coverSource;
    }

    return 'none';
  }

  private normalizeBoxArtResults(items: string[] | null | undefined): string[] {
    if (!Array.isArray(items)) {
      return [];
    }

    return [
      ...new Set(
        items
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.startsWith('http://') || item.startsWith('https://'))
      ),
    ];
  }

  private normalizePlatformList(
    items: GameCatalogPlatformOption[] | null | undefined
  ): GameCatalogPlatformOption[] {
    if (!Array.isArray(items)) {
      return [];
    }

    const normalized = items
      .map((option) => {
        const name = typeof option.name === 'string' ? option.name.trim() : '';
        const id =
          typeof option.id === 'number' && Number.isInteger(option.id) && option.id > 0
            ? option.id
            : null;

        return { id, name };
      })
      .filter((option) => option.id !== null && option.name.length > 0) as {
      id: number;
      name: string;
    }[];

    return normalized
      .filter((option, index, all) => {
        return all.findIndex((candidate) => candidate.id === option.id) === index;
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      );
  }

  private normalizeTextList(values: string[] | null | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      ),
    ];
  }

  private normalizeGameIdList(values: unknown): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values.map((value) => String(value ?? '').trim()).filter((value) => /^\d+$/.test(value))
      ),
    ];
  }

  private normalizePositiveIntegerList(values: unknown): number[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values
          .map((entry) =>
            typeof entry === 'number'
              ? entry
              : typeof entry === 'string'
                ? Number.parseInt(entry, 10)
                : Number.NaN
          )
          .filter((entry) => Number.isInteger(entry) && entry > 0)
      ),
    ];
  }

  private normalizePopularityValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value.trim());

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private normalizePopularityFeedResponse(value: unknown): PopularityFeedResponse {
    if (typeof value !== 'object' || value === null) {
      return {
        items: [],
        page: { offset: 0, limit: 10, hasMore: false, nextOffset: null },
      };
    }

    const record = value as Record<string, unknown>;
    const items = Array.isArray(record['items'])
      ? record['items']
          .map((item) => this.normalizePopularityFeedItem(item))
          .filter((item): item is PopularityFeedItem => item !== null)
      : [];

    return {
      items,
      page: this.normalizePageInfo(record['page']),
    };
  }

  private normalizePopularityFeedItem(value: unknown): PopularityFeedItem | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const id = this.normalizeNumericId(record['id']);
    const platformIgdbId = this.normalizePositiveInteger(record['platformIgdbId']);
    const popularityScore = this.normalizePopularityValue(record['popularityScore']);

    if (!id || platformIgdbId === null || popularityScore === null) {
      return null;
    }

    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    if (name.length === 0) {
      return null;
    }

    const firstReleaseDateRaw = this.normalizePopularityValue(record['firstReleaseDate']);
    const firstReleaseDate =
      firstReleaseDateRaw !== null &&
      Number.isInteger(firstReleaseDateRaw) &&
      firstReleaseDateRaw > 0
        ? firstReleaseDateRaw
        : null;

    return {
      id,
      platformIgdbId,
      name,
      coverUrl:
        typeof record['coverUrl'] === 'string' && record['coverUrl'].trim().length > 0
          ? record['coverUrl'].trim()
          : null,
      rating: this.normalizePopularityValue(record['rating']),
      popularityScore,
      firstReleaseDate,
      platforms: this.normalizePopularityFeedPlatforms(record['platforms']),
    };
  }

  private normalizePopularityFeedPlatforms(value: unknown): { id: number; name: string }[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry): { id: number; name: string } | null => {
        if (typeof entry !== 'object' || entry === null) {
          return null;
        }

        const record = entry as Record<string, unknown>;
        const id = this.normalizePositiveInteger(record['id']);
        const name = typeof record['name'] === 'string' ? record['name'].trim() : '';

        if (id === null || name.length === 0) {
          return null;
        }

        return { id, name };
      })
      .filter((entry): entry is { id: number; name: string } => entry !== null);
  }

  private buildRecommendationTopQueryParams(params: {
    target: RecommendationTarget;
    runtimeMode?: RecommendationRuntimeMode;
    limit?: number;
  }): HttpParams {
    const normalizedTarget = this.normalizeRecommendationTarget(params.target);
    const normalizedRuntimeMode = this.normalizeRecommendationRuntimeMode(params.runtimeMode);
    const normalizedLimit =
      Number.isInteger(params.limit) && (params.limit as number) > 0
        ? Math.min(params.limit as number, 200)
        : 20;
    let query = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'target',
      normalizedTarget
    );

    query = query.set('limit', String(normalizedLimit));

    if (normalizedRuntimeMode) {
      query = query.set('runtimeMode', normalizedRuntimeMode);
    }

    return query;
  }

  private buildRecommendationQueryParams(params: {
    target: RecommendationTarget;
    lane?: RecommendationLaneKey;
    runtimeMode?: RecommendationRuntimeMode;
    offset?: number;
    limit?: number;
  }): HttpParams {
    const normalizedTarget = this.normalizeRecommendationTarget(params.target);
    const normalizedRuntimeMode = this.normalizeRecommendationRuntimeMode(params.runtimeMode);
    const normalizedLimit =
      Number.isInteger(params.limit) && (params.limit as number) > 0
        ? Math.min(params.limit as number, 50)
        : 10;
    const normalizedOffset =
      Number.isInteger(params.offset) && (params.offset as number) >= 0
        ? (params.offset as number)
        : 0;
    let query = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER }).set(
      'target',
      normalizedTarget
    );

    query = query.set('limit', String(normalizedLimit));
    query = query.set('offset', String(normalizedOffset));

    if (normalizedRuntimeMode) {
      query = query.set('runtimeMode', normalizedRuntimeMode);
    }

    if (params.lane) {
      query = query.set('lane', params.lane);
    }

    return query;
  }

  private buildPageQueryParams(params: { offset?: number; limit?: number }): HttpParams {
    const normalizedLimit =
      Number.isInteger(params.limit) && (params.limit as number) > 0
        ? Math.min(params.limit as number, 50)
        : 10;
    const normalizedOffset =
      Number.isInteger(params.offset) && (params.offset as number) >= 0
        ? (params.offset as number)
        : 0;

    return new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('limit', String(normalizedLimit))
      .set('offset', String(normalizedOffset));
  }

  private normalizeRecommendationTopResponse(
    value: RecommendationTopApiResponse,
    fallbackTarget: RecommendationTarget
  ): RecommendationTopResponse {
    return {
      target: this.normalizeRecommendationTarget(value.target, fallbackTarget),
      runtimeMode: this.normalizeRecommendationRuntimeMode(value.runtimeMode) ?? 'NEUTRAL',
      runId: this.normalizePositiveInteger(value.runId) ?? 0,
      generatedAt: this.normalizeIsoDate(value.generatedAt),
      items: this.normalizeRecommendationItems(value.items),
    };
  }

  private normalizeRecommendationLanesResponse(
    value: RecommendationLanesApiResponse,
    fallbackTarget: RecommendationTarget,
    requestedLane: RecommendationLaneKey
  ): RecommendationLanesResponse {
    const lane = this.normalizeRecommendationLaneKey(value.lane) ?? requestedLane;
    const items =
      value.items !== undefined
        ? this.normalizeRecommendationItems(value.items)
        : this.normalizeLegacyRecommendationLaneItems(value.lanes, lane);

    return {
      target: this.normalizeRecommendationTarget(value.target, fallbackTarget),
      runtimeMode: this.normalizeRecommendationRuntimeMode(value.runtimeMode) ?? 'NEUTRAL',
      runId: this.normalizePositiveInteger(value.runId) ?? 0,
      generatedAt: this.normalizeIsoDate(value.generatedAt),
      lane,
      items,
      page:
        value.page !== undefined
          ? this.normalizePageInfo(value.page)
          : {
              offset: 0,
              limit: items.length > 0 ? items.length : 10,
              hasMore: false,
              nextOffset: null,
            },
    };
  }

  private normalizeLegacyRecommendationLaneItems(
    value: unknown,
    lane: RecommendationLaneKey
  ): RecommendationItem[] {
    const lanes =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

    const overall = this.normalizeRecommendationItems(lanes['overall']);
    const hiddenGems = this.normalizeRecommendationItems(lanes['hiddenGems']);
    const exploration = this.normalizeRecommendationItems(lanes['exploration']);
    const blended = this.normalizeRecommendationItems(lanes['blended']);
    const popular = this.normalizeRecommendationItems(lanes['popular']);
    const recent = this.normalizeRecommendationItems(lanes['recent']);

    switch (lane) {
      case 'overall':
        return overall;
      case 'hiddenGems':
        return hiddenGems;
      case 'exploration':
        return exploration;
      case 'blended':
        return blended.length > 0 ? blended : overall;
      case 'popular':
        return popular.length > 0 ? popular : hiddenGems;
      case 'recent':
        return recent.length > 0 ? recent : exploration;
    }
  }

  private normalizeRecommendationRebuildResponse(
    value: RecommendationRebuildApiResponse,
    fallbackTarget: RecommendationTarget
  ): RecommendationRebuildResponse {
    const status =
      value.status === 'QUEUED' ||
      value.status === 'SUCCESS' ||
      value.status === 'FAILED' ||
      value.status === 'SKIPPED' ||
      value.status === 'LOCKED' ||
      value.status === 'BACKOFF_SKIPPED'
        ? value.status
        : 'FAILED';

    return {
      target: this.normalizeRecommendationTarget(value.target, fallbackTarget),
      runId: this.normalizePositiveInteger(value.runId) ?? 0,
      status,
      reusedRunId: this.normalizePositiveInteger(value.reusedRunId) ?? null,
    };
  }

  private normalizeRecommendationItems(value: unknown): RecommendationItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): RecommendationItem | null => {
        if (typeof item !== 'object' || item === null) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const igdbGameId = this.normalizeNumericId(record['igdbGameId']);
        const platformIgdbId = this.normalizePositiveInteger(record['platformIgdbId']);

        if (!igdbGameId || platformIgdbId === null) {
          return null;
        }

        const scoreComponentsRaw =
          typeof record['scoreComponents'] === 'object' && record['scoreComponents'] !== null
            ? (record['scoreComponents'] as Record<string, unknown>)
            : null;
        const explanationsRaw =
          typeof record['explanations'] === 'object' && record['explanations'] !== null
            ? (record['explanations'] as Record<string, unknown>)
            : null;
        const matchedTokensRaw =
          explanationsRaw &&
          typeof explanationsRaw['matchedTokens'] === 'object' &&
          explanationsRaw['matchedTokens'] !== null
            ? (explanationsRaw['matchedTokens'] as Record<string, unknown>)
            : null;
        const bulletsRaw = Array.isArray(explanationsRaw?.['bullets'])
          ? (explanationsRaw['bullets'] as Array<{
              type?: unknown;
              label?: unknown;
              evidence?: unknown;
              delta?: unknown;
            }>)
          : [];

        return {
          rank: this.normalizePositiveInteger(record['rank']) ?? 0,
          igdbGameId,
          platformIgdbId,
          scoreTotal: this.normalizePopularityValue(record['scoreTotal']) ?? 0,
          scoreComponents: {
            taste: this.normalizePopularityValue(scoreComponentsRaw?.['taste']) ?? 0,
            novelty: this.normalizePopularityValue(scoreComponentsRaw?.['novelty']) ?? 0,
            runtimeFit: this.normalizePopularityValue(scoreComponentsRaw?.['runtimeFit']) ?? 0,
            criticBoost: this.normalizePopularityValue(scoreComponentsRaw?.['criticBoost']) ?? 0,
            recencyBoost: this.normalizePopularityValue(scoreComponentsRaw?.['recencyBoost']) ?? 0,
            semantic: this.normalizePopularityValue(scoreComponentsRaw?.['semantic']) ?? 0,
            exploration: this.normalizePopularityValue(scoreComponentsRaw?.['exploration']) ?? 0,
            diversityPenalty:
              this.normalizePopularityValue(scoreComponentsRaw?.['diversityPenalty']) ?? 0,
            repeatPenalty:
              this.normalizePopularityValue(scoreComponentsRaw?.['repeatPenalty']) ?? 0,
          },
          explanations: {
            headline:
              typeof explanationsRaw?.['headline'] === 'string'
                ? explanationsRaw['headline'].trim()
                : '',
            bullets: bulletsRaw
              .map((bullet) => ({
                type: this.normalizeRecommendationBulletType(bullet.type),
                label: typeof bullet.label === 'string' ? bullet.label.trim() : '',
                evidence: Array.isArray(bullet.evidence)
                  ? bullet.evidence
                      .map((evidence) => (typeof evidence === 'string' ? evidence.trim() : ''))
                      .filter((evidence) => evidence.length > 0)
                  : [],
                delta: this.normalizePopularityValue(bullet.delta) ?? 0,
              }))
              .filter((bullet) => bullet.label.length > 0),
            matchedTokens: {
              genres: this.normalizeTextList(matchedTokensRaw?.['genres'] as string[] | undefined),
              developers: this.normalizeTextList(
                matchedTokensRaw?.['developers'] as string[] | undefined
              ),
              publishers: this.normalizeTextList(
                matchedTokensRaw?.['publishers'] as string[] | undefined
              ),
              franchises: this.normalizeTextList(
                matchedTokensRaw?.['franchises'] as string[] | undefined
              ),
              collections: this.normalizeTextList(
                matchedTokensRaw?.['collections'] as string[] | undefined
              ),
              themes: this.normalizeTextList(matchedTokensRaw?.['themes'] as string[] | undefined),
              keywords: this.normalizeTextList(
                matchedTokensRaw?.['keywords'] as string[] | undefined
              ),
            },
          },
        };
      })
      .filter((item): item is RecommendationItem => item !== null);
  }

  private normalizeRecommendationSimilarResponse(
    value: RecommendationSimilarApiResponse,
    fallbackSource: { igdbGameId: string; platformIgdbId: number }
  ): RecommendationSimilarResponse {
    const sourceRaw =
      typeof value.source === 'object' && value.source !== null
        ? (value.source as Record<string, unknown>)
        : {};

    return {
      runtimeMode: this.normalizeRecommendationRuntimeMode(value.runtimeMode) ?? 'NEUTRAL',
      source: {
        igdbGameId: this.normalizeNumericId(sourceRaw['igdbGameId']) || fallbackSource.igdbGameId,
        platformIgdbId:
          this.normalizePositiveInteger(sourceRaw['platformIgdbId']) ??
          fallbackSource.platformIgdbId,
      },
      items: this.normalizeRecommendationSimilarItems(value.items),
      page: this.normalizePageInfo(value.page),
    };
  }

  private normalizeRecommendationSimilarItems(value: unknown): RecommendationSimilarItem[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): RecommendationSimilarItem | null => {
        if (typeof item !== 'object' || item === null) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const igdbGameId = this.normalizeNumericId(record['igdbGameId']);
        const platformIgdbId = this.normalizePositiveInteger(record['platformIgdbId']);
        const reasonsRaw =
          typeof record['reasons'] === 'object' && record['reasons'] !== null
            ? (record['reasons'] as Record<string, unknown>)
            : {};
        const sharedTokensRaw =
          typeof reasonsRaw['sharedTokens'] === 'object' && reasonsRaw['sharedTokens'] !== null
            ? (reasonsRaw['sharedTokens'] as Record<string, unknown>)
            : {};

        if (!igdbGameId || platformIgdbId === null) {
          return null;
        }

        return {
          igdbGameId,
          platformIgdbId,
          similarity: this.normalizePopularityValue(record['similarity']) ?? 0,
          reasons: {
            summary: typeof reasonsRaw['summary'] === 'string' ? reasonsRaw['summary'].trim() : '',
            structuredSimilarity:
              this.normalizePopularityValue(reasonsRaw['structuredSimilarity']) ?? 0,
            semanticSimilarity:
              this.normalizePopularityValue(reasonsRaw['semanticSimilarity']) ?? 0,
            blendedSimilarity: this.normalizePopularityValue(reasonsRaw['blendedSimilarity']) ?? 0,
            sharedTokens: {
              genres: this.normalizeTextList(sharedTokensRaw['genres'] as string[] | undefined),
              developers: this.normalizeTextList(
                sharedTokensRaw['developers'] as string[] | undefined
              ),
              publishers: this.normalizeTextList(
                sharedTokensRaw['publishers'] as string[] | undefined
              ),
              franchises: this.normalizeTextList(
                sharedTokensRaw['franchises'] as string[] | undefined
              ),
              collections: this.normalizeTextList(
                sharedTokensRaw['collections'] as string[] | undefined
              ),
              themes: this.normalizeTextList(sharedTokensRaw['themes'] as string[] | undefined),
              keywords: this.normalizeTextList(sharedTokensRaw['keywords'] as string[] | undefined),
            },
          },
        };
      })
      .filter((item): item is RecommendationSimilarItem => item !== null);
  }

  private normalizeRecommendationBulletType(
    value: unknown
  ): RecommendationItem['explanations']['bullets'][number]['type'] {
    if (
      value === 'taste' ||
      value === 'novelty' ||
      value === 'runtime' ||
      value === 'critic' ||
      value === 'recency' ||
      value === 'semantic' ||
      value === 'exploration' ||
      value === 'diversity' ||
      value === 'repeat'
    ) {
      return value;
    }

    return 'taste';
  }

  private normalizeRecommendationTarget(
    value: unknown,
    fallback: RecommendationTarget = 'BACKLOG'
  ): RecommendationTarget {
    if (value === 'BACKLOG' || value === 'WISHLIST' || value === 'DISCOVERY') {
      return value;
    }

    return fallback;
  }

  private normalizeRecommendationRuntimeMode(value: unknown): RecommendationRuntimeMode | null {
    if (value === 'NEUTRAL' || value === 'SHORT' || value === 'LONG') {
      return value;
    }

    return null;
  }

  private normalizeIsoDate(value: unknown): string {
    if (typeof value !== 'string') {
      return new Date(0).toISOString();
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return new Date(0).toISOString();
    }

    const parsed = Date.parse(trimmed);
    if (Number.isNaN(parsed)) {
      return new Date(0).toISOString();
    }

    return new Date(parsed).toISOString();
  }

  private normalizePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      const parsed = Number.parseInt(value.trim(), 10);
      return parsed > 0 ? parsed : null;
    }

    return null;
  }

  private normalizeNonNegativeInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value;
    }

    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }

    return null;
  }

  private normalizePageInfo(value: unknown): {
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
  } {
    const record =
      typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    return {
      offset: this.normalizeNonNegativeInteger(record['offset']) ?? 0,
      limit: this.normalizePositiveInteger(record['limit']) ?? 10,
      hasMore: record['hasMore'] === true,
      nextOffset: this.normalizeNonNegativeInteger(record['nextOffset']),
    };
  }

  private normalizeRecommendationLaneKey(value: unknown): RecommendationLaneKey | null {
    return value === 'overall' ||
      value === 'hiddenGems' ||
      value === 'exploration' ||
      value === 'blended' ||
      value === 'popular' ||
      value === 'recent'
      ? value
      : null;
  }

  private normalizeNumericId(value: unknown): string {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return /^\d+$/.test(normalized) ? normalized : '';
    }

    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return String(value);
    }

    return '';
  }

  private toRecommendationError(error: unknown): Error {
    if (this.isRecommendationApiError(error)) {
      return error;
    }

    const rateLimitError = this.toRateLimitError(error);
    if (rateLimitError) {
      return rateLimitError;
    }

    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return this.createRecommendationApiError(
          'NOT_FOUND',
          'No recommendations available yet. Build recommendations to get started.'
        );
      }

      if (error.status === 429) {
        return this.createRecommendationApiError(
          'RATE_LIMITED',
          'Recommendations are cooling down after a failed run. Try again later.'
        );
      }

      if (error.status === 400) {
        return this.createRecommendationApiError(
          'INVALID_REQUEST',
          'Invalid recommendation query.'
        );
      }
    }

    return this.createRecommendationApiError(
      'REQUEST_FAILED',
      'Unable to load recommendations right now.'
    );
  }

  private throwIfRecommendationQueued(value: { status?: unknown; error?: unknown }): void {
    if (value.status === 'QUEUED') {
      throw this.createRecommendationApiError(
        'NOT_FOUND',
        'No recommendations available yet. Build recommendations to get started.'
      );
    }
  }

  private isRecommendationApiError(error: unknown): error is Error & { code: string } {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      (error as { code?: unknown }).code === 'NOT_FOUND' ||
      (error as { code?: unknown }).code === 'RATE_LIMITED' ||
      (error as { code?: unknown }).code === 'REQUEST_FAILED' ||
      (error as { code?: unknown }).code === 'INVALID_REQUEST'
    );
  }

  private createRecommendationApiError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  }

  private saveCachedPlatformList(items: GameCatalogPlatformOption[]): void {
    try {
      localStorage.setItem(this.platformCacheStorageKey, JSON.stringify(items));
    } catch {
      // Ignore storage failures.
    }
  }

  private loadCachedPlatformList(): GameCatalogPlatformOption[] {
    try {
      const raw = localStorage.getItem(this.platformCacheStorageKey);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as unknown;
      return this.normalizePlatformList(parsed as GameCatalogPlatformOption[]);
    } catch {
      return [];
    }
  }

  private parseRetryAfterMs(error: HttpErrorResponse): number | null {
    const value = error.headers.get('Retry-After');

    if (!value) {
      return null;
    }

    const seconds = Number.parseInt(value, 10);

    if (Number.isInteger(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const dateMs = Date.parse(value);

    if (Number.isNaN(dateMs)) {
      return null;
    }

    return Math.max(0, dateMs - Date.now());
  }

  private toRateLimitError(error: unknown): Error | null {
    if (!(error instanceof HttpErrorResponse) || error.status !== 429) {
      return null;
    }

    const retryAfterMs =
      this.parseRetryAfterMs(error) ?? IgdbProxyService.RATE_LIMIT_FALLBACK_COOLDOWN_MS;
    this.rateLimitCooldownUntilMs = Math.max(
      this.rateLimitCooldownUntilMs,
      Date.now() + retryAfterMs
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((this.rateLimitCooldownUntilMs - Date.now()) / 1000)
    );
    return new Error(`Rate limit exceeded. Retry after ${String(retryAfterSeconds)}s.`);
  }

  private createCooldownErrorIfActive(): Error | null {
    const remainingMs = this.rateLimitCooldownUntilMs - Date.now();

    if (remainingMs <= 0) {
      return null;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return new Error(`Rate limit exceeded. Retry after ${String(retryAfterSeconds)}s.`);
  }

  private claimMobyGamesSlot(): { delayMs: number; releaseSlot: () => void } {
    const now = Date.now();
    const slotMs = Math.max(now, this.mobyGamesNextSlotMs);
    this.mobyGamesNextSlotMs = slotMs + IgdbProxyService.MOBYGAMES_MIN_INTERVAL_MS;
    const delayMs = Math.max(0, slotMs - now);
    return {
      delayMs,
      releaseSlot: () => {
        // Roll back only if no later slot has been claimed after this one
        if (this.mobyGamesNextSlotMs === slotMs + IgdbProxyService.MOBYGAMES_MIN_INTERVAL_MS) {
          this.mobyGamesNextSlotMs = slotMs;
        }
      },
    };
  }
}
