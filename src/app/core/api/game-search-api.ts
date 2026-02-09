import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GameCatalogResult } from '../models/game.models';

export interface GameSearchApi {
  searchGames(query: string): Observable<GameCatalogResult[]>;
  getGameById(externalId: string): Observable<GameCatalogResult>;
  searchBoxArtByTitle(query: string): Observable<string[]>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
