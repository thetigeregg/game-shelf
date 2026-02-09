import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { GameCatalogPlatformOption, GameCatalogResult } from '../models/game.models';
import { GameSearchApi } from './game-search-api';

interface SearchResponse {
  items: GameCatalogResult[];
}

interface GameByIdResponse {
  item: GameCatalogResult;
}

interface PlatformListResponse {
  items: GameCatalogPlatformOption[];
}

interface BoxArtSearchResponse {
  items: string[];
}

@Injectable({ providedIn: 'root' })
export class IgdbProxyService implements GameSearchApi {
  private readonly searchUrl = `${environment.gameApiBaseUrl}/v1/games/search`;
  private readonly gameByIdBaseUrl = `${environment.gameApiBaseUrl}/v1/games`;
  private readonly platformListUrl = `${environment.gameApiBaseUrl}/v1/platforms`;
  private readonly boxArtSearchUrl = `${environment.gameApiBaseUrl}/v1/images/boxart/search`;
  private readonly httpClient = inject(HttpClient);

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

    return this.httpClient.get<SearchResponse>(this.searchUrl, { params }).pipe(
      map(response => (response.items ?? []).map(item => this.normalizeResult(item))),
      catchError(() => throwError(() => new Error('Unable to load game search results.')))
    );
  }

  listPlatforms(): Observable<GameCatalogPlatformOption[]> {
    return this.httpClient.get<PlatformListResponse>(this.platformListUrl).pipe(
      map(response => this.normalizePlatformList(response.items)),
      catchError(() => throwError(() => new Error('Unable to load platform filters.')))
    );
  }

  getGameById(externalId: string): Observable<GameCatalogResult> {
    const normalizedId = externalId.trim();

    if (!/^\d+$/.test(normalizedId)) {
      return throwError(() => new Error('Unable to refresh game metadata.'));
    }

    const url = `${this.gameByIdBaseUrl}/${encodeURIComponent(normalizedId)}`;

    return this.httpClient.get<GameByIdResponse>(url).pipe(
      map(response => {
        if (!response?.item) {
          throw new Error('Missing game payload');
        }

        return this.normalizeResult(response.item);
      }),
      catchError(() => throwError(() => new Error('Unable to refresh game metadata.')))
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

    return this.httpClient.get<BoxArtSearchResponse>(this.boxArtSearchUrl, { params }).pipe(
      map(response => this.normalizeBoxArtResults(response.items)),
      catchError(() => throwError(() => new Error('Unable to load box art results.')))
    );
  }

  private normalizeResult(result: GameCatalogResult): GameCatalogResult {
    const platformOptions = this.normalizePlatformOptions(result);
    const platforms = [...new Set(platformOptions.map(platform => platform.name))];

    return {
      externalId: String(result.externalId ?? '').trim(),
      title: String(result.title ?? '').trim() || 'Unknown title',
      coverUrl: typeof result.coverUrl === 'string' && result.coverUrl.length > 0 ? result.coverUrl : null,
      coverSource: this.normalizeCoverSource(result.coverSource),
      platforms,
      platformOptions,
      platform: platforms.length === 1 ? platforms[0] : null,
      platformIgdbId: this.resolvePlatformIgdbId(result, platformOptions),
      releaseDate: this.normalizeReleaseDate(result.releaseDate),
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null,
    };
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
}
