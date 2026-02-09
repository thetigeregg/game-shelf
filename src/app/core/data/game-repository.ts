import { InjectionToken } from '@angular/core';
import { CoverSource, GameCatalogResult, GameEntry, ListType, Tag } from '../models/game.models';

export interface GameRepository {
  listByType(listType: ListType): Promise<GameEntry[]>;
  listAll(): Promise<GameEntry[]>;
  upsertFromCatalog(result: GameCatalogResult, targetList: ListType): Promise<GameEntry>;
  moveToList(externalId: string, targetList: ListType): Promise<void>;
  remove(externalId: string): Promise<void>;
  exists(externalId: string): Promise<GameEntry | undefined>;
  updateCover(externalId: string, coverUrl: string | null, coverSource: CoverSource): Promise<GameEntry | undefined>;
  setGameTags(externalId: string, tagIds: number[]): Promise<GameEntry | undefined>;
  listTags(): Promise<Tag[]>;
  upsertTag(tag: { id?: number; name: string; color: string }): Promise<Tag>;
  deleteTag(tagId: number): Promise<void>;
}

export const GAME_REPOSITORY = new InjectionToken<GameRepository>('GAME_REPOSITORY');
