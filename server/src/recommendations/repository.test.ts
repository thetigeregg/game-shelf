import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationRepository } from './repository.js';

class PoolMock {
  public queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  constructor(
    private readonly handler: (
      sql: string,
      params: unknown[] | undefined
    ) => { rows: unknown[] } = () => ({
      rows: []
    })
  ) {}

  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    return Promise.resolve(this.handler(sql, params));
  }

  connect(): Promise<never> {
    return Promise.reject(new Error('connect should not be called in this test'));
  }
}

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
