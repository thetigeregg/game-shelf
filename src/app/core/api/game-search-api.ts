import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GameCatalogPlatformOption, GameCatalogResult } from '../models/game.models';

export interface GameSearchApi {
  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]>;
  getGameById(externalId: string): Observable<GameCatalogResult>;
  listPlatforms(): Observable<GameCatalogPlatformOption[]>;
  searchBoxArtByTitle(query: string, platform?: string | null, platformIgdbId?: number | null): Observable<string[]>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
