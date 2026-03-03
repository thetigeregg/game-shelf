import { NormalizedGameRecord, TokenEntry, TokenFamily } from './types.js';

interface DbGameRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
}

const TOKEN_FAMILIES: TokenFamily[] = [
  'genres',
  'themes',
  'developers',
  'publishers',
  'franchises',
  'collections'
];

export function normalizeDbGameRow(row: DbGameRow): NormalizedGameRecord | null {
  const payload = normalizeObject(row.payload);

  if (!payload) {
    return null;
  }

  const listType = normalizeListType(payload['listType']);

  if (!listType) {
    return null;
  }

  const igdbGameId = normalizeNonEmptyString(payload['igdbGameId']) ?? row.igdb_game_id.trim();
  const platformIgdbId =
    normalizePositiveInteger(payload['platformIgdbId']) ?? row.platform_igdb_id;

  if (!igdbGameId || !platformIgdbId) {
    return null;
  }

  const reviewSource = normalizeReviewSource(payload['reviewSource']);

  return {
    igdbGameId,
    platformIgdbId,
    title: normalizeNonEmptyString(payload['title']) ?? igdbGameId,
    listType,
    status: normalizeStatus(payload['status']),
    rating: normalizeRating(payload['rating']),
    createdAt: normalizeIsoDate(payload['createdAt']),
    updatedAt: normalizeIsoDate(payload['updatedAt']),
    releaseYear: normalizeReleaseYear(payload['releaseYear']),
    runtimeHours: normalizeRuntimeHours(payload),
    summary: normalizeNonEmptyString(payload['summary']),
    storyline: normalizeNonEmptyString(payload['storyline']),
    reviewScore: normalizeFiniteNumber(payload['reviewScore']),
    reviewSource,
    metacriticScore: normalizeFiniteNumber(payload['metacriticScore']),
    mobyScore: normalizeFiniteNumber(payload['mobyScore']),
    genres: normalizeStringArray(payload['genres']),
    themes: normalizeStringArray(payload['themes']),
    keywords: normalizeStringArray(payload['keywords']),
    developers: normalizeStringArray(payload['developers']),
    publishers: normalizeStringArray(payload['publishers']),
    franchises: normalizeStringArray(payload['franchises']),
    collections: normalizeStringArray(payload['collections'])
  };
}

export function buildTokenEntries(
  game: NormalizedGameRecord,
  options: { structuredKeywordsByGame?: Map<string, string[]> } = {}
): TokenEntry[] {
  const entries: TokenEntry[] = [];

  for (const family of TOKEN_FAMILIES) {
    const values = game[family];

    for (const raw of values) {
      const label = raw.trim();
      const key = normalizeTokenKey(label);

      if (!key) {
        continue;
      }

      entries.push({
        family,
        key: `${family}:${key}`,
        label
      });
    }
  }

  const gameKey = `${game.igdbGameId}::${String(game.platformIgdbId)}`;
  const keywords = options.structuredKeywordsByGame?.get(gameKey) ?? game.keywords;

  for (const raw of keywords) {
    const label = raw.trim();
    const key = normalizeTokenKey(label);

    if (!key) {
      continue;
    }

    entries.push({
      family: 'keywords',
      key: `keywords:${key}`,
      label
    });
  }

  return dedupeTokenEntries(entries);
}

export function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeTokenEntries(tokens: TokenEntry[]): TokenEntry[] {
  const seen = new Set<string>();
  const result: TokenEntry[] = [];

  for (const token of tokens) {
    if (seen.has(token.key)) {
      continue;
    }

    seen.add(token.key);
    result.push(token);
  }

  return result;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeListType(value: unknown): 'collection' | 'wishlist' | 'discovery' | null {
  return value === 'collection' || value === 'wishlist' || value === 'discovery' ? value : null;
}

function normalizeStatus(value: unknown): NormalizedGameRecord['status'] {
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

function normalizeReviewSource(value: unknown): NormalizedGameRecord['reviewSource'] {
  if (value === 'metacritic' || value === 'mobygames') {
    return value;
  }

  return null;
}

function normalizeRating(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  const stepped = Math.round(value * 2) / 2;

  if (stepped < 1 || stepped > 5) {
    return null;
  }

  return stepped;
}

function normalizeReleaseYear(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }

  if (value < 1970 || value > 2200) {
    return null;
  }

  return value;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function normalizeRuntimeHours(payload: Record<string, unknown>): number | null {
  const candidates = [
    normalizeFiniteNumber(payload['hltbMainHours']),
    normalizeFiniteNumber(payload['hltbMainExtraHours']),
    normalizeFiniteNumber(payload['hltbCompletionistHours'])
  ];

  for (const value of candidates) {
    if (value !== null && value > 0) {
      return value;
    }
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0)
    )
  ];
}
