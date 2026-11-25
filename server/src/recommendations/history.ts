import { RECOMMENDATION_RUNTIME_MODES } from './runtime.js';
import {
  RankedRecommendationItem,
  RecommendationHistoryEntry,
  RecommendationLaneCollection,
  RecommendationRuntimeMode,
  RecommendationTarget,
} from './types.js';

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

export interface RecommendationHistoryUpdate {
  target: RecommendationTarget;
  runtimeMode: RecommendationRuntimeMode;
  igdbGameId: string;
  platformIgdbId: number;
}

/**
 * One history entry per game actually shown: the first page of every lane, per
 * runtime mode. Recording the whole top 200 penalised every candidate equally
 * within a week, while recording only the top of the overall list let Hidden
 * Gems and Exploration (which reach deep into the ranking) repeat unpenalised.
 */
export function buildDisplayedHistoryUpdates(
  target: RecommendationTarget,
  lanesByMode: Record<RecommendationRuntimeMode, RecommendationLaneCollection>
): RecommendationHistoryUpdate[] {
  const updates: RecommendationHistoryUpdate[] = [];

  for (const mode of RECOMMENDATION_RUNTIME_MODES) {
    const seen = new Set<string>();
    const lanes = lanesByMode[mode];
    const displayed: RankedRecommendationItem[][] = [
      lanes.overall,
      lanes.hiddenGems,
      lanes.exploration,
      lanes.blended,
      lanes.popular,
      lanes.recent,
    ];
    for (const lane of displayed) {
      for (const item of lane) {
        const key = buildHistoryKey(item.igdbGameId, item.platformIgdbId);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        updates.push({
          target,
          runtimeMode: mode,
          igdbGameId: item.igdbGameId,
          platformIgdbId: item.platformIgdbId,
        });
      }
    }
  }

  return updates;
}
