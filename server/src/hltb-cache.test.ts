import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';

class HltbPoolMock {
  private readonly rowsByKey = new Map<string, { response_json: unknown; updated_at: string }>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      now?: () => number;
    } = {}
  ) {}

  async query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json, updated_at from hltb_search_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = String(params[0] ?? '');
      const row = this.rowsByKey.get(key);
      return { rows: row ? [row as T] : [] };
    }

    if (normalized.startsWith('insert into hltb_search_cache')) {
      const key = String(params[0] ?? '');
      const payload = JSON.parse(String(params[5] ?? 'null'));
      const nowMs = this.options.now ? this.options.now() : Date.now();
      this.rowsByKey.set(key, {
        response_json: payload,
        updated_at: new Date(nowMs).toISOString()
      });
      return { rows: [] };
    }

    if (normalized.startsWith('delete from hltb_search_cache where cache_key')) {
      const key = String(params[0] ?? '');
      this.rowsByKey.delete(key);
      return { rows: [] };
    }

    throw new Error(`Unsupported SQL in HltbPoolMock: ${sql}`);
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

test('HLTB cache stores on miss and serves on hit', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: { hltbMainHours: 20 }, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Okami&releaseYear=2006&platform=Wii'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami&releaseYear=2006&platform=wii'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.misses, 1);
  assert.equal(metrics.hltb.hits, 1);
  assert.equal(metrics.hltb.writes, 1);

  await app.close();
});

test('HLTB cache supports candidates when includeCandidates is enabled', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: null,
          candidates: [{ hltbMainHours: 18 }]
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
    url: '/v1/hltb/search?q=okami&includeCandidates=true'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(pool.getEntryCount(), 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami&includeCandidates=true'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  await app.close();
});

test('HLTB cache stale revalidation handles failures and skip when already in-flight', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ item: { hltbMainHours: 5 } }), {
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
    url: '/v1/hltb/search?q=chrono'
  });

  nowMs += 2_000;
  const staleOne = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=chrono'
  });
  assert.equal(staleOne.headers['x-gameshelf-hltb-cache'], 'HIT_STALE');
  assert.equal(staleOne.headers['x-gameshelf-hltb-revalidate'], 'scheduled');

  const staleTwo = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=chrono'
  });
  assert.equal(staleTwo.headers['x-gameshelf-hltb-cache'], 'HIT_STALE');
  assert.equal(staleTwo.headers['x-gameshelf-hltb-revalidate'], 'skipped');

  const task = pendingTask;
  if (!task) {
    throw new Error('Expected revalidation task');
  }
  await task();

  nowMs += 2_000;
  await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=chrono'
  });
  const taskTwo = pendingTask;
  if (!taskTwo) {
    throw new Error('Expected second revalidation task');
  }
  await taskTwo();

  const metrics = getCacheMetrics();
  assert.ok(metrics.hltb.revalidateScheduled >= 2);
  assert.ok(metrics.hltb.revalidateSkipped >= 1);
  assert.ok(metrics.hltb.revalidateFailed >= 1);

  await app.close();
});

test('HLTB cache bypasses cache when query is too short', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=a'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=a'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 2);
  assert.equal(pool.getEntryCount(), 0);

  await app.close();
});

test('HLTB cache deletes stale invalid payload and fetches fresh response', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  // Cache key for q=okami with default query params.
  pool.seed(
    '8e1ab85d0a4683234ba346eebe701b9506defc4f93464723461226ace18cd84a',
    { item: null, candidates: [] },
    new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString()
  );

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: { hltbMainHours: 12 }, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);

  await app.close();
});

test('HLTB cache serves stale and revalidates in background', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 18, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingRefreshTask: (() => Promise<void>) | null = null;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbMainHours: fetchCalls === 1 ? 10 : 11
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
    url: '/v1/hltb/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  nowMs += 20_000;

  const stale = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(stale.headers['x-gameshelf-hltb-cache'], 'HIT_STALE');
  assert.equal(stale.headers['x-gameshelf-hltb-revalidate'], 'scheduled');
  assert.equal(fetchCalls, 1);

  const refreshTask = pendingRefreshTask;

  if (!refreshTask) {
    throw new Error('Expected background refresh task to be scheduled');
  }

  await (refreshTask as () => Promise<void>)();
  assert.equal(fetchCalls, 2);

  const freshAfterRefresh = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(freshAfterRefresh.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  const payload = freshAfterRefresh.json() as { item: { hltbMainHours: number } };
  assert.equal(payload.item.hltbMainHours, 11);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.staleServed, 1);
  assert.equal(metrics.hltb.revalidateScheduled, 1);
  assert.equal(metrics.hltb.revalidateSucceeded, 1);

  await app.close();
});

test('HLTB cache is fail-open when cache read throws', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock({ failReads: true });
  const app = Fastify();
  let fetchCalls = 0;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null, candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Super%20Metroid&releaseYear=1994&platform=SNES'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'BYPASS');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.readErrors, 1);
  assert.equal(metrics.hltb.bypasses, 1);
  assert.equal(metrics.hltb.misses, 1);

  await app.close();
});

test('HLTB null item responses are not cached', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Afro%20Samurai&releaseYear=2009&platform=PlayStation%203'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(pool.getEntryCount(), 0);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Afro%20Samurai&releaseYear=2009&platform=PlayStation%203'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 2);
  assert.equal(pool.getEntryCount(), 0);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.writes, 0);

  await app.close();
});
