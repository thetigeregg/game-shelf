import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';
import { __mobygamesCacheTestables, registerMobyGamesCachedRoute } from './mobygames-cache.js';

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
      now?: () => number;
    } = {}
  ) {}

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

const { normalizeMobyGamesQuery, getAgeSeconds, isCacheableMobyGamesPayload } =
  __mobygamesCacheTestables;

void test('normalizeMobyGamesQuery accepts title param as fallback for q', () => {
  const result = normalizeMobyGamesQuery('/v1/mobygames/search?title=Okami');
  assert.notEqual(result, null);
  assert.equal(result?.query, 'Okami');
});

void test('normalizeMobyGamesQuery returns null for query shorter than 2 chars', () => {
  assert.equal(normalizeMobyGamesQuery('/v1/mobygames/search?q=a'), null);
  assert.equal(normalizeMobyGamesQuery('/v1/mobygames/search'), null);
});

void test('normalizeMobyGamesQuery normalizes platform and limit params', () => {
  const result = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&platform=9&limit=10');
  assert.ok(result);
  assert.equal(result.platform, '9');
  assert.equal(result.limit, 10);

  const negPlatform = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&platform=-1');
  assert.equal(negPlatform?.platform, null);

  const nonNumericLimit = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&limit=abc');
  assert.equal(nonNumericLimit?.limit, null);

  const zeroLimit = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&limit=0');
  assert.equal(zeroLimit?.limit, null);
});

void test('normalizeMobyGamesQuery normalizes include param, filtering invalid fields', () => {
  const withValidAndInvalid = normalizeMobyGamesQuery(
    '/v1/mobygames/search?q=Okami&include=game_id,INVALID+FIELD!,title'
  );
  assert.equal(withValidAndInvalid?.include, 'game_id,title');

  const allInvalid = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&include=!!!,   ');
  assert.equal(allInvalid?.include, null);

  const emptyInclude = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&include=');
  assert.equal(emptyInclude?.include, null);
});

void test('normalizeMobyGamesQuery normalizes format param', () => {
  const brief = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&format=brief');
  assert.equal(brief?.format, 'brief');

  const invalid = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&format=invalid');
  assert.equal(invalid?.format, null);

  const normal = normalizeMobyGamesQuery('/v1/mobygames/search?q=Okami&format=normal');
  assert.equal(normal?.format, 'normal');
});

void test('getAgeSeconds returns POSITIVE_INFINITY for invalid date strings', () => {
  const result = getAgeSeconds('not-a-date', Date.now());
  assert.equal(result, Number.POSITIVE_INFINITY);
});

void test('getAgeSeconds returns 0 for future timestamps', () => {
  const futureMs = Date.now() + 1_000_000;
  const result = getAgeSeconds(new Date(futureMs).toISOString(), Date.now());
  assert.equal(result, 0);
});

void test('isCacheableMobyGamesPayload returns true only for non-empty games arrays', () => {
  assert.equal(isCacheableMobyGamesPayload({ games: [{ id: 1 }] }), true);
  assert.equal(isCacheableMobyGamesPayload({ games: [] }), false);
  assert.equal(isCacheableMobyGamesPayload(null), false);
  assert.equal(isCacheableMobyGamesPayload('string'), false);
  assert.equal(isCacheableMobyGamesPayload({ noGames: true }), false);
});

void test('MOBYGAMES cache serves stale content and schedules background refresh', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();
  let capturedTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 1, title: 'OkamiSWR' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now(),
    scheduleBackgroundRefresh: (task) => {
      capturedTask = task;
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=OkamiSWR'
  });
  assert.equal(first.headers['x-gameshelf-mobygames-cache'], 'MISS');

  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=OkamiSWR'
  });
  assert.equal(second.headers['x-gameshelf-mobygames-cache'], 'HIT_STALE');
  assert.equal(second.headers['x-gameshelf-mobygames-revalidate'], 'scheduled');
  assert.notEqual(capturedTask, null);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.staleServed, 1);
  assert.equal(metrics.mobygames.revalidateScheduled, 1);

  assert.ok(capturedTask);
  await capturedTask();

  await app.close();
});

void test('MOBYGAMES cache stale revalidation fails when upstream returns non-ok response', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();
  let fetchCalls = 0;
  let capturedTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ games: [{ game_id: 2, title: 'SWRFail' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      return Promise.resolve(new Response('Internal Error', { status: 500 }));
    },
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now(),
    scheduleBackgroundRefresh: (task) => {
      capturedTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=SWRFail' });

  const staleResponse = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=SWRFail'
  });
  assert.equal(staleResponse.headers['x-gameshelf-mobygames-cache'], 'HIT_STALE');

  assert.ok(capturedTask);
  await capturedTask();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES cache stale revalidation fails when upstream returns null JSON', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();
  let fetchCalls = 0;
  let capturedTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ games: [{ game_id: 3, title: 'NullJson' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      return Promise.resolve(
        new Response('not valid json{{{', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    },
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now(),
    scheduleBackgroundRefresh: (task) => {
      capturedTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=NullJson' });
  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=NullJson' });

  assert.ok(capturedTask);
  await capturedTask();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES cache stale revalidation fails when upstream payload is not cacheable', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();
  let fetchCalls = 0;
  let capturedTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ games: [{ game_id: 4, title: 'EmptyRevalidate' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ games: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    },
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now(),
    scheduleBackgroundRefresh: (task) => {
      capturedTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=EmptyRevalidate' });
  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=EmptyRevalidate' });

  assert.ok(capturedTask);
  await capturedTask();

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateFailed, 1);

  await app.close();
});

void test('MOBYGAMES cache skips revalidation when already in flight for same key', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();
  let capturedTask: (() => Promise<void>) | null = null;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 5, title: 'InFlight' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now(),
    scheduleBackgroundRefresh: (task) => {
      capturedTask = task;
    }
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=InFlightTest' });

  const stale1 = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=InFlightTest'
  });
  assert.equal(stale1.headers['x-gameshelf-mobygames-revalidate'], 'scheduled');

  const stale2 = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=InFlightTest'
  });
  assert.equal(stale2.headers['x-gameshelf-mobygames-revalidate'], 'skipped');

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateSkipped, 1);

  assert.ok(capturedTask);
  await capturedTask();

  await app.close();
});

void test('MOBYGAMES cache deletes invalid cached entry and falls through to MISS', async () => {
  resetCacheMetrics();

  const invalidEntryPool = {
    query(sql: string): Promise<{ rows: unknown[] }> {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('select response_json, updated_at from mobygames_search_cache')) {
        return Promise.resolve({
          rows: [{ response_json: { games: [] }, updated_at: new Date().toISOString() }]
        });
      }

      if (normalized.startsWith('delete from mobygames_search_cache where cache_key')) {
        return Promise.resolve({ rows: [] });
      }

      if (normalized.startsWith('insert into mobygames_search_cache')) {
        return Promise.resolve({ rows: [] });
      }

      return Promise.resolve({ rows: [] });
    }
  };

  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, invalidEntryPool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 99, title: 'Fresh' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=InvalidCached'
  });

  assert.equal(response.statusCode, 200);
  assert.equal(fetchCalls, 1);
  assert.equal(response.headers['x-gameshelf-mobygames-cache'], 'MISS');

  await app.close();
});

void test('MOBYGAMES cache does not store non-ok fetchMetadata responses', async () => {
  resetCacheMetrics();
  const pool = new MobyGamesPoolMock();
  const app = Fastify();
  let fetchCalls = 0;

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () => {
      fetchCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'upstream error' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      );
    }
  });

  const first = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=UpstreamError'
  });
  assert.equal(first.statusCode, 503);
  assert.equal(first.headers['x-gameshelf-mobygames-cache'], 'MISS');

  const second = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=UpstreamError'
  });
  assert.equal(second.statusCode, 503);
  assert.equal(fetchCalls, 2);

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.writes, 0);

  await app.close();
});

void test('MOBYGAMES cache default scheduleBackgroundRefresh uses queueMicrotask', async () => {
  resetCacheMetrics();

  const BASE_TIME = new Date('2020-01-01T00:00:00.000Z').getTime();
  const pool = new MobyGamesPoolMock({ now: () => BASE_TIME });
  const app = Fastify();

  await registerMobyGamesCachedRoute(app, pool as unknown as Pool, {
    fetchMetadata: () =>
      Promise.resolve(
        new Response(JSON.stringify({ games: [{ game_id: 10, title: 'DefaultSched' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      ),
    freshTtlSeconds: 1,
    staleTtlSeconds: 86400 * 365 * 100,
    now: () => Date.now()
  });

  await app.inject({ method: 'GET', url: '/v1/mobygames/search?q=DefaultScheduler' });

  const staleResponse = await app.inject({
    method: 'GET',
    url: '/v1/mobygames/search?q=DefaultScheduler'
  });
  assert.equal(staleResponse.headers['x-gameshelf-mobygames-cache'], 'HIT_STALE');

  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

  const metrics = getCacheMetrics();
  assert.equal(metrics.mobygames.revalidateScheduled, 1);

  await app.close();
});
