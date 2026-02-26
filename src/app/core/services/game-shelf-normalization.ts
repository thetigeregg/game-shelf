import type { GameCatalogResult, GameRating } from '../models/game.models';

export function normalizeTagIds(tagIds: number[] | undefined): number[] {
  if (!Array.isArray(tagIds)) {
    return [];
  }

  return [
    ...new Set(
      tagIds
        .filter((tagId) => Number.isInteger(tagId) && tagId > 0)
        .map((tagId) => Math.trunc(tagId))
    )
  ];
}

export function normalizeTagColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : '#3880ff';
}

export function normalizeGameId(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error('IGDB game id is required.');
  }

  return normalized;
}

export function normalizePlatformIgdbId(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('IGDB platform id is required.');
  }

  return value;
}

export function normalizePlatform(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (normalized.length === 0) {
    throw new Error('Platform is required.');
  }

  return normalized;
}

export function normalizeCompletionHours(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

export function hasCompletionTimes(result: GameCatalogResult): boolean {
  return (
    normalizeCompletionHours(result.hltbMainHours) !== null ||
    normalizeCompletionHours(result.hltbMainExtraHours) !== null ||
    normalizeCompletionHours(result.hltbCompletionistHours) !== null
  );
}

export function normalizeRating(value: GameRating | null | undefined): GameRating | null {
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) {
    return value;
  }

  return null;
}

export function normalizeTheGamesDbUrl(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';

  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);

    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'cdn.thegamesdb.net') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}
