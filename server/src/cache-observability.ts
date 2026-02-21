import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import { getCacheMetrics } from './cache-metrics.js';

interface CacheCountRow {
  count: string;
}

interface CacheCountSnapshot {
  imageAssetCount: number | null;
  hltbEntryCount: number | null;
  dbError: string | null;
}

interface CacheObservabilityRouteOptions {
  cacheStatsRateLimitWindowMs?: number;
  cacheStatsMaxRequestsPerWindow?: number;
}

export async function registerCacheObservabilityRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: CacheObservabilityRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }
  const cacheStatsRateLimitWindowMs = Number.isInteger(options.cacheStatsRateLimitWindowMs)
    ? Number(options.cacheStatsRateLimitWindowMs)
    : 60_000;
  const cacheStatsMaxRequestsPerWindow = Number.isInteger(options.cacheStatsMaxRequestsPerWindow)
    ? Number(options.cacheStatsMaxRequestsPerWindow)
    : 10;

  let snapshot: CacheCountSnapshot = {
    imageAssetCount: null,
    hltbEntryCount: null,
    dbError: null
  };

  const refreshSnapshot = async (): Promise<void> => {
    try {
      const imageCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM image_assets'
      );
      const hltbCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM hltb_search_cache'
      );

      snapshot = {
        imageAssetCount: Number.parseInt(imageCountResult.rows[0]?.count ?? '0', 10),
        hltbEntryCount: Number.parseInt(hltbCountResult.rows[0]?.count ?? '0', 10),
        dbError: null
      };
    } catch (error) {
      snapshot = {
        imageAssetCount: null,
        hltbEntryCount: null,
        dbError: error instanceof Error ? error.message : String(error)
      };
    }
  };

  await refreshSnapshot();

  const refreshHandle = setInterval(() => {
    void refreshSnapshot();
  }, 30_000);
  refreshHandle.unref();

  app.addHook('onClose', async () => {
    clearInterval(refreshHandle);
  });

  app.route({
    method: 'GET',
    url: '/v1/cache/stats',
    config: {
      rateLimit: {
        max: cacheStatsMaxRequestsPerWindow,
        timeWindow: `${Math.floor(cacheStatsRateLimitWindowMs / 1000)} seconds`
      }
    },
    handler: async (_request, reply) => {
      const metrics = getCacheMetrics();

      reply.send({
        timestamp: new Date().toISOString(),
        metrics,
        counts: {
          imageAssets: snapshot.imageAssetCount,
          hltbEntries: snapshot.hltbEntryCount
        },
        dbError: snapshot.dbError
      });
    }
  });
}
