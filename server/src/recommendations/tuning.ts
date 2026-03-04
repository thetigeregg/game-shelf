import { buildTokenEntries } from './normalize.js';
import { TOKEN_FAMILY_WEIGHT, buildPreferenceProfile } from './profile.js';
import { ratingToSignal } from './rating.js';
import { buildGameKey } from './semantic.js';
import { NormalizedGameRecord, TunedRecommendationWeights } from './types.js';

export function tuneRecommendationWeights(params: {
  games: NormalizedGameRecord[];
  semanticSimilarityByGame: Map<string, number>;
  minimumRated: number;
  defaults: TunedRecommendationWeights;
}): TunedRecommendationWeights {
  const { games, semanticSimilarityByGame, minimumRated, defaults } = params;
  const rated = games.filter((game) => game.rating !== null);

  if (rated.length < minimumRated) {
    return defaults;
  }

  const profile = buildPreferenceProfile(games);
  const y: number[] = [];
  const structured: number[] = [];
  const semantic: number[] = [];
  const critic: number[] = [];
  const runtime: number[] = [];

  for (const game of rated) {
    const steps = game.rating ? Math.round(game.rating * 2 - 1) : null;
    if (steps === null) {
      continue;
    }

    y.push(steps);
    structured.push(evaluateStructuredTaste(game, profile));
    semantic.push(
      semanticSimilarityByGame.get(buildGameKey(game.igdbGameId, game.platformIgdbId)) ?? 0
    );
    critic.push(normalizeCriticScore(game));
    runtime.push(normalizeRuntime(game.runtimeHours));
  }

  if (y.length < minimumRated) {
    return defaults;
  }

  const structuredCorrelation = computeCorrelation(structured, y);
  const semanticCorrelation = computeCorrelation(semantic, y);
  const criticCorrelation = computeCorrelation(critic, y);
  const runtimeCorrelation = computeCorrelation(runtime, y);

  return {
    tasteWeight: clamp(structuredCorrelation * 3, 0.5, 3),
    semanticWeight: clamp(semanticCorrelation * 3, 0.5, 3),
    criticWeight: clamp(criticCorrelation * 2, 0, 2),
    runtimeWeight: clamp(runtimeCorrelation * 2, 0, 2)
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

function evaluateStructuredTaste(
  game: NormalizedGameRecord,
  profile: ReturnType<typeof buildPreferenceProfile>
): number {
  const tokens = buildTokenEntries(game);
  let score = 0;

  for (const token of tokens) {
    const preference = profile.weights.get(token.key);
    if (!preference) {
      continue;
    }
    score += preference.weight * TOKEN_FAMILY_WEIGHT[token.family];
  }

  return score;
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

function normalizeRuntime(runtimeHours: number | null): number {
  if (runtimeHours === null || !Number.isFinite(runtimeHours) || runtimeHours <= 0) {
    return 0;
  }

  return clamp(runtimeHours / 50, 0, 1);
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

export function ratingStepSignal(value: number | null): number {
  if (value === null) {
    return 0;
  }

  const signal = ratingToSignal(value);
  return signal ?? 0;
}
