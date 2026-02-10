export type ListType = 'collection' | 'wishlist';
export type CoverSource = 'thegamesdb' | 'igdb' | 'none';
export type GameStatus = 'completed' | 'dropped' | 'playing' | 'paused' | 'replay' | 'wantToPlay';
export type GameStatusFilterOption = GameStatus | 'none';
export type GameRating = 1 | 2 | 3 | 4 | 5;
export type GameRatingFilterOption = GameRating | 'none';

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
  igdbGameId: string;
  title: string;
  coverUrl: string | null;
  coverSource: CoverSource;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
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
  igdbGameId: string;
  title: string;
  coverUrl: string | null;
  coverSource: CoverSource;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  publishers?: string[];
  platform: string;
  platformIgdbId: number;
  tagIds?: number[];
  tags?: GameTag[];
  releaseDate: string | null;
  releaseYear: number | null;
  status?: GameStatus | null;
  rating?: GameRating | null;
  listType: ListType;
  createdAt: string;
  updatedAt: string;
}

export interface HltbCompletionTimes {
  hltbMainHours: number | null;
  hltbMainExtraHours: number | null;
  hltbCompletionistHours: number | null;
}

export type GameSortField = 'title' | 'releaseDate' | 'createdAt' | 'platform';
export type SortDirection = 'asc' | 'desc';
export type GameGroupByField = 'none' | 'platform' | 'developer' | 'franchise' | 'tag' | 'genre' | 'publisher' | 'releaseYear';

export interface GameListFilters {
  sortField: GameSortField;
  sortDirection: SortDirection;
  platform: string[];
  genres: string[];
  statuses: GameStatusFilterOption[];
  tags: string[];
  ratings: GameRatingFilterOption[];
  releaseDateFrom: string | null;
  releaseDateTo: string | null;
}

export const DEFAULT_GAME_LIST_FILTERS: GameListFilters = {
  sortField: 'title',
  sortDirection: 'asc',
  platform: [],
  genres: [],
  statuses: [],
  tags: [],
  ratings: [],
  releaseDateFrom: null,
  releaseDateTo: null,
};

export interface GameListView {
  id?: number;
  name: string;
  listType: ListType;
  filters: GameListFilters;
  groupBy: GameGroupByField;
  createdAt: string;
  updatedAt: string;
}
