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
    return {
      externalId: String(result.externalId ?? '').trim(),
      title: String(result.title ?? '').trim() || 'Unknown title',
      coverUrl: typeof result.coverUrl === 'string' && result.coverUrl.length > 0 ? result.coverUrl : null,
      platform: typeof result.platform === 'string' && result.platform.length > 0 ? result.platform : null,
      releaseYear: Number.isInteger(result.releaseYear) ? result.releaseYear : null,
    };
  }
}
