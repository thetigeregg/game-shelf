import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { MetadataEnrichmentGameRow } from './types.js';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

interface MissingRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
  is_periodic_refresh: boolean;
}

const METADATA_ENRICHMENT_LOCK_NAMESPACE = 77302;
const METADATA_ENRICHMENT_LOCK_KEY = 1;

function mapMissingRow(row: MissingRow): MetadataEnrichmentGameRow {
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    igdbGameId: row.igdb_game_id,
    platformIgdbId: row.platform_igdb_id,
    payload,
    isPeriodicRefresh: row.is_periodic_refresh,
  };
}

export class MetadataEnrichmentRepository {
  constructor(private readonly pool: Pool) {}

  async withAdvisoryLock<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await this.pool.connect();

    try {
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [METADATA_ENRICHMENT_LOCK_NAMESPACE, METADATA_ENRICHMENT_LOCK_KEY]
      );

      if (!(lockResult.rows[0]?.acquired ?? false)) {
        return { acquired: false };
      }

      const value = await callback(client);
      return { acquired: true, value };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [
        METADATA_ENRICHMENT_LOCK_NAMESPACE,
        METADATA_ENRICHMENT_LOCK_KEY,
      ]);
      client.release();
    }
  }

  async listRowsMissingMetadata(params: {
    limit: number;
    refreshMonths?: number;
    refreshDays?: number;
    queryable?: Queryable;
    force?: boolean;
  }): Promise<MetadataEnrichmentGameRow[]> {
    const { limit, refreshMonths, refreshDays, queryable = this.pool, force = false } = params;
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 1;

    if (force) {
      const forcedResult = await queryable.query<MissingRow>(
        `
        SELECT igdb_game_id, platform_igdb_id, payload, TRUE AS is_periodic_refresh
        FROM games
        WHERE COALESCE(payload ->> 'listType', '') IN ('collection', 'wishlist')
        ORDER BY igdb_game_id ASC, platform_igdb_id ASC
        LIMIT $1
        `,
        [normalizedLimit]
      );
      return forcedResult.rows.map(mapMissingRow);
    }

    const result = await queryable.query<MissingRow>(
      `
      WITH candidates AS (
        SELECT igdb_game_id, platform_igdb_id, payload,
          CASE WHEN
            $2 > 0 AND $3 > 0
            AND COALESCE(NULLIF(payload ->> 'taxonomyEnrichedAt', ''), '') <> ''
            AND COALESCE(NULLIF(payload ->> 'mediaEnrichedAt', ''), '') <> ''
            AND COALESCE(NULLIF(payload ->> 'steamEnrichedAt', ''), '') <> ''
            AND COALESCE(NULLIF(payload ->> 'websitesEnrichedAt', ''), '') <> ''
            AND COALESCE(NULLIF(payload ->> 'releaseDate', ''), '') <> ''
            AND payload ->> 'releaseDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
            AND CASE WHEN pg_input_is_valid(LEFT(payload ->> 'releaseDate', 10), 'date')
                  THEN LEFT(payload ->> 'releaseDate', 10)::date <= CURRENT_DATE
                  ELSE FALSE END
            AND CASE WHEN pg_input_is_valid(LEFT(payload ->> 'releaseDate', 10), 'date')
                  THEN LEFT(payload ->> 'releaseDate', 10)::date >= CURRENT_DATE - ($2 * INTERVAL '1 month')
                  ELSE FALSE END
            AND payload ->> 'taxonomyEnrichedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
            AND CASE WHEN pg_input_is_valid(payload ->> 'taxonomyEnrichedAt', 'timestamptz')
                  THEN (payload ->> 'taxonomyEnrichedAt')::timestamptz <= NOW() - ($3 * INTERVAL '1 day')
                  ELSE FALSE END
          THEN TRUE ELSE FALSE END AS is_periodic_refresh
        FROM games
        -- Intentionally excludes discovery rows: those are enriched by
        -- recommendations/discovery-enrichment-service.ts.
        WHERE COALESCE(payload ->> 'listType', '') IN ('collection', 'wishlist')
      )
      SELECT igdb_game_id, platform_igdb_id, payload, is_periodic_refresh
      FROM candidates
      WHERE
        -- Arm 1: initial enrichment (any timestamp still blank)
        (
          COALESCE(NULLIF(payload ->> 'taxonomyEnrichedAt', ''), '') = ''
          OR COALESCE(NULLIF(payload ->> 'mediaEnrichedAt', ''), '') = ''
          OR COALESCE(NULLIF(payload ->> 'steamEnrichedAt', ''), '') = ''
          OR (
            COALESCE(NULLIF(payload ->> 'websitesEnrichedAt', ''), '') = ''
            AND (
              NOT (payload ? 'websites')
              OR jsonb_array_length(CASE WHEN jsonb_typeof(payload -> 'websites') = 'array' THEN payload -> 'websites' ELSE '[]'::jsonb END) = 0
            )
          )
          OR COALESCE(NULLIF(payload ->> 'metadataSyncEnqueuedAt', ''), '') = ''
        )
        -- Arm 2: periodic re-enrichment for recently released games
        OR is_periodic_refresh
      ORDER BY igdb_game_id ASC, platform_igdb_id ASC
      LIMIT $1
      `,
      [normalizedLimit, refreshMonths ?? 0, refreshDays ?? 0]
    );

    return result.rows.map(mapMissingRow);
  }

  async updateGamePayload(params: {
    igdbGameId: string;
    platformIgdbId: number;
    payloadPatch: Record<string, unknown>;
    client?: Queryable;
  }): Promise<void> {
    await (params.client ?? this.pool).query(
      `
      WITH updated AS (
        UPDATE games
        SET payload = games.payload || $3::jsonb, updated_at = NOW()
        WHERE igdb_game_id = $1
          AND platform_igdb_id = $2
          AND payload IS DISTINCT FROM (games.payload || $3::jsonb)
        RETURNING igdb_game_id, platform_igdb_id, payload
      )
      INSERT INTO sync_events (entity_type, entity_key, operation, payload, server_timestamp)
      SELECT
        'game',
        updated.igdb_game_id || '::' || updated.platform_igdb_id::text,
        'upsert',
        updated.payload,
        NOW()
      FROM updated
      `,
      [params.igdbGameId, params.platformIgdbId, JSON.stringify(params.payloadPatch)]
    );
  }
}
