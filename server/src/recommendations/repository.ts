import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { normalizeDbGameRow } from './normalize.js';
import { parseRecommendationRuntimeMode } from './runtime.js';
import { buildGameKey } from './semantic.js';
import {
  GameEmbeddingUpsertInput,
  NormalizedGameRecord,
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

const RECOMMENDATION_LOCK_NAMESPACE = 77191;

export class RecommendationRepository {
  constructor(private readonly pool: Pool) {}

  async withTargetLock<T>(
    target: RecommendationTarget,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await this.pool.connect();
    const targetKey = target === 'BACKLOG' ? 1 : 2;

    try {
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        [RECOMMENDATION_LOCK_NAMESPACE, targetKey]
      );

      const acquired = lockResult.rows[0]?.acquired ?? false;

      if (!acquired) {
        return { acquired: false };
      }

      const value = await callback(client);
      return { acquired: true, value };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [
        RECOMMENDATION_LOCK_NAMESPACE,
        targetKey
      ]);
      client.release();
    }
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

  async finalizeRunSuccess(params: {
    client: Queryable;
    runId: number;
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
        for (const item of items) {
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
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
            `,
            [
              params.runId,
              runtimeMode,
              item.rank,
              item.igdbGameId,
              item.platformIgdbId,
              item.scoreTotal,
              JSON.stringify(item.scoreComponents),
              JSON.stringify(item.explanations)
            ]
          );
        }
      }

      for (const [runtimeMode, lanes] of Object.entries(params.lanesByMode) as Array<
        [RecommendationRuntimeMode, RecommendationLaneCollection]
      >) {
        for (const lane of ['overall', 'hiddenGems', 'exploration'] as RecommendationLaneKey[]) {
          const items = lanes[lane];

          for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
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
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
              `,
              [
                params.runId,
                runtimeMode,
                lane,
                index + 1,
                item.igdbGameId,
                item.platformIgdbId,
                item.scoreTotal,
                JSON.stringify(item.scoreComponents),
                JSON.stringify(item.explanations)
              ]
            );
          }
        }
      }

      await params.client.query('TRUNCATE TABLE game_similarity');

      for (const edge of params.similarityEdges) {
        await params.client.query(
          `
          INSERT INTO game_similarity
            (
              source_igdb_game_id,
              source_platform_igdb_id,
              similar_igdb_game_id,
              similar_platform_igdb_id,
              similarity,
              reasons,
              updated_at
            )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
          `,
          [
            edge.sourceIgdbGameId,
            edge.sourcePlatformIgdbId,
            edge.similarIgdbGameId,
            edge.similarPlatformIgdbId,
            edge.similarity,
            JSON.stringify(edge.reasons)
          ]
        );
      }

      for (const update of params.historyUpdates) {
        await params.client.query(
          `
          INSERT INTO recommendation_history
            (target, runtime_mode, igdb_game_id, platform_igdb_id, recommendation_count, last_recommended_at)
          VALUES ($1, $2, $3, $4, 1, NOW())
          ON CONFLICT (target, runtime_mode, igdb_game_id, platform_igdb_id)
          DO UPDATE
            SET recommendation_count = recommendation_history.recommendation_count + 1,
                last_recommended_at = NOW()
          `,
          [update.target, update.runtimeMode, update.igdbGameId, update.platformIgdbId]
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

    const itemResult = await this.pool.query<RecommendationRow>(
      `
      SELECT rank, igdb_game_id, platform_igdb_id, score_total, score_components, explanations
      FROM recommendations
      WHERE run_id = $1 AND runtime_mode = $2
      ORDER BY rank ASC
      LIMIT $3
      `,
      [run.id, params.runtimeMode, params.limit]
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

    const rows = await this.pool.query<LaneRow>(
      `
      SELECT lane, rank, igdb_game_id, platform_igdb_id, score_total, score_components, explanations
      FROM recommendation_lanes
      WHERE run_id = $1 AND runtime_mode = $2
      ORDER BY lane ASC, rank ASC
      `,
      [run.id, params.runtimeMode]
    );

    const lanes: RecommendationLaneCollection = {
      overall: [],
      hiddenGems: [],
      exploration: []
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
    limit: number;
  }): Promise<
    Array<{
      igdbGameId: string;
      platformIgdbId: number;
      similarity: number;
      reasons: SimilarityEdge['reasons'];
    }>
  > {
    const result = await this.pool.query<SimilarityRow>(
      `
      SELECT similar_igdb_game_id, similar_platform_igdb_id, similarity, reasons
      FROM game_similarity
      WHERE source_igdb_game_id = $1 AND source_platform_igdb_id = $2
      ORDER BY similarity DESC
      LIMIT $3
      `,
      [params.igdbGameId, params.platformIgdbId, params.limit]
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
