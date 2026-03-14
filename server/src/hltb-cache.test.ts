import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { processQueuedHltbCacheRevalidation, registerHltbCachedRoute } from './hltb-cache.js';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';

interface HltbCandidateResponseBody {
  candidates?: Array<{
    imageUrl?: string | null;
  }>;
}

function toPrimitiveString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

class HltbPoolMock {
  private readonly rowsByKey = new Map<string, { response_json: unknown; updated_at: string }>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      now?: () => number;
    } = {}
  ) {}

  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json, updated_at from hltb_search_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = toPrimitiveString(params[0]);
      const row = this.rowsByKey.get(key);
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (normalized.startsWith('insert into hltb_search_cache')) {
      const key = toPrimitiveString(params[0]);
      const payload = JSON.parse(toPrimitiveString(params[5]) || 'null') as unknown;
      const nowMs = this.options.now ? this.options.now() : Date.now();
      this.rowsByKey.set(key, {
        response_json: payload,
        updated_at: new Date(nowMs).toISOString()
      });
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('delete from hltb_search_cache where cache_key')) {
      const key = toPrimitiveString(params[0]);
      this.rowsByKey.delete(key);
      return Promise.resolve({ rows: [] });
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

  getEntry(cacheKey: string): { response_json: unknown; updated_at: string } | null {
    return this.rowsByKey.get(cacheKey) ?? null;
  }
}

void test('HLTB cache stores on miss and serves on hit', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
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

void test('HLTB cache supports candidates when includeCandidates is enabled', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: null,
          candidates: [{ hltbMainHours: 18, imageUrl: 'https://howlongtobeat.com/games/okami.jpg' }]
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

void test('HLTB cache resolves preferred candidate identity into item payload', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7001,
              hltbUrl: 'https://howlongtobeat.com/game/7001',
              imageUrl: 'https://howlongtobeat.com/games/7001.jpg',
              hltbMainHours: 8
            },
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
              hltbMainHours: 9
            }
          ]
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
    url: '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbGameId=7002'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.deepEqual(JSON.parse(first.body), {
    item: {
      title: 'Night In The Woods',
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
      imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
      hltbMainHours: 9
    },
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
        imageUrl: 'https://howlongtobeat.com/games/7001.jpg',
        hltbMainHours: 8
      },
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
        hltbMainHours: 9
      }
    ]
  });

  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=night%20in%20the%20woods&preferredHltbGameId=7002'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  await app.close();
});

void test('HLTB cache resolves preferred candidate by normalized preferred URL', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7001,
              hltbUrl: 'https://howlongtobeat.com/game/7001',
              hltbMainHours: 8
            },
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              hltbMainHours: 9
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
      encodeURIComponent('//howlongtobeat.com/game/7002')
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.deepEqual(JSON.parse(response.body), {
    item: {
      title: 'Night In The Woods',
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
      hltbMainHours: 9
    },
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7001,
        hltbUrl: 'https://howlongtobeat.com/game/7001',
        hltbMainHours: 8
      },
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        hltbMainHours: 9
      }
    ]
  });

  await app.close();
});

void test('HLTB cache canonicalizes preferred and candidate HLTB URLs across equivalent forms', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'http://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7001,
              hltbUrl: 'http://howlongtobeat.com/game/7001',
              hltbMainHours: 8
            },
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              gameUrl: '/game/7002',
              hltbMainHours: 9
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
      encodeURIComponent('http://howlongtobeat.com/game/7002')
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.deepEqual(JSON.parse(response.body), {
    item: {
      title: 'Night In The Woods',
      hltbGameId: 7002,
      gameUrl: '/game/7002',
      hltbMainHours: 9
    },
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7001,
        hltbUrl: 'http://howlongtobeat.com/game/7001',
        hltbMainHours: 8
      },
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        gameUrl: '/game/7002',
        hltbMainHours: 9
      }
    ]
  });

  await app.close();
});

void test('HLTB cache keys differentiate preferred identities and normalize preferred URLs', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7001,
              hltbUrl: 'https://howlongtobeat.com/game/7001',
              imageUrl: 'https://howlongtobeat.com/games/7001.jpg',
              hltbMainHours: 8
            },
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
              hltbMainHours: 9
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const normalizedUrlResponse = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
      encodeURIComponent('//howlongtobeat.com/game/7002')
  });
  assert.equal(normalizedUrlResponse.statusCode, 200);
  assert.equal(normalizedUrlResponse.headers['x-gameshelf-hltb-cache'], 'MISS');

  const canonicalUrlResponse = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=night%20in%20the%20woods&preferredHltbUrl=' +
      encodeURIComponent('https://howlongtobeat.com/game/7002')
  });
  assert.equal(canonicalUrlResponse.statusCode, 200);
  assert.equal(canonicalUrlResponse.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');

  const differentIdentityResponse = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbGameId=7001'
  });
  assert.equal(differentIdentityResponse.statusCode, 200);
  assert.equal(differentIdentityResponse.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 2);
  assert.equal(pool.getEntryCount(), 2);

  await app.close();
});

void test('HLTB cache ignores invalid external preferred URLs for cache keying and candidate mode', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            item: {
              hltbGameId: 7001,
              hltbUrl: 'https://howlongtobeat.com/game/7001',
              hltbMainHours: 8
            },
            candidates: [
              {
                title: 'Night In The Woods',
                hltbGameId: 7001,
                hltbUrl: 'https://howlongtobeat.com/game/7001',
                imageUrl: 'https://howlongtobeat.com/games/7001.jpg',
                hltbMainHours: 8
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      );
    }
  });

  const invalidPreferredUrlResponse = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
      encodeURIComponent('https://example.com/game/7002')
  });
  assert.equal(invalidPreferredUrlResponse.statusCode, 200);
  assert.equal(invalidPreferredUrlResponse.headers['x-gameshelf-hltb-cache'], 'MISS');

  const plainResponse = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=night%20in%20the%20woods'
  });
  assert.equal(plainResponse.statusCode, 200);
  assert.equal(plainResponse.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);

  await app.close();
});

void test('HLTB cache does not persist successful but uncacheable preferred-candidate payloads', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      new Response(
        JSON.stringify({
          item: null,
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              hltbMainHours: null,
              hltbMainExtraHours: null,
              hltbCompletionistHours: null
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbGameId=7002'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(pool.getEntryCount(), 0);
  assert.deepEqual(JSON.parse(response.body), {
    item: null,
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      }
    ]
  });

  await app.close();
});

void test('HLTB cache keeps original item when preferred candidate has no completion time data', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
              hltbMainHours: null,
              hltbMainExtraHours: null,
              hltbCompletionistHours: null
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbGameId=7002'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    item: {
      hltbGameId: 7001,
      hltbUrl: 'https://howlongtobeat.com/game/7001',
      hltbMainHours: 8
    },
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
        hltbMainHours: null,
        hltbMainExtraHours: null,
        hltbCompletionistHours: null
      }
    ]
  });

  await app.close();
});

void test('HLTB cache promotes preferred candidate when only legacy raw completion fields are populated', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              hltbGameId: 7002,
              hltbUrl: 'https://howlongtobeat.com/game/7002',
              main: null,
              mainPlus: null,
              mainExtra: null,
              completionist: null,
              solo: null,
              coOp: null,
              vs: 9
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbGameId=7002'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    item: {
      title: 'Night In The Woods',
      hltbGameId: 7002,
      hltbUrl: 'https://howlongtobeat.com/game/7002',
      hltbMainHours: 9,
      main: null,
      mainPlus: null,
      mainExtra: null,
      completionist: null,
      solo: null,
      coOp: null,
      vs: 9
    },
    candidates: [
      {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        main: null,
        mainPlus: null,
        mainExtra: null,
        completionist: null,
        solo: null,
        coOp: null,
        vs: 9
      }
    ]
  });

  await app.close();
});

void test('HLTB stale cache uses queued revalidation payload for preferred identities', async () => {
  resetCacheMetrics();
  const nowMs = Date.UTC(2026, 1, 11, 18, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  const queuedPayloads: Array<{ cacheKey: string; requestUrl: string }> = [];

  const preferredUrl = 'https://howlongtobeat.com/game/7002';
  const cacheKey = crypto
    .createHash('sha256')
    .update(JSON.stringify(['night in the woods', null, null, true, null, preferredUrl]))
    .digest('hex');
  pool.seed(
    cacheKey,
    {
      item: {
        title: 'Night In The Woods',
        hltbGameId: 7002,
        hltbUrl: preferredUrl,
        hltbMainHours: 9
      },
      candidates: [
        {
          title: 'Night In The Woods',
          hltbGameId: 7002,
          hltbUrl: preferredUrl,
          imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
          hltbMainHours: 9
        }
      ]
    },
    new Date(nowMs - 2_000).toISOString()
  );

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    now: () => nowMs,
    freshTtlSeconds: 1,
    staleTtlSeconds: 60,
    enqueueRevalidationJob: (payload) => {
      queuedPayloads.push(payload);
    }
  });

  const response = await app.inject({
    method: 'GET',
    url:
      '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
      encodeURIComponent('//howlongtobeat.com/game/7002')
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-hltb-revalidate'], 'scheduled');
  assert.deepEqual(queuedPayloads, [
    {
      cacheKey,
      requestUrl:
        '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
        encodeURIComponent('//howlongtobeat.com/game/7002')
    }
  ]);

  await app.close();
});

void test('HLTB cache stale revalidation handles failures and skip when already in-flight', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 20, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
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
  assert.ok(task);
  await task();

  nowMs += 2_000;
  await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=chrono'
  });
  const taskTwo = pendingTask;
  assert.ok(taskTwo);
  await taskTwo();

  const metrics = getCacheMetrics();
  assert.ok(metrics.hltb.revalidateScheduled >= 2);
  assert.ok(metrics.hltb.revalidateSkipped >= 1);
  assert.ok(metrics.hltb.revalidateFailed >= 1);

  await app.close();
});

void test('queued HLTB revalidation forwards preferred identity and persists finalized payload', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const originalBaseUrl = process.env['HLTB_SCRAPER_BASE_URL'];
  const originalFetch = globalThis.fetch;
  const seenRequests: Array<{ url: string; authorization: string | null }> = [];

  process.env['HLTB_SCRAPER_BASE_URL'] = 'https://hltb.example';
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    seenRequests.push({
      url,
      authorization: headers.get('authorization')
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          item: {
            hltbGameId: 7001,
            hltbUrl: 'https://howlongtobeat.com/game/7001',
            hltbMainHours: 8
          },
          candidates: [
            {
              title: 'Night In The Woods',
              gameUrl: '//howlongtobeat.com/game/7002',
              imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
              hltbMainHours: 9
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );
  };

  try {
    await processQueuedHltbCacheRevalidation(pool as unknown as Pool, {
      cacheKey: 'preferred-url-cache-key',
      requestUrl:
        '/v1/hltb/search?q=Night%20In%20The%20Woods&preferredHltbUrl=' +
        encodeURIComponent('//howlongtobeat.com/game/7002')
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env['HLTB_SCRAPER_BASE_URL'];
    } else {
      process.env['HLTB_SCRAPER_BASE_URL'] = originalBaseUrl;
    }
  }

  assert.equal(seenRequests.length, 1);
  const firstSeenRequest = seenRequests.at(0);
  assert.ok(firstSeenRequest);
  const requestUrl = new URL(firstSeenRequest.url);
  assert.equal(requestUrl.searchParams.get('q'), 'Night In The Woods');
  assert.equal(requestUrl.searchParams.get('includeCandidates'), '1');
  assert.equal(
    requestUrl.searchParams.get('preferredHltbUrl'),
    'https://howlongtobeat.com/game/7002'
  );
  assert.equal(firstSeenRequest.authorization, null);

  assert.deepEqual(pool.getEntry('preferred-url-cache-key'), {
    response_json: {
      item: {
        title: 'Night In The Woods',
        gameUrl: '//howlongtobeat.com/game/7002',
        imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
        hltbMainHours: 9
      },
      candidates: [
        {
          title: 'Night In The Woods',
          gameUrl: '//howlongtobeat.com/game/7002',
          imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
          hltbMainHours: 9
        }
      ]
    },
    updated_at: pool.getEntry('preferred-url-cache-key')?.updated_at
  });
});

void test('queued HLTB revalidation keeps candidate payload unchanged when no preferred identity is provided', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const originalBaseUrl = process.env['HLTB_SCRAPER_BASE_URL'];
  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];

  process.env['HLTB_SCRAPER_BASE_URL'] = 'https://hltb.example';
  globalThis.fetch = (input) => {
    seenUrls.push(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          item: null,
          candidates: [
            {
              title: 'Okami',
              imageUrl: 'https://howlongtobeat.com/games/okami.jpg',
              hltbMainHours: 18
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    );
  };

  try {
    await processQueuedHltbCacheRevalidation(pool as unknown as Pool, {
      cacheKey: 'include-candidates-cache-key',
      requestUrl: '/v1/hltb/search?q=Okami&includeCandidates=1'
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env['HLTB_SCRAPER_BASE_URL'];
    } else {
      process.env['HLTB_SCRAPER_BASE_URL'] = originalBaseUrl;
    }
  }

  assert.equal(seenUrls.length, 1);
  const firstSeenUrl = seenUrls.at(0);
  assert.ok(firstSeenUrl);
  const requestUrl = new URL(firstSeenUrl);
  assert.equal(requestUrl.searchParams.get('includeCandidates'), '1');
  assert.equal(requestUrl.searchParams.get('preferredHltbGameId'), null);
  assert.equal(requestUrl.searchParams.get('preferredHltbUrl'), null);
  assert.deepEqual(pool.getEntry('include-candidates-cache-key'), {
    response_json: {
      item: null,
      candidates: [
        {
          title: 'Okami',
          imageUrl: 'https://howlongtobeat.com/games/okami.jpg',
          hltbMainHours: 18
        }
      ]
    },
    updated_at: pool.getEntry('include-candidates-cache-key')?.updated_at
  });
});

void test('queued HLTB revalidation rejects invalid short-query payloads', async () => {
  const pool = new HltbPoolMock();

  await assert.rejects(
    () =>
      processQueuedHltbCacheRevalidation(pool as unknown as Pool, {
        cacheKey: 'invalid-short-query',
        requestUrl: '/v1/hltb/search?q=a'
      }),
    /Invalid HLTB revalidation payload query/
  );
});

void test('queued HLTB revalidation surfaces non-ok scraper responses', async () => {
  const pool = new HltbPoolMock();
  const originalBaseUrl = process.env['HLTB_SCRAPER_BASE_URL'];
  const originalFetch = globalThis.fetch;

  process.env['HLTB_SCRAPER_BASE_URL'] = 'https://hltb.example';
  globalThis.fetch = () => Promise.resolve(new Response('upstream error', { status: 502 }));

  try {
    await assert.rejects(
      () =>
        processQueuedHltbCacheRevalidation(pool as unknown as Pool, {
          cacheKey: 'non-ok-revalidation',
          requestUrl: '/v1/hltb/search?q=Okami&preferredHltbGameId=7002'
        }),
      /HLTB revalidation request failed with status 502/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env['HLTB_SCRAPER_BASE_URL'];
    } else {
      process.env['HLTB_SCRAPER_BASE_URL'] = originalBaseUrl;
    }
  }
});

void test('HLTB cache bypasses cache when query is too short', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
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

void test('HLTB includeCandidates=yes is treated as cacheable candidate mode', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: null,
          candidates: [
            {
              title: 'Okami',
              imageUrl: 'https://howlongtobeat.com/games/okami.jpg',
              hltbMainHours: 18
            }
          ]
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
    url: '/v1/hltb/search?q=okami&includeCandidates=yes'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami&includeCandidates=yes'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);

  await app.close();
});

void test('HLTB cache deletes stale invalid payload and fetches fresh response', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  // Cache key for q=okami with default query params.
  pool.seed(
    '0e7ff3d831faac5e31bb5fac5a641192f99fbcc8b87b58e62ca4d7bbd0e01143',
    { item: null, candidates: [] },
    new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString()
  );

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
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

void test('HLTB cache deletes candidate-only payloads when candidate images are missing and fetches fresh response', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  pool.seed(
    '4b2ccf0b240bc993b914f1e66c586f470e273339cd79e5ccfe675984c80b59dd',
    {
      item: null,
      candidates: [{ hltbMainHours: 18, imageUrl: null }]
    },
    new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString()
  );

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: null,
          candidates: [
            {
              hltbMainHours: 18,
              imageUrl: 'https://howlongtobeat.com/games/okami.jpg'
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=okami&includeCandidates=true'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  assert.equal(pool.getEntryCount(), 1);
  const body = JSON.parse(response.body) as HltbCandidateResponseBody;
  assert.equal(body.candidates?.[0]?.imageUrl, 'https://howlongtobeat.com/games/okami.jpg');

  await app.close();
});

void test('HLTB includeCandidates cache rejects fresh entries when summary item exists but candidate images are missing', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  pool.seed(
    '2ec68e6fb0af4900b2f0e6c0b54540c96f06a0e10c32e3f9704fef17b6fc8fe8',
    {
      item: {
        hltbMainHours: 8.5,
        hltbMainExtraHours: 11.2,
        hltbCompletionistHours: 39.7
      },
      candidates: [
        {
          title: 'Call of Duty: Black Ops 6',
          imageUrl: null,
          platform: 'PC, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X/S',
          releaseYear: 2024,
          hltbMainHours: 8.5,
          hltbMainExtraHours: 11.2,
          hltbCompletionistHours: 39.7
        }
      ]
    },
    new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).toISOString()
  );

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          item: {
            hltbMainHours: 8.5,
            hltbMainExtraHours: 11.2,
            hltbCompletionistHours: 39.7
          },
          candidates: [
            {
              title: 'Call of Duty: Black Ops 6',
              imageUrl: 'https://howlongtobeat.com/games/Call_of_Duty_Black_Ops_6.jpg',
              platform: 'PC, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X/S',
              releaseYear: 2024,
              hltbMainHours: 8.5,
              hltbMainExtraHours: 11.2,
              hltbCompletionistHours: 39.7
            }
          ]
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Call%20of%20Duty%3A%20Black%20Ops%206&includeCandidates=true'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-hltb-cache'], 'MISS');
  assert.equal(fetchCalls, 1);
  const body = JSON.parse(response.body) as HltbCandidateResponseBody;
  assert.equal(
    body.candidates?.[0]?.imageUrl,
    'https://howlongtobeat.com/games/Call_of_Duty_Black_Ops_6.jpg'
  );

  await app.close();
});

void test('HLTB cache serves stale and revalidates in background', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 18, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingRefreshTask: (() => Promise<void>) | null = null;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
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

  assert.ok(refreshTask);

  await refreshTask();
  assert.equal(fetchCalls, 2);

  const freshAfterRefresh = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Silent%20Hill&releaseYear=1999&platform=PS1'
  });
  assert.equal(freshAfterRefresh.headers['x-gameshelf-hltb-cache'], 'HIT_FRESH');
  const payload = JSON.parse(freshAfterRefresh.body) as { item: { hltbMainHours: number } };
  assert.equal(payload.item.hltbMainHours, 11);

  const metrics = getCacheMetrics();
  assert.equal(metrics.hltb.staleServed, 1);
  assert.equal(metrics.hltb.revalidateScheduled, 1);
  assert.equal(metrics.hltb.revalidateSucceeded, 1);

  await app.close();
});

void test('HLTB stale revalidation treats uncacheable finalized payloads as failed refreshes', async () => {
  resetCacheMetrics();
  const nowMs = Date.UTC(2026, 1, 11, 18, 0, 0);
  const pool = new HltbPoolMock({ now: () => nowMs });
  const app = Fastify();
  let pendingRefreshTask: (() => Promise<void>) | null = null;
  const cacheKey = crypto
    .createHash('sha256')
    .update(JSON.stringify(['silent hill', null, null, true, 7002, null]))
    .digest('hex');

  pool.seed(
    cacheKey,
    {
      item: {
        title: 'Silent Hill',
        hltbGameId: 7002,
        hltbUrl: 'https://howlongtobeat.com/game/7002',
        hltbMainHours: 10
      },
      candidates: [
        {
          title: 'Silent Hill',
          hltbGameId: 7002,
          hltbUrl: 'https://howlongtobeat.com/game/7002',
          imageUrl: 'https://howlongtobeat.com/games/7002.jpg',
          hltbMainHours: 10
        }
      ]
    },
    new Date(nowMs - 2_000).toISOString()
  );

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            item: null,
            candidates: [
              {
                title: 'Silent Hill',
                hltbGameId: 7002,
                hltbUrl: 'https://howlongtobeat.com/game/7002',
                hltbMainHours: null,
                hltbMainExtraHours: null,
                hltbCompletionistHours: null
              }
            ]
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
      ),
    now: () => nowMs,
    freshTtlSeconds: 1,
    staleTtlSeconds: 100,
    scheduleBackgroundRefresh: (task) => {
      pendingRefreshTask = task;
    }
  });

  const stale = await app.inject({
    method: 'GET',
    url: '/v1/hltb/search?q=Silent%20Hill&preferredHltbGameId=7002'
  });
  assert.equal(stale.headers['x-gameshelf-hltb-cache'], 'HIT_STALE');

  const task = pendingRefreshTask;
  assert.ok(task);
  await task();

  const metrics = getCacheMetrics();
  assert.ok(metrics.hltb.revalidateFailed >= 1);

  await app.close();
});

void test('HLTB cache is fail-open when cache read throws', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock({ failReads: true });
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
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

void test('HLTB null item responses are not cached', async () => {
  resetCacheMetrics();
  const pool = new HltbPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerHltbCachedRoute(app, pool as unknown as Pool, {
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
