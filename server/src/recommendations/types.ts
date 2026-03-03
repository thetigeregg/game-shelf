export type RecommendationTarget = 'BACKLOG' | 'WISHLIST' | 'DISCOVERY';
export type RecommendationRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type RecommendationRunTrigger = 'manual' | 'scheduler' | 'stale-read';
export type RecommendationRuntimeMode = 'NEUTRAL' | 'SHORT' | 'LONG';
export type RecommendationLaneKey =
  | 'overall'
  | 'hiddenGems'
  | 'exploration'
  | 'blended'
  | 'popular'
  | 'recent';

export type GameStatus = 'completed' | 'dropped' | 'playing' | 'paused' | 'replay' | 'wantToPlay';

export type TokenFamily =
  | 'genres'
  | 'developers'
  | 'publishers'
  | 'franchises'
  | 'collections'
  | 'themes'
  | 'keywords';

export interface NormalizedGameRecord {
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  listType: 'collection' | 'wishlist' | 'discovery';
  discoverySource?: 'popular' | 'recent' | null;
  status: GameStatus | null;
  rating: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  releaseYear: number | null;
  runtimeHours: number | null;
  summary: string | null;
  storyline: string | null;
  reviewScore: number | null;
  reviewSource: 'metacritic' | 'mobygames' | null;
  metacriticScore: number | null;
  mobyScore: number | null;
  genres: string[];
  themes: string[];
  keywords: string[];
  developers: string[];
  publishers: string[];
  franchises: string[];
  collections: string[];
}

export interface TokenEntry {
  family: TokenFamily;
  key: string;
  label: string;
}

export interface PreferenceWeight {
  family: TokenFamily;
  key: string;
  label: string;
  sum: number;
  count: number;
  weight: number;
}

export interface PreferenceProfile {
  ratedGameCount: number;
  weights: Map<string, PreferenceWeight>;
}

export interface TasteMatch {
  family: TokenFamily;
  key: string;
  label: string;
  delta: number;
}

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

export interface RankedRecommendationItem {
  igdbGameId: string;
  platformIgdbId: number;
  rank: number;
  scoreTotal: number;
  scoreComponents: RecommendationScoreComponents;
  explanations: RecommendationExplanation;
}

export interface RecommendationLaneCollection {
  overall: RankedRecommendationItem[];
  hiddenGems: RankedRecommendationItem[];
  exploration: RankedRecommendationItem[];
  blended: RankedRecommendationItem[];
  popular: RankedRecommendationItem[];
  recent: RankedRecommendationItem[];
}

export interface RecommendationRunSummary {
  id: number;
  target: RecommendationTarget;
  status: RecommendationRunStatus;
  settingsHash: string;
  inputHash: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface SimilarityReasons {
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

export interface SimilarityEdge {
  sourceIgdbGameId: string;
  sourcePlatformIgdbId: number;
  similarIgdbGameId: string;
  similarPlatformIgdbId: number;
  similarity: number;
  reasons: SimilarityReasons;
}

export interface RebuildResult {
  target: RecommendationTarget;
  runId: number;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  reusedRunId?: number;
}

export interface TunedRecommendationWeights {
  tasteWeight: number;
  semanticWeight: number;
  criticWeight: number;
  runtimeWeight: number;
}

export interface RecommendationHistoryEntry {
  recommendationCount: number;
  lastRecommendedAt: string;
}

export interface StoredGameEmbedding {
  igdbGameId: string;
  platformIgdbId: number;
  embedding: number[];
  embeddingModel: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface GameEmbeddingUpsertInput {
  igdbGameId: string;
  platformIgdbId: number;
  embedding: number[];
  embeddingModel: string;
  sourceHash: string;
}
