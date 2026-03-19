import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';
import { __igdbCacheTestables, registerIgdbCachedByIdRoute } from './igdb-cache.js';

function toPrimitiveString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

class IgdbPoolMock {
  private readonly rowsByKey = new Map<string, { response_json: unknown; updated_at: string }>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      now?: () => number;
    } = {}
  ) {}

  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json, updated_at from igdb_game_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = toPrimitiveString(params[0]);
      const row = this.rowsByKey.get(key);
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (normalized.startsWith('insert into igdb_game_cache')) {
      const key = toPrimitiveString(params[0]);
      const payload = JSON.parse(toPrimitiveString(params[2]) || 'null') as unknown;
      const nowMs = this.options.now ? this.options.now() : Date.now();
      this.rowsByKey.set(key, {
        response_json: payload,
        updated_at: new Date(nowMs).toISOString(),
      });
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('delete from igdb_game_cache where cache_key')) {
      const key = toPrimitiveString(params[0]);
      this.rowsByKey.delete(key);
      return Promise.resolve({ rows: [] });
    }

    throw new Error(`Unsupported SQL in IgdbPoolMock: ${sql}`);
  }

  getEntryCount(): number {
    return this.rowsByKey.size;
  }

  seed(gameId: string, payload: unknown, updatedAt: string): void {
    this.rowsByKey.set(gameId, {
      response_json: payload,
      updated_at: updatedAt,
    });
  }
}

function buildPayload(
  gameId: string,
  title = 'Super Metroid'
): { item: { igdbGameId: string; title: string } } {
  return {
    item: {
      igdbGameId: gameId,
      title,
    },
  };
}

void test('IGDB cache stores on miss and serves fresh hit', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: (gameId) => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload(gameId, 'Chrono Trigger')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/games/321',
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-igdb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/games/321',
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-igdb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.misses, 1);
  assert.equal(metrics.igdb.hits, 1);
  assert.equal(metrics.igdb.writes, 1);

  await app.close();
});

void test('IGDB cache serves stale entry and schedules only one revalidation per key', async () => {
  resetCacheMetrics();
  const nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new IgdbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  pool.seed(
    '99',
    buildPayload('99', 'Before Refresh'),
    new Date(nowMs - 8 * 86400 * 1000).toISOString()
  );

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    now: () => nowMs,
    fetchMetadata: (gameId) => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload(gameId, 'After Refresh')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
    scheduleBackgroundRefresh: (task) => {
      pendingTask = task;
    },
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/games/99',
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-igdb-cache'], 'HIT_STALE');
  assert.equal(first.headers['x-gameshelf-igdb-revalidate'], 'scheduled');
  assert.equal(fetchCalls, 0);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/games/99',
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-igdb-cache'], 'HIT_STALE');
  assert.equal(second.headers['x-gameshelf-igdb-revalidate'], 'skipped');
  assert.equal(fetchCalls, 0);

  assert.notEqual(pendingTask, null);
  await pendingTask?.();

  const third = await app.inject({
    method: 'GET',
    url: '/v1/games/99',
  });
  assert.equal(third.statusCode, 200);
  assert.equal(third.headers['x-gameshelf-igdb-cache'], 'HIT_FRESH');
  assert.match(third.body, /After Refresh/);
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.hits, 3);
  assert.equal(metrics.igdb.staleServed, 2);
  assert.equal(metrics.igdb.revalidateScheduled, 1);
  assert.equal(metrics.igdb.revalidateSkipped, 1);
  assert.equal(metrics.igdb.revalidateSucceeded, 1);

  await app.close();
});

void test('IGDB stale revalidation cleans up in-flight state when scheduling throws', async () => {
  resetCacheMetrics();
  const nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new IgdbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let scheduleCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  pool.seed(
    '199',
    buildPayload('199', 'Before Refresh'),
    new Date(nowMs - 8 * 86400 * 1000).toISOString()
  );

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    now: () => nowMs,
    fetchMetadata: (gameId) => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload(gameId, 'After Refresh')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
    scheduleBackgroundRefresh: (task) => {
      scheduleCalls += 1;
      if (scheduleCalls === 1) {
        throw new Error('queue_unavailable');
      }
      pendingTask = task;
    },
  });

  const first = await app.inject({ method: 'GET', url: '/v1/games/199' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-igdb-cache'], 'HIT_STALE');
  assert.equal(first.headers['x-gameshelf-igdb-revalidate'], 'skipped');

  const second = await app.inject({ method: 'GET', url: '/v1/games/199' });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-igdb-cache'], 'HIT_STALE');
  assert.equal(second.headers['x-gameshelf-igdb-revalidate'], 'scheduled');

  assert.notEqual(pendingTask, null);
  await pendingTask?.();

  const third = await app.inject({ method: 'GET', url: '/v1/games/199' });
  assert.equal(third.statusCode, 200);
  assert.equal(third.headers['x-gameshelf-igdb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.hits, 3);
  assert.equal(metrics.igdb.staleServed, 2);
  assert.equal(metrics.igdb.revalidateScheduled, 1);
  assert.equal(metrics.igdb.revalidateSkipped, 0);
  assert.equal(metrics.igdb.revalidateSucceeded, 1);
  assert.equal(metrics.igdb.revalidateFailed, 1);

  await app.close();
});

void test('IGDB cache deletes malformed row and refreshes from worker', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  pool.seed('123', { item: { igdbGameId: '999', title: 'Wrong Game' } }, new Date().toISOString());

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: (gameId) => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload(gameId, 'Correct Game')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/123',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);
  assert.match(response.body, /Correct Game/);

  await app.close();
});

void test('IGDB cache does not persist non-cacheable upstream responses', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;
  const responses = [
    new Response(JSON.stringify({ error: 'Game not found.' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }),
    new Response(JSON.stringify({ error: 'Rate limit exceeded. Retry after 10s.' }), {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '10' },
    }),
    new Response(JSON.stringify({ error: 'Unable to fetch game data.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }),
  ];

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      const response = responses[fetchCalls] ?? responses[responses.length - 1];
      fetchCalls += 1;
      return Promise.resolve(response);
    },
  });

  const notFound = await app.inject({ method: 'GET', url: '/v1/games/1' });
  const limited = await app.inject({ method: 'GET', url: '/v1/games/2' });
  const failed = await app.inject({ method: 'GET', url: '/v1/games/3' });

  assert.equal(notFound.statusCode, 404);
  assert.equal(limited.statusCode, 429);
  assert.equal(failed.statusCode, 502);
  assert.equal(pool.getEntryCount(), 0);
  assert.equal(fetchCalls, 3);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.misses, 3);
  assert.equal(metrics.igdb.writes, 0);

  await app.close();
});

void test('IGDB cache bypasses invalid game ids without upstream fetch', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response(null, { status: 500 }));
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/not-a-number',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'BYPASS');
  assert.equal(fetchCalls, 0);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.bypasses, 1);
  assert.equal(metrics.igdb.misses, 0);

  await app.close();
});

void test('IGDB cache canonicalizes leading-zero ids to the cached IGDB id', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  pool.seed('123', buildPayload('123', 'Canonical Game'), new Date().toISOString());

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload('123', 'Fetched Game')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/00123',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 0);
  assert.match(response.body, /Canonical Game/);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.hits, 1);
  assert.equal(metrics.igdb.misses, 0);

  await app.close();
});

void test('IGDB cache bypasses zero game ids without upstream fetch', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(new Response(null, { status: 500 }));
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/0',
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'BYPASS');
  assert.equal(fetchCalls, 0);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.bypasses, 1);
  assert.equal(metrics.igdb.misses, 0);

  await app.close();
});

void test('IGDB cache is fail-open when cache read throws', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock({ failReads: true });
  const app = Fastify();
  let fetchCalls = 0;

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: (gameId) => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify(buildPayload(gameId, 'Read Recovery')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/456',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'BYPASS');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.readErrors, 1);
  assert.equal(metrics.igdb.bypasses, 1);
  assert.equal(metrics.igdb.misses, 0);

  await app.close();
});

void test('IGDB cache forwards invalid JSON success responses without caching', async () => {
  resetCacheMetrics();
  const pool = new IgdbPoolMock();
  const app = Fastify();

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      ),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/games/77',
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-igdb-cache'], 'MISS');
  assert.equal(response.body, 'not-json');
  assert.equal(pool.getEntryCount(), 0);

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.misses, 1);
  assert.equal(metrics.igdb.writes, 0);

  await app.close();
});

void test('IGDB stale revalidation records failures for non-ok and invalid payload responses', async () => {
  resetCacheMetrics();
  const nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new IgdbPoolMock({ now: () => nowMs });
  const app = Fastify();
  const pendingTasks: Array<() => Promise<void>> = [];
  const responses = [
    new Response(null, { status: 503 }),
    new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ];
  let fetchCalls = 0;

  pool.seed(
    '88',
    buildPayload('88', 'Before Refresh'),
    new Date(nowMs - 8 * 86400 * 1000).toISOString()
  );
  pool.seed(
    '89',
    buildPayload('89', 'Before Refresh'),
    new Date(nowMs - 8 * 86400 * 1000).toISOString()
  );

  await registerIgdbCachedByIdRoute(app, pool as unknown as Pool, {
    now: () => nowMs,
    fetchMetadata: () => {
      const response = responses[fetchCalls] ?? responses[responses.length - 1];
      fetchCalls += 1;
      return Promise.resolve(response);
    },
    scheduleBackgroundRefresh: (task) => {
      pendingTasks.push(task);
    },
  });

  const first = await app.inject({ method: 'GET', url: '/v1/games/88' });
  const second = await app.inject({ method: 'GET', url: '/v1/games/89' });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(pendingTasks.length, 2);

  await pendingTasks[0]?.();
  await pendingTasks[1]?.();

  const metrics = getCacheMetrics();
  assert.equal(metrics.igdb.revalidateScheduled, 2);
  assert.equal(metrics.igdb.revalidateFailed, 2);
  assert.equal(metrics.igdb.revalidateSucceeded, 0);

  await app.close();
});

void test('IGDB helper utilities normalize age and cacheability guards', () => {
  const nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);

  assert.equal(__igdbCacheTestables.getAgeSeconds('invalid-date', nowMs), Number.POSITIVE_INFINITY);
  assert.equal(
    __igdbCacheTestables.getAgeSeconds(new Date(nowMs + 60_000).toISOString(), nowMs),
    0
  );

  assert.equal(__igdbCacheTestables.isCacheableIgdbPayload({ gameId: '1' }, null), false);
  assert.equal(__igdbCacheTestables.isCacheableIgdbPayload({ gameId: '1' }, {}), false);
  assert.equal(
    __igdbCacheTestables.isCacheableIgdbPayload(
      { gameId: '1' },
      { item: { igdbGameId: '1', title: '  ' } }
    ),
    false
  );
});
