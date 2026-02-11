import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { fetchMetadataFromWorker, sendWebResponse } from './metadata.js';

interface HltbCacheRow {
  response_json: unknown;
}

interface NormalizedHltbQuery {
  query: string;
  releaseYear: number | null;
  platform: string | null;
  includeCandidates: boolean;
}

export function registerHltbCachedRoute(app: FastifyInstance, pool: Pool): void {
  app.get('/v1/hltb/search', async (request, reply) => {
    const normalized = normalizeHltbQuery(request.url);
    const cacheKey = normalized ? buildCacheKey(normalized) : null;

    if (cacheKey) {
      const cached = await pool.query<HltbCacheRow>(
        'SELECT response_json FROM hltb_search_cache WHERE cache_key = $1 LIMIT 1',
        [cacheKey],
      );
      const cachedRow = cached.rows[0];

      if (cachedRow) {
        reply.header('X-GameShelf-HLTB-Cache', 'HIT');
        reply.code(200).send(cachedRow.response_json);
        return;
      }
    }

    const response = await fetchMetadataFromWorker(request);

    if (cacheKey && normalized && response.ok) {
      const payload = await safeReadJson(response);

      if (payload !== null) {
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
      }
    }

    reply.header('X-GameShelf-HLTB-Cache', 'MISS');
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
