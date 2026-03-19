import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { getCacheMetrics } from './cache-metrics.js';
import { applyRouteRateLimit, ensureRateLimitRegistered } from './rate-limit.js';

interface CacheCountRow {
  count: string;
}

interface CacheCountSnapshot {
  imageAssetCount: number | null;
  hltbEntryCount: number | null;
  metacriticEntryCount: number | null;
  mobygamesEntryCount: number | null;
  steamPriceEntryCount: number | null;
  pspricesPriceEntryCount: number | null;
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
  await ensureRateLimitRegistered(app);
  const rateLimitConfig = applyRouteRateLimit('cache_stats');
  if (Number.isInteger(options.cacheStatsMaxRequestsPerWindow)) {
    rateLimitConfig.rateLimit.max = Number(options.cacheStatsMaxRequestsPerWindow);
  }
  if (Number.isInteger(options.cacheStatsRateLimitWindowMs)) {
    rateLimitConfig.rateLimit.timeWindow = `${String(
      Math.max(1, Math.floor(Number(options.cacheStatsRateLimitWindowMs) / 1000))
    )} seconds`;
  }

  let snapshot: CacheCountSnapshot = {
    imageAssetCount: null,
    hltbEntryCount: null,
    metacriticEntryCount: null,
    mobygamesEntryCount: null,
    steamPriceEntryCount: null,
    pspricesPriceEntryCount: null,
    dbError: null,
  };

  const refreshSnapshot = async (): Promise<void> => {
    try {
      const imageCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM image_assets'
      );
      const hltbCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM hltb_search_cache'
      );
      const metacriticCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM metacritic_search_cache'
      );
      const mobygamesCountResult = await pool.query<CacheCountRow>(
        'SELECT COUNT(*)::text AS count FROM mobygames_search_cache'
      );
      const steamPriceCountResult = await pool.query<CacheCountRow>(
        "SELECT COUNT(*)::text AS count FROM games WHERE COALESCE(payload->>'steamPriceFetchedAt', '') <> ''"
      );
      const pspricesPriceCountResult = await pool.query<CacheCountRow>(
        "SELECT COUNT(*)::text AS count FROM games WHERE COALESCE(payload->>'psPricesFetchedAt', '') <> ''"
      );

      snapshot = {
        imageAssetCount: Number.parseInt(imageCountResult.rows[0]?.count ?? '0', 10),
        hltbEntryCount: Number.parseInt(hltbCountResult.rows[0]?.count ?? '0', 10),
        metacriticEntryCount: Number.parseInt(metacriticCountResult.rows[0]?.count ?? '0', 10),
        mobygamesEntryCount: Number.parseInt(mobygamesCountResult.rows[0]?.count ?? '0', 10),
        steamPriceEntryCount: Number.parseInt(steamPriceCountResult.rows[0]?.count ?? '0', 10),
        pspricesPriceEntryCount: Number.parseInt(
          pspricesPriceCountResult.rows[0]?.count ?? '0',
          10
        ),
        dbError: null,
      };
    } catch (error) {
      snapshot = {
        imageAssetCount: null,
        hltbEntryCount: null,
        metacriticEntryCount: null,
        mobygamesEntryCount: null,
        steamPriceEntryCount: null,
        pspricesPriceEntryCount: null,
        dbError: error instanceof Error ? error.message : String(error),
      };
    }
  };

  await refreshSnapshot();

  const refreshHandle = setInterval(() => {
    void refreshSnapshot();
  }, 30_000);
  refreshHandle.unref();

  app.addHook('onClose', () => {
    clearInterval(refreshHandle);
  });

  app.route({
    method: 'GET',
    url: '/v1/cache/stats',
    config: rateLimitConfig,
    handler: async (_request, reply) => {
      const metrics = getCacheMetrics();

      reply.send({
        timestamp: new Date().toISOString(),
        metrics,
        counts: {
          imageAssets: snapshot.imageAssetCount,
          hltbEntries: snapshot.hltbEntryCount,
          metacriticEntries: snapshot.metacriticEntryCount,
          mobygamesEntries: snapshot.mobygamesEntryCount,
          steamPriceEntries: snapshot.steamPriceEntryCount,
          pspricesPriceEntries: snapshot.pspricesPriceEntryCount,
        },
        dbError: snapshot.dbError,
      });
    },
  });
}
