import {
  DEFAULT_GAME_LIST_FILTERS,
  GameGroupByField,
  GameListFilters
} from '../core/models/game.models';
import {
  normalizeGameRatingFilterList,
  normalizeGameStatusFilterList,
  normalizeGameTypeList,
  normalizeNonNegativeNumber,
  normalizeStringList,
  normalizeTagFilterList
} from '../core/utils/game-filter-utils';

const VALID_GROUP_BY_VALUES: readonly GameGroupByField[] = [
  'none',
  'platform',
  'developer',
  'franchise',
  'collection',
  'tag',
  'genre',
  'publisher',
  'releaseYear'
];

export interface ListPagePreferences {
  filters: GameListFilters;
  groupBy: GameGroupByField;
}

export function normalizeListPageGroupBy(value: unknown): GameGroupByField {
  if (typeof value === 'string' && VALID_GROUP_BY_VALUES.includes(value as GameGroupByField)) {
    return value as GameGroupByField;
  }

  return 'none';
}

export function normalizeListPageStoredFilters(
  value: unknown,
  noneTagFilterValue: string
): GameListFilters {
  const parsed = isRecord(value) ? value : {};
  const hltbMainHoursMin = normalizeNonNegativeNumber(parsed['hltbMainHoursMin']);
  const hltbMainHoursMax = normalizeNonNegativeNumber(parsed['hltbMainHoursMax']);

  return {
    sortField: isValidSortField(parsed['sortField'])
      ? parsed['sortField']
      : DEFAULT_GAME_LIST_FILTERS.sortField,
    sortDirection: parsed['sortDirection'] === 'desc' ? 'desc' : 'asc',
    platform: normalizeStringList(parsed['platform']),
    collections: normalizeStringList(parsed['collections']),
    developers: normalizeStringList(parsed['developers']),
    franchises: normalizeStringList(parsed['franchises']),
    publishers: normalizeStringList(parsed['publishers']),
    gameTypes: normalizeGameTypeList(parsed['gameTypes']),
    genres: normalizeStringList(parsed['genres']),
    statuses: normalizeGameStatusFilterList(parsed['statuses']),
    tags: normalizeTagFilterList(parsed['tags'], noneTagFilterValue),
    excludedPlatform: normalizeStringList(parsed['excludedPlatform']),
    excludedGenres: normalizeStringList(parsed['excludedGenres']),
    excludedStatuses: normalizeGameStatusFilterList(parsed['excludedStatuses']).filter(
      (status) => status !== 'none'
    ),
    excludedTags: normalizeStringList(parsed['excludedTags']).filter(
      (tag) => tag !== noneTagFilterValue
    ),
    excludedGameTypes: normalizeGameTypeList(parsed['excludedGameTypes']),
    ratings: normalizeGameRatingFilterList(parsed['ratings']),
    hltbMainHoursMin:
      hltbMainHoursMin !== null && hltbMainHoursMax !== null && hltbMainHoursMin > hltbMainHoursMax
        ? hltbMainHoursMax
        : hltbMainHoursMin,
    hltbMainHoursMax:
      hltbMainHoursMin !== null && hltbMainHoursMax !== null && hltbMainHoursMin > hltbMainHoursMax
        ? hltbMainHoursMin
        : hltbMainHoursMax,
    releaseDateFrom: normalizeDateOnly(parsed['releaseDateFrom']),
    releaseDateTo: normalizeDateOnly(parsed['releaseDateTo'])
  };
}

export function parseListPagePreferences(
  rawValue: string | null,
  noneTagFilterValue: string
): ListPagePreferences | null {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (!isRecord(parsed)) {
      return null;
    }

    const filterSource = isRecord(parsed['filters']) ? parsed['filters'] : parsed;
    return {
      filters: normalizeListPageStoredFilters(filterSource, noneTagFilterValue),
      groupBy: normalizeListPageGroupBy(parsed['groupBy'])
    };
  } catch {
    return null;
  }
}

export function serializeListPagePreferences(value: ListPagePreferences): string {
  return JSON.stringify({
    filters: value.filters,
    groupBy: value.groupBy,
    // Keep legacy top-level fields for older clients that read the original shape.
    sortField: value.filters.sortField,
    sortDirection: value.filters.sortDirection
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidSortField(value: unknown): value is GameListFilters['sortField'] {
  return (
    value === 'title' ||
    value === 'releaseDate' ||
    value === 'createdAt' ||
    value === 'hltb' ||
    value === 'platform'
  );
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}
