import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerImageProxyRoute } from './image-cache.js';
import { getCacheMetrics, resetCacheMetrics } from './cache-metrics.js';

interface ImageRow {
  cache_key: string;
  source_url: string;
  content_type: string;
  file_path: string;
  size_bytes: number;
  updated_at: string;
}

class ImagePoolMock {
  private readonly rowsByKey = new Map<string, ImageRow>();

  constructor(
    private readonly options: {
      failReads?: boolean;
      failDeletes?: boolean;
      failWrites?: boolean;
      readFailureValue?: unknown;
      deleteFailureValue?: unknown;
      writeFailureValue?: unknown;
    } = {}
  ) {}

  async query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (
      normalized.startsWith(
        'select cache_key, source_url, content_type, file_path, size_bytes, updated_at from image_assets'
      )
    ) {
      if (this.options.failReads) {
        throw this.options.readFailureValue ?? new Error('read_failed');
      }
      const key = String(params[0] ?? '');
      const row = this.rowsByKey.get(key);
      return { rows: row ? [row as T] : [] };
    }

    if (normalized.startsWith('delete from image_assets where cache_key')) {
      if (this.options.failDeletes) {
        throw this.options.deleteFailureValue ?? new Error('delete_failed');
      }
      const key = String(params[0] ?? '');
      this.rowsByKey.delete(key);
      return { rows: [] };
    }

    if (normalized.startsWith('insert into image_assets')) {
      if (this.options.failWrites) {
        throw this.options.writeFailureValue ?? new Error('write_failed');
      }
      const row: ImageRow = {
        cache_key: String(params[0] ?? ''),
        source_url: String(params[1] ?? ''),
        content_type: String(params[2] ?? ''),
        file_path: String(params[3] ?? ''),
        size_bytes: Number(params[4] ?? 0),
        updated_at: new Date().toISOString()
      };
      this.rowsByKey.set(row.cache_key, row);
      return { rows: [] };
    }

    throw new Error(`Unsupported SQL in ImagePoolMock: ${sql}`);
  }
}

test('Image cache stores on miss and serves on hit', async () => {
  resetCacheMetrics();
  const pool = new ImagePoolMock();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-test-'));
  let fetchCalls = 0;

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      });
    }
  });

  const imageUrl = encodeURIComponent(
    'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc123.jpg'
  );
  const first = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${imageUrl}`
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-image-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${imageUrl}`
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-image-cache'], 'HIT');
  assert.equal(fetchCalls, 1);

  const metrics = getCacheMetrics();
  assert.equal(metrics.image.misses, 1);
  assert.equal(metrics.image.hits, 1);
  assert.equal(metrics.image.writes, 1);

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy validates URLs and handles upstream timeout/errors', async () => {
  resetCacheMetrics();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-invalid-test-'));
  const pool = new ImagePoolMock();

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async (url) => {
      if (String(url).includes('timeout')) {
        throw new Error('timeout');
      }
      return new Response('oops', { status: 503 });
    }
  });

  const invalid = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=http://example.com/not-allowed.jpg'
  });
  assert.equal(invalid.statusCode, 400);

  const invalidPort = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com:444/igdb/image/upload/bad-port.jpg'
  });
  assert.equal(invalidPort.statusCode, 400);

  const encodedPathTraversal = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/%2e%2e/admin.jpg'
  });
  assert.equal(encodedPathTraversal.statusCode, 400);

  const withQueryString = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/abc123.jpg?redirect=http://127.0.0.1'
  });
  assert.equal(withQueryString.statusCode, 400);

  // Explicit :443 is normalized to the default HTTPS port and should pass validation
  const explicitStandardPort = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com:443/igdb/image/upload/explicit-443.jpg'
  });
  assert.equal(explicitStandardPort.statusCode, 502);

  const timeout = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/timeout.jpg'
  });
  assert.equal(timeout.statusCode, 504);

  const upstreamError = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/upstream.jpg'
  });
  assert.equal(upstreamError.statusCode, 502);

  const metrics = getCacheMetrics();
  assert.equal(metrics.image.invalidRequests, 4);
  assert.equal(metrics.image.upstreamErrors, 3);

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy enforces size limits and rejects empty upstream payloads', async () => {
  resetCacheMetrics();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-size-test-'));
  const pool = new ImagePoolMock();
  let call = 0;

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    maxBytes: 3,
    fetchImpl: async () => {
      call += 1;
      if (call === 1) {
        return new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': '10'
          }
        });
      }
      return new Response(new Uint8Array([]), {
        status: 200,
        headers: {
          'content-type': 'image/png'
        }
      });
    }
  });

  const oversized = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://cdn.thegamesdb.net/images/original/oversized.png'
  });
  assert.equal(oversized.statusCode, 413);

  const empty = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://cdn.thegamesdb.net/images/original/empty.png'
  });
  assert.equal(empty.statusCode, 502);

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy tolerates cache read/write/delete failures and still serves response', async () => {
  resetCacheMetrics();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-fail-open-test-'));
  const sourceUrl = 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/fail-open.jpg';
  const encoded = encodeURIComponent(sourceUrl);

  {
    const app = Fastify();
    await registerImageProxyRoute(
      app,
      new ImagePoolMock({ failReads: true }) as unknown as Pool,
      tempDir,
      {
        fetchImpl: async () =>
          new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' }
          })
      }
    );

    const response = await app.inject({
      method: 'GET',
      url: `/v1/images/proxy?url=${encoded}`
    });
    assert.equal(response.statusCode, 200);
    await app.close();
  }

  {
    const app = Fastify();
    await registerImageProxyRoute(
      app,
      new ImagePoolMock({ failWrites: true }) as unknown as Pool,
      tempDir,
      {
        fetchImpl: async () =>
          new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' }
          })
      }
    );

    const response = await app.inject({
      method: 'GET',
      url: `/v1/images/proxy?url=${encoded}`
    });
    assert.equal(response.statusCode, 200);
    await app.close();
  }

  {
    const app = Fastify();
    await registerImageProxyRoute(
      app,
      new ImagePoolMock({ failDeletes: true, failWrites: true }) as unknown as Pool,
      tempDir,
      {
        fetchImpl: async () =>
          new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' }
          })
      }
    );
    const purge = await app.inject({
      method: 'POST',
      url: '/v1/images/cache/purge',
      payload: { urls: [sourceUrl] }
    });
    assert.equal(purge.statusCode, 200);
    await app.close();
  }

  const metrics = getCacheMetrics();
  assert.ok(metrics.image.readErrors >= 1);
  assert.ok(metrics.image.writeErrors >= 1);

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy handles stale DB record with missing file and fallback extension', async () => {
  resetCacheMetrics();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-stale-record-test-'));
  const sourceUrl = 'https://images.igdb.com/igdb/image/upload/t_cover_big_2x/no-ext';
  const encoded = encodeURIComponent(sourceUrl);

  const stalePool = new ImagePoolMock();

  // Prime cache metadata with a missing file path by making one request, then deleting the file.
  const primingApp = Fastify();
  await registerImageProxyRoute(primingApp, stalePool as unknown as Pool, tempDir, {
    fetchImpl: async () =>
      new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
  });
  await primingApp.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${encoded}`
  });
  await primingApp.close();

  const cacheDir = await fs.readdir(tempDir);
  for (const child of cacheDir) {
    await fs.rm(path.join(tempDir, child), { recursive: true, force: true });
  }

  const app = Fastify();
  await registerImageProxyRoute(app, stalePool as unknown as Pool, tempDir, {
    fetchImpl: async () =>
      new Response(Buffer.from([9, 9, 9]), {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
  });

  const response = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${encoded}`
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-image-cache'], 'MISS');

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy logs non-Error database failures and still responds', async () => {
  resetCacheMetrics();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-nonerror-test-'));
  const pool = new ImagePoolMock({
    failReads: true,
    readFailureValue: 'read_failure_string',
    failWrites: true,
    writeFailureValue: 'write_failure_string'
  });

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async () =>
      new Response(Buffer.from([0xaa, 0xbb, 0xcc]), {
        status: 200,
        headers: {
          'content-type': 'image/unknown'
        }
      })
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/nonerror'
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['x-gameshelf-image-cache'], 'MISS');

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy handles missing url parameter and null upstream body', async () => {
  resetCacheMetrics();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-null-body-test-'));
  const pool = new ImagePoolMock();

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async () =>
      new Response(null, {
        status: 200,
        headers: {
          'content-type': 'image/png'
        }
      })
  });

  const missingUrl = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy'
  });
  assert.equal(missingUrl.statusCode, 400);

  const nullBody = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://cdn.thegamesdb.net/images/original/null-body.png'
  });
  assert.equal(nullBody.statusCode, 502);

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image cache purge endpoint removes cached assets by source URL', async () => {
  resetCacheMetrics();
  const pool = new ImagePoolMock();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-purge-test-'));
  let fetchCalls = 0;

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      });
    }
  });

  const sourceUrl = 'https://cdn.thegamesdb.net/images/original/boxart/front/123.jpg';
  const encodedUrl = encodeURIComponent(sourceUrl);
  const first = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${encodedUrl}`
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-image-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const purge = await app.inject({
    method: 'POST',
    url: '/v1/images/cache/purge',
    payload: { urls: [sourceUrl] }
  });
  assert.equal(purge.statusCode, 200);
  assert.deepEqual(purge.json(), { deleted: 1 });

  const second = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${encodedUrl}`
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers['x-gameshelf-image-cache'], 'MISS');
  assert.equal(fetchCalls, 2);

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image proxy route rate limits by client IP', async () => {
  resetCacheMetrics();
  const pool = new ImagePoolMock();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-rate-limit-test-'));

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    rateLimitWindowMs: 60_000,
    imageProxyMaxRequestsPerWindow: 2,
    fetchImpl: async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })
  });

  const one = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/rate-limit-1.jpg'
  });
  assert.equal(one.statusCode, 200);

  const two = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/rate-limit-2.jpg'
  });
  assert.equal(two.statusCode, 200);

  const limited = await app.inject({
    method: 'GET',
    url: '/v1/images/proxy?url=https://images.igdb.com/igdb/image/upload/rate-limit-3.jpg'
  });
  assert.equal(limited.statusCode, 429);
  assert.ok(typeof limited.headers['retry-after'] === 'string');

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('Image purge route rate limits by client IP', async () => {
  resetCacheMetrics();
  const pool = new ImagePoolMock();
  const app = Fastify();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-image-cache-purge-rate-limit-test-'));

  await registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    rateLimitWindowMs: 60_000,
    imagePurgeMaxRequestsPerWindow: 2
  });

  const url = 'https://images.igdb.com/igdb/image/upload/purge-rate-limit.jpg';

  const one = await app.inject({
    method: 'POST',
    url: '/v1/images/cache/purge',
    payload: { urls: [url] }
  });
  assert.equal(one.statusCode, 200);

  const two = await app.inject({
    method: 'POST',
    url: '/v1/images/cache/purge',
    payload: { urls: [url] }
  });
  assert.equal(two.statusCode, 200);

  const limited = await app.inject({
    method: 'POST',
    url: '/v1/images/cache/purge',
    payload: { urls: [url] }
  });
  assert.equal(limited.statusCode, 429);
  assert.ok(typeof limited.headers['retry-after'] === 'string');

  await app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});
