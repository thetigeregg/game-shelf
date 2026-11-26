import { NormalizedGameRecord } from './types.js';
import { DEFAULT_TASTE_SIGNAL_MODEL, TasteSignalModel } from './signal.js';

export function buildGameKey(igdbGameId: string, platformIgdbId: number): string {
  return `${igdbGameId.trim()}::${String(platformIgdbId)}`;
}

export function dot(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error('Cannot compute dot product for vectors with different dimensions.');
  }

  let total = 0;

  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }

  return total;
}

export function magnitude(vector: number[]): number {
  let total = 0;

  for (const value of vector) {
    total += value * value;
  }

  return Math.sqrt(total);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot(left, right) / (leftMagnitude * rightMagnitude);
}

export function buildTasteProfileEmbedding(params: {
  games: NormalizedGameRecord[];
  embeddingsByGame: Map<string, number[]>;
  signalModel?: TasteSignalModel;
}): number[] | null {
  const { games, embeddingsByGame } = params;
  const signalModel = params.signalModel ?? DEFAULT_TASTE_SIGNAL_MODEL;

  let accumulator: number[] | null = null;
  let totalWeight = 0;

  for (const game of games) {
    const signal = signalModel.signalOf(game);

    if (signal === null || signal <= 0) {
      continue;
    }

    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    const embedding = embeddingsByGame.get(key);

    if (!embedding) {
      continue;
    }

    if (!accumulator) {
      accumulator = new Array(embedding.length).fill(0);
    }

    if (embedding.length !== accumulator.length) {
      continue;
    }

    for (let index = 0; index < embedding.length; index += 1) {
      accumulator[index] += embedding[index] * signal;
    }

    totalWeight += signal;
  }

  if (!accumulator || totalWeight <= 0) {
    return null;
  }

  return accumulator.map((value) => value / totalWeight);
}

export function clampSemanticScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}

/** Cosine similarity of every game's embedding to the rating-weighted taste centroid. */
export function buildSemanticSimilarityMap(params: {
  games: NormalizedGameRecord[];
  embeddingsByGame: Map<string, number[]>;
  signalModel?: TasteSignalModel;
}): Map<string, number> {
  const { games, embeddingsByGame, signalModel } = params;
  const profileEmbedding = buildTasteProfileEmbedding({ games, embeddingsByGame, signalModel });
  const map = new Map<string, number>();

  if (!profileEmbedding) {
    return map;
  }

  for (const game of games) {
    const key = buildGameKey(game.igdbGameId, game.platformIgdbId);
    const embedding = embeddingsByGame.get(key);

    if (!embedding || embedding.length !== profileEmbedding.length) {
      continue;
    }

    map.set(key, clampSemanticScore(cosineSimilarity(embedding, profileEmbedding)));
  }

  return map;
}

/**
 * Where raw embedding cosines sit for this library. text-embedding-3 cosines
 * between unrelated games are rarely negative and bunch up in a narrow band,
 * so mapping them with (cos + 1) / 2 gave every pair roughly the same score.
 * `low` is the median sampled pair (a typical unrelated pair) and `high` the
 * 99th percentile (a close match).
 */
export interface CosineCalibration {
  low: number;
  high: number;
}

const CALIBRATION_MAX_PAIRS = 20_000;
const CALIBRATION_LOW_QUANTILE = 0.5;
const CALIBRATION_HIGH_QUANTILE = 0.99;

export function normalizeVector(vector: number[]): number[] | null {
  const length = magnitude(vector);

  if (!Number.isFinite(length) || length === 0) {
    return null;
  }

  return vector.map((value) => value / length);
}

/**
 * Samples pairs deterministically (sorted by game key) so rebuilds are
 * reproducible. Pairs of the same game on different platforms are skipped:
 * they share the same text, so their near-1 cosines would drag the 99th
 * percentile up and squash every real match (the similarity graph never
 * compares a game with itself either).
 */
export function buildCosineCalibration(
  embeddingsByGame: Map<string, number[]>
): CosineCalibration | null {
  const keys = [...embeddingsByGame.keys()].sort((left, right) => left.localeCompare(right, 'en'));
  const entries: Array<{ gameId: string; vector: number[] }> = [];

  for (const key of keys) {
    const normalized = normalizeVector(embeddingsByGame.get(key) as number[]);
    if (normalized && (entries.length === 0 || normalized.length === entries[0].vector.length)) {
      entries.push({ gameId: readGameIdFromKey(key), vector: normalized });
    }
  }

  const count = entries.length;
  if (count < 3) {
    return null;
  }

  const cosines: number[] = [];
  const addPair = (left: number, right: number): void => {
    if (entries[left].gameId !== entries[right].gameId) {
      cosines.push(dot(entries[left].vector, entries[right].vector));
    }
  };
  const totalPairs = (count * (count - 1)) / 2;

  if (totalPairs <= CALIBRATION_MAX_PAIRS) {
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) {
        addPair(left, right);
      }
    }
  } else {
    // Pair every vector with a spread of distinct offsets around the ring.
    // Offsets stay at or below (count - 1) / 2, because offset k and count - k
    // (and count / 2 from both ends) would visit the same pairs twice.
    const maxOffset = Math.floor((count - 1) / 2);
    const offsetsPerVector = Math.min(maxOffset, Math.ceil(CALIBRATION_MAX_PAIRS / count));
    for (let step = 0; step < offsetsPerVector; step += 1) {
      const offset = 1 + Math.floor((step * maxOffset) / offsetsPerVector);
      for (let index = 0; index < count && cosines.length < CALIBRATION_MAX_PAIRS; index += 1) {
        addPair(index, (index + offset) % count);
      }
    }
  }

  if (cosines.length === 0) {
    return null;
  }

  cosines.sort((left, right) => left - right);
  const low = quantile(cosines, CALIBRATION_LOW_QUANTILE);
  const high = quantile(cosines, CALIBRATION_HIGH_QUANTILE);

  return high - low > 1e-6 ? { low, high } : null;
}

function readGameIdFromKey(key: string): string {
  const separator = key.lastIndexOf('::');
  return separator < 0 ? key : key.slice(0, separator);
}

/** Maps a raw cosine to 0..1: 0 for a typical unrelated pair or worse, 1 for a close match. */
export function calibrateCosine(cosine: number, calibration: CosineCalibration | null): number {
  const bounded = clampSemanticScore(cosine);

  if (!calibration) {
    return Math.max(0, Math.min(1, (bounded + 1) / 2));
  }

  return Math.max(
    0,
    Math.min(1, (bounded - calibration.low) / (calibration.high - calibration.low))
  );
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
