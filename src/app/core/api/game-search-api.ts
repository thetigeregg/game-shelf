import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import {
  GameCatalogPlatformOption,
  GameCatalogResult,
  HltbCompletionTimes,
  HltbMatchCandidate,
  MetacriticMatchCandidate,
  MetacriticScoreResult,
  ReviewMatchCandidate,
  ReviewScoreResult,
  PopularityGameResult,
  PopularityTypeOption
} from '../models/game.models';

export interface GameSearchApi {
  searchGames(query: string, platformIgdbId?: number | null): Observable<GameCatalogResult[]>;
  getGameById(igdbGameId: string): Observable<GameCatalogResult>;
  listPlatforms(): Observable<GameCatalogPlatformOption[]>;
  searchBoxArtByTitle(
    query: string,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<string[]>;
  lookupCompletionTimes(
    title: string,
    releaseYear?: number | null,
    platform?: string | null
  ): Observable<HltbCompletionTimes | null>;
  lookupCompletionTimeCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null
  ): Observable<HltbMatchCandidate[]>;
  lookupMetacriticScore(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<MetacriticScoreResult | null>;
  lookupMetacriticCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<MetacriticMatchCandidate[]>;
  lookupReviewScore(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<ReviewScoreResult | null>;
  lookupReviewCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<ReviewMatchCandidate[]>;
  listPopularityTypes(): Observable<PopularityTypeOption[]>;
  listPopularityGames(
    popularityTypeId: number,
    limit?: number,
    offset?: number
  ): Observable<PopularityGameResult[]>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
