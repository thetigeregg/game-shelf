export type ListType = 'collection' | 'wishlist';
export type CoverSource = 'thegamesdb' | 'igdb' | 'none';

export interface GameCatalogPlatformOption {
  id: number | null;
  name: string;
}

export interface GameCatalogResult {
  externalId: string;
  title: string;
  coverUrl: string | null;
  coverSource: CoverSource;
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
  platform: string | null;
  platformIgdbId?: number | null;
  releaseDate: string | null;
  releaseYear: number | null;
  listType: ListType;
  createdAt: string;
  updatedAt: string;
}

export type GameSortField = 'title' | 'releaseDate';
export type SortDirection = 'asc' | 'desc';

export interface GameListFilters {
  sortField: GameSortField;
  sortDirection: SortDirection;
  platform: string | 'all';
  releaseDateFrom: string | null;
  releaseDateTo: string | null;
}

export const DEFAULT_GAME_LIST_FILTERS: GameListFilters = {
  sortField: 'title',
  sortDirection: 'asc',
  platform: 'all',
  releaseDateFrom: null,
  releaseDateTo: null,
};
