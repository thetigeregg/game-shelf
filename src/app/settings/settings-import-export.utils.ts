import type {
  GameCatalogResult,
  GameGroupByField,
  GameListFilters,
  GameRating,
  GameStatus,
  ListType
} from '../core/models/game.models';

const VALID_GAME_TYPES: Array<NonNullable<GameCatalogResult['gameType']>> = [
  'main_game',
  'dlc_addon',
  'expansion',
  'bundle',
  'standalone_expansion',
  'mod',
  'episode',
  'season',
  'remake',
  'remaster',
  'expanded_game',
  'port',
  'fork',
  'pack',
  'update'
];

export function parseStringArray(raw: string): string[] {
  if (raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)
      )
    ];
  } catch {
    return [];
  }
}

export function parseGameIdArray(raw: string): string[] {
  if (raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed.map((value) => String(value ?? '').trim()).filter((value) => /^\d+$/.test(value))
      )
    ];
  } catch {
    return [];
  }
}

export function parseOptionalText(raw: string): string | null {
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseOptionalDataImage(raw: string): string | null {
  const normalized = raw.trim();

  if (normalized.length === 0) {
    return null;
  }

  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ? normalized : null;
}

export function parseOptionalGameType(raw: string): GameCatalogResult['gameType'] {
  const normalized = raw.trim().toLowerCase();

  if (normalized.length === 0) {
    return null;
  }

  if (VALID_GAME_TYPES.includes(normalized as NonNullable<GameCatalogResult['gameType']>)) {
    return normalized as NonNullable<GameCatalogResult['gameType']>;
  }

  return null;
}

export function parseOptionalNumber(value: string): number | null {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function parseOptionalDecimal(value: string): number | null {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parsePositiveIntegerArray(raw: string): number[] {
  if (raw.trim().length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return [
      ...new Set(
        parsed
          .map((value) => Number.parseInt(String(value), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    ];
  } catch {
    return [];
  }
}

export function normalizeListType(value: string): ListType | null {
  return value === 'collection' || value === 'wishlist' ? value : null;
}

export function normalizeGroupBy(value: string): GameGroupByField | null {
  if (
    value === 'none' ||
    value === 'platform' ||
    value === 'developer' ||
    value === 'franchise' ||
    value === 'collection' ||
    value === 'tag' ||
    value === 'genre' ||
    value === 'publisher' ||
    value === 'releaseYear'
  ) {
    return value;
  }

  return null;
}

export function normalizeStatus(value: string): GameStatus | null {
  if (
    value === 'completed' ||
    value === 'dropped' ||
    value === 'playing' ||
    value === 'paused' ||
    value === 'replay' ||
    value === 'wantToPlay'
  ) {
    return value;
  }

  return null;
}

export function normalizeRating(value: string): GameRating | null {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (parsed === 1 || parsed === 2 || parsed === 3 || parsed === 4 || parsed === 5) {
    return parsed;
  }

  return null;
}

export function normalizeCoverSource(value: string): 'thegamesdb' | 'igdb' | 'none' {
  if (value === 'thegamesdb' || value === 'igdb' || value === 'none') {
    return value;
  }

  return 'none';
}

export function normalizeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : '#3880ff';
}

export function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function parseFilters(raw: string, defaultFilters: GameListFilters): GameListFilters | null {
  if (raw.trim().length === 0) {
    return { ...defaultFilters };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameListFilters>;
    const parsedHltbMainHoursMin =
      typeof parsed.hltbMainHoursMin === 'number' &&
      Number.isFinite(parsed.hltbMainHoursMin) &&
      parsed.hltbMainHoursMin >= 0
        ? Math.round(parsed.hltbMainHoursMin * 10) / 10
        : null;
    const parsedHltbMainHoursMax =
      typeof parsed.hltbMainHoursMax === 'number' &&
      Number.isFinite(parsed.hltbMainHoursMax) &&
      parsed.hltbMainHoursMax >= 0
        ? Math.round(parsed.hltbMainHoursMax * 10) / 10
        : null;

    return {
      ...defaultFilters,
      ...parsed,
      platform: Array.isArray(parsed.platform)
        ? parsed.platform.filter((value) => typeof value === 'string')
        : [],
      collections: Array.isArray(parsed.collections)
        ? parsed.collections.filter((value) => typeof value === 'string')
        : [],
      developers: Array.isArray(parsed.developers)
        ? parsed.developers.filter((value) => typeof value === 'string')
        : [],
      franchises: Array.isArray(parsed.franchises)
        ? parsed.franchises.filter((value) => typeof value === 'string')
        : [],
      publishers: Array.isArray(parsed.publishers)
        ? parsed.publishers.filter((value) => typeof value === 'string')
        : [],
      gameTypes: Array.isArray(parsed.gameTypes)
        ? parsed.gameTypes.filter((value) =>
            VALID_GAME_TYPES.includes(value as NonNullable<GameCatalogResult['gameType']>)
          )
        : [],
      genres: Array.isArray(parsed.genres)
        ? parsed.genres.filter((value) => typeof value === 'string')
        : [],
      statuses: Array.isArray(parsed.statuses)
        ? parsed.statuses.filter(
            (value) =>
              value === 'none' ||
              value === 'playing' ||
              value === 'wantToPlay' ||
              value === 'completed' ||
              value === 'paused' ||
              value === 'dropped' ||
              normalizeStatus(value) === 'replay'
          )
        : [],
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((value) => typeof value === 'string')
        : [],
      excludedPlatform: Array.isArray(parsed.excludedPlatform)
        ? parsed.excludedPlatform.filter((value) => typeof value === 'string')
        : [],
      excludedGenres: Array.isArray(parsed.excludedGenres)
        ? parsed.excludedGenres.filter((value) => typeof value === 'string')
        : [],
      excludedStatuses: Array.isArray(parsed.excludedStatuses)
        ? parsed.excludedStatuses.filter(
            (value) =>
              value === 'playing' ||
              value === 'wantToPlay' ||
              value === 'completed' ||
              value === 'paused' ||
              value === 'dropped' ||
              normalizeStatus(value) === 'replay'
          )
        : [],
      excludedTags: Array.isArray(parsed.excludedTags)
        ? parsed.excludedTags.filter((value) => typeof value === 'string' && value !== '__none__')
        : [],
      excludedGameTypes: Array.isArray(parsed.excludedGameTypes)
        ? parsed.excludedGameTypes.filter((value) =>
            VALID_GAME_TYPES.includes(value as NonNullable<GameCatalogResult['gameType']>)
          )
        : [],
      ratings: Array.isArray(parsed.ratings)
        ? parsed.ratings.filter(
            (value) =>
              value === 'none' ||
              value === 1 ||
              value === 2 ||
              value === 3 ||
              value === 4 ||
              normalizeRating(String(value)) === 5
          )
        : [],
      sortField:
        parsed.sortField === 'title' ||
        parsed.sortField === 'releaseDate' ||
        parsed.sortField === 'createdAt' ||
        parsed.sortField === 'hltb' ||
        parsed.sortField === 'platform'
          ? parsed.sortField
          : defaultFilters.sortField,
      sortDirection: parsed.sortDirection === 'desc' ? 'desc' : 'asc',
      hltbMainHoursMin:
        parsedHltbMainHoursMin !== null &&
        parsedHltbMainHoursMax !== null &&
        parsedHltbMainHoursMin > parsedHltbMainHoursMax
          ? parsedHltbMainHoursMax
          : parsedHltbMainHoursMin,
      hltbMainHoursMax:
        parsedHltbMainHoursMin !== null &&
        parsedHltbMainHoursMax !== null &&
        parsedHltbMainHoursMin > parsedHltbMainHoursMax
          ? parsedHltbMainHoursMin
          : parsedHltbMainHoursMax,
      releaseDateFrom: typeof parsed.releaseDateFrom === 'string' ? parsed.releaseDateFrom : null,
      releaseDateTo: typeof parsed.releaseDateTo === 'string' ? parsed.releaseDateTo : null
    };
  } catch {
    return null;
  }
}
