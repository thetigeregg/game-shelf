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
};

export const RECOMMENDATION_KEYWORD_SELECTION_DEFAULTS: KeywordSelectionOptions = {
  structuredMax: 100,
  embeddingMax: 40,
  globalMaxRatio: 0.7,
  structuredMaxRatio: 0.3,
  minLibraryCount: 3,
};
