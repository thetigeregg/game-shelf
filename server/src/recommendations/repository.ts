import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { normalizeDbGameRow } from './normalize.js';
import {
  NormalizedGameRecord,
  RankedRecommendationItem,
  RecommendationRunSummary,
  RecommendationScoreComponents,
  RecommendationTarget,
  SimilarityEdge
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
    recommendations: RankedRecommendationItem[];
    similarityEdges: SimilarityEdge[];
  }): Promise<void> {
    await params.client.query('BEGIN');

    try {
      for (const item of params.recommendations) {
        await params.client.query(
          `
          INSERT INTO recommendations
            (run_id, rank, igdb_game_id, platform_igdb_id, score_total, score_components, explanations)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
          `,
          [
            params.runId,
            item.rank,
            item.igdbGameId,
            item.platformIgdbId,
            item.scoreTotal,
            JSON.stringify(item.scoreComponents),
            JSON.stringify(item.explanations)
          ]
        );
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
      WHERE run_id = $1
      ORDER BY rank ASC
      LIMIT $2
      `,
      [run.id, params.limit]
    );

    return {
      run,
      items: itemResult.rows.map((row) => ({
        rank: row.rank,
        igdbGameId: row.igdb_game_id,
        platformIgdbId: row.platform_igdb_id,
        scoreTotal:
          typeof row.score_total === 'string'
            ? Number.parseFloat(row.score_total)
            : row.score_total,
        scoreComponents: row.score_components,
        explanations: row.explanations
      }))
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
    const result = await this.pool.query<{
      similar_igdb_game_id: string;
      similar_platform_igdb_id: number;
      similarity: string | number;
      reasons: SimilarityEdge['reasons'];
    }>(
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
