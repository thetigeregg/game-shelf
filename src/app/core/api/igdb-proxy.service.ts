import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  GameType,
  HltbCompletionTimes,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  MetacriticScoreResult,
  PopularityGameResult,
  PopularityTypeOption
} from '../models/game.models';
import { GameSearchApi } from './game-search-api';
import { PLATFORM_CATALOG } from '../data/platform-catalog';
import { DebugLogService } from '../services/debug-log.service';
import { StrictHttpParameterCodec } from './strict-http-parameter-codec';

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

interface PopularityTypesResponse {
  items: PopularityTypeOption[];
}

interface PopularityGamesResponse {
  items: PopularityGameResult[];
}

@Injectable({ providedIn: 'root' })
export class IgdbProxyService implements GameSearchApi {
  private static readonly RATE_LIMIT_FALLBACK_COOLDOWN_MS = 20_000;
  private static readonly STRICT_HTTP_PARAM_ENCODER = new StrictHttpParameterCodec();
  private readonly platformCacheStorageKey = 'game-shelf-platform-list-cache-v1';
  private readonly searchUrl = `${environment.gameApiBaseUrl}/v1/games/search`;
  private readonly gameByIdBaseUrl = `${environment.gameApiBaseUrl}/v1/games`;
  private readonly boxArtSearchUrl = `${environment.gameApiBaseUrl}/v1/images/boxart/search`;
  private readonly hltbSearchUrl = `${environment.gameApiBaseUrl}/v1/hltb/search`;
  private readonly metacriticSearchUrl = `${environment.gameApiBaseUrl}/v1/metacritic/search`;
  private readonly popularityTypesUrl = `${environment.gameApiBaseUrl}/v1/popularity/types`;
  private readonly popularityPrimitivesUrl = `${environment.gameApiBaseUrl}/v1/popularity/primitives`;
  private readonly httpClient = inject(HttpClient);
  private readonly debugLogService = inject(DebugLogService);
  private rateLimitCooldownUntilMs = 0;

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
    platform?: string | null
  ): Observable<HltbCompletionTimes | null> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.hltb.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length
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

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }
    this.debugLogService.trace('igdb_proxy.hltb.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null
    });

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeCompletionTimes(response.item ?? null);
        this.debugLogService.trace('igdb_proxy.hltb.lookup_response', {
          hasItem: response.item !== null,
          normalized,
          hasNormalizedResult: normalized !== null
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
        titleLength: normalizedTitle.length
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
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null
    });

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeHltbCandidates(response.candidates ?? []);
        this.debugLogService.trace('igdb_proxy.hltb_candidates.lookup_response', {
          candidateCountRaw: Array.isArray(response.candidates) ? response.candidates.length : 0,
          candidateCountNormalized: normalized.length
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
    platformIgdbId?: number | null
  ): Observable<MetacriticScoreResult | null> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.metacritic.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length
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
    this.debugLogService.trace('igdb_proxy.metacritic.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
      platformIgdbId: normalizedPlatformIgdbId
    });

    return this.httpClient.get<MetacriticSearchResponse>(this.metacriticSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeMetacriticScoreResult(response.item ?? null);
        this.debugLogService.trace('igdb_proxy.metacritic.lookup_response', {
          hasItem: response.item !== null,
          normalized,
          hasNormalizedResult: normalized !== null
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
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_skipped', {
        reason: 'title_too_short',
        titleLength: normalizedTitle.length
      });
      return of([]);
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
    this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_request', {
      title: normalizedTitle,
      releaseYear: normalizedYear,
      platform: normalizedPlatform.length > 0 ? normalizedPlatform : null,
      platformIgdbId: normalizedPlatformIgdbId
    });

    return this.httpClient.get<MetacriticSearchResponse>(this.metacriticSearchUrl, { params }).pipe(
      map((response) => {
        const normalized = this.normalizeMetacriticCandidates(response.candidates ?? []);
        this.debugLogService.trace('igdb_proxy.metacritic_candidates.lookup_response', {
          candidateCountRaw: Array.isArray(response.candidates) ? response.candidates.length : 0,
          candidateCountNormalized: normalized.length
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

  listPopularityTypes(): Observable<PopularityTypeOption[]> {
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    return this.httpClient.get<PopularityTypesResponse>(this.popularityTypesUrl).pipe(
      map((response) => this.normalizePopularityTypes(response.items)),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);

        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load popularity categories.'));
      })
    );
  }

  listPopularityGames(
    popularityTypeId: number,
    limit = 20,
    offset = 0
  ): Observable<PopularityGameResult[]> {
    const normalizedPopularityTypeId =
      Number.isInteger(popularityTypeId) && popularityTypeId > 0 ? popularityTypeId : null;

    if (normalizedPopularityTypeId === null) {
      return of([]);
    }

    const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
    const normalizedOffset = Number.isInteger(offset) ? Math.max(offset, 0) : 0;
    const cooldownError = this.createCooldownErrorIfActive();

    if (cooldownError) {
      return throwError(() => cooldownError);
    }

    const params = new HttpParams({ encoder: IgdbProxyService.STRICT_HTTP_PARAM_ENCODER })
      .set('popularityTypeId', String(normalizedPopularityTypeId))
      .set('limit', String(normalizedLimit))
      .set('offset', String(normalizedOffset));

    return this.httpClient
      .get<PopularityGamesResponse>(this.popularityPrimitivesUrl, { params })
      .pipe(
        map((response) => this.normalizePopularityGames(response.items)),
        catchError((error: unknown) => {
          const rateLimitError = this.toRateLimitError(error);

          if (rateLimitError) {
            return throwError(() => rateLimitError);
          }

          return throwError(() => new Error('Unable to load popular games.'));
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
      metacriticScore: this.normalizeMetacriticScore(result.metacriticScore),
      metacriticUrl: this.normalizeExternalUrl(result.metacriticUrl),
      similarGameIgdbIds: this.normalizeGameIdList(
        (result as GameCatalogResult & { similarGameIgdbIds?: unknown }).similarGameIgdbIds
      ),
      collections: this.normalizeTextList(result.collections),
      developers: this.normalizeTextList(result.developers),
      franchises: this.normalizeTextList(result.franchises),
      genres: this.normalizeTextList(result.genres),
      publishers: this.normalizeTextList(result.publishers),
      platforms,
      platformOptions,
      platform: platforms.length === 1 ? platforms[0] : null,
      platformIgdbId: this.resolvePlatformIgdbId(result, platformOptions),
      releaseDate: this.normalizeReleaseDate(result.releaseDate),
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null
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

    const normalized: HltbCompletionTimes = {
      hltbMainHours: this.normalizeCompletionHours(value.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(value.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(value.hltbCompletionistHours)
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

        return {
          title,
          releaseYear,
          platform,
          hltbMainHours: this.normalizeCompletionHours(candidate.hltbMainHours),
          hltbMainExtraHours: this.normalizeCompletionHours(candidate.hltbMainExtraHours),
          hltbCompletionistHours: this.normalizeCompletionHours(candidate.hltbCompletionistHours),
          ...(imageUrl ? { imageUrl } : {})
        };
      })
      .filter((candidate) => candidate.title.length > 0)
      .filter((candidate, index, all) => {
        return (
          all.findIndex(
            (entry) =>
              entry.title === candidate.title &&
              entry.releaseYear === candidate.releaseYear &&
              entry.platform === candidate.platform
          ) === index
        );
      });
  }

  private normalizeMetacriticScoreResult(
    value: MetacriticScoreResult | null
  ): MetacriticScoreResult | null {
    if (!value) {
      return null;
    }

    const normalized: MetacriticScoreResult = {
      metacriticScore: this.normalizeMetacriticScore(value.metacriticScore),
      metacriticUrl: this.normalizeExternalUrl(value.metacriticUrl)
    };

    if (normalized.metacriticScore === null && normalized.metacriticUrl === null) {
      return null;
    }

    return normalized;
  }

  private normalizeMetacriticCandidates(
    candidates: MetacriticMatchCandidate[] | null | undefined
  ): MetacriticMatchCandidate[] {
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
        const metacriticScore = this.normalizeMetacriticScore(candidate.metacriticScore);
        const metacriticUrl = this.normalizeExternalUrl(candidate.metacriticUrl);

        return {
          title,
          releaseYear,
          platform,
          metacriticScore,
          metacriticUrl,
          ...(imageUrl ? { imageUrl } : {})
        };
      })
      .filter((candidate) => candidate.title.length > 0)
      .filter((candidate) => candidate.metacriticScore !== null || candidate.metacriticUrl !== null)
      .filter((candidate, index, all) => {
        return (
          all.findIndex(
            (entry) =>
              entry.title === candidate.title &&
              entry.releaseYear === candidate.releaseYear &&
              entry.platform === candidate.platform
          ) === index
        );
      });
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
        stack: value.stack
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
      )
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
      )
    ];
  }

  private normalizeGameIdList(values: unknown): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [
      ...new Set(
        values.map((value) => String(value ?? '').trim()).filter((value) => /^\d+$/.test(value))
      )
    ];
  }

  private normalizePopularityTypes(
    values: PopularityTypeOption[] | null | undefined
  ): PopularityTypeOption[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return values
      .map((value) => {
        const id = Number.isInteger(value.id) && value.id > 0 ? value.id : null;
        const name = typeof value.name === 'string' ? value.name.trim() : '';
        const externalPopularitySource =
          typeof value.externalPopularitySource === 'number' &&
          Number.isInteger(value.externalPopularitySource) &&
          value.externalPopularitySource > 0
            ? value.externalPopularitySource
            : null;

        return { id, name, externalPopularitySource };
      })
      .filter((value) => value.id !== null && value.name.length > 0)
      .filter(
        (value, index, all) => all.findIndex((candidate) => candidate.id === value.id) === index
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
      )
      .map((value) => ({
        id: value.id as number,
        name: value.name,
        externalPopularitySource: value.externalPopularitySource
      }));
  }

  private normalizePopularityGames(
    values: PopularityGameResult[] | null | undefined
  ): PopularityGameResult[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return values
      .map((value) => {
        const game = this.normalizeResult(value.game);
        const popularityType =
          Number.isInteger(value.popularityType) && value.popularityType > 0
            ? value.popularityType
            : null;
        const externalPopularitySource =
          typeof value.externalPopularitySource === 'number' &&
          Number.isInteger(value.externalPopularitySource) &&
          value.externalPopularitySource > 0
            ? value.externalPopularitySource
            : null;
        const popularityValue = this.normalizePopularityValue(value.value);
        const calculatedAt = this.normalizeReleaseDate(value.calculatedAt ?? null);

        return {
          game,
          popularityType,
          externalPopularitySource,
          value: popularityValue,
          calculatedAt
        };
      })
      .filter((value) => value.popularityType !== null && value.game.igdbGameId.length > 0)
      .map((value) => ({
        game: value.game,
        popularityType: value.popularityType as number,
        externalPopularitySource: value.externalPopularitySource,
        value: value.value,
        calculatedAt: value.calculatedAt
      }));
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
}
