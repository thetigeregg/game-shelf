import { InjectionToken } from '@angular/core';
import {
  CoverSource,
  GameCatalogResult,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameListView,
  GameRating,
  GameStatus,
  ListType,
  Tag
} from '../models/game.models';

export interface GameRepository {
  listByType(listType: ListType): Promise<GameEntry[]>;
  listAll(): Promise<GameEntry[]>;
  upsertFromCatalog(result: GameCatalogResult, targetList: ListType): Promise<GameEntry>;
  moveToList(igdbGameId: string, platformIgdbId: number, targetList: ListType): Promise<void>;
  remove(igdbGameId: string, platformIgdbId: number): Promise<void>;
  exists(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined>;
  updateCover(
    igdbGameId: string,
    platformIgdbId: number,
    coverUrl: string | null,
    coverSource: CoverSource
  ): Promise<GameEntry | undefined>;
  setGameStatus(
    igdbGameId: string,
    platformIgdbId: number,
    status: GameStatus | null
  ): Promise<GameEntry | undefined>;
  setGameRating(
    igdbGameId: string,
    platformIgdbId: number,
    rating: GameRating | null
  ): Promise<GameEntry | undefined>;
  setGameTags(
    igdbGameId: string,
    platformIgdbId: number,
    tagIds: number[]
  ): Promise<GameEntry | undefined>;
  setGameNotes(
    igdbGameId: string,
    platformIgdbId: number,
    notes: string | null
  ): Promise<GameEntry | undefined>;
  setGameCustomCover(
    igdbGameId: string,
    platformIgdbId: number,
    customCoverUrl: string | null
  ): Promise<GameEntry | undefined>;
  setGameCustomMetadata(
    igdbGameId: string,
    platformIgdbId: number,
    customizations: {
      title?: string | null;
      platform?: { name: string; igdbId: number } | null;
    }
  ): Promise<GameEntry | undefined>;
  listTags(): Promise<Tag[]>;
  upsertTag(tag: { id?: number; name: string; color: string }): Promise<Tag>;
  deleteTag(tagId: number): Promise<void>;
  listViews(listType: ListType): Promise<GameListView[]>;
  getView(viewId: number): Promise<GameListView | undefined>;
  createView(view: {
    name: string;
    listType: ListType;
    filters: GameListFilters;
    groupBy: GameGroupByField;
  }): Promise<GameListView>;
  updateView(
    viewId: number,
    updates: { name?: string; filters?: GameListFilters; groupBy?: GameGroupByField }
  ): Promise<GameListView | undefined>;
  deleteView(viewId: number): Promise<void>;
}

export const GAME_REPOSITORY = new InjectionToken<GameRepository>('GAME_REPOSITORY');
