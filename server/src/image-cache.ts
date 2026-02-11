import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

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

export function registerImageProxyRoute(
  app: FastifyInstance,
  pool: Pool,
  imageCacheDir: string,
): void {
  app.get('/v1/images/proxy', async (request, reply) => {
    const sourceUrl = normalizeProxyImageUrl((request.query as Record<string, unknown>)['url']);

    if (!sourceUrl) {
      reply.code(400).send({ error: 'Invalid image URL.' });
      return;
    }

    const cacheKey = sha256(sourceUrl);
    const cached = await pool.query<ImageAssetRow>(
      'SELECT cache_key, source_url, content_type, file_path, size_bytes, updated_at FROM image_assets WHERE cache_key = $1 LIMIT 1',
      [cacheKey],
    );
    const existing = cached.rows[0];

    if (existing && await fileExists(existing.file_path)) {
      reply.header('Content-Type', existing.content_type);
      reply.header('Cache-Control', 'public, max-age=86400');
      reply.send(fs.createReadStream(existing.file_path));
      return;
    }

    if (existing && !(await fileExists(existing.file_path))) {
      await pool.query('DELETE FROM image_assets WHERE cache_key = $1', [cacheKey]);
    }

    const upstream = await fetch(sourceUrl, { method: 'GET' });

    if (!upstream.ok) {
      reply.code(502).send({ error: 'Unable to fetch image.' });
      return;
    }

    const contentType = String(upstream.headers.get('content-type') ?? '').trim() || 'application/octet-stream';
    const bytes = Buffer.from(await upstream.arrayBuffer());

    if (bytes.length === 0) {
      reply.code(502).send({ error: 'Empty image response.' });
      return;
    }

    const extension = resolveFileExtension(contentType, sourceUrl);
    const storagePath = path.join(
      imageCacheDir,
      cacheKey.slice(0, 2),
      `${cacheKey}${extension}`,
    );

    await fsPromises.mkdir(path.dirname(storagePath), { recursive: true });
    await fsPromises.writeFile(storagePath, bytes);

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
      [cacheKey, sourceUrl, contentType, storagePath, bytes.length],
    );

    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send(bytes);
  });
}

function normalizeProxyImageUrl(raw: unknown): string | null {
  try {
    const parsed = new URL(String(raw ?? ''));

    if (parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isTheGamesDb = hostname === THE_GAMES_DB_HOST && parsed.pathname.startsWith('/images/');
    const isIgdb = hostname === IGDB_HOST && parsed.pathname.startsWith('/igdb/image/upload/');

    if (!isTheGamesDb && !isIgdb) {
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

