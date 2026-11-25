import { buildPreferenceProfile } from './profile.js';
import { buildBaseTotals, buildRankedScores, RankedScore } from './score.js';
import {
  buildCosineCalibration,
  buildSemanticSimilarityMap,
  CosineCalibration,
} from './semantic.js';
import { tuneRecommendationWeights } from './tuning.js';
import {
  NormalizedGameRecord,
  PreferenceProfile,
  RecommendationRuntimeMode,
  RecommendationTarget,
  TokenFamily,
  TunedRecommendationWeights,
} from './types.js';

/**
 * The scoring knobs shared by the nightly rebuild and the offline evaluation
 * harness, so both always rank with the same settings.
 */
export interface RecommendationScoringOptions {
  semanticWeight: number;
  similarityStructuredWeight: number;
  similaritySemanticWeight: number;
  explorationWeight: number;
  diversityPenaltyWeight: number;
  repeatPenaltyStep: number;
  tuningMinRated: number;
  keywordsWeight: number;
  themesWeight: number;
}

export interface RecommendationScoringContext {
  profile: PreferenceProfile;
  semanticSimilarityByGame: Map<string, number>;
  tunedWeights: TunedRecommendationWeights;
  structuredKeywordsByGame: Map<string, string[]>;
  tokenFamilyWeight: Record<TokenFamily, number>;
  embeddingsByGame: Map<string, number[]>;
  /** Library-specific cosine range, shared by diversity and the similarity graph. */
  cosineCalibration: CosineCalibration | null;
}

export function buildTokenFamilyWeights(
  options: Pick<RecommendationScoringOptions, 'themesWeight' | 'keywordsWeight'>
): Record<TokenFamily, number> {
  return {
    collections: 1.4,
    franchises: 1.3,
    themes: options.themesWeight,
    developers: 1.1,
    genres: 1,
    publishers: 0.7,
    keywords: options.keywordsWeight,
  };
}

/** Builds everything that depends on the user's ratings: taste profile, semantic map, tuned weights. */
export function prepareScoringContext(params: {
  games: NormalizedGameRecord[];
  embeddingsByGame: Map<string, number[]>;
  structuredKeywordsByGame: Map<string, string[]>;
  options: RecommendationScoringOptions;
  /** Precomputed calibration; it depends only on embeddings, so callers that rebuild often can reuse it. */
  cosineCalibration?: CosineCalibration | null;
}): RecommendationScoringContext {
  const { games, embeddingsByGame, structuredKeywordsByGame, options } = params;
  const semanticSimilarityByGame = buildSemanticSimilarityMap({ games, embeddingsByGame });
  const tokenFamilyWeight = buildTokenFamilyWeights(options);
  const tunedWeights = tuneRecommendationWeights({
    games,
    semanticSimilarityByGame,
    embeddingsByGame,
    structuredKeywordsByGame,
    tokenFamilyWeight,
    minimumRated: options.tuningMinRated,
    defaults: {
      tasteWeight: 1,
      semanticWeight: options.semanticWeight,
      criticWeight: 1,
      runtimeWeight: 1,
    },
  });

  return {
    profile: buildPreferenceProfile(games, { structuredKeywordsByGame }),
    semanticSimilarityByGame,
    tunedWeights,
    structuredKeywordsByGame,
    tokenFamilyWeight,
    embeddingsByGame,
    cosineCalibration:
      params.cosineCalibration === undefined
        ? buildCosineCalibration(embeddingsByGame)
        : params.cosineCalibration,
  };
}

export function rankCandidates(params: {
  context: RecommendationScoringContext;
  candidates: NormalizedGameRecord[];
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  limit: number;
  historyByGame: Map<string, { recommendationCount: number }>;
  options: RecommendationScoringOptions;
}): RankedScore[] {
  const { context, candidates, target, runtimeMode, limit, historyByGame, options } = params;

  return buildRankedScores({
    candidates,
    target,
    profile: context.profile,
    limit,
    runtimeMode,
    semanticSimilarityByGame: context.semanticSimilarityByGame,
    tunedWeights: context.tunedWeights,
    explorationWeight: options.explorationWeight,
    diversityPenaltyWeight: options.diversityPenaltyWeight,
    similarityStructuredWeight: options.similarityStructuredWeight,
    similaritySemanticWeight: options.similaritySemanticWeight,
    repeatPenaltyStep: options.repeatPenaltyStep,
    historyByGame,
    structuredKeywordsByGame: context.structuredKeywordsByGame,
    tokenFamilyWeight: context.tokenFamilyWeight,
    embeddingsByGame: context.embeddingsByGame,
    cosineCalibration: context.cosineCalibration,
  });
}

export function scoreCandidatesBase(params: {
  context: RecommendationScoringContext;
  candidates: NormalizedGameRecord[];
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  historyByGame: Map<string, { recommendationCount: number }>;
  options: RecommendationScoringOptions;
}): Array<{ game: NormalizedGameRecord; total: number }> {
  const { context, candidates, target, runtimeMode, historyByGame, options } = params;

  return buildBaseTotals({
    candidates,
    target,
    profile: context.profile,
    runtimeMode,
    semanticSimilarityByGame: context.semanticSimilarityByGame,
    tunedWeights: context.tunedWeights,
    explorationWeight: options.explorationWeight,
    repeatPenaltyStep: options.repeatPenaltyStep,
    historyByGame,
    structuredKeywordsByGame: context.structuredKeywordsByGame,
    tokenFamilyWeight: context.tokenFamilyWeight,
  });
}
