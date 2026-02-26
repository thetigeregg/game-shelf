import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { incrementHltbMetric, incrementImageMetric, resetCacheMetrics } from './cache-metrics.js';

type CacheStatsPayload = {
  counts: {
    imageAssets: number | null;
    hltbEntries: number | null;
  };
  metrics: {
    image: {
      hits: number;
      misses: number;
    };
    hltb: {
      hits: number;
      writes: number;
    };
  };
  dbError: string | null;
};

function parseJson(body: string): unknown {
  return JSON.parse(body) as unknown;
}

class CacheStatsPoolMock {
  query(sql: string): Promise<{ rows: Array<{ count: string }> }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.includes('from image_assets')) {
      return Promise.resolve({ rows: [{ count: '7' }] });
    }

    if (normalized.includes('from hltb_search_cache')) {
      return Promise.resolve({ rows: [{ count: '13' }] });
    }

    throw new Error(`Unsupported SQL in CacheStatsPoolMock: ${sql}`);
  }
}

class CacheStatsFailingPoolMock {
  query(): Promise<{ rows: unknown[] }> {
    return Promise.reject(new Error('db_unavailable'));
  }
}

class CacheStatsNonErrorFailingPoolMock {
  query(): Promise<{ rows: unknown[] }> {
    return Promise.reject(new Error('db_string_failure'));
  }
}

void test('Cache stats endpoint returns counters and db counts', async () => {
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
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.counts.imageAssets, 7);
  assert.equal(payload.counts.hltbEntries, 13);
  assert.equal(payload.metrics.image.hits, 1);
  assert.equal(payload.metrics.image.misses, 1);
  assert.equal(payload.metrics.hltb.hits, 1);
  assert.equal(payload.metrics.hltb.writes, 1);
  assert.equal(payload.dbError, null);

  await app.close();
});

void test('Cache stats endpoint stringifies non-Error db failures', async () => {
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
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.dbError, 'db_string_failure');

  await app.close();
});

void test('Cache stats endpoint returns dbError when count queries fail', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsFailingPoolMock() as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats'
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.counts.imageAssets, null);
  assert.equal(payload.counts.hltbEntries, null);
  assert.equal(payload.dbError, 'db_unavailable');

  await app.close();
});

void test('Cache stats endpoint is rate limited', async () => {
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

void test('Cache stats endpoint honors custom rate-limit options', async () => {
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
