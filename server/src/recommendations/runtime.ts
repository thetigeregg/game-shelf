import { RecommendationRuntimeMode } from './types.js';

export const RECOMMENDATION_RUNTIME_MODES: RecommendationRuntimeMode[] = [
  'NEUTRAL',
  'SHORT',
  'LONG',
];

export function parseRecommendationRuntimeMode(value: unknown): RecommendationRuntimeMode | null {
  if (value === 'NEUTRAL' || value === 'SHORT' || value === 'LONG') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'NEUTRAL' || normalized === 'SHORT' || normalized === 'LONG') {
    return normalized;
  }

  return null;
}

export function scoreRuntimeFit(
  runtimeHours: number | null,
  runtimeMode: RecommendationRuntimeMode
): number {
  if (runtimeHours === null || !Number.isFinite(runtimeHours) || runtimeHours <= 0) {
    return 0;
  }

  if (runtimeMode === 'SHORT') {
    return clamp((20 - runtimeHours) / 20, -1, 1);
  }

  if (runtimeMode === 'LONG') {
    return clamp((runtimeHours - 10) / 30, -1, 1);
  }

  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
