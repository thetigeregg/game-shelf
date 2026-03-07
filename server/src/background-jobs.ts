import type { Pool, QueryResultRow } from 'pg';

export type BackgroundJobType =
  | 'recommendations_rebuild'
  | 'metadata_enrichment_run'
  | 'release_monitor_game';

interface BackgroundJobInsertRow extends QueryResultRow {
  id: number;
}

interface BackgroundJobClaimRow extends QueryResultRow {
  id: number;
  job_type: BackgroundJobType;
  payload: unknown;
}

export interface ClaimedBackgroundJob {
  id: number;
  jobType: BackgroundJobType;
  payload: Record<string, unknown>;
}

export class BackgroundJobRepository {
  constructor(private readonly pool: Pool) {}

  async enqueue(params: {
    jobType: BackgroundJobType;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
    priority?: number;
    maxAttempts?: number;
  }): Promise<{ jobId: number; deduped: boolean }> {
    const priority = Number.isInteger(params.priority) ? (params.priority as number) : 100;
    const maxAttempts =
      Number.isInteger(params.maxAttempts) && (params.maxAttempts as number) > 0
        ? (params.maxAttempts as number)
        : 5;
    const normalizedDedupeKey =
      typeof params.dedupeKey === 'string' && params.dedupeKey.trim().length > 0
        ? params.dedupeKey.trim()
        : null;
    const payloadJson = JSON.stringify(params.payload);

    const insertResult = await this.pool.query<BackgroundJobInsertRow>(
      `
      INSERT INTO background_jobs
        (job_type, dedupe_key, payload, status, priority, attempts, max_attempts, available_at, created_at, updated_at)
      VALUES
        ($1, $2, $3::jsonb, 'pending', $4, 0, $5, NOW(), NOW(), NOW())
      ON CONFLICT (dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')
      DO NOTHING
      RETURNING id
      `,
      [params.jobType, normalizedDedupeKey, payloadJson, priority, maxAttempts]
    );

    if ((insertResult.rowCount ?? 0) > 0 && insertResult.rows[0]) {
      return { jobId: insertResult.rows[0].id, deduped: false };
    }

    if (normalizedDedupeKey !== null) {
      const existingResult = await this.pool.query<BackgroundJobInsertRow>(
        `
        SELECT id
        FROM background_jobs
        WHERE dedupe_key = $1
          AND status IN ('pending', 'running')
        ORDER BY id DESC
        LIMIT 1
        `,
        [normalizedDedupeKey]
      );
      if ((existingResult.rowCount ?? 0) > 0 && existingResult.rows[0]) {
        return { jobId: existingResult.rows[0].id, deduped: true };
      }
    }

    const fallbackInsert = await this.pool.query<BackgroundJobInsertRow>(
      `
      INSERT INTO background_jobs
        (job_type, dedupe_key, payload, status, priority, attempts, max_attempts, available_at, created_at, updated_at)
      VALUES
        ($1, NULL, $2::jsonb, 'pending', $3, 0, $4, NOW(), NOW(), NOW())
      RETURNING id
      `,
      [params.jobType, payloadJson, priority, maxAttempts]
    );

    return { jobId: fallbackInsert.rows[0].id, deduped: false };
  }

  async claimNext(
    workerId: string,
    jobType: BackgroundJobType
  ): Promise<ClaimedBackgroundJob | null> {
    const result = await this.pool.query<BackgroundJobClaimRow>(
      `
      WITH next_job AS (
        SELECT id
        FROM background_jobs
        WHERE job_type = $2
          AND status = 'pending'
          AND available_at <= NOW()
        ORDER BY priority ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE background_jobs
      SET
        status = 'running',
        attempts = attempts + 1,
        locked_by = $1,
        locked_at = NOW(),
        updated_at = NOW()
      WHERE id IN (SELECT id FROM next_job)
      RETURNING id, job_type, payload
      `,
      [workerId, jobType]
    );

    if ((result.rowCount ?? 0) === 0) {
      return null;
    }

    const row = result.rows[0];
    const payload =
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      jobType: row.job_type,
      payload
    };
  }

  async complete(jobId: number, resultPayload: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `
      UPDATE background_jobs
      SET
        status = 'succeeded',
        result = $2::jsonb,
        finished_at = NOW(),
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [jobId, JSON.stringify(resultPayload)]
    );
  }

  async fail(jobId: number, errorMessage: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE background_jobs
      SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE NOW() + (attempts * INTERVAL '30 seconds') END,
        last_error = $2,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [jobId, errorMessage]
    );
  }
}
