import type { KeywordSelectionOptions } from './keyword-stats.js';
import type { RecommendationScoringOptions } from './pipeline.js';

/**
 * Code defaults for the ranking knobs. config.ts reads env overrides on top of
 * these; the offline evaluation CLI uses them directly so it runs without the
 * server's secrets.
 */
export const RECOMMENDATION_SCORING_DEFAULTS: RecommendationScoringOptions = {
  semanticWeight: 2,
  similarityStructuredWeight: 0.6,
  similaritySemanticWeight: 0.4,
  explorationWeight: 0.3,
  diversityPenaltyWeight: 0.5,
  repeatPenaltyStep: 0.2,
  tuningMinRated: 8,
  keywordsWeight: 0.6,
  themesWeight: 1.3,
  // Chosen with rec:eval on the real library (2026-11-25): AUC 0.70 -> 0.79,
  // hit@50 10% -> 22.5%, mean liked percentile 0.33 -> 0.27.
  ratingMeanCenterWeight: 1,
  statusSignalWeight: 0.25,
  igdbSimilarWeight: 1,
};

export const RECOMMENDATION_KEYWORD_SELECTION_DEFAULTS: KeywordSelectionOptions = {
  structuredMax: 100,
  embeddingMax: 40,
  globalMaxRatio: 0.7,
  structuredMaxRatio: 0.3,
  minLibraryCount: 3,
};
