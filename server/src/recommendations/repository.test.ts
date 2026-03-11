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

void test('upsertDiscoveryGames preserves PSPrices provider keys with current field names', async () => {
  const pool = new PoolMock(() => ({ rows: [], rowCount: 1 }));
  const repository = new RecommendationRepository(pool as never);

  await repository.upsertDiscoveryGames({
    client: pool as never,
    rows: [
      {
        igdbGameId: '1',
        platformIgdbId: 130,
        payload: { title: 'Pokemon Violet', listType: 'discovery' }
      }
    ]
  });

  const query = pool.queries.find((entry) => entry.sql.includes('INSERT INTO games'));
  assert.ok(query);
  const sql = query.sql;
  assert.equal(
    sql.includes("'psPricesRegularPriceAmount', games.payload->'psPricesRegularPriceAmount'"),
    true
  );
  assert.equal(
    sql.includes("'psPricesDiscountPercent', games.payload->'psPricesDiscountPercent'"),
    true
  );
  assert.equal(sql.includes("'psPricesIsFree', games.payload->'psPricesIsFree'"), true);
  assert.equal(sql.includes("'psPricesPriceRegularAmount'"), false);
  assert.equal(sql.includes("'psPricesPriceDiscountPercent'"), false);
  assert.equal(sql.includes("'psPricesPriceIsFree'"), false);
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

void test('finalizeRunSuccess writes batched recommendation artifacts and commits transaction', async () => {
  const pool = new PoolMock(() => ({ rows: [] }));
  const repository = new RecommendationRepository(pool as never);
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const client = {
    query: (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
  };

  const buildRecommendationItem = (index: number) => ({
    igdbGameId: String(200 + index),
    platformIgdbId: 6,
    rank: index + 1,
    scoreTotal: 1.23 + index,
    scoreComponents: {
      taste: 1,
      novelty: 0,
      runtimeFit: 0,
      criticBoost: 0,
      recencyBoost: 0,
      semantic: 0,
      exploration: 0,
      diversityPenalty: 0,
      repeatPenalty: 0
    },
    explanations: {
      headline: 'h',
      bullets: [],
      matchedTokens: {
        genres: [],
        developers: [],
        publishers: [],
        franchises: [],
        collections: [],
        themes: [],
        keywords: []
      }
    }
  });
  const recommendationItems = [buildRecommendationItem(0), buildRecommendationItem(1)];

  const makeLanes = () => ({
    overall: [buildRecommendationItem(0)],
    hiddenGems: [buildRecommendationItem(1)],
    exploration: [buildRecommendationItem(0)],
    blended: [buildRecommendationItem(1)],
    popular: [buildRecommendationItem(0)],
    recent: [buildRecommendationItem(1)]
  });
  const historyUpdates = Array.from({ length: 501 }, (_, index) => ({
    target: 'BACKLOG' as const,
    runtimeMode: 'NEUTRAL' as const,
    igdbGameId: String(8000 + index),
    platformIgdbId: 6
  }));
  const similarityEdges = Array.from({ length: 501 }, (_, index) => ({
    sourceIgdbGameId: String(100 + index),
    sourcePlatformIgdbId: 6,
    similarIgdbGameId: String(200 + index),
    similarPlatformIgdbId: 6,
    similarity: 0.91,
    reasons: {
      summary: 'fallback',
      structuredSimilarity: 0.8,
      semanticSimilarity: 0.9,
      blendedSimilarity: 0.85,
      sharedTokens: {
        genres: [],
        developers: [],
        publishers: [],
        franchises: [],
        collections: [],
        themes: [],
        keywords: []
      }
    }
  }));

  await repository.finalizeRunSuccess({
    client,
    runId: 55,
    target: 'BACKLOG',
    recommendationsByMode: {
      NEUTRAL: recommendationItems,
      SHORT: recommendationItems,
      LONG: recommendationItems
    },
    lanesByMode: {
      NEUTRAL: makeLanes(),
      SHORT: makeLanes(),
      LONG: makeLanes()
    },
    historyUpdates,
    similarityEdges
  });

  assert.equal(queries[0]?.sql, 'BEGIN');
  assert.equal(queries.at(-1)?.sql, 'COMMIT');
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO recommendations')),
    true
  );
  const recommendationInserts = queries.filter((query) =>
    query.sql.includes('INSERT INTO recommendations')
  );
  assert.equal(recommendationInserts.length, 3);
  const firstRecommendationInsert = recommendationInserts[0];
  assert.ok(firstRecommendationInsert);
  assert.ok(firstRecommendationInsert.params);
  assert.equal(
    firstRecommendationInsert.sql.includes('($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb),'),
    true
  );
  assert.equal(firstRecommendationInsert.params[0], 55);
  assert.equal(firstRecommendationInsert.params[1], 'NEUTRAL');
  assert.equal(firstRecommendationInsert.params.length, 16);
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO recommendation_lanes')),
    true
  );
  const laneInserts = queries.filter((query) =>
    query.sql.includes('INSERT INTO recommendation_lanes')
  );
  assert.equal(laneInserts.length, 18);
  const firstLaneInsert = laneInserts[0];
  assert.ok(firstLaneInsert);
  assert.ok(firstLaneInsert.params);
  assert.equal(
    firstLaneInsert.sql.includes('($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)'),
    true
  );
  assert.equal(firstLaneInsert.params[0], 55);
  assert.equal(firstLaneInsert.params[1], 'NEUTRAL');
  assert.equal(firstLaneInsert.params[2], 'overall');
  const similarityInsert = queries.find((query) =>
    query.sql.includes('INSERT INTO game_similarity')
  );
  assert.ok(similarityInsert);
  assert.ok(similarityInsert.params);
  assert.equal(similarityInsert.params[2], 'NEUTRAL');
  const similarityInserts = queries.filter((query) =>
    query.sql.includes('INSERT INTO game_similarity')
  );
  assert.equal(similarityInserts.length, 2);
  assert.equal(similarityInserts[0]?.params?.length, 500 * 9);
  assert.equal(similarityInserts[1]?.params?.length, 1 * 9);
  assert.equal(
    similarityInserts[0]?.sql.includes('($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())'),
    true
  );
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO recommendation_history')),
    true
  );
  const historyInserts = queries.filter((query) =>
    query.sql.includes('INSERT INTO recommendation_history')
  );
  assert.equal(historyInserts.length, 2);
  assert.equal(historyInserts[0]?.params?.length, 500 * 4);
  assert.equal(historyInserts[1]?.params?.length, 1 * 4);
  assert.equal(historyInserts[0]?.sql.includes('($1, $2, $3, $4, 1, NOW())'), true);
  assert.equal(
    queries.some((query) => query.sql.includes('UPDATE recommendation_runs')),
    true
  );
});

void test('markRunFailed updates run status and error message', async () => {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const pool = new PoolMock(() => ({ rows: [] }));
  const repository = new RecommendationRepository(pool as never);
  const client = {
    query: (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
  };

  await repository.markRunFailed({
    client,
    runId: 77,
    errorMessage: 'boom'
  });

  assert.equal(queries.length, 1);
  assert.equal(queries[0]?.sql.includes("UPDATE recommendation_runs SET status = 'FAILED'"), true);
  assert.deepEqual(queries[0]?.params, [77, 'boom']);
});

void test('failStaleRunningRuns marks old RUNNING rows as FAILED', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 16 }, { id: 17 }],
    rowCount: 2
  }));
  const repository = new RecommendationRepository(pool as never);

  const result = await repository.failStaleRunningRuns({
    maxAgeMinutes: 30,
    target: 'BACKLOG',
    errorMessage: 'orphan recovery'
  });

  assert.deepEqual(result, { failedCount: 2, runIds: [16, 17] });
  const query = pool.queries[0];
  assert.ok(query);
  const normalizedSql = query.sql.replace(/\s+/g, ' ').trim().toLowerCase();
  assert.ok(normalizedSql.includes("where status = 'running'"));
  assert.ok(normalizedSql.includes('started_at < (now() - make_interval(mins => $1))'));
  assert.ok(normalizedSql.includes('($2::text is null or target = $2)'));
  assert.ok(normalizedSql.includes('not exists'));
  assert.ok(normalizedSql.includes('from background_jobs'));
  assert.ok(normalizedSql.includes("background_jobs.job_type = 'recommendations_rebuild'"));
  assert.deepEqual(query.params, [30, 'BACKLOG', 'orphan recovery']);
});

void test('failStaleRunningRuns clamps defaults and supports null target filter', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 90 }],
    rowCount: 1
  }));
  const repository = new RecommendationRepository(pool as never);

  const result = await repository.failStaleRunningRuns({
    maxAgeMinutes: 0,
    errorMessage: ' '
  });

  assert.deepEqual(result, { failedCount: 1, runIds: [90] });
  const query = pool.queries[0];
  assert.ok(query.params);
  assert.equal(query.params[0], 1);
  assert.equal(query.params[1], null);
  assert.equal(query.params[2], 'orphaned RUNNING run recovered after worker loss');
});

void test('failStaleRunningRuns uses defaults when params are omitted', async () => {
  const pool = new PoolMock(() => ({
    rows: [{ id: 101 }],
    rowCount: 1
  }));
  const repository = new RecommendationRepository(pool as never);

  const result = await repository.failStaleRunningRuns();

  assert.deepEqual(result, { failedCount: 1, runIds: [101] });
  const query = pool.queries[0];
  assert.ok(query.params);
  assert.equal(query.params[0], 30);
  assert.equal(query.params[1], null);
  assert.equal(query.params[2], 'orphaned RUNNING run recovered after worker loss');
});

void test('readTopRecommendations returns rows for DISCOVERY target', async () => {
  const pool = new PoolMock((sql) => {
    if (sql.includes('FROM recommendation_runs')) {
      return {
        rows: [
          {
            id: 31,
            target: 'DISCOVERY',
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

    if (sql.includes('FROM recommendations')) {
      return {
        rows: [
          {
            rank: 1,
            igdb_game_id: '300',
            platform_igdb_id: 6,
            score_total: '0.91',
            score_components: {
              taste: 0,
              novelty: 0,
              runtimeFit: 0,
              criticBoost: 0,
              recencyBoost: 0,
              semantic: 0,
              exploration: 0,
              diversityPenalty: 0,
              repeatPenalty: 0
            },
            explanations: {
              headline: 'h',
              bullets: [],
              matchedTokens: {
                genres: [],
                developers: [],
                publishers: [],
                franchises: [],
                collections: [],
                themes: [],
                keywords: []
              }
            }
          }
        ]
      };
    }

    return { rows: [] };
  });
  const repository = new RecommendationRepository(pool as never);

  const result = await repository.readTopRecommendations({
    target: 'DISCOVERY',
    runtimeMode: 'NEUTRAL',
    limit: 10
  });

  assert.ok(result);
  assert.equal(result.run.target, 'DISCOVERY');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.igdbGameId, '300');
  assert.equal(result.items[0]?.scoreTotal, 0.91);

  const recommendationQuery = pool.queries.find((query) =>
    query.sql.includes('FROM recommendations')
  );
  assert.ok(recommendationQuery?.params);
  assert.equal(recommendationQuery.params[1], 'NEUTRAL');
  assert.equal(recommendationQuery.params[2], 'discovery');
  assert.deepEqual(recommendationQuery.params[3], ['', 'wantToPlay']);
  assert.equal(recommendationQuery.params[4], 10);
});
