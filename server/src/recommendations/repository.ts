import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { BackgroundJobRepository } from '../background-jobs.js';
import {
  buildDiscoveryEnrichmentSelectionParams,
  LIST_DISCOVERY_ROWS_MISSING_ENRICHMENT_SQL
} from './discovery-enrichment-query.js';
import type { DiscoveryEnrichmentSelectionOptions } from './discovery-enrichment-query.js';
import { normalizeDbGameRow } from './normalize.js';
import { parseRecommendationRuntimeMode } from './runtime.js';
import { buildGameKey } from './semantic.js';
import {
  GameEmbeddingUpsertInput,
  GameStatus,
  NormalizedGameRecord,
  RecommendationRebuildQueueReason,
  RankedRecommendationItem,
  RecommendationHistoryEntry,
  RecommendationLaneCollection,
  RecommendationLaneKey,
  RecommendationRunSummary,
  RecommendationRuntimeMode,
  RecommendationScoreComponents,
  RecommendationTarget,
  SimilarityEdge,
  StoredGameEmbedding
} from './types.js';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

interface RecommendationRow extends QueryResultRow {
  rank: number;
  igdb_game_id: string;
  platform_igdb_id: number;
  score_total: string | number;
  score_components: RecommendationScoreComponents;
  explanations: RankedRecommendationItem['explanations'];
}

interface LaneRow extends QueryResultRow {
  lane: RecommendationLaneKey;
  rank: number;
  igdb_game_id: string;
  platform_igdb_id: number;
  score_total: string | number;
  score_components: RecommendationScoreComponents;
  explanations: RankedRecommendationItem['explanations'];
}

interface RunRow extends QueryResultRow {
  id: number;
  target: RecommendationTarget;
  status: RecommendationRunSummary['status'];
  settings_hash: string;
  input_hash: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface SimilarityRow extends QueryResultRow {
  similar_igdb_game_id: string;
  similar_platform_igdb_id: number;
  similarity: string | number;
  reasons: SimilarityEdge['reasons'];
}

interface EmbeddingRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  embedding: string | number[];
  embedding_model: string;
  source_hash: string;
  created_at: string;
  updated_at: string;
}

interface HistoryRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  recommendation_count: number;
  last_recommended_at: string;
}

interface DiscoveryUpdatedAtRow extends QueryResultRow {
  updated_at: string;
}
interface SettingRow extends QueryResultRow {
  setting_value: string;
}

interface DiscoveryGameRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
}

const RECOMMENDATION_LOCK_NAMESPACE = 77191;

export class RecommendationRepository {
  private readonly backgroundJobs: BackgroundJobRepository;
  private static readonly RECOMMENDATIONS_INSERT_BATCH_SIZE = 500;
  private static readonly RECOMMENDATION_LANES_INSERT_BATCH_SIZE = 500;
  private static readonly RECOMMENDATION_HISTORY_UPSERT_BATCH_SIZE = 500;
  private static readonly SIMILARITY_INSERT_BATCH_SIZE = 500;

  constructor(private readonly pool: Pool) {
    this.backgroundJobs = new BackgroundJobRepository(pool);
  }

  async withAdvisoryLock<T>(params: {
    namespace: number;
    key: number;
    callback: (client: PoolClient) => Promise<T>;
  }): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await this.pool.connect();
    let acquired = false;

    try {
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [params.namespace, params.key]
      );

      acquired = lockResult.rows[0]?.acquired ?? false;

      if (!acquired) {
        return { acquired: false };
      }

      const value = await params.callback(client);
      return { acquired: true, value };
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [params.namespace, params.key]);
      }
      client.release();
    }
  }

  async withTargetLock<T>(
    target: RecommendationTarget,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const targetKey = target === 'BACKLOG' ? 1 : target === 'WISHLIST' ? 2 : 3;
    return this.withAdvisoryLock({
      namespace: RECOMMENDATION_LOCK_NAMESPACE,
      key: targetKey,
      callback
    });
  }

  async getDiscoveryPoolLatestUpdatedAt(
    params: {
      queryable?: Queryable;
      source?: 'popular' | 'recent';
    } = {}
  ): Promise<string | null> {
    const queryable = params.queryable ?? this.pool;
    const whereSource =
      params.source !== undefined ? ` AND COALESCE(payload->>'discoverySource', '') = $1` : '';
    const values: unknown[] = [];
    if (params.source !== undefined) {
      values.push(params.source);
    }

    const result = await queryable.query<DiscoveryUpdatedAtRow>(
      `
      SELECT updated_at
      FROM games
      WHERE COALESCE(payload->>'listType', '') = 'discovery'
      ${whereSource}
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      values
    );

    if (result.rowCount === 0) {
      return null;
    }

    return result.rows[0].updated_at;
  }

  async upsertDiscoveryGames(params: {
    client: Queryable;
    rows: Array<{
      igdbGameId: string;
      platformIgdbId: number;
      payload: Record<string, unknown>;
    }>;
  }): Promise<void> {
    if (params.rows.length === 0) {
      return;
    }

    for (const row of params.rows) {
      await params.client.query(
        `
        INSERT INTO games (igdb_game_id, platform_igdb_id, payload, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (igdb_game_id, platform_igdb_id)
        DO UPDATE
          SET payload = EXCLUDED.payload || jsonb_strip_nulls(
                jsonb_build_object(
                  'hltbMainHours', games.payload->'hltbMainHours',
                  'hltbMainExtraHours', games.payload->'hltbMainExtraHours',
                  'hltbCompletionistHours', games.payload->'hltbCompletionistHours',
                  'reviewSource', games.payload->'reviewSource',
                  'reviewScore', games.payload->'reviewScore',
                  'metacriticScore', games.payload->'metacriticScore',
                  'metacriticUrl', games.payload->'metacriticUrl',
                  'reviewUrl', games.payload->'reviewUrl',
                  'enrichmentRetry', games.payload->'enrichmentRetry'
                )
              ),
              updated_at = NOW()
        WHERE COALESCE(games.payload->>'listType', '') = 'discovery'
          AND games.payload IS DISTINCT FROM EXCLUDED.payload
        `,
        [row.igdbGameId, row.platformIgdbId, JSON.stringify(row.payload)]
      );
    }
  }

  async pruneDiscoveryGames(params: { client: Queryable; keepKeys: string[] }): Promise<void> {
    await params.client.query(
      `
      DELETE FROM games
      WHERE COALESCE(payload->>'listType', '') = 'discovery'
        AND NOT (igdb_game_id || '::' || platform_igdb_id::text = ANY($1::text[]))
      `,
      [params.keepKeys]
    );
  }

  async pruneDiscoveryGamesBySource(params: {
    client: Queryable;
    source: 'popular' | 'recent';
    keepKeys: string[];
  }): Promise<void> {
    await params.client.query(
      `
      DELETE FROM games
      WHERE COALESCE(payload->>'listType', '') = 'discovery'
        AND COALESCE(payload->>'discoverySource', '') = $1
        AND NOT (igdb_game_id || '::' || platform_igdb_id::text = ANY($2::text[]))
      `,
      [params.source, params.keepKeys]
    );
  }

  async listNormalizedGames(queryable: Queryable = this.pool): Promise<NormalizedGameRecord[]> {
    const result = await queryable.query<{
      igdb_game_id: string;
      platform_igdb_id: number;
      payload: unknown;
    }>('SELECT igdb_game_id, platform_igdb_id, payload FROM games');

    const normalized: NormalizedGameRecord[] = [];

    for (const row of result.rows) {
      const parsed = normalizeDbGameRow(row);

      if (!parsed) {
        continue;
      }

      normalized.push(parsed);
    }

    return normalized;
  }

  async listDiscoveryRowsMissingEnrichment(
    limit: number,
    queryable: Queryable = this.pool,
    options?: DiscoveryEnrichmentSelectionOptions
  ): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      payload: Record<string, unknown>;
    }>
  > {
    const params = buildDiscoveryEnrichmentSelectionParams(limit, options);
    const result = await queryable.query<DiscoveryGameRow>(
      LIST_DISCOVERY_ROWS_MISSING_ENRICHMENT_SQL,
      [
        params.normalizedLimit,
        params.maxAttempts,
        params.nowIso,
        params.rearmAfterDays,
        params.rearmMinReleaseYear
      ]
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
    client?: Queryable;
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await (params.client ?? this.pool).query(
      `
      UPDATE games
      SET payload = $3::jsonb, updated_at = NOW()
      WHERE igdb_game_id = $1 AND platform_igdb_id = $2
      `,
      [params.igdbGameId, params.platformIgdbId, JSON.stringify(params.payload)]
    );
  }

  async getRuntimeModeDefault(
    queryable: Queryable = this.pool
  ): Promise<RecommendationRuntimeMode | null> {
    const result = await queryable.query<{ setting_value: string }>(
      'SELECT setting_value FROM settings WHERE setting_key = $1 LIMIT 1',
      ['recommendations.runtime_mode_default']
    );

    const raw = result.rows[0]?.setting_value;
    return parseRecommendationRuntimeMode(raw);
  }

  async getSetting(settingKey: string, queryable: Queryable = this.pool): Promise<string | null> {
    const result = await queryable.query<SettingRow>(
      'SELECT setting_value FROM settings WHERE setting_key = $1 LIMIT 1',
      [settingKey]
    );

    return result.rowCount > 0 ? (result.rows[0]?.setting_value ?? null) : null;
  }

  async upsertSetting(params: {
    settingKey: string;
    settingValue: string;
    queryable?: Queryable;
  }): Promise<void> {
    const queryable = params.queryable ?? this.pool;
    await queryable.query(
      `
      INSERT INTO settings (setting_key, setting_value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()
      `,
      [params.settingKey, params.settingValue]
    );
  }

  /* node:coverage disable */
  async enqueueRecommendationRebuildJob(params: {
    target: RecommendationTarget;
    force: boolean;
    triggeredBy: 'manual' | 'scheduler' | 'stale-read';
    reason: RecommendationRebuildQueueReason;
  }): Promise<{ jobId: number; deduped: boolean }> {
    const dedupeKey = `recommendations:rebuild:${params.target}:${params.force ? 'force' : 'normal'}`;
    const payload = {
      target: params.target,
      force: params.force,
      triggeredBy: params.triggeredBy,
      reason: params.reason
    };
    return this.backgroundJobs.enqueue({
      jobType: 'recommendations_rebuild',
      payload,
      dedupeKey,
      priority: 100,
      maxAttempts: 5
    });
  }

  async completeBackgroundJob(
    jobId: number,
    resultPayload: Record<string, unknown>
  ): Promise<void> {
    await this.backgroundJobs.complete(jobId, resultPayload);
  }

  async failBackgroundJob(jobId: number, errorMessage: string): Promise<void> {
    await this.backgroundJobs.fail(jobId, errorMessage);
  }
  /* node:coverage enable */

  async getLatestRun(
    target: RecommendationTarget,
    queryable: Queryable = this.pool
  ): Promise<RecommendationRunSummary | null> {
    const result = await queryable.query<RunRow>(
      `
      SELECT id, target, status, settings_hash, input_hash, started_at, finished_at, error
      FROM recommendation_runs
      WHERE target = $1
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [target]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRunSummary(result.rows[0]);
  }

  async getLatestSuccessfulRun(
    target: RecommendationTarget,
    queryable: Queryable = this.pool
  ): Promise<RecommendationRunSummary | null> {
    const result = await queryable.query<RunRow>(
      `
      SELECT id, target, status, settings_hash, input_hash, started_at, finished_at, error
      FROM recommendation_runs
      WHERE target = $1 AND status = 'SUCCESS'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [target]
    );

    if (result.rowCount === 0) {
      return null;
    }

    return mapRunSummary(result.rows[0]);
  }

  async createRun(params: {
    client: Queryable;
    target: RecommendationTarget;
    settingsHash: string;
    inputHash: string;
    triggeredBy: 'manual' | 'scheduler' | 'stale-read';
  }): Promise<number> {
    const result = await params.client.query<{ id: number }>(
      `
      INSERT INTO recommendation_runs (target, status, triggered_by, settings_hash, input_hash, started_at)
      VALUES ($1, 'RUNNING', $2, $3, $4, NOW())
      RETURNING id
      `,
      [params.target, params.triggeredBy, params.settingsHash, params.inputHash]
    );

    return result.rows[0].id;
  }

  /* node:coverage disable */
  async finalizeRunSuccess(params: {
    client: Queryable;
    runId: number;
    target: RecommendationTarget;
    recommendationsByMode: Record<RecommendationRuntimeMode, RankedRecommendationItem[]>;
    lanesByMode: Record<RecommendationRuntimeMode, RecommendationLaneCollection>;
    historyUpdates: Array<{
      target: RecommendationTarget;
      runtimeMode: RecommendationRuntimeMode;
      igdbGameId: string;
      platformIgdbId: number;
    }>;
    similarityEdges: SimilarityEdge[];
  }): Promise<void> {
    await params.client.query('BEGIN');

    try {
      for (const [runtimeMode, items] of Object.entries(params.recommendationsByMode) as Array<
        [RecommendationRuntimeMode, RankedRecommendationItem[]]
      >) {
        for (
          let offset = 0;
          offset < items.length;
          offset += RecommendationRepository.RECOMMENDATIONS_INSERT_BATCH_SIZE
        ) {
          const batch = items.slice(
            offset,
            offset + RecommendationRepository.RECOMMENDATIONS_INSERT_BATCH_SIZE
          );
          const values: unknown[] = [];
          const tuples: string[] = [];

          for (const item of batch) {
            const baseIndex = values.length;
            tuples.push(
              `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}::jsonb, ${sqlParam(baseIndex + 8)}::jsonb)`
            );
            values.push(
              params.runId,
              runtimeMode,
              item.rank,
              item.igdbGameId,
              item.platformIgdbId,
              item.scoreTotal,
              JSON.stringify(item.scoreComponents),
              JSON.stringify(item.explanations)
            );
          }

          await params.client.query(
            `
            INSERT INTO recommendations
              (
                run_id,
                runtime_mode,
                rank,
                igdb_game_id,
                platform_igdb_id,
                score_total,
                score_components,
                explanations
              )
            VALUES ${tuples.join(',\n')}
            `,
            values
          );
        }
      }

      for (const [runtimeMode, lanes] of Object.entries(params.lanesByMode) as Array<
        [RecommendationRuntimeMode, RecommendationLaneCollection]
      >) {
        for (const lane of [
          'overall',
          'hiddenGems',
          'exploration',
          'blended',
          'popular',
          'recent'
        ] as RecommendationLaneKey[]) {
          const items = lanes[lane];

          for (
            let offset = 0;
            offset < items.length;
            offset += RecommendationRepository.RECOMMENDATION_LANES_INSERT_BATCH_SIZE
          ) {
            const batch = items.slice(
              offset,
              offset + RecommendationRepository.RECOMMENDATION_LANES_INSERT_BATCH_SIZE
            );
            const values: unknown[] = [];
            const tuples: string[] = [];

            for (let index = 0; index < batch.length; index += 1) {
              const item = batch[index];
              const baseIndex = values.length;
              tuples.push(
                `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}, ${sqlParam(baseIndex + 8)}::jsonb, ${sqlParam(baseIndex + 9)}::jsonb)`
              );
              values.push(
                params.runId,
                runtimeMode,
                lane,
                offset + index + 1,
                item.igdbGameId,
                item.platformIgdbId,
                item.scoreTotal,
                JSON.stringify(item.scoreComponents),
                JSON.stringify(item.explanations)
              );
            }

            await params.client.query(
              `
              INSERT INTO recommendation_lanes
                (
                  run_id,
                  runtime_mode,
                  lane,
                  rank,
                  igdb_game_id,
                  platform_igdb_id,
                  score_total,
                  score_components,
                  explanations
                )
              VALUES ${tuples.join(',\n')}
              `,
              values
            );
          }
        }
      }

      const similarityEdges = params.similarityEdges;
      for (
        let offset = 0;
        offset < similarityEdges.length;
        offset += RecommendationRepository.SIMILARITY_INSERT_BATCH_SIZE
      ) {
        const batch = similarityEdges.slice(
          offset,
          offset + RecommendationRepository.SIMILARITY_INSERT_BATCH_SIZE
        );
        const values: unknown[] = [];
        const tuples: string[] = [];

        for (const edge of batch) {
          const baseIndex = values.length;
          tuples.push(
            `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, ${sqlParam(baseIndex + 5)}, ${sqlParam(baseIndex + 6)}, ${sqlParam(baseIndex + 7)}, ${sqlParam(baseIndex + 8)}, ${sqlParam(baseIndex + 9)}::jsonb, NOW())`
          );
          values.push(
            params.runId,
            params.target,
            'NEUTRAL',
            edge.sourceIgdbGameId,
            edge.sourcePlatformIgdbId,
            edge.similarIgdbGameId,
            edge.similarPlatformIgdbId,
            edge.similarity,
            JSON.stringify(edge.reasons)
          );
        }

        await params.client.query(
          `
          INSERT INTO game_similarity
            (
              run_id,
              target,
              runtime_mode,
              source_igdb_game_id,
              source_platform_igdb_id,
              similar_igdb_game_id,
              similar_platform_igdb_id,
              similarity,
              reasons,
              updated_at
            )
          VALUES ${tuples.join(',\n')}
          `,
          values
        );
      }

      for (
        let offset = 0;
        offset < params.historyUpdates.length;
        offset += RecommendationRepository.RECOMMENDATION_HISTORY_UPSERT_BATCH_SIZE
      ) {
        const batch = params.historyUpdates.slice(
          offset,
          offset + RecommendationRepository.RECOMMENDATION_HISTORY_UPSERT_BATCH_SIZE
        );
        const values: unknown[] = [];
        const tuples: string[] = [];

        for (const update of batch) {
          const baseIndex = values.length;
          tuples.push(
            `(${sqlParam(baseIndex + 1)}, ${sqlParam(baseIndex + 2)}, ${sqlParam(baseIndex + 3)}, ${sqlParam(baseIndex + 4)}, 1, NOW())`
          );
          values.push(update.target, update.runtimeMode, update.igdbGameId, update.platformIgdbId);
        }

        await params.client.query(
          `
          INSERT INTO recommendation_history
            (target, runtime_mode, igdb_game_id, platform_igdb_id, recommendation_count, last_recommended_at)
          VALUES ${tuples.join(',\n')}
          ON CONFLICT (target, runtime_mode, igdb_game_id, platform_igdb_id)
          DO UPDATE
            SET recommendation_count = recommendation_history.recommendation_count + 1,
                last_recommended_at = NOW()
          `,
          values
        );
      }

      await params.client.query(
        `
        UPDATE recommendation_runs
        SET status = 'SUCCESS', finished_at = NOW(), error = NULL
        WHERE id = $1
        `,
        [params.runId]
      );

      await params.client.query('COMMIT');
    } catch (error) {
      await params.client.query('ROLLBACK');
      throw error;
    }
  }
  /* node:coverage enable */

  async markRunFailed(params: {
    client: Queryable;
    runId: number;
    errorMessage: string;
  }): Promise<void> {
    await params.client.query(
      `
      UPDATE recommendation_runs
      SET status = 'FAILED', finished_at = NOW(), error = $2
      WHERE id = $1
      `,
      [params.runId, params.errorMessage]
    );
  }

  async readTopRecommendations(params: {
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    limit: number;
  }): Promise<{ run: RecommendationRunSummary; items: RankedRecommendationItem[] } | null> {
    const run = await this.getLatestSuccessfulRun(params.target);

    if (!run) {
      return null;
    }

    const statusFilter = buildStatusFilterForTarget(params.target);
    const itemResult = await this.pool.query<RecommendationRow>(
      `
      SELECT recommendations.rank, recommendations.igdb_game_id, recommendations.platform_igdb_id,
             recommendations.score_total, recommendations.score_components, recommendations.explanations
      FROM recommendations
      INNER JOIN games
        ON games.igdb_game_id = recommendations.igdb_game_id
       AND games.platform_igdb_id = recommendations.platform_igdb_id
      WHERE recommendations.run_id = $1
        AND recommendations.runtime_mode = $2
        AND COALESCE(games.payload->>'listType', '') = $3
        AND COALESCE(games.payload->>'status', '') = ANY($4::text[])
      ORDER BY recommendations.rank ASC
      LIMIT $5
      `,
      [
        run.id,
        params.runtimeMode,
        statusFilter.listType,
        statusFilter.allowedStatuses,
        params.limit
      ]
    );

    return {
      run,
      items: itemResult.rows.map(mapRecommendationRow)
    };
  }

  async readRecommendationLanes(params: {
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    limit: number;
  }): Promise<{
    run: RecommendationRunSummary;
    lanes: RecommendationLaneCollection;
  } | null> {
    const run = await this.getLatestSuccessfulRun(params.target);

    if (!run) {
      return null;
    }

    const statusFilter = buildStatusFilterForTarget(params.target);
    const rows = await this.pool.query<LaneRow>(
      `
      SELECT recommendation_lanes.lane, recommendation_lanes.rank, recommendation_lanes.igdb_game_id,
             recommendation_lanes.platform_igdb_id, recommendation_lanes.score_total,
             recommendation_lanes.score_components, recommendation_lanes.explanations
      FROM recommendation_lanes
      INNER JOIN games
        ON games.igdb_game_id = recommendation_lanes.igdb_game_id
       AND games.platform_igdb_id = recommendation_lanes.platform_igdb_id
      WHERE recommendation_lanes.run_id = $1
        AND recommendation_lanes.runtime_mode = $2
        AND COALESCE(games.payload->>'listType', '') = $3
        AND COALESCE(games.payload->>'status', '') = ANY($4::text[])
      ORDER BY recommendation_lanes.lane ASC, recommendation_lanes.rank ASC
      `,
      [run.id, params.runtimeMode, statusFilter.listType, statusFilter.allowedStatuses]
    );

    const lanes: RecommendationLaneCollection = {
      overall: [],
      hiddenGems: [],
      exploration: [],
      blended: [],
      popular: [],
      recent: []
    };

    for (const row of rows.rows) {
      const lane = row.lane;
      if (lanes[lane].length >= params.limit) {
        continue;
      }

      lanes[lane].push(mapRecommendationRow(row));
    }

    return {
      run,
      lanes
    };
  }

  async readSimilarGames(params: {
    igdbGameId: string;
    platformIgdbId: number;
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    limit: number;
  }): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityEdge['reasons'];
    }>
  > {
    const run = await this.getLatestSuccessfulRun(params.target);
    if (!run) {
      return [];
    }

    const statusFilter = buildStatusFilterForTarget(params.target);
    const result = await this.pool.query<SimilarityRow>(
      `
      WITH ranked AS (
        SELECT
          game_similarity.similar_igdb_game_id,
          game_similarity.similar_platform_igdb_id,
          game_similarity.similarity,
          game_similarity.reasons,
          CASE WHEN game_similarity.runtime_mode = $3 THEN 0 ELSE 1 END AS mode_priority,
          ROW_NUMBER() OVER (
            PARTITION BY game_similarity.similar_igdb_game_id, game_similarity.similar_platform_igdb_id
            ORDER BY
              CASE WHEN game_similarity.runtime_mode = $3 THEN 0 ELSE 1 END ASC,
              game_similarity.similarity DESC,
              game_similarity.similar_igdb_game_id ASC,
              game_similarity.similar_platform_igdb_id ASC
          ) AS mode_rank
        FROM game_similarity
        INNER JOIN games
          ON games.igdb_game_id = game_similarity.similar_igdb_game_id
         AND games.platform_igdb_id = game_similarity.similar_platform_igdb_id
        WHERE game_similarity.run_id = $1
          AND game_similarity.target = $2
          AND game_similarity.runtime_mode = ANY(ARRAY[$3::text, $4::text])
          AND game_similarity.source_igdb_game_id = $5
          AND game_similarity.source_platform_igdb_id = $6
          AND game_similarity.similar_igdb_game_id <> $5
          AND COALESCE(games.payload->>'listType', '') = $7
          AND COALESCE(games.payload->>'status', '') = ANY($8::text[])
      )
      SELECT similar_igdb_game_id, similar_platform_igdb_id, similarity, reasons
      FROM ranked
      WHERE mode_rank = 1
      ORDER BY similarity DESC, mode_priority ASC, similar_igdb_game_id ASC, similar_platform_igdb_id ASC
      LIMIT $9
      `,
      [
        run.id,
        params.target,
        params.runtimeMode,
        'NEUTRAL',
        params.igdbGameId,
        params.platformIgdbId,
        statusFilter.listType,
        statusFilter.allowedStatuses,
        params.limit
      ]
    );

    return result.rows.map((row) => ({
      igdbGameId: row.similar_igdb_game_id,
      platformIgdbId: row.similar_platform_igdb_id,
      similarity:
        typeof row.similarity === 'string' ? Number.parseFloat(row.similarity) : row.similarity,
      reasons: row.reasons
    }));
  }

  async listRecommendationHistory(params: {
    target: RecommendationTarget;
    runtimeMode: RecommendationRuntimeMode;
    queryable?: Queryable;
  }): Promise<Map<string, RecommendationHistoryEntry>> {
    const queryable = params.queryable ?? this.pool;
    const result = await queryable.query<HistoryRow>(
      `
      SELECT igdb_game_id, platform_igdb_id, recommendation_count, last_recommended_at
      FROM recommendation_history
      WHERE target = $1 AND runtime_mode = $2
      `,
      [params.target, params.runtimeMode]
    );

    const map = new Map<string, RecommendationHistoryEntry>();

    for (const row of result.rows) {
      map.set(buildGameKey(row.igdb_game_id, row.platform_igdb_id), {
        recommendationCount: row.recommendation_count,
        lastRecommendedAt: row.last_recommended_at
      });
    }

    return map;
  }

  async listGameEmbeddings(queryable: Queryable = this.pool): Promise<StoredGameEmbedding[]> {
    const result = await queryable.query<EmbeddingRow>(
      `
      SELECT
        igdb_game_id,
        platform_igdb_id,
        embedding,
        embedding_model,
        source_hash,
        created_at,
        updated_at
      FROM game_embeddings
      `
    );

    return result.rows
      .map((row) => ({
        igdbGameId: row.igdb_game_id,
        platformIgdbId: row.platform_igdb_id,
        embedding: parseEmbeddingVector(row.embedding),
        embeddingModel: row.embedding_model,
        sourceHash: row.source_hash,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
      .filter((row) => row.embedding.length > 0);
  }

  async upsertGameEmbeddings(params: {
    client: Queryable;
    rows: GameEmbeddingUpsertInput[];
  }): Promise<void> {
    if (params.rows.length === 0) {
      return;
    }

    for (const row of params.rows) {
      await params.client.query(
        `
        INSERT INTO game_embeddings
          (
            igdb_game_id,
            platform_igdb_id,
            embedding,
            embedding_model,
            source_hash,
            created_at,
            updated_at
          )
        VALUES ($1, $2, $3::vector, $4, $5, NOW(), NOW())
        ON CONFLICT (igdb_game_id, platform_igdb_id)
        DO UPDATE
          SET embedding = EXCLUDED.embedding,
              embedding_model = EXCLUDED.embedding_model,
              source_hash = EXCLUDED.source_hash,
              updated_at = NOW()
        `,
        [
          row.igdbGameId,
          row.platformIgdbId,
          serializeEmbeddingVector(row.embedding),
          row.embeddingModel,
          row.sourceHash
        ]
      );
    }
  }

  async listEmbeddingMap(
    queryable: Queryable = this.pool
  ): Promise<Map<string, StoredGameEmbedding>> {
    const rows = await this.listGameEmbeddings(queryable);
    const map = new Map<string, StoredGameEmbedding>();

    for (const row of rows) {
      map.set(buildGameKey(row.igdbGameId, row.platformIgdbId), row);
    }

    return map;
  }
}

function buildStatusFilterForTarget(target: RecommendationTarget): {
  listType: 'collection' | 'wishlist' | 'discovery';
  allowedStatuses: Array<GameStatus | ''>;
} {
  if (target === 'BACKLOG') {
    return {
      listType: 'collection',
      allowedStatuses: ['', 'wantToPlay']
    };
  }

  if (target === 'DISCOVERY') {
    return {
      listType: 'discovery',
      allowedStatuses: ['', 'wantToPlay']
    };
  }

  return {
    listType: 'wishlist',
    allowedStatuses: ['', 'wantToPlay', 'playing', 'paused', 'replay']
  };
}

function sqlParam(index: number): string {
  return `$${String(index)}`;
}

function mapRunSummary(row: RunRow): RecommendationRunSummary {
  return {
    id: row.id,
    target: row.target,
    status: row.status,
    settingsHash: row.settings_hash,
    inputHash: row.input_hash,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error
  };
}

function mapRecommendationRow(row: RecommendationRow | LaneRow): RankedRecommendationItem {
  return {
    rank: row.rank,
    igdbGameId: row.igdb_game_id,
    platformIgdbId: row.platform_igdb_id,
    scoreTotal:
      typeof row.score_total === 'string' ? Number.parseFloat(row.score_total) : row.score_total,
    scoreComponents: row.score_components,
    explanations: row.explanations
  };
}

function parseEmbeddingVector(value: string | number[]): number[] {
  if (Array.isArray(value)) {
    return value.filter((entry) => Number.isFinite(entry));
  }

  if (typeof value !== 'string') {
    return [];
  }

  const normalized = value.trim().replace(/^\[/, '').replace(/\]$/, '');

  if (!normalized) {
    return [];
  }

  return normalized
    .split(',')
    .map((entry) => Number.parseFloat(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

function serializeEmbeddingVector(embedding: number[]): string {
  return `[${embedding.map((value) => round6(value)).join(',')}]`;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
