import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';

class HltbPoolMock {
  private readonly rowsByKey = new Map<string, unknown>();

  constructor(private readonly options: { failReads?: boolean } = {}) {}

  async query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json from hltb_search_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = String(params[0] ?? '');
      const row = this.rowsByKey.get(key);
      return { rows: row ? [{ response_json: row } as T] : [] };
    }

    if (normalized.startsWith('insert into hltb_search_cache')) {
      const key = String(params[0] ?? '');
      const payload = JSON.parse(String(params[5] ?? 'null'));
      this.rowsByKey.set(key, payload);
      return { rows: [] };
    }

    throw new Error(`Unsupported SQL in HltbPoolMock: ${sql}`);
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
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Okami&releaseYear=2006&platform=Wii',
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami&releaseYear=2006&platform=wii',
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'HIT');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.misses, 1);
  assert.equal(metrics.hltb.hits, 1);
  assert.equal(metrics.hltb.writes, 1);

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
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Super%20Metroid&releaseYear=1994&platform=SNES',
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
