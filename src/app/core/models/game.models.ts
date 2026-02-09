export type ListType = 'collection' | 'wishlist';
export type CoverSource = 'thegamesdb' | 'igdb' | 'none';
export type GameStatus = 'completed' | 'dropped' | 'playing' | 'replay';

export interface GameCatalogPlatformOption {
  id: number | null;
  name: string;
}

export interface Tag {
  id?: number;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface TagSummary extends Tag {
  gameCount: number;
}

export interface GameTag {
  id: number;
  name: string;
  color: string;
}

export interface GameCatalogResult {
  externalId: string;
  title: string;
  coverUrl: string | null;
  coverSource: CoverSource;
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  publishers?: string[];
  platforms: string[];
  platformOptions?: GameCatalogPlatformOption[];
  platform: string | null;
  platformIgdbId?: number | null;
  releaseDate: string | null;
  releaseYear: number | null;
}

export interface GameEntry {
  id?: number;
  externalId: string;
  title: string;
  coverUrl: string | null;
  coverSource: CoverSource;
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  publishers?: string[];
  platform: string | null;
  platformIgdbId?: number | null;
  tagIds?: number[];
  tags?: GameTag[];
  releaseDate: string | null;
  releaseYear: number | null;
  status?: GameStatus | null;
  listType: ListType;
  createdAt: string;
  updatedAt: string;
}

export type GameSortField = 'title' | 'releaseDate' | 'createdAt' | 'platform';
export type SortDirection = 'asc' | 'desc';
export type GameGroupByField = 'none' | 'platform' | 'developer' | 'franchise' | 'tag' | 'genre' | 'publisher' | 'releaseYear';

export interface GameListFilters {
  sortField: GameSortField;
  sortDirection: SortDirection;
  platform: string[];
  genres: string[];
  tags: string[];
  releaseDateFrom: string | null;
  releaseDateTo: string | null;
}

export const DEFAULT_GAME_LIST_FILTERS: GameListFilters = {
  sortField: 'title',
  sortDirection: 'asc',
  platform: [],
  genres: [],
  tags: [],
  releaseDateFrom: null,
  releaseDateTo: null,
};
