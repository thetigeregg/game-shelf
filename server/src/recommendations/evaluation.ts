import { selectCandidates } from './candidates.js';
import {
  prepareScoringContext,
  rankCandidates,
  RecommendationScoringOptions,
  scoreCandidatesBase,
} from './pipeline.js';
import { buildGameKey } from './semantic.js';
import {
  NormalizedGameRecord,
  RecommendationRuntimeMode,
  TunedRecommendationWeights,
} from './types.js';

export interface RecommendationEvaluationResult {
  runtimeMode: RecommendationRuntimeMode;
  ratedCount: number;
  likedCount: number;
  dislikedCount: number;
  /** Backlog candidates each held-out game competes against. */
  candidatePoolSize: number;
  /** Share of held-out liked games that land in the top k of the full (re-ranked) list. */
  hitRate: Array<{ k: number; rate: number }>;
  /** Mean of 1/rank for held-out liked games, counting misses beyond the largest k as 0. */
  meanReciprocalRank: number;
  /** Where held-out liked games fall by base score: 0 = top of the pool, 1 = bottom. */
  meanLikedPercentile: number;
  medianLikedPercentile: number;
  /** Chance a held-out liked game outscores a held-out disliked one (0.5 = random). */
  auc: number | null;
  /** Weights the tuner picks from the full rated set (not leave-one-out). */
  fullDataTunedWeights: TunedRecommendationWeights;
}

/**
 * Leave-one-out evaluation of BACKLOG ranking against the user's own ratings.
 *
 * Each rated library game is hidden in turn: its rating and status are cleared
 * so it becomes an ordinary backlog candidate, the whole scoring context
 * (taste profile, semantic centroid, tuned weights) is rebuilt without it, and
 * we record where it lands among the real backlog. A good ranker puts the
 * games you went on to love near the top and the ones you disliked near the
 * bottom.
 */
export function evaluateRecommendationQuality(params: {
  games: NormalizedGameRecord[];
  embeddingsByGame: Map<string, number[]>;
  structuredKeywordsByGame: Map<string, string[]>;
  options: RecommendationScoringOptions;
  runtimeMode?: RecommendationRuntimeMode;
  ks?: number[];
  likedMinRating?: number;
  dislikedMaxRating?: number;
}): RecommendationEvaluationResult {
  const {
    games,
    embeddingsByGame,
    structuredKeywordsByGame,
    options,
    runtimeMode = 'NEUTRAL',
    likedMinRating = 4,
    dislikedMaxRating = 3,
  } = params;
  const ks = [
    ...new Set((params.ks ?? [10, 20, 50]).filter((k) => Number.isInteger(k) && k > 0)),
  ].sort((left, right) => left - right);
  const maxK = ks.length > 0 ? ks[ks.length - 1] : 0;
  const emptyHistory = new Map<string, { recommendationCount: number }>();

  // Only library games and rated games influence BACKLOG scoring; skipping the
  // discovery pool keeps each leave-one-out pass fast.
  const scoringGames = games.filter(
    (game) => game.listType === 'collection' || game.rating !== null
  );
  const rated = scoringGames
    .filter((game) => game.listType === 'collection' && game.rating !== null)
    .sort((left, right) =>
      buildGameKey(left.igdbGameId, left.platformIgdbId).localeCompare(
        buildGameKey(right.igdbGameId, right.platformIgdbId),
        'en'
      )
    );
  const backlog = selectCandidates(scoringGames, 'BACKLOG');

  const likedScores: number[] = [];
  const dislikedScores: number[] = [];
  const likedPercentiles: number[] = [];
  const hitCounts = new Map<number, number>(ks.map((k) => [k, 0]));
  let reciprocalRankSum = 0;
  let likedCount = 0;

  for (const heldOut of rated) {
    const rating = heldOut.rating as number;
    const isLiked = rating >= likedMinRating;
    const isDisliked = rating <= dislikedMaxRating;

    if (!isLiked && !isDisliked) {
      continue;
    }

    const hidden: NormalizedGameRecord = { ...heldOut, rating: null, status: null };
    const looGames = scoringGames.map((game) => (game === heldOut ? hidden : game));
    const context = prepareScoringContext({
      games: looGames,
      embeddingsByGame,
      structuredKeywordsByGame,
      options,
    });
    const candidates = [...backlog, hidden];
    const totals = scoreCandidatesBase({
      context,
      candidates,
      target: 'BACKLOG',
      runtimeMode,
      historyByGame: emptyHistory,
      options,
    });
    const heldOutTotal = totals[totals.length - 1].total;

    if (isDisliked) {
      dislikedScores.push(heldOutTotal);
      continue;
    }

    likedCount += 1;
    likedScores.push(heldOutTotal);
    likedPercentiles.push(computePercentile(heldOutTotal, totals.slice(0, -1)));

    if (maxK === 0) {
      continue;
    }

    const ranked = rankCandidates({
      context,
      candidates,
      target: 'BACKLOG',
      runtimeMode,
      limit: Math.min(maxK, candidates.length),
      historyByGame: emptyHistory,
      options,
    });
    const position = ranked.findIndex((entry) => entry.game === hidden);

    if (position < 0) {
      continue;
    }

    const rank = position + 1;
    reciprocalRankSum += 1 / rank;
    for (const k of ks) {
      if (rank <= k) {
        hitCounts.set(k, (hitCounts.get(k) ?? 0) + 1);
      }
    }
  }

  const fullContext = prepareScoringContext({
    games: scoringGames,
    embeddingsByGame,
    structuredKeywordsByGame,
    options,
  });

  return {
    runtimeMode,
    ratedCount: rated.length,
    likedCount,
    dislikedCount: dislikedScores.length,
    candidatePoolSize: backlog.length,
    hitRate: ks.map((k) => ({
      k,
      rate: likedCount > 0 ? round4((hitCounts.get(k) ?? 0) / likedCount) : 0,
    })),
    meanReciprocalRank: likedCount > 0 ? round4(reciprocalRankSum / likedCount) : 0,
    meanLikedPercentile: round4(mean(likedPercentiles)),
    medianLikedPercentile: round4(median(likedPercentiles)),
    auc: computeAuc(likedScores, dislikedScores),
    fullDataTunedWeights: fullContext.tunedWeights,
  };
}

/** Fraction of the pool scoring strictly above `value`, with ties counted half. */
export function computePercentile(value: number, pool: Array<{ total: number }>): number {
  if (pool.length === 0) {
    return 0;
  }

  let above = 0;
  let tied = 0;
  for (const entry of pool) {
    if (entry.total > value) {
      above += 1;
    } else if (entry.total === value) {
      tied += 1;
    }
  }

  return (above + tied / 2) / pool.length;
}

export function computeAuc(positives: number[], negatives: number[]): number | null {
  if (positives.length === 0 || negatives.length === 0) {
    return null;
  }

  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) {
        wins += 1;
      } else if (positive === negative) {
        wins += 0.5;
      }
    }
  }

  return round4(wins / (positives.length * negatives.length));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
