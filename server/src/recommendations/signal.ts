import { GameStatus, NormalizedGameRecord } from './types.js';

/**
 * How much each game tells us about the user's taste, -1 (disliked) to 1
 * (loved). Shared by the taste profile, the semantic centroid and weight
 * tuning, so all three read ratings the same way.
 */
export interface TasteSignalModel {
  /** Rating treated as neutral (signal 0). */
  center: number;
  signalOf(game: NormalizedGameRecord): number | null;
}

export interface TasteSignalOptions {
  /**
   * 0 keeps 3★ as neutral; 1 uses the user's own (shrunk) mean rating, so
   * someone who rates most games 4★ reads 4★ as "fine" and 3★ as a miss.
   */
  ratingMeanCenterWeight: number;
  /** Scales the weak signal unrated games get from their status; 0 ignores status. */
  statusSignalWeight: number;
}

/** Pseudo-ratings at 3★ added to the mean, so a handful of ratings can't swing it. */
export const RATING_MEAN_PRIOR_COUNT = 5;
const NEUTRAL_RATING = 3;
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Signal for an unrated game, before statusSignalWeight. Only statuses that
 * reflect having played it count: wanting to play, playing or pausing a game
 * says little about whether it landed.
 *
 * Completed is neutral, not positive: finishing a game says nothing about
 * enjoying it (on the real library every rated game is completed, averaging
 * 3 stars). It still counts as a sighting of the game's tags, which keeps one
 * dropped shooter from sinking a genre the user finishes all the time; leaving
 * it out entirely evaluated worse than counting it as 0.
 */
export const STATUS_SIGNAL: Readonly<Partial<Record<GameStatus, number>>> = {
  replay: 0.75,
  completed: 0,
  dropped: -0.75,
};

export const DEFAULT_TASTE_SIGNAL_MODEL: TasteSignalModel = buildTasteSignalModel([], {
  ratingMeanCenterWeight: 0,
  statusSignalWeight: 0,
});

export function buildTasteSignalModel(
  games: NormalizedGameRecord[],
  options: TasteSignalOptions
): TasteSignalModel {
  const centerWeight = clamp(finiteOr(options.ratingMeanCenterWeight, 0), 0, 1);
  const statusWeight = clamp(finiteOr(options.statusSignalWeight, 0), 0, 1);

  let ratingSum = 0;
  let ratingCount = 0;
  if (centerWeight > 0) {
    for (const game of games) {
      const rating = stepRating(game.rating);
      if (rating !== null) {
        ratingSum += rating;
        ratingCount += 1;
      }
    }
  }

  const shrunkMean =
    (ratingSum + RATING_MEAN_PRIOR_COUNT * NEUTRAL_RATING) /
    (ratingCount + RATING_MEAN_PRIOR_COUNT);
  // Keep the centre strictly inside the scale so both halves stay usable.
  const center = clamp(
    NEUTRAL_RATING + centerWeight * (shrunkMean - NEUTRAL_RATING),
    MIN_RATING + 0.5,
    MAX_RATING - 0.5
  );

  return {
    center,
    signalOf(game) {
      if (game.rating !== null) {
        const rating = stepRating(game.rating);
        return rating === null ? null : ratingSignal(rating, center);
      }

      if (statusWeight === 0 || game.status === null) {
        return null;
      }

      const statusSignal = STATUS_SIGNAL[game.status];
      return statusSignal === undefined ? null : statusSignal * statusWeight;
    },
  };
}

/**
 * Piecewise linear around the centre, so 5★ is always 1 and 1★ always -1. With
 * the centre at 3★ this is the original (rating - 3) / 2.
 */
function ratingSignal(rating: number, center: number): number {
  if (rating >= center) {
    return (rating - center) / (MAX_RATING - center);
  }

  return (rating - center) / (center - MIN_RATING);
}

/** Half-star steps from 1 to 5, or null when out of range. */
export function stepRating(rating: number | null): number | null {
  if (typeof rating !== 'number' || !Number.isFinite(rating)) {
    return null;
  }

  const stepped = Math.round(rating * 2) / 2;
  return stepped < MIN_RATING || stepped > MAX_RATING ? null : stepped;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
