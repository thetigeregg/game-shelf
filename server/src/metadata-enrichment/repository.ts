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
}

const METADATA_ENRICHMENT_LOCK_NAMESPACE = 77302;
const METADATA_ENRICHMENT_LOCK_KEY = 1;

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
        METADATA_ENRICHMENT_LOCK_KEY
      ]);
      client.release();
    }
  }

  async listRowsMissingMetadata(
    limit: number,
    queryable: Queryable = this.pool
  ): Promise<MetadataEnrichmentGameRow[]> {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 1;
    const result = await queryable.query<MissingRow>(
      `
      SELECT igdb_game_id, platform_igdb_id, payload
      FROM games
      WHERE
        COALESCE(payload ->> 'listType', '') = 'wishlist'
        AND (
          COALESCE(NULLIF(payload ->> 'taxonomyEnrichedAt', ''), '') = ''
          OR COALESCE(NULLIF(payload ->> 'mediaEnrichedAt', ''), '') = ''
          OR COALESCE(NULLIF(payload ->> 'steamEnrichedAt', ''), '') = ''
          OR COALESCE(NULLIF(payload ->> 'metadataSyncEnqueuedAt', ''), '') = ''
        )
      ORDER BY igdb_game_id ASC, platform_igdb_id ASC
      LIMIT $1
      `,
      [normalizedLimit]
    );

    return result.rows.map((row) => ({
      igdbGameId: row.igdb_game_id,
      platformIgdbId: row.platform_igdb_id,
      payload:
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {}
    }));
  }

  async updateGamePayload(params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    client?: Queryable;
  }): Promise<void> {
    await (params.client ?? this.pool).query(
      `
      WITH updated AS (
        UPDATE games
        SET payload = $3::jsonb, updated_at = NOW()
        WHERE igdb_game_id = $1
          AND platform_igdb_id = $2
          AND payload IS DISTINCT FROM $3::jsonb
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
      [params.igdbGameId, params.platformIgdbId, JSON.stringify(params.payload)]
    );
  }
}
