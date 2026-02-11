import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { incrementHltbMetric } from './cache-metrics.js';

interface HltbCacheRow {
  response_json: unknown;
}

interface NormalizedHltbQuery {
  query: string;
  releaseYear: number | null;
  platform: string | null;
  includeCandidates: boolean;
}

interface HltbCacheRouteOptions {
  fetchMetadata?: (request: FastifyRequest) => Promise<Response>;
}

export function registerHltbCachedRoute(app: FastifyInstance, pool: Pool, options: HltbCacheRouteOptions = {}): void {
  const fetchMetadata = options.fetchMetadata ?? fetchMetadataFromWorker;

  app.get('/v1/hltb/search', async (request, reply) => {
    const normalized = normalizeHltbQuery(request.url);
    const cacheKey = normalized ? buildCacheKey(normalized) : null;
    let cacheOutcome: 'MISS' | 'BYPASS' = 'MISS';

    if (cacheKey) {
      try {
        const cached = await pool.query<HltbCacheRow>(
          'SELECT response_json FROM hltb_search_cache WHERE cache_key = $1 LIMIT 1',
          [cacheKey],
        );
        const cachedRow = cached.rows[0];

        if (cachedRow) {
          incrementHltbMetric('hits');
          reply.header('X-GameShelf-HLTB-Cache', 'HIT');
          reply.code(200).send(cachedRow.response_json);
          return;
        }
      } catch (error) {
        incrementHltbMetric('readErrors');
        incrementHltbMetric('bypasses');
        cacheOutcome = 'BYPASS';
        request.log.warn({
          msg: 'hltb_cache_read_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    incrementHltbMetric('misses');
    const response = await fetchMetadata(request);

    if (cacheKey && normalized && response.ok) {
      const payload = await safeReadJson(response);

      if (payload !== null) {
        try {
          await pool.query(
            `
            INSERT INTO hltb_search_cache (cache_key, query_title, release_year, platform, include_candidates, response_json, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
            ON CONFLICT (cache_key)
            DO UPDATE SET
              response_json = EXCLUDED.response_json,
              updated_at = NOW()
            `,
            [
              cacheKey,
              normalized.query,
              normalized.releaseYear,
              normalized.platform,
              normalized.includeCandidates,
              JSON.stringify(payload),
            ],
          );
          incrementHltbMetric('writes');
        } catch (error) {
          incrementHltbMetric('writeErrors');
          request.log.warn({
            msg: 'hltb_cache_write_failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    reply.header('X-GameShelf-HLTB-Cache', cacheOutcome);
    await sendWebResponse(reply, response);
  });
}

function normalizeHltbQuery(rawUrl: string): NormalizedHltbQuery | null {
  const url = new URL(rawUrl, 'http://game-shelf.local');
  const query = (url.searchParams.get('q') ?? '').trim();

  if (query.length < 2) {
    return null;
  }

  const rawYear = (url.searchParams.get('releaseYear') ?? '').trim();
  const releaseYear = /^\d{4}$/.test(rawYear) ? Number.parseInt(rawYear, 10) : null;
  const rawPlatform = (url.searchParams.get('platform') ?? '').trim();
  const platform = rawPlatform.length > 0 ? rawPlatform : null;
  const rawIncludeCandidates = String(url.searchParams.get('includeCandidates') ?? '').trim().toLowerCase();
  const includeCandidates = rawIncludeCandidates === '1'
    || rawIncludeCandidates === 'true'
    || rawIncludeCandidates === 'yes';

  return {
    query,
    releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
    platform,
    includeCandidates,
  };
}

function buildCacheKey(query: NormalizedHltbQuery): string {
  const payload = JSON.stringify([
    query.query.toLowerCase(),
    query.releaseYear,
    query.platform?.toLowerCase() ?? null,
    query.includeCandidates,
  ]);

  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function safeReadJson(response: Response): Promise<unknown | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function fetchMetadataFromWorker(request: FastifyRequest): Promise<Response> {
  const metadataModule = await import('./metadata.js');
  return metadataModule.fetchMetadataFromWorker(request);
}

async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.code(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });

  if (!response.body) {
    reply.send();
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') || contentType.startsWith('text/')) {
    const text = await response.text();
    reply.send(text);
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  reply.send(bytes);
}
