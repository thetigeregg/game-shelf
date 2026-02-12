import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { GameCatalogPlatformOption, GameCatalogResult, GameType, HltbCompletionTimes, HltbMatchCandidate } from '../models/game.models';
import { GameSearchApi } from './game-search-api';
import { PLATFORM_CATALOG } from '../data/platform-catalog';

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

@Injectable({ providedIn: 'root' })
export class IgdbProxyService implements GameSearchApi {
  private static readonly RATE_LIMIT_FALLBACK_COOLDOWN_MS = 20_000;
  private readonly platformCacheStorageKey = 'game-shelf-platform-list-cache-v1';
  private readonly searchUrl = `${environment.gameApiBaseUrl}/v1/games/search`;
  private readonly gameByIdBaseUrl = `${environment.gameApiBaseUrl}/v1/games`;
  private readonly boxArtSearchUrl = `${environment.gameApiBaseUrl}/v1/images/boxart/search`;
  private readonly hltbSearchUrl = `${environment.gameApiBaseUrl}/v1/hltb/search`;
  private readonly httpClient = inject(HttpClient);
  private rateLimitCooldownUntilMs = 0;

  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    let params = new HttpParams().set('q', normalized);
    const normalizedPlatformIgdbId = typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
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
      map(response => (response.items ?? []).map(item => this.normalizeResult(item))),
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
      map(response => {
        if (!response?.item) {
          throw new Error('Missing game payload');
        }

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

  searchBoxArtByTitle(query: string, platform?: string | null, platformIgdbId?: number | null): Observable<string[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    let params = new HttpParams().set('q', normalized);
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }

    const normalizedPlatformIgdbId = typeof platformIgdbId === 'number' && Number.isInteger(platformIgdbId) && platformIgdbId > 0
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
      map(response => this.normalizeBoxArtResults(response.items)),
      catchError((error: unknown) => {
        const rateLimitError = this.toRateLimitError(error);

        if (rateLimitError) {
          return throwError(() => rateLimitError);
        }

        return throwError(() => new Error('Unable to load box art results.'));
      })
    );
  }

  lookupCompletionTimes(title: string, releaseYear?: number | null, platform?: string | null): Observable<HltbCompletionTimes | null> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      return of(null);
    }

    let params = new HttpParams().set('q', normalizedTitle);
    const normalizedYear = Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? releaseYear as number : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map(response => this.normalizeCompletionTimes(response?.item ?? null)),
      catchError(() => of(null)),
    );
  }

  lookupCompletionTimeCandidates(title: string, releaseYear?: number | null, platform?: string | null): Observable<HltbMatchCandidate[]> {
    const normalizedTitle = title.trim();

    if (normalizedTitle.length < 2) {
      return of([]);
    }

    let params = new HttpParams().set('q', normalizedTitle).set('includeCandidates', 'true');
    const normalizedYear = Number.isInteger(releaseYear) && (releaseYear as number) > 0 ? releaseYear as number : null;
    const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

    if (normalizedYear !== null) {
      params = params.set('releaseYear', String(normalizedYear));
    }

    if (normalizedPlatform.length > 0) {
      params = params.set('platform', normalizedPlatform);
    }

    return this.httpClient.get<HltbSearchResponse>(this.hltbSearchUrl, { params }).pipe(
      map(response => this.normalizeHltbCandidates(response?.candidates ?? [])),
      catchError(() => of([])),
    );
  }

  private normalizeResult(result: GameCatalogResult): GameCatalogResult {
    const payload = result as GameCatalogResult & { externalId?: string };
    const platformOptions = this.normalizePlatformOptions(result);
    const platforms = [...new Set(platformOptions.map(platform => platform.name))];

    return {
      igdbGameId: String(payload.igdbGameId ?? payload.externalId ?? '').trim(),
      title: String(result.title ?? '').trim() || 'Unknown title',
      coverUrl: this.normalizeCoverUrl(result.coverUrl),
      coverSource: this.normalizeCoverSource(result.coverSource),
      gameType: this.normalizeGameType((result as GameCatalogResult & { gameType?: unknown }).gameType),
      hltbMainHours: this.normalizeCompletionHours(result.hltbMainHours),
      hltbMainExtraHours: this.normalizeCompletionHours(result.hltbMainExtraHours),
      hltbCompletionistHours: this.normalizeCompletionHours(result.hltbCompletionistHours),
      similarGameIgdbIds: this.normalizeGameIdList((result as GameCatalogResult & { similarGameIgdbIds?: unknown }).similarGameIgdbIds),
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
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null,
    };
  }

  private normalizeGameType(value: unknown): GameType | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');

    if (normalized === 'main_game'
      || normalized === 'dlc_addon'
      || normalized === 'expansion'
      || normalized === 'bundle'
      || normalized === 'standalone_expansion'
      || normalized === 'mod'
      || normalized === 'episode'
      || normalized === 'season'
      || normalized === 'remake'
      || normalized === 'remaster'
      || normalized === 'expanded_game'
      || normalized === 'port'
      || normalized === 'fork'
      || normalized === 'pack'
      || normalized === 'update') {
      return normalized;
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
    return url.replace(/(\/igdb\/image\/upload\/)(t_[^/]+)(\/)/, (_match, prefix: string, sizeToken: string, suffix: string) => {
      if (sizeToken.endsWith('_2x')) {
        return `${prefix}${sizeToken}${suffix}`;
      }

      return `${prefix}${sizeToken}_2x${suffix}`;
    });
  }

  private normalizePlatformOptions(result: GameCatalogResult): GameCatalogPlatformOption[] {
    const fromOptions = Array.isArray(result.platformOptions)
      ? result.platformOptions
        .map(option => {
          const name = typeof option?.name === 'string' ? option.name.trim() : '';
          const id = typeof option?.id === 'number' && Number.isInteger(option.id) && option.id > 0
            ? option.id
            : null;
          return { id, name };
        })
        .filter(option => option.name.length > 0)
      : [];

    if (fromOptions.length > 0) {
      return fromOptions.filter((option, index, items) => {
        return items.findIndex(candidate => candidate.id === option.id && candidate.name === option.name) === index;
      });
    }

    const fromArray = Array.isArray(result.platforms)
      ? result.platforms
        .map(platform => typeof platform === 'string' ? platform.trim() : '')
        .filter(platform => platform.length > 0)
      : [];

    if (fromArray.length > 0) {
      return [...new Set(fromArray)].map(name => ({ id: null, name }));
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
      hltbCompletionistHours: this.normalizeCompletionHours(value.hltbCompletionistHours),
    };

    if (normalized.hltbMainHours === null && normalized.hltbMainExtraHours === null && normalized.hltbCompletionistHours === null) {
      return null;
    }

    return normalized;
  }

  private normalizeHltbCandidates(candidates: HltbMatchCandidate[] | null | undefined): HltbMatchCandidate[] {
    if (!Array.isArray(candidates)) {
      return [];
    }

    return candidates
      .map(candidate => {
        const title = typeof candidate?.title === 'string' ? candidate.title.trim() : '';
        const releaseYear = Number.isInteger(candidate?.releaseYear) ? candidate.releaseYear : null;
        const platform = typeof candidate?.platform === 'string' && candidate.platform.trim().length > 0
          ? candidate.platform.trim()
          : null;
        const candidateRecord = candidate as unknown as Record<string, unknown>;
        const imageUrl = this.normalizeExternalImageUrl(
          typeof candidate?.imageUrl === 'string'
            ? candidate.imageUrl
            : (typeof candidateRecord['coverUrl'] === 'string' ? candidateRecord['coverUrl'] : null),
        );

        return {
          title,
          releaseYear,
          platform,
          hltbMainHours: this.normalizeCompletionHours(candidate?.hltbMainHours),
          hltbMainExtraHours: this.normalizeCompletionHours(candidate?.hltbMainExtraHours),
          hltbCompletionistHours: this.normalizeCompletionHours(candidate?.hltbCompletionistHours),
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter(candidate => candidate.title.length > 0)
      .filter((candidate, index, all) => {
        return all.findIndex(entry => (
          entry.title === candidate.title
          && entry.releaseYear === candidate.releaseYear
          && entry.platform === candidate.platform
        )) === index;
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

  private normalizeCompletionHours(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Math.round(value * 10) / 10;
  }

  private resolvePlatformIgdbId(result: GameCatalogResult, platformOptions: GameCatalogPlatformOption[]): number | null {
    if (typeof result.platformIgdbId === 'number' && Number.isInteger(result.platformIgdbId) && result.platformIgdbId > 0) {
      return result.platformIgdbId;
    }

    if (platformOptions.length === 1) {
      return platformOptions[0].id ?? null;
    }

    return null;
  }

  private normalizeCoverSource(coverSource: string | null | undefined): 'thegamesdb' | 'igdb' | 'none' {
    if (coverSource === 'thegamesdb' || coverSource === 'igdb' || coverSource === 'none') {
      return coverSource;
    }

    return 'none';
  }

  private normalizeBoxArtResults(items: string[] | null | undefined): string[] {
    if (!Array.isArray(items)) {
      return [];
    }

    return [...new Set(
      items
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item.startsWith('http://') || item.startsWith('https://'))
    )];
  }

  private normalizePlatformList(items: GameCatalogPlatformOption[] | null | undefined): GameCatalogPlatformOption[] {
    if (!Array.isArray(items)) {
      return [];
    }

    const normalized = items
      .map(option => {
        const name = typeof option?.name === 'string' ? option.name.trim() : '';
        const id = typeof option?.id === 'number' && Number.isInteger(option.id) && option.id > 0
          ? option.id
          : null;

        return { id, name };
      })
      .filter(option => option.id !== null && option.name.length > 0) as { id: number; name: string }[];

    return normalized
      .filter((option, index, all) => {
        return all.findIndex(candidate => candidate.id === option.id) === index;
      })
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }

  private normalizeTextList(values: string[] | null | undefined): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [...new Set(
      values
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value.length > 0)
    )];
  }

  private normalizeGameIdList(values: unknown): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    return [...new Set(
      values
        .map(value => String(value ?? '').trim())
        .filter(value => /^\d+$/.test(value))
    )];
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
    const value = error.headers?.get('Retry-After');

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

    const retryAfterMs = this.parseRetryAfterMs(error) ?? IgdbProxyService.RATE_LIMIT_FALLBACK_COOLDOWN_MS;
    this.rateLimitCooldownUntilMs = Math.max(this.rateLimitCooldownUntilMs, Date.now() + retryAfterMs);
    const retryAfterSeconds = Math.max(1, Math.ceil((this.rateLimitCooldownUntilMs - Date.now()) / 1000));
    return new Error(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`);
  }

  private createCooldownErrorIfActive(): Error | null {
    const remainingMs = this.rateLimitCooldownUntilMs - Date.now();

    if (remainingMs <= 0) {
      return null;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    return new Error(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`);
  }
}
