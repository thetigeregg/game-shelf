export type ListType = 'collection' | 'wishlist';

export interface GameCatalogResult {
  externalId: string;
  title: string;
  coverUrl: string | null;
  platforms: string[];
  platform: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
}

export interface GameEntry {
  id?: number;
  externalId: string;
  title: string;
  coverUrl: string | null;
  platform: string | null;
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
