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

  async query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select cache_key, source_url, content_type, file_path, size_bytes, updated_at from image_assets')) {
      const key = String(params[0] ?? '');
      const row = this.rowsByKey.get(key);
      return { rows: row ? [row as T] : [] };
    }

    if (normalized.startsWith('delete from image_assets where cache_key')) {
      const key = String(params[0] ?? '');
      this.rowsByKey.delete(key);
      return { rows: [] };
    }

    if (normalized.startsWith('insert into image_assets')) {
      const row: ImageRow = {
        cache_key: String(params[0] ?? ''),
        source_url: String(params[1] ?? ''),
        content_type: String(params[2] ?? ''),
        file_path: String(params[3] ?? ''),
        size_bytes: Number(params[4] ?? 0),
        updated_at: new Date().toISOString(),
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

  registerImageProxyRoute(app, pool as unknown as Pool, tempDir, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    },
  });

  const imageUrl = encodeURIComponent('https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc123.jpg');
  const first = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${imageUrl}`,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['x-gameshelf-image-cache'], 'MISS');
  assert.equal(fetchCalls, 1);

  const second = await app.inject({
    method: 'GET',
    url: `/v1/images/proxy?url=${imageUrl}`,
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
