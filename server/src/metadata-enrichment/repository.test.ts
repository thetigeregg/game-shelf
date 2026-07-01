import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataEnrichmentRepository } from './repository.js';

class PoolMock {
  public queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  constructor(
    private readonly handlers: {
      onQuery?: (sql: string, params: unknown[] | undefined) => { rows: unknown[] };
      onConnect?: () => {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
        release: () => void;
      };
    } = {}
  ) {}

  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });
    return Promise.resolve(
      this.handlers.onQuery ? this.handlers.onQuery(sql, params) : { rows: [] }
    );
  }

  connect(): Promise<{
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }> {
    if (this.handlers.onConnect) {
      return Promise.resolve(this.handlers.onConnect());
    }

    return Promise.reject(new Error('connect handler missing'));
  }
}

void test('repository selects rows missing enrichment markers', async () => {
  const pool = new PoolMock({
    onQuery: () => ({
      rows: [{ igdb_game_id: '1520', platform_igdb_id: 4, payload: { title: 'Game' } }],
    }),
  });
  const repository = new MetadataEnrichmentRepository(pool as never);

  const rows = await repository.listRowsMissingMetadata({ limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.igdbGameId, '1520');
  assert.equal(rows[0]?.platformIgdbId, 4);

  const sql = pool.queries[0]?.sql ?? '';
  assert.equal(
    sql.includes("COALESCE(NULLIF(payload ->> 'taxonomyEnrichedAt', ''), '') = ''"),
    true
  );
  assert.equal(
    sql.includes("COALESCE(payload ->> 'listType', '') IN ('collection', 'wishlist')"),
    true
  );
  assert.equal(sql.includes("COALESCE(NULLIF(payload ->> 'mediaEnrichedAt', ''), '') = ''"), true);
  assert.equal(sql.includes("COALESCE(NULLIF(payload ->> 'steamEnrichedAt', ''), '') = ''"), true);
  assert.equal(
    sql.includes("COALESCE(NULLIF(payload ->> 'websitesEnrichedAt', ''), '') = ''"),
    true
  );
  assert.equal(sql.includes("NOT (payload ? 'websites')"), true);
  assert.equal(
    sql.includes(
      "jsonb_array_length(CASE WHEN jsonb_typeof(payload -> 'websites') = 'array' THEN payload -> 'websites' ELSE '[]'::jsonb END) = 0"
    ),
    true
  );
  assert.equal(/metadataSyncEnqueuedAt/.test(sql), true);
});

void test('repository passes refresh params as $2 and $3 with default 0 when omitted', async () => {
  const pool = new PoolMock({ onQuery: () => ({ rows: [] }) });
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.listRowsMissingMetadata({ limit: 10 });
  assert.deepEqual(pool.queries[0]?.params, [10, 0, 0]);
});

void test('repository passes refresh params when provided', async () => {
  const pool = new PoolMock({ onQuery: () => ({ rows: [] }) });
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.listRowsMissingMetadata({ limit: 5, refreshMonths: 6, refreshDays: 30 });
  assert.deepEqual(pool.queries[0]?.params, [5, 6, 30]);
});

void test('repository SQL includes periodic re-enrichment arm', async () => {
  const pool = new PoolMock({ onQuery: () => ({ rows: [] }) });
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.listRowsMissingMetadata({ limit: 10, refreshMonths: 6, refreshDays: 30 });
  const sql = pool.queries[0]?.sql ?? '';

  assert.equal(sql.includes('$2 > 0 AND $3 > 0'), true);
  assert.equal(
    sql.includes("COALESCE(NULLIF(payload ->> 'taxonomyEnrichedAt', ''), '') <> ''"),
    true
  );
  assert.equal(sql.includes("payload ->> 'releaseDate' ~ '^\\d{4}-\\d{2}-\\d{2}'"), true);
  assert.equal(
    sql.includes("pg_input_is_valid(LEFT(payload ->> 'releaseDate', 10), 'date')"),
    true
  );
  assert.equal(sql.includes("LEFT(payload ->> 'releaseDate', 10)::date <= CURRENT_DATE"), true);
  assert.equal(
    sql.includes(
      "LEFT(payload ->> 'releaseDate', 10)::date >= CURRENT_DATE - ($2 * INTERVAL '1 month')"
    ),
    true
  );
  assert.equal(sql.includes("payload ->> 'taxonomyEnrichedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'"), true);
  assert.equal(
    sql.includes("pg_input_is_valid(payload ->> 'taxonomyEnrichedAt', 'timestamptz')"),
    true
  );
  assert.equal(
    sql.includes(
      "(payload ->> 'taxonomyEnrichedAt')::timestamptz <= NOW() - ($3 * INTERVAL '1 day')"
    ),
    true
  );
  // Arm 2 (WHERE clause) must not gate on metadataSyncEnqueuedAt — older rows without the sync
  // marker backfilled should still qualify for periodic refresh.
  // With the CTE refactor, Arm 2 is simply `OR is_periodic_refresh` with no extra predicates.
  const arm2Match = sql.match(/OR is_periodic_refresh\s*\n/);
  assert.ok(arm2Match, 'WHERE must include plain `OR is_periodic_refresh` as Arm 2');
  // The CTE predicate itself (computed once) must not depend on metadataSyncEnqueuedAt.
  const cteBody = sql.slice(sql.indexOf('WITH candidates'), sql.indexOf('FROM candidates'));
  assert.equal(cteBody.includes('metadataSyncEnqueuedAt'), false);
});

void test('repository maps is_periodic_refresh false from SQL column', async () => {
  const pool = new PoolMock({
    onQuery: () => ({
      rows: [
        {
          igdb_game_id: '1',
          platform_igdb_id: 6,
          payload: { title: 'Arm 1 Row' },
          is_periodic_refresh: false,
        },
      ],
    }),
  });
  const repository = new MetadataEnrichmentRepository(pool as never);

  const rows = await repository.listRowsMissingMetadata({ limit: 10 });
  assert.equal(rows[0]?.isPeriodicRefresh, false);
});

void test('repository maps is_periodic_refresh true from SQL column', async () => {
  const pool = new PoolMock({
    onQuery: () => ({
      rows: [
        {
          igdb_game_id: '2',
          platform_igdb_id: 6,
          payload: { title: 'Arm 2 Row' },
          is_periodic_refresh: true,
        },
      ],
    }),
  });
  const repository = new MetadataEnrichmentRepository(pool as never);

  const rows = await repository.listRowsMissingMetadata({ limit: 10 });
  assert.equal(rows[0]?.isPeriodicRefresh, true);
});

void test('repository SQL emits is_periodic_refresh CASE expression matching Arm 2 predicates', async () => {
  const pool = new PoolMock({ onQuery: () => ({ rows: [] }) });
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.listRowsMissingMetadata({ limit: 10, refreshMonths: 6, refreshDays: 30 });
  const sql = pool.queries[0]?.sql ?? '';

  // The SELECT list must include the CASE expression for is_periodic_refresh.
  assert.equal(sql.includes('AS is_periodic_refresh'), true);
  // The CASE must use the same $2/$3 gate as Arm 2.
  const caseStart = sql.indexOf('CASE WHEN');
  const caseEnd = sql.indexOf('AS is_periodic_refresh', caseStart);
  const caseExpr = sql.slice(caseStart, caseEnd);
  assert.equal(caseExpr.includes('$2 > 0 AND $3 > 0'), true);
  assert.equal(
    caseExpr.includes("pg_input_is_valid(LEFT(payload ->> 'releaseDate', 10), 'date')"),
    true
  );
  assert.equal(
    caseExpr.includes(
      "LEFT(payload ->> 'releaseDate', 10)::date >= CURRENT_DATE - ($2 * INTERVAL '1 month')"
    ),
    true
  );
  assert.equal(
    caseExpr.includes("pg_input_is_valid(payload ->> 'taxonomyEnrichedAt', 'timestamptz')"),
    true
  );
  assert.equal(
    caseExpr.includes(
      "(payload ->> 'taxonomyEnrichedAt')::timestamptz <= NOW() - ($3 * INTERVAL '1 day')"
    ),
    true
  );
});

void test('repository wraps callback with advisory lock and unlock', async () => {
  const queries: string[] = [];
  const repository = new MetadataEnrichmentRepository(
    new PoolMock({
      onConnect: () => ({
        query: (sql: string) => {
          queries.push(sql);
          if (sql.includes('pg_try_advisory_lock')) {
            return Promise.resolve({ rows: [{ acquired: true }] });
          }
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined,
      }),
    }) as never
  );

  const result = await repository.withAdvisoryLock(() => Promise.resolve('ok'));
  assert.equal(result.acquired, true);
  assert.equal(result.value, 'ok');
  assert.equal(
    queries.some((sql) => sql.includes('pg_try_advisory_lock')),
    true
  );
  assert.equal(
    queries.some((sql) => sql.includes('pg_advisory_unlock')),
    true
  );
});

void test('repository update writes sync event for changed game payload', async () => {
  const pool = new PoolMock();
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.updateGamePayload({
    igdbGameId: '1520',
    platformIgdbId: 6,
    payloadPatch: { title: 'Mario', themes: ['Action'] },
  });

  const sql = pool.queries[0]?.sql ?? '';
  assert.equal(sql.includes('WITH updated AS'), true);
  assert.equal(sql.includes('payload IS DISTINCT FROM (games.payload || $3::jsonb)'), true);
  assert.equal(sql.includes('INSERT INTO sync_events'), true);
  assert.equal(sql.includes("'game'"), true);
  assert.equal(sql.includes("'upsert'"), true);
  assert.deepEqual(pool.queries[0]?.params, [
    '1520',
    6,
    JSON.stringify({ title: 'Mario', themes: ['Action'] }),
  ]);
});

void test('repository force mode bypasses date-gating and marks rows as periodic refresh', async () => {
  const pool = new PoolMock({
    onQuery: () => ({
      rows: [
        {
          igdb_game_id: '1520',
          platform_igdb_id: 4,
          payload: {
            title: 'Fully Enriched Game',
            taxonomyEnrichedAt: '2026-06-01T00:00:00.000Z',
            mediaEnrichedAt: '2026-06-01T00:00:00.000Z',
            steamEnrichedAt: '2026-06-01T00:00:00.000Z',
            websitesEnrichedAt: '2026-06-01T00:00:00.000Z',
            metadataSyncEnqueuedAt: '2026-06-01T00:00:00.000Z',
          },
          is_periodic_refresh: true,
        },
      ],
    }),
  });
  const repository = new MetadataEnrichmentRepository(pool as never);

  const rows = await repository.listRowsMissingMetadata({ limit: 10, force: true });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.isPeriodicRefresh, true);
  const sql = pool.queries[0]?.sql ?? '';
  assert.equal(
    sql.includes("COALESCE(payload ->> 'listType', '') IN ('collection', 'wishlist')"),
    true
  );
  assert.equal(sql.includes('is_periodic_refresh'), true);
  assert.equal(sql.includes('taxonomyEnrichedAt'), false);
  assert.deepEqual(pool.queries[0]?.params, [10]);
});

void test('repository non-force mode ignores the force param and runs the gated query', async () => {
  const pool = new PoolMock({ onQuery: () => ({ rows: [] }) });
  const repository = new MetadataEnrichmentRepository(pool as never);

  await repository.listRowsMissingMetadata({ limit: 10, force: false });

  const sql = pool.queries[0]?.sql ?? '';
  assert.equal(sql.includes('Arm 1'), true);
  assert.deepEqual(pool.queries[0]?.params, [10, 0, 0]);
});
