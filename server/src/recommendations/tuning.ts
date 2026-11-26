import { buildTokenEntries } from './normalize.js';
import { TOKEN_FAMILY_WEIGHT, SHRINKAGE_K, buildPreferenceProfile } from './profile.js';
import { buildGameKey, cosineSimilarity } from './semantic.js';
import { DEFAULT_TASTE_SIGNAL_MODEL, TasteSignalModel } from './signal.js';
import {
  NormalizedGameRecord,
  PreferenceProfile,
  TokenFamily,
  TunedRecommendationWeights,
} from './types.js';

/**
 * Picks taste/semantic/critic weights from how well each signal predicts the
 * user's own ratings.
 *
 * Each rated game is scored leave-one-out: against a taste profile and taste
 * centroid that exclude that game's own rating. Otherwise a game with a unique
 * developer or series "predicts" itself and the correlations come out inflated.
 *
 * The runtime weight is not tuned. Runtime mode is an explicit user choice
 * (SHORT/LONG), so whether past ratings favoured long games must not be able to
 * switch that choice off.
 */
export function tuneRecommendationWeights(params: {
  games: NormalizedGameRecord[];
  semanticSimilarityByGame: Map<string, number>;
  minimumRated: number;
  defaults: TunedRecommendationWeights;
  /** When given, semantic similarity is computed leave-one-out from these vectors. */
  embeddingsByGame?: Map<string, number[]>;
  structuredKeywordsByGame?: Map<string, string[]>;
  tokenFamilyWeight?: Partial<Record<TokenFamily, number>>;
  /**
   * How ratings (and, if enabled, statuses) become taste signal. Only rated
   * games are prediction targets; status-only games still shape the profile
   * and centroid they are scored against.
   */
  signalModel?: TasteSignalModel;
}): TunedRecommendationWeights {
  const {
    games,
    semanticSimilarityByGame,
    minimumRated,
    defaults,
    embeddingsByGame,
    structuredKeywordsByGame,
    tokenFamilyWeight,
  } = params;
  // The mean-centred neutral point is computed from all ratings, the target's
  // included. Accepted: it is a shrunk mean, so one rating barely moves it, and
  // recomputing it per target isn't worth the cost.
  const signalModel = params.signalModel ?? DEFAULT_TASTE_SIGNAL_MODEL;
  const rated = games.filter((game) => game.rating !== null);

  if (rated.length < minimumRated) {
    return defaults;
  }

  const profile = buildPreferenceProfile(games, { structuredKeywordsByGame, signalModel });
  const centroid = embeddingsByGame
    ? buildCentroidAccumulator(games, embeddingsByGame, signalModel)
    : null;
  const y: number[] = [];
  const structured: number[] = [];
  const semantic: number[] = [];
  const critic: number[] = [];

  for (const game of rated) {
    const signal = signalModel.signalOf(game);
    if (signal === null) {
      continue;
    }

    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    y.push(signal);
    structured.push(
      evaluateLeaveOneOutTaste(game, signal, profile, structuredKeywordsByGame, tokenFamilyWeight)
    );
    semantic.push(
      centroid && embeddingsByGame
        ? evaluateLeaveOneOutSemantic(embeddingsByGame.get(key), signal, centroid)
        : (semanticSimilarityByGame.get(key) ?? 0)
    );
    critic.push(normalizeCriticScore(game));
  }

  if (y.length < minimumRated) {
    return defaults;
  }

  const structuredCorrelation = computeCorrelation(structured, y);
  const semanticCorrelation = computeCorrelation(semantic, y);
  const criticCorrelation = computeCorrelation(critic, y);

  return {
    tasteWeight: clamp(structuredCorrelation * 3, 0.5, 3),
    semanticWeight: clamp(semanticCorrelation * 3, 0.5, 3),
    criticWeight: clamp(criticCorrelation * 2, 0, 2),
    runtimeWeight: defaults.runtimeWeight,
  };
}

export function computeCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) {
    return 0;
  }

  const meanLeft = mean(left);
  const meanRight = mean(right);
  let numerator = 0;
  let denomLeft = 0;
  let denomRight = 0;

  for (let index = 0; index < left.length; index += 1) {
    const deltaLeft = left[index] - meanLeft;
    const deltaRight = right[index] - meanRight;
    numerator += deltaLeft * deltaRight;
    denomLeft += deltaLeft * deltaLeft;
    denomRight += deltaRight * deltaRight;
  }

  if (denomLeft <= 0 || denomRight <= 0) {
    return 0;
  }

  return numerator / Math.sqrt(denomLeft * denomRight);
}

/** Taste score for a rated game against the profile with its own rating removed. */
function evaluateLeaveOneOutTaste(
  game: NormalizedGameRecord,
  signal: number,
  profile: PreferenceProfile,
  structuredKeywordsByGame: Map<string, string[]> | undefined,
  tokenFamilyWeight: Partial<Record<TokenFamily, number>> | undefined
): number {
  let score = 0;

  for (const token of buildTokenEntries(game, { structuredKeywordsByGame })) {
    const preference = profile.weights.get(token.key);
    if (!preference) {
      continue;
    }

    const remainingCount = preference.count - 1;
    if (remainingCount <= 0) {
      continue;
    }

    const weight = (preference.sum - signal) / (remainingCount + SHRINKAGE_K);
    const familyWeight = tokenFamilyWeight?.[token.family] ?? TOKEN_FAMILY_WEIGHT[token.family];
    score += weight * familyWeight;
  }

  return score;
}

interface CentroidAccumulator {
  sum: number[];
  totalWeight: number;
}

/** Unnormalised signal-weighted sum of liked games' embeddings (same inputs as the taste centroid). */
function buildCentroidAccumulator(
  games: NormalizedGameRecord[],
  embeddingsByGame: Map<string, number[]>,
  signalModel: TasteSignalModel
): CentroidAccumulator | null {
  let sum: number[] | null = null;
  let totalWeight = 0;

  for (const game of games) {
    const signal = signalModel.signalOf(game);
    const embedding = embeddingsByGame.get(buildGameKey(game.igdbGameId, game.platformIgdbId));

    if (signal === null || signal <= 0 || !embedding) {
      continue;
    }

    sum ??= new Array<number>(embedding.length).fill(0);
    if (embedding.length !== sum.length) {
      continue;
    }

    for (let index = 0; index < embedding.length; index += 1) {
      sum[index] += embedding[index] * signal;
    }
    totalWeight += signal;
  }

  return sum && totalWeight > 0 ? { sum, totalWeight } : null;
}

/** Cosine to the taste centroid after removing this game's own contribution. */
function evaluateLeaveOneOutSemantic(
  embedding: number[] | undefined,
  signal: number,
  centroid: CentroidAccumulator
): number {
  if (!embedding || embedding.length !== centroid.sum.length) {
    return 0;
  }

  if (signal <= 0) {
    return cosineSimilarity(embedding, centroid.sum);
  }

  if (centroid.totalWeight - signal <= 1e-9) {
    return 0;
  }

  const remaining = centroid.sum.map((value, index) => value - embedding[index] * signal);
  return cosineSimilarity(embedding, remaining);
}

function normalizeCriticScore(game: NormalizedGameRecord): number {
  if (typeof game.reviewScore === 'number' && Number.isFinite(game.reviewScore)) {
    const normalized = game.reviewScore <= 10 ? game.reviewScore * 10 : game.reviewScore;
    return clamp(normalized / 100, 0, 1);
  }

  if (typeof game.metacriticScore === 'number' && Number.isFinite(game.metacriticScore)) {
    return clamp(game.metacriticScore / 100, 0, 1);
  }

  if (typeof game.mobyScore === 'number' && Number.isFinite(game.mobyScore)) {
    return clamp(game.mobyScore / 10, 0, 1);
  }

  return 0;
}

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
