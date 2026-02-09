import { InjectionToken } from '@angular/core';
import { CoverSource, GameCatalogResult, GameEntry, GameStatus, ListType, Tag } from '../models/game.models';

export interface GameRepository {
  listByType(listType: ListType): Promise<GameEntry[]>;
  listAll(): Promise<GameEntry[]>;
  upsertFromCatalog(result: GameCatalogResult, targetList: ListType): Promise<GameEntry>;
  moveToList(igdbGameId: string, platformIgdbId: number, targetList: ListType): Promise<void>;
  remove(igdbGameId: string, platformIgdbId: number): Promise<void>;
  exists(igdbGameId: string, platformIgdbId: number): Promise<GameEntry | undefined>;
  updateCover(igdbGameId: string, platformIgdbId: number, coverUrl: string | null, coverSource: CoverSource): Promise<GameEntry | undefined>;
  setGameStatus(igdbGameId: string, platformIgdbId: number, status: GameStatus | null): Promise<GameEntry | undefined>;
  setGameTags(igdbGameId: string, platformIgdbId: number, tagIds: number[]): Promise<GameEntry | undefined>;
  listTags(): Promise<Tag[]>;
  upsertTag(tag: { id?: number; name: string; color: string }): Promise<Tag>;
  deleteTag(tagId: number): Promise<void>;
}

export const GAME_REPOSITORY = new InjectionToken<GameRepository>('GAME_REPOSITORY');
