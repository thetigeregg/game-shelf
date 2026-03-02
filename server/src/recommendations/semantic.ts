import { NormalizedGameRecord } from './types.js';

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
}): number[] | null {
  const { games, embeddingsByGame } = params;

  let accumulator: number[] | null = null;
  let totalWeight = 0;

  for (const game of games) {
    if (game.rating === null) {
      continue;
    }

    const signal = ratingToSignal(game.rating);

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

export function ratingToSignal(rating: number): number | null {
  if (!Number.isFinite(rating)) {
    return null;
  }

  const stepped = Math.round(rating * 2) / 2;

  if (stepped < 1 || stepped > 5) {
    return null;
  }

  const steps = Math.round(stepped * 2 - 1);
  return (steps - 5) / 4;
}

export function clampSemanticScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(-1, Math.min(1, value));
}
