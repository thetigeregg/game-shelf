import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerMetacriticCachedRoute } from './metacritic-cache.js';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';

function toPrimitiveString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

class MetacriticPoolMock {
  private readonly rowsByKey = new Map<string, { response_json: unknown; updated_at: string }>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      now?: () => number;
    } = {}
  ) {}

  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json, updated_at from metacritic_search_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = toPrimitiveString(params[0]);
      const row = this.rowsByKey.get(key);
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (normalized.startsWith('insert into metacritic_search_cache')) {
      const key = toPrimitiveString(params[0]);
      const payload = JSON.parse(toPrimitiveString(params[5]) || 'null') as unknown;
      const nowMs = this.options.now ? this.options.now() : Date.now();
      this.rowsByKey.set(key, {
        response_json: payload,
        updated_at: new Date(nowMs).toISOString()
      });
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('delete from metacritic_search_cache where cache_key')) {
      const key = toPrimitiveString(params[0]);
      this.rowsByKey.delete(key);
      return Promise.resolve({ rows: [] });
    }

    throw new Error(`Unsupported SQL in MetacriticPoolMock: ${sql}`);
  }

  getEntryCount(): number {
    return this.rowsByKey.size;
  }

  seed(cacheKey: string, payload: unknown, updatedAt: string): void {
    this.rowsByKey.set(cacheKey, {
      response_json: payload,
      updated_at: updatedAt
    });
  }
}

void test('METACRITIC cache stores on miss and serves on hit', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: { metacriticScore: 20 }, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Okami&releaseYear=2006&platform=Wii'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami&releaseYear=2006&platform=wii'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-metacritic-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.metacritic.misses, 1);
  assert.equal(metrics.metacritic.hits, 1);
  assert.equal(metrics.metacritic.writes, 1);

  await app.close();
});

void test('METACRITIC cache supports candidates when includeCandidates is enabled', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: null,
          candidates: [{ metacriticScore: 18 }]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami&includeCandidates=true'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(pool.getEntryCount(), 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami&includeCandidates=true'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-metacritic-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  await app.close();
});

void test('METACRITIC cache stale revalidation handles failures and skip when already in-flight', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new MetacriticPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ item: { metacriticScore: 5 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (fetchCalls === 2) {
        return new Response('upstream error', { status: 500 });
      }

      return new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    now: () => nowMs,
    freshTtlSeconds: 1,
    staleTtlSeconds: 100,
    scheduleBackgroundRefresh: (task) => {
      pendingTask = task;
    }
  });

  await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=chrono'
  });

  nowMs += 2_000;
  const staleOne = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=chrono'
  });
  assert.equal(staleOne.headers['x-gameshelf-metacritic-cache'], 'HIT_STALE');
  assert.equal(staleOne.headers['x-gameshelf-metacritic-revalidate'], 'scheduled');

  const staleTwo = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=chrono'
  });
  assert.equal(staleTwo.headers['x-gameshelf-metacritic-cache'], 'HIT_STALE');
  assert.equal(staleTwo.headers['x-gameshelf-metacritic-revalidate'], 'skipped');

  const task = pendingTask;
  assert.ok(task);
  await task();

  nowMs += 2_000;
  await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=chrono'
  });
  const taskTwo = pendingTask;
  assert.ok(taskTwo);
  await taskTwo();

  const metrics = getCacheMetrics();
  assert.ok(metrics.metacritic.revalidateScheduled >= 2);
  assert.ok(metrics.metacritic.revalidateSkipped >= 1);
  assert.ok(metrics.metacritic.revalidateFailed >= 1);

  await app.close();
});

void test('METACRITIC cache bypasses cache when query is too short', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=a'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=a'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(second.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(fetchCalls, 2);
  assert.equal(pool.getEntryCount(), 0);

  await app.close();
});

void test('METACRITIC cache deletes stale invalid payload and fetches fresh response', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  // Cache key for q=okami with default query params.
  pool.seed(
    'e8ac7720f010ff28fe7aa9a5be0c4cdf2bb4da8b2fcf5ec8dbde76375f787bf4',
    { item: null, candidates: [] },
    new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString()
  );

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: { metacriticScore: 12 }, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);

  await app.close();
});

void test('METACRITIC cache serves stale and revalidates in background', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 18, 0, 0);
  const pool = new MetacriticPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingRefreshTask: (() => Promise<void>) | null = null;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            metacriticScore: fetchCalls === 1 ? 10 : 11
          },
          candidates: []
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    },
    now: () => nowMs,
    freshTtlSeconds: 10,
    staleTtlSeconds: 100,
    scheduleBackgroundRefresh: (task) => {
      pendingRefreshTask = task;
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  nowMs += 20_000;

  const stale = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(stale.headers['x-gameshelf-metacritic-cache'], 'HIT_STALE');
  assert.equal(stale.headers['x-gameshelf-metacritic-revalidate'], 'scheduled');
  assert.equal(fetchCalls, 1);

  const refreshTask = pendingRefreshTask;

  assert.ok(refreshTask);

  await refreshTask();
  assert.equal(fetchCalls, 2);

  const freshAfterRefresh = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(freshAfterRefresh.headers['x-gameshelf-metacritic-cache'], 'HIT_FRESH');
  const payload = JSON.parse(freshAfterRefresh.body) as { item: { metacriticScore: number } };
  assert.equal(payload.item.metacriticScore, 11);

  const metrics = getCacheMetrics();
  assert.equal(metrics.metacritic.staleServed, 1);
  assert.equal(metrics.metacritic.revalidateScheduled, 1);
  assert.equal(metrics.metacritic.revalidateSucceeded, 1);

  await app.close();
});

void test('METACRITIC cache is fail-open when cache read throws', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock({ failReads: true });
  const app = Fastify();
  let fetchCalls = 0;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Super%20Metroid&releaseYear=1994&platform=SNES'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-metacritic-cache'], 'BYPASS');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.metacritic.readErrors, 1);
  assert.equal(metrics.metacritic.bypasses, 1);
  assert.equal(metrics.metacritic.misses, 1);

  await app.close();
});

void test('METACRITIC null item responses are not cached', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Afro%20Samurai&releaseYear=2009&platform=PlayStation%203'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(pool.getEntryCount(), 0);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=Afro%20Samurai&releaseYear=2009&platform=PlayStation%203'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-metacritic-cache'], 'MISS');
  assert.equal(fetchCalls, 2);
  assert.equal(pool.getEntryCount(), 0);

  const metrics = getCacheMetrics();
  assert.equal(metrics.metacritic.writes, 0);

  await app.close();
});
