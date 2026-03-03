import { buildTokenEntries } from './normalize.js';
import { NormalizedGameRecord, PreferenceProfile, PreferenceWeight, TokenFamily } from './types.js';

const SHRINKAGE_K = 5;

export const TOKEN_FAMILY_WEIGHT: Record<TokenFamily, number> = {
  collections: 1.4,
  franchises: 1.3,
  themes: 1.3,
  developers: 1.1,
  genres: 1,
  publishers: 0.7,
  keywords: 0.6
};

export function buildPreferenceProfile(games: NormalizedGameRecord[]): PreferenceProfile {
  const ratedGames = games.filter((game) => game.rating !== null);
  const weightMap = new Map<string, PreferenceWeight>();

  for (const game of ratedGames) {
    const signal = ratingToSignal(game.rating);

    if (signal === null) {
      continue;
    }

    const tokens = buildTokenEntries(game);

    for (const token of tokens) {
      const existing = weightMap.get(token.key);

      if (existing) {
        existing.sum += signal;
        existing.count += 1;
        continue;
      }

      weightMap.set(token.key, {
        family: token.family,
        key: token.key,
        label: token.label,
        sum: signal,
        count: 1,
        weight: 0
      });
    }
  }

  for (const weight of weightMap.values()) {
    weight.weight = weight.sum / (weight.count + SHRINKAGE_K);
  }

  return {
    ratedGameCount: ratedGames.length,
    weights: weightMap
  };
}

export function ratingToSignal(rating: number | null): number | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    return null;
  }

  const stepped = Math.round(rating * 2) / 2;

  if (stepped < 1 || stepped > 5) {
    return null;
  }

  const steps = Math.round(stepped * 2 - 1);
  return (steps - 5) / 4;
}
