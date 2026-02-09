import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GameCatalogResult } from '../models/game.models';

export interface GameSearchApi {
  searchGames(query: string): Observable<GameCatalogResult[]>;
  getGameById(externalId: string): Observable<GameCatalogResult>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
