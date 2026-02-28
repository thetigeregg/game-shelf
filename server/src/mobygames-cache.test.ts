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
      process.env[key] = undefined;
    } else {
      process.env[key] = value;
    }
  }

  return fn().finally(() => {
    for (const [key, value] of original.entries()) {
      if (typeof value === 'undefined') {
        process.env[key] = undefined;
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
