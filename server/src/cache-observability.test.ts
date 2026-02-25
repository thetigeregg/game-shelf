import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { incrementHltbMetric, incrementImageMetric, resetCacheMetrics } from './cache-metrics.js';

class CacheStatsPoolMock {
  async query<T>(sql: string): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('from image_assets')) {
      return { rows: [{ count: '7' } as T] };
    }

    if (normalized.includes('from hltb_search_cache')) {
      return { rows: [{ count: '13' } as T] };
    }

    throw new Error(`Unsupported SQL in CacheStatsPoolMock: ${sql}`);
  }
}

class CacheStatsFailingPoolMock {
  async query<T>(): Promise<{ rows: T[] }> {
    throw new Error('db_unavailable');
  }
}

class CacheStatsNonErrorFailingPoolMock {
  async query<T>(): Promise<{ rows: T[] }> {
    throw 'db_string_failure';
  }
}

test('Cache stats endpoint returns counters and db counts', async () => {
  resetCacheMetrics();
  incrementImageMetric('hits');
  incrementImageMetric('misses');
  incrementHltbMetric('hits');
  incrementHltbMetric('writes');

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.equal(payload.counts.imageAssets, 7);
  assert.equal(payload.counts.hltbEntries, 13);
  assert.equal(payload.metrics.image.hits, 1);
  assert.equal(payload.metrics.image.misses, 1);
  assert.equal(payload.metrics.hltb.hits, 1);
  assert.equal(payload.metrics.hltb.writes, 1);
  assert.equal(payload.dbError, null);

  await app.close();
});

test('Cache stats endpoint stringifies non-Error db failures', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(
    app,
    new CacheStatsNonErrorFailingPoolMock() as unknown as Pool
  );

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.equal(payload.dbError, 'db_string_failure');

  await app.close();
});

test('Cache stats endpoint returns dbError when count queries fail', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsFailingPoolMock() as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });

  assert.equal(response.statusCode, 200);
  const payload = response.json() as Record<string, any>;
  assert.equal(payload.counts.imageAssets, null);
  assert.equal(payload.counts.hltbEntries, null);
  assert.equal(payload.dbError, 'db_unavailable');

  await app.close();
});

test('Cache stats endpoint is rate limited', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool);

  for (let i = 0; i < 10; i += 1) {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/cache/stats'
    });

    assert.equal(response.statusCode, 200);
  }

  const limitedResponse = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });

  assert.equal(limitedResponse.statusCode, 429);

  await app.close();
});

test('Cache stats endpoint honors custom rate-limit options', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool, {
    cacheStatsRateLimitWindowMs: 1000,
    cacheStatsMaxRequestsPerWindow: 1
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });
  assert.equal(second.statusCode, 429);

  await app.close();
});
