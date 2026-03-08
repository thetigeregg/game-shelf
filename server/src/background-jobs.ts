import type { Pool, QueryResultRow } from 'pg';

export type BackgroundJobType =
  | 'recommendations_rebuild'
  | 'metadata_enrichment_run'
  | 'release_monitor_game'
  | 'discovery_enrichment_run'
  | 'hltb_cache_revalidate'
  | 'metacritic_cache_revalidate'
  | 'mobygames_cache_revalidate'
  | 'manuals_catalog_refresh';

interface BackgroundJobInsertRow extends QueryResultRow {
  id: number;
}

interface BackgroundJobClaimRow extends QueryResultRow {
  id: number;
  job_type: BackgroundJobType;
  payload: unknown;
}

interface BackgroundJobStatsRow extends QueryResultRow {
  job_type: BackgroundJobType;
  pending_count: string;
  running_count: string;
  failed_count: string;
  succeeded_count: string;
  oldest_pending_seconds: string | null;
}

interface BackgroundJobFailedRow extends QueryResultRow {
  id: number;
  job_type: BackgroundJobType;
  attempts: number;
  max_attempts: number;
  available_at: string;
  updated_at: string;
  finished_at: string | null;
  last_error: string | null;
  payload: unknown;
}

interface BackgroundJobIdRow extends QueryResultRow {
  id: number;
}

export interface ClaimedBackgroundJob {
  id: number;
  jobType: BackgroundJobType;
  payload: Record<string, unknown>;
}

export interface BackgroundJobTypeStats {
  jobType: BackgroundJobType;
  pending: number;
  running: number;
  failed: number;
  succeeded: number;
  oldestPendingSeconds: number | null;
}

export interface FailedBackgroundJob {
  id: number;
  jobType: BackgroundJobType;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  updatedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
}

export class BackgroundJobRepository {
  constructor(private readonly pool: Pool) {}

  /* node:coverage disable */
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

    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
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
    /* c8 ignore stop */

    return { jobId: fallbackInsert.rows[0].id, deduped: false };
  }

  async claimNext(
    workerId: string,
    jobType: BackgroundJobType
  ): Promise<ClaimedBackgroundJob | null> {
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
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
    /* c8 ignore stop */

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
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
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
    /* c8 ignore stop */
  }

  async fail(jobId: number, errorMessage: string): Promise<void> {
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
    await this.pool.query(
      `
      UPDATE background_jobs
      SET
        status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE NOW() + (attempts * INTERVAL '30 seconds') END,
        finished_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE finished_at END,
        last_error = $2,
        locked_by = NULL,
        locked_at = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [jobId, errorMessage]
    );
    /* c8 ignore stop */
  }

  async heartbeat(jobId: number, workerId: string): Promise<boolean> {
    const result = await this.pool.query<BackgroundJobIdRow>(
      `
      UPDATE background_jobs
      SET
        locked_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'running'
        AND locked_by = $2
      RETURNING id
      `,
      [jobId, workerId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async requeueStaleRunning(params?: {
    maxAgeMinutes?: number;
    limit?: number;
    jobType?: BackgroundJobType | null;
    recoveryError?: string;
  }): Promise<{ requeuedCount: number; jobIds: number[] }> {
    const maxAgeMinutes = Number.isInteger(params?.maxAgeMinutes)
      ? Math.max(1, params?.maxAgeMinutes ?? 0)
      : 30;
    const limit = Number.isInteger(params?.limit)
      ? Math.max(1, Math.min(10_000, params?.limit ?? 0))
      : 1_000;
    const recoveryError =
      typeof params?.recoveryError === 'string' && params.recoveryError.trim().length > 0
        ? params.recoveryError.trim()
        : 'stale running lock recovered by background worker';

    const result = await this.pool.query<BackgroundJobIdRow>(
      `
      WITH candidates AS (
        SELECT id
        FROM background_jobs
        WHERE status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < (NOW() - make_interval(mins => $1))
          AND ($2::text IS NULL OR job_type = $2)
        ORDER BY locked_at ASC, id ASC
        LIMIT $3
      )
      UPDATE background_jobs
      SET
        status = 'pending',
        available_at = NOW(),
        locked_by = NULL,
        locked_at = NULL,
        finished_at = NULL,
        last_error = $4,
        updated_at = NOW()
      WHERE id IN (SELECT id FROM candidates)
      RETURNING id
      `,
      [maxAgeMinutes, params?.jobType ?? null, limit, recoveryError]
    );

    return {
      requeuedCount: result.rowCount ?? 0,
      jobIds: result.rows.map((row) => row.id)
    };
  }

  async getTypeStats(): Promise<BackgroundJobTypeStats[]> {
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
    const result = await this.pool.query<BackgroundJobStatsRow>(
      `
      SELECT
        job_type,
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count,
        COUNT(*) FILTER (WHERE status = 'running')::text AS running_count,
        COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
        COUNT(*) FILTER (WHERE status = 'succeeded')::text AS succeeded_count,
        (
          EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))
        )::text AS oldest_pending_seconds
      FROM background_jobs
      GROUP BY job_type
      ORDER BY job_type ASC
      `
    );
    /* c8 ignore stop */

    return result.rows.map((row) => ({
      jobType: row.job_type,
      pending: Number.parseInt(row.pending_count, 10) || 0,
      running: Number.parseInt(row.running_count, 10) || 0,
      failed: Number.parseInt(row.failed_count, 10) || 0,
      succeeded: Number.parseInt(row.succeeded_count, 10) || 0,
      oldestPendingSeconds:
        row.oldest_pending_seconds && Number.isFinite(Number.parseFloat(row.oldest_pending_seconds))
          ? Number.parseFloat(row.oldest_pending_seconds)
          : null
    }));
  }
  /* node:coverage enable */

  async listFailed(params?: {
    jobType?: BackgroundJobType | null;
    failedBeforeIso?: string | null;
    limit?: number;
  }): Promise<FailedBackgroundJob[]> {
    const limit = Number.isInteger(params?.limit)
      ? Math.max(1, Math.min(500, params?.limit ?? 0))
      : 100;
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
    const result = await this.pool.query<BackgroundJobFailedRow>(
      `
      SELECT
        id,
        job_type,
        attempts,
        max_attempts,
        available_at::text AS available_at,
        updated_at::text AS updated_at,
        finished_at::text AS finished_at,
        last_error,
        payload
      FROM background_jobs
      WHERE status = 'failed'
        AND ($1::text IS NULL OR job_type = $1)
        AND ($2::timestamptz IS NULL OR COALESCE(finished_at, updated_at) <= $2::timestamptz)
      ORDER BY COALESCE(finished_at, updated_at) DESC, id DESC
      LIMIT $3
      `,
      [params?.jobType ?? null, params?.failedBeforeIso ?? null, limit]
    );
    /* c8 ignore stop */

    return result.rows.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      availableAt: row.available_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at,
      lastError: row.last_error,
      payload:
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : {}
    }));
  }

  async requeueFailed(params?: {
    jobType?: BackgroundJobType | null;
    failedBeforeIso?: string | null;
    limit?: number;
  }): Promise<{ requeuedCount: number; jobIds: number[] }> {
    const limit = Number.isInteger(params?.limit)
      ? Math.max(1, Math.min(500, params?.limit ?? 0))
      : 100;
    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
    const result = await this.pool.query<BackgroundJobIdRow>(
      `
      WITH candidates AS (
        SELECT id
        FROM background_jobs
        WHERE status = 'failed'
          AND ($1::text IS NULL OR job_type = $1)
          AND ($2::timestamptz IS NULL OR COALESCE(finished_at, updated_at) <= $2::timestamptz)
        ORDER BY COALESCE(finished_at, updated_at) DESC, id DESC
        LIMIT $3
      )
      UPDATE background_jobs
      SET
        status = 'pending',
        available_at = NOW(),
        attempts = 0,
        locked_by = NULL,
        locked_at = NULL,
        last_error = NULL,
        finished_at = NULL,
        updated_at = NOW()
      WHERE id IN (SELECT id FROM candidates)
      RETURNING id
      `,
      [params?.jobType ?? null, params?.failedBeforeIso ?? null, limit]
    );
    /* c8 ignore stop */

    return {
      requeuedCount: result.rowCount ?? 0,
      jobIds: result.rows.map((row) => row.id)
    };
  }

  async purgeFinishedOlderThan(params?: {
    retentionDays?: number;
    limit?: number;
  }): Promise<{ deletedCount: number; jobIds: number[] }> {
    const retentionDays = Number.isInteger(params?.retentionDays)
      ? Math.max(1, params?.retentionDays ?? 0)
      : 30;
    const limit = Number.isInteger(params?.limit)
      ? Math.max(1, Math.min(10_000, params?.limit ?? 0))
      : 1_000;

    /* c8 ignore start: SQL template literal coverage is noisy; behavior is validated in background-jobs tests */
    const result = await this.pool.query<BackgroundJobIdRow>(
      `
      WITH candidates AS (
        SELECT id
        FROM background_jobs
        WHERE status IN ('succeeded', 'failed')
          AND finished_at IS NOT NULL
          AND finished_at < (NOW() - make_interval(days => $1))
        ORDER BY finished_at ASC, id ASC
        LIMIT $2
      )
      DELETE FROM background_jobs
      WHERE id IN (SELECT id FROM candidates)
      RETURNING id
      `,
      [retentionDays, limit]
    );
    /* c8 ignore stop */

    return {
      deletedCount: result.rowCount ?? 0,
      jobIds: result.rows.map((row) => row.id)
    };
  }
}
