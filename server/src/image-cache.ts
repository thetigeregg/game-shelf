import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { incrementImageMetric } from './cache-metrics.js';

interface ImageAssetRow {
  cache_key: string;
  source_url: string;
  content_type: string;
  file_path: string;
  size_bytes: number;
  updated_at: string;
}

const THE_GAMES_DB_HOST = 'cdn.thegamesdb.net';
const IGDB_HOST = 'images.igdb.com';

interface ImageCacheRouteOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export function registerImageProxyRoute(
  app: FastifyInstance,
  pool: Pool,
  imageCacheDir: string,
  options: ImageCacheRouteOptions = {}
): void {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) ? Number(options.timeoutMs) : 12_000;
  const maxBytes = Number.isInteger(options.maxBytes) ? Number(options.maxBytes) : 8 * 1024 * 1024;

  app.post('/v1/images/cache/purge', async (request, reply) => {
    const body = (request.body ?? {}) as { urls?: unknown };
    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    const normalizedUrls = [
      ...new Set(
        rawUrls
          .map((url) => normalizeProxyImageUrl(url))
          .filter((url): url is string => typeof url === 'string' && url.length > 0)
      )
    ];

    if (normalizedUrls.length === 0) {
      reply.send({ deleted: 0 });
      return;
    }

    let deleted = 0;

    for (const sourceUrl of normalizedUrls) {
      const cacheKey = sha256(sourceUrl);
      let existing: ImageAssetRow | undefined;

      try {
        const cached = await pool.query<ImageAssetRow>(
          'SELECT cache_key, source_url, content_type, file_path, size_bytes, updated_at FROM image_assets WHERE cache_key = $1 LIMIT 1',
          [cacheKey]
        );
        existing = cached.rows[0];
      } catch {
        continue;
      }

      if (!existing) {
        continue;
      }

      try {
        await pool.query('DELETE FROM image_assets WHERE cache_key = $1', [cacheKey]);
      } catch {
        continue;
      }

      deleted += 1;

      try {
        await fsPromises.unlink(existing.file_path);
      } catch {
        // Ignore filesystem cleanup failures. DB metadata is already removed.
      }
    }

    reply.send({ deleted });
  });

  app.get('/v1/images/proxy', async (request, reply) => {
    const sourceUrl = normalizeProxyImageUrl((request.query as Record<string, unknown>)['url']);

    if (!sourceUrl) {
      incrementImageMetric('invalidRequests');
      reply.code(400).send({ error: 'Invalid image URL.' });
      return;
    }

    const cacheKey = sha256(sourceUrl);
    let existing: ImageAssetRow | undefined;

    try {
      const cached = await pool.query<ImageAssetRow>(
        'SELECT cache_key, source_url, content_type, file_path, size_bytes, updated_at FROM image_assets WHERE cache_key = $1 LIMIT 1',
        [cacheKey]
      );
      existing = cached.rows[0];
    } catch (error) {
      incrementImageMetric('readErrors');
      request.log.warn({
        msg: 'image_cache_read_failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (existing && (await fileExists(existing.file_path))) {
      incrementImageMetric('hits');
      reply.header('X-GameShelf-Image-Cache', 'HIT');
      reply.header('Content-Type', existing.content_type);
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.send(fs.createReadStream(existing.file_path));
      return;
    }

    if (existing && !(await fileExists(existing.file_path))) {
      try {
        await pool.query('DELETE FROM image_assets WHERE cache_key = $1', [cacheKey]);
      } catch (error) {
        incrementImageMetric('writeErrors');
        request.log.warn({
          msg: 'image_cache_delete_missing_file_failed',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    incrementImageMetric('misses');
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    let upstream: Response;

    try {
      upstream = await fetchImpl(sourceUrl, { method: 'GET', signal: controller.signal });
    } catch {
      incrementImageMetric('upstreamErrors');
      reply.code(504).send({ error: 'Image fetch timed out.' });
      return;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!upstream.ok) {
      incrementImageMetric('upstreamErrors');
      reply.code(502).send({ error: 'Unable to fetch image.' });
      return;
    }

    const contentType =
      String(upstream.headers.get('content-type') ?? '').trim() || 'application/octet-stream';
    const bytes = await readResponseBytesWithLimit(upstream, maxBytes);

    if (!bytes) {
      incrementImageMetric('upstreamErrors');
      reply.code(413).send({ error: 'Image exceeds maximum allowed size.' });
      return;
    }

    if (bytes.length === 0) {
      reply.code(502).send({ error: 'Empty image response.' });
      return;
    }

    const extension = resolveFileExtension(contentType, sourceUrl);
    const storagePath = path.join(imageCacheDir, cacheKey.slice(0, 2), `${cacheKey}${extension}`);

    await fsPromises.mkdir(path.dirname(storagePath), { recursive: true });
    await fsPromises.writeFile(storagePath, bytes);

    try {
      await pool.query(
        `
        INSERT INTO image_assets (cache_key, source_url, content_type, file_path, size_bytes, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (cache_key)
        DO UPDATE SET
          source_url = EXCLUDED.source_url,
          content_type = EXCLUDED.content_type,
          file_path = EXCLUDED.file_path,
          size_bytes = EXCLUDED.size_bytes,
          updated_at = NOW()
        `,
        [cacheKey, sourceUrl, contentType, storagePath, bytes.length]
      );
      incrementImageMetric('writes');
    } catch (error) {
      incrementImageMetric('writeErrors');
      request.log.warn({
        msg: 'image_cache_write_failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    reply.header('X-GameShelf-Image-Cache', 'MISS');
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send(bytes);
  });
}

function normalizeProxyImageUrl(raw: unknown): string | null {
  try {
    const parsed = new URL(String(raw ?? ''));

    // Only allow HTTPS requests
    if (parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // Normalize allowed hosts for comparison
    const allowedTheGamesDbHost = THE_GAMES_DB_HOST.toLowerCase();
    const allowedIgdbHost = IGDB_HOST.toLowerCase();

    const isTheGamesDb = hostname === allowedTheGamesDbHost && pathname.startsWith('/images/');
    const isIgdb = hostname === allowedIgdbHost && pathname.startsWith('/igdb/image/upload/');

    if (!isTheGamesDb && !isIgdb) {
      return null;
    }

    // Enforce standard HTTPS port: either explicit 443 or default (empty)
    if (parsed.port && parsed.port !== '443') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveFileExtension(contentType: string, sourceUrl: string): string {
  const normalizedType = contentType.toLowerCase();

  if (normalizedType.includes('image/jpeg')) {
    return '.jpg';
  }

  if (normalizedType.includes('image/png')) {
    return '.png';
  }

  if (normalizedType.includes('image/webp')) {
    return '.webp';
  }

  if (normalizedType.includes('image/gif')) {
    return '.gif';
  }

  try {
    const pathname = new URL(sourceUrl).pathname;
    const extension = path.extname(pathname).toLowerCase();
    return extension.length > 0 && extension.length <= 5 ? extension : '.img';
  } catch {
    return '.img';
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number
): Promise<Buffer | null> {
  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);

  if (Number.isInteger(contentLength) && contentLength > maxBytes) {
    return null;
  }

  const reader = response.body?.getReader();

  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      return null;
    }

    chunks.push(value);
  }

  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  );
}
