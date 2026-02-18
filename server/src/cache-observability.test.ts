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

test('Cache stats endpoint returns counters and db counts', async () => {
  resetCacheMetrics();
  incrementImageMetric('hits');
  incrementImageMetric('misses');
  incrementHltbMetric('hits');
  incrementHltbMetric('writes');

  const app = Fastify();
  registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool);

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
