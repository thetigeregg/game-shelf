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
    platform?: string | null,
    query?: {
      preferredGameId?: number | null;
      preferredUrl?: string | null;
    }
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
    platformIgdbId?: number | null,
    preferredReviewUrl?: string | null
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
    platformIgdbId?: number | null,
    mobygamesGameId?: number | null,
    preferredReviewUrl?: string | null
  ): Observable<ReviewScoreResult | null>;
  lookupReviewCandidates(
    title: string,
    releaseYear?: number | null,
    platform?: string | null,
    platformIgdbId?: number | null
  ): Observable<ReviewMatchCandidate[]>;
  lookupSteamPrice?(
    igdbGameId: string,
    platformIgdbId: number,
    countryCode?: string,
    steamAppId?: number | null
  ): Observable<unknown>;
  lookupPlayStationStorePrice?(
    igdbGameId: string,
    platformIgdbId: number,
    query?: {
      title?: string | null;
      /** A PlayStation Store product ID or product URL to price instead of searching. */
      productId?: string | null;
    }
  ): Observable<unknown>;
  lookupPlayStationStoreCandidates?(
    igdbGameId: string,
    platformIgdbId: number,
    title: string
  ): Observable<unknown>;
  lookupNintendoEshopPrice?(
    igdbGameId: string,
    platformIgdbId: number,
    query?: {
      title?: string | null;
      /** An nsuid or eShop link to price instead of searching. */
      nsuid?: string | null;
    }
  ): Observable<unknown>;
  lookupNintendoEshopCandidates?(
    igdbGameId: string,
    platformIgdbId: number,
    title: string
  ): Observable<unknown>;
}

export const GAME_SEARCH_API = new InjectionToken<GameSearchApi>('GAME_SEARCH_API');
