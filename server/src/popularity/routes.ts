import type { FastifyInstance } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';

interface PopularityGameRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  popularity_score: string | number;
  payload: unknown;
}

interface PopularityRouteOptions {
  rowLimit: number;
  threshold: number;
}

interface PlatformOption {
  id: number;
  name: string;
}

interface PopularityFeedItem {
  id: string;
  platformIgdbId: number;
  name: string;
  coverUrl: string | null;
  rating: number | null;
  popularityScore: number;
  firstReleaseDate: number | null;
  platforms: PlatformOption[];
}

interface PopularityPageInfo {
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

const MAX_PAGE_LIMIT = 50;
const MAX_PAGE_OFFSET = 1000;

const ROUTE_RATE_LIMIT = {
  max: 50,
  timeWindow: '1 minute',
};

export function registerPopularityRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: PopularityRouteOptions
): Promise<void> {
  app.route({
    method: 'GET',
    url: '/v1/games/trending',
    config: {
      rateLimit: ROUTE_RATE_LIMIT,
    },
    handler: async (request, reply) => {
      const page = parsePageQuery(request.query);
      const items = await fetchFeedRows(pool, {
        rowLimit: options.rowLimit,
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'trending',
        offset: page.offset,
        limit: page.limit,
      });
      reply.send(items);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/games/upcoming',
    config: {
      rateLimit: ROUTE_RATE_LIMIT,
    },
    handler: async (request, reply) => {
      const page = parsePageQuery(request.query);
      const items = await fetchFeedRows(pool, {
        rowLimit: options.rowLimit,
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'upcoming',
        offset: page.offset,
        limit: page.limit,
      });
      reply.send(items);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/games/recent',
    config: {
      rateLimit: ROUTE_RATE_LIMIT,
    },
    handler: async (request, reply) => {
      const page = parsePageQuery(request.query);
      const items = await fetchFeedRows(pool, {
        rowLimit: options.rowLimit,
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'recent',
        offset: page.offset,
        limit: page.limit,
      });
      reply.send(items);
    },
  });

  return Promise.resolve();
}

async function fetchFeedRows(
  pool: Pool,
  params: {
    rowLimit: number;
    scoreThreshold: number;
    nowSec: number;
    feedType: 'trending' | 'upcoming' | 'recent';
    offset: number;
    limit: number;
  }
): Promise<{ items: PopularityFeedItem[]; page: PopularityPageInfo }> {
  const nowSec = params.nowSec;
  const cutoffRecentSec = nowSec - 90 * 24 * 60 * 60;
  const effectiveLimit = Math.min(params.limit, params.rowLimit);
  const queryLimit = effectiveLimit + 1;

  let limitPlaceholder = '$2';
  let offsetPlaceholder = '$3';
  let queryParams: number[] = [params.scoreThreshold];
  if (params.feedType === 'upcoming') {
    queryParams = [params.scoreThreshold, nowSec];
    limitPlaceholder = '$3';
    offsetPlaceholder = '$4';
  } else if (params.feedType === 'recent') {
    queryParams = [params.scoreThreshold, nowSec, cutoffRecentSec];
    limitPlaceholder = '$4';
    offsetPlaceholder = '$5';
  }

  queryParams.push(queryLimit, params.offset);
  const gameFeedWindowPredicate = sqlFeedWindowPredicate('g', params.feedType);

  const result = await pool.query<PopularityGameRow>(
    `
    WITH candidate_games AS (
      SELECT
        g.igdb_game_id,
        g.platform_igdb_id,
        g.popularity_score,
        g.payload
      FROM games g
      WHERE ${sqlFeedCandidatePredicate('g', gameFeedWindowPredicate)}
        AND NOT EXISTS (
          SELECT 1
          FROM games owned
          WHERE owned.igdb_game_id = g.igdb_game_id
            AND (owned.payload->>'listType') IN ('collection', 'wishlist')
        )
    )
    SELECT
      igdb_game_id,
      platform_igdb_id,
      popularity_score,
      payload
    FROM (
      SELECT DISTINCT ON (igdb_game_id)
        igdb_game_id,
        platform_igdb_id,
        popularity_score,
        payload
      FROM candidate_games
      ORDER BY igdb_game_id, popularity_score DESC, platform_igdb_id ASC
    ) deduped_games
    ORDER BY popularity_score DESC, igdb_game_id ASC, platform_igdb_id ASC
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
    `,
    queryParams
  );

  const normalized = result.rows
    .slice(0, effectiveLimit)
    .map((row) => toFeedItem(row))
    .filter((item): item is PopularityFeedItem => item !== null);
  const hasMore = result.rows.length > effectiveLimit;
  const items = normalized;

  return {
    items,
    page: {
      offset: params.offset,
      limit: effectiveLimit,
      hasMore,
      nextOffset: hasMore ? params.offset + effectiveLimit : null,
    },
  };
}

function toFeedItem(row: PopularityGameRow): PopularityFeedItem | null {
  const payload = normalizePayload(row.payload);
  if (!payload) {
    return null;
  }

  const score =
    typeof row.popularity_score === 'number'
      ? row.popularity_score
      : Number.parseFloat(row.popularity_score);

  if (!Number.isFinite(score)) {
    return null;
  }

  const name = firstString(payload, ['title', 'name']) ?? 'Unknown title';
  let platforms = normalizePlatformOptions(payload);
  if (
    platforms.length === 0 &&
    Number.isInteger(row.platform_igdb_id) &&
    row.platform_igdb_id > 0
  ) {
    const platformName = firstString(payload, ['platform', 'platformName']) ?? 'Unknown platform';
    // Backward compatibility for rows where payload platform fields are missing.
    platforms = [{ id: row.platform_igdb_id, name: platformName }];
  }

  return {
    id: row.igdb_game_id,
    platformIgdbId: row.platform_igdb_id,
    name,
    coverUrl: firstString(payload, ['coverUrl', 'cover_url']),
    rating: firstNumeric(payload, ['rating', 'reviewScore']),
    popularityScore: score,
    firstReleaseDate: normalizeFirstReleaseDate(payload),
    platforms,
  };
}

function normalizePayload(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizePlatformOptions(payload: Record<string, unknown>): PlatformOption[] {
  const options = payload.platformOptions;
  if (Array.isArray(options)) {
    const normalized = options
      .map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return null;
        }
        const item = value as Record<string, unknown>;
        const id =
          typeof item.id === 'number'
            ? Math.trunc(item.id)
            : typeof item.id === 'string'
              ? Number.parseInt(item.id, 10)
              : Number.NaN;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (!Number.isInteger(id) || id <= 0 || name.length === 0) {
          return null;
        }
        return { id, name };
      })
      .filter((value): value is PlatformOption => value !== null);

    if (normalized.length > 0) {
      return normalized;
    }
  }

  const platformName = firstString(payload, ['platform']);
  const platformId = firstNumeric(payload, ['platformIgdbId']);
  if (platformName && platformId && Number.isInteger(platformId) && platformId > 0) {
    return [{ id: platformId, name: platformName }];
  }

  return [];
}

function parsePageQuery(query: unknown): { offset: number; limit: number } {
  const record =
    typeof query === 'object' && query !== null ? (query as Record<string, unknown>) : {};
  const offset = Math.min(parseNonNegativeInteger(record['offset']) ?? 0, MAX_PAGE_OFFSET);
  const limit = Math.min(parsePositiveInteger(record['limit']) ?? 10, MAX_PAGE_LIMIT);
  return { offset, limit };
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }

    try {
      const parsed = BigInt(normalized);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
      }
      return Number(parsed);
    } catch {
      return null;
    }
  }

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }

  return null;
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function firstNumeric(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseFloat(value)
          : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeFirstReleaseDate(payload: Record<string, unknown>): number | null {
  const direct = firstNumeric(payload, ['first_release_date', 'firstReleaseDate']);
  if (direct !== null && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }

  const releaseDate = firstString(payload, ['releaseDate']);
  if (!releaseDate) {
    return null;
  }

  const timestampMs = Date.parse(releaseDate);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return Math.trunc(timestampMs / 1000);
}

function sqlNumericPayload(field: string, payloadRef = 'payload'): string {
  return sqlTypedNumericPayload(payloadRef, field);
}

function sqlTypedNumericPayload(payloadRef: string, field: string): string {
  return `CASE WHEN BTRIM(COALESCE(${payloadRef}->>'${field}', '')) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (BTRIM(${payloadRef}->>'${field}'))::double precision ELSE 0 END`;
}

function sqlFeedCandidatePredicate(alias: string, feedWindowPredicate: string): string {
  return `${alias}.popularity_score > $1
      AND (
        ${sqlNumericPayload('total_rating_count', `${alias}.payload`)} >= 20
        OR ${sqlNumericPayload('totalRatingCount', `${alias}.payload`)} >= 20
        OR ${sqlNumericPayload('hypes', `${alias}.payload`)} >= 10
        OR ${sqlNumericPayload('follows', `${alias}.payload`)} >= 200
      )
      AND COALESCE(NULLIF(BTRIM(${alias}.payload->>'parent_game'), ''), NULLIF(BTRIM(${alias}.payload->>'parentGame'), '')) IS NULL
      AND COALESCE(NULLIF(BTRIM(${alias}.payload->>'version_parent'), ''), NULLIF(BTRIM(${alias}.payload->>'versionParent'), '')) IS NULL
      AND COALESCE(NULLIF(BTRIM(${alias}.payload->>'gameType'), ''), 'main_game') = 'main_game'
      AND ${feedWindowPredicate}`;
}

function sqlFeedWindowPredicate(
  alias: string,
  feedType: 'trending' | 'upcoming' | 'recent'
): string {
  const firstReleaseDateSql = sqlFirstReleaseDatePayload(`${alias}.payload`);

  if (feedType === 'upcoming') {
    return `${firstReleaseDateSql} IS NOT NULL AND ${firstReleaseDateSql} > $2`;
  }

  if (feedType === 'recent') {
    return `${firstReleaseDateSql} IS NOT NULL AND ${firstReleaseDateSql} > $3 AND ${firstReleaseDateSql} <= $2`;
  }

  return 'TRUE';
}

function sqlUnixPayload(payloadRef: string, field: string): string {
  return `CASE WHEN BTRIM(COALESCE(${payloadRef}->>'${field}', '')) ~ '^\\d+$' THEN (BTRIM(${payloadRef}->>'${field}'))::bigint ELSE NULL END`;
}

function sqlIsoDatePayload(payloadRef: string, field: string): string {
  return `CASE WHEN BTRIM(COALESCE(${payloadRef}->>'${field}', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})?)?$' AND pg_input_is_valid(BTRIM(${payloadRef}->>'${field}'), 'timestamptz') THEN EXTRACT(EPOCH FROM (BTRIM(${payloadRef}->>'${field}'))::timestamptz)::bigint ELSE NULL END`;
}

function sqlFirstReleaseDatePayload(payloadRef = 'payload'): string {
  return `COALESCE(${sqlUnixPayload(payloadRef, 'first_release_date')}, ${sqlUnixPayload(payloadRef, 'firstReleaseDate')}, ${sqlIsoDatePayload(payloadRef, 'releaseDate')})`;
}
