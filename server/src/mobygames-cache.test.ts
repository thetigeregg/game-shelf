import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';
import { registerMobyGamesCachedRoute } from './mobygames-cache.js';

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
  platform: string | null;
  limit: number | null;
  offset: number | null;
  id: string | null;
  genre: string | null;
  group: string | null;
  format: 'id' | 'brief' | 'normal' | null;
  include: string | null;
}): string {
  const payload = JSON.stringify([
    params.query.toLowerCase(),
    params.platform?.toLowerCase() ?? null,
    params.limit,
    params.offset,
    params.id?.toLowerCase() ?? null,
    params.genre?.toLowerCase() ?? null,
    params.group?.toLowerCase() ?? null,
    params.format,
    params.include?.toLowerCase() ?? null
  ]);

  return crypto.createHash('sha256').update(payload).digest('hex');
}

class MobyGamesPoolMock {
  private readonly rowsByKey = new Map<string, { response_json: unknown; updated_at: string }>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      failWrites?: boolean;
      failDeletes?: boolean;
      now?: () => number;
    } = {}
  ) {}

  seed(key: string, row: { response_json: unknown; updated_at: string }): void {
    this.rowsByKey.set(key, row);
  }

  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select response_json, updated_at from mobygames_search_cache')) {
      if (this.options.failReads) {
        throw new Error('read_failed');
      }

      const key = toPrimitiveString(params[0]);
      const row = this.rowsByKey.get(key);
      return Promise.resolve({ rows: row ? [row] : [] });
    }

    if (normalized.startsWith('insert into mobygames_search_cache')) {
      if (this.options.failWrites) {
        throw new Error('write_failed');
      }
      const key = toPrimitiveString(params[0]);
      const payload = JSON.parse(toPrimitiveString(params[3]) || 'null') as unknown;
      const nowMs = this.options.now ? this.options.now() : Date.now();
      this.rowsByKey.set(key, {
        response_json: payload,
        updated_at: new Date(nowMs).toISOString()
      });
      return Promise.resolve({ rows: [] });
    }

    if (normalized.startsWith('delete from mobygames_search_cache where cache_key')) {
      if (this.options.failDeletes) {
        throw new Error('delete_failed');
      }
      const key = toPrimitiveString(params[0]);
      this.rowsByKey.delete(key);
      return Promise.resolve({ rows: [] });
    }

    throw new Error(`Unsupported SQL in MobyGamesPoolMock: ${sql}`);
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

void test('MOBYGAMES cache stores on miss and serves on hit', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ games: [{ game_id: 1, title: 'Okami' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Okami&platform=9&limit=5'
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=okami&platform=9&limit=5'
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-mobygames-cache'], 'HIT_FRESH');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.misses, 1);
  assert.equal(metrics.mobygames.hits, 1);
  assert.equal(metrics.mobygames.writes, 1);

  await app.close();
});

void test('MOBYGAMES cache bypasses cache when query is too short', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=a'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=a'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(second.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(fetchCalls, 2);

  await app.close();
});

void test('MOBYGAMES cache is fail-open when cache read throws', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock({ failReads: true });
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Super%20Metroid'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'BYPASS');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.readErrors, 1);
  assert.equal(metrics.mobygames.bypasses, 1);

  await app.close();
});

void test('MOBYGAMES cache does not store empty games payloads', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ games: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Chrono%20Trigger&platform=15&limit=100'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Chrono%20Trigger&platform=15&limit=100'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(second.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(fetchCalls, 2);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writes, 0);

  await app.close();
});

void test('MOBYGAMES response forwarding strips upstream encoding headers for JSON bodies', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock();
  const app = Fastify();

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 4501, title: 'Chrono Trigger' }] }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'br',
            'content-length': '9999'
          }
        })
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Chrono%20Trigger&platform=15'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.equal(response.headers['content-encoding'], undefined);
  assert.deepEqual(JSON.parse(response.body), {
    games: [{ game_id: 4501, title: 'Chrono Trigger' }]
  });

  await app.close();
});

void test('MOBYGAMES default fetch returns 503 when API key is missing', async () => {
  await withEnv(
    {
      MOBYGAMES_API_BASE_URL: 'https://api.mobygames.com/v2',
      MOBYGAMES_API_KEY_FILE: undefined
    },
    async () => {
      resetCacheMetrics();
      const pool = new MobyGamesPoolMock();
      const app = Fastify();

      await registerMobyGamesCachedRoute(app, pool as unknown as Pool);

      const response = await app.inject({
        method: 'GET',
        url: '/v1/mobygames/search?q=Okami'
      });

      assert.equal(response.statusCode, 503);
      assert.match(response.body, /not configured/i);

      await app.close();
    }
  );
});

void test('MOBYGAMES default fetch forwards API key and query params', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobygames-key-'));
  const keyPath = path.join(tempDir, 'api-key.txt');
  fs.writeFileSync(keyPath, 'abc123\n', 'utf8');

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';

  const fetchMock = ((input: RequestInfo | URL): Promise<Response> => {
    capturedUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(
      new Response(JSON.stringify({ games: [{ game_id: 1, title: 'Okami' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
  }) as typeof fetch;
  globalThis.fetch = fetchMock;

  try {
    await withEnv(
      {
        MOBYGAMES_API_BASE_URL: 'https://api.mobygames.com/v2',
        MOBYGAMES_API_KEY_FILE: keyPath
      },
      async () => {
        resetCacheMetrics();
        const pool = new MobyGamesPoolMock();
        const app = Fastify();

        await registerMobyGamesCachedRoute(app, pool as unknown as Pool);

        const response = await app.inject({
          method: 'GET',
          url: '/v1/mobygames/search?q=Okami&platform=9&limit=10&offset=0&include=game_id,title,moby_url&fuzzy=true'
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'MISS');
        assert.match(capturedUrl, /\/v2\/games\?/);
        assert.match(capturedUrl, /api_key=abc123/);
        assert.match(capturedUrl, /title=Okami/);
        assert.match(capturedUrl, /platform=9/);
        assert.match(capturedUrl, /limit=10/);
        assert.match(capturedUrl, /include=game_id%2Ctitle%2Cmoby_url/);
        assert.doesNotMatch(capturedUrl, /fuzzy=/);

        const expectedCacheKey = buildExpectedCacheKey({
          query: 'Okami',
          platform: '9',
          limit: 10,
          offset: 0,
          id: null,
          genre: null,
          group: null,
          format: null,
          include: 'game_id,title,moby_url'
        });
        assert.equal(typeof expectedCacheKey, 'string');

        await app.close();
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

void test('MOBYGAMES stale revalidation serves stale and refreshes cache in background', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;
  const freshTtlSeconds = 1;
  const staleTtlSeconds = 9999;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 99, title: 'Sonic' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Sonic',
    platform: '9',
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  let revalidateCalls = 0;
  let backgroundTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds,
    staleTtlSeconds,
    now: () => nowMs,
    fetchMetadata: () => {
      revalidateCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 99, title: 'Sonic (updated)' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    },
    scheduleBackgroundRefresh: (task) => {
      backgroundTask = task;
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Sonic&platform=9'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'HIT_STALE');
  assert.equal(response.headers['x-gameshelf-mobygames-revalidate'], 'scheduled');
  assert.deepEqual(JSON.parse(response.body), stalePayload);

  // Run background revalidation
  const task0 = backgroundTask;
  assert.ok(task0, 'background task should be scheduled');
  await task0();
  assert.equal(revalidateCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.hits, 1);
  assert.equal(metrics.mobygames.staleServed, 1);
  assert.equal(metrics.mobygames.revalidateScheduled, 1);
  assert.equal(metrics.mobygames.revalidateSucceeded, 1);

  await app.close();
});

void test('MOBYGAMES stale revalidation skips when already in-flight', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 7, title: 'Mega Man' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Mega Man',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  const capturedTasks: Array<() => Promise<void>> = [];

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 1,
    staleTtlSeconds: 9999,
    now: () => nowMs,
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 7, title: 'Mega Man' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    scheduleBackgroundRefresh: (task) => {
      capturedTasks.push(task);
    }
  });

  const first = await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Mega%20Man' });
  assert.equal(first.headers['x-gameshelf-mobygames-revalidate'], 'scheduled');
  assert.equal(capturedTasks.length, 1);

  // Second request while first revalidation is still "in-flight" (task not yet run)
  const second = await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Mega%20Man' });
  assert.equal(second.headers['x-gameshelf-mobygames-revalidate'], 'skipped');

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateScheduled, 1);
  assert.equal(metrics.mobygames.revalidateSkipped, 1);

  // Complete the first task to clean up in-flight state
  await capturedTasks[0]();

  await app.close();
});

void test('MOBYGAMES stale revalidation handles non-ok upstream response', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 5, title: 'Castlevania' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Castlevania',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  let backgroundTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 1,
    staleTtlSeconds: 9999,
    now: () => nowMs,
    fetchMetadata: () => Promise.resolve(new Response('upstream error', { status: 503 })),
    scheduleBackgroundRefresh: (task) => {
      backgroundTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Castlevania' });
  const task1 = backgroundTask;
  assert.ok(task1);
  await task1();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES stale revalidation handles null JSON payload', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 6, title: 'Metroid' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Metroid',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  let backgroundTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 1,
    staleTtlSeconds: 9999,
    now: () => nowMs,
    fetchMetadata: () =>
      Promise.resolve(
        new Response('not-json!', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    scheduleBackgroundRefresh: (task) => {
      backgroundTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Metroid' });
  const task2 = backgroundTask;
  assert.ok(task2);
  await task2();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES stale revalidation handles uncacheable payload (empty games)', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 8, title: 'Contra' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Contra',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  let backgroundTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 1,
    staleTtlSeconds: 9999,
    now: () => nowMs,
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    scheduleBackgroundRefresh: (task) => {
      backgroundTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Contra' });
  const task3 = backgroundTask;
  assert.ok(task3);
  await task3();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES stale revalidation handles fetch exception', async () => {
  resetCacheMetrics();

  const staleTimestamp = new Date(0).toISOString();
  const nowMs = 10_000;

  const pool = new MobyGamesPoolMock({ now: () => nowMs });
  const stalePayload = { games: [{ game_id: 9, title: 'Ghosts n Goblins' }] };
  const cacheKey = buildExpectedCacheKey({
    query: 'Ghosts',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: stalePayload, updated_at: staleTimestamp });

  const app = Fastify();
  let backgroundTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 1,
    staleTtlSeconds: 9999,
    now: () => nowMs,
    fetchMetadata: () => Promise.reject(new Error('network_error')),
    scheduleBackgroundRefresh: (task) => {
      backgroundTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=Ghosts' });
  const task4 = backgroundTask;
  assert.ok(task4);
  await task4();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES write error is handled gracefully', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock({ failWrites: true });
  const app = Fastify();

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 10, title: 'Street Fighter' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Street%20Fighter&platform=11'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'MISS');
  assert.deepEqual(JSON.parse(response.body), {
    games: [{ game_id: 10, title: 'Street Fighter' }]
  });

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writeErrors, 1);

  await app.close();
});

void test('MOBYGAMES invalid cached payload is deleted and fresh response served', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock();
  const invalidPayload = 'not-an-object';
  const cacheKey = buildExpectedCacheKey({
    query: 'Pac-Man',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: invalidPayload, updated_at: new Date().toISOString() });

  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 11, title: 'Pac-Man' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Pac-Man'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(fetchCalls, 1);

  await app.close();
});

void test('MOBYGAMES delete error for invalid cached payload is handled gracefully', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock({ failDeletes: true });
  const invalidPayload = null;
  const cacheKey = buildExpectedCacheKey({
    query: 'Dig Dug',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, { response_json: invalidPayload, updated_at: new Date().toISOString() });

  const app = Fastify();

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 12, title: 'Dig Dug' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Dig%20Dug'
  });

  assert.equal(response.statusCode, 200);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writeErrors, 1);

  await app.close();
});

void test('MOBYGAMES sendWebResponse forwards binary content type', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock();
  const app = Fastify();

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(Buffer.from([0xff, 0xd8, 0xff]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' }
        })
      )
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Binary%20Game&platform=3'
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /image\/jpeg/);

  await app.close();
});

void test('MOBYGAMES upstream non-ok response is not cached', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Missing%20Game&platform=5'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Missing%20Game&platform=5'
  });

  assert.equal(first.statusCode, 404);
  assert.equal(second.statusCode, 404);
  assert.equal(fetchCalls, 2);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writes, 0);

  await app.close();
});

void test('MOBYGAMES cache returns MISS when cached entry has invalid updated_at timestamp', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock();
  const cacheKey = buildExpectedCacheKey({
    query: 'Doom',
    platform: null,
    limit: null,
    offset: null,
    id: null,
    genre: null,
    group: null,
    format: null,
    include: null
  });
  pool.seed(cacheKey, {
    response_json: { games: [{ game_id: 50, title: 'Doom' }] },
    updated_at: 'not-a-valid-date'
  });

  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    freshTtlSeconds: 3600,
    staleTtlSeconds: 86400,
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 50, title: 'Doom (fresh)' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Doom'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(fetchCalls, 1, 'should have fetched fresh data due to invalid timestamp');

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.misses, 1);

  await app.close();
});

void test('MOBYGAMES cache does not persist when upstream response body is invalid JSON', async () => {
  resetCacheMetrics();

  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response('this is not json {{{', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Quake'
  });
  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=Quake'
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(fetchCalls, 2, 'invalid JSON should not be cached; second request should re-fetch');

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writes, 0);

  await app.close();
});
