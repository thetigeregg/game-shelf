import type { FastifyInstance } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';

interface PopularityGameRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  popularity_score: string | number;
  payload: unknown;
}

interface PopularityRouteOptions {
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

const ROUTE_RATE_LIMIT = {
  max: 50,
  timeWindow: '1 minute'
};

const FEED_ROW_LIMIT = 50;

export function registerPopularityRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: PopularityRouteOptions
): Promise<void> {
  app.route({
    method: 'GET',
    url: '/v1/games/trending',
    config: {
      rateLimit: ROUTE_RATE_LIMIT
    },
    handler: async (_request, reply) => {
      const items = await fetchFeedRows(pool, {
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'trending'
      });
      reply.send({ items });
    }
  });

  app.route({
    method: 'GET',
    url: '/v1/games/upcoming',
    config: {
      rateLimit: ROUTE_RATE_LIMIT
    },
    handler: async (_request, reply) => {
      const items = await fetchFeedRows(pool, {
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'upcoming'
      });
      reply.send({ items });
    }
  });

  app.route({
    method: 'GET',
    url: '/v1/games/recent',
    config: {
      rateLimit: ROUTE_RATE_LIMIT
    },
    handler: async (_request, reply) => {
      const items = await fetchFeedRows(pool, {
        scoreThreshold: options.threshold,
        nowSec: Math.trunc(Date.now() / 1000),
        feedType: 'recent'
      });
      reply.send({ items });
    }
  });

  return Promise.resolve();
}

async function fetchFeedRows(
  pool: Pool,
  params: {
    scoreThreshold: number;
    nowSec: number;
    feedType: 'trending' | 'upcoming' | 'recent';
  }
): Promise<PopularityFeedItem[]> {
  const nowSec = params.nowSec;
  const cutoffRecentSec = nowSec - 90 * 24 * 60 * 60;
  const firstReleaseDateSql = sqlFirstReleaseDatePayload();

  let feedWindowPredicate = 'TRUE';
  if (params.feedType === 'upcoming') {
    feedWindowPredicate = `${firstReleaseDateSql} IS NOT NULL AND ${firstReleaseDateSql} > $2`;
  } else if (params.feedType === 'recent') {
    feedWindowPredicate = `${firstReleaseDateSql} IS NOT NULL AND ${firstReleaseDateSql} > $3 AND ${firstReleaseDateSql} <= $2`;
  }

  const result = await pool.query<PopularityGameRow>(
    `
    SELECT
      igdb_game_id,
      platform_igdb_id,
      popularity_score,
      payload
    FROM games
    WHERE popularity_score > $1
      AND (
        ${sqlNumericPayload('total_rating_count')} >= 20
        OR ${sqlNumericPayload('totalRatingCount')} >= 20
        OR ${sqlNumericPayload('hypes')} >= 10
        OR ${sqlNumericPayload('follows')} >= 200
      )
      AND COALESCE(NULLIF(BTRIM(payload->>'parent_game'), ''), NULLIF(BTRIM(payload->>'parentGame'), '')) IS NULL
      AND COALESCE(NULLIF(BTRIM(payload->>'version_parent'), ''), NULLIF(BTRIM(payload->>'versionParent'), '')) IS NULL
      AND COALESCE(NULLIF(BTRIM(payload->>'gameType'), ''), 'main_game') = 'main_game'
      AND ${feedWindowPredicate}
    ORDER BY popularity_score DESC
    LIMIT $4
    `,
    [params.scoreThreshold, nowSec, cutoffRecentSec, FEED_ROW_LIMIT]
  );

  const items = result.rows
    .map((row) => toFeedItem(row))
    .filter((item): item is PopularityFeedItem => item !== null);

  return items;
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
    platforms
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

function sqlNumericPayload(field: string): string {
  return `CASE WHEN BTRIM(COALESCE(payload->>'${field}', '')) ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (BTRIM(payload->>'${field}'))::double precision ELSE 0 END`;
}

function sqlUnixPayload(field: string): string {
  return `CASE WHEN BTRIM(COALESCE(payload->>'${field}', '')) ~ '^\\d+$' THEN (BTRIM(payload->>'${field}'))::bigint ELSE NULL END`;
}

function sqlIsoDatePayload(field: string): string {
  return `CASE WHEN BTRIM(COALESCE(payload->>'${field}', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([Tt ][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})?)?$' AND pg_input_is_valid(BTRIM(payload->>'${field}'), 'timestamptz') THEN EXTRACT(EPOCH FROM (BTRIM(payload->>'${field}'))::timestamptz)::bigint ELSE NULL END`;
}

function sqlFirstReleaseDatePayload(): string {
  return `COALESCE(${sqlUnixPayload('first_release_date')}, ${sqlUnixPayload('firstReleaseDate')}, ${sqlIsoDatePayload('releaseDate')})`;
}
