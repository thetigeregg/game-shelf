import {
  GameRatingFilterOption,
  GameStatusFilterOption,
  GameType,
  isGameRating,
} from '../models/game.models';

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    ),
  ];
}

export function isGameType(value: unknown): value is GameType {
  return (
    value === 'main_game' ||
    value === 'dlc_addon' ||
    value === 'expansion' ||
    value === 'bundle' ||
    value === 'standalone_expansion' ||
    value === 'mod' ||
    value === 'episode' ||
    value === 'season' ||
    value === 'remake' ||
    value === 'remaster' ||
    value === 'expanded_game' ||
    value === 'port' ||
    value === 'fork' ||
    value === 'pack' ||
    value === 'update'
  );
}

export function normalizeGameTypeList(value: unknown): GameType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isGameType))];
}

export function isGameStatusFilterOption(value: unknown): value is GameStatusFilterOption {
  return (
    value === 'none' ||
    value === 'playing' ||
    value === 'wantToPlay' ||
    value === 'completed' ||
    value === 'paused' ||
    value === 'dropped' ||
    value === 'replay'
  );
}

export function normalizeGameStatusFilterList(value: unknown): GameStatusFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isGameStatusFilterOption))];
}

export function isGameRatingFilterOption(value: unknown): value is GameRatingFilterOption {
  return normalizeGameRatingFilterOption(value) !== null;
}

export function normalizeGameRatingFilterList(value: unknown): GameRatingFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => normalizeGameRatingFilterOption(entry))
    .filter((entry): entry is GameRatingFilterOption => entry !== null);

  return [...new Set(normalized)];
}

function normalizeGameRatingFilterOption(value: unknown): GameRatingFilterOption | null {
  if (value === 'none') {
    return 'none';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[1-5](?:\.0|\.5)?$/.test(trimmed)) {
      return null;
    }
  }

  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;

  if (isGameRating(numeric)) {
    return numeric;
  }

  return null;
}

export function normalizeNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

export function normalizeTagFilterList(value: unknown, noneTagFilterValue: string): string[] {
  const normalized = normalizeStringList(value);
  const hasNoneTagFilter = normalized.includes(noneTagFilterValue);
  const tagNames = normalized.filter((tag) => tag !== noneTagFilterValue);
  return hasNoneTagFilter ? [noneTagFilterValue, ...tagNames] : tagNames;
}
