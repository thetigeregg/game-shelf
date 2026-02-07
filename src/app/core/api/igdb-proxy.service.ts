import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { GameCatalogResult } from '../models/game.models';
import { GameSearchApi } from './game-search-api';

interface SearchResponse {
  items: GameCatalogResult[];
}

@Injectable({ providedIn: 'root' })
export class IgdbProxyService implements GameSearchApi {
  private readonly searchUrl = `${environment.gameApiBaseUrl}/v1/games/search`;
  private readonly httpClient = inject(HttpClient);

  searchGames(query: string): Observable<GameCatalogResult[]> {
    const normalized = query.trim();

    if (normalized.length < 2) {
      return of([]);
    }

    const params = new HttpParams().set('q', normalized);

    return this.httpClient.get<SearchResponse>(this.searchUrl, { params }).pipe(
      map(response => (response.items ?? []).map(item => this.normalizeResult(item))),
      catchError(() => throwError(() => new Error('Unable to load game search results.')))
    );
  }

  private normalizeResult(result: GameCatalogResult): GameCatalogResult {
    const platforms = this.normalizePlatforms(result);

    return {
      externalId: String(result.externalId ?? '').trim(),
      title: String(result.title ?? '').trim() || 'Unknown title',
      coverUrl: typeof result.coverUrl === 'string' && result.coverUrl.length > 0 ? result.coverUrl : null,
      platforms,
      platform: platforms.length === 1 ? platforms[0] : null,
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null,
    };
  }

  private normalizePlatforms(result: GameCatalogResult): string[] {
    const fromArray = Array.isArray(result.platforms)
      ? result.platforms
          .map(platform => typeof platform === 'string' ? platform.trim() : '')
          .filter(platform => platform.length > 0)
      : [];

    if (fromArray.length > 0) {
      return [...new Set(fromArray)];
    }

    if (typeof result.platform === 'string' && result.platform.trim().length > 0) {
      return [result.platform.trim()];
    }

    return [];
  }
}
