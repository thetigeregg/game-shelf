import { buildTokenEntries } from './normalize.js';
import { DEFAULT_TASTE_SIGNAL_MODEL, TasteSignalModel } from './signal.js';
import { NormalizedGameRecord, PreferenceProfile, PreferenceWeight, TokenFamily } from './types.js';

export const SHRINKAGE_K = 5;

export const TOKEN_FAMILY_WEIGHT: Record<TokenFamily, number> = {
  collections: 1.4,
  franchises: 1.3,
  themes: 1.3,
  developers: 1.1,
  genres: 1,
  publishers: 0.7,
  keywords: 0.6,
};

export function buildPreferenceProfile(
  games: NormalizedGameRecord[],
  options: {
    structuredKeywordsByGame?: Map<string, string[]>;
    signalModel?: TasteSignalModel;
  } = {}
): PreferenceProfile {
  const signalModel = options.signalModel ?? DEFAULT_TASTE_SIGNAL_MODEL;
  const weightMap = new Map<string, PreferenceWeight>();
  let ratedGameCount = 0;

  for (const game of games) {
    const signal = signalModel.signalOf(game);

    if (game.rating !== null || signal !== null) {
      ratedGameCount += 1;
    }

    if (signal === null) {
      continue;
    }

    // Use the same cleaned keyword vocabulary candidates are scored with, so
    // keywords the cleanup renames (synonyms, punctuation) still match.
    const tokens = buildTokenEntries(game, options);

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
        weight: 0,
      });
    }
  }

  for (const weight of weightMap.values()) {
    weight.weight = weight.sum / (weight.count + SHRINKAGE_K);
  }

  return {
    ratedGameCount,
    weights: weightMap,
  };
}
