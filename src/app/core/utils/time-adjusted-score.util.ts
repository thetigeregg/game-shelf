import { GameEntry, ReviewSource } from '../models/game.models';

export function normalizeCriticScore(score: number, source: 'metacritic' | 'mobygames'): number {
  if (source === 'metacritic') {
    return score;
  }

  return score * 10;
}

export function calculateTimeAdjustedScore(
  normalizedScore: number,
  hours: number,
  timePreference: number
): number | null {
  if (
    !Number.isFinite(normalizedScore) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(timePreference)
  ) {
    return null;
  }

  const safeScore = Math.max(0, Math.min(100, normalizedScore));
  const safeHours = Math.max(0, hours);
  const safeTimePreference = Math.max(1, timePreference);
  const timePenalty = 1 + Math.log2(safeHours + 1) / safeTimePreference;
  const value = safeScore / timePenalty;

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

export function calculatePriceAdjustedTimeAdjustedScore(
  normalizedScore: number,
  hours: number,
  timePreference: number,
  price: number,
  pricePreference: number
): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(pricePreference)) {
    return null;
  }

  const tas = calculateTimeAdjustedScore(normalizedScore, hours, timePreference);

  if (tas === null) {
    return null;
  }

  const safePrice = Math.max(0, price);
  const safePricePreference = Math.max(1, pricePreference);
  const pricePenalty = 1 + Math.log2(safePrice + 1) / safePricePreference;
  const value = tas / pricePenalty;

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

export function resolveTimeAdjustedScoreForGame(
  game: GameEntry,
  timePreference: number
): number | null {
  const normalizedCriticScore = resolveNormalizedCriticScoreForGame(game);

  if (normalizedCriticScore === null) {
    return null;
  }

  const effectiveHltbHours = resolveEffectiveHltbHours(game);

  if (effectiveHltbHours === null) {
    return null;
  }

  return calculateTimeAdjustedScore(normalizedCriticScore, effectiveHltbHours, timePreference);
}

export function resolvePriceAdjustedTimeAdjustedScoreForGame(
  game: GameEntry,
  timePreference: number,
  pricePreference: number
): number | null {
  const normalizedCriticScore = resolveNormalizedCriticScoreForGame(game);

  if (normalizedCriticScore === null) {
    return null;
  }

  const effectiveHltbHours = resolveEffectiveHltbHours(game);

  if (effectiveHltbHours === null) {
    return null;
  }

  const effectivePrice = resolveEffectivePriceForGame(game);

  if (effectivePrice === null) {
    return null;
  }

  return calculatePriceAdjustedTimeAdjustedScore(
    normalizedCriticScore,
    effectiveHltbHours,
    timePreference,
    effectivePrice,
    pricePreference
  );
}

export function resolveEffectiveHltbHours(game: GameEntry): number | null {
  const main = normalizeHoursCandidate(game.hltbMainHours);

  if (main !== null) {
    return main;
  }

  const mainExtra = normalizeHoursCandidate(game.hltbMainExtraHours);

  if (mainExtra !== null) {
    return mainExtra;
  }

  return normalizeHoursCandidate(game.hltbCompletionistHours);
}

export function resolveNormalizedCriticScoreForGame(game: GameEntry): number | null {
  const hasReviewScore = game.reviewScore !== null && game.reviewScore !== undefined;
  const scoreCandidate = hasReviewScore ? game.reviewScore : game.metacriticScore;

  if (typeof scoreCandidate !== 'number' || !Number.isFinite(scoreCandidate)) {
    return null;
  }

  if (scoreCandidate <= 0 || scoreCandidate > 100) {
    return null;
  }

  const reviewSource: ReviewSource | null = hasReviewScore ? (game.reviewSource ?? null) : null;
  const shouldScaleMobygames =
    reviewSource === 'mobygames' &&
    (game.mobyScore != null ? scoreCandidate === game.mobyScore : scoreCandidate <= 10);
  const normalizedScore = shouldScaleMobygames
    ? normalizeCriticScore(scoreCandidate, 'mobygames')
    : scoreCandidate;

  return Math.round(normalizedScore * 10) / 10;
}

export function resolveEffectivePriceForGame(game: GameEntry): number | null {
  if (game.priceIsFree === true) {
    return 0;
  }

  return normalizePriceCandidate(game.priceAmount);
}

function normalizeHoursCandidate(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function normalizePriceCandidate(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value * 100) / 100;
}
