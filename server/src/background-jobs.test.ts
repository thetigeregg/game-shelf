import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import { BackgroundJobRepository } from './background-jobs.js';

class PoolMock {
  public readonly queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  constructor(
    private readonly handler: (
      sql: string,
      params: unknown[] | undefined
    ) => { rows: QueryResultRow[]; rowCount?: number } = () => ({ rows: [], rowCount: 0 })
  ) {}

  query(sql: string, params?: unknown[]): Promise<{ rows: QueryResultRow[]; rowCount?: number }> {
    this.queries.push({ sql, params });
    return Promise.resolve(this.handler(sql, params));
  }
}

void test('background jobs enqueue inserts with defaults and trims dedupe key', async () => {
  const pool = new PoolMock(() => ({ rows: [{ id: 42 }], rowCount: 1 }));
  const repository = new BackgroundJobRepository(pool as never);

  const result = await repository.enqueue({
    jobType: 'metadata_enrichment_run',
    payload: { a: 1 },
    dedupeKey: '  key-1  '
  });

  assert.deepEqual(result, { jobId: 42, deduped: false });
  const params = pool.queries[0]?.params;
  assert.ok(params);
  assert.equal(params[0], 'metadata_enrichment_run');
  assert.equal(params[1], 'key-1');
  assert.equal(params[3], 100);
  assert.equal(params[4], 5);
});

void test('background jobs enqueue dedupes against existing pending/running job', async () => {
  let calls = 0;
  const pool = new PoolMock(() => {
    calls += 1;
    if (calls === 1) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [{ id: 7 }], rowCount: 1 };
  });
  const repository = new BackgroundJobRepository(pool as never);

  const result = await repository.enqueue({
    jobType: 'release_monitor_game',
    payload: { game: 'x' },
    dedupeKey: 'release:1:2'
  });

  assert.deepEqual(result, { jobId: 7, deduped: true });
  assert.equal(pool.queries.length, 2);
});

void test('background jobs enqueue falls back to non-deduped insert', async () => {
  let calls = 0;
  const pool = new PoolMock(() => {
    calls += 1;
    if (calls === 3) {
      return { rows: [{ id: 99 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const repository = new BackgroundJobRepository(pool as never);

  const result = await repository.enqueue({
    jobType: 'recommendations_rebuild',
    payload: { target: 'BACKLOG' },
    dedupeKey: 'recommendations:BACKLOG'
  });

  assert.deepEqual(result, { jobId: 99, deduped: false });
  assert.equal(pool.queries.length, 3);
});

void test('background jobs claimNext returns null when no pending jobs', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 0 }));
  const repository = new BackgroundJobRepository(pool as never);

  const claimed = await repository.claimNext('worker-1', 'metadata_enrichment_run');
  assert.equal(claimed, null);
});

void test('background jobs claimNext normalizes invalid payloads to empty object', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 8, job_type: 'metadata_enrichment_run', payload: 'bad' }],
    rowCount: 1
  }));
  const repository = new BackgroundJobRepository(pool as never);

  const claimed = await repository.claimNext('worker-2', 'metadata_enrichment_run');
  assert.ok(claimed);
  assert.equal(claimed.id, 8);
  assert.equal(claimed.jobType, 'metadata_enrichment_run');
  assert.deepEqual(claimed.payload, {});
});

void test('background jobs claimNext query keeps FIFO priority semantics with skip locked', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 0 }));
  const repository = new BackgroundJobRepository(pool as never);

  await repository.claimNext('worker-3', 'release_monitor_game');

  const query = pool.queries[0];
  assert.ok(query);
  const normalizedSql = query.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(normalizedSql.includes("where job_type = $2 and status = 'pending'"));
  assert.ok(normalizedSql.includes('order by priority asc, id asc'));
  assert.ok(normalizedSql.includes('for update skip locked'));
  assert.ok(normalizedSql.includes('attempts = attempts + 1'));
});

void test('background jobs complete and fail write status updates', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 1 }));
  const repository = new BackgroundJobRepository(pool as never);

  await repository.complete(11, { ok: true });
  await repository.fail(11, 'boom');

  assert.equal(pool.queries.length, 2);
  assert.equal(pool.queries[0]?.params?.[0], 11);
  assert.equal(pool.queries[1]?.params?.[0], 11);
});

void test('background jobs heartbeat only refreshes lock for matching worker', async () => {
  const pool = new PoolMock(() => ({ rows: [{ id: 11 }], rowCount: 1 }));
  const repository = new BackgroundJobRepository(pool as never);

  const touched = await repository.heartbeat(11, 'background-worker:11');
  assert.equal(touched, true);

  const query = pool.queries[0];
  assert.ok(query);
  const normalizedSql = query.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(normalizedSql.includes("where id = $1 and status = 'running' and locked_by = $2"));
  assert.deepEqual(query.params, [11, 'background-worker:11']);
});

void test('background jobs fail query supports retry and terminal failure transitions', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 1 }));
  const repository = new BackgroundJobRepository(pool as never);

  await repository.fail(12, 'broken');

  const query = pool.queries[0];
  assert.ok(query);
  const normalizedSql = query.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(
    normalizedSql.includes(
      "status = case when attempts >= max_attempts then 'failed' else 'pending' end"
    )
  );
  assert.ok(normalizedSql.includes('available_at = case when attempts >= max_attempts'));
  assert.ok(normalizedSql.includes('finished_at = case when attempts >= max_attempts then now()'));
  const params = query.params;
  assert.ok(params);
  assert.equal(params[0], 12);
  assert.equal(params[1], 'broken');
});

void test('background jobs stats, failed listing, and replay are mapped correctly', async () => {
  let calls = 0;
  const pool = new PoolMock(() => {
    calls += 1;
    if (calls === 1) {
      return {
        rows: [
          {
            job_type: 'recommendations_rebuild',
            pending_count: '2',
            running_count: '1',
            failed_count: '3',
            succeeded_count: '10',
            oldest_pending_seconds: '123.5'
          },
          {
            job_type: 'metadata_enrichment_run',
            pending_count: '0',
            running_count: '0',
            failed_count: '0',
            succeeded_count: '1',
            oldest_pending_seconds: null
          }
        ],
        rowCount: 2
      };
    }
    if (calls === 2) {
      return {
        rows: [
          {
            id: 5,
            job_type: 'release_monitor_game',
            attempts: 5,
            max_attempts: 5,
            available_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            finished_at: '2026-01-01T00:01:00.000Z',
            last_error: 'failed',
            payload: { igdb_game_id: '1' }
          }
        ],
        rowCount: 1
      };
    }
    return {
      rows: [{ id: 5 }, { id: 6 }],
      rowCount: 2
    };
  });
  const repository = new BackgroundJobRepository(pool as never);

  const stats = await repository.getTypeStats();
  assert.equal(stats.length, 2);
  assert.equal(stats[0]?.pending, 2);
  assert.equal(stats[0]?.oldestPendingSeconds, 123.5);
  assert.equal(stats[1]?.oldestPendingSeconds, null);

  const failed = await repository.listFailed({ limit: 50 });
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.jobType, 'release_monitor_game');
  assert.deepEqual(failed[0]?.payload, { igdb_game_id: '1' });

  const replay = await repository.requeueFailed({ limit: 10 });
  assert.deepEqual(replay, { requeuedCount: 2, jobIds: [5, 6] });
  const replayQuery = pool.queries[2];
  assert.ok(replayQuery);
  const normalizedReplaySql = replayQuery.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(normalizedReplaySql.includes("set status = 'pending'"));
  assert.ok(normalizedReplaySql.includes('attempts = 0'));
  assert.ok(normalizedReplaySql.includes('last_error = null'));
  assert.ok(normalizedReplaySql.includes('finished_at = null'));
});

void test('background jobs requeueStaleRunning resets stale running jobs to pending', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 15 }, { id: 16 }],
    rowCount: 2
  }));
  const repository = new BackgroundJobRepository(pool as never);

  const result = await repository.requeueStaleRunning({
    maxAgeMinutes: 45,
    limit: 2,
    jobType: 'recommendations_rebuild',
    recoveryError: 'stale lock recovered'
  });
  assert.deepEqual(result, { requeuedCount: 2, jobIds: [15, 16] });

  const query = pool.queries[0];
  assert.ok(query);
  const normalizedSql = query.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(normalizedSql.includes("where status = 'running'"));
  assert.ok(normalizedSql.includes('locked_at < (now() - make_interval(mins => $1))'));
  assert.ok(normalizedSql.includes("set status = 'pending'"));
  assert.deepEqual(query.params, [45, 'recommendations_rebuild', 2, 'stale lock recovered']);
});

void test('background jobs purgeFinishedOlderThan deletes terminal rows with bounded inputs', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 11 }, { id: 12 }],
    rowCount: 2
  }));
  const repository = new BackgroundJobRepository(pool as never);

  const result = await repository.purgeFinishedOlderThan({
    retentionDays: 0,
    limit: 999_999
  });
  assert.deepEqual(result, { deletedCount: 2, jobIds: [11, 12] });

  const params = pool.queries[0]?.params;
  assert.ok(params);
  assert.equal(params[0], 1);
  assert.equal(params[1], 10_000);
});
