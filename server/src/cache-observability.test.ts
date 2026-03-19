import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import {
  type CacheMetricSnapshot,
  incrementHltbMetric,
  incrementIgdbMetric,
  incrementImageMetric,
  incrementMetacriticMetric,
  incrementMobygamesMetric,
  incrementPspricesPriceMetric,
  incrementSteamPriceMetric,
  resetCacheMetrics,
} from './cache-metrics.js';

type CacheStatsPayload = {
  counts: {
    imageAssets: number | null;
    igdbEntries: number | null;
    hltbEntries: number | null;
    metacriticEntries: number | null;
    mobygamesEntries: number | null;
    steamPriceEntries: number | null;
    pspricesPriceEntries: number | null;
  };
  metrics: CacheMetricSnapshot;
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

    if (normalized.includes('from igdb_game_cache')) {
      return Promise.resolve({ rows: [{ count: '11' }] });
    }

    if (normalized.includes('from hltb_search_cache')) {
      return Promise.resolve({ rows: [{ count: '13' }] });
    }

    if (normalized.includes('from metacritic_search_cache')) {
      return Promise.resolve({ rows: [{ count: '17' }] });
    }

    if (normalized.includes('from mobygames_search_cache')) {
      return Promise.resolve({ rows: [{ count: '19' }] });
    }
    if (normalized.includes("payload->>'steampricefetchedat'")) {
      return Promise.resolve({ rows: [{ count: '23' }] });
    }
    if (normalized.includes("payload->>'pspricesfetchedat'")) {
      return Promise.resolve({ rows: [{ count: '29' }] });
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
  incrementIgdbMetric('hits');
  incrementIgdbMetric('writes');
  incrementHltbMetric('hits');
  incrementHltbMetric('writes');
  incrementMetacriticMetric('hits');
  incrementMetacriticMetric('writes');
  incrementMobygamesMetric('hits');
  incrementMobygamesMetric('writes');
  incrementSteamPriceMetric('hits');
  incrementSteamPriceMetric('writes');
  incrementPspricesPriceMetric('hits');
  incrementPspricesPriceMetric('writes');

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.counts.imageAssets, 7);
  assert.equal(payload.counts.igdbEntries, 11);
  assert.equal(payload.counts.hltbEntries, 13);
  assert.equal(payload.counts.metacriticEntries, 17);
  assert.equal(payload.counts.mobygamesEntries, 19);
  assert.equal(payload.counts.steamPriceEntries, 23);
  assert.equal(payload.counts.pspricesPriceEntries, 29);
  assert.equal(payload.metrics.image.hits, 1);
  assert.equal(payload.metrics.image.misses, 1);
  assert.equal(payload.metrics.igdb.hits, 1);
  assert.equal(payload.metrics.igdb.writes, 1);
  assert.equal(payload.metrics.metacritic.hits, 1);
  assert.equal(payload.metrics.metacritic.writes, 1);
  assert.equal(payload.metrics.hltb.hits, 1);
  assert.equal(payload.metrics.hltb.writes, 1);
  assert.equal(payload.metrics.mobygames.hits, 1);
  assert.equal(payload.metrics.mobygames.writes, 1);
  assert.equal(payload.metrics.steamPrice.hits, 1);
  assert.equal(payload.metrics.steamPrice.writes, 1);
  assert.equal(payload.metrics.pspricesPrice.hits, 1);
  assert.equal(payload.metrics.pspricesPrice.writes, 1);
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
    url: '/v1/cache/stats',
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
    url: '/v1/cache/stats',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.counts.imageAssets, null);
  assert.equal(payload.counts.igdbEntries, null);
  assert.equal(payload.counts.hltbEntries, null);
  assert.equal(payload.counts.metacriticEntries, null);
  assert.equal(payload.counts.mobygamesEntries, null);
  assert.equal(payload.counts.steamPriceEntries, null);
  assert.equal(payload.counts.pspricesPriceEntries, null);
  assert.equal(payload.dbError, 'db_unavailable');

  await app.close();
});

void test('Cache stats endpoint returns 0 count when db rows are empty', async () => {
  resetCacheMetrics();

  class CacheStatsEmptyRowsPoolMock {
    query(): Promise<{ rows: Array<{ count: string }> }> {
      return Promise.resolve({ rows: [] });
    }
  }

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsEmptyRowsPoolMock() as unknown as Pool);

  const response = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats',
  });

  assert.equal(response.statusCode, 200);
  const payload = parseJson(response.body) as CacheStatsPayload;
  assert.equal(payload.counts.imageAssets, 0);
  assert.equal(payload.counts.igdbEntries, 0);
  assert.equal(payload.counts.hltbEntries, 0);
  assert.equal(payload.counts.metacriticEntries, 0);
  assert.equal(payload.counts.mobygamesEntries, 0);
  assert.equal(payload.counts.steamPriceEntries, 0);
  assert.equal(payload.counts.pspricesPriceEntries, 0);
  assert.equal(payload.dbError, null);

  await app.close();
});

void test('Cache stats endpoint is rate limited', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool);

  for (let i = 0; i < 10; i += 1) {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/cache/stats',
    });

    assert.equal(response.statusCode, 200);
  }

  const limitedResponse = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats',
  });

  assert.equal(limitedResponse.statusCode, 429);

  await app.close();
});

void test('Cache stats endpoint honors custom rate-limit options', async () => {
  resetCacheMetrics();

  const app = Fastify();
  await registerCacheObservabilityRoutes(app, new CacheStatsPoolMock() as unknown as Pool, {
    cacheStatsRateLimitWindowMs: 1000,
    cacheStatsMaxRequestsPerWindow: 1,
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats',
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/cache/stats',
  });
  assert.equal(second.statusCode, 429);

  await app.close();
});
