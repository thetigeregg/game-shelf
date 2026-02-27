export type ListType = 'collection' | 'wishlist';
export type CoverSource = 'thegamesdb' | 'igdb' | 'none';
export type GameStatus = 'completed' | 'dropped' | 'playing' | 'paused' | 'replay' | 'wantToPlay';
export type GameStatusFilterOption = GameStatus | 'none';
export type GameRating = 1 | 2 | 3 | 4 | 5;
export type GameRatingFilterOption = GameRating | 'none';
export type GameType =
  | 'main_game'
  | 'dlc_addon'
  | 'expansion'
  | 'bundle'
  | 'standalone_expansion'
  | 'mod'
  | 'episode'
  | 'season'
  | 'remake'
  | 'remaster'
  | 'expanded_game'
  | 'port'
  | 'fork'
  | 'pack'
  | 'update';

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
  storyline?: string | null;
  summary?: string | null;
  gameType?: GameType | null;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  similarGameIgdbIds?: string[];
  collections?: string[];
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

export interface PopularityTypeOption {
  id: number;
  name: string;
  externalPopularitySource: number | null;
}

export interface PopularityGameResult {
  game: GameCatalogResult;
  popularityType: number;
  externalPopularitySource: number | null;
  value: number | null;
  calculatedAt: string | null;
}

export interface GameEntry {
  id?: number;
  igdbGameId: string;
  title: string;
  notes?: string | null;
  customTitle?: string | null;
  coverUrl: string | null;
  customCoverUrl?: string | null;
  coverSource: CoverSource;
  storyline?: string | null;
  summary?: string | null;
  gameType?: GameType | null;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  similarGameIgdbIds?: string[];
  collections?: string[];
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  publishers?: string[];
  platform: string;
  platformIgdbId: number;
  customPlatform?: string | null;
  customPlatformIgdbId?: number | null;
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

export interface HltbMatchCandidate extends HltbCompletionTimes {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  imageUrl?: string | null;
}

export interface ManualCandidate {
  platformIgdbId: number;
  fileName: string;
  relativePath: string;
  score: number;
  url: string;
}

export interface ManualResolveResult {
  status: 'matched' | 'none';
  bestMatch?: (ManualCandidate & { source: 'override' | 'fuzzy' }) | null;
  candidates: ManualCandidate[];
  unavailable?: boolean;
  reason?: string | null;
}

export interface ManualOverrideEntry {
  relativePath: string;
  updatedAt: string;
}

export type ManualOverrideMap = Record<string, ManualOverrideEntry>;

export type SyncEntityType = 'game' | 'tag' | 'view' | 'setting';
export type SyncOperationType = 'upsert' | 'delete';

export interface ClientSyncOperation {
  opId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  clientTimestamp: string;
}

export interface SyncChangeEvent {
  eventId: string;
  entityType: SyncEntityType;
  operation: SyncOperationType;
  payload: unknown;
  serverTimestamp: string;
}

export interface SyncPushResult {
  opId: string;
  status: 'applied' | 'duplicate' | 'failed';
  message?: string;
  normalizedPayload?: unknown;
}

export type GameSortField = 'title' | 'releaseDate' | 'createdAt' | 'hltb' | 'platform';
export type SortDirection = 'asc' | 'desc';
export type GameGroupByField =
  | 'none'
  | 'platform'
  | 'developer'
  | 'franchise'
  | 'collection'
  | 'tag'
  | 'genre'
  | 'publisher'
  | 'releaseYear';

export interface GameListFilters {
  sortField: GameSortField;
  sortDirection: SortDirection;
  platform: string[];
  collections: string[];
  developers: string[];
  franchises: string[];
  publishers: string[];
  gameTypes: GameType[];
  genres: string[];
  statuses: GameStatusFilterOption[];
  tags: string[];
  excludedPlatform: string[];
  excludedGenres: string[];
  excludedStatuses: GameStatusFilterOption[];
  excludedTags: string[];
  excludedGameTypes: GameType[];
  ratings: GameRatingFilterOption[];
  hltbMainHoursMin: number | null;
  hltbMainHoursMax: number | null;
  releaseDateFrom: string | null;
  releaseDateTo: string | null;
}

export const DEFAULT_GAME_LIST_FILTERS: GameListFilters = {
  sortField: 'title',
  sortDirection: 'asc',
  platform: [],
  collections: [],
  developers: [],
  franchises: [],
  publishers: [],
  gameTypes: [],
  genres: [],
  statuses: [],
  tags: [],
  excludedPlatform: [],
  excludedGenres: [],
  excludedStatuses: [],
  excludedTags: [],
  excludedGameTypes: [],
  ratings: [],
  hltbMainHoursMin: null,
  hltbMainHoursMax: null,
  releaseDateFrom: null,
  releaseDateTo: null
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
