import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { __metacriticCacheTestables, registerMetacriticCachedRoute } from './metacritic-cache.js';
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

function buildExpectedCacheKey(params: {
  query: string;
  releaseYear: number | null;
  platform: string | null;
  platformIgdbId: number | null;
  includeCandidates: boolean;
}): string {
  const payload = JSON.stringify([
    params.query.toLowerCase(),
    params.releaseYear,
    params.platform?.toLowerCase() ?? null,
    params.platformIgdbId,
    params.includeCandidates
  ]);

  return crypto.createHash('sha256').update(payload).digest('hex');
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

function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>
): Promise<void> {
  const original = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    original.set(key, process.env[key]);
    if (typeof value === 'undefined') {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of original.entries()) {
      if (typeof value === 'undefined') {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
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

void test('METACRITIC cache normalizes includeCandidates and platformIgdbId in query keying', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;
  const observedUrls: string[] = [];

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: (request) => {
      fetchCalls += 1;
      observedUrls.push(request.url);
      return new Response(JSON.stringify({ item: { metacriticScore: 40 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami&releaseYear=2006&platform=Wii&platformIgdbId=5&includeCandidates=yes'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-metacritic-cache'], 'MISS');

  const second = await app.inject({
    method: 'GET',
    url: '/v1/metacritic/search?q=okami&releaseYear=2006&platform=Wii&platformIgdbId=5&includeCandidates=true'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-metacritic-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);
  assert.ok(observedUrls[0]?.includes('platformIgdbId=5'));

  const expectedKey = buildExpectedCacheKey({
    query: 'okami',
    releaseYear: 2006,
    platform: 'Wii',
    platformIgdbId: 5,
    includeCandidates: true
  });
  pool.seed(expectedKey, { item: { metacriticScore: 41 } }, new Date().toISOString());
  assert.equal(pool.getEntryCount() >= 1, true);

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

void test('METACRITIC cache treats invalid cache timestamps as expired and refreshes', async () => {
  resetCacheMetrics();
  const pool = new MetacriticPoolMock();
  const app = Fastify();
  let fetchCalls = 0;
  const key = buildExpectedCacheKey({
    query: 'okami',
    releaseYear: null,
    platform: null,
    platformIgdbId: null,
    includeCandidates: false
  });
  pool.seed(key, { item: { metacriticScore: 10 } }, 'invalid-date');

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ item: { metacriticScore: 55 } }), {
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

  await app.close();
});

void test('METACRITIC stale revalidation ignores non-json and uncacheable payloads', async () => {
  resetCacheMetrics();
  let nowMs = Date.UTC(2026, 1, 11, 23, 0, 0);
  const pool = new MetacriticPoolMock({ now: () => nowMs });
  const app = Fastify();
  let fetchCalls = 0;
  let pendingTask: (() => Promise<void>) | null = null;

  await registerMetacriticCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ item: { metacriticScore: 20 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (fetchCalls === 2) {
        return new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ item: null, candidates: [] }), {
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

  await app.inject({ method: 'GET', url: '/v1/metacritic/search?q=chrono' });

  nowMs += 2_000;
  await app.inject({ method: 'GET', url: '/v1/metacritic/search?q=chrono' });
  const taskOne = pendingTask;
  assert.ok(taskOne);
  await taskOne();

  nowMs += 2_000;
  await app.inject({ method: 'GET', url: '/v1/metacritic/search?q=chrono' });
  const taskTwo = pendingTask;
  assert.ok(taskTwo);
  await taskTwo();

  const final = await app.inject({ method: 'GET', url: '/v1/metacritic/search?q=chrono' });
  assert.equal(final.statusCode, 200);
  const finalPayload = JSON.parse(final.body) as { item: { metacriticScore: number } };
  assert.equal(finalPayload.item.metacriticScore, 20);

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

void test('METACRITIC default worker fetch returns 503 when base URL is missing', async () => {
  await withEnv(
    {
      METACRITIC_SCRAPER_BASE_URL: '',
      METACRITIC_SCRAPER_TOKEN_FILE: undefined
    },
    async () => {
      resetCacheMetrics();
      const pool = new MetacriticPoolMock();
      const app = Fastify();

      await registerMetacriticCachedRoute(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/metacritic/search?q=Okami'
      });

      assert.equal(response.statusCode, 503);
      const contentType = response.headers['content-type'];
      assert.match(typeof contentType === 'string' ? contentType : '', /^application\/json/i);
      assert.match(response.body, /not configured/i);

      await app.close();
    }
  );
});

void test('METACRITIC default worker fetch forwards auth and query params', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metacritic-token-'));
  const tokenPath = path.join(tempDir, 'token.txt');
  fs.writeFileSync(tokenPath, 'abc123\n', 'utf8');

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedAuth = '';

  const fetchMock = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    capturedAuth = headers.get('authorization') ?? '';
    return Promise.resolve(
      new Response(JSON.stringify({ item: { metacriticScore: 88 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
  }) as typeof fetch;
  globalThis.fetch = fetchMock;

  try {
    await withEnv(
      {
        METACRITIC_SCRAPER_BASE_URL: 'https://scraper.internal',
        METACRITIC_SCRAPER_TOKEN_FILE: tokenPath
      },
      async () => {
        resetCacheMetrics();
        const pool = new MetacriticPoolMock();
        const app = Fastify();

        await registerMetacriticCachedRoute(app, pool as unknown as Pool);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/metacritic/search?q=Okami&releaseYear=2006&platform=Wii'
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['x-gameshelf-metacritic-cache'], 'MISS');
        assert.match(capturedUrl, /\/v1\/metacritic\/search\?/);
        assert.match(capturedUrl, /q=Okami/);
        assert.match(capturedUrl, /releaseYear=2006/);
        assert.match(capturedUrl, /platform=Wii/);
        assert.equal(capturedAuth, 'Bearer abc123');

        await app.close();
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('METACRITIC default worker fetch handles fetch failures with 502', async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = (() => Promise.reject(new Error('socket hang up'))) as typeof fetch;
  globalThis.fetch = fetchMock;

  try {
    await withEnv(
      {
        METACRITIC_SCRAPER_BASE_URL: 'https://scraper.internal'
      },
      async () => {
        resetCacheMetrics();
        const pool = new MetacriticPoolMock();
        const app = Fastify();

        await registerMetacriticCachedRoute(app, pool as unknown as Pool);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/metacritic/search?q=Okami'
        });

        assert.equal(response.statusCode, 502);
        assert.match(response.body, /request failed/i);

        await app.close();
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('METACRITIC sendWebResponse forwards text and binary payloads', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Response[] = [
    new Response('plain-text', { status: 200, headers: { 'content-type': 'text/plain' } }),
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' }
    })
  ];
  const fetchMock = (() => {
    const next = calls.shift();
    if (!next) {
      return Promise.reject(new Error('missing response'));
    }
    return Promise.resolve(next);
  }) as typeof fetch;
  globalThis.fetch = fetchMock;

  try {
    await withEnv(
      {
        METACRITIC_SCRAPER_BASE_URL: 'https://scraper.internal'
      },
      async () => {
        resetCacheMetrics();
        const pool = new MetacriticPoolMock();
        const app = Fastify();

        await registerMetacriticCachedRoute(app, pool as unknown as Pool);

        const textResponse = await app.inject({
          method: 'GET',
          url: '/v1/metacritic/search?q=Okami'
        });
        assert.equal(textResponse.statusCode, 200);
        assert.equal(textResponse.body, 'plain-text');

        const binaryResponse = await app.inject({
          method: 'GET',
          url: '/v1/metacritic/search?q=Okami2'
        });
        assert.equal(binaryResponse.statusCode, 200);
        assert.equal(binaryResponse.rawPayload.length > 0, true);

        await app.close();
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('METACRITIC helper branches normalize and gate cache writes', async () => {
  const normalized = __metacriticCacheTestables.normalizeMetacriticQuery(
    '/v1/metacritic/search?q=okami&releaseYear=2006&platform=Wii&platformIgdbId=5&includeCandidates=yes'
  );
  assert.deepEqual(normalized, {
    query: 'okami',
    releaseYear: 2006,
    platform: 'Wii',
    platformIgdbId: 5,
    includeCandidates: true
  });

  assert.equal(
    __metacriticCacheTestables.getAgeSeconds('invalid-date', Date.now()),
    Number.POSITIVE_INFINITY
  );
  assert.equal(
    __metacriticCacheTestables.getAgeSeconds(
      '2026-02-11T00:00:00.000Z',
      Date.UTC(2026, 1, 11, 0, 0, 5)
    ),
    5
  );

  const query = {
    query: 'okami',
    releaseYear: 2006,
    platform: 'Wii',
    platformIgdbId: 5,
    includeCandidates: false
  };
  assert.equal(
    __metacriticCacheTestables.isCacheableMetacriticPayload(query, {
      item: { metacriticScore: 85 }
    }),
    true
  );

  const pool = new MetacriticPoolMock();
  const request = {
    log: { warn: () => undefined }
  } as unknown as import('fastify').FastifyRequest;
  const cacheKey = buildExpectedCacheKey(query);
  await __metacriticCacheTestables.persistMetacriticCacheEntry(
    pool as unknown as Pool,
    cacheKey,
    query,
    { item: { metacriticScore: 85 } },
    request
  );
  assert.equal(pool.getEntryCount(), 1);

  const scheduledTasks: Array<() => Promise<void>> = [];
  const scheduled = __metacriticCacheTestables.scheduleMetacriticRevalidation(
    cacheKey,
    request,
    query,
    () =>
      Promise.resolve(
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    pool as unknown as Pool,
    (task) => {
      scheduledTasks.push(task);
    }
  );
  assert.equal(scheduled, true);
  await scheduledTasks[0]();

  const scheduledAgain = __metacriticCacheTestables.scheduleMetacriticRevalidation(
    cacheKey,
    request,
    query,
    () =>
      Promise.resolve(
        new Response(JSON.stringify({ item: null, candidates: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    pool as unknown as Pool,
    (task) => {
      scheduledTasks.push(task);
    }
  );
  assert.equal(scheduledAgain, true);
  await scheduledTasks[1]();
});
