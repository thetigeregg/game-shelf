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
      lastRecommendedAt: entry.lastRecommendedAt
    });
  }

  return result;
}
