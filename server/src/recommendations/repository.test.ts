import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationRepository } from './repository.js';

class PoolMock {
  public queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  constructor(
    private readonly handler: (
      sql: string,
      params: unknown[] | undefined
    ) => { rows: unknown[]; rowCount?: number } = () => ({
      rows: []
    })
  ) {}

  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number }> {
    this.queries.push({ sql, params });
    const result = this.handler(sql, params);
    return Promise.resolve({
      rows: result.rows,
      rowCount: typeof result.rowCount === 'number' ? result.rowCount : result.rows.length
    });
  }

  connect(): Promise<never> {
    return Promise.reject(new Error('connect should not be called in this test'));
  }
}

void test('enqueueRecommendationRebuildJob inserts, dedupes, and falls back', async () => {
  let calls = 0;
  const pool = new PoolMock(() => {
    calls += 1;
    if (calls === 1) {
      return { rows: [{ id: 10 }], rowCount: 1 };
    }
    if (calls === 2) {
      return { rows: [], rowCount: 0 };
    }
    if (calls === 3) {
      return { rows: [{ id: 11 }], rowCount: 1 };
    }
    if (calls === 4) {
      return { rows: [], rowCount: 0 };
    }
    if (calls === 5) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [{ id: 12 }], rowCount: 1 };
  });
  const repository = new RecommendationRepository(pool as never);

  const inserted = await repository.enqueueRecommendationRebuildJob({
    target: 'BACKLOG',
    force: false,
    triggeredBy: 'scheduler',
    reason: 'stale'
  });
  assert.deepEqual(inserted, { jobId: 10, deduped: false });

  const deduped = await repository.enqueueRecommendationRebuildJob({
    target: 'BACKLOG',
    force: false,
    triggeredBy: 'scheduler',
    reason: 'stale'
  });
  assert.deepEqual(deduped, { jobId: 11, deduped: true });

  const fallback = await repository.enqueueRecommendationRebuildJob({
    target: 'WISHLIST',
    force: true,
    triggeredBy: 'manual',
    reason: 'forced'
  });
  assert.deepEqual(fallback, { jobId: 12, deduped: false });
});

void test('completeBackgroundJob and failBackgroundJob execute update statements', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 1 }));
  const repository = new RecommendationRepository(pool as never);

  await repository.completeBackgroundJob(9, { ok: true });
  await repository.failBackgroundJob(9, 'error');

  assert.equal(pool.queries.length, 2);
  assert.equal(pool.queries[0]?.params?.[0], 9);
  assert.equal(pool.queries[1]?.params?.[0], 9);
});

void test('recommendation repository includes capped rows eligible for rearm in discovery selection SQL', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ igdb_game_id: '26836', platform_igdb_id: 6, payload: { title: 'Project: Gorgon' } }]
  }));
  const repository = new RecommendationRepository(pool as never);

  const rows = await repository.listDiscoveryRowsMissingEnrichment(5, undefined, {
    nowIso: '2026-03-10T00:00:00.000Z',
    maxAttempts: 6,
    rearmAfterDays: 30,
    rearmRecentReleaseYears: 1
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.igdbGameId, '26836');

  const query = pool.queries[0];
  assert.ok(query);
  const sql = query.sql;

  assert.equal(sql.includes('release_year'), true);
  assert.equal(sql.includes('hltb_last_tried_at_ts'), true);
  assert.equal(sql.includes('metacritic_last_tried_at_ts'), true);
  assert.equal(sql.includes('(hltb_permanent_miss OR hltb_attempts >= $2)'), true);
  assert.equal(sql.includes('(metacritic_permanent_miss OR metacritic_attempts >= $2)'), true);
  assert.equal(sql.includes('make_interval(days => $4)'), true);
  assert.equal(sql.includes('(release_year IS NULL OR release_year >= $5)'), true);
  assert.deepEqual(query.params, [5, 6, '2026-03-10T00:00:00.000Z', 30, 2026]);
});

void test('readSimilarGames falls back to NEUTRAL similarity rows for runtime-specific queries', async () => {
  const pool = new PoolMock((sql) => {
    if (sql.includes('FROM recommendation_runs')) {
      return {
        rows: [
          {
            id: 21,
            target: 'BACKLOG',
            status: 'SUCCESS',
            settings_hash: 's',
            input_hash: 'i',
            started_at: '2026-03-01T00:00:00.000Z',
            finished_at: '2026-03-01T00:10:00.000Z',
            error: null
          }
        ]
      };
    }

    if (sql.includes('FROM game_similarity')) {
      return {
        rows: [
          {
            similar_igdb_game_id: '200',
            similar_platform_igdb_id: 6,
            similarity: '0.91',
            reasons: { summary: 'fallback' }
          }
        ]
      };
    }

    return { rows: [] };
  });
  const repository = new RecommendationRepository(pool as never);

  const rows = await repository.readSimilarGames({
    igdbGameId: '100',
    platformIgdbId: 6,
    target: 'BACKLOG',
    runtimeMode: 'LONG',
    limit: 5
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.igdbGameId, '200');
  assert.equal(rows[0]?.similarity, 0.91);

  const similarityQuery = pool.queries.find((query) => query.sql.includes('FROM game_similarity'));
  assert.ok(similarityQuery);
  assert.ok(similarityQuery.params);
  assert.equal(similarityQuery.sql.includes('runtime_mode = ANY(ARRAY[$3::text, $4::text])'), true);
  assert.equal(similarityQuery.sql.includes('ROW_NUMBER() OVER'), true);
  assert.equal(similarityQuery.params[2], 'LONG');
  assert.equal(similarityQuery.params[3], 'NEUTRAL');
});
