import { RecommendationHistoryEntry } from './types.js';

export function buildHistoryKey(igdbGameId: string, platformIgdbId: number): string {
  return `${igdbGameId.trim()}::${String(platformIgdbId)}`;
}

export function computeRepeatPenalty(recommendationCount: number, step: number): number {
  const count = Number.isFinite(recommendationCount) ? Math.max(0, recommendationCount) : 0;
  const boundedStep = Number.isFinite(step) ? Math.max(0, step) : 0;
  if (count === 0 || boundedStep === 0) {
    return 0;
  }
  return -Math.min(count * boundedStep, 1);
}

export function normalizeHistoryMap(
  map: Map<string, RecommendationHistoryEntry>
): Map<string, RecommendationHistoryEntry> {
  const result = new Map<string, RecommendationHistoryEntry>();

  for (const [key, entry] of map.entries()) {
    result.set(key, {
      recommendationCount: Math.max(0, Math.floor(entry.recommendationCount)),
      lastRecommendedAt: entry.lastRecommendedAt,
    });
  }

  return result;
}

/** Repeat-penalty memory fades by half every week a game goes unrecommended. */
export const RECOMMENDATION_HISTORY_HALF_LIFE_DAYS = 7;

/**
 * The recorded count, faded by time since the game was last recommended, so a
 * game that has rested for a few weeks can come back instead of carrying its
 * penalty forever.
 */
export function decayRecommendationCount(
  recommendationCount: number,
  lastRecommendedAt: string,
  nowMs: number,
  halfLifeDays = RECOMMENDATION_HISTORY_HALF_LIFE_DAYS
): number {
  const count = Number.isFinite(recommendationCount) ? Math.max(0, recommendationCount) : 0;
  const lastMs = Date.parse(lastRecommendedAt);

  if (count === 0 || !Number.isFinite(lastMs) || halfLifeDays <= 0) {
    return count;
  }

  const ageDays = Math.max(0, (nowMs - lastMs) / (24 * 60 * 60 * 1000));
  return count * Math.pow(0.5, ageDays / halfLifeDays);
}
