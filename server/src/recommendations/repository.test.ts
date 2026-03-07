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

void test('claimRecommendationRebuildJob handles empty, invalid, and valid payloads', async () => {
  let calls = 0;
  const pool = new PoolMock(() => {
    calls += 1;
    if (calls === 1) {
      return { rows: [], rowCount: 0 };
    }
    if (calls === 2) {
      return { rows: [{ id: 1, payload: { target: 'INVALID' } }], rowCount: 1 };
    }
    return {
      rows: [
        {
          id: 2,
          payload: {
            target: 'DISCOVERY',
            force: true,
            triggeredBy: 'stale-read',
            reason: 'stale'
          }
        }
      ],
      rowCount: 1
    };
  });
  const repository = new RecommendationRepository(pool as never);

  const none = await repository.claimRecommendationRebuildJob('worker-a');
  assert.equal(none, null);

  const invalid = await repository.claimRecommendationRebuildJob('worker-a');
  assert.equal(invalid, null);

  const valid = await repository.claimRecommendationRebuildJob('worker-a');
  assert.ok(valid);
  assert.equal(valid.id, 2);
  assert.equal(valid.target, 'DISCOVERY');
  assert.equal(valid.force, true);
  assert.equal(valid.triggeredBy, 'stale-read');
  assert.equal(valid.reason, 'stale');
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
