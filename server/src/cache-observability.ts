import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics } from './cache-metrics.js';
import rateLimit from '@fastify/rate-limit';

interface CacheCountRow {
  count: string;
}

export async function registerCacheObservabilityRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  await app.register(rateLimit, {
    max: 60, // maximum number of requests per IP per time window
    timeWindow: '1 minute'
  });

  const cacheStatsRateLimit = app.rateLimit({
    max: 10,
    timeWindow: '1 minute'
  });

  app.get(
    '/v1/cache/stats',
    {
      onRequest: cacheStatsRateLimit
    },
    async (_request, reply) => {
      const metrics = getCacheMetrics();

      let imageAssetCount: number | null = null;
      let hltbEntryCount: number | null = null;
      let dbError: string | null = null;

      try {
        const imageCountResult = await pool.query<CacheCountRow>(
          'SELECT COUNT(*)::text AS count FROM image_assets'
        );
        const hltbCountResult = await pool.query<CacheCountRow>(
          'SELECT COUNT(*)::text AS count FROM hltb_search_cache'
        );
        imageAssetCount = Number.parseInt(imageCountResult.rows[0]?.count ?? '0', 10);
        hltbEntryCount = Number.parseInt(hltbCountResult.rows[0]?.count ?? '0', 10);
      } catch (error) {
        dbError = error instanceof Error ? error.message : String(error);
      }

      reply.send({
        timestamp: new Date().toISOString(),
        metrics,
        counts: {
          imageAssets: imageAssetCount,
          hltbEntries: hltbEntryCount
        },
        dbError
      });
    }
  );
}
