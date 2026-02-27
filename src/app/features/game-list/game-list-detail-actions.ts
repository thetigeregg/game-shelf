import { GameEntry, GameRating, GameStatus, Tag } from '../../core/models/game.models';

export function hasHltbData(game: GameEntry): boolean {
  return (
    isPositiveNumber(game.hltbMainHours) ||
    isPositiveNumber(game.hltbMainExtraHours) ||
    isPositiveNumber(game.hltbCompletionistHours)
  );
}

export function hasMetacriticData(game: GameEntry): boolean {
  return isPositiveIntegerScore(game.reviewScore ?? game.metacriticScore);
}

export function normalizeGameStatus(value: string | null | undefined): GameStatus | null {
  if (
    value === 'playing' ||
    value === 'wantToPlay' ||
    value === 'completed' ||
    value === 'paused' ||
    value === 'dropped' ||
    value === 'replay'
  ) {
    return value;
  }

  return null;
}

export function normalizeGameRating(value: number | string | null | undefined): GameRating | null {
  const numeric = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

  if (numeric === 1 || numeric === 2 || numeric === 3 || numeric === 4 || numeric === 5) {
    return numeric;
  }

  return null;
}

export function buildTagInput(
  tag: Tag,
  selectedTagIds: number[]
): { type: 'checkbox'; label: string; value: string; checked: boolean } {
  const tagId = typeof tag.id === 'number' && Number.isInteger(tag.id) && tag.id > 0 ? tag.id : -1;

  return {
    type: 'checkbox',
    label: tag.name,
    value: String(tagId),
    checked: selectedTagIds.includes(tagId)
  };
}

export function parseTagSelection(value: string[] | string | null | undefined): number[] {
  if (Array.isArray(value)) {
    return normalizeTagIds(value.map((entry) => Number.parseInt(entry, 10)));
  }

  if (typeof value === 'string') {
    return normalizeTagIds([Number.parseInt(value, 10)]);
  }

  return [];
}

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

function isPositiveNumber(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveIntegerScore(value: number | null | undefined): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100
  );
}
