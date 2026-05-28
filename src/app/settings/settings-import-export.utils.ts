import { isGameRating } from '../core/models/game.models';
import type {
  GameCatalogResult,
  GameEntry,
  GameGroupByField,
  GameListFilters,
  GameRating,
  GameStatus,
  ListType,
  Tag,
} from '../core/models/game.models';
import { isTasFeatureEnabled } from '../core/config/runtime-config';
import { sanitizeExternalHttpUrlString } from '../core/utils/url-host.util';
import { normalizeTagIds } from '../features/game-list/game-list-detail-actions';

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
  'update',
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
      ),
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
      ),
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

export function parseOptionalCustomCoverUrl(raw: string): string | null {
  const normalized = raw.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
    return normalized;
  }

  if (/^(https?:\/\/|\/\/)/i.test(normalized)) {
    return sanitizeExternalHttpUrlString(normalized);
  }

  return null;
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
      ),
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

  const parsed = Number.parseFloat(normalized);

  if (isGameRating(parsed)) {
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

export function parseFilters(
  raw: string,
  defaultFilters: GameListFilters,
  options?: { listType?: ListType | null }
): GameListFilters | null {
  if (raw.trim().length === 0) {
    return { ...defaultFilters };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GameListFilters>;
    const allowPriceSort = options?.listType === 'wishlist';
    const allowPtasSort = allowPriceSort && isTasFeatureEnabled();
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
        ? parsed.ratings
            .map((value) => (value === 'none' ? 'none' : normalizeRating(String(value))))
            .filter((value): value is GameRating | 'none' => value === 'none' || value !== null)
        : [],
      sortField:
        parsed.sortField === 'title' ||
        parsed.sortField === 'releaseDate' ||
        parsed.sortField === 'createdAt' ||
        parsed.sortField === 'hltb' ||
        (parsed.sortField === 'tas' && isTasFeatureEnabled()) ||
        (parsed.sortField === 'ptas' && allowPtasSort) ||
        (parsed.sortField === 'price' && allowPriceSort) ||
        parsed.sortField === 'review' ||
        parsed.sortField === 'metacritic' ||
        parsed.sortField === 'platform'
          ? parsed.sortField === 'metacritic'
            ? 'review'
            : parsed.sortField
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
      releaseDateTo: typeof parsed.releaseDateTo === 'string' ? parsed.releaseDateTo : null,
    };
  } catch {
    return null;
  }
}

export type ExportRowType = 'game' | 'tag' | 'view' | 'setting';

export interface ExportCsvRow {
  type: ExportRowType;
  listType: string;
  igdbGameId: string;
  platformIgdbId: string;
  title: string;
  customTitle: string;
  summary: string;
  storyline: string;
  notes: string;
  coverUrl: string;
  customCoverUrl: string;
  coverSource: string;
  gameType: string;
  platform: string;
  customPlatform: string;
  customPlatformIgdbId: string;
  collections: string;
  releaseDate: string;
  releaseYear: string;
  hltbMainHours: string;
  hltbMainExtraHours: string;
  hltbCompletionistHours: string;
  reviewScore: string;
  reviewUrl: string;
  reviewSource: string;
  mobyScore: string;
  mobygamesGameId: string;
  metacriticScore: string;
  metacriticUrl: string;
  similarGameIgdbIds: string;
  status: string;
  rating: string;
  developers: string;
  franchises: string;
  genres: string;
  publishers: string;
  tags: string;
  gameTagIds: string;
  tagId: string;
  name: string;
  color: string;
  groupBy: string;
  filters: string;
  key: string;
  value: string;
  enteredCollectionAt: string;
  createdAt: string;
  updatedAt: string;
}

export const CSV_HEADERS: Array<keyof ExportCsvRow> = [
  'type',
  'listType',
  'igdbGameId',
  'platformIgdbId',
  'title',
  'customTitle',
  'summary',
  'storyline',
  'notes',
  'coverUrl',
  'customCoverUrl',
  'coverSource',
  'gameType',
  'platform',
  'customPlatform',
  'customPlatformIgdbId',
  'collections',
  'releaseDate',
  'releaseYear',
  'hltbMainHours',
  'hltbMainExtraHours',
  'hltbCompletionistHours',
  'reviewScore',
  'reviewUrl',
  'reviewSource',
  'mobyScore',
  'mobygamesGameId',
  'metacriticScore',
  'metacriticUrl',
  'similarGameIgdbIds',
  'status',
  'rating',
  'developers',
  'franchises',
  'genres',
  'publishers',
  'tags',
  'gameTagIds',
  'tagId',
  'name',
  'color',
  'groupBy',
  'filters',
  'key',
  'value',
  'enteredCollectionAt',
  'createdAt',
  'updatedAt',
];

export const REQUIRED_CSV_HEADERS: Array<keyof ExportCsvRow> = [
  'type',
  'listType',
  'igdbGameId',
  'platformIgdbId',
  'title',
  'platform',
  'releaseDate',
  'releaseYear',
  'status',
  'rating',
  'developers',
  'franchises',
  'genres',
  'publishers',
  'tags',
  'name',
  'color',
  'groupBy',
  'filters',
  'key',
  'value',
  'createdAt',
  'updatedAt',
];

export function buildTagByIdMap(tags: Tag[]): Map<number, Tag> {
  const tagById = new Map<number, Tag>();

  tags.forEach((tag) => {
    if (typeof tag.id === 'number' && tag.id > 0) {
      tagById.set(tag.id, tag);
    }
  });

  return tagById;
}

export function mapGameEntryToExportRow(game: GameEntry, tagById: Map<number, Tag>): ExportCsvRow {
  const normalizedTagIds = normalizeTagIds(game.tagIds);
  const tagNames = normalizedTagIds
    .map((tagId) => tagById.get(tagId)?.name)
    .filter((name): name is string => typeof name === 'string' && name.length > 0);

  return {
    type: 'game',
    listType: game.listType,
    igdbGameId: game.igdbGameId,
    platformIgdbId: String(game.platformIgdbId),
    title: game.title,
    customTitle: game.customTitle ?? '',
    summary: game.summary ?? '',
    storyline: game.storyline ?? '',
    notes: game.notes ?? '',
    coverUrl: game.coverUrl ?? '',
    customCoverUrl: game.customCoverUrl ?? '',
    coverSource: game.coverSource,
    gameType: game.gameType ?? '',
    platform: game.platform,
    customPlatform: game.customPlatform ?? '',
    customPlatformIgdbId:
      game.customPlatformIgdbId !== null && game.customPlatformIgdbId !== undefined
        ? String(game.customPlatformIgdbId)
        : '',
    collections: JSON.stringify(game.collections ?? []),
    releaseDate: game.releaseDate ?? '',
    releaseYear: game.releaseYear !== null ? String(game.releaseYear) : '',
    hltbMainHours:
      game.hltbMainHours !== null && game.hltbMainHours !== undefined
        ? String(game.hltbMainHours)
        : '',
    hltbMainExtraHours:
      game.hltbMainExtraHours !== null && game.hltbMainExtraHours !== undefined
        ? String(game.hltbMainExtraHours)
        : '',
    hltbCompletionistHours:
      game.hltbCompletionistHours !== null && game.hltbCompletionistHours !== undefined
        ? String(game.hltbCompletionistHours)
        : '',
    reviewScore:
      game.reviewScore !== null && game.reviewScore !== undefined
        ? String(game.reviewScore)
        : game.metacriticScore !== null && game.metacriticScore !== undefined
          ? String(game.metacriticScore)
          : '',
    reviewUrl: game.reviewUrl ?? game.metacriticUrl ?? '',
    reviewSource: game.reviewSource ?? '',
    mobyScore:
      game.mobyScore !== null && game.mobyScore !== undefined ? String(game.mobyScore) : '',
    mobygamesGameId:
      game.mobygamesGameId !== null && game.mobygamesGameId !== undefined
        ? String(game.mobygamesGameId)
        : '',
    metacriticScore:
      game.metacriticScore !== null && game.metacriticScore !== undefined
        ? String(game.metacriticScore)
        : '',
    metacriticUrl: game.metacriticUrl ?? '',
    similarGameIgdbIds: JSON.stringify(game.similarGameIgdbIds ?? []),
    status: game.status ?? '',
    rating: game.rating !== null && game.rating !== undefined ? String(game.rating) : '',
    developers: JSON.stringify(game.developers ?? []),
    franchises: JSON.stringify(game.franchises ?? []),
    genres: JSON.stringify(game.genres ?? []),
    publishers: JSON.stringify(game.publishers ?? []),
    tags: JSON.stringify(tagNames),
    gameTagIds: JSON.stringify(normalizedTagIds),
    tagId: '',
    name: '',
    color: '',
    groupBy: '',
    filters: '',
    key: '',
    value: '',
    enteredCollectionAt: game.enteredCollectionAt ?? '',
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

export function serializeExportCsvRows(rows: ExportCsvRow[]): string {
  const lines = [
    CSV_HEADERS.join(','),
    ...rows.map((row) => CSV_HEADERS.map((header) => escapeCsvValue(row[header])).join(',')),
  ];

  return lines.join('\n');
}

export function buildGamesExportCsv(games: GameEntry[], tags: Tag[]): string {
  const tagById = buildTagByIdMap(tags);
  const rows = games.map((game) => mapGameEntryToExportRow(game, tagById));

  return serializeExportCsvRows(rows);
}
