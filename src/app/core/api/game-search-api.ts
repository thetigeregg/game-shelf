import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GameCatalogPlatformOption, GameCatalogResult, HltbCompletionTimes, HltbMatchCandidate } from '../models/game.models';

export interface GameSearchApi {
  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]>;
  getGameById(igdbGameId: string): Observable<GameCatalogResult>;
  listPlatforms(): Observable<GameCatalogPlatformOption[]>;
  searchBoxArtByTitle(query: string, platform?: string | null, platformIgdbId?: number | null): Observable<string[]>;
  lookupCompletionTimes(title: string, releaseYear?: number | null, platform?: string | null): Observable<HltbCompletionTimes | null>;
  lookupCompletionTimeCandidates(title: string, releaseYear?: number | null, platform?: string | null): Observable<HltbMatchCandidate[]>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
