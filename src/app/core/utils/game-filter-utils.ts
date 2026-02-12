import { GameRatingFilterOption, GameStatusFilterOption, GameType } from '../models/game.models';

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item.length > 0),
  )];
}

export function isGameType(value: unknown): value is GameType {
  return value === 'main_game'
    || value === 'dlc_addon'
    || value === 'expansion'
    || value === 'bundle'
    || value === 'standalone_expansion'
    || value === 'mod'
    || value === 'episode'
    || value === 'season'
    || value === 'remake'
    || value === 'remaster'
    || value === 'expanded_game'
    || value === 'port'
    || value === 'fork'
    || value === 'pack'
    || value === 'update';
}

export function normalizeGameTypeList(value: unknown): GameType[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isGameType))];
}

export function isGameStatusFilterOption(value: unknown): value is GameStatusFilterOption {
  return value === 'none'
    || value === 'playing'
    || value === 'wantToPlay'
    || value === 'completed'
    || value === 'paused'
    || value === 'dropped'
    || value === 'replay';
}

export function normalizeGameStatusFilterList(value: unknown): GameStatusFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isGameStatusFilterOption))];
}

export function isGameRatingFilterOption(value: unknown): value is GameRatingFilterOption {
  return value === 'none'
    || value === 1
    || value === 2
    || value === 3
    || value === 4
    || value === 5;
}

export function normalizeGameRatingFilterList(value: unknown): GameRatingFilterOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(isGameRatingFilterOption))];
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
  const tagNames = normalized.filter(tag => tag !== noneTagFilterValue);
  return hasNoneTagFilter ? [noneTagFilterValue, ...tagNames] : tagNames;
}
