export type ListType = 'collection' | 'wishlist';
export type GameRowReleaseDateDisplay = 'year' | 'monthYear' | 'fullDate';
export type CoverSource = 'thegamesdb' | 'igdb' | 'none';
export type GameStatus = 'completed' | 'dropped' | 'playing' | 'paused' | 'replay' | 'wantToPlay';
export type GameStatusFilterOption = GameStatus | 'none';
export const GAME_RATING_VALUES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;
export type GameRating = (typeof GAME_RATING_VALUES)[number];
export function isGameRating(value: unknown): value is GameRating {
  return typeof value === 'number' && GAME_RATING_VALUES.includes(value as GameRating);
}
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
export type ReviewSource = 'metacritic' | 'mobygames';
export type PriceSource = 'steam_store' | 'psprices';
export type GameWebsiteProvider =
  | 'steam'
  | 'playstation'
  | 'xbox'
  | 'nintendo'
  | 'epic'
  | 'gog'
  | 'itch'
  | 'apple'
  | 'android'
  | 'amazon'
  | 'oculus'
  | 'gamejolt'
  | 'kartridge'
  | 'utomik'
  | 'unknown';

export interface GameWebsite {
  provider: GameWebsiteProvider;
  providerLabel: string;
  url: string;
  sourceId: number | null;
  sourceName: string | null;
  trusted: boolean | null;
}

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

export interface GameScreenshot {
  id: number | null;
  imageId: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface GameVideo {
  id: number | null;
  name: string | null;
  videoId: string;
  url: string;
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
  hltbMatchGameId?: number | null;
  hltbMatchUrl?: string | null;
  hltbMatchQueryTitle?: string | null;
  hltbMatchQueryReleaseYear?: number | null;
  hltbMatchQueryPlatform?: string | null;
  hltbMatchLocked?: boolean | null;
  reviewScore?: number | null;
  reviewUrl?: string | null;
  reviewSource?: ReviewSource | null;
  mobyScore?: number | null;
  mobygamesGameId?: number | null;
  reviewMatchQueryTitle?: string | null;
  reviewMatchQueryReleaseYear?: number | null;
  reviewMatchQueryPlatform?: string | null;
  reviewMatchPlatformIgdbId?: number | null;
  reviewMatchMobygamesGameId?: number | null;
  reviewMatchLocked?: boolean | null;
  metacriticScore?: number | null;
  metacriticUrl?: string | null;
  similarGameIgdbIds?: string[];
  collections?: string[];
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  themes?: string[];
  themeIds?: number[];
  keywords?: string[];
  keywordIds?: number[];
  websites?: GameWebsite[];
  steamAppId?: number | null;
  priceSource?: PriceSource | null;
  priceFetchedAt?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceRegularAmount?: number | null;
  priceDiscountPercent?: number | null;
  priceIsFree?: boolean | null;
  priceUrl?: string | null;
  psPricesMatchLocked?: boolean | null;
  screenshots?: GameScreenshot[];
  videos?: GameVideo[];
  publishers?: string[];
  platforms: string[];
  platformOptions?: GameCatalogPlatformOption[];
  platform: string | null;
  platformIgdbId?: number | null;
  releaseDate: string | null;
  releaseYear: number | null;
}

export type RecommendationTarget = 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
export type RecommendationRuntimeMode = 'NEUTRAL' | 'SHORT' | 'LONG';
export type RecommendationLaneKey =
  | 'overall'
  | 'hiddenGems'
  | 'exploration'
  | 'blended'
  | 'popular'
  | 'recent';

export interface RecommendationScoreComponents {
  taste: number;
  novelty: number;
  runtimeFit: number;
  criticBoost: number;
  recencyBoost: number;
  semantic: number;
  exploration: number;
  diversityPenalty: number;
  repeatPenalty: number;
}

export interface RecommendationExplanationBullet {
  type:
    | 'taste'
    | 'novelty'
    | 'runtime'
    | 'critic'
    | 'recency'
    | 'semantic'
    | 'exploration'
    | 'diversity'
    | 'repeat';
  label: string;
  evidence: string[];
  delta: number;
}

export interface RecommendationExplanation {
  headline: string;
  bullets: RecommendationExplanationBullet[];
  matchedTokens: {
    genres: string[];
    developers: string[];
    publishers: string[];
    franchises: string[];
    collections: string[];
    themes: string[];
    keywords: string[];
  };
}

export interface RecommendationItem {
  rank: number;
  igdbGameId: string;
  platformIgdbId: number;
  scoreTotal: number;
  scoreComponents: RecommendationScoreComponents;
  explanations: RecommendationExplanation;
}

export interface RecommendationTopResponse {
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  runId: number;
  generatedAt: string;
  items: RecommendationItem[];
}

export interface RecommendationLanesResponse {
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  runId: number;
  generatedAt: string;
  lane: RecommendationLaneKey;
  items: RecommendationItem[];
  page: {
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}

export interface RecommendationRebuildResponse {
  target: RecommendationTarget;
  runId: number;
  status: 'QUEUED' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'LOCKED' | 'BACKOFF_SKIPPED';
  reusedRunId?: number | null;
}

export interface RecommendationSimilarityReasons {
  summary: string;
  structuredSimilarity: number;
  semanticSimilarity: number;
  blendedSimilarity: number;
  sharedTokens: {
    genres: string[];
    developers: string[];
    publishers: string[];
    franchises: string[];
    collections: string[];
    themes: string[];
    keywords: string[];
  };
}

export interface RecommendationSimilarItem {
  igdbGameId: string;
  platformIgdbId: number;
  similarity: number;
  reasons: RecommendationSimilarityReasons;
}

export interface RecommendationSimilarResponse {
  runtimeMode: RecommendationRuntimeMode;
  source: {
    igdbGameId: string;
    platformIgdbId: number;
  };
  items: RecommendationSimilarItem[];
}

export type PopularityFeedType = 'trending' | 'upcoming' | 'recent';

export interface PopularityFeedPlatformOption {
  id: number;
  name: string;
}

export interface PopularityFeedItem {
  id: string;
  platformIgdbId: number;
  name: string;
  coverUrl: string | null;
  rating: number | null;
  popularityScore: number;
  firstReleaseDate: number | null;
  platforms: PopularityFeedPlatformOption[];
}

export interface PopularityFeedResponse {
  items: PopularityFeedItem[];
  page: {
    offset: number;
    limit: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
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
  hltbMatchGameId?: number | null;
  hltbMatchUrl?: string | null;
  hltbMatchQueryTitle?: string | null;
  hltbMatchQueryReleaseYear?: number | null;
  hltbMatchQueryPlatform?: string | null;
  hltbMatchLocked?: boolean | null;
  reviewScore?: number | null;
  reviewUrl?: string | null;
  reviewSource?: ReviewSource | null;
  mobyScore?: number | null;
  mobygamesGameId?: number | null;
  reviewMatchQueryTitle?: string | null;
  reviewMatchQueryReleaseYear?: number | null;
  reviewMatchQueryPlatform?: string | null;
  reviewMatchPlatformIgdbId?: number | null;
  reviewMatchMobygamesGameId?: number | null;
  reviewMatchLocked?: boolean | null;
  metacriticScore?: number | null;
  metacriticUrl?: string | null;
  similarGameIgdbIds?: string[];
  collections?: string[];
  developers?: string[];
  franchises?: string[];
  genres?: string[];
  themes?: string[];
  themeIds?: number[];
  keywords?: string[];
  keywordIds?: number[];
  websites?: GameWebsite[];
  steamAppId?: number | null;
  priceSource?: PriceSource | null;
  priceFetchedAt?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceRegularAmount?: number | null;
  priceDiscountPercent?: number | null;
  priceIsFree?: boolean | null;
  priceUrl?: string | null;
  psPricesMatchLocked?: boolean | null;
  screenshots?: GameScreenshot[];
  videos?: GameVideo[];
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
  hltbGameId?: number | null;
  hltbUrl?: string | null;
}

export interface HltbMatchCandidate extends HltbCompletionTimes {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  imageUrl?: string | null;
  isRecommended?: boolean;
}

export interface MetacriticScoreResult {
  metacriticScore: number | null;
  metacriticUrl: string | null;
}

export interface MetacriticMatchCandidate extends MetacriticScoreResult {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  metacriticPlatforms?: string[] | null;
  imageUrl?: string | null;
  isRecommended?: boolean;
}

export interface ReviewScoreResult {
  reviewScore: number | null;
  reviewUrl: string | null;
  reviewSource: ReviewSource | null;
  mobyScore?: number | null;
  mobygamesGameId?: number | null;
  // Compatibility aliases for legacy call sites.
  metacriticScore?: number | null;
  metacriticUrl?: string | null;
}

export interface ReviewMatchCandidate extends ReviewScoreResult {
  title: string;
  releaseYear: number | null;
  platform: string | null;
  metacriticPlatforms?: string[] | null;
  imageUrl?: string | null;
  isRecommended?: boolean;
}

export interface PriceMatchCandidate {
  title: string;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string | null;
  score: number | null;
  source?: 'steam_store' | 'psprices';
  isRecommended?: boolean;
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

export type GameSortField =
  | 'title'
  | 'releaseDate'
  | 'createdAt'
  | 'hltb'
  | 'tas'
  | 'price'
  | 'review'
  | 'metacritic'
  | 'platform';
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
